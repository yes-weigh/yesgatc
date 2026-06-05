import {
  ClipboardList,
  Clock,
  MapPin,
  Package,
  Phone,
  Store,
} from 'lucide-react';
import { StorageImage } from './StorageImage';
import { buildTelUrl, buildWhatsAppContactUrl, normalizePhone } from '../lib/contactFields';
import { customerDeviceCount } from '../lib/customerProfileFields';
import {
  customerDistanceKm,
  formatCustomerDistance,
  formatCustomerRegion,
  type CustomerTileStats,
} from '../lib/customerTileStats';
import type { Customer, CustomerLocation } from '../types';

function WhatsAppIcon() {
  return (
    <svg className="rc-customer-tile-action-icon" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"
      />
    </svg>
  );
}

type CustomerListTileProps = {
  customer: Customer;
  stats: CustomerTileStats;
  distanceFrom?: CustomerLocation | null;
  onEdit: () => void;
};

export function CustomerListTile({
  customer,
  stats,
  distanceFrom,
  onEdit,
}: CustomerListTileProps) {
  const displayName = (customer.name || '—').trim();
  const phone = normalizePhone(customer.phone);
  const telUrl = buildTelUrl(customer.phone);
  const whatsAppUrl = buildWhatsAppContactUrl(customer.phone);
  const region = formatCustomerRegion(customer);
  const distanceLabel = formatCustomerDistance(customerDistanceKm(customer, distanceFrom));
  const deviceCount = customerDeviceCount(customer);
  const photoUrl = customer.shopPhotoUrl || customer.customerPhotoUrl;
  const photoPath = customer.shopPhotoPath || customer.customerPhotoPath;

  return (
    <article className="rc-customer-tile">
      <button
        type="button"
        className="rc-customer-tile-body"
        onClick={onEdit}
        aria-label={`Edit ${displayName}`}
      >
        <div className="rc-customer-tile-head">
          <span className="rc-customer-tile-avatar" aria-hidden>
            {photoUrl || photoPath ? (
              <StorageImage
                url={photoUrl}
                path={photoPath}
                alt=""
                className="rc-customer-tile-avatar-img"
              />
            ) : (
              <Store size={26} strokeWidth={1.85} />
            )}
          </span>

          <div className="rc-customer-tile-head-main">
            <div className="rc-customer-tile-title-row">
              <h3 className="rc-customer-tile-name">{displayName}</h3>
              <span className="rc-customer-tile-status">
                <span className="rc-customer-tile-status-dot" aria-hidden />
                Active
              </span>
            </div>

            {phone && (
              <p className="rc-customer-tile-contact">
                <Phone size={14} strokeWidth={2.25} aria-hidden />
                <span className="text-mono">{phone}</span>
              </p>
            )}

            <p className="rc-customer-tile-contact">
              <MapPin size={14} strokeWidth={2.25} aria-hidden />
              <span>{region}</span>
            </p>
          </div>

          {distanceLabel && (
            <p className="rc-customer-tile-distance">
              <MapPin size={14} strokeWidth={2.25} aria-hidden />
              <span>{distanceLabel}</span>
            </p>
          )}
        </div>

        <div className="rc-customer-tile-stats">
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
      </button>

      <footer className="rc-customer-tile-actions">
        {telUrl ? (
          <a
            href={telUrl}
            className="rc-customer-tile-action rc-customer-tile-action--call"
            onClick={e => e.stopPropagation()}
          >
            <Phone size={16} strokeWidth={2.25} aria-hidden />
            Call
          </a>
        ) : (
          <span className="rc-customer-tile-action rc-customer-tile-action--disabled" aria-disabled>
            <Phone size={16} strokeWidth={2.25} aria-hidden />
            Call
          </span>
        )}
        {whatsAppUrl ? (
          <a
            href={whatsAppUrl}
            className="rc-customer-tile-action rc-customer-tile-action--whatsapp"
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
          >
            <WhatsAppIcon />
            WhatsApp
          </a>
        ) : (
          <span className="rc-customer-tile-action rc-customer-tile-action--disabled" aria-disabled>
            <WhatsAppIcon />
            WhatsApp
          </span>
        )}
      </footer>
    </article>
  );
}
