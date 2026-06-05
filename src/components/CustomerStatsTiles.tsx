import React from 'react';
import { ClipboardList, Clock, Package } from 'lucide-react';
import type { CustomerTileStats } from '../lib/customerTileStats';

type CustomerStatsTilesProps = {
  deviceCount: number;
  stats: CustomerTileStats;
  className?: string;
};

export const CustomerStatsTiles: React.FC<CustomerStatsTilesProps> = ({
  deviceCount,
  stats,
  className,
}) => (
  <div
    className={['rc-customer-tile-stats customer-form-stats-tiles', className ?? '']
      .filter(Boolean)
      .join(' ')}
    aria-label="Customer activity summary"
  >
    <div className="rc-customer-tile-stat rc-customer-tile-stat--devices">
      <Package size={18} strokeWidth={2} aria-hidden />
      <span className="rc-customer-tile-stat-value">{deviceCount}</span>
      <span className="rc-customer-tile-stat-label">Devices</span>
    </div>
    <div className="rc-customer-tile-stat rc-customer-tile-stat--verifications">
      <ClipboardList size={18} strokeWidth={2} aria-hidden />
      <span className="rc-customer-tile-stat-value">{stats.verificationCount}</span>
      <span className="rc-customer-tile-stat-label">Verifications</span>
    </div>
    <div className="rc-customer-tile-stat rc-customer-tile-stat--due">
      <Clock size={18} strokeWidth={2} aria-hidden />
      <span className="rc-customer-tile-stat-value">{stats.dueCount}</span>
      <span className="rc-customer-tile-stat-label">Due</span>
    </div>
  </div>
);
