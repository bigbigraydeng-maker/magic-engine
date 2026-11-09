import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  syncEnvFromRender,
  readEnvValue,
  DEFAULT_RENDER_SERVICE_ID,
  DEFAULT_PREFIXES,
  assertSafePrefixes,
} from '../src/lib/dev-env/sync-env';

/** Parsed command-line options. */
interface CliOptions {
  dryRun: boolean;
  serviceId: string;
  prefixes: readonly string[];
  envFile: string | null;
  verify: boolean;
}

/** Print a message to stderr. */
function printErr(message: string): void {
  process.stderr.write(`${message}\n`);
}

/** Parse argv (excluding node and script path) into options. */
function parseArgs(argv: string[]): CliOptions {
  let dryRun = false;
  let serviceId = DEFAULT_RENDER_SERVICE_ID;
  let envFile: string | null = null;
  let prefixes: string[] | null = null;
  let verify = true;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--no-verify') {
      verify = false;
      continue;
    }
    if (arg === '--service') {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error('--service requires a value');
      }
      serviceId = value;
      i++;
      continue;
    }
    if (arg === '--prefix') {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error('--prefix requires a value');
      }
      if (prefixes === null) {
        prefixes = [];
      }
      prefixes.push(value);
      i++;
      continue;
    }
    if (arg === '--env-file') {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error('--env-file requires a value');
      }
      envFile = value;
      i++;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return {
    dryRun,
    serviceId,
    prefixes: prefixes === null ? DEFAULT_PREFIXES : prefixes,
    envFile,
    verify,
  };
}

/**
 * Resolve the main repository's `.env.local` path from THIS script's location (not the caller's
 * working directory), and refuse anything that is not a normal `<root>/.git` layout.
 */
function resolveDefaultEnvFile(): string {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const commonDirRaw = execFileSync('git', ['rev-parse', '--git-common-dir'], {
    cwd: scriptDir,
    encoding: 'utf8',
  }).trim();
  const commonDir = resolve(scriptDir, commonDirRaw);
  if (basename(commonDir) !== '.git') {
    throw new Error('unexpected repository layout; pass --env-file explicitly');
  }
  return join(dirname(commonDir), '.env.local');
}

/** Read a file as UTF-8, returning null when it cannot be read. */
function tryReadFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** Entry point. */
async function main(): Promise<void> {
  let opts: CliOptions;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    printErr(`sync failed: ${message}`);
    process.exitCode = 1;
    return;
  }

  let envFile: string;
  try {
    envFile = opts.envFile ?? resolveDefaultEnvFile();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    printErr(`sync failed: ${message}`);
    process.exitCode = 1;
    return;
  }

  const envContents = tryReadFile(envFile);

  let apiKey = process.env.RENDER_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) {
    const fromFile =
      envContents === null ? null : readEnvValue(envContents, 'RENDER_API_KEY');
    if (fromFile === null) {
      printErr(
        'RENDER_API_KEY not found (set it in the environment or in .env.local)',
      );
      process.exitCode = 2;
      return;
    }
    apiKey = fromFile;
  }

  try {
    const report = await syncEnvFromRender({
      envFile,
      serviceId: opts.serviceId,
      apiKey,
      prefixes: opts.prefixes,
      dryRun: opts.dryRun,
      verify: opts.verify,
    });

    let anyInvalid = false;
    for (const entry of report.entries) {
      const verdict = entry.verdict === undefined ? '' : ` (token ${entry.verdict})`;
      if (entry.verdict !== undefined && entry.verdict.startsWith('invalid')) anyInvalid = true;
      process.stdout.write(`  ${entry.key}: ${entry.status}${verdict}\n`);
    }
    for (const key of report.skipped) {
      process.stdout.write(`  ${key}: skipped (value is not a plain single line)\n`);
    }
    for (const key of report.shellOverrides) {
      process.stdout.write(`  warning: your shell environment sets ${key} to a different value and will shadow the file\n`);
    }

    let added = 0;
    let updated = 0;
    let unchanged = 0;
    for (const entry of report.entries) {
      if (entry.status === 'added') added++;
      else if (entry.status === 'updated') updated++;
      else unchanged++;
    }

    process.stdout.write(
      `done: ${added} added, ${updated} updated, ${unchanged} unchanged\n`,
    );

    if (report.backupPath !== null) {
      process.stdout.write(`backup: ${report.backupPath}\n`);
    }

    if (report.dryRun) {
      process.stdout.write('(dry run: nothing written)\n');
    }
    if (anyInvalid) {
      // The production copy itself is dead: syncing cannot fix that.
      printErr('some synced tokens are rejected by Meta: regenerate them in Meta Business settings and update Render');
      process.exitCode = 3;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    printErr(`sync failed: ${message}`);
    process.exitCode = 1;
  }
}

void main();
