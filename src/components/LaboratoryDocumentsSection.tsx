import React from 'react';
import { ChevronRight, Download } from 'lucide-react';
import { LABORATORY_DOCUMENTS } from '../lib/laboratoryDocuments';

function DocumentTypeIcon({ type }: { type: 'pdf' | 'xlsx' }) {
  const label = type === 'pdf' ? 'PDF' : 'XLSX';
  const className =
    type === 'pdf' ? 'laboratory-doc-type laboratory-doc-type--pdf' : 'laboratory-doc-type laboratory-doc-type--xlsx';

  return (
    <span className={className} aria-hidden>
      {label}
    </span>
  );
}

export const LaboratoryDocumentsSection: React.FC = () => (
  <section className="laboratory-documents" aria-label="Documents and records">
    <div className="laboratory-section-head">
      <h3 className="laboratory-section-title mb-0">Documents &amp; Records</h3>
      <button type="button" className="laboratory-section-link" disabled title="Coming soon">
        View All
        <ChevronRight size={14} strokeWidth={2.25} aria-hidden />
      </button>
    </div>

    <ul className="laboratory-documents-list">
      {LABORATORY_DOCUMENTS.map(doc => (
        <li key={doc.id} className="laboratory-documents-item">
          <DocumentTypeIcon type={doc.fileType} />
          <div className="laboratory-documents-copy">
            <p className="laboratory-documents-title mb-0">{doc.title}</p>
            <p className="laboratory-documents-meta mb-0">
              {doc.fileType.toUpperCase()} • {doc.sizeLabel}
            </p>
          </div>
          {doc.href ? (
            <a
              href={doc.href}
              className="laboratory-documents-download"
              download
              aria-label={`Download ${doc.title}`}
              title={`Download ${doc.title}`}
            >
              <Download size={18} strokeWidth={2} aria-hidden />
            </a>
          ) : (
            <button
              type="button"
              className="laboratory-documents-download"
              disabled
              aria-label={`Download ${doc.title} — coming soon`}
              title="Download — coming soon"
            >
              <Download size={18} strokeWidth={2} aria-hidden />
            </button>
          )}
        </li>
      ))}
    </ul>
  </section>
);
