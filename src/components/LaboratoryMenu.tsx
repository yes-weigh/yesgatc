import React, { useState } from 'react';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { LABORATORY_MENU_ITEMS } from '../lib/laboratoryMenu';

function LaboratoryMenuCardVisual({
  imageSrc,
  icon: Icon,
}: {
  imageSrc?: string;
  icon: LucideIcon;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(imageSrc) && !imageFailed;

  if (showImage) {
    return (
      <img
        src={imageSrc}
        alt=""
        className="laboratory-menu-card-image"
        loading="lazy"
        decoding="async"
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <span className="laboratory-menu-card-icon" aria-hidden>
      <Icon size={44} strokeWidth={1.5} />
    </span>
  );
}

export const LaboratoryMenu: React.FC = () => (
  <div className="laboratory-menu-grid">
      {LABORATORY_MENU_ITEMS.map(item => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            className="laboratory-menu-card"
            disabled
            title={`${item.title} — coming soon`}
            aria-label={`${item.title} — coming soon`}
          >
            <span className="laboratory-menu-card-index" aria-hidden>
              {item.number}
            </span>

            <div className="laboratory-menu-card-visual">
              <LaboratoryMenuCardVisual imageSrc={item.imageSrc} icon={Icon} />
            </div>

            <div className="laboratory-menu-card-foot">
              <span className="laboratory-menu-card-title">
                {item.title}
                <ChevronRight size={16} strokeWidth={2.25} aria-hidden />
              </span>
              <span className="laboratory-menu-card-description">{item.description}</span>
            </div>
          </button>
        );
      })}
  </div>
);
