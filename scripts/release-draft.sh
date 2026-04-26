#!/usr/bin/env bash
set -euo pipefail

version="${1:-}"

if [[ -z "$version" ]]; then
  echo "Usage: npm run release:draft -- <version>"
  echo "Example: npm run release:draft -- 1.2.0"
  exit 1
fi

npm_version="${version#v}"
tag_name="v${npm_version}"

if [[ ! "$npm_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Expected a stable semantic version like 1.2.0."
  exit 1
fi

current_branch="$(git branch --show-current)"
if [[ "$current_branch" != "main" ]]; then
  echo "Release draft creation must run from main. Current branch: ${current_branch}"
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree must be clean before preparing a release."
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI is required. Install gh and authenticate with: gh auth login"
  exit 1
fi

gh auth status --active >/dev/null

git fetch origin main --tags

if git rev-parse "${tag_name}" >/dev/null 2>&1; then
  echo "Tag ${tag_name} already exists."
  exit 1
fi

if gh release view "${tag_name}" >/dev/null 2>&1; then
  echo "GitHub Release ${tag_name} already exists."
  exit 1
fi

if [[ "$(git rev-parse main)" != "$(git rev-parse origin/main)" ]]; then
  echo "Local main must match origin/main before preparing a release."
  exit 1
fi

npm run typecheck
npm run lint
npm run test:run
npm run build

npm version "${npm_version}"
git push origin main --follow-tags

gh release create "${tag_name}" --title "${tag_name}" --generate-notes --draft --verify-tag

echo "Prepared ${tag_name}, pushed main plus tags, and created a draft GitHub Release."
echo "Wait for main CI to pass, review the draft release, then publish it from the GitHub UI."
