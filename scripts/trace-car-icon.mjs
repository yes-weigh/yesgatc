import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { PNG } from 'pngjs';
import ImageTracer from 'imagetracerjs';

const root = path.resolve(import.meta.dirname, '..');
const input = path.resolve(root, process.argv[2] ?? 'image.png');
const output = path.resolve(root, process.argv[3] ?? 'public/vehicle/vehicle-logo.svg');

const png = PNG.sync.read(fs.readFileSync(input));
const imageData = {
  width: png.width,
  height: png.height,
  data: new Uint8ClampedArray(png.data),
};

const traced = ImageTracer.imagedataToSVG(imageData, {
  ltres: 0.5,
  qtres: 0.5,
  pathomit: 4,
  rightangleenhance: true,
  linefilter: true,
  scale: 1,
  roundcoords: 1,
  viewbox: true,
  desc: false,
  numberofcolors: 2,
  mincolorratio: 0,
  colorquantcycles: 1,
  strokewidth: 0,
  blurradius: 0,
  blurdelta: 0,
});

function pickMainPath(svg) {
  const paths = [...svg.matchAll(/<path[^>]*\sd="([^"]+)"[^>]*>/gi)].map(m => {
    const tag = m[0];
    const fill = tag.match(/fill="([^"]+)"/i)?.[1] ?? '';
    const opacity = Number(tag.match(/opacity="([^"]+)"/i)?.[1] ?? 1);
    return { d: m[1], fill, opacity, len: m[1].length };
  });

  const visible = paths.filter(
    p =>
      p.opacity > 0 &&
      p.fill &&
      !/^none$/i.test(p.fill) &&
      !/^rgb\(0,\s*0,\s*0\)$/i.test(p.fill) &&
      !/^#000000$/i.test(p.fill),
  );

  const best = visible.sort((a, b) => b.len - a.len)[0];
  if (!best) throw new Error('No visible path found in trace output.');
  return best.d;
}

function trimArtifacts(d) {
  let trimmed = d.replace(/zm?-\d[\s\S]*$/i, '').trim();
  const parts = trimmed.split(/\s+(?=M\s)/i);
  const kept = parts.filter((part, index) => {
    if (index === 0) return true;
    const body = part.replace(/^M\s*/i, '').replace(/\s*z\s*$/i, '').trim();
    return body.length > 36;
  });
  trimmed = kept.join(' ').trim();
  return trimmed.endsWith('z') || trimmed.endsWith('Z') ? trimmed : `${trimmed}z`;
}

const d = trimArtifacts(pickMainPath(traced));
const polished = [
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${png.width} ${png.height}" role="img" aria-hidden="true">`,
  `<path fill="currentColor" fill-rule="evenodd" d="${d}"/>`,
  `</svg>`,
].join('');

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, polished);
try {
  execSync(`npx --yes svgo "${output}" -o "${output}"`, { stdio: 'pipe' });
} catch {
  // SVGO optional; keep unoptimized output.
}

let finalSvg = fs.readFileSync(output, 'utf8');
const pathMatch = finalSvg.match(/d="([^"]+)"/i);
if (pathMatch) {
  const cleanedD = trimArtifacts(pathMatch[1]);
  finalSvg = finalSvg.replace(pathMatch[1], cleanedD);
  fs.writeFileSync(output, finalSvg);
}

fs.copyFileSync(input, path.join(path.dirname(output), 'vehicle-logo.png'));

console.log(
  JSON.stringify({
    input: path.basename(input),
    output: path.relative(root, output),
    bytes: polished.length,
  }),
);
