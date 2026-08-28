import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Award,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Globe,
  QrCode,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { formatVerificationListDate } from '../lib/verificationListFormat';
import {
  formatPublicCertificateNextDue,
  formatPublicCertificateSpecs,
  lookupPublicCertificates,
  mapPublicCertificateLookupError,
  publicCertificatePhotos,
  type PublicCertificateHit,
  type PublicCertificatePhoto,
} from '../lib/publicCertificateLookup';
import { prefetchPdfJs } from '../lib/pdfJs';
import { PublicCertificatePdfPopup } from '../components/PublicCertificatePdfPopup';

function CarouselSlide({ photo }: { photo: PublicCertificatePhoto }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [photo.url]);

  return (
    <figure className="pcd-photo">
      {failed ? (
        <div className="pcd-photo--empty">{photo.label} unavailable</div>
      ) : (
        <img src={photo.url} alt={photo.label} onError={() => setFailed(true)} />
      )}
    </figure>
  );
}

function PublicPhotoCarousel({ photos }: { photos: PublicCertificatePhoto[] }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
    scrollerRef.current?.scrollTo({ left: 0 });
  }, [photos]);

  if (!photos.length) return null;

  const go = (next: number) => {
    const clamped = Math.min(photos.length - 1, Math.max(0, next));
    const el = scrollerRef.current;
    setIndex(clamped);
    el?.scrollTo({ left: clamped * el.clientWidth, behavior: 'smooth' });
  };

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el || el.clientWidth === 0) return;
    const next = Math.round(el.scrollLeft / el.clientWidth);
    setIndex(Math.min(photos.length - 1, Math.max(0, next)));
  };

  const multi = photos.length > 1;

  return (
    <div className="pcd-carousel">
      <div className="pcd-carousel-stage">
        <div
          ref={scrollerRef}
          className="pcd-carousel-track"
          onScroll={onScroll}
          tabIndex={multi ? 0 : undefined}
          role="region"
          aria-roledescription="carousel"
          aria-label="Verification photos"
          onKeyDown={event => {
            if (!multi) return;
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              go(index - 1);
            }
            if (event.key === 'ArrowRight') {
              event.preventDefault();
              go(index + 1);
            }
          }}
        >
          {photos.map(photo => (
            <CarouselSlide key={photo.kind} photo={photo} />
          ))}
        </div>
        {multi ? (
          <>
            <button
              type="button"
              className="pcd-carousel-nav pcd-carousel-nav--prev"
              aria-label="Previous photo"
              disabled={index === 0}
              onClick={() => go(index - 1)}
            >
              <ChevronLeft size={16} aria-hidden />
            </button>
            <button
              type="button"
              className="pcd-carousel-nav pcd-carousel-nav--next"
              aria-label="Next photo"
              disabled={index === photos.length - 1}
              onClick={() => go(index + 1)}
            >
              <ChevronRight size={16} aria-hidden />
            </button>
          </>
        ) : null}
      </div>
      {multi ? (
        <div className="pcd-carousel-foot">
          <span>{photos[index]?.label}</span>
          <div className="pcd-carousel-dots">
            {photos.map((photo, i) => (
              <button
                key={photo.kind}
                type="button"
                className={i === index ? 'is-active' : undefined}
                aria-label={`${photo.label}, ${i + 1} of ${photos.length}`}
                aria-current={i === index ? 'true' : undefined}
                onClick={() => go(i)}
              />
            ))}
          </div>
        </div>
      ) : photos[0] ? (
        <p className="pcd-carousel-foot mb-0"><span>{photos[0].label}</span></p>
      ) : null}
    </div>
  );
}

export const PublicCertificateDownload: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const urlQuery = params.get('q') ?? '';

  const [query, setQuery] = useState(urlQuery);
  const [hits, setHits] = useState<PublicCertificateHit[] | null>(null);
  const [searched, setSearched] = useState('');
  const [loading, setLoading] = useState(false);
  const [previewHit, setPreviewHit] = useState<PublicCertificateHit | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = 'Download Certificate · YES LAB';
    prefetchPdfJs();
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

  const showLandingChrome = !(hits && hits.length > 0);

  return (
    <div className={showLandingChrome ? 'pcd' : 'pcd pcd--result'}>
      <div className="pcd-shell">
        {showLandingChrome ? (
          <>
            <div className="pcd-lang" aria-label="Language">
              <Globe size={14} aria-hidden />
              <span>English</span>
              <ChevronDown size={14} aria-hidden />
            </div>

            <header className="pcd-brand">
              <img src="/brand/logo-dark.png" alt="YES LAB" className="pcd-logo" />
              <p className="pcd-company mb-0">INTERWEIGHING PVT LTD</p>
            </header>

            <h1 className="pcd-title">
              Download <span>Certificate</span>
            </h1>
            <div className="pcd-rule" aria-hidden>
              <span />
              <ShieldCheck size={16} />
              <span />
            </div>
          </>
        ) : null}

        <form onSubmit={handleSubmit} className="pcd-panel">
          {error ? <div className="pcd-error">{error}</div> : null}

          <label htmlFor="public-cert-query" className="sr-only">
            Instrument serial number or certificate number
          </label>
          <div className="pcd-search">
            <input
              id="public-cert-query"
              type="search"
              placeholder="Serial or certificate number"
              value={query}
              onChange={event => setQuery(event.target.value)}
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit" className="pcd-submit pcd-submit--icon" disabled={loading} aria-label="Find Certificate">
              {loading ? <span className="spinner-inline" /> : <Search size={18} aria-hidden />}
            </button>
          </div>
        </form>

        {hits && !error ? (
          <div className="pcd-results" aria-live="polite">
            {hits.length === 0 ? (
              <p className="pcd-empty mb-0">No certificate found for {searched}.</p>
            ) : (
              <ul className="pcd-list">
                {hits.map((hit, index) => {
                  const key = `${index}:${hit.certificateNumber ?? ''}:${hit.serialNumber ?? ''}:${hit.certifiedAt ?? ''}`;
                  const specs = formatPublicCertificateSpecs(hit);
                  const photos = publicCertificatePhotos(hit);
                  return (
                    <li key={key} className="pcd-card">
                      {hit.voided ? <span className="pcd-voided">Voided</span> : null}
                      <div className="pcd-head">
                        <div className="pcd-head-vc">
                          <p className="pcd-number text-mono mb-0">
                            {hit.certificateNumber || '—'}
                          </p>
                          <p className="pcd-head-dates mb-0">
                            {formatVerificationListDate(hit.certifiedAt ?? undefined)}
                            <span aria-hidden>·</span>
                            Due {formatPublicCertificateNextDue(hit.certifiedAt)}
                          </p>
                        </div>
                        {hit.pdfUrl ? (
                          <button
                            type="button"
                            className="pcd-dl"
                            aria-label="Download PDF"
                            onClick={() => setPreviewHit(hit)}
                          >
                            <Download size={18} aria-hidden />
                          </button>
                        ) : null}
                      </div>
                      <PublicPhotoCarousel photos={photos} />
                      <dl className="pcd-specs">
                        <div>
                          <dt>Max</dt>
                          <dd>{specs.max}</dd>
                        </div>
                        <div>
                          <dt>Min</dt>
                          <dd>{specs.min}</dd>
                        </div>
                        <div>
                          <dt>e</dt>
                          <dd>{specs.e}</dd>
                        </div>
                        <div>
                          <dt>Class</dt>
                          <dd>{specs.accuracyClass}</dd>
                        </div>
                      </dl>
                      <p className="pcd-party mb-0">{hit.customerName || '—'}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}

        {showLandingChrome ? (
          <>
            <aside className="pcd-note">
              <ShieldCheck size={18} aria-hidden />
              <p className="mb-0">
                Please ensure the serial number / certificate number is entered correctly.
              </p>
            </aside>

            <p className="pcd-gatc mb-0">GOVERNMENT APPROVED TEST CENTER</p>

            <ul className="pcd-trust">
              <li>
                <ShieldCheck size={18} aria-hidden />
                Government Verified
              </li>
              <li>
                <Award size={18} aria-hidden />
                Digitally Signed
              </li>
              <li>
                <QrCode size={18} aria-hidden />
                QR verification
              </li>
            </ul>

            <p className="pcd-copy mb-0">
              <ShieldCheck size={14} aria-hidden />
              © Interweighing Pvt Ltd, 2026
            </p>
          </>
        ) : null}
      </div>
      <PublicCertificatePdfPopup hit={previewHit} onClose={() => setPreviewHit(null)} />
    </div>
  );
};
