import type { JobType } from '../types';

export type VerificationAiStatusItem = {
  id: string;
  label: string;
  statusLabel: string;
  success: boolean;
};

export type VerificationAiStatusInput = {
  verificationType: JobType | '';
  hasStampingImage: boolean;
  hasInstrumentImage: boolean;
  productModelApprovalNo: string;
  hasOldCertificate: boolean;
  hasGpsLocation: boolean;
  ambientTemperature: string;
  relativeHumidity: string;
  mandatoryFieldsComplete: boolean;
};

function hasValidTemperatureHumidity(temperature: string, humidity: string): boolean {
  if (!temperature.trim() || !humidity.trim()) return false;
  const temp = Number(temperature.trim());
  const humidityValue = Number(humidity.trim());
  return Number.isFinite(temp) && Number.isFinite(humidityValue);
}

export function buildVerificationAiStatusItems(
  input: VerificationAiStatusInput,
): VerificationAiStatusItem[] {
  const isRv = input.verificationType === 'RV';
  const tempHumidityValid = hasValidTemperatureHumidity(
    input.ambientTemperature,
    input.relativeHumidity,
  );

  const previousCertificateSuccess = isRv ? input.hasOldCertificate : true;
  const previousCertificateStatus = isRv
    ? input.hasOldCertificate
      ? 'Found'
      : 'Pending'
    : 'Not required';

  return [
    {
      id: 'serial-plate',
      label: 'Serial Plate Read',
      statusLabel: input.hasStampingImage ? 'Success' : 'Pending',
      success: input.hasStampingImage,
    },
    {
      id: 'instrument-photo',
      label: 'Instrument Photo',
      statusLabel: input.hasInstrumentImage ? 'Captured' : 'Pending',
      success: input.hasInstrumentImage,
    },
    {
      id: 'model-approval',
      label: 'Model Approval Match',
      statusLabel: input.productModelApprovalNo.trim() ? 'Matched' : 'Pending',
      success: Boolean(input.productModelApprovalNo.trim()),
    },
    {
      id: 'previous-certificate',
      label: 'Previous Certificate Check',
      statusLabel: previousCertificateStatus,
      success: previousCertificateSuccess,
    },
    {
      id: 'gps-location',
      label: 'GPS Location Captured',
      statusLabel: input.hasGpsLocation ? 'Captured' : 'Pending',
      success: input.hasGpsLocation,
    },
    {
      id: 'temperature-humidity',
      label: 'Temperature & Humidity',
      statusLabel: tempHumidityValid ? 'Valid' : 'Pending',
      success: tempHumidityValid,
    },
    {
      id: 'mandatory-fields',
      label: 'All Mandatory Fields',
      statusLabel: input.mandatoryFieldsComplete ? 'Completed' : 'Incomplete',
      success: input.mandatoryFieldsComplete,
    },
  ];
}
