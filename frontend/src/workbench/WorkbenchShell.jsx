import React from 'react';

export default function WorkbenchShell({ theme, children }) {
  return (
    <div className="app-frame" data-theme={theme}>
      {children}
    </div>
  );
}

