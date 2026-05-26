import React from 'react';
import { ExternalLink, ImageIcon, MapPin, Pencil, UserRound } from 'lucide-react';
import {
  DetailsCompactThumb,
  DetailsSpecsCompactShell,
} from './DetailsSpecsCompact';
import {
  customerDeviceCount,
  customerMapsUrl,
  formatCustomerLocation,
  shopPhotoFromRecord,
} from '../lib/customerProfileFields';
import type { Customer } from '../types';

function displayText(value?: string): string {
  const trimmed = value?.trim();
  return trimmed || '—';
}

export const CustomerDetailsSpecs: React.FC<{
  customer: Customer;
  className?: string;
  /** Show registered device list below specs. Default true. */
  showDevices?: boolean;
  /** When set, shows an edit control on the card. */
  onEdit?: () => void;
  editDisabled?: boolean;
  editLabel?: string;
}> = ({ customer, className, showDevices = true, onEdit, editDisabled = false, editLabel = 'Edit customer' }) => {
  const photo = shopPhotoFromRecord(customer);
  const mapsUrl = customerMapsUrl(customer);
  const region = [customer.district, customer.state, customer.pincode].filter(part => part?.trim()).join(' · ');
  const deviceCount = customerDeviceCount(customer);

  return (
    <div className={className ? `${className} site-calibration-form-span-full` : 'site-calibration-form-span-full'}>
      <div className="customer-details-specs-wrap">
        <DetailsSpecsCompactShell
          ariaLabel="Customer details"
          thumb={
            <DetailsCompactThumb placeholder={!photo?.url} title={customer.name || 'Customer photo'}>
              {photo?.url ? (
                <img src={photo.url} alt="" />
              ) : (
                <UserRound size={18} className="text-muted" aria-hidden />
              )}
            </DetailsCompactThumb>
          }
        >
          <div className="details-specs-compact-primary">
            <span className="details-specs-compact-title">{displayText(customer.name)}</span>
            <span className="details-specs-compact-line text-mono">{displayText(customer.phone)}</span>
            {customer.email?.trim() && (
              <span className="details-specs-compact-line">{customer.email.trim()}</span>
            )}
            <span className="details-specs-compact-badge">
              {deviceCount} device{deviceCount !== 1 ? 's' : ''}
            </span>
          </div>
          {customer.address?.trim() && (
            <p className="details-specs-compact-text">{customer.address.trim()}</p>
          )}
          <div className="details-specs-compact-foot">
            {region && <span>{region}</span>}
            {mapsUrl && (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="details-specs-doc-link text-sm text-blue"
              >
                <MapPin size={13} aria-hidden />
                {formatCustomerLocation(customer)}
                <ExternalLink size={12} aria-hidden />
              </a>
            )}
          </div>
        </DetailsSpecsCompactShell>
        {onEdit && (
          <button
            type="button"
            className="customer-details-specs-edit-btn"
            onClick={onEdit}
            disabled={editDisabled}
            aria-label={editLabel}
            title={editLabel}
          >
            <Pencil size={16} aria-hidden />
          </button>
        )}
      </div>

      {(customer.devices?.length ?? 0) > 0 && showDevices && (
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
