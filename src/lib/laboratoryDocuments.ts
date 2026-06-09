export type LaboratoryDocumentType = 'pdf' | 'xlsx';

export type LaboratoryDocument = {
  id: string;
  title: string;
  fileType: LaboratoryDocumentType;
  sizeLabel: string;
  /** Swap in real download URLs when documents are wired up. */
  href?: string;
};

/** Placeholder laboratory documents — replace href values when storage is connected. */
export const LABORATORY_DOCUMENTS: LaboratoryDocument[] = [
  {
    id: 'standard-weight-calibration',
    title: 'Standard Weight Calibration Certificate',
    fileType: 'pdf',
    sizeLabel: '245 KB',
  },
  {
    id: 'environmental-monitoring-log',
    title: 'Environmental Monitoring Log',
    fileType: 'xlsx',
    sizeLabel: '128 KB',
  },
  {
    id: 'traceability-matrix',
    title: 'Traceability Matrix',
    fileType: 'xlsx',
    sizeLabel: '96 KB',
  },
  {
    id: 'seal-plier-verification',
    title: 'Seal Plier Verification Record',
    fileType: 'pdf',
    sizeLabel: '312 KB',
  },
];
