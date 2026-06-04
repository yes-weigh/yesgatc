import React, { useMemo } from 'react';
import { Camera, Plus } from 'lucide-react';
import { VerificationAiStatusPanel } from '../../components/VerificationAiStatusPanel';
import { VerificationDeclarationPanel } from '../../components/VerificationDeclarationPanel';
import { VerificationResultSummary } from '../../components/VerificationResultSummary';
import { useAppContext } from '../../context/AppContext';
import { buildVerificationAiStatusItems } from '../../lib/verificationAiStatus';
import {
  buildDefaultVerificationTestSummary,
  DEFAULT_VERIFICATION_SUMMARY_INFO,
  DEFAULT_VERIFICATION_SUMMARY_REMARKS,
  formatVerificationSummaryDateTime,
} from '../../lib/verificationTestSummary';
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
  isRvDocumentRequired,
  type DeviceRvDocumentsState,
  type RvDocumentKind,
} from '../../lib/verificationRvDeviceImages';
import type { JobType } from '../../types';
import type { VerificationDeviceRowValues } from '../../lib/siteCalibrationProfileFields';

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
  showResultSummary?: boolean;
  ambientTemperature?: string;
  relativeHumidity?: string;
  hasGpsLocation?: boolean;
  mandatoryFieldsComplete?: boolean;
  declarationAccepted?: boolean;
  onDeclarationAcceptedChange?: (accepted: boolean) => void;
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
  showResultSummary = false,
  ambientTemperature = '',
  relativeHumidity = '',
  hasGpsLocation = false,
  mandatoryFieldsComplete = false,
  declarationAccepted = false,
  onDeclarationAcceptedChange,
}) => {
  const { products } = useAppContext();
  const locked = submitting || readOnly;
  const isRv = verificationType === 'RV';
  const deviceLabel = device.productName.trim() || device.serialNumber.trim() || `Device ${deviceIndex + 1}`;

  const instrumentSummaryLabel = useMemo(() => {
    const product = products.find(entry => entry.id === device.productId);
    if (product?.typeOfInstrument?.trim()) {
      return `${product.typeOfInstrument.trim()} Weighing Scale`;
    }
    if (device.productName.trim()) return device.productName.trim();
    return 'Weighing Scale';
  }, [products, device.productId, device.productName]);

  const testSummary = useMemo(() => buildDefaultVerificationTestSummary('PASS'), []);
  const summaryDateTime = useMemo(() => formatVerificationSummaryDateTime(), []);

  const aiStatusItems = useMemo(() => {
    const product = products.find(entry => entry.id === device.productId);
    const stamping = images.stamping ?? emptyDeviceImageSlot();
    const hasStampingImage =
      !stamping.removed && Boolean(stamping.file?.url || stamping.file?.path || stamping.pendingFile);
    const scale = images.scale ?? emptyDeviceImageSlot();
    const hasInstrumentImage =
      !scale.removed && Boolean(scale.file?.url || scale.file?.path || scale.pendingFile);
    const oldCertificate = rvDocuments.oldCertificate ?? emptyDeviceImageSlot();
    const hasOldCertificate =
      !oldCertificate.removed &&
      Boolean(oldCertificate.file?.url || oldCertificate.file?.path || oldCertificate.pendingFile);

    return buildVerificationAiStatusItems({
      verificationType,
      hasStampingImage,
      hasInstrumentImage,
      productModelApprovalNo: product?.modelApprovalNo ?? '',
      hasOldCertificate,
      hasGpsLocation,
      ambientTemperature,
      relativeHumidity,
      mandatoryFieldsComplete,
    });
  }, [
    products,
    device.productId,
    images.stamping,
    images.scale,
    rvDocuments.oldCertificate,
    verificationType,
    hasGpsLocation,
    ambientTemperature,
    relativeHumidity,
    mandatoryFieldsComplete,
  ]);

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
              slotKey={kind}
              label={config.label}
              required={isVerificationImageRequired(kind, verificationType)}
              file={slot.file}
              uploading={slot.uploading}
              progress={slot.progress}
              disabled={locked}
              geoStamp={kind === 'stamping' || kind === 'scale'}
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
                slotKey={kind}
                label={config.label}
                required={isRvDocumentRequired(kind)}
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

      {showResultSummary && (
        <>
          <VerificationAiStatusPanel items={aiStatusItems} />
          <VerificationResultSummary
            instrumentLabel={instrumentSummaryLabel}
            tests={testSummary}
            overallResult="PASS"
            dateTime={summaryDateTime}
            remarks={DEFAULT_VERIFICATION_SUMMARY_REMARKS}
            infoMessage={DEFAULT_VERIFICATION_SUMMARY_INFO}
          />
          <VerificationDeclarationPanel
            checked={declarationAccepted}
            onChange={accepted => onDeclarationAcceptedChange?.(accepted)}
            disabled={locked}
          />
        </>
      )}
    </section>
  );
};
