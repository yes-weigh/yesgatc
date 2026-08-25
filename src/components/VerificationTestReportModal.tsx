import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircle, Printer, X } from 'lucide-react';
import { QRCode } from 'react-qr-code';
import { useHistoryOverlay } from '../hooks/useHistoryOverlay';
import { useVerificationDetailDocs } from '../hooks/useVerificationDetailDocs';
import { resolveCertificatePdfQrUrl } from '../lib/certificatePdfQr';
import {
  buildVerificationTestReportData,
  buildVerificationTestReportShareMessage,
  formatGPlain,
  formatKgPlain,
  formatPmPlain,
  VERIFICATION_TEST_REPORT_BRANDING,
} from '../lib/verificationTestReport';
import { buildWhatsAppShareUrl } from '../lib/verificationWhatsAppShare';
import type { SiteCalibration } from '../types';

type VerificationTestReportModalProps = {
  open: boolean;
  record: SiteCalibration;
  onClose: () => void;
};

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="vtr-meta">
      <span className="vtr-meta-label">{label}</span>
      <span className="vtr-meta-value">{value}</span>
    </div>
  );
}

export const VerificationTestReportModal: React.FC<VerificationTestReportModalProps> = ({
  open,
  record,
  onClose,
}) => {
  const { customer, product } = useVerificationDetailDocs(record);
  const [pdfQrUrl, setPdfQrUrl] = useState<string | null>(null);

  useHistoryOverlay(open, onClose);

  useEffect(() => {
    document.documentElement.classList.toggle('vtr-print', open);
    return () => document.documentElement.classList.remove('vtr-print');
  }, [open]);

  useEffect(() => {
    if (!open) {
      setPdfQrUrl(null);
      return;
    }
    let cancelled = false;
    void resolveCertificatePdfQrUrl(record).then(url => {
      if (!cancelled) setPdfQrUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [open, record.id, record.certificatePdfUrl, record.emaapCertificatePdfUrl]);

  const report = useMemo(
    () => buildVerificationTestReportData(record, customer, product, pdfQrUrl),
    [record, customer, product, pdfQrUrl],
  );

  const whatsAppShareUrl = useMemo(
    () => buildWhatsAppShareUrl(buildVerificationTestReportShareMessage(report), customer?.phone),
    [report, customer?.phone],
  );

  if (!open) return null;

  const passed = report.overallResult === 'PASSED';
  const brand = VERIFICATION_TEST_REPORT_BRANDING;

  return createPortal(
    <div className="modal-overlay verification-test-report-overlay" role="presentation" onClick={onClose}>
      <div
        className="verification-test-report-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="verification-test-report-title"
        onClick={event => event.stopPropagation()}
      >
        <button
          type="button"
          className="verification-gst-bill-close"
          onClick={onClose}
          aria-label="Close test report"
        >
          <X size={18} aria-hidden />
        </button>

        <div className="verification-test-report-scroll">
          <article className="verification-test-report" data-verification-test-report-print>
            <header className="vtr-head">
              <div className="vtr-brand">
                <img src={brand.logoSrc} alt="" className="vtr-logo" />
                <div>
                  <p className="vtr-company">{brand.companyName}</p>
                  <p className="vtr-address">{brand.addressLines.join(', ')}</p>
                  <p className="vtr-address">
                    {brand.phone} · {brand.website} · GATC {brand.gatcApprovalNumber}
                  </p>
                </div>
              </div>
              {report.verifyUrl ? (
                <div className="vtr-qr">
                  <QRCode
                    value={report.verifyUrl}
                    size={72}
                    bgColor="#FFFFFF"
                    fgColor="#000000"
                    level="M"
                    style={{ width: '3.35rem', height: '3.35rem' }}
                    aria-hidden
                  />
                  <p className="vtr-qr-caption">Scan to verify</p>
                </div>
              ) : null}
            </header>

            <div className="vtr-banner">
              <h1 id="verification-test-report-title" className="vtr-title">
                {report.title}
              </h1>
              <span className={`vtr-badge${passed ? ' vtr-badge--pass' : ' vtr-badge--fail'}`}>
                {report.overallResult}
              </span>
            </div>

            <div className="vtr-refs">
              <Meta label="Date" value={report.testDate} />
              <Meta label="Report No." value={report.reportNumber} />
              <Meta label="Certificate" value={report.certificateNumber} />
            </div>

            <div className="vtr-split">
              <section className="vtr-card" aria-label="Customer">
                <h2 className="vtr-card-title">Customer</h2>
                <Meta label="Name" value={report.customerName} />
                <Meta label="Address" value={report.customerAddress} />
                <Meta label="Phone" value={report.customerPhone} />
              </section>
              <section className="vtr-card" aria-label="Instrument">
                <h2 className="vtr-card-title">Instrument</h2>
                <Meta label="Type" value={report.instrumentType} />
                <Meta label="Make / model" value={`${report.manufacturer} · ${report.modelApprovalNo}`} />
                <Meta label="Serial" value={report.serialNumber} />
                <Meta
                  label="Max / Min / e"
                  value={`${report.maxLabel} / ${report.minLabel} / ${report.eLabel}`}
                />
                <Meta label="Class / n" value={`${report.accuracyClass} / ${report.nLabel}`} />
                <Meta label="Seal ID" value={report.sealId} />
              </section>
            </div>

            <div className="vtr-strip">
              <span>{report.verificationType}</span>
              <span>{brand.testReference}</span>
              <span>{report.location}</span>
              <span>{report.temperature}</span>
              <span>{report.humidity}</span>
              <span>Due {report.nextDueDate}</span>
              <span>{report.testedBy}</span>
            </div>

            <section className="vtr-block" aria-label="Weighing performance">
              <h2 className="vtr-card-title">Accuracy / weighing performance</h2>
              {report.weighing.length > 0 ? (
                <table className="vtr-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Load (kg)</th>
                      <th>Indication (kg)</th>
                      <th>Error (g)</th>
                      <th>MPE (g)</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.weighing.map(row => (
                      <tr key={row.sr}>
                        <td>{row.sr}</td>
                        <td>{formatKgPlain(row.loadKg)}</td>
                        <td>{formatKgPlain(row.indicatedKg)}</td>
                        <td>{formatGPlain(row.errorG)}</td>
                        <td>{formatPmPlain(row.mpeG)}</td>
                        <td className="vtr-pass">{row.result}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="vtr-missing">Cannot build load table — Max and e required.</p>
              )}
            </section>

            <div className="vtr-tests">
              {report.repeatability ? (
                <section className="vtr-block" aria-label="Repeatability">
                  <h2 className="vtr-card-title">Repeatability</h2>
                  <p className="vtr-load-line">Load {formatKgPlain(report.repeatability.loadKg)} kg</p>
                  <table className="vtr-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Indication (kg)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.repeatability.readingsKg.map((reading, index) => (
                        <tr key={index}>
                          <td>{index + 1}</td>
                          <td>{formatKgPlain(reading)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="vtr-result-line">
                    Emax − Emin {formatGPlain(report.repeatability.eMaxMinusEminG)} g · mpe{' '}
                    {formatGPlain(report.repeatability.mpeG)} g ·{' '}
                    <span className="vtr-pass">{report.repeatability.result}</span>
                  </p>
                </section>
              ) : null}

              {report.eccentricity.length > 0 ? (
                <section className="vtr-block" aria-label="Corner test">
                  <h2 className="vtr-card-title">Corner test (eccentricity)</h2>
                  <p className="vtr-load-line">Load {formatKgPlain(report.eccentricity[0]!.loadKg)} kg</p>
                  <table className="vtr-table">
                    <thead>
                      <tr>
                        <th>Location</th>
                        <th>Load (kg)</th>
                        <th>Indication (kg)</th>
                        <th>Error (g)</th>
                        <th>MPE (g)</th>
                        <th>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.eccentricity.map(row => (
                        <tr key={row.location}>
                          <td>{row.location}</td>
                          <td>{formatKgPlain(row.loadKg)}</td>
                          <td>{formatKgPlain(row.indicatedKg)}</td>
                          <td>{formatGPlain(row.errorG)}</td>
                          <td>{formatPmPlain(row.mpeG)}</td>
                          <td className="vtr-pass">{row.result}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              ) : null}
            </div>

            <p className="vtr-disclaimer">
              Computer generated · OIML R 76 · Valid with certificate {report.certificateNumber}
            </p>

            {report.missingFields.length > 0 ? (
              <p className="vtr-missing">Missing: {report.missingFields.join(', ')}</p>
            ) : null}
          </article>
        </div>

        <div className="verification-gst-bill-toolbar">
          <div className="verification-gst-bill-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => window.print()}
              aria-label="Print test report"
            >
              <Printer size={18} aria-hidden />
            </button>
            {whatsAppShareUrl ? (
              <a
                className="btn btn-sm verification-gst-bill-whatsapp-btn"
                href={whatsAppShareUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Share test report on WhatsApp"
              >
                <MessageCircle size={18} aria-hidden />
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
