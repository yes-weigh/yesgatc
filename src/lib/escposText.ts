/** ESC/POS text command helpers (faster than raster for receipts). */

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const ALIGN_LEFT = 0;
const ALIGN_CENTER = 1;
const ALIGN_RIGHT = 2;

function toEscPosSafeText(text: string): string {
  return text
    .replace(/\u20b9/g, 'Rs.')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '?');
}

function encodeText(text: string): Uint8Array {
  const safe = toEscPosSafeText(text);
  const bytes = new Uint8Array(safe.length);
  for (let i = 0; i < safe.length; i += 1) {
    bytes[i] = safe.charCodeAt(i);
  }
  return bytes;
}

export class EscPosTextBuilder {
  private readonly chunks: Uint8Array[] = [];

  init(): this {
    return this.command([ESC, 0x40]);
  }

  align(mode: 'left' | 'center' | 'right'): this {
    const value = mode === 'center' ? ALIGN_CENTER : mode === 'right' ? ALIGN_RIGHT : ALIGN_LEFT;
    return this.command([ESC, 0x61, value]);
  }

  bold(enabled: boolean): this {
    return this.command([ESC, 0x45, enabled ? 1 : 0]);
  }

  /** Normal or double width/height. */
  textSize(mode: 'normal' | 'large'): this {
    return this.command([GS, 0x21, mode === 'large' ? 0x11 : 0x00]);
  }

  textLine(text: string): this {
    this.chunks.push(encodeText(text));
    this.chunks.push(new Uint8Array([LF]));
    return this;
  }

  blankLine(): this {
    this.chunks.push(new Uint8Array([LF]));
    return this;
  }

  feed(lines = 3): this {
    return this.command([ESC, 0x64, lines]);
  }

  build(): Uint8Array {
    const total = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  private command(bytes: number[]): this {
    this.chunks.push(Uint8Array.from(bytes));
    return this;
  }
}

export function repeatChar(char: string, count: number): string {
  return char.repeat(Math.max(0, count));
}

export function centerEscPosLine(text: string, width: number): string {
  const trimmed = toEscPosSafeText(text).trim();
  if (trimmed.length >= width) return trimmed.slice(0, width);
  const pad = Math.floor((width - trimmed.length) / 2);
  return `${repeatChar(' ', pad)}${trimmed}`;
}

export function leftRightEscPosLine(left: string, right: string, width: number): string {
  const leftText = toEscPosSafeText(left).trim();
  const rightText = toEscPosSafeText(right).trim();
  const gap = width - leftText.length - rightText.length;
  if (gap >= 1) return `${leftText}${repeatChar(' ', gap)}${rightText}`;
  return `${leftText.slice(0, Math.max(1, width - rightText.length - 1))} ${rightText}`;
}

export function labelValueEscPosLine(label: string, value: string, width: number): string {
  const prefix = `${toEscPosSafeText(label).trim()} : `;
  const valueText = toEscPosSafeText(value).trim();
  const gap = width - prefix.length - valueText.length;
  if (gap >= 0) {
    return `${prefix}${repeatChar(' ', gap)}${valueText}`;
  }
  const trimmedValue = valueText.slice(0, Math.max(1, width - prefix.length));
  return `${prefix}${trimmedValue}`;
}

export function wrapEscPosText(text: string, width: number): string[] {
  const words = toEscPosSafeText(text).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [''];

  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if (`${current} ${word}`.length <= width) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}
