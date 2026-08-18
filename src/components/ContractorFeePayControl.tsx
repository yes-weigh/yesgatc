import React, { useCallback, useMemo, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { ImageCaptureOverlay, type ImageCaptureSession } from './ImageCaptureOverlay';
import { StorageImage } from './StorageImage';
import { VerificationPhotoViewer } from './VerificationPhotoViewer';
import { shouldUseInAppCameraCapture } from '../lib/imageCapture';
import {
  markContractorFeePaid,
  uploadContractorFeeProof,
  type ContractorFeePayment,
} from '../lib/contractorFeePayment';
import { useImageFileInputs } from '../lib/useImageFileInputs';

const ACCEPT = 'image/jpeg,image/png,image/webp';

type ContractorFeePayControlProps = {
  rcId: string;
  dateKey: string;
  amountInr: number;
  qty: number;
  payment: ContractorFeePayment | null;
  canPay: boolean;
};

export const ContractorFeePayControl: React.FC<ContractorFeePayControlProps> = ({
  rcId,
  dateKey,
  amountInr,
  qty,
  payment,
  canPay,
}) => {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const saveProof = useCallback(
    async (file: File) => {
      if (!canPay || saving) return;
      setSaving(true);
      setError('');
      try {
        const proof = await uploadContractorFeeProof(rcId, dateKey, file);
        await markContractorFeePaid({
          rcId,
          dateKey,
          amountInr,
          qty,
          proof,
          existing: payment,
        });
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Could not save proof.');
      } finally {
        setSaving(false);
      }
    },
    [amountInr, canPay, dateKey, payment, qty, rcId, saving],
  );

  const fileInputs = useImageFileInputs(ACCEPT, {
    captureFacing: 'environment',
    disabled: saving || !canPay,
    onSelect: file => {
      void saveProof(file);
    },
  });

  const openUpload = () => {
    if (!canPay || saving) return;
    if (shouldUseInAppCameraCapture()) {
      setCameraOpen(true);
      return;
    }
    if (fileInputs.mobileSourceChoice) fileInputs.openCamera();
    else fileInputs.openPicker();
  };

  const cameraSession = useMemo<ImageCaptureSession>(
    () => ({
      onCaptured: file => {
        setCameraOpen(false);
        void saveProof(file);
      },
    }),
    [saveProof],
  );

  const paidProof = payment
    ? { url: payment.proofUrl, path: payment.proofPath, label: 'Payment proof' }
    : null;

  if (!canPay && !payment) return null;

  return (
    <div className="reports-pay">
      {fileInputs.inputs}
      <ImageCaptureOverlay
        open={cameraOpen}
        label="Payment proof"
        accept={ACCEPT}
        facing="environment"
        allowGallery
        session={cameraOpen ? cameraSession : null}
        onClose={() => setCameraOpen(false)}
      />
      {paidProof && viewerOpen ? (
        <VerificationPhotoViewer
          open
          images={[paidProof]}
          onClose={() => setViewerOpen(false)}
        />
      ) : null}

      {payment ? (
        <div className="reports-pay__proof">
          <button
            type="button"
            className="reports-pay__icon reports-pay__icon--proof"
            onClick={() => setViewerOpen(true)}
            aria-label="View payment proof"
          >
            <StorageImage
              url={payment.proofUrl}
              path={payment.proofPath}
              alt=""
            />
          </button>
          {canPay ? (
            <button
              type="button"
              className="reports-pay__edit"
              onClick={openUpload}
              disabled={saving}
              aria-label="Replace payment proof"
            >
              {saving ? <span className="spinner-inline" /> : <ImagePlus size={12} aria-hidden />}
            </button>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          className="reports-pay__icon"
          onClick={openUpload}
          disabled={saving}
          aria-label="Upload payment proof"
        >
          {saving ? <span className="spinner-inline" /> : <ImagePlus size={18} aria-hidden />}
        </button>
      )}
      {error ? <p className="reports-pay__error">{error}</p> : null}
    </div>
  );
};
