import { readFileSync } from 'node:fs';
import { argv } from 'node:process';

import {
  PRODUCTION_KEYWORDS,
  TRUSTED_AUTHORS,
  isAllowedReferrer,
  isInAllowlist,
  validateVerifyCommand,
} from './allowlist.mjs';

const SECTION_NAMES = ['目标', '验收', '允许改的文件', '不做', '验证命令', '优先级'];
const MAX_FILES = 6;
const MIN_FILES = 1;
const MAX_PICKED = 2;

/**
 * Parse the 6 required sections from an issue body.
 *
 * @param {string} body
 * @returns {{
 *   goal: string|null,
 *   acceptance: string|null,
 *   allowedFiles: string[]|null,
 *   notDoing: string|null,
 *   verifyCommands: string[]|null,
 *   priority: string|null,
 *   complete: boolean
 * }}
 */
export function parseSections(body) {
  const empty = {
    goal: null,
    acceptance: null,
    allowedFiles: null,
    notDoing: null,
    verifyCommands: null,
    priority: null,
    complete: false,
  };
  if (typeof body !== 'string' || body.trim().length === 0) return empty;

  const sections = splitSections(body);
  const goal = textOf(sections, '目标');
  const acceptance = textOf(sections, '验收');
  const notDoing = textOf(sections, '不做');
  const priority = textOf(sections, '优先级');
  const allowedFiles = listOf(sections, '允许改的文件');
  const verifyCommands = listOf(sections, '验证命令');

  const complete =
    isNonEmpty(goal) &&
    isNonEmpty(acceptance) &&
    isNonEmpty(notDoing) &&
    isNonEmpty(priority) &&
    allowedFiles !== null &&
    allowedFiles.length > 0 &&
    verifyCommands !== null &&
    verifyCommands.length > 0;

  return { goal, acceptance, allowedFiles, notDoing, verifyCommands, priority, complete };
}

/**
 * @param {string} body
 * @returns {Map<string, string[]>}
 */
function splitSections(body) {
  const map = new Map();
  let current = null;
  for (const rawLine of body.split(/\r?\n/)) {
    const heading = matchHeading(rawLine);
    if (heading !== null) {
      current = heading;
      if (!map.has(current)) map.set(current, []);
      continue;
    }
    if (current !== null) map.get(current).push(rawLine);
  }
  return map;
}

/**
 * @param {string} line
 * @returns {string|null}
 */
function matchHeading(line) {
  const m = /^##\s+(.+?)\s*$/.exec(line);
  if (!m) return null;
  const name = m[1].trim();
  return SECTION_NAMES.includes(name) ? name : null;
}

/**
 * @param {Map<string, string[]>} sections
 * @param {string} name
 * @returns {string|null}
 */
function textOf(sections, name) {
  const lines = sections.get(name);
  if (!lines) return null;
  const text = lines.join('\n').trim();
  return text.length > 0 ? text : null;
}

/**
 * @param {Map<string, string[]>} sections
 * @param {string} name
 * @returns {string[]|null}
 */
function listOf(sections, name) {
  const lines = sections.get(name);
  if (!lines) return null;
  const items = [];
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    items.push(trimmed.startsWith('- ') ? trimmed.slice(2).trim() : trimmed);
  }
  return items;
}

/**
 * @param {string|null} value
 * @returns {boolean}
 */
function isNonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Check if a priority string indicates P2 or P3 with §11 scoring.
 *
 * @param {string} priority
 * @returns {boolean}
 */
export function isValidPriority(priority) {
  if (typeof priority !== 'string') return false;
  const lower = priority.toLowerCase();
  const hasLevel = lower.includes('p2') || lower.includes('p3');
  const hasScoring = ['频率', 'impact', '收入'].some((k) => lower.includes(k.toLowerCase()));
  return hasLevel && hasScoring;
}

/**
 * Filter issues eligible for the auto-dev lane.
 *
 * @param {{
 *   issues: Array<{number: number, author: string, labels: string[], body: string}>,
 *   labelEvents: Map<number, Array<{label: string, actor: string}>>,
 *   openPrFiles: Map<number, string[]>,
 *   trunkImporters: (filePath: string) => string[],
 *   classifyRisk: (opts: {files: Array<{filename: string, status: string}>}) => {risk: string},
 * }} input
 * @returns {Array<{number: number, reason?: undefined} | {number: number, skip: true, reason: string}>}
 */
export function pickIssues(input) {
  const issues = Array.isArray(input.issues) ? input.issues : [];
  const sorted = [...issues].sort((a, b) => a.number - b.number);

  const results = [];
  let picked = 0;

  for (const issue of sorted) {
    const reason = firstSkipReason(issue, input);
    if (reason !== null) {
      results.push({ number: issue.number, skip: true, reason });
      continue;
    }
    if (picked >= MAX_PICKED) {
      results.push({ number: issue.number, skip: true, reason: '本轮已满 2 张' });
      continue;
    }
    picked += 1;
    results.push({ number: issue.number });
  }

  return results;
}

/**
 * @param {{number: number, author: string, labels: string[], body: string}} issue
 * @param {object} input
 * @returns {string|null}
 */
function firstSkipReason(issue, input) {
  if (!TRUSTED_AUTHORS.includes(issue.author)) return '作者不在可信名单';

  if (!hasTrustedLabeler(issue, input.labelEvents)) {
    return 'auto-dev 标签不是可信作者贴的';
  }

  if (!hasTrustedLastEditor(issue, input.lastEditors)) {
    return '正文最后编辑者不在可信名单';
  }

  if (!hasValidLabels(issue.labels)) return '标签状态不符';

  const sections = parseSections(issue.body);
  if (!sections.complete) return '正文 6 段不齐全';

  if (!isValidPriority(sections.priority)) return '优先级不是 P2/P3 或缺 §11 打分';

  if (!hasValidFiles(sections.allowedFiles, input.classifyRisk)) {
    return '文件数超限或含 A 级文件';
  }

  if (!hasValidAllowlistAndReferrers(sections.allowedFiles, input.trunkImporters)) {
    return '文件不在白名单或引用方在白名单外';
  }

  const verifyReason = verifyCommandsReason(sections.verifyCommands, sections.allowedFiles);
  if (verifyReason !== null) return `验证命令不合规: ${verifyReason}`;

  if (hasOpenPrOverlap(sections.allowedFiles, input.openPrFiles)) {
    return '有未合并 PR 改到同一文件';
  }

  if (hasProductionKeyword(sections.acceptance)) return '验收条件含生产/外部依赖';

  return null;
}

/**
 * @param {{number: number}} issue
 * @param {Map<number, string>} lastEditors - map of issue number → last body editor login
 * @returns {boolean}
 */
function hasTrustedLastEditor(issue, lastEditors) {
  if (!(lastEditors instanceof Map)) return false;
  const editor = lastEditors.get(issue.number);
  if (typeof editor !== 'string') return false;
  return TRUSTED_AUTHORS.includes(editor);
}

/**
 * @param {{number: number}} issue
 * @param {Map<number, Array<{label: string, actor: string}>>} labelEvents
 * @returns {boolean}
 */
function hasTrustedLabeler(issue, labelEvents) {
  if (!(labelEvents instanceof Map)) return false;
  const events = labelEvents.get(issue.number);
  if (!Array.isArray(events)) return false;
  return events.some(
    (e) => e.label === 'auto-dev' && TRUSTED_AUTHORS.includes(e.actor),
  );
}

/**
 * @param {string[]} labels
 * @returns {boolean}
 */
function hasValidLabels(labels) {
  if (!Array.isArray(labels)) return false;
  if (!labels.includes('auto-dev')) return false;
  if (labels.includes('auto-dev:in-progress')) return false;
  if (labels.includes('auto-dev:needs-human')) return false;
  return true;
}

/**
 * @param {string[]} files
 * @param {(opts: {files: Array<{filename: string, status: string}>}) => {risk: string}} classifyRisk
 * @returns {boolean}
 */
function hasValidFiles(files, classifyRisk) {
  if (!Array.isArray(files)) return false;
  if (files.length < MIN_FILES || files.length > MAX_FILES) return false;
  if (typeof classifyRisk !== 'function') return false;
  return files.every((f) => {
    const result = classifyRisk({ files: [{ filename: f, status: 'modified' }] });
    return result && (result.risk === 'B' || result.risk === 'C');
  });
}

/**
 * @param {string[]} files
 * @param {(filePath: string) => string[]} trunkImporters
 * @returns {boolean}
 */
function hasValidAllowlistAndReferrers(files, trunkImporters) {
  if (!Array.isArray(files)) return false;
  if (typeof trunkImporters !== 'function') return false;
  return files.every((f) => {
    if (!isInAllowlist(f, 'modified')) return false;
    if (isTestFile(f)) return true;
    const importers = trunkImporters(f);
    if (!Array.isArray(importers)) return false;
    return importers.every((p) => isAllowedReferrer(p));
  });
}

/**
 * @param {string} filePath
 * @returns {boolean}
 */
function isTestFile(filePath) {
  return filePath.startsWith('src/lib/pm-todo/__tests__/');
}

/**
 * @param {string[]} commands
 * @param {string[]} allowedFiles
 * @returns {string|null}
 */
function verifyCommandsReason(commands, allowedFiles) {
  if (!Array.isArray(commands) || commands.length === 0) return '缺少验证命令';
  for (const cmd of commands) {
    const result = validateVerifyCommand(cmd, allowedFiles);
    if (!result.valid) return result.reason || '未知原因';
  }
  return null;
}

/**
 * @param {string[]} files
 * @param {Map<number, string[]>} openPrFiles
 * @returns {boolean}
 */
function hasOpenPrOverlap(files, openPrFiles) {
  if (!(openPrFiles instanceof Map)) return false;
  const changed = new Set();
  for (const list of openPrFiles.values()) {
    if (Array.isArray(list)) for (const f of list) changed.add(f);
  }
  return files.some((f) => changed.has(f));
}

/**
 * @param {string} acceptance
 * @returns {boolean}
 */
function hasProductionKeyword(acceptance) {
  if (typeof acceptance !== 'string') return false;
  const lower = acceptance.toLowerCase();
  return PRODUCTION_KEYWORDS.some((k) => lower.includes(k.toLowerCase()));
}

// ── CLI entry point: node pick.mjs <input.json> ──
if (argv[1] && argv[1].endsWith('pick.mjs') && argv[2]) {
  const raw = readFileSync(argv[2], 'utf8');
  const input = JSON.parse(raw);
  if (input.labelEvents && !(input.labelEvents instanceof Map)) {
    input.labelEvents = new Map(Object.entries(input.labelEvents).map(([k, v]) => [Number(k), v]));
  }
  if (input.openPrFiles && !(input.openPrFiles instanceof Map)) {
    input.openPrFiles = new Map(Object.entries(input.openPrFiles).map(([k, v]) => [Number(k), v]));
  }
  if (input.lastEditors && !(input.lastEditors instanceof Map)) {
    input.lastEditors = new Map(Object.entries(input.lastEditors).map(([k, v]) => [Number(k), v]));
  }
  const result = pickIssues(input);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
