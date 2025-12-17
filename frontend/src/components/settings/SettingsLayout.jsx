import React from 'react';

function SettingsLayout({ sidebar, children, sidebarOpen = false, onSidebarOpenChange }) {
  return (
    <div className="settings-page">
      <div className="settings-shell" data-sidebar-open={sidebarOpen ? 'true' : 'false'}>
        <div
          className="settings-overlay"
          role="presentation"
          onClick={() => onSidebarOpenChange && onSidebarOpenChange(false)}
        />
        <aside className="settings-sidebar" aria-label="Settings navigation">
          {sidebar}
        </aside>
        <main className="settings-main">{children}</main>
      </div>
    </div>
  );
}

export default SettingsLayout;

