import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const root = join(import.meta.dirname, '..');
const androidDir = join(root, 'android');
const manifestPath = join(androidDir, 'app/src/main/AndroidManifest.xml');
const iconSource = join(root, 'resources/icon.png');
const fallbackIcon = join(root, 'public/icons/icon-1024.png');

const PERMISSIONS = [
  'android.permission.CAMERA',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_EXTERNAL_STORAGE',
];

const FEATURES = [
  { name: 'android.hardware.camera', required: false },
  { name: 'android.hardware.camera.autofocus', required: false },
];

const LAUNCHER_SIZES = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};

function insertOnce(xml, snippet) {
  if (xml.includes(snippet.trim())) return xml;
  return xml.replace(
    /<manifest\b[^>]*>/,
    match => `${match}\n    ${snippet.trim()}`,
  );
}

function patchManifest(xml) {
  let next = xml;
  for (const permission of PERMISSIONS) {
    const tag =
      permission === 'android.permission.READ_EXTERNAL_STORAGE'
        ? `<uses-permission android:name="${permission}" android:maxSdkVersion="32" />`
        : `<uses-permission android:name="${permission}" />`;
    if (!next.includes(`android:name="${permission}"`)) {
      next = insertOnce(next, tag);
    }
  }
  for (const feature of FEATURES) {
    const tag = `<uses-feature android:name="${feature.name}" android:required="${feature.required}" />`;
    if (!next.includes(`android:name="${feature.name}"`)) {
      next = insertOnce(next, tag);
    }
  }
  return next;
}

async function writeLauncherIcons() {
  const sourcePath = existsSync(iconSource) ? iconSource : fallbackIcon;
  if (!existsSync(sourcePath)) return;
  const resDir = join(androidDir, 'app/src/main/res');
  for (const [folder, size] of Object.entries(LAUNCHER_SIZES)) {
    const dir = join(resDir, folder);
    mkdirSync(dir, { recursive: true });
    const png = await sharp(sourcePath)
      .resize(size, size, { fit: 'cover' })
      .png()
      .toBuffer();
    writeFileSync(join(dir, 'ic_launcher.png'), png);
    writeFileSync(join(dir, 'ic_launcher_round.png'), png);
    writeFileSync(join(dir, 'ic_launcher_foreground.png'), png);
  }
}

if (!existsSync(manifestPath)) {
  console.error('AndroidManifest.xml missing. Run npx cap add android first.');
  process.exit(1);
}

const patched = patchManifest(readFileSync(manifestPath, 'utf8'));
writeFileSync(manifestPath, patched);

const stringsPath = join(androidDir, 'app/src/main/res/values/strings.xml');
if (existsSync(stringsPath)) {
  const strings = readFileSync(stringsPath, 'utf8').replace(
    /<string name="app_name">[^<]*<\/string>/,
    '<string name="app_name">YES LAB</string>',
  );
  writeFileSync(stringsPath, strings);
}

await writeLauncherIcons();

const colorPath = join(androidDir, 'app/src/main/res/values/ic_launcher_background.xml');
if (existsSync(colorPath)) {
  writeFileSync(
    colorPath,
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#1A7F37</color>
</resources>
`,
  );
}

const appVersionPath = join(root, 'src/lib/appVersion.ts');
const appGradlePath = join(androidDir, 'app/build.gradle');
if (existsSync(appVersionPath) && existsSync(appGradlePath)) {
  const versionMatch = readFileSync(appVersionPath, 'utf8').match(/APP_VERSION = 'V(\d+)\.(\d+)'/);
  if (versionMatch) {
    const versionName = `${versionMatch[1]}.${versionMatch[2]}`;
    const versionCode = Number(versionMatch[1]) * 100 + Number(versionMatch[2]);
    const gradle = readFileSync(appGradlePath, 'utf8')
      .replace(/versionCode \d+/, `versionCode ${versionCode}`)
      .replace(/versionName "[^"]+"/, `versionName "${versionName}"`);
    writeFileSync(appGradlePath, gradle);
  }
}

const gitignorePath = join(androidDir, '.gitignore');
if (existsSync(gitignorePath)) {
  const gitignore = readFileSync(gitignorePath, 'utf8');
  if (!gitignore.includes('local.properties')) {
    writeFileSync(gitignorePath, `${gitignore.trimEnd()}\nlocal.properties\n`);
  }
}

console.log('Patched Android permissions, label, and launcher icons.');
