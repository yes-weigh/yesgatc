import fs from 'fs';
import path from 'path';

const root = path.resolve(import.meta.dirname, '..');

function extractPaths(svg) {
  const paths = [];
  const re = /<path\s+fill="([^"]+)"[^>]*?\sd="([\s\S]*?)"\s*\/>/gi;
  let match = re.exec(svg);
  while (match) {
    paths.push({
      fill: match[1].toLowerCase(),
      d: match[2].replace(/\s+/g, ' ').trim(),
    });
    match = re.exec(svg);
  }
  return paths;
}

function isArtifact(d) {
  if (d.length < 55) return true;
  if (/^m[\d.]+ [\d.]+ [hv][\d.]+ [hv]-?[\d.]+ z$/i.test(d)) return true;
  return false;
}

function compactPath(d) {
  return d.replace(/-?\d*\.?\d+(?:e[+-]?\d+)?/gi, n => {
    const v = Number(n);
    if (!Number.isFinite(v)) return n;
    const r = Math.round(v * 100) / 100;
    return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/\.?0+$/, '');
  });
}

function readViewBox(svg) {
  const match = svg.match(/viewBox="([^"]+)"/i);
  if (!match) return '0 0 143 125';
  const [minX, minY, width, height] = match[1].trim().split(/\s+/).map(Number);
  const pad = 1;
  return [
    minX + pad,
    minY + pad,
    Math.max(1, width - pad * 2),
    Math.max(1, height - pad * 2),
  ]
    .map(v => Math.round(v * 10) / 10)
    .join(' ');
}

function polish(svg) {
  const paths = extractPaths(svg).filter(({ d }) => !isArtifact(d));
  const merged = new Map();

  for (const { fill, d } of paths) {
    if (!merged.has(fill)) merged.set(fill, []);
    merged.get(fill).push(compactPath(d));
  }

  const viewBox = readViewBox(svg);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-hidden="true">`,
    ...[...merged.entries()].map(
      ([fill, ds]) => `<path fill="${fill}" d="${ds.join(' ')}"/>`,
    ),
    '</svg>',
  ].join('');
}

const sources = [
  path.join(root, 'public', 'vehicle', 'vehicle-logo.raw.svg'),
  path.join(root, 'Untitled.svg'),
];

const inputPath = sources.find(p => fs.existsSync(p));
if (!inputPath) {
  throw new Error('No vehicle logo source SVG found.');
}

const outputPath = path.join(root, 'public', 'vehicle', 'vehicle-logo.svg');
const polished = polish(fs.readFileSync(inputPath, 'utf8'));
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, polished);

const rawPaths = extractPaths(fs.readFileSync(inputPath, 'utf8'));
const keptPaths = extractPaths(polished);

console.log(
  JSON.stringify({
    source: path.basename(inputPath),
    inputPaths: rawPaths.length,
    keptPaths: keptPaths.length,
    outputBytes: polished.length,
  }),
);
