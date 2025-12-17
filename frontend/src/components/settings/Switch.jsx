import React from 'react';

function Switch({ checked, onChange, disabled = false, id, label }) {
  return (
    <label className={`settings-switch ${disabled ? 'disabled' : ''}`}>
      <span className="sr-only">{label}</span>
      <input
        id={id}
        type="checkbox"
        checked={!!checked}
        disabled={disabled}
        onChange={(e) => onChange && onChange(e.target.checked)}
      />
      <span className="settings-switch-track" aria-hidden>
        <span className="settings-switch-thumb" />
      </span>
    </label>
  );
}

export default Switch;

