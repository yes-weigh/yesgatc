import { SegmentToggle } from './SegmentToggle';

export function ProductSerialPoolField({
  pas,
  disabled = false,
  onChange,
}: {
  pas: boolean;
  disabled?: boolean;
  onChange?: (pas: boolean) => void;
}) {
  return (
    <div className="form-group mb-0 product-form-span-pas product-serial-pool">
      <div className="product-serial-pool__head">
        <span className="product-serial-pool__label">Serial pool</span>
        <span
          className={`product-serial-pool__status${pas ? ' product-serial-pool__status--pas' : ' product-serial-pool__status--gas'}`}
        >
          {pas ? 'PAS' : 'GAS'}
        </span>
      </div>
      <SegmentToggle
        ariaLabel="Serial pool"
        value={pas ? 'pas' : 'gas'}
        disabled={disabled}
        options={[
          { value: 'gas', label: 'GAS' },
          { value: 'pas', label: 'PAS' },
        ]}
        onChange={next => onChange?.(next === 'pas')}
      />
      <p className={`product-serial-pool__hint${pas ? ' product-serial-pool__hint--pas' : ' product-serial-pool__hint--gas'}`}>
        {pas
          ? 'Pre-allotted. Type serial; Yesone number bank.'
          : 'General allotted serials (default).'}
      </p>
    </div>
  );
}
