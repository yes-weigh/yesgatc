import React from 'react';
import {
  VerificationPhotoUploadSection,
  VerificationPhotoUploadSlot,
} from '../../components/VerificationPhotoUploadSlot';
import {
  emptyDeviceImageSlot,
  type DeviceImageSlotState,
} from '../../lib/verificationDeviceImages';
import {
  PERFORMER_PHOTO_CONFIG,
  PERFORMER_PHOTO_KINDS,
  type PerformerPhotoKind,
  type PerformerPhotosState,
} from '../../lib/verificationPerformerPhotos';

type VerificationPerformerPhotoFieldsProps = {
  photos: PerformerPhotosState;
  disabled?: boolean;
  onSelect: (kind: PerformerPhotoKind, file: File) => void;
  onRemove: (kind: PerformerPhotoKind) => void;
};

export const VerificationPerformerPhotoFields: React.FC<VerificationPerformerPhotoFieldsProps> = ({
  photos,
  disabled = false,
  onSelect,
  onRemove,
}) => (
  <section className="verification-performer-photos" aria-labelledby="verification-performer-photos-title">
    <header className="verification-performer-photos-head">
      <h3 id="verification-performer-photos-title" className="verification-performer-photos-title">
        Verifier identity
      </h3>
      <p className="verification-performer-photos-subtitle text-muted text-sm mb-0">
        Live camera only — no uploads from gallery or files.
      </p>
    </header>
    <VerificationPhotoUploadSection title="Take verifier photos" columns={2}>
      {PERFORMER_PHOTO_KINDS.map(kind => {
        const config = PERFORMER_PHOTO_CONFIG[kind];
        const slot: DeviceImageSlotState = photos[kind] ?? emptyDeviceImageSlot();
        return (
          <div key={kind} className="verification-performer-photo-item">
            <VerificationPhotoUploadSlot
              slotKey={kind}
              label={config.label}
              required
              file={slot.file}
              uploading={slot.uploading}
              progress={slot.progress}
              disabled={disabled}
              cameraOnly
              cameraFacing={config.cameraFacing}
              onSelect={file => onSelect(kind, file)}
              onRemove={() => onRemove(kind)}
            />
            <p className="verification-performer-photo-hint text-muted text-sm mb-0">{config.hint}</p>
          </div>
        );
      })}
    </VerificationPhotoUploadSection>
  </section>
);
