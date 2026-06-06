import React from 'react';
import { CreditCard } from 'lucide-react';
import { RvPaymentStructureTable } from './RvPaymentStructureTable';

type RvPaymentSettingsCardProps = {
  className?: string;
};

export const RvPaymentSettingsCard: React.FC<RvPaymentSettingsCardProps> = ({ className = '' }) => (
  <div className={`panel glass mt-6${className ? ` ${className}` : ''}`}>
    <div className="panel-header">
      <h2><CreditCard className="inline-icon" /> RV wallet payment</h2>
    </div>
    <div className="panel-body">
      <RvPaymentStructureTable />
    </div>
  </div>
);

/** @deprecated Use RvPaymentSettingsCard */
export const RvRazorpaySettingsCard = RvPaymentSettingsCard;
