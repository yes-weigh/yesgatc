import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  verificationDeviceDetailsBlockReason,
  verificationDevicePhotosBlockReason,
  type VerificationInstrumentSubStage,
} from '../../lib/verificationFormSteps';
import {
  emptyDeviceVerificationImagesState,
  type DeviceVerificationImagesState,
  type VerificationImageKind,
} from '../../lib/verificationDeviceImages';
import type { DeviceRvDocumentsState, RvDocumentKind } from '../../lib/verificationRvDeviceImages';
import type { JobType, RcFeesStructure, VerificationLocation } from '../../types';
import type { VerificationDeviceRowValues } from '../../lib/siteCalibrationProfileFields';
import type { GeoStampCoordinates, StampWeather } from '../../components/VerificationPhotoUploadSlot';
import { VerificationDeviceEvidenceFields } from './VerificationDeviceEvidenceFields';
import { VerificationDeviceFields } from './VerificationDeviceFields';

type VerificationInstrumentTileProps = {
  index: number;
  totalDevices: number;
  row: VerificationDeviceRowValues;
  sessionIndex: number;
  devices: VerificationDeviceRowValues[];
  deviceImages: Record<string, DeviceVerificationImagesState>;
  deviceRvImages?: Record<string, DeviceRvDocumentsState>;
  verificationType: JobType | '';
  verificationLocation: VerificationLocation | '';
  verificationSubject: 'self' | 'customer';
  feesStructure: RcFeesStructure;
  onDeviceChange: (localId: string, patch: Partial<VerificationDeviceRowValues>) => void;
  onDeviceAdd: () => void;
  onDeviceRemove: (localId: string) => void;
  onDeviceImageSelect: (localId: string, kind: VerificationImageKind, file: File) => void;
  onDeviceImageRemove: (localId: string, kind: VerificationImageKind) => void;
  onDeviceRvDocumentSelect?: (localId: string, kind: RvDocumentKind, file: File) => void;
  onDeviceRvDocumentRemove?: (localId: string, kind: RvDocumentKind) => void;
  submitting: boolean;
  readOnly?: boolean;
  lockCustomer?: boolean;
  isSelf?: boolean;
  laboratorySealIdentification?: string;
  geoStampCoords?: GeoStampCoordinates | null;
  geoStampWeather?: StampWeather | null;
  tileRef?: (node: HTMLElement | null) => void;
};

export const VerificationInstrumentTile: React.FC<VerificationInstrumentTileProps> = ({
  index,
  totalDevices,
  row,
  sessionIndex,
  devices,
  deviceImages,
  deviceRvImages = {},
  verificationType,
  verificationLocation,
  verificationSubject,
  feesStructure,
  onDeviceChange,
  onDeviceAdd,
  onDeviceRemove,
  onDeviceImageSelect,
  onDeviceImageRemove,
  onDeviceRvDocumentSelect,
  onDeviceRvDocumentRemove,
  submitting,
  readOnly = false,
  lockCustomer = false,
  isSelf = false,
  laboratorySealIdentification = '',
  geoStampCoords = null,
  geoStampWeather = null,
  tileRef,
}) => {
  const localId = row.localId;
  const images = deviceImages[localId] ?? emptyDeviceVerificationImagesState();
  const rvDocs = deviceRvImages[localId];
  const scrollRef = useRef<HTMLDivElement>(null);
  const [subStage, setSubStage] = useState<VerificationInstrumentSubStage>('photos');
  const [focusSerialRequest, setFocusSerialRequest] = useState(0);
  const serialFocusDoneRef = useRef(false);
  const wasPhotosCompleteRef = useRef(false);

  const photosComplete =
    verificationDevicePhotosBlockReason(
      row,
      sessionIndex,
      images,
      rvDocs,
      verificationType,
    ) === null;
  const detailsComplete =
    verificationDeviceDetailsBlockReason(row, sessionIndex, verificationType) === null;
  const title = row.serialNumber.trim() || row.productName.trim() || `Instrument ${index + 1}`;

  const scrollToStage = useCallback(
    (stage: VerificationInstrumentSubStage, behavior: ScrollBehavior = 'smooth') => {
      const el = scrollRef.current;
      if (!el) return;
      if (stage === 'details' && !photosComplete) return;
      el.scrollTo({ left: stage === 'photos' ? 0 : el.clientWidth, behavior });
      setSubStage(stage);
      if (stage === 'details' && !serialFocusDoneRef.current) {
        serialFocusDoneRef.current = true;
        setFocusSerialRequest(n => n + 1);
      }
    },
    [photosComplete],
  );

  useEffect(() => {
    if (!photosComplete) {
      if (subStage === 'details') {
        scrollToStage('photos', 'auto');
      }
      wasPhotosCompleteRef.current = false;
      return;
    }
    if (!wasPhotosCompleteRef.current) {
      wasPhotosCompleteRef.current = true;
    }
  }, [photosComplete, subStage, scrollToStage]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el || el.clientWidth <= 0) return;
    const slideIndex = Math.round(el.scrollLeft / el.clientWidth);
    if (slideIndex >= 1 && !photosComplete) {
      el.scrollTo({ left: 0, behavior: 'smooth' });
      setSubStage('photos');
      return;
    }
    setSubStage(slideIndex === 0 ? 'photos' : 'details');
  };

  return (
    <article
      ref={tileRef}
      className="verification-instrument-tile"
      id={`verification-instrument-tile-${localId}`}
    >
      <header className="verification-instrument-tile-head">
        <div className="verification-instrument-tile-head-text">
          <h3 className="verification-instrument-tile-title">Instrument {index + 1}</h3>
          <p className="verification-instrument-tile-subtitle mb-0">{title}</p>
        </div>
        <div className="verification-instrument-tile-statuses">
          <span
            className={[
              'verification-instrument-tile-status',
              photosComplete
                ? 'verification-instrument-tile-status--ok'
                : 'verification-instrument-tile-status--pending',
            ].join(' ')}
          >
            Photos {photosComplete ? '✓' : '…'}
          </span>
          <span
            className={[
              'verification-instrument-tile-status',
              detailsComplete
                ? 'verification-instrument-tile-status--ok'
                : 'verification-instrument-tile-status--pending',
            ].join(' ')}
          >
            Details {detailsComplete ? '✓' : '…'}
          </span>
        </div>
      </header>

      <div className="verification-instrument-tile-substepper" role="tablist" aria-label="Instrument steps">
        <button
          type="button"
          role="tab"
          aria-selected={subStage === 'photos'}
          className={[
            'verification-instrument-tile-substep',
            subStage === 'photos' ? 'verification-instrument-tile-substep--active' : '',
            photosComplete ? 'verification-instrument-tile-substep--complete' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={() => scrollToStage('photos')}
        >
          1 · Photos
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subStage === 'details'}
          disabled={!photosComplete}
          className={[
            'verification-instrument-tile-substep',
            subStage === 'details' ? 'verification-instrument-tile-substep--active' : '',
            detailsComplete ? 'verification-instrument-tile-substep--complete' : '',
            !photosComplete ? 'verification-instrument-tile-substep--locked' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={() => scrollToStage('details')}
        >
          2 · Details
        </button>
      </div>

      <div
        ref={scrollRef}
        className={[
          'verification-instrument-tile-track',
          !photosComplete ? 'verification-instrument-tile-track--photos-only' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onScroll={handleScroll}
      >
        <section className="verification-instrument-tile-slide" aria-label="Photos">
          <h4 className="verification-instrument-tile-section-title">Photos</h4>
          <div className="verification-instrument-tile-slide-content">
            <VerificationDeviceEvidenceFields
              device={row}
              devices={devices}
              deviceIndex={index}
              totalDevices={totalDevices}
              verificationType={verificationType}
              verificationLocation={verificationLocation}
              verificationSubject={verificationSubject}
              feesStructure={feesStructure}
              images={images}
              rvDocuments={rvDocs}
              onImageSelect={(kind, file) => onDeviceImageSelect(localId, kind, file)}
              onImageRemove={kind => onDeviceImageRemove(localId, kind)}
              onRvDocumentSelect={
                onDeviceRvDocumentSelect
                  ? (kind, file) => onDeviceRvDocumentSelect(localId, kind, file)
                  : undefined
              }
              onRvDocumentRemove={
                onDeviceRvDocumentRemove
                  ? kind => onDeviceRvDocumentRemove(localId, kind)
                  : undefined
              }
              submitting={submitting}
              readOnly={readOnly}
              embedded
              geoStampCoords={geoStampCoords}
              geoStampWeather={geoStampWeather}
            />
          </div>
          {photosComplete && !readOnly && (
            <button
              type="button"
              className="verification-form-btn verification-form-btn--continue verification-instrument-tile-advance-btn"
              onClick={() => scrollToStage('details')}
            >
              Enter details <ChevronRight size={16} aria-hidden />
            </button>
          )}
          {!photosComplete && (
            <p className="verification-instrument-tile-lock-hint mb-0">
              Complete required photos to unlock details — swipe right when ready.
            </p>
          )}
        </section>

        <section
          className={[
            'verification-instrument-tile-slide',
            'verification-instrument-tile-slide--details',
            !photosComplete ? 'verification-instrument-tile-slide--locked' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-label="Details"
          aria-hidden={!photosComplete}
        >
          <h4 className="verification-instrument-tile-section-title">Details</h4>
          <div className="verification-instrument-tile-slide-content">
          {photosComplete ? (
            <VerificationDeviceFields
              devices={devices}
              deviceImages={deviceImages}
              deviceRvImages={deviceRvImages}
              verificationType={verificationType}
              onDeviceChange={onDeviceChange}
              onDeviceAdd={onDeviceAdd}
              onDeviceRemove={onDeviceRemove}
              onDeviceImageSelect={onDeviceImageSelect}
              onDeviceImageRemove={onDeviceImageRemove}
              onDeviceRvDocumentSelect={onDeviceRvDocumentSelect}
              onDeviceRvDocumentRemove={onDeviceRvDocumentRemove}
              verificationLocation={verificationLocation}
              verificationSubject={verificationSubject}
              feesStructure={feesStructure}
              submitting={submitting}
              readOnly={readOnly}
              laboratorySealIdentification={laboratorySealIdentification}
              manualEntryOnly={isSelf}
              createMode={!lockCustomer && !readOnly && !isSelf}
              compact
              includeEvidence={false}
              allowAddDevice={false}
              visibleDeviceLocalId={localId}
              embedded
              focusSerialRequest={focusSerialRequest}
            />
          ) : (
            <p className="verification-instrument-tile-lock-hint mb-0">
              Upload all required photos first, then swipe right to enter details.
            </p>
          )}
          </div>
          {photosComplete && !readOnly && (
            <button
              type="button"
              className="verification-form-btn verification-form-btn--back verification-instrument-tile-back-btn"
              onClick={() => scrollToStage('photos')}
            >
              <ChevronLeft size={16} aria-hidden /> Back to photos
            </button>
          )}
        </section>
      </div>
    </article>
  );
};
