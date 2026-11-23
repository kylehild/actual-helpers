#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const DEFAULT_RETRY_DELAYS = '60,300,900';
const MAX_OUTPUT_TAIL = 16 * 1024;
const PERMANENT_PATTERNS = [
  /out-of-sync-migrations/i,
  /cannot be loaded with this version/i,
  /required settings .* not provided/i,
  /invalid password/i,
  /authentication failed/i,
  /unauthorized/i,
  /forbidden/i,
  /version mismatch/i,
];
const TRANSIENT_PATTERNS = [
  /network-failure/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ENETUNREACH/i,
  /ENOTFOUND/i,
  /ETIMEDOUT/i,
  /fetch failed/i,
  /socket hang up/i,
  /HTTP (408|425|429|500|502|503|504)\b/i,
  /service unavailable/i,
  /too many requests/i,
];

function versionsMatch(helperVersion, serverVersion) {
  return helperVersion.trim() === serverVersion.trim();
}

function classifyFailure(output) {
  if (PERMANENT_PATTERNS.some(pattern => pattern.test(output))) {
    return 'permanent';
  }
  if (TRANSIENT_PATTERNS.some(pattern => pattern.test(output))) {
    return 'transient';
  }
  return 'unknown';
}

function parseRetryDelays(value = DEFAULT_RETRY_DELAYS) {
  const delays = value.split(',').map(part => Number(part.trim()));
  const valid = delays.length <= 5
    && delays.every(delay => Number.isInteger(delay) && delay > 0 && delay <= 900)
    && delays.reduce((total, delay) => total + delay, 0) <= 1800;
  if (!valid) {
    throw new Error('Retry delays must be positive integers of at most 900 seconds with a total of at most 1800 seconds');
  }
  return delays;
}

function readApiVersion(appDir) {
  const packagePath = path.join(
    appDir,
    'node_modules',
    '@actual-app',
    'api',
    'package.json',
  );
  return JSON.parse(fs.readFileSync(packagePath, 'utf8')).version;
}

function appendTail(existing, chunk) {
  return (existing + chunk).slice(-MAX_OUTPUT_TAIL);
}

function log(event, fields = {}) {
  const details = Object.entries(fields)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(' ');
  console.log(`${new Date().toISOString()} actual-helper ${event}${details ? ` ${details}` : ''}`);
}

function writeTerminationSummary(summary) {
  const terminationPath = process.env.ACTUAL_HELPER_TERMINATION_PATH
    || '/dev/termination-log';
  try {
    fs.writeFileSync(terminationPath, `${summary}\n`, { encoding: 'utf8' });
  } catch (error) {
    log('termination-summary-write-failed', { error: error.message });
  }
}

function runScript(appDir, scriptName) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(appDir, scriptName)], {
      cwd: appDir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let outputTail = '';

    child.stdout.on('data', chunk => {
      process.stdout.write(chunk);
      outputTail = appendTail(outputTail, chunk.toString());
    });
    child.stderr.on('data', chunk => {
      process.stderr.write(chunk);
      outputTail = appendTail(outputTail, chunk.toString());
    });
    child.on('error', error => {
      outputTail = appendTail(outputTail, error.stack || error.message);
    });
    child.on('close', (code, signal) => {
      resolve({
        code: code ?? 1,
        outputTail,
        signal,
      });
    });
  });
}

function sleep(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

async function main() {
  const appDir = process.env.ACTUAL_HELPER_APP_DIR || '/usr/src/app';
  const scriptName = process.argv[2] || 'sync-banks.js';
  const serverVersion = process.env.ACTUAL_SERVER_VERSION || '';
  const helperVersion = readApiVersion(appDir);

  if (!serverVersion) {
    const summary = `step=${scriptName} classification=permanent reason=missing-ACTUAL_SERVER_VERSION helper_api=${helperVersion}`;
    log('preflight-failed', { script: scriptName, helperVersion, reason: 'missing-server-version' });
    writeTerminationSummary(summary);
    process.exit(64);
  }
  if (!versionsMatch(helperVersion, serverVersion)) {
    const summary = `step=${scriptName} classification=permanent reason=version-mismatch helper_api=${helperVersion} server=${serverVersion}`;
    log('preflight-failed', { script: scriptName, helperVersion, serverVersion });
    writeTerminationSummary(summary);
    process.exit(64);
  }

  const retryDelays = parseRetryDelays(
    process.env.ACTUAL_HELPER_RETRY_DELAYS || DEFAULT_RETRY_DELAYS,
  );
  const maxAttempts = retryDelays.length + 1;
  log('step-started', { script: scriptName, helperVersion, serverVersion, maxAttempts });

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await runScript(appDir, scriptName);
    if (result.code === 0) {
      log('step-succeeded', { script: scriptName, attempt });
      return;
    }

    const classification = classifyFailure(result.outputTail);
    const fields = {
      script: scriptName,
      attempt,
      classification,
      exitCode: result.code,
      signal: result.signal,
    };
    if (classification !== 'transient' || attempt === maxAttempts) {
      log('step-failed', fields);
      writeTerminationSummary(
        `step=${scriptName} classification=${classification} attempts=${attempt} exit_code=${result.code}`,
      );
      process.exit(classification === 'transient' ? 75 : 64);
    }

    const delay = retryDelays[attempt - 1];
    log('step-retrying', { ...fields, delaySeconds: delay });
    await sleep(delay);
  }
}

if (require.main === module) {
  main().catch(error => {
    log('wrapper-failed', { error: error.message });
    writeTerminationSummary(`classification=permanent reason=wrapper-error error=${JSON.stringify(error.message)}`);
    process.exit(64);
  });
}

module.exports = {
  classifyFailure,
  parseRetryDelays,
  versionsMatch,
};
