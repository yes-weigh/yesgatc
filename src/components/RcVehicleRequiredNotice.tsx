import React from 'react';
import { Link } from 'react-router-dom';

type RcVehicleRequiredNoticeProps = {
  variant: 'rc' | 'vct';
};

export const RcVehicleRequiredNotice: React.FC<RcVehicleRequiredNoticeProps> = ({ variant }) => {
  if (variant === 'rc') {
    return (
      <div className="rc-vehicle-required-notice" role="status">
        <p className="rc-vehicle-required-notice__title">Add your first vehicle</p>
        <p className="rc-vehicle-required-notice__text mb-0">
          At least one centre vehicle is required. Technicians cannot start new verifications until
          your RC registers a vehicle.
        </p>
        <Link to="/rc/vehicles" className="btn btn-secondary btn-sm rc-vehicle-required-notice__cta">
          Add vehicle
        </Link>
      </div>
    );
  }

  return (
    <div className="rc-vehicle-required-notice" role="status">
      <p className="rc-vehicle-required-notice__title">Centre vehicle required</p>
      <p className="rc-vehicle-required-notice__text mb-0">
        Your regional centre has not registered a vehicle yet. Ask your RC admin to add one — you
        cannot start new verifications until they do.
      </p>
    </div>
  );
};

export const RcStandardWeightsCertVctNotice: React.FC = () => (
  <div className="rc-vehicle-required-notice" role="status">
    <p className="rc-vehicle-required-notice__title">Standard weights certificate required</p>
    <p className="rc-vehicle-required-notice__text mb-0">
      Your regional centre&apos;s standard weights certificate has not been uploaded yet. Ask your RC
      admin — you cannot start new verifications until it is.
    </p>
  </div>
);
