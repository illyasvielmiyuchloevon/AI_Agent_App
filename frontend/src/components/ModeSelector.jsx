import React, { useState, useRef, useEffect } from 'react';

function ModeSelector({ value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);
  const active = options.find((o) => o.key === value) || options[0];

  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  return (
    <div className="mode-selector" ref={dropdownRef}>
      <button className="mode-btn" onClick={() => setOpen((v) => !v)} type="button">
        {active ? active.label : 'Mode'}
        <span className="chevron">▾</span>
      </button>
      {open && (
        <div className="mode-menu">
          {options.map((opt) => (
            <div
              key={opt.key}
              className={`mode-item ${opt.key === value ? 'active' : ''}`}
              onClick={() => {
                onChange(opt.key);
                setOpen(false);
              }}
            >
              <div className="mode-item-title">{opt.label}</div>
              <div className="mode-item-desc">{opt.description}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default ModeSelector;
