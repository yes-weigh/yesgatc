import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = join(import.meta.dirname, '..');
const androidDir = join(root, 'android');
const sdkDir = process.env.ANDROID_HOME
  || process.env.ANDROID_SDK_ROOT
  || join(homedir(), 'Library/Android/sdk');
const jdkDir = join(root, '.jdk/temurin-21');
const artifactsDir = join(root, 'artifacts');

const javaCandidates = [
  process.env.JAVA_HOME,
  join(jdkDir, 'Contents/Home'),
  '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
  '/opt/homebrew/opt/openjdk@21',
  '/opt/homebrew/opt/openjdk',
].filter(Boolean);

function findJavaHome(base) {
  if (!base) return '';
  const direct = join(base, 'bin/java');
  if (existsSync(direct)) return base;
  return '';
}

function resolveJavaHome() {
  for (const home of javaCandidates) {
    const resolved = findJavaHome(home);
    if (resolved) return resolved;
  }
  return '';
}

function run(command, args, extraEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: androidDir,
      stdio: 'inherit',
      env: { ...process.env, ...extraEnv },
    });
    child.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code}`));
    });
  });
}

async function downloadJdk() {
  mkdirSync(join(root, '.jdk'), { recursive: true });
  const archive = join(root, '.jdk/temurin-21.tar.gz');
  const url =
    'https://api.adoptium.net/v3/binary/latest/21/ga/mac/aarch64/jdk/hotspot/normal/eclipse?project=jdk';
  console.log('Downloading Temurin JDK 21…');
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`JDK download failed (${response.status})`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
  if (existsSync(jdkDir)) rmSync(jdkDir, { recursive: true, force: true });
  mkdirSync(jdkDir, { recursive: true });
  const extract = spawnSync('tar', ['-xzf', archive, '-C', jdkDir, '--strip-components=1'], {
    stdio: 'inherit',
  });
  if (extract.status !== 0) throw new Error('Failed to extract JDK');
}

async function ensureJavaHome() {
  const existing = resolveJavaHome();
  if (existing) return existing;
  await downloadJdk();
  const extracted = findJavaHome(join(jdkDir, 'Contents/Home')) || findJavaHome(jdkDir);
  if (!extracted) throw new Error('JDK extracted but bin/java missing');
  return extracted;
}

if (!existsSync(androidDir)) {
  console.error('android/ missing. Run: pnpm android:sync');
  process.exit(1);
}

if (!existsSync(sdkDir)) {
  console.error(`Android SDK not found at ${sdkDir}. Install Android Studio / SDK, then retry.`);
  process.exit(1);
}

if (!existsSync(join(androidDir, 'gradlew'))) {
  console.error('android/gradlew missing.');
  process.exit(1);
}

const javaHome = await ensureJavaHome();
writeFileSync(join(androidDir, 'local.properties'), `sdk.dir=${sdkDir.replace(/\\/g, '\\\\')}\n`);

const env = {
  ANDROID_HOME: sdkDir,
  ANDROID_SDK_ROOT: sdkDir,
  JAVA_HOME: javaHome,
  PATH: `${join(javaHome, 'bin')}:${process.env.PATH ?? ''}`,
};

await run('./gradlew', ['assembleDebug'], env);

const apk = join(androidDir, 'app/build/outputs/apk/debug/app-debug.apk');
mkdirSync(artifactsDir, { recursive: true });
const dest = join(artifactsDir, 'YES-LAB-debug.apk');
if (existsSync(apk)) {
  copyFileSync(apk, dest);
  console.log(`\nAPK: ${dest}`);
} else {
  console.log('\nGradle finished but APK path missing.');
}
