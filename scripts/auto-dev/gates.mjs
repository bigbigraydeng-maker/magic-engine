import { readFileSync } from 'node:fs';
import { argv } from 'node:process';

const LEDGER_CARD_RE = /^docs\/ledger\/.*-auto-dev-.*\.md$/;
const NEW_ROUTE_BASENAMES = ['route.ts', 'page.tsx', 'layout.tsx'];
const MAX_ADDED_LINES = 400;
const MAX_COST_USD = 0.5;

/**
 * @param {Map<string, string>} before
 * @param {Map<string, string>} after
 * @returns {Array<{filePath: string, status: 'added'|'modified'|'deleted'}>}
 */
export function diffByHash(before, after) {
  const b = before instanceof Map ? before : new Map();
  const a = after instanceof Map ? after : new Map();
  const changes = [];

  for (const [filePath, hash] of a) {
    if (!b.has(filePath)) {
      changes.push({ filePath, status: 'added' });
    } else if (b.get(filePath) !== hash) {
      changes.push({ filePath, status: 'modified' });
    }
  }

  for (const filePath of b.keys()) {
    if (!a.has(filePath)) {
      changes.push({ filePath, status: 'deleted' });
    }
  }

  changes.sort((x, y) => x.filePath < y.filePath ? -1 : x.filePath > y.filePath ? 1 : 0);
  return changes;
}

/**
 * @param {Array<{filePath: string, status: string}>} changes
 * @param {string[]} allowedFiles
 * @param {(filePath: string, status: string) => boolean} isInAllowlist
 * @returns {{pass: boolean, reason?: string}}
 */
export function gateAllowedFiles(changes, allowedFiles, isInAllowlist) {
  const list = Array.isArray(allowedFiles) ? allowedFiles : [];
  const check = typeof isInAllowlist === 'function' ? isInAllowlist : () => false;

  for (const change of changes || []) {
    const { filePath, status } = change;
    if (!check(filePath, status)) {
      return { pass: false, reason: `file not allowed: ${filePath}` };
    }
    if (status !== 'added' && !list.includes(filePath) && !LEDGER_CARD_RE.test(filePath)) {
      return { pass: false, reason: `file not allowed: ${filePath}` };
    }
  }

  return { pass: true };
}

/**
 * @param {Array<{filePath: string, status: string}>} changes
 * @param {(opts: {files: Array<{filename: string, status: string}>}) => {risk: string}} classifyRisk
 * @returns {{pass: boolean, reason?: string}}
 */
export function gateRiskLevel(changes, classifyRisk) {
  const classify = typeof classifyRisk === 'function' ? classifyRisk : () => ({ risk: 'A' });

  for (const change of changes || []) {
    const { filePath, status } = change;
    const result = classify({ files: [{ filename: filePath, status }] }) || {};
    if (result.risk !== 'B' && result.risk !== 'C') {
      return { pass: false, reason: `A-level file: ${filePath}` };
    }
  }

  return { pass: true };
}

/**
 * @param {Array<{filePath: string, status: string}>} changes
 * @param {number} totalAddedLines
 * @returns {{pass: boolean, reason?: string}}
 */
export function gateLineCount(changes, totalAddedLines) {
  if (typeof totalAddedLines !== 'number' || totalAddedLines > MAX_ADDED_LINES) {
    return { pass: false, reason: `added lines ${totalAddedLines} exceeds ${MAX_ADDED_LINES}` };
  }

  for (const change of changes || []) {
    const { filePath, status } = change;
    if (status !== 'added') continue;
    const base = basename(filePath);
    if (NEW_ROUTE_BASENAMES.includes(base)) {
      return { pass: false, reason: `new route/page/layout: ${filePath}` };
    }
  }

  return { pass: true };
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function basename(filePath) {
  const parts = String(filePath).split('/');
  return parts[parts.length - 1];
}

const FORCED_CAST_LABEL = ['as', 'unknown', 'as'].join(' ');

/** @type {Array<{pattern: string|RegExp, label: string}>} */
export const CONTENT_BANS = [
  { pattern: 'process.env', label: 'process.env' },
  { pattern: 'fetch(', label: 'fetch(' },
  { pattern: 'axios', label: 'axios' },
  { pattern: 'http.request', label: 'http.request' },
  { pattern: 'http.get', label: 'http.get' },
  { pattern: 'https.request', label: 'https.request' },
  { pattern: 'https.get', label: 'https.get' },
  { pattern: 'child_process', label: 'child_process' },
  { pattern: 'execSync', label: 'execSync' },
  { pattern: 'writeFileSync', label: 'writeFileSync' },
  { pattern: /\bexec\s*\(/, label: 'exec(' },
  { pattern: /\bspawn\s*\(/, label: 'spawn(' },
  { pattern: 'fs.write', label: 'fs.write' },
  { pattern: '.insert(', label: '.insert(' },
  { pattern: '.update(', label: '.update(' },
  { pattern: '.upsert(', label: '.upsert(' },
  { pattern: '.delete(', label: '.delete(' },
  { pattern: '.rpc(', label: '.rpc(' },
  { pattern: '@ts-ignore', label: '@ts-ignore' },
  { pattern: '@ts-nocheck', label: '@ts-nocheck' },
  { pattern: /\bas\s+unknown\s+as\b/, label: FORCED_CAST_LABEL },
  { pattern: /:\s*any\b/, label: 'typescript any' },
  { pattern: /\bas\s+any\b/, label: 'as any' },
  { pattern: /\bfetch\s+\(/, label: 'fetch (' },
];

/**
 * @param {string} text
 * @param {string|RegExp} pattern
 * @returns {boolean}
 */
function matchesBan(text, pattern) {
  if (pattern instanceof RegExp) return pattern.test(text);
  return text.includes(pattern);
}

/**
 * @param {string[]} addedLines
 * @returns {{pass: boolean, reason?: string, line?: string}}
 */
export function gateContentBans(addedLines) {
  for (const line of addedLines || []) {
    const text = typeof line === 'string' ? line : String(line);
    for (const ban of CONTENT_BANS) {
      if (matchesBan(text, ban.pattern)) {
        return {
          pass: false,
          reason: `content ban: ${ban.label}`,
          line: text.trim().slice(0, 120),
        };
      }
    }
  }
  return { pass: true };
}

/**
 * @param {string[]} verifyCommands
 * @param {string[]} allowedFiles
 * @param {(cmd: string, files: string[]) => {valid: boolean, reason?: string}} validateVerifyCommand
 * @returns {{pass: boolean, reason?: string}}
 */
export function gateVerifyCommands(verifyCommands, allowedFiles, validateVerifyCommand) {
  if (!Array.isArray(verifyCommands) || verifyCommands.length === 0) {
    return { pass: false, reason: 'no verify commands' };
  }
  const validate = typeof validateVerifyCommand === 'function'
    ? validateVerifyCommand
    : () => ({ valid: false, reason: 'no validator' });

  for (const cmd of verifyCommands) {
    const result = validate(cmd, allowedFiles);
    if (!result.valid) {
      return { pass: false, reason: `verify command rejected: ${result.reason || 'unknown'}` };
    }
  }
  return { pass: true };
}

/**
 * @param {number} costUsd
 * @returns {{pass: boolean, reason?: string}}
 */
export function gateCostCap(costUsd) {
  if (typeof costUsd !== 'number' || !Number.isFinite(costUsd) || costUsd < 0) {
    return { pass: false, reason: 'cost unknown or negative' };
  }
  if (costUsd > MAX_COST_USD) {
    return { pass: false, reason: `DeepSeek cost $${costUsd.toFixed(2)} exceeds $${MAX_COST_USD.toFixed(2)}` };
  }
  return { pass: true };
}

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\beyJ[A-Za-z0-9+/=_-]{20,}\b/,
  /\bxox[bp]-[A-Za-z0-9_-]{10,}\b/,
  /\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/,
  /\bsbp_[A-Za-z0-9]{20,}\b/,
];

const HEX_40 = /^[0-9a-f]{40}$/;
const HEX_64 = /^[0-9a-f]{64}$/;
const LONG_RANDOM_RE = /[A-Za-z0-9_-]{40,}/g;

/**
 * @param {string[]} texts
 * @returns {{pass: boolean, reason?: string}}
 */
export function gateSecretScan(texts) {
  for (const text of texts || []) {
    const str = typeof text === 'string' ? text : String(text);
    for (const re of SECRET_PATTERNS) {
      if (re.test(str)) {
        return { pass: false, reason: 'possible secret detected' };
      }
    }
    for (const m of str.matchAll(LONG_RANDOM_RE)) {
      const token = m[0];
      if (!HEX_40.test(token) && !HEX_64.test(token)) {
        return { pass: false, reason: 'possible secret detected' };
      }
    }
  }
  return { pass: true };
}

/**
 * @param {object} input
 * @returns {{pass: boolean, failedGate?: string, reason?: string}}
 */
export function runAllGates(input) {
  const changes = diffByHash(input.hashBefore, input.hashAfter);

  const gates = [
    { name: 'allowedFiles', fn: () => gateAllowedFiles(changes, input.allowedFiles, input.isInAllowlist) },
    { name: 'riskLevel', fn: () => gateRiskLevel(changes, input.classifyRisk) },
    { name: 'lineCount', fn: () => gateLineCount(changes, input.totalAddedLines) },
    { name: 'contentBans', fn: () => gateContentBans(input.addedLines) },
    { name: 'verifyCommands', fn: () => gateVerifyCommands(input.verifyCommands, input.allowedFiles, input.validateVerifyCommand) },
    { name: 'costCap', fn: () => gateCostCap(input.costUsd) },
    { name: 'secretScan', fn: () => gateSecretScan(input.outboundTexts) },
  ];

  for (const gate of gates) {
    const result = gate.fn();
    if (!result.pass) {
      return { pass: false, failedGate: gate.name, reason: result.reason };
    }
  }

  return { pass: true };
}

// ── CLI entry point: node gates.mjs <input.json> ──
if (argv[1] && argv[1].endsWith('gates.mjs') && argv[2]) {
  const raw = readFileSync(argv[2], 'utf8');
  const input = JSON.parse(raw);
  const result = runAllGates(input);
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exit(result.pass ? 0 : 1);
}
