#!/usr/bin/env node
/**
 * Lists Cloud Functions affected by git changes under functions/.
 * CommonJS codebase: functions/index.js + sibling modules.
 *
 * Usage:
 *   node functions/scripts/changed-functions.mjs --base HEAD~1
 *
 * Output (stdout):
 *   skip=true
 *   skip=false deploy_all=true
 *   skip=false deploy_only=functions:a,functions:b,...
 */

import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = path.resolve(__dirname, '..');
const INDEX_PATH = path.join(FUNCTIONS_DIR, 'index.js');

const DEPLOY_ALL_FILES = new Set([
  'functions/package.json',
  'functions/package-lock.json',
]);

const IGNORE_FILES = [
  /^functions\/scripts\//,
  /^functions\/\.env/,
  /^functions\/[^/]+\.test\.js$/,
];

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

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/');
}

function gitRun(command) {
  return execSync(command, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function gitCommitExists(ref) {
  try {
    gitRun(`git rev-parse --verify ${ref}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

function ensureBaseAvailable(base) {
  if (gitCommitExists(base)) return base;
  try {
    gitRun(`git fetch --depth=1 origin ${base}`);
  } catch {
    // fall through
  }
  if (gitCommitExists(base)) return base;
  if (base !== 'HEAD~1' && gitCommitExists('HEAD~1')) return 'HEAD~1';
  return null;
}

function gitChangedFilesFromCommit() {
  try {
    const out = gitRun('git diff-tree --no-commit-id --name-only -r HEAD -- functions/');
    return out
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(normalizePath);
  } catch {
    return null;
  }
}

function gitChangedFiles(base) {
  const resolvedBase = ensureBaseAvailable(base);
  if (resolvedBase) {
    try {
      const out = gitRun(`git diff --name-only ${resolvedBase} HEAD -- functions/`);
      return {
        files: out.trim().split('\n').filter(Boolean).map(normalizePath),
        diffBase: resolvedBase,
      };
    } catch {
      // fall through
    }
  }

  const commitFiles = gitChangedFilesFromCommit();
  if (commitFiles !== null) {
    return { files: commitFiles, diffBase: 'HEAD' };
  }

  return null;
}

function gitChangedIndexLines(base, diffBase) {
  const resolvedBase = diffBase === 'HEAD'
    ? `${base}^`
    : (ensureBaseAvailable(base) ?? base);

  const diffCmd = diffBase === 'HEAD'
    ? 'git show -U0 HEAD -- functions/index.js'
    : `git diff -U0 ${resolvedBase} HEAD -- functions/index.js`;

  try {
    const out = gitRun(diffCmd);
    const lines = new Set();
    for (const hunk of out.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
      const start = Number(hunk[1]);
      const count = Number(hunk[2] ?? '1');
      for (let line = start; line < start + count; line += 1) {
        lines.add(line);
      }
    }
    return lines;
  } catch {
    return null;
  }
}

function lineNumberAt(content, index) {
  return content.slice(0, index).split('\n').length;
}

function listModuleFiles() {
  return readdirSync(FUNCTIONS_DIR).filter(
    name => name.endsWith('.js') && !name.endsWith('.test.js') && name !== 'index.js',
  );
}

function parseRequires(content) {
  const deps = new Set();
  for (const match of content.matchAll(/require\(['"]\.\/([^'"]+)['"]\)/g)) {
    let spec = match[1];
    if (spec.startsWith('scripts/')) continue;
    if (!spec.endsWith('.js')) spec = `${spec}.js`;
    deps.add(spec);
  }
  return [...deps];
}

function buildFileGraph() {
  const graph = { 'index.js': parseRequires(readFileSync(INDEX_PATH, 'utf8')) };
  for (const file of listModuleFiles()) {
    graph[file] = parseRequires(readFileSync(path.join(FUNCTIONS_DIR, file), 'utf8'));
  }
  return graph;
}

/** If file B changed, any file that requires B (transitively) is also affected. */
function expandAffectedFiles(changedFiles, graph) {
  const affected = new Set(changedFiles);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [file, deps] of Object.entries(graph)) {
      if (affected.has(file)) continue;
      if (deps.some(dep => affected.has(dep))) {
        affected.add(file);
        grew = true;
      }
    }
  }
  return affected;
}

function parseIndexSymbolToFile(content) {
  /** @type {Record<string, string>} */
  const symbolToFile = {};
  const re =
    /(?:const|let|var)\s+(?:\{([^}]+)\}|(\w+))\s*=\s*require\(['"]\.\/([^'"]+)['"]\)/g;
  for (const match of content.matchAll(re)) {
    let spec = match[3];
    if (!spec.endsWith('.js')) spec = `${spec}.js`;
    if (match[2]) {
      symbolToFile[match[2]] = spec;
      continue;
    }
    for (const part of match[1].split(',')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const asMatch = trimmed.match(/^(\w+)\s+as\s+(\w+)$/);
      if (asMatch) {
        symbolToFile[asMatch[2]] = spec;
      } else {
        symbolToFile[trimmed.split(/\s+/)[0]] = spec;
      }
    }
  }
  return symbolToFile;
}

function parseIndexExports(content) {
  const symbolToFile = parseIndexSymbolToFile(content);
  const re = /^exports\.(\w+)\s*=/gm;
  /** @type {{ name: string, start: number }[]} */
  const hits = [];
  let match = re.exec(content);
  while (match) {
    hits.push({ name: match[1], start: match.index });
    match = re.exec(content);
  }

  const exports = [];
  for (let i = 0; i < hits.length; i += 1) {
    const end = i + 1 < hits.length ? hits[i + 1].start : content.length;
    const body = content.slice(hits[i].start, end);
    const filesUsed = new Set();
    for (const [symbol, file] of Object.entries(symbolToFile)) {
      if (new RegExp(`\\b${symbol}\\b`).test(body)) {
        filesUsed.add(file);
      }
    }
    exports.push({
      name: hits[i].name,
      start: hits[i].start,
      end,
      body,
      startLine: lineNumberAt(content, hits[i].start),
      endLine: lineNumberAt(content, end),
      filesUsed,
    });
  }
  return exports;
}

function functionsForFileChanges(affectedFiles, exports) {
  const names = new Set();
  for (const exp of exports) {
    for (const file of exp.filesUsed) {
      if (affectedFiles.has(file)) {
        names.add(exp.name);
      }
    }
  }
  return names;
}

function functionsForIndexChanges(changedLines, exports) {
  const names = new Set();
  if (!changedLines || changedLines.size === 0) return names;
  for (const exp of exports) {
    for (const line of changedLines) {
      if (line >= exp.startLine && line <= exp.endLine) {
        names.add(exp.name);
        break;
      }
    }
  }
  return names;
}

function main() {
  const { base } = parseArgs();
  const diffResult = gitChangedFiles(base);

  if (diffResult === null) {
    console.log('skip=true');
    console.log('reason=could not determine functions changes (skipping deploy)');
    return;
  }

  const { files: changedFiles, diffBase } = diffResult;

  const relevant = changedFiles.filter(file => !IGNORE_FILES.some(re => re.test(file)));
  if (relevant.length === 0) {
    console.log('skip=true');
    console.log('reason=no relevant functions changes');
    return;
  }

  if (relevant.some(file => DEPLOY_ALL_FILES.has(file))) {
    console.log('skip=false');
    console.log('deploy_all=true');
    console.log(`reason=shared dependency changed (${relevant.join(', ')})`);
    return;
  }

  const unknown = relevant.filter(file => {
    if (file === 'functions/index.js') return false;
    if (file.startsWith('functions/') && file.endsWith('.js')) return false;
    return true;
  });
  if (unknown.length > 0) {
    console.log('skip=false');
    console.log('deploy_all=true');
    console.log(`reason=unmapped functions/ files changed (${unknown.join(', ')})`);
    return;
  }

  const indexContent = readFileSync(INDEX_PATH, 'utf8');
  const exports = parseIndexExports(indexContent);
  const graph = buildFileGraph();

  const changedModules = relevant
    .filter(file => file.startsWith('functions/') && file.endsWith('.js') && file !== 'functions/index.js')
    .map(file => file.slice('functions/'.length));

  const indexChanged = relevant.includes('functions/index.js');
  const affectedFiles = expandAffectedFiles(new Set(changedModules), graph);

  const names = new Set();

  if (changedModules.length > 0) {
    for (const name of functionsForFileChanges(affectedFiles, exports)) {
      names.add(name);
    }
    if (names.size === 0) {
      console.log('skip=false');
      console.log('deploy_all=true');
      console.log(`reason=changed modules not mapped to exports (${changedModules.join(', ')})`);
      return;
    }
  }

  if (indexChanged) {
    const changedLines = gitChangedIndexLines(base, diffBase);
    if (changedLines === null || changedLines.size === 0) {
      console.log('skip=false');
      console.log('deploy_all=true');
      console.log('reason=functions/index.js changed (full redeploy)');
      return;
    }

    const indexOnlyNames = functionsForIndexChanges(changedLines, exports);
    if (indexOnlyNames.size === 0 && changedModules.length === 0) {
      console.log('skip=false');
      console.log('deploy_all=true');
      console.log('reason=shared index.js code changed');
      return;
    }
    for (const name of indexOnlyNames) {
      names.add(name);
    }
  }

  if (names.size === 0) {
    console.log('skip=true');
    console.log('reason=no deployable function changes detected');
    return;
  }

  const deployOnly = [...names]
    .sort()
    .map(name => `functions:${name}`)
    .join(',');

  console.log('skip=false');
  console.log(`deploy_only=${deployOnly}`);
  console.log(`count=${names.size}`);
  console.log(`functions=${[...names].sort().join(',')}`);
}

main();
