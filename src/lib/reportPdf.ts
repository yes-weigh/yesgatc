import { formatReportInr } from './reportRevenueShare';

export type ReportPdfRevenueRow = {
  dateLabel: string;
  qty: number;
  qtyUpto20: number;
  qtyAbove20: number;
  collected: number;
  interweighing: number;
  contractor: number;
  handling: number;
  rcShare: number;
};

export type ReportPdfDayRow = {
  dateLabel: string;
  verified: number;
  qtyUpto20: number;
  qtyAbove20: number;
};

type ReportPdfInput = {
  rcName: string;
  period: string;
} & (
  | {
      view: 'revenue_share';
      layout: 'admin' | 'rc';
      rows: ReportPdfRevenueRow[];
      totals: Omit<ReportPdfRevenueRow, 'dateLabel'>;
    }
  | {
      view: 'day_summary';
      rows: ReportPdfDayRow[];
      totals: { verified: number; qtyUpto20: number; qtyAbove20: number };
    }
);

/** ISO A4 portrait in PDF points. */
const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 28;

function pdfEscape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function ascii(text: string): string {
  return text
    .replace(/₹/g, 'Rs ')
    .replace(/·/g, '-')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function money(amount: number): string {
  return ascii(formatReportInr(amount));
}

function blankZero(value: number): string {
  return value > 0 ? String(value) : '-';
}

function courierWidth(text: string, size: number): number {
  return ascii(text).length * size * 0.6;
}

function textOp(x: number, y: number, size: number, font: 'F1' | 'F2', value: string): string {
  return `BT /${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${pdfEscape(ascii(value))}) Tj ET`;
}

function textRight(right: number, y: number, size: number, font: 'F2', value: string): string {
  return textOp(right - courierWidth(value, size), y, size, font, value);
}

function lineOp(x1: number, y: number, x2: number): string {
  return `0.5 w 0.82 0.84 0.86 RG ${x1.toFixed(2)} ${y.toFixed(2)} m ${x2.toFixed(2)} ${y.toFixed(2)} l S`;
}

function fillOp(r: number, g: number, b: number, x: number, y: number, w: number, h: number): string {
  return `${r} ${g} ${b} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`;
}

function colStops(weights: number[]): number[] {
  const inner = A4_W - MARGIN * 2;
  const sum = weights.reduce((a, b) => a + b, 0);
  const stops = [MARGIN];
  let x = MARGIN;
  for (let i = 0; i < weights.length; i += 1) {
    x += (weights[i] / sum) * inner;
    stops.push(x);
  }
  return stops;
}

function assemblePdf(pageStreams: string[]): Uint8Array {
  const objects: string[] = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  const pageIds = pageStreams.map((_, i) => 3 + i * 2);
  objects.push(
    `<< /Type /Pages /Count ${pageStreams.length} /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] >>`,
  );
  const font1 = 3 + pageStreams.length * 2;
  const font2 = font1 + 1;
  pageStreams.forEach(stream => {
    const pageObjIndex = objects.length + 1;
    const contentId = pageObjIndex + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_W} ${A4_H}] /Rotate 0 /Contents ${contentId} 0 R /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> >> >>`,
    );
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>');

  const encoder = new TextEncoder();
  const header = '%PDF-1.4\n';
  const chunks: Uint8Array[] = [encoder.encode(header)];
  const offsets = [0];
  let pos = header.length;
  objects.forEach((obj, i) => {
    offsets[i + 1] = pos;
    const body = encoder.encode(`${i + 1} 0 obj\n${obj}\nendobj\n`);
    chunks.push(body);
    pos += body.byteLength;
  });
  const xrefPos = pos;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  chunks.push(encoder.encode(xref), encoder.encode(trailer));
  const bytes = new Uint8Array(chunks.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of chunks) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

function fileSlug(value: string): string {
  return (
    value
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'report'
  );
}

export function buildReportPdf(input: ReportPdfInput): File {
  const left = MARGIN;
  const right = A4_W - MARGIN;
  const top = A4_H - 24;
  const rowH = 16;
  const footerH = 36;
  const headerH = 78;
  const rowsPerPage = Math.max(12, Math.floor((top - headerH - footerH) / rowH));
  const pageCount = Math.max(1, Math.ceil(input.rows.length / rowsPerPage));
  const viewLabel =
    input.view === 'revenue_share'
      ? input.layout === 'rc'
        ? 'Contractor fee'
        : 'Revenue share'
      : 'Day summary';
  const generated = new Date().toLocaleString('en-GB');
  const fs = 7.2;

  const pages = Array.from({ length: pageCount }, (_, pageIndex) => {
    const ops: string[] = [];
    ops.push(fillOp(1, 1, 1, 0, 0, A4_W, A4_H));
    ops.push(fillOp(0.96, 0.97, 0.98, 0, A4_H - 36, A4_W, 36));
    ops.push('0.06 0.09 0.16 rg');
    ops.push(textOp(left, A4_H - 22, 11, 'F1', 'eMaap  |  GATC report'));
    ops.push(textOp(right - 92, A4_H - 22, 8, 'F1', `Page ${pageIndex + 1} / ${pageCount}`));
    ops.push(textOp(left, top - 22, 13, 'F1', input.rcName));
    ops.push('0.29 0.33 0.39 rg');
    ops.push(textOp(left, top - 38, 9, 'F1', `${viewLabel}  |  ${input.period}`));
    ops.push(textOp(left, top - 52, 7.5, 'F1', `Generated ${generated}`));

    let y = top - headerH + 10;
    ops.push(fillOp(0.93, 0.95, 0.97, left, y - 3, right - left, 15));
    ops.push('0.15 0.23 0.37 rg');

    if (input.view === 'revenue_share') {
      const isRc = input.layout === 'rc';
      const showHandling = isRc && input.totals.handling > 0;
      const x = isRc
        ? showHandling
          ? colStops([0.07, 0.18, 0.1, 0.13, 0.13, 0.2, 0.19])
          : colStops([0.08, 0.22, 0.12, 0.16, 0.16, 0.26])
        : colStops([0.07, 0.15, 0.08, 0.1, 0.11, 0.17, 0.16, 0.16]);
      const heads = isRc
        ? showHandling
          ? ['#', 'Date', 'Qty', '<=20kg', '>20kg', 'Contractor', 'Handling']
          : ['#', 'Date', 'Qty', '<=20kg', '>20kg', 'Contractor']
        : ['#', 'Date', 'Qty', '<=20kg', '>20kg', 'Collected', 'IW', 'Contractor'];
      heads.forEach((label, i) => ops.push(textOp(x[i] + 2, y, 6.8, 'F1', label)));
      const slice = input.rows.slice(pageIndex * rowsPerPage, (pageIndex + 1) * rowsPerPage);
      slice.forEach((row, i) => {
        y -= rowH;
        if (i % 2 === 0) ops.push(fillOp(0.97, 0.98, 0.99, left, y - 3, right - left, rowH));
        ops.push('0.08 0.11 0.16 rg');
        const sl = pageIndex * rowsPerPage + i + 1;
        ops.push(textOp(x[0] + 2, y, fs, 'F2', String(sl)));
        ops.push(textOp(x[1] + 2, y, fs, 'F1', row.dateLabel));
        ops.push(textRight(x[3] - 3, y, fs, 'F2', String(row.qty)));
        ops.push(textRight(x[4] - 3, y, fs, 'F2', blankZero(row.qtyUpto20)));
        ops.push(textRight(x[5] - 3, y, fs, 'F2', blankZero(row.qtyAbove20)));
        if (isRc) {
          ops.push(textRight(x[6] - 3, y, fs, 'F2', money(row.contractor)));
          if (showHandling) {
            ops.push(
              textRight(x[7] - 3, y, fs, 'F2', row.handling > 0 ? money(row.handling) : '-'),
            );
          }
        } else {
          ops.push(textRight(x[6] - 3, y, fs, 'F2', money(row.collected)));
          ops.push(textRight(x[7] - 3, y, fs, 'F2', money(row.interweighing)));
          ops.push(textRight(x[8] - 3, y, fs, 'F2', money(row.contractor)));
        }
        ops.push(lineOp(left, y - 4, right));
      });
      if (pageIndex === pageCount - 1) {
        y -= rowH + 2;
        ops.push(fillOp(0.91, 0.96, 1, left, y - 3, right - left, 15));
        ops.push('0.08 0.11 0.16 rg');
        ops.push(textOp(x[1] + 2, y, fs, 'F1', 'Total'));
        ops.push(textRight(x[3] - 3, y, fs, 'F2', String(input.totals.qty)));
        ops.push(textRight(x[4] - 3, y, fs, 'F2', blankZero(input.totals.qtyUpto20)));
        ops.push(textRight(x[5] - 3, y, fs, 'F2', blankZero(input.totals.qtyAbove20)));
        if (isRc) {
          ops.push(textRight(x[6] - 3, y, fs, 'F2', money(input.totals.contractor)));
          if (showHandling) {
            ops.push(textRight(x[7] - 3, y, fs, 'F2', money(input.totals.handling)));
          }
        } else {
          ops.push(textRight(x[6] - 3, y, fs, 'F2', money(input.totals.collected)));
          ops.push(textRight(x[7] - 3, y, fs, 'F2', money(input.totals.interweighing)));
          ops.push(textRight(x[8] - 3, y, fs, 'F2', money(input.totals.contractor)));
        }
      }
    } else {
      const x = colStops([0.1, 0.28, 0.21, 0.21, 0.2]);
      const heads = ['#', 'Date', 'Upto 20kg', 'Above 20kg', 'Qty'];
      heads.forEach((label, i) => ops.push(textOp(x[i] + 2, y, 6.8, 'F1', label)));
      const slice = input.rows.slice(pageIndex * rowsPerPage, (pageIndex + 1) * rowsPerPage);
      slice.forEach((row, i) => {
        y -= rowH;
        if (i % 2 === 0) ops.push(fillOp(0.97, 0.98, 0.99, left, y - 3, right - left, rowH));
        ops.push('0.08 0.11 0.16 rg');
        const sl = pageIndex * rowsPerPage + i + 1;
        ops.push(textOp(x[0] + 2, y, fs, 'F2', String(sl)));
        ops.push(textOp(x[1] + 2, y, fs, 'F1', row.dateLabel));
        ops.push(textRight(x[3] - 3, y, fs, 'F2', blankZero(row.qtyUpto20)));
        ops.push(textRight(x[4] - 3, y, fs, 'F2', blankZero(row.qtyAbove20)));
        ops.push(textRight(x[5] - 3, y, fs, 'F2', String(row.verified)));
        ops.push(lineOp(left, y - 4, right));
      });
      if (pageIndex === pageCount - 1) {
        y -= rowH + 2;
        ops.push(fillOp(0.91, 0.96, 1, left, y - 3, right - left, 15));
        ops.push('0.08 0.11 0.16 rg');
        ops.push(textOp(x[1] + 2, y, fs, 'F1', 'Total'));
        ops.push(textRight(x[3] - 3, y, fs, 'F2', blankZero(input.totals.qtyUpto20)));
        ops.push(textRight(x[4] - 3, y, fs, 'F2', blankZero(input.totals.qtyAbove20)));
        ops.push(textRight(x[5] - 3, y, fs, 'F2', String(input.totals.verified)));
      }
    }

    ops.push('0.45 0.51 0.58 rg');
    if (input.view === 'revenue_share' && input.layout === 'rc') {
      ops.push(
        textOp(
          left,
          22,
          6.5,
          'F1',
          'RC pays contractor from Setting. New rates apply from save date.',
        ),
      );
      ops.push(textOp(left, 13, 6.5, 'F1', 'Past days keep old contractor rates. No backfill.'));
    } else {
      ops.push(
        textOp(left, 22, 6.5, 'F1', 'First 20 kg: Rs 200 (Rs 100 Interweighing + Rs 100 contractor).'),
      );
      ops.push(
        textOp(left, 13, 6.5, 'F1', 'Above 20 kg: Rs 350 (Rs 150 Interweighing + Rs 200 contractor).'),
      );
    }
    return ops.join('\n');
  });

  const bytes = assemblePdf(pages);
  const payload = new Uint8Array(bytes.byteLength);
  payload.set(bytes);
  const name = `${fileSlug(input.rcName)}-${
    input.view === 'revenue_share'
      ? input.layout === 'rc'
        ? 'contractor-fee'
        : 'revenue-share'
      : 'day-summary'
  }.pdf`;
  return new File([payload], name, { type: 'application/pdf' });
}

export async function shareReportPdf(file: File, title: string): Promise<void> {
  const canShareFiles =
    typeof navigator.share === 'function' &&
    (typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] }));
  if (canShareFiles) {
    await navigator.share({ files: [file], title });
    return;
  }
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
