export type SegmentToggleOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

interface SegmentToggleProps<T extends string> {
  value: T;
  options: SegmentToggleOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
}

export function SegmentToggle<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
  className = '',
}: SegmentToggleProps<T>) {
  const activeIndex = Math.max(0, options.findIndex(opt => opt.value === value));

  return (
    <div
      className={`segment-toggle ${className}`.trim()}
      role="group"
      aria-label={ariaLabel}
    >
      <div
        className="segment-toggle-thumb"
        style={{
          width: `calc((100% - 6px) / ${options.length})`,
          transform: `translateX(${activeIndex * 100}%)`,
        }}
        aria-hidden
      />
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          className={`segment-toggle-btn${value === opt.value ? ' segment-toggle-btn--active' : ''}`}
          onClick={() => {
            if (disabled || opt.disabled || opt.value === value) return;
            onChange(opt.value);
          }}
          disabled={disabled || opt.disabled}
          aria-pressed={value === opt.value}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
