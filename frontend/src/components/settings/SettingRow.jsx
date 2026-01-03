import React, { useId } from 'react';

function SettingRow({ title, description, htmlFor, children }) {
  const autoId = useId();
  const titleId = `${autoId}-title`;
  const descId = `${autoId}-desc`;

  const TitleTag = htmlFor ? 'label' : 'div';
  const titleProps = htmlFor ? { htmlFor } : {};

  return (
    <div className="setting-row">
      <div className="setting-left">
        <TitleTag className="setting-title" id={titleId} {...titleProps}>
          {title}
        </TitleTag>
        {description ? (
          <div className="setting-desc" id={descId}>
            {description}
          </div>
        ) : null}
      </div>
      <div className="setting-right" aria-labelledby={titleId} aria-describedby={description ? descId : undefined}>
        {children}
      </div>
    </div>
  );
}

export default SettingRow;

