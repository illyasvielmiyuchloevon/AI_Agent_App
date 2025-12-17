import React from 'react';
import { SearchIcon } from './icons';

const getInitials = (name = '') => {
  const trimmed = String(name || '').trim();
  if (!trimmed) return 'U';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] || '';
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] : '';
  const raw = (first + second).toUpperCase();
  return raw || trimmed.slice(0, 1).toUpperCase();
};

function SettingsSidebar({
  userName = 'User',
  isPro = false,
  query = '',
  onQueryChange,
  items = [],
  activeId,
  onSelect,
  language = 'zh'
}) {
  const searchLabel = language === 'zh' ? '搜索设置项' : 'Search settings';

  return (
    <div className="settings-sidebar-inner">
      <div className="settings-user">
        <div className="settings-avatar" aria-hidden>
          {getInitials(userName)}
        </div>
        <div className="settings-user-meta">
          <div className="settings-user-name">{userName}</div>
          {isPro && <span className="settings-pro-pill">Pro</span>}
        </div>
      </div>

      <div className="settings-search">
        <label className="sr-only" htmlFor="settings-search-input">
          {searchLabel}
        </label>
        <span className="settings-search-icon" aria-hidden>
          <SearchIcon />
        </span>
        <input
          id="settings-search-input"
          value={query}
          onChange={(e) => onQueryChange && onQueryChange(e.target.value)}
          placeholder={language === 'zh' ? '搜索' : 'Search'}
          className="settings-search-input"
          autoComplete="off"
        />
        <kbd className="settings-search-kbd" aria-hidden>
          Ctrl+F
        </kbd>
      </div>

      <div className="settings-sidebar-divider" aria-hidden />

      <nav className="settings-nav" aria-label={language === 'zh' ? '设置导航' : 'Settings navigation'}>
        {items.map((item) => {
          const active = item.id === activeId;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              className={`settings-nav-item ${active ? 'active' : ''}`}
              onClick={() => onSelect && onSelect(item.id)}
              aria-current={active ? 'page' : undefined}
            >
              {Icon && (
                <span className="settings-nav-icon" aria-hidden>
                  <Icon />
                </span>
              )}
              <span className="settings-nav-label">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export default SettingsSidebar;
