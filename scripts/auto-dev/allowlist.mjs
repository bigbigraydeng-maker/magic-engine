/**
 * v1 allowlist: only `src/lib/pm-todo/` source files (excluding `ledger-items.ts`).
 * New test files under `src/lib/pm-todo/__tests__/` are allowed to be CREATED (status 'added')
 * but existing test files must NOT be modified (status !== 'added').
 *
 * @param {string} filePath
 * @param {string} status - git status: 'added' | 'modified' | 'removed' | 'renamed' | 'copied'
 * @returns {boolean}
 */
export function isInAllowlist(filePath, status) {
  if (typeof filePath !== 'string' || filePath.length === 0) return false;

  // The lane's own ledger cards are always allowed.
  if (isAutoDevLedgerCard(filePath)) return true;

  if (!filePath.startsWith('src/lib/pm-todo/')) return false;

  if (isTestFile(filePath)) {
    return status === 'added';
  }

  if (filePath === 'src/lib/pm-todo/ledger-items.ts') return false;

  return isAllowedSourceExtension(filePath);
}

/**
 * @param {string} filePath
 * @returns {boolean}
 */
function isAutoDevLedgerCard(filePath) {
  return /^docs\/ledger\/.*-auto-dev-.*\.md$/.test(filePath);
}

/**
 * @param {string} filePath
 * @returns {boolean}
 */
function isTestFile(filePath) {
  return filePath.startsWith('src/lib/pm-todo/__tests__/');
}

/**
 * @param {string} filePath
 * @returns {boolean}
 */
function isAllowedSourceExtension(filePath) {
  return /\.(ts|tsx|mjs)$/.test(filePath);
}

/**
 * Keywords in the "验收" (acceptance criteria) section that indicate the task
 * requires production/external verification the lane cannot provide.
 */
export const PRODUCTION_KEYWORDS = [
  '生产', 'production', 'prod', '线上', 'live', 'deploy', '部署',
  '外部接口', 'external api', '客户网站', 'customer site',
  'supabase studio', '数据库直接',
];

/**
 * Referrer allowlist: files that are allowed to import changed pm-todo files.
 * Anything outside this + the pm-todo directory itself = referrer check fails.
 *
 * @param {string} referrerPath
 * @returns {boolean}
 */
export function isAllowedReferrer(referrerPath) {
  if (typeof referrerPath !== 'string' || referrerPath.length === 0) return false;
  if (referrerPath.startsWith('src/lib/pm-todo/')) return true;
  if (referrerPath.startsWith('src/app/api/cron/pm-')) return true;
  return false;
}

/**
 * Trusted authors who may open issues and label them for the auto-dev lane.
 * v1: only the PM's GitHub account.
 */
export const TRUSTED_AUTHORS = ['bigbigraydeng-maker'];

const VERIFY_COMMAND_RE = /^npm test -- (\S+)$/;
const VERIFY_PATH_RE = /^[A-Za-z0-9._/@-]+$/;
const TRUNK_TEST_RE = /^src\/lib\/pm-todo\/__tests__\/[^/]+\.test\.ts$/;

/**
 * Strict validation of verification commands.
 * v1 only allows: npm test -- <path>
 * where <path> must be a file listed in allowedFiles OR an existing test file on trunk,
 * must not start with `-`, must not contain `..`, and must only contain [A-Za-z0-9._/@-].
 *
 * @param {string} command
 * @param {string[]} allowedFiles - files listed in the issue's "允许改的文件" section
 * @returns {{valid: boolean, reason?: string}}
 */
export function validateVerifyCommand(command, allowedFiles) {
  if (typeof command !== 'string') {
    return { valid: false, reason: '命令不是字符串' };
  }

  const match = VERIFY_COMMAND_RE.exec(command);
  if (!match) {
    return { valid: false, reason: '命令格式必须是 npm test -- <path>' };
  }

  const path = match[1];
  if (!VERIFY_PATH_RE.test(path)) {
    return { valid: false, reason: '路径含非法字符' };
  }
  if (path.startsWith('-')) {
    return { valid: false, reason: '路径不能以 - 开头' };
  }
  if (path.includes('..')) {
    return { valid: false, reason: '路径不能包含 ..' };
  }

  const files = Array.isArray(allowedFiles) ? allowedFiles : [];
  if (files.includes(path) || TRUNK_TEST_RE.test(path)) {
    return { valid: true };
  }

  return { valid: false, reason: '路径不在允许改的文件或 trunk 测试文件中' };
}
