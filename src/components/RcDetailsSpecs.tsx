import React from 'react';
import { Building2, Mail, MapPin, User } from 'lucide-react';
import {
  DetailsCompactThumb,
  DetailsSpecsCompactShell,
} from './DetailsSpecsCompact';
import { rcProfilePhotoFromUser } from '../lib/rcProfileFields';
import type { FirestoreUserDoc } from '../types';

function displayText(value?: string): string {
  const trimmed = value?.trim();
  return trimmed || '—';
}

export const RcDetailsSpecs: React.FC<{
  rc: Pick<
    FirestoreUserDoc,
    | 'companyName'
    | 'username'
    | 'contactPerson'
    | 'phone'
    | 'email'
    | 'place'
    | 'address'
    | 'profilePhotoUrl'
    | 'profilePhotoPath'
    | 'profilePhotoName'
    | 'profilePhotoContentType'
  >;
  className?: string;
}> = ({ rc, className }) => {
  const photo = rcProfilePhotoFromUser(rc as FirestoreUserDoc);
  const name = rc.companyName?.trim() || rc.username?.trim() || 'Regional centre';
  const region = [rc.place, rc.address?.trim()].filter(Boolean).join(' · ');

  return (
    <div className={className ? `${className} site-calibration-form-span-full` : 'site-calibration-form-span-full'}>
      <DetailsSpecsCompactShell
        ariaLabel="RC centre details"
        thumb={
          <DetailsCompactThumb placeholder={!photo?.url} title={name}>
            {photo?.url ? (
              <img src={photo.url} alt="" />
            ) : (
              <Building2 size={18} className="text-muted" aria-hidden />
            )}
          </DetailsCompactThumb>
        }
      >
        <div className="details-specs-compact-primary">
          <span className="details-specs-compact-title">{name}</span>
          {rc.contactPerson?.trim() && (
            <span className="details-specs-compact-line">
              <User size={12} className="inline-icon" aria-hidden />
              {rc.contactPerson.trim()}
            </span>
          )}
          <span className="details-specs-compact-line text-mono">{displayText(rc.phone)}</span>
          {rc.email?.trim() && (
            <span className="details-specs-compact-line">
              <Mail size={12} className="inline-icon" aria-hidden />
              {rc.email.trim()}
            </span>
          )}
          <span className="details-specs-compact-badge">Self verification</span>
        </div>
        {region && (
          <p className="details-specs-compact-text">
            <MapPin size={12} className="inline-icon" aria-hidden />
            {region}
          </p>
        )}
        {rc.phone?.trim() && (
          <div className="details-specs-compact-foot">
            <span>{displayText(rc.phone)}</span>
          </div>
        )}
      </DetailsSpecsCompactShell>
    </div>
  );
};
