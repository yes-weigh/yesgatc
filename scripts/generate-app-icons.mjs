/**
 * Generate favicon + PWA install icons from the YES LAB logo.
 * Run: npm run icons
 */
import sharp from 'sharp';
import { mkdir, copyFile, unlink, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const source = join(root, 'public', 'dark logo.png');
const brandDir = join(root, 'public', 'brand');
const iconsDir = join(root, 'public', 'icons');

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

/** Globe + checkmark only — square crop from the top of the trimmed logo. */
async function prepareIconSource() {
  const trimmedBuf = await sharp(source).ensureAlpha().trim({ threshold: 12 }).png().toBuffer();
  const meta = await sharp(trimmedBuf).metadata();
  const side = Math.round(meta.height * 0.68);
  const left = Math.max(0, Math.round((meta.width - side) / 2));

  return sharp(trimmedBuf)
    .extract({ left, top: 0, width: side, height: side })
    .png()
    .toBuffer();
}

async function renderIcon(iconSource, size, { paddingRatio = 0, fit = 'cover' }) {
  const padding = Math.round(size * paddingRatio);
  const inner = size - padding * 2;

  const resized = await sharp(iconSource)
    .resize(inner, inner, { fit, position: 'centre', background: TRANSPARENT })
    .png()
    .toBuffer();

  if (padding === 0) return resized;

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
  const iconSource = await prepareIconSource();

  const outputs = [
    { file: 'favicon-16.png', size: 16, padding: 0.06, fit: 'contain' },
    { file: 'favicon-32.png', size: 32, padding: 0.06, fit: 'contain' },
    { file: 'apple-touch-icon.png', size: 180, padding: 0.04, fit: 'cover' },
    { file: 'icon-192.png', size: 192, padding: 0.04, fit: 'cover' },
    { file: 'icon-512.png', size: 512, padding: 0.04, fit: 'cover' },
    { file: 'icon-512-maskable.png', size: 512, padding: 0.1, fit: 'contain' },
    { file: 'icon-1024.png', size: 1024, padding: 0.04, fit: 'cover' },
  ];

  for (const { file, size, padding, fit } of outputs) {
    const buffer = await renderIcon(iconSource, size, { paddingRatio: padding, fit });
    await sharp(buffer).png().toFile(join(iconsDir, file));
    console.log(`  wrote public/icons/${file}`);
  }

  for (const name of await readdir(iconsDir)) {
    if (name.startsWith('_test-')) {
      await unlink(join(iconsDir, name));
    }
  }

  console.log('  wrote public/brand/logo-dark.png');

  const resourcesDir = join(root, 'resources');
  await mkdir(resourcesDir, { recursive: true });
  const icon1024 = join(iconsDir, 'icon-1024.png');
  await copyFile(icon1024, join(resourcesDir, 'icon.png'));

  const splashSize = 2732;
  const splashLogo = await sharp(iconSource)
    .resize(920, 920, { fit: 'contain', background: TRANSPARENT })
    .png()
    .toBuffer();
  await sharp({
    create: {
      width: splashSize,
      height: splashSize,
      channels: 4,
      background: { r: 26, g: 127, b: 55, alpha: 1 },
    },
  })
    .composite([{ input: splashLogo, gravity: 'centre' }])
    .png()
    .toFile(join(resourcesDir, 'splash.png'));
  console.log('  wrote resources/icon.png');
  console.log('  wrote resources/splash.png');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
