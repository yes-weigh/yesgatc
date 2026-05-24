/**
 * Generate favicon + PWA install icons from the YES LAB logo.
 * Run: npm run icons
 */
import sharp from 'sharp';
import { mkdir, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const source = join(root, 'public', 'dark logo.png');
const brandDir = join(root, 'public', 'brand');
const iconsDir = join(root, 'public', 'icons');

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

async function renderSquareIcon(size, paddingRatio = 0.08) {
  const padding = Math.round(size * paddingRatio);
  const inner = size - padding * 2;

  const resized = await sharp(source)
    .ensureAlpha()
    .resize(inner, inner, { fit: 'contain', background: TRANSPARENT })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: TRANSPARENT,
    },
  })
    .composite([{ input: resized, gravity: 'centre' }])
    .png()
    .toBuffer();
}

async function run() {
  await mkdir(brandDir, { recursive: true });
  await mkdir(iconsDir, { recursive: true });

  await copyFile(source, join(brandDir, 'logo-dark.png'));

  const outputs = [
    { file: 'favicon-16.png', size: 16, padding: 0.06 },
    { file: 'favicon-32.png', size: 32, padding: 0.08 },
    { file: 'apple-touch-icon.png', size: 180, padding: 0.1 },
    { file: 'icon-192.png', size: 192, padding: 0.1 },
    { file: 'icon-512.png', size: 512, padding: 0.1 },
    { file: 'icon-512-maskable.png', size: 512, padding: 0.18 },
  ];

  for (const { file, size, padding } of outputs) {
    const buffer = await renderSquareIcon(size, padding);
    await sharp(buffer).png().toFile(join(iconsDir, file));
    console.log(`  wrote public/icons/${file}`);
  }

  console.log('  wrote public/brand/logo-dark.png');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
