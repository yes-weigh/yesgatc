import React from 'react';
import { Truck } from 'lucide-react';

export const RCVehicles: React.FC = () => {
  return (
    <div className="fade-in page-content">
      <div className="panel glass">
        <div className="panel-header">
          <h2>
            <Truck className="inline-icon" /> Vehicle
          </h2>
        </div>
        <div className="panel-body">
          <p className="text-muted m-0">Vehicle management for your regional center is coming soon.</p>
        </div>
      </div>
    </div>
  );
};
