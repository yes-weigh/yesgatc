import React, { useMemo, useState } from 'react';
import { Camera, Scale } from 'lucide-react';
import { imageMetaFromRecord } from '../lib/verificationDeviceImages';
import { StorageImage } from './StorageImage';
import { VerificationPhotoViewer } from './VerificationPhotoViewer';
import type { SiteCalibration } from '../types';

type VerificationInstrumentPhotoCornerProps = {
  record: SiteCalibration;
};

export const VerificationInstrumentPhotoCorner: React.FC<VerificationInstrumentPhotoCornerProps> = ({
  record,
}) => {
  const [viewerOpen, setViewerOpen] = useState(false);

  const instrumentPhoto = useMemo(() => imageMetaFromRecord(record, 'scale'), [record]);
  const hasPhoto = Boolean(instrumentPhoto?.url?.trim() || instrumentPhoto?.path?.trim());

  return (
    <>
      <div className="verification-summary-details-instrument-photo">
        <button
          type="button"
          className="verification-summary-details-instrument-photo-trigger"
          onClick={() => hasPhoto && setViewerOpen(true)}
          disabled={!hasPhoto}
          aria-label={hasPhoto ? 'View instrument photo' : 'Instrument photo not uploaded'}
          title={hasPhoto ? 'View instrument photo' : 'Instrument photo not uploaded'}
        >
          <span className="verification-summary-details-instrument-photo-frame">
            {hasPhoto && instrumentPhoto ? (
              <StorageImage
                url={instrumentPhoto.url}
                path={instrumentPhoto.path}
                alt=""
                className="verification-summary-details-instrument-photo-img"
              />
            ) : (
              <span className="verification-summary-details-instrument-photo-placeholder" aria-hidden>
                <Scale size={30} strokeWidth={1.35} />
              </span>
            )}
            <span className="verification-summary-details-instrument-photo-camera" aria-hidden>
              <Camera size={15} strokeWidth={2.25} />
            </span>
          </span>
        </button>
      </div>

      {hasPhoto && instrumentPhoto && (
        <VerificationPhotoViewer
          open={viewerOpen}
          label="Instrument photo"
          imageUrl={instrumentPhoto.url}
          storagePath={instrumentPhoto.path}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </>
  );
};
