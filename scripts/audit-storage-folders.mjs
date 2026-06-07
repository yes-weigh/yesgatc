#!/usr/bin/env node
/**
 * Ensures every storageFolder used in the web app is documented in storage.rules
 * (siteCalibrations uses a wildcard; this script lists folders for review).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function extractStorageFolders(sourcePath, pattern) {
  const text = readFileSync(join(root, sourcePath), 'utf8');
  const folders = new Set();
  for (const match of text.matchAll(pattern)) {
    folders.add(match[1]);
  }
  return folders;
}

const verificationFolders = extractStorageFolders(
  'src/lib/verificationDeviceImages.ts',
  /storageFolder:\s*'([^']+)'/g,
);
const rvDocFolders = extractStorageFolders(
  'src/lib/verificationRvDeviceImages.ts',
  /storageFolder:\s*'([^']+)'/g,
);
const vctFolders = extractStorageFolders(
  'src/lib/vctDocumentUpload.ts',
  /:\s*'([^']+)'/g,
);
const vehicleFolders = new Set(['rc', 'insurance', 'pollution', 'f2-weight', 'photo']);

const siteCalibrationFolders = new Set([...verificationFolders, ...rvDocFolders]);
const rulesText = readFileSync(join(root, 'storage.rules'), 'utf8');

const errors = [];

if (!rulesText.includes('match /siteCalibrations/{recordId}/{folder}/{fileName}')) {
  errors.push('storage.rules must use a wildcard for siteCalibrations/{recordId}/{folder}/…');
}

if (!rulesText.includes('match /users/{userId}/{docKind}/{fileName}')) {
  errors.push('storage.rules must use a wildcard for users/{userId}/{docKind}/…');
}

if (!rulesText.includes('match /customers/{customerId}/{folder}/{fileName}')) {
  errors.push('storage.rules must use a wildcard for customers/{customerId}/{folder}/…');
}

console.log('Site calibration storage folders (covered by wildcard):');
for (const folder of [...siteCalibrationFolders].sort()) {
  console.log(`  - ${folder}`);
}

console.log('VCT user document folders (covered by users wildcard):');
for (const folder of [...vctFolders].sort()) {
  console.log(`  - ${folder}`);
}

console.log('Vehicle document folders (covered by vehicles wildcard):');
for (const folder of [...vehicleFolders].sort()) {
  console.log(`  - ${folder}`);
}

if (errors.length) {
  console.error('\nAudit failed:');
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  process.exit(1);
}

console.log('\nStorage folder audit passed.');
