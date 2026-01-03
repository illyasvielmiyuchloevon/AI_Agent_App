import React, { useEffect, useState } from 'react';
import Modal from './Modal';

export default function InputModal({
  isOpen,
  title,
  label,
  defaultValue,
  placeholder,
  confirmText = '确定',
  icon = 'codicon-edit',
  onConfirm,
  onClose,
}) {
  const [value, setValue] = useState(defaultValue);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setValue(defaultValue);
    setTouched(false);
  }, [isOpen, defaultValue]);

  const trimmed = String(value || '').trim();
  const canSubmit = trimmed.length > 0;
  const showError = touched && !canSubmit;

  return (
    <Modal
      isOpen={!!isOpen}
      onClose={onClose}
      title={title}
      width="520px"
    >
      <div className="prompt-modal">
        {label ? <div className="prompt-modal-desc">{label}</div> : null}
        <div className={`prompt-modal-inputRow ${showError ? 'error' : ''}`}>
          <i className={`codicon ${icon}`} aria-hidden />
          <input
            className="prompt-modal-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder || ''}
            autoFocus
            onBlur={() => setTouched(true)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                onClose?.();
                return;
              }
              if (e.key === 'Enter') {
                e.preventDefault();
                setTouched(true);
                if (!canSubmit) return;
                onConfirm?.(trimmed);
              }
            }}
          />
        </div>
        {showError ? <div className="prompt-modal-error">请输入内容</div> : null}
        <div className="prompt-modal-actions">
          <button type="button" className="ghost-btn" onClick={onClose}>取消</button>
          <button
            type="button"
            className="primary-btn"
            disabled={!canSubmit}
            onClick={() => {
              setTouched(true);
              if (!canSubmit) return;
              onConfirm?.(trimmed);
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </Modal>
  );
}

