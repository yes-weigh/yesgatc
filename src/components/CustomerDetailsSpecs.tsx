import React from 'react';
import { ExternalLink, ImageIcon, MapPin, UserRound } from 'lucide-react';
import {
  customerDeviceCount,
  customerMapsUrl,
  formatCustomerLocation,
  shopPhotoFromRecord,
} from '../lib/customerProfileFields';
import type { Customer } from '../types';

const SpecItem: React.FC<{
  label: string;
  value: React.ReactNode;
  spanFull?: boolean;
}> = ({ label, value, spanFull }) => (
  <div className={`customer-device-spec-item${spanFull ? ' site-calibration-spec-span-full' : ''}`}>
    <span className="customer-device-spec-label">{label}</span>
    <span className="customer-device-spec-value">{value}</span>
  </div>
);

function displayText(value?: string): string {
  const trimmed = value?.trim();
  return trimmed || '—';
}

export const CustomerDetailsSpecs: React.FC<{
  customer: Customer;
  className?: string;
}> = ({ customer, className }) => {
  const photo = shopPhotoFromRecord(customer);
  const mapsUrl = customerMapsUrl(customer);

  return (
    <div className={`site-calibration-details-panel${className ? ` ${className}` : ''}`}>
      <p className="site-calibration-details-heading">Customer details</p>
      <div className="customer-device-product-specs" aria-label="Customer details">
        <div className="customer-device-thumb">
          <div
            className={`customer-device-thumb-box${
              photo?.url ? '' : ' customer-device-thumb-box--placeholder'
            }`}
            title={customer.name || 'Customer photo'}
          >
            {photo?.url ? (
              <img src={photo.url} alt="" className="customer-device-thumb-img" />
            ) : (
              <UserRound size={22} className="text-muted" aria-hidden />
            )}
          </div>
        </div>
        <div className="customer-device-product-specs-grid">
          <SpecItem label="Name" value={displayText(customer.name)} />
          <SpecItem label="Mobile" value={displayText(customer.phone)} />
          <SpecItem label="Email" value={displayText(customer.email)} />
          <SpecItem label="Postal code" value={displayText(customer.pincode)} />
          <SpecItem label="District" value={displayText(customer.district)} />
          <SpecItem label="State" value={displayText(customer.state)} />
          <SpecItem
            label="Address"
            value={displayText(customer.address)}
            spanFull
          />
          <SpecItem
            label="GPS location"
            value={
              mapsUrl ? (
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="customer-device-spec-doc-link text-sm text-blue"
                >
                  <MapPin size={14} aria-hidden />
                  {formatCustomerLocation(customer)}
                  <ExternalLink size={14} aria-hidden />
                </a>
              ) : (
                '—'
              )
            }
            spanFull
          />
          <SpecItem
            label="Registered devices"
            value={String(customerDeviceCount(customer))}
          />
        </div>
      </div>

      {(customer.devices?.length ?? 0) > 0 && (
        <div className="site-calibration-customer-devices">
          <p className="site-calibration-details-subheading">Customer devices</p>
          <ul className="site-calibration-device-list">
            {customer.devices!.map(device => (
              <li key={device.id} className="site-calibration-device-list-item">
                <div className="site-calibration-device-list-thumb">
                  {device.imageUrl ? (
                    <img src={device.imageUrl} alt="" />
                  ) : (
                    <span className="site-calibration-device-list-thumb--placeholder">
                      <ImageIcon size={16} />
                    </span>
                  )}
                </div>
                <div className="site-calibration-device-list-meta">
                  <span className="site-calibration-device-list-name">
                    {displayText(device.productName)}
                  </span>
                  <span className="site-calibration-device-list-serial text-mono text-sm text-muted">
                    {displayText(device.serialNumber)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
