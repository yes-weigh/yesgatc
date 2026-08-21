import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, FileText, Trash2, Upload } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { formatVerificationListDate } from '../../lib/verificationListFormat';
import {
  deleteManualPdf,
  formatManualPdfSize,
  subscribeManualPdfs,
  uploadManualPdf,
  type ManualPdfDoc,
} from '../../lib/manualPdf';

export const ManualPdf: React.FC = () => {
  const { user } = useAuth();
  const confirm = useConfirm();
  const inputRef = useRef<HTMLInputElement>(null);
  const canUpload = user?.role === 'super_admin';
  const [docs, setDocs] = useState<ManualPdfDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    return subscribeManualPdfs(
      rows => {
        setDocs(rows);
        setLoading(false);
      },
      err => {
        setError(err.message);
        setLoading(false);
      },
    );
  }, []);

  const handleSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !canUpload) return;
    setError('');
    setUploading(true);
    setProgress(0);
    try {
      await uploadManualPdf(file, setProgress);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  const handleDelete = async (record: ManualPdfDoc) => {
    if (!canUpload) return;
    const ok = await confirm({
      title: 'Remove manual',
      message: `Delete "${record.name}"? RC and VCT will no longer see this file.`,
      destructive: true,
    });
    if (!ok) return;
    setBusyId(record.id);
    setError('');
    try {
      await deleteManualPdf(record);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete file.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fade-in page-content">
      <div className="panel glass">
        <div className="panel-header">
          <h2>
            <FileText className="inline-icon" aria-hidden />
            Manual PDF
          </h2>
          {canUpload ? (
            <span className="manual-pdf-header-actions">
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,.pdf"
                hidden
                onChange={event => void handleSelect(event)}
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={uploading}
                onClick={() => inputRef.current?.click()}
              >
                <Upload size={16} aria-hidden />
                {uploading ? `Uploading ${progress}%` : 'Upload PDF'}
              </button>
            </span>
          ) : null}
        </div>
        <div className="panel-body">
          {error ? <p className="form-error mb-3">{error}</p> : null}
          {!canUpload ? (
            <p className="text-muted text-sm mb-3">View only. Super Admin uploads manuals.</p>
          ) : null}
          {loading ? (
            <div className="wl-recent__loading">
              <span className="spinner-inline" aria-hidden />
            </div>
          ) : docs.length === 0 ? (
            <p className="text-muted mb-0">
              {canUpload ? 'No manuals yet. Upload a PDF.' : 'No manuals uploaded yet.'}
            </p>
          ) : (
            <ul className="laboratory-documents-list">
              {docs.map(doc => (
                <li key={doc.id} className="laboratory-documents-item">
                  <span className="laboratory-doc-type laboratory-doc-type--pdf" aria-hidden>
                    PDF
                  </span>
                  <div className="laboratory-documents-copy">
                    <p className="laboratory-documents-title mb-0">{doc.name}</p>
                    <p className="laboratory-documents-meta mb-0">
                      {formatManualPdfSize(doc.size)}
                      {doc.uploadedAt
                        ? ` • ${formatVerificationListDate(doc.uploadedAt)}`
                        : ''}
                    </p>
                  </div>
                  <a
                    href={doc.url}
                    className="laboratory-documents-download"
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${doc.name}`}
                    title="Open PDF"
                  >
                    <ExternalLink size={18} strokeWidth={2} aria-hidden />
                  </a>
                  {canUpload ? (
                    <button
                      type="button"
                      className="laboratory-documents-download laboratory-documents-download--danger"
                      onClick={() => void handleDelete(doc)}
                      disabled={busyId === doc.id}
                      aria-label={`Delete ${doc.name}`}
                      title="Delete"
                    >
                      <Trash2 size={18} strokeWidth={2} aria-hidden />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};
