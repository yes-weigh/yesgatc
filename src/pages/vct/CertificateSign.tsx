import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import {
  Check,
  CloudUpload,
  Download,
  FileText,
  PenLine,
  Share2,
  Upload,
} from 'lucide-react';
import { db } from '../../firebase';
import { CertificatePdfShareViewer } from '../../components/CertificatePdfShareViewer';
import { ListViewBackBar } from '../../components/ListViewBackBar';
import { useMobileViewport } from '../../hooks/useMobileViewport';
import { useAuth } from '../../context/AuthContext';
import { useRcScope, useRoleBasePath } from '../../lib/roleScope';
import { certificatePdfFileName } from '../../lib/certificatePdfFile';
import { formatVerificationListDate } from '../../lib/verificationListFormat';
import { isVerificationCertifiedOnDoca } from '../../lib/verificationRequest';
import { verificationValidUptoDate } from '../../lib/verificationLabel';
import {
  hasSignedCertificatePdf,
  certificatePdfDownloadedAt,
  certificateRequiresSignedUpload,
  certificateSignStatus,
  isVerifierVisibleIssuedCertificate,
  markCertificatePdfDownloaded,
  resolveUnsignedCertificatePdfUrl,
  storedSignedCertificatePdfPath,
  storedSignedCertificatePdfUrl,
  uploadSignedCertificatePdf,
  validateSignedCertificatePdf,
} from '../../lib/signedCertificatePdf';
import { UnsignedCertificateDownloadWarn } from '../../components/RcUnsignedPdfDisturbHost';
import type { SiteCalibration } from '../../types';

function formatStamp(iso?: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatValidTill(certifiedAt?: string): string {
  const date = verificationValidUptoDate(certifiedAt);
  if (!date) return '—';
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatCapacity(record: SiteCalibration): string {
  if (record.maximumCapacity == null || !Number.isFinite(record.maximumCapacity)) return '—';
  return `${record.maximumCapacity} ${record.unitOfMeasurement || 'kg'}`;
}

export const CertificateSign: React.FC = () => {
  const { recordId = '' } = useParams<{ recordId: string }>();
  const navigate = useNavigate();
  const basePath = useRoleBasePath();
  const { user } = useAuth();
  const { rcUid, isRcAdmin, isVerifier } = useRcScope();
  const isPhone = useMobileViewport();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [record, setRecord] = useState<SiteCalibration | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloadedAt, setDownloadedAt] = useState<string | null>(null);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const [viewingPdf, setViewingPdf] = useState(false);
  const [downloadWarnOpen, setDownloadWarnOpen] = useState(false);

  const listPath = `${basePath}/certificates`;

  const load = useCallback(async () => {
    if (!rcUid || !recordId) {
      setRecord(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const snap = await getDoc(doc(db, 'siteCalibrations', recordId));
      if (!snap.exists()) {
        setRecord(null);
        setError('Certificate not found.');
        return;
      }
      const next = { id: snap.id, ...snap.data() } as SiteCalibration;
      if (next.rcId !== rcUid || !isVerificationCertifiedOnDoca(next)) {
        setRecord(null);
        setError('Certificate not found.');
        return;
      }
      if (isVerifier && !isVerifierVisibleIssuedCertificate(next)) {
        setRecord(null);
        setError('Certificate not ready yet. Visible after RC signs and eMAAP upload.');
        return;
      }
      setRecord(next);
      setDownloadedAt(certificatePdfDownloadedAt(next.id));
    } catch (err) {
      setRecord(null);
      setError(err instanceof Error ? err.message : 'Could not load certificate.');
    } finally {
      setLoading(false);
    }
  }, [isVerifier, rcUid, recordId]);

  useEffect(() => {
    void load();
  }, [load]);

  const signStatus = record ? certificateSignStatus(record) : 'not_signed';
  const storedSignedUrl = record ? storedSignedCertificatePdfUrl(record) : null;
  const pdfUrl = storedSignedUrl || (record ? resolveUnsignedCertificatePdfUrl(record) : null);
  const canUpload = Boolean(record && isRcAdmin && certificateRequiresSignedUpload(record));
  const signed = Boolean(record && hasSignedCertificatePdf(record));
  const downloaded = Boolean(downloadedAt) || signed;
  const voided = signStatus === 'voided';

  const step = voided ? 0 : signed ? 3 : downloaded ? 2 : 1;
  const progress = voided ? 0 : signed ? 100 : downloaded ? 66 : 33;

  const fileName = useMemo(() => {
    if (!record) return 'certificate.pdf';
    return record.signedCertificatePdfName?.trim() || certificatePdfFileName(record);
  }, [record]);

  const runDownload = () => {
    if (!record || !pdfUrl) return;
    markCertificatePdfDownloaded(record.id);
    setDownloadedAt(new Date().toISOString());
    if (isPhone) {
      setViewingPdf(true);
      return;
    }
    window.open(pdfUrl, '_blank', 'noopener,noreferrer');
  };

  const handleDownload = () => {
    if (!record || !pdfUrl) return;
    if (certificateSignStatus(record) === 'not_signed') {
      setDownloadWarnOpen(true);
      return;
    }
    runDownload();
  };

  const takeFile = (file: File | null) => {
    if (!file || !canUpload) return;
    const invalid = validateSignedCertificatePdf(file);
    if (invalid) {
      setUploadError(invalid);
      setPickedFile(null);
      return;
    }
    setUploadError('');
    setPickedFile(file);
  };

  const handleUpload = async () => {
    if (!record || !pickedFile || !canUpload || uploading) return;
    setUploading(true);
    setUploadError('');
    setUploadProgress(0);
    try {
      const patch = await uploadSignedCertificatePdf(record.id, pickedFile, setUploadProgress);
      setRecord(prev => (prev ? { ...prev, ...patch } : prev));
      setPickedFile(null);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  if (loading) {
    return (
      <div className="fade-in wl-cert-sign-page">
        <ListViewBackBar onBack={() => navigate(listPath)} label="Back to Certificate List" />
        <div className="wl-recent__loading">
          <span className="spinner-inline" aria-hidden />
        </div>
      </div>
    );
  }

  if (!record) {
    return (
      <div className="fade-in wl-cert-sign-page">
        <ListViewBackBar onBack={() => navigate(listPath)} label="Back to Certificate List" />
        <div className="wl-recent__empty">
          <p>{error || 'Certificate not found.'}</p>
        </div>
      </div>
    );
  }

  const typeLabel = record.verificationType === 'RV' ? 'RV' : 'OV';
  const verifiedOn = formatVerificationListDate(record.certifiedAt || record.approvedAt);
  const dueOn = formatValidTill(record.certifiedAt);
  const statusLabel = voided
    ? 'Voided'
    : signed
      ? 'Signed'
      : 'Ready for Digital Signature';

  return (
    <div className="fade-in wl-cert-sign-page">
      <ListViewBackBar onBack={() => navigate(listPath)} label="Back to Certificate List" />

      <section className="wl-cert-sign-hero">
        <div className="wl-cert-sign-hero__main">
          <p className="wl-cert-sign-kicker">Certificate Digital Signature</p>
          <h1 className="wl-cert-sign-hero__no">{record.certificateNumber?.trim() || '—'}</h1>
          <p className="wl-cert-sign-hero__name">{record.customerName?.trim() || '—'}</p>
          <div className="wl-cert-sign-hero__meta">
            <span className={`wl-cert-sign-type wl-cert-sign-type--${typeLabel.toLowerCase()}`}>
              {typeLabel}
            </span>
            <span>Verified {verifiedOn}</span>
            <span>Next due {dueOn}</span>
          </div>
        </div>
        <div className="wl-cert-sign-hero__status">
          <p className={`wl-cert-sign-status wl-cert-sign-status--${voided ? 'voided' : signed ? 'signed' : 'not_signed'}`}>
            {signed ? <Check size={16} strokeWidth={2.4} aria-hidden /> : null}
            {statusLabel}
          </p>
          {!voided ? (
            <>
              <div className="wl-cert-sign-progress" aria-hidden>
                <span style={{ width: `${progress}%` }} />
              </div>
              <p className="wl-cert-sign-progress-label">
                Step {step} of 3 · {progress}%
              </p>
            </>
          ) : null}
        </div>
      </section>

      {!voided ? (
        <ol className="wl-cert-sign-tracker">
          <li className={step > 1 ? 'is-done' : 'is-current'}>
            <span>1</span>
            <em>{isPhone ? 'Share' : 'Download PDF'}</em>
          </li>
          <li className={step > 2 ? 'is-done' : step === 2 ? 'is-current' : ''}>
            <span>2</span>
            <em>{isPhone ? 'Print' : 'Sign with DSC'}</em>
          </li>
          <li className={step >= 3 ? 'is-done' : ''}>
            <span>3</span>
            <em>{isPhone ? 'Upload' : 'Upload signed PDF'}</em>
          </li>
        </ol>
      ) : null}

      <div className="wl-cert-sign-layout">
        <div className="wl-cert-sign-steps">
          <article className={`wl-cert-sign-card${downloaded ? ' is-done' : ' is-current'}`}>
            <header>
              {isPhone ? <Share2 size={18} aria-hidden /> : <Download size={18} aria-hidden />}
              <h2>{isPhone ? 'Share certificate' : 'Download Certificate PDF'}</h2>
              <strong>{downloaded ? 'Completed' : 'Pending'}</strong>
            </header>
            <p className="wl-cert-sign-file">{fileName}</p>
            {downloadedAt ? (
              <p className="wl-cert-sign-muted">{isPhone ? 'Opened' : 'Downloaded'} {formatStamp(downloadedAt)}</p>
            ) : (
              <p className="wl-cert-sign-muted">
                {isPhone
                  ? 'Share to Epson Wi‑Fi printer or any installed app.'
                  : 'Save the PDF, then sign with your DSC token.'}
              </p>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleDownload}
              disabled={!pdfUrl}
            >
              {isPhone ? <Share2 size={16} aria-hidden /> : <Download size={16} aria-hidden />}
              {isPhone ? 'Share PDF' : downloaded ? 'Download again' : 'Download PDF'}
            </button>
          </article>

          <article className={`wl-cert-sign-card${signed ? ' is-done' : downloaded ? ' is-current' : ''}`}>
            <header>
              <PenLine size={18} aria-hidden />
              <h2>Apply Digital Signature</h2>
              <strong>{signed ? 'Signed' : downloaded ? 'Sign now' : 'Waiting'}</strong>
            </header>
            {signed ? (
              <p className="wl-cert-sign-muted">
                Signed PDF on file
                {record.signedCertificateUploadedAt
                  ? ` · ${formatStamp(record.signedCertificateUploadedAt)}`
                  : ''}
                {user?.username ? ` · ${user.username}` : ''}
              </p>
            ) : (
              <p className="wl-cert-sign-muted">
                {isPhone
                  ? 'Share the PDF to your Epson printer app. DSC signing is on computer.'
                  : 'Open the downloaded PDF in Adobe Reader or your DSC utility. Sign with Class 3 DSC token, save, then upload in step 3.'}
              </p>
            )}
            {signed && pdfUrl ? (
              <button type="button" className="btn btn-primary" onClick={handleDownload}>
                <FileText size={16} aria-hidden />
                View signed PDF
              </button>
            ) : null}
          </article>

          <article className={`wl-cert-sign-card${signed ? ' is-done' : canUpload ? ' is-current' : ''}`}>
            <header>
              <CloudUpload size={18} aria-hidden />
              <h2>Upload Signed Certificate</h2>
              <strong>{signed ? 'Completed' : canUpload ? 'Pending' : 'RC only'}</strong>
            </header>
            {signed ? (
              <p className="wl-cert-sign-muted">
                {record.signedCertificatePdfName || 'Signed PDF'} kept in Firebase. Lists and
                downloads show it after the worker uploads it on eMAAP Issued.
              </p>
            ) : canUpload ? (
              <>
                <div
                  className={`wl-cert-sign-drop${dragOver ? ' is-over' : ''}`}
                  onDragOver={event => {
                    event.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={event => {
                    event.preventDefault();
                    setDragOver(false);
                    takeFile(event.dataTransfer.files[0] ?? null);
                  }}
                >
                  <CloudUpload size={28} aria-hidden />
                  <span>{pickedFile ? pickedFile.name : 'Drop signed PDF or choose file'}</span>
                  <small>PDF only. Max 20 MB.</small>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Choose file
                  </button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  hidden
                  onChange={event => {
                    takeFile(event.target.files?.[0] ?? null);
                    event.target.value = '';
                  }}
                />
                {uploadError ? <p className="form-error mb-0">{uploadError}</p> : null}
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!pickedFile || uploading}
                  onClick={() => void handleUpload()}
                >
                  <Upload size={16} aria-hidden />
                  {uploading ? `Uploading ${uploadProgress}%` : 'Upload & save certificate'}
                </button>
              </>
            ) : (
              <p className="wl-cert-sign-muted">
                RC Admin downloads, signs with DSC, then uploads the signed PDF.
              </p>
            )}
          </article>
        </div>

        <aside className="wl-cert-sign-side">
          <section>
            <h3>Certificate information</h3>
            <dl>
              <div>
                <dt>Certificate No.</dt>
                <dd>{record.certificateNumber?.trim() || '—'}</dd>
              </div>
              <div>
                <dt>Customer</dt>
                <dd>{record.customerName?.trim() || '—'}</dd>
              </div>
              <div>
                <dt>Type</dt>
                <dd>{typeLabel}</dd>
              </div>
              <div>
                <dt>Serial</dt>
                <dd>{record.serialNumber?.trim() || '—'}</dd>
              </div>
              <div>
                <dt>Date</dt>
                <dd>{verifiedOn}</dd>
              </div>
              <div>
                <dt>Next due</dt>
                <dd>{dueOn}</dd>
              </div>
              <div>
                <dt>Capacity</dt>
                <dd>{formatCapacity(record)}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{statusLabel}</dd>
              </div>
            </dl>
          </section>
          <section>
            <h3>Workflow status</h3>
            <ol className="wl-cert-sign-timeline">
              <li className={downloaded ? 'is-done' : ''}>
                <strong>PDF downloaded</strong>
                <span>{downloadedAt ? formatStamp(downloadedAt) : 'Waiting'}</span>
              </li>
              <li className={signed ? 'is-done' : downloaded ? 'is-current' : ''}>
                <strong>DSC applied</strong>
                <span>
                  {signed
                    ? formatStamp(record.signedCertificateUploadedAt)
                    : 'Sign the downloaded PDF'}
                </span>
              </li>
              <li className={signed ? 'is-done' : ''}>
                <strong>{signed ? 'Uploaded' : 'Pending upload'}</strong>
                <span>{signed ? 'Available for download and share' : 'Waiting for upload'}</span>
              </li>
              <li className={record.emaapSignedPdfUploadedAt ? 'is-done' : signed ? 'is-current' : ''}>
                <strong>eMAAP Issued</strong>
                <span>
                  {record.emaapSignedPdfUploadedAt
                    ? formatStamp(record.emaapSignedPdfUploadedAt)
                    : 'Worker uploads the signed PDF on Certificates Issued'}
                </span>
              </li>
            </ol>
          </section>
        </aside>
      </div>
      <CertificatePdfShareViewer
        open={viewingPdf}
        record={record}
        url={pdfUrl}
        storagePath={
          record
            ? storedSignedCertificatePdfPath(record) || record.certificatePdfPath?.trim() || null
            : null
        }
        heading={record && hasSignedCertificatePdf(record) ? 'Signed certificate' : undefined}
        warnUnsignedDownload
        onClose={() => setViewingPdf(false)}
      />
      <UnsignedCertificateDownloadWarn
        open={downloadWarnOpen}
        onContinue={() => {
          setDownloadWarnOpen(false);
          runDownload();
        }}
        onCancel={() => setDownloadWarnOpen(false)}
      />
    </div>
  );
};
