import React from 'react';
import { CheckCircle2, ClipboardList, Info, Scale, ShieldCheck } from 'lucide-react';
import type { VerificationTestOutcome, VerificationTestSummaryRow } from '../lib/verificationTestSummary';

type VerificationResultSummaryProps = {
  instrumentLabel: string;
  tests: VerificationTestSummaryRow[];
  overallResult: VerificationTestOutcome;
  dateTime: string;
  remarks: string;
  infoMessage: string;
};

function ResultBadge({ result }: { result: VerificationTestOutcome }) {
  const isPass = result === 'PASS';
  return (
    <span
      className={`verification-result-badge${
        isPass ? ' verification-result-badge--pass' : ' verification-result-badge--fail'
      }`}
    >
      <CheckCircle2 size={13} aria-hidden />
      {result}
    </span>
  );
}

export const VerificationResultSummary: React.FC<VerificationResultSummaryProps> = ({
  instrumentLabel,
  tests,
  overallResult,
  dateTime,
  remarks,
  infoMessage,
}) => {
  const isPass = overallResult === 'PASS';

  return (
    <section className="verification-result-summary" aria-labelledby="verification-result-summary-title">
      <h3 id="verification-result-summary-title" className="verification-result-summary-title">
        Metrological Test Result
      </h3>

      <div className="verification-result-summary-instrument">
        <span className="verification-result-summary-instrument-icon" aria-hidden>
          <Scale size={22} />
        </span>
        <div className="verification-result-summary-instrument-text">
          <span className="verification-result-summary-instrument-label">Instrument</span>
          <span className="verification-result-summary-instrument-name">{instrumentLabel}</span>
        </div>
      </div>

      <div className="verification-result-summary-table-wrap">
        <table className="verification-result-summary-table">
          <thead>
            <tr>
              <th scope="col">Sl. No.</th>
              <th scope="col">Test Name (Parameter)</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {tests.map((test, index) => (
              <tr key={test.name}>
                <td>{index + 1}</td>
                <td>{test.name}</td>
                <td>
                  <ResultBadge result={test.result} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="verification-result-summary-footer">
        <div className="verification-result-summary-footer-top">
          <div className="verification-result-summary-overall">
            <span className="verification-result-summary-overall-icon" aria-hidden>
              <ShieldCheck size={28} />
            </span>
            <div className="verification-result-summary-overall-text">
              <span className="verification-result-summary-overall-label">Overall Result</span>
              <span
                className={`verification-result-summary-overall-value${
                  isPass ? ' verification-result-summary-overall-value--pass' : ' verification-result-summary-overall-value--fail'
                }`}
              >
                {overallResult}
              </span>
            </div>
          </div>
          <div className="verification-result-summary-datetime">
            <span className="verification-result-summary-datetime-label">Date &amp; Time</span>
            <span className="verification-result-summary-datetime-value">{dateTime}</span>
          </div>
        </div>

        <div className="verification-result-summary-remarks">
          <span className="verification-result-summary-remarks-icon" aria-hidden>
            <ClipboardList size={20} />
          </span>
          <div className="verification-result-summary-remarks-text">
            <span className="verification-result-summary-remarks-label">Remarks</span>
            <p className="verification-result-summary-remarks-value mb-0">{remarks}</p>
          </div>
        </div>

        <p className="verification-result-summary-info mb-0">
          <Info size={15} aria-hidden />
          {infoMessage}
        </p>
      </div>
    </section>
  );
};
