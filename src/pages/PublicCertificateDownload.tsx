import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download, Search } from 'lucide-react';
import { APP_VERSION } from '../lib/appVersion';
import { formatVerificationListDate } from '../lib/verificationListFormat';
import {
  downloadPublicCertificatePdf,
  lookupPublicCertificates,
  mapPublicCertificateLookupError,
  publicCertificateFileName,
  type PublicCertificateHit,
} from '../lib/publicCertificateLookup';

export const PublicCertificateDownload: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const urlQuery = params.get('q') ?? '';

  const [query, setQuery] = useState(urlQuery);
  const [hits, setHits] = useState<PublicCertificateHit[] | null>(null);
  const [searched, setSearched] = useState('');
  const [loading, setLoading] = useState(false);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = 'Download certificate · YES LAB';
    return () => {
      document.title = 'YES LAB';
    };
  }, []);

  useEffect(() => {
    const next = urlQuery.trim();
    setQuery(urlQuery);
    if (!next) {
      setHits(null);
      setSearched('');
      setError('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    void lookupPublicCertificates(next)
      .then(rows => {
        if (cancelled) return;
        setHits(rows);
        setSearched(next);
      })
      .catch(err => {
        if (cancelled) return;
        setHits(null);
        setSearched(next);
        setError(mapPublicCertificateLookupError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [urlQuery]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const next = query.trim();
    if (!next) {
      setError('Enter a serial or certificate number.');
      return;
    }
    setParams({ q: next }, { replace: true });
  };

  const handleDownload = async (hit: PublicCertificateHit) => {
    if (!hit.pdfUrl) return;
    const key = hit.certificateNumber || hit.serialNumber || hit.pdfUrl;
    setDownloadingKey(key);
    try {
      await downloadPublicCertificatePdf(hit.pdfUrl, publicCertificateFileName(hit));
    } finally {
      setDownloadingKey(null);
    }
  };

  return (
    <div className="login-container">
      <div className="login-box glass public-cert-box">
        <div className="login-header public-cert-header">
          <img src="/brand/logo-dark.png" alt="YES LAB" className="login-logo" />
          <p className="login-version">{APP_VERSION}</p>
          <h1>Download certificate</h1>
          <p>Enter the instrument serial number or certificate number.</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form public-cert-form">
          {error ? <div className="login-error">{error}</div> : null}

          <div className="form-group">
            <label htmlFor="public-cert-query">Serial or certificate number</label>
            <div className="input-icon-wrap">
              <Search size={18} className="input-icon" />
              <input
                id="public-cert-query"
                type="search"
                className="input-field input-with-icon"
                placeholder="e.g. ABC12345 or IND/GATC/KL/…"
                value={query}
                onChange={event => setQuery(event.target.value)}
                autoFocus
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </div>

          <button type="submit" className="btn btn-primary w-full mt-2" disabled={loading}>
            {loading ? <span className="spinner-inline"></span> : 'Find certificate'}
          </button>
        </form>

        {hits && !error ? (
          <div className="public-cert-results" aria-live="polite">
            {hits.length === 0 ? (
              <p className="public-cert-empty">No certificate found for {searched}.</p>
            ) : (
              <ul className="public-cert-list">
                {hits.map((hit, index) => {
                  const key = `${index}:${hit.certificateNumber ?? ''}:${hit.serialNumber ?? ''}:${hit.certifiedAt ?? ''}`;
                  const downloadKey = hit.certificateNumber || hit.serialNumber || hit.pdfUrl || key;
                  return (
                    <li key={key} className="public-cert-card">
                      <div className="public-cert-card__top">
                        {hit.verificationType ? (
                          <span className="public-cert-type">{hit.verificationType}</span>
                        ) : null}
                        {hit.voided ? <span className="public-cert-voided">Voided</span> : null}
                      </div>
                      <p className="public-cert-number text-mono">
                        {hit.certificateNumber || 'Certificate'}
                      </p>
                      <dl className="public-cert-meta">
                        <div>
                          <dt>Serial</dt>
                          <dd className="text-mono">{hit.serialNumber || '—'}</dd>
                        </div>
                        <div>
                          <dt>Party</dt>
                          <dd>{hit.customerName || '—'}</dd>
                        </div>
                        <div>
                          <dt>Certified</dt>
                          <dd>{formatVerificationListDate(hit.certifiedAt ?? undefined)}</dd>
                        </div>
                      </dl>
                      {hit.pdfUrl ? (
                        <button
                          type="button"
                          className="btn btn-primary w-full"
                          disabled={downloadingKey === downloadKey}
                          onClick={() => void handleDownload(hit)}
                        >
                          {downloadingKey === downloadKey ? (
                            <span className="spinner-inline"></span>
                          ) : (
                            <>
                              <Download size={18} />
                              Download PDF
                            </>
                          )}
                        </button>
                      ) : (
                        <p className="public-cert-unavailable">
                          {hit.voided ? 'This certificate is voided.' : 'PDF not available yet.'}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}

        <div className="login-footer">
          <p>
            <Link to="/login" className="public-cert-staff">Staff sign in</Link>
          </p>
          <p className="text-muted text-sm">© Interweighing PVT LTD, 2026</p>
        </div>
      </div>

      <div className="bg-shapes">
        <div className="shape shape-1"></div>
        <div className="shape shape-2"></div>
        <div className="shape shape-3"></div>
      </div>
    </div>
  );
};
