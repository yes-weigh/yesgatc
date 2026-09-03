#!/usr/bin/env node
/**
 * Decide whether to cut the next certificate-worker-vX.Y.Z patch tag.
 * Compares HEAD against the latest existing worker tag (fallback: --base).
 *
 * Output (stdout):
 *   skip=true
 *   skip=false tag=certificate-worker-v1.0.86
 */

import { execSync } from 'node:child_process';

function parseArgs() {
  const args = process.argv.slice(2);
  let base = 'HEAD~1';
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--base' && args[i + 1]) {
      base = args[i + 1];
      i += 1;
    }
  }
  return { base };
}

function gitRun(command) {
  return execSync(command, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function gitCommitExists(ref) {
  try {
    gitRun(`git rev-parse --verify ${ref}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/');
}

function isWorkerReleaseFile(filePath) {
  const file = normalizePath(filePath);
  if (!file.startsWith('certificate-worker/')) return false;
  if (file.endsWith('.md')) return false;
  return true;
}

function listWorkerTags() {
  try {
    return gitRun("git tag -l 'certificate-worker-v*' --sort=-v:refname")
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function parseWorkerTag(tag) {
  const match = tag.match(/^certificate-worker-v(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return {
    tag,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function nextPatchTag(tags) {
  const parsed = tags.map(parseWorkerTag).filter(Boolean);
  const latest = parsed[0] ?? { major: 1, minor: 0, patch: 0 };
  const existing = new Set(tags);
  let patch = latest.patch + 1;
  let next = `certificate-worker-v${latest.major}.${latest.minor}.${patch}`;
  while (existing.has(next)) {
    patch += 1;
    next = `certificate-worker-v${latest.major}.${latest.minor}.${patch}`;
  }
  return { from: parsed[0]?.tag ?? 'none', next };
}

function main() {
  const { base } = parseArgs();
  const tags = listWorkerTags();
  const latestTag = tags[0];
  const diffBase = latestTag && gitCommitExists(latestTag) ? latestTag : base;

  if (!gitCommitExists(diffBase) && diffBase !== latestTag) {
    console.log('skip=true');
    console.log(`reason=could not resolve worker diff base (${diffBase})`);
    return;
  }

  let files;
  try {
    files = gitRun(`git diff --name-only ${diffBase} HEAD -- certificate-worker/`)
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(normalizePath);
  } catch {
    console.log('skip=true');
    console.log('reason=could not diff certificate-worker/');
    return;
  }

  const relevant = files.filter(isWorkerReleaseFile);
  if (relevant.length === 0) {
    console.log('skip=true');
    console.log(`reason=no certificate-worker code changes since ${diffBase}`);
    return;
  }

  let tagsOnHead = [];
  try {
    tagsOnHead = gitRun('git tag --points-at HEAD')
      .split('\n')
      .map(line => line.trim())
      .filter(tag => tag.startsWith('certificate-worker-v'));
  } catch {
    tagsOnHead = [];
  }

  if (tagsOnHead.length > 0) {
    console.log('skip=true');
    console.log(`reason=HEAD already tagged ${tagsOnHead[0]}`);
    return;
  }

  const { from, next } = nextPatchTag(tags);
  console.log('skip=false');
  console.log(`tag=${next}`);
  console.log(`from=${from}`);
  console.log(`base=${diffBase}`);
  console.log(`files=${relevant.join(',')}`);
}

main();
