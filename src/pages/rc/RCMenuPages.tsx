import React from 'react';
import { Gauge, Upload } from 'lucide-react';
import { RCModulePage } from './RCModulePage';

export const RCSiteCalibration: React.FC = () => (
  <RCModulePage
    title="Site Calibration"
    icon={<Gauge className="inline-icon" />}
  />
);

export const RCUploadCertificate: React.FC = () => (
  <RCModulePage
    title="Upload Certificate"
    icon={<Upload className="inline-icon" />}
  />
);
