import React from 'react';
import { Gauge, Upload, UserRound } from 'lucide-react';
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

export const RCCustomers: React.FC = () => (
  <RCModulePage
    title="Customer"
    icon={<UserRound className="inline-icon" />}
  />
);
