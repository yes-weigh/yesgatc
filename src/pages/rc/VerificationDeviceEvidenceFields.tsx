import React from 'react';
import { Camera, Plus } from 'lucide-react';
import {
  VerificationPhotoUploadSection,
  VerificationPhotoUploadSlot,
} from '../../components/VerificationPhotoUploadSlot';
import {
  emptyDeviceImageSlot,
  isVerificationImageRequired,
  VERIFICATION_IMAGE_CONFIG,
  VERIFICATION_IMAGE_KINDS,
  type DeviceVerificationImagesState,
  type VerificationImageKind,
} from '../../lib/verificationDeviceImages';
import {
  emptyDeviceRvDocumentsState,
  RV_DOCUMENT_CONFIG,
  RV_DOCUMENT_KINDS,
  type DeviceRvDocumentsState,
  type RvDocumentKind,
} from '../../lib/verificationRvDeviceImages';
import type { JobType, VerificationDeviceRowValues } from '../../lib/siteCalibrationProfileFields';

type VerificationDeviceEvidenceFieldsProps = {
  device: VerificationDeviceRowValues;
  deviceIndex: number;
  totalDevices: number;
  verificationType?: JobType | '';
  images: DeviceVerificationImagesState;
  rvDocuments?: DeviceRvDocumentsState;
  onImageSelect: (kind: VerificationImageKind, file: File) => void;
  onImageRemove: (kind: VerificationImageKind) => void;
  onRvDocumentSelect?: (kind: RvDocumentKind, file: File) => void;
  onRvDocumentRemove?: (kind: RvDocumentKind) => void;
  submitting: boolean;
  readOnly?: boolean;
  showAddDevice?: boolean;
  onAddDevice?: () => void;
};

export const VerificationDeviceEvidenceFields: React.FC<VerificationDeviceEvidenceFieldsProps> = ({
  device,
  deviceIndex,
  totalDevices,
  verificationType = 'OV',
  images,
  rvDocuments = emptyDeviceRvDocumentsState(),
  onImageSelect,
  onImageRemove,
  onRvDocumentSelect,
  onRvDocumentRemove,
  submitting,
  readOnly = false,
  showAddDevice = false,
  onAddDevice,
}) => {
  const locked = submitting || readOnly;
  const isRv = verificationType === 'RV';
  const deviceLabel = device.productName.trim() || device.serialNumber.trim() || `Device ${deviceIndex + 1}`;

  return (
    <section className="verification-evidence-panel">
      <header className="verification-evidence-panel-head">
        <span className="verification-evidence-panel-head-icon" aria-hidden>
          <Camera size={18} />
        </span>
        <div className="verification-evidence-panel-head-text">
          <h3 className="verification-evidence-panel-title">Device evidence</h3>
          <p className="verification-evidence-panel-meta mb-0">
            Device {deviceIndex + 1} of {totalDevices}
            {totalDevices > 1 && deviceIndex < totalDevices - 1 ? ' · use Next device to continue' : ''}
          </p>
        </div>
      </header>

      <div className="verification-evidence-device-summary">
        <span className="verification-evidence-device-name">{deviceLabel}</span>
        {device.serialNumber.trim() && (
          <span className="verification-evidence-device-serial">{device.serialNumber.trim()}</span>
        )}
      </div>

      <VerificationPhotoUploadSection title="Upload verification photos">
        {VERIFICATION_IMAGE_KINDS.map(kind => {
          const config = VERIFICATION_IMAGE_CONFIG[kind];
          const slot = images[kind] ?? emptyDeviceImageSlot();
          return (
            <VerificationPhotoUploadSlot
              key={kind}
              label={config.label}
              required={isVerificationImageRequired(kind, verificationType)}
              file={slot.file}
              uploading={slot.uploading}
              progress={slot.progress}
              disabled={locked}
              onSelect={file => onImageSelect(kind, file)}
              onRemove={() => onImageRemove(kind)}
            />
          );
        })}
      </VerificationPhotoUploadSection>

      {isRv && (
        <VerificationPhotoUploadSection title="Upload previous documents" columns={2} headerIcon="document">
          {RV_DOCUMENT_KINDS.map(kind => {
            const config = RV_DOCUMENT_CONFIG[kind];
            const slot = rvDocuments[kind] ?? emptyDeviceImageSlot();
            return (
              <VerificationPhotoUploadSlot
                key={kind}
                label={config.label}
                required
                file={slot.file}
                uploading={slot.uploading}
                progress={slot.progress}
                disabled={locked}
                icon={kind === 'oldInvoice' ? 'invoice' : 'document'}
                onSelect={file => onRvDocumentSelect?.(kind, file)}
                onRemove={() => onRvDocumentRemove?.(kind)}
              />
            );
          })}
        </VerificationPhotoUploadSection>
      )}

      {showAddDevice && onAddDevice && (
        <div className="verification-evidence-add-device">
          <button
            type="button"
            className="verification-evidence-add-device-btn"
            onClick={onAddDevice}
            disabled={locked}
          >
            <Plus size={15} aria-hidden />
            Add another device
          </button>
          <p className="verification-evidence-add-device-hint mb-0">
            Opens the Devices step to enter details, then return here for photos.
          </p>
        </div>
      )}
    </section>
  );
};
