import React, { useState, useEffect, useRef } from 'react';

const VAT_PRESETS = [
  { label: 'No tax (0%)', rate: 0 },
  { label: 'DE  19%', rate: 19 },
  { label: 'FR  20%', rate: 20 },
  { label: 'UK  20%', rate: 20 },
  { label: 'ES  21%', rate: 21 },
  { label: 'NL  21%', rate: 21 },
  { label: 'IE  23%', rate: 23 },
  { label: 'DK  25%', rate: 25 },
  { label: 'SE  25%', rate: 25 },
];

export default function SettingsPanel({ vatRate, onVatChange }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function applyCustom() {
    const n = parseFloat(custom);
    if (!isNaN(n) && n >= 0 && n <= 60) {
      onVatChange(n);
      setCustom('');
    }
  }

  return (
    <div className="settings-anchor" ref={ref}>
      <button
        className={`settings-btn ${open ? 'settings-btn--active' : ''}`}
        onClick={() => setOpen(o => !o)}
        title="Pricing settings"
      >
        {vatRate > 0 ? `+${vatRate}% VAT` : 'Settings'}
      </button>

      {open && (
        <div className="settings-panel">
          <div className="settings-panel__title">VAT / Tax Rate</div>
          <div className="settings-panel__note">
            Anthropic charges the same token prices globally. EU customers pay VAT on top — set your rate to see tax-inclusive estimates.
          </div>

          <div className="settings-presets">
            {VAT_PRESETS.map(p => (
              <button
                key={p.label}
                className={`settings-preset ${vatRate === p.rate && p.rate === 0 && vatRate === 0 ? 'settings-preset--active' : vatRate === p.rate ? 'settings-preset--active' : ''}`}
                onClick={() => { onVatChange(p.rate); }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="settings-custom">
            <input
              className="settings-custom__input"
              type="number"
              min="0"
              max="60"
              step="0.5"
              placeholder="Custom %"
              value={custom}
              onChange={e => setCustom(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && applyCustom()}
            />
            <button className="settings-custom__apply" onClick={applyCustom}>Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}
