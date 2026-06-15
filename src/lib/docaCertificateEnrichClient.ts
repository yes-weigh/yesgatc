import { getBytes, ref } from 'firebase/storage';
import { legacyStorage, storage } from '../firebase';
import {
  GATC_CERTIFICATE_PARSER_VERSION,
  parseGatcCertificatePdfText,
} from './gatcCertificatePdfParser';
import {
  DOCA_CERTIFICATES_COLLECTION,
  type DocaCertificatePdfExtract,
  type DocaCertificateRecord,
} from './docaScraping';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';

type PdfJsModule = typeof import('pdfjs-dist');

let pdfJsModulePromise: Promise<PdfJsModule> | null = null;

async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    });
  }
  return pdfJsModulePromise;
}

type PdfTextItem = {
  str: string;
  transform: number[];
};

function isPdfTextItem(item: unknown): item is PdfTextItem {
  return (
    typeof item === 'object'
    && item !== null
    && 'str' in item
    && typeof item.str === 'string'
    && 'transform' in item
    && Array.isArray(item.transform)
  );
}

function reconstructTextByWordRows(items: PdfTextItem[]): string {
  if (!items.length) return '';

  const rowTolerance = 4;
  const rowMap = new Map<number, PdfTextItem[]>();

  for (const word of items) {
    const rowKey = Math.round((word.transform[5] ?? 0) / rowTolerance);
    const row = rowMap.get(rowKey) ?? [];
    row.push(word);
    rowMap.set(rowKey, row);
  }

  return [...rowMap.entries()]
    .sort((left, right) => right[0] - left[0])
    .map(([, rowWords]) =>
      rowWords
        .sort((left, right) => (left.transform[4] ?? 0) - (right.transform[4] ?? 0))
        .map(word => word.str)
        .join(' '),
    )
    .join('\n');
}

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const { getDocument } = await loadPdfJs();
  const pdf = await getDocument({ data: bytes }).promise;
  const parts: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const textItems: PdfTextItem[] = [];
    for (const item of content.items) {
      if (isPdfTextItem(item)) {
        textItems.push(item);
      }
    }

    const rowText = reconstructTextByWordRows(textItems);
    if (rowText.trim()) {
      parts.push(rowText);
    }

    const flatText = textItems.map(item => item.str).join(' ');
    if (flatText.trim()) {
      parts.push(flatText);
    }
  }

  return parts.join('\n');
}

export function parseGatcCertificatePdf(bytes: Uint8Array): Promise<DocaCertificatePdfExtract> {
  return extractPdfText(bytes).then(text => parseGatcCertificatePdfText(text));
}

async function readStorageBytes(path: string): Promise<Uint8Array> {
  try {
    const bytes = await getBytes(ref(storage, path));
    return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  } catch {
    const bytes = await getBytes(ref(legacyStorage, path));
    return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  }
}

export async function downloadDocaCertificatePdf(record: DocaCertificateRecord): Promise<Uint8Array> {
  if (record.certificatePdfPath.trim()) {
    return readStorageBytes(record.certificatePdfPath.trim());
  }

  if (record.certificatePdfUrl.trim()) {
    const response = await fetch(record.certificatePdfUrl.trim());
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} downloading PDF.`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  throw new Error('Certificate PDF path is missing.');
}

export function shouldSkipBrowserPdfEnrich(record: DocaCertificateRecord): boolean {
  const extract = record.pdfExtract;
  if (!extract) return false;
  if ((extract.parserVersion ?? 0) < GATC_CERTIFICATE_PARSER_VERSION) return false;
  return extract.parseStatus === 'ok';
}

export async function saveDocaCertificatePdfExtract(
  recordId: string,
  pdfExtract: DocaCertificatePdfExtract,
): Promise<void> {
  await updateDoc(doc(db, DOCA_CERTIFICATES_COLLECTION, recordId), { pdfExtract });
}

export async function enrichDocaCertificateInBrowser(
  record: DocaCertificateRecord,
): Promise<DocaCertificatePdfExtract> {
  try {
    const bytes = await downloadDocaCertificatePdf(record);
    const extract = await parseGatcCertificatePdf(bytes);
    await saveDocaCertificatePdfExtract(record.id, extract);
    return extract;
  } catch (error) {
    const extract: DocaCertificatePdfExtract = {
      parseStatus: 'failed',
      parseError: error instanceof Error ? error.message : 'PDF enrich failed.',
      parsedAt: new Date().toISOString(),
      parserVersion: GATC_CERTIFICATE_PARSER_VERSION,
      certificateNumber: '',
      verificationDate: '',
      ownerName: '',
      ownerAddress: '',
      ownerPhone: '',
      instrumentType: '',
      manufacturerModel: '',
      serialNumber: '',
      yearOfManufacture: '',
      accuracyClass: '',
      maxCapacity: '',
      minCapacity: '',
      verificationScaleIntervalE: '',
      actualScaleIntervalD: '',
      unitOfMeasurement: '',
      verificationIntervalsN: '',
      maximumPermissibleError: '',
      nextVerificationDue: '',
      modelApprovalNos: '',
      sealIdentificationNos: '',
    };
    await saveDocaCertificatePdfExtract(record.id, extract);
    return extract;
  }
}

export type BrowserPdfEnrichLastProcessed = {
  certificate: string;
  action: 'parsed' | 'skipped' | 'failed';
  processedAt: string;
  pdfExtract: DocaCertificatePdfExtract | null;
};

export type BrowserPdfEnrichProgress = {
  status: 'idle' | 'running' | 'paused' | 'completed';
  statusMessage: string;
  totalRows: number;
  processedRows: number;
  parsedRows: number;
  skippedRows: number;
  failedRows: number;
  lastProcessed: BrowserPdfEnrichLastProcessed | null;
};

export type BrowserPdfEnrichOptions = {
  records: DocaCertificateRecord[];
  includeAlreadyParsed?: boolean;
  onProgress?: (progress: BrowserPdfEnrichProgress) => void;
  shouldCancel?: () => boolean;
};

function certificateLabel(record: DocaCertificateRecord): string {
  return record.generateCertificate || record.gatcCertificateNo || record.id;
}

export async function runBrowserPdfEnrich({
  records,
  includeAlreadyParsed = false,
  onProgress,
  shouldCancel,
}: BrowserPdfEnrichOptions): Promise<BrowserPdfEnrichProgress> {
  const queue = records.filter(record => {
    if (!record.certificatePdfPath.trim() && !record.certificatePdfUrl.trim()) {
      return false;
    }
    if (includeAlreadyParsed) return true;
    return !shouldSkipBrowserPdfEnrich(record);
  });

  const progress: BrowserPdfEnrichProgress = {
    status: 'running',
    statusMessage: 'Parsing certificate PDFs in browser…',
    totalRows: queue.length,
    processedRows: 0,
    parsedRows: 0,
    skippedRows: 0,
    failedRows: 0,
    lastProcessed: null,
  };

  const emit = () => onProgress?.({ ...progress });

  emit();

  for (const record of queue) {
    if (shouldCancel?.()) {
      progress.status = 'paused';
      progress.statusMessage = 'Browser PDF parse paused.';
      emit();
      return progress;
    }

    if (!includeAlreadyParsed && shouldSkipBrowserPdfEnrich(record)) {
      progress.processedRows += 1;
      progress.skippedRows += 1;
      progress.lastProcessed = {
        certificate: certificateLabel(record),
        action: 'skipped',
        processedAt: new Date().toISOString(),
        pdfExtract: record.pdfExtract,
      };
      emit();
      continue;
    }

    const extract = await enrichDocaCertificateInBrowser(record);
    progress.processedRows += 1;

    if (extract.parseStatus === 'ok' || extract.parseStatus === 'partial') {
      progress.parsedRows += 1;
      progress.lastProcessed = {
        certificate: certificateLabel(record),
        action: 'parsed',
        processedAt: new Date().toISOString(),
        pdfExtract: extract,
      };
    } else {
      progress.failedRows += 1;
      progress.lastProcessed = {
        certificate: certificateLabel(record),
        action: 'failed',
        processedAt: new Date().toISOString(),
        pdfExtract: extract,
      };
    }

    progress.statusMessage = `Parsed ${progress.processedRows} / ${progress.totalRows}`;
    emit();

    await new Promise<void>(resolve => {
      window.setTimeout(resolve, 0);
    });
  }

  progress.status = 'completed';
  progress.statusMessage = `Finished — parsed ${progress.parsedRows}, skipped ${progress.skippedRows}, failed ${progress.failedRows}.`;
  emit();
  return progress;
}
