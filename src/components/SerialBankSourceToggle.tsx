export type SerialBankSourceTab = 'rcYesone' | 'interweighingDirect';

export function SerialBankSourceToggle({
  value,
  onChange,
  disabled,
}: {
  value: SerialBankSourceTab;
  onChange: (next: SerialBankSourceTab) => void;
  disabled?: boolean;
}) {
  return (
    <div className="serial-source-toggle" role="group" aria-label="Serial source">
      <button
        type="button"
        className={`serial-source-toggle__btn${value === 'rcYesone' ? ' is-active' : ''}`}
        onClick={() => onChange('rcYesone')}
        disabled={disabled}
      >
        RC allotted
      </button>
      <button
        type="button"
        className={`serial-source-toggle__btn${value === 'interweighingDirect' ? ' is-active' : ''}`}
        onClick={() => onChange('interweighingDirect')}
        disabled={disabled}
      >
        Direct
      </button>
    </div>
  );
}

export function InterweighingDirectSerialField({
  id,
  className,
  value,
  choices,
  disabled,
  onChange,
}: {
  id: string;
  className: string;
  value: string;
  choices: readonly string[];
  disabled?: boolean;
  onChange: (serial: string) => void;
}) {
  return (
    <div className="iw-direct-serial-field">
      <input
        id={id}
        type="text"
        className={className}
        placeholder={choices.length > 0 ? 'Pick unused or type serial' : 'Type direct serial'}
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
      />
      {choices.length > 0 ? (
        <ul className="iw-direct-serial-chips">
          {choices.slice(0, 16).map(serial => (
            <li key={serial}>
              <button
                type="button"
                className={`iw-direct-serial-chip${
                  serial.trim().toUpperCase() === value.trim().toUpperCase() ? ' is-active' : ''
                }`}
                onClick={() => onChange(serial)}
                disabled={disabled}
              >
                {serial}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ov-self-serial-hint">Type serial. RC approves. Does not use Yesone quota.</p>
      )}
    </div>
  );
}
