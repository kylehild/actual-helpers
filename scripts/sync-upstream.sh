#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
if [[ -n $(git status --porcelain) ]]; then
  echo 'Start the upstream sync from a clean checkout.' >&2
  exit 1
fi

if [[ $# -eq 0 ]]; then
  git fetch --no-tags https://github.com/psybers/actual-helpers.git refs/heads/main
  upstream=$(git rev-parse FETCH_HEAD)
elif [[ $# -eq 1 ]]; then
  upstream=$(git rev-parse --verify "$1^{commit}")
else
  echo 'Usage: bash scripts/sync-upstream.sh [upstream-commit]' >&2
  exit 1
fi

if git merge-base --is-ancestor "$upstream" HEAD; then
  echo 'Upstream is already merged.'
  exit 0
fi

base_version=$(node -p 'require("./package.json").version')
base_revision=$(node -p 'require("./package.json").imageRevision')
sync_script=$(mktemp)
git show HEAD:scripts/sync-actual-version.js > "$sync_script"

cleanup() {
  rm -f "$sync_script"
  if git rev-parse -q --verify MERGE_HEAD >/dev/null; then
    git merge --abort
  fi
}
trap cleanup EXIT

if ! git merge --no-ff --no-commit "$upstream"; then
  echo 'Upstream merge needs conflict resolution. No sync commit was created.' >&2
  exit 1
fi

if ! git diff --cached --quiet HEAD -- .github; then
  echo 'Upstream changed .github files. Review those changes separately.' >&2
  exit 1
fi

node "$sync_script"
node "$sync_script" --check
node - "$base_version" "$base_revision" <<'NODE'
const fs = require('node:fs');
const [baseVersion, baseRevision] = process.argv.slice(2);
const manifest = require('./package.json');
const previousRevision = Number(baseRevision);
if (!Number.isSafeInteger(previousRevision) || previousRevision < 1) {
  throw new Error('The current imageRevision must be a positive integer');
}
manifest.imageRevision = manifest.version === baseVersion ? previousRevision + 1 : 1;
fs.writeFileSync('package.json', JSON.stringify(manifest, null, 2) + '\n');
NODE

git add -- package.json package-lock.json
git commit -m "chore: sync upstream Actual helpers at ${upstream:0:12}"
