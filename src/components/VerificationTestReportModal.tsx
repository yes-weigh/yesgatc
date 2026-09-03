import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircle, Printer, X } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useHistoryOverlay } from '../hooks/useHistoryOverlay';
import { useVerificationDetailDocs } from '../hooks/useVerificationDetailDocs';
import {
  buildVerificationTestReportData,
  buildVerificationTestReportShareMessage,
  formatGPlain,
  formatKgPlain,
  formatPmPlain,
  VERIFICATION_TEST_REPORT_BRANDING,
} from '../lib/verificationTestReport';
import { buildWhatsAppShareUrl } from '../lib/verificationWhatsAppShare';
import type { FirestoreUserDoc, SiteCalibration } from '../types';

type VerificationTestReportModalProps = {
  open: boolean;
  record: SiteCalibration;
  onClose: () => void;
};

function Field({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div className={`vtr-field${emphasize ? ' vtr-field--emph' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ResultChip({ ok }: { ok: boolean }) {
  return <span className={`vtr-chip${ok ? ' is-pass' : ' is-fail'}`}>{ok ? 'PASS' : 'FAIL'}</span>;
}

export const VerificationTestReportModal: React.FC<VerificationTestReportModalProps> = ({
  open,
  record,
  onClose,
}) => {
  const { customer, product } = useVerificationDetailDocs(record);
  const [vct, setVct] = useState<{ name?: string; phone?: string } | null>(null);

  useHistoryOverlay(open, onClose);

  useEffect(() => {
    document.documentElement.classList.toggle('vtr-print', open);
    return () => document.documentElement.classList.remove('vtr-print');
  }, [open]);

  useEffect(() => {
    if (!open) {
      setVct(null);
      return;
    }
    let cancelled = false;
    const vctId = record.vctId?.trim();
    if (!vctId) {
      setVct(null);
      return;
    }
    void getDoc(doc(db, 'users', vctId)).then(vctSnap => {
      if (cancelled) return;
      if (vctSnap.exists()) {
        const data = vctSnap.data() as FirestoreUserDoc;
        setVct({
          name: data.contactPerson || data.username || '',
          phone: data.phone || '',
        });
      } else {
        setVct(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, record.vctId]);

  const report = useMemo(
    () => buildVerificationTestReportData(record, customer, product, null, vct),
    [record, customer, product, vct],
  );

  const whatsAppShareUrl = useMemo(
    () => buildWhatsAppShareUrl(buildVerificationTestReportShareMessage(report), customer?.phone),
    [report, customer?.phone],
  );

  if (!open) return null;

  const passed = report.overallResult === 'PASSED';
  const brand = VERIFICATION_TEST_REPORT_BRANDING;
  const rep = report.repeatability;

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
            <header className="vtr-mast">
              <img className="vtr-logo" src={brand.logoSrc} alt="" width={56} height={56} />
              <div className="vtr-mast__text">
                <p className="vtr-eyebrow">Government Approved Test Centre</p>
                <p className="vtr-company">{brand.companyName}</p>
                <p className="vtr-address">{brand.addressLines.join(', ')}</p>
                <p className="vtr-contact">
                  Ph : {brand.phone} · {brand.website} · {brand.gatcApprovalNumber}
                </p>
              </div>
            </header>

            <div className="vtr-banner">
              <h1 id="verification-test-report-title">{report.title}</h1>
              <span className={`vtr-badge${passed ? '' : ' is-fail'}`}>
                ({passed ? 'PASSED' : 'FAILED'})
              </span>
            </div>

            <div className="vtr-ids">
              <div>
                <span>Date of Test</span>
                <strong>{report.testDate}</strong>
              </div>
              <div>
                <span>Certificate Number</span>
                <strong>{report.certificateNumber}</strong>
              </div>
            </div>

            <div className="vtr-info-row" aria-label="Customer and instrument">
              <section className="vtr-panel">
                <h2 className="vtr-panel__title">Customer Details</h2>
                <div className="vtr-panel__body">
                  <Field label="Customer Name" value={report.customerName} />
                  <Field label="Address" value={report.customerAddress} />
                  <Field label="Contact Person" value={report.contactPerson} />
                  <Field label="Phone Number" value={report.customerPhone} />
                  <Field label="Email" value={report.customerEmail} />
                  <Field label="Purpose of Test" value={report.purpose} />
                </div>
              </section>

              <section className="vtr-panel vtr-panel--instrument">
                <h2 className="vtr-panel__title">Instrument Details</h2>
                <div className="vtr-instrument">
                  <div className="vtr-panel__body">
                    <Field label="Serial Number" value={report.serialNumber} emphasize />
                    <Field label="Instrument Type" value={report.instrumentType} />
                    <Field label="Manufacturer / Brand" value={report.manufacturer} />
                    <Field label="Model Approval" value={report.modelApprovalNo} />
                    <Field label="Maximum Capacity" value={report.maxLabel} />
                    <Field label="Minimum Capacity" value={report.minLabel} />
                    <Field label="Verification e" value={report.eLabel} />
                    <Field label="Division d" value={report.dLabel} />
                    <Field label="Accuracy Class" value={report.accuracyClass} />
                    <Field label="n (intervals)" value={report.nLabel} />
                    <Field label="Seal ID" value={report.sealId} />
                    <Field label="Scale Location" value={report.location} />
                  </div>
                  <figure className="vtr-machine">
                    {report.scaleImageUrl ? (
                      <img src={report.scaleImageUrl} alt="Instrument" />
                    ) : (
                      <span>No image</span>
                    )}
                    <figcaption>Machine</figcaption>
                  </figure>
                </div>
              </section>
            </div>

            <div className="vtr-meta-row" aria-label="VCT and environment">
              <section className="vtr-panel vtr-panel--vct">
                <h2 className="vtr-panel__title">VCT Details</h2>
                <div className="vtr-panel__body">
                  <Field label="VCT Name" value={report.vctName} emphasize />
                  <Field label="VCT Number" value={report.vctNumber} emphasize />
                  <Field label="Type of Test" value={report.verificationType} />
                  <Field label="Test Reference" value={report.testReference} />
                  <Field label="Test Method" value={report.testMethod} />
                  <Field label="Next Due Date" value={report.nextDueDate} />
                </div>
              </section>

              <section className="vtr-panel vtr-panel--green">
                <h2 className="vtr-panel__title">Environmental Conditions</h2>
                <div className="vtr-env">
                  <div>
                    <span>Temperature</span>
                    <strong>{report.temperature}</strong>
                  </div>
                  <div>
                    <span>Relative Humidity</span>
                    <strong>{report.humidity}</strong>
                  </div>
                  <div>
                    <span>Power Supply</span>
                    <strong>{report.powerSupply}</strong>
                  </div>
                </div>
              </section>
            </div>

            <section className="vtr-block" aria-label="Weighing performance">
              <h2 className="vtr-block__title">1. Weighing Performance</h2>
              <p className="vtr-formula">
                E = I + ½e − ΔL − L · Ec = E − E₀ (E₀ = error at or near zero)
              </p>
              <table className="vtr-table">
                <thead>
                  <tr>
                    <th>Sr</th>
                    <th>Load L (kg)</th>
                    <th>Indication I (kg)</th>
                    <th>ΔL (g)</th>
                    <th>Error E (g)</th>
                    <th>Ec (g)</th>
                    <th>mpe (±g)</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {report.weighing.map(row => (
                    <tr key={row.sr}>
                      <td>{row.sr}</td>
                      <td>{formatKgPlain(row.loadKg)}</td>
                      <td>{formatKgPlain(row.indicatedKg)}</td>
                      <td>0</td>
                      <td>{formatGPlain(row.errorG)}</td>
                      <td>{formatGPlain(row.errorG)}</td>
                      <td>{formatPmPlain(row.mpeG)}</td>
                      <td>
                        <ResultChip ok={row.result === 'PASS'} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className={`vtr-overall${passed ? '' : ' is-fail'}`}>
                <strong>Overall Result : {report.overallResult}</strong>
                <span>
                  {passed
                    ? 'Scale is within permissible error limits.'
                    : 'Scale exceeds permissible error limits.'}
                </span>
              </div>
            </section>

            <div className="vtr-tests-row" aria-label="Additional weighing tests">
              <section className="vtr-block">
                <h2 className="vtr-block__title">2. Discrimination</h2>
                <table className="vtr-table vtr-table--mini">
                  <thead>
                    <tr>
                      <th>Load L</th>
                      <th>I₁</th>
                      <th>ΔL</th>
                      <th>1/10 e</th>
                      <th>1.4 e</th>
                      <th>I₂</th>
                      <th>I₂−I₁</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.discrimination.map(row => (
                      <tr key={row.loadKg}>
                        <td>{formatKgPlain(row.loadKg)}</td>
                        <td>{formatKgPlain(row.indication1Kg)}</td>
                        <td>{formatGPlain(row.removedLoadG)}</td>
                        <td>{formatGPlain(row.addTenthDG)}</td>
                        <td>{formatGPlain(row.extraLoadG)}</td>
                        <td>{formatKgPlain(row.indication2Kg)}</td>
                        <td>{formatKgPlain(row.deltaKg)}</td>
                        <td>
                          <ResultChip ok={row.result === 'PASS'} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              {rep ? (
                <section className="vtr-block">
                  <h2 className="vtr-block__title">3. Repeatability · {formatKgPlain(rep.loadKg)} kg</h2>
                  <table className="vtr-table vtr-table--mini">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Indication I (kg)</th>
                        <th>ΔL (g)</th>
                        <th>E (g)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rep.readingsKg.map((reading, index) => (
                        <tr key={index}>
                          <td>{index + 1}</td>
                          <td>{formatKgPlain(reading)}</td>
                          <td>0</td>
                          <td>0</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="vtr-mini__foot">
                    Emax−Emin : {formatGPlain(rep.eMaxMinusEminG)} g · mpe : {formatGPlain(rep.mpeG)}{' '}
                    g · <ResultChip ok={rep.result === 'PASS'} />
                  </p>
                </section>
              ) : null}

              <section className="vtr-block">
                <h2 className="vtr-block__title">4. Eccentricity</h2>
                <table className="vtr-table vtr-table--mini">
                  <thead>
                    <tr>
                      <th>Location</th>
                      <th>Load L</th>
                      <th>Indication I</th>
                      <th>E (g)</th>
                      <th>mpe</th>
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
                        <td>
                          <ResultChip ok={row.result === 'PASS'} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </div>

            <div className="vtr-compliance">
              <span>Instrument conforms to OIML R 76 / LMPC Rules.</span>
              <span>Verified for commercial / trade use.</span>
              <span>Seal / stamping applied : {report.sealId}</span>
            </div>

            <div className="vtr-signoff">
              <div>
                <p className="vtr-signoff__label">Tested By</p>
                <p className="vtr-signoff__name">{report.vctName}</p>
                <p className="vtr-signoff__role">VCT · {report.vctNumber}</p>
              </div>
              <div className="vtr-signoff__stamp">
                <img src={brand.logoSrc} alt="" width={40} height={40} />
                <span>GATC</span>
              </div>
              <div>
                <p className="vtr-signoff__label">Approved By</p>
                <p className="vtr-signoff__name">Authorized Signatory</p>
                <p className="vtr-signoff__role">{brand.companyName}</p>
              </div>
            </div>

            <p className="vtr-footer-bar">
              This is a computer generated report and does not require a signature.
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
