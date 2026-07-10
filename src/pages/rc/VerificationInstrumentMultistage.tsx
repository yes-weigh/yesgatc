import React, { useEffect, useRef } from 'react';
import { Plus } from 'lucide-react';
import { resolveRcFeesStructure } from '../../lib/rcProfileFields';
import type { DeviceVerificationImagesState, VerificationImageKind } from '../../lib/verificationDeviceImages';
import type { DeviceRvDocumentsState, RvDocumentKind } from '../../lib/verificationRvDeviceImages';
import type { FirestoreUserDoc, JobType, VerificationLocation } from '../../types';
import type { VerificationDeviceRowValues } from '../../lib/siteCalibrationProfileFields';
import type { GeoStampCoordinates, StampWeather } from '../../components/VerificationPhotoUploadSlot';
import { VerificationInstrumentTile } from './VerificationInstrumentTile';

export type InstrumentEntry = {
  row: VerificationDeviceRowValues;
  sessionIndex: number;
};

type VerificationInstrumentMultistageProps = {
  entries: InstrumentEntry[];
  devices: VerificationDeviceRowValues[];
  deviceImages: Record<string, DeviceVerificationImagesState>;
  deviceRvImages?: Record<string, DeviceRvDocumentsState>;
  verificationType: JobType | '';
  verificationLocation: VerificationLocation | '';
  verificationSubject: 'self' | 'customer';
  onDeviceChange: (localId: string, patch: Partial<VerificationDeviceRowValues>) => void;
  onDeviceAdd: () => void;
  onDeviceRemove: (localId: string) => void;
  onDeviceImageSelect: (localId: string, kind: VerificationImageKind, file: File) => void;
  onDeviceImageRemove: (localId: string, kind: VerificationImageKind) => void;
  onDeviceRvDocumentSelect?: (localId: string, kind: RvDocumentKind, file: File) => void;
  onDeviceRvDocumentRemove?: (localId: string, kind: RvDocumentKind) => void;
  rcProfile: FirestoreUserDoc | null;
  submitting: boolean;
  readOnly?: boolean;
  lockCustomer?: boolean;
  isSelf?: boolean;
  laboratorySealIdentification?: string;
  canAddInstrument?: boolean;
  onAddInstrument?: () => void;
  showDevices?: boolean;
  geoStampCoords?: GeoStampCoordinates | null;
  geoStampWeather?: StampWeather | null;
};

export const VerificationInstrumentMultistage: React.FC<VerificationInstrumentMultistageProps> = ({
  entries,
  devices,
  deviceImages,
  deviceRvImages = {},
  verificationType,
  verificationLocation,
  verificationSubject,
  onDeviceChange,
  onDeviceAdd,
  onDeviceRemove,
  onDeviceImageSelect,
  onDeviceImageRemove,
  onDeviceRvDocumentSelect,
  onDeviceRvDocumentRemove,
  rcProfile,
  submitting,
  readOnly = false,
  lockCustomer = false,
  isSelf = false,
  laboratorySealIdentification = '',
  canAddInstrument = false,
  onAddInstrument,
  showDevices = true,
  geoStampCoords = null,
  geoStampWeather = null,
}) => {
  const locked = submitting || readOnly;
  const feesStructure = resolveRcFeesStructure(rcProfile);
  const tileRefs = useRef<Record<string, HTMLElement | null>>({});
  const prevEntryCountRef = useRef(entries.length);

  useEffect(() => {
    if (entries.length > prevEntryCountRef.current) {
      const last = entries[entries.length - 1];
      const node = tileRefs.current[last.row.localId];
      node?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    prevEntryCountRef.current = entries.length;
  }, [entries]);

  if (!showDevices) {
    return (
      <p className="text-muted text-sm mb-0">
        Select a customer above to load instruments.
      </p>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="verification-evidence-empty">
        <p className="text-muted text-sm mb-0">
          {devices.length > 0
            ? 'Select at least one instrument to verify, or add a new one.'
            : 'Add an instrument — swipe right within each tile after photos are complete.'}
        </p>
        {canAddInstrument && onAddInstrument && (
          <button
            type="button"
            className="verification-evidence-add-device-btn"
            onClick={onAddInstrument}
            disabled={locked}
          >
            <Plus size={15} aria-hidden />
            Add instrument
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="verification-instrument-tiles">
      {entries.map((entry, index) => (
        <VerificationInstrumentTile
          key={entry.row.localId}
          index={index}
          totalDevices={entries.length}
          row={entry.row}
          sessionIndex={entry.sessionIndex}
          devices={devices}
          deviceImages={deviceImages}
          deviceRvImages={deviceRvImages}
          verificationType={verificationType}
          verificationLocation={verificationLocation}
          verificationSubject={verificationSubject}
          feesStructure={feesStructure}
          onDeviceChange={onDeviceChange}
          onDeviceAdd={onDeviceAdd}
          onDeviceRemove={onDeviceRemove}
          onDeviceImageSelect={onDeviceImageSelect}
          onDeviceImageRemove={onDeviceImageRemove}
          onDeviceRvDocumentSelect={onDeviceRvDocumentSelect}
          onDeviceRvDocumentRemove={onDeviceRvDocumentRemove}
          submitting={submitting}
          readOnly={readOnly}
          lockCustomer={lockCustomer}
          isSelf={isSelf}
          laboratorySealIdentification={laboratorySealIdentification}
          geoStampCoords={geoStampCoords}
          geoStampWeather={geoStampWeather}
          tileRef={node => {
            tileRefs.current[entry.row.localId] = node;
          }}
        />
      ))}

      {canAddInstrument && onAddInstrument && (
        <div className="verification-instrument-tiles-footer">
          <button
            type="button"
            className="verification-evidence-add-device-btn"
            onClick={onAddInstrument}
            disabled={locked}
          >
            <Plus size={15} aria-hidden />
            Add another instrument
          </button>
          <p className="verification-evidence-add-device-hint mb-0">
            Each tile starts on photos — swipe right for details once required photos are uploaded.
          </p>
        </div>
      )}
    </div>
  );
};
