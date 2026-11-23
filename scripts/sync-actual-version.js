#!/usr/bin/env node

const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const root = process.cwd();
const latestPath = `${root}/actual-latest.txt`;
const packagePath = `${root}/package.json`;
const lockPath = `${root}/package-lock.json`;
const checkOnly = process.argv.includes('--check');
const latest = fs.readFileSync(latestPath, 'utf8').trim();
const match = /^v(\d+\.\d+\.\d+)$/.exec(latest);

if (!match) {
  throw new Error(`Invalid Actual release in actual-latest.txt: ${latest}`);
}

const version = match[1];
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const lockJson = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
const aligned = packageJson.version === version
  && packageJson.dependencies['@actual-app/api'] === version
  && lockJson.version === packageJson.version
  && lockJson.packages['']?.version === version
  && lockJson.packages['']?.dependencies?.['@actual-app/api'] === version
  && lockJson.packages['node_modules/@actual-app/api']?.version === version;

if (checkOnly) {
  if (!aligned) {
    throw new Error(`package.json and package-lock.json must pin to Actual ${version}`);
  }
  process.exit(0);
}

if (!aligned) {
  packageJson.version = version;
  packageJson.dependencies['@actual-app/api'] = version;
  fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  const result = spawnSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: root,
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

const updatedLock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
if (updatedLock.version !== version
  || updatedLock.packages['']?.version !== version
  || updatedLock.packages['']?.dependencies?.['@actual-app/api'] !== version
  || updatedLock.packages['node_modules/@actual-app/api']?.version !== version) {
  throw new Error(`package-lock.json did not pin to Actual ${version}`);
}
