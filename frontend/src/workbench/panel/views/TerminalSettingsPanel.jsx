import React, { useEffect, useMemo, useRef, useState } from 'react';
import SettingsLayout from '../../../components/settings/SettingsLayout';
import SettingsSidebar from '../../../components/settings/SettingsSidebar';
import SectionCard from '../../../components/settings/SectionCard';
import SettingRow from '../../../components/settings/SettingRow';
import Switch from '../../../components/settings/Switch';
import { SlidersIcon, ToolsIcon } from '../../../components/settings/icons';

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));

function SliderControl({ value, min, max, step, unit = '', onChange }) {
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  return (
    <div className="settings-slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={typeof localValue === 'number' ? localValue : clampNumber(Number(localValue) || min, min, max)}
        onChange={(e) => {
          const next = Number(e.target.value);
          setLocalValue(next);
          onChange && onChange(next);
        }}
      />
      <div className="settings-slider-number">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={localValue}
          onChange={(e) => {
            const nextRaw = e.target.value;
            setLocalValue(nextRaw);
            const next = Number(nextRaw);
            if (!Number.isFinite(next)) return;
            onChange && onChange(clampNumber(next, min, max));
          }}
          onBlur={() => {
            const next = clampNumber(Number(localValue), min, max);
            const fixed = Number.isFinite(next) ? next : min;
            setLocalValue(fixed);
            onChange && onChange(fixed);
          }}
        />
        {unit ? <span className="settings-slider-unit">{unit}</span> : null}
      </div>
    </div>
  );
}

function ResetButton({ onClick, title = '重置' }) {
  return (
    <button type="button" className="ghost-btn terminal-settings-reset" onClick={onClick} title={title}>
      重置
    </button>
  );
}

function matchesQuery(query, ...fields) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => String(f || '').toLowerCase().includes(q));
}

export default function TerminalSettingsPanel({
  open = false,
  onClose,
  query = '',
  onQueryChange,
  activeSection = 'integrated',
  onActiveSectionChange,
  scope = 'workspace',
  onScopeChange,
  integratedSettings,
  scopeOverrides,
  onPatchScopeOverrides,
  onResetScopeOverrideKey,
  defaultProfile = 'cmd',
  onChangeDefaultProfile,
  profileEditing = 'cmd',
  onChangeProfileEditing,
  profileEnvText,
  onChangeProfileEnvText,
}) {
  const closeBtnRef = useRef(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      try { closeBtnRef.current?.focus?.(); } catch {}
    }, 0);
    return () => window.clearTimeout(t);
  }, [open]);

  const navItems = useMemo(() => ([
    { id: 'integrated', label: '集成终端', icon: SlidersIcon },
    { id: 'profiles', label: 'Profiles', icon: ToolsIcon },
  ]), []);

  if (!open) return null;

  const hasOverride = (key) => Object.prototype.hasOwnProperty.call(scopeOverrides || {}, key);
  const resetKey = (key) => onResetScopeOverrideKey && onResetScopeOverrideKey(key);

  return (
    <div className="vscode-terminal-settings-overlay" role="dialog" aria-label="Terminal Settings">
      <SettingsLayout
        variant="inline"
        sidebarOpen={sidebarOpen}
        onSidebarOpenChange={setSidebarOpen}
        sidebar={(
          <SettingsSidebar
            userName="Terminal"
            isPro={false}
            query={query}
            onQueryChange={onQueryChange}
            items={navItems}
            activeId={activeSection}
            onSelect={(id) => {
              onActiveSectionChange && onActiveSectionChange(id);
              setSidebarOpen(false);
            }}
            language="zh"
          />
        )}
      >
        <div className="settings-toolbar">
          <div className="settings-toolbar-left">
            <button
              type="button"
              className="settings-menu-btn"
              onClick={() => setSidebarOpen(true)}
              title="打开导航"
            >
              <span className="codicon codicon-list-flat" aria-hidden />
            </button>
            <h1 className="settings-page-title">终端设置</h1>
          </div>
          <div className="terminal-settings-toolbar-right">
            <div className="terminal-settings-scope" role="tablist" aria-label="Settings scope">
              <button
                type="button"
                role="tab"
                aria-selected={scope === 'user'}
                className={`terminal-settings-scope-tab ${scope === 'user' ? 'active' : ''}`}
                onClick={() => onScopeChange && onScopeChange('user')}
              >
                用户
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={scope === 'workspace'}
                className={`terminal-settings-scope-tab ${scope === 'workspace' ? 'active' : ''}`}
                onClick={() => onScopeChange && onScopeChange('workspace')}
              >
                工作区
              </button>
            </div>
            <button
              ref={closeBtnRef}
              type="button"
              className="bottom-panel-icon-btn"
              onClick={() => onClose && onClose()}
              title="关闭"
            >
              <span className="codicon codicon-close" aria-hidden />
            </button>
          </div>
        </div>

        <div className="settings-main-scroll terminal-settings-main">
          {activeSection === 'integrated' ? (
            <>
              <div className="settings-group-title">Terminal › Integrated</div>
              <SectionCard>
                {matchesQuery(query, 'Terminal Integrated Font Family', '字体') ? (
                  <SettingRow
                    title="Terminal › Integrated: Font Family"
                    description="终端使用的字体族（CSS font-family）。"
                  >
                    <div className="terminal-settings-control">
                      <input
                        className="ghost-input terminal-settings-input"
                        value={integratedSettings?.fontFamily || ''}
                        onChange={(e) => onPatchScopeOverrides && onPatchScopeOverrides({ fontFamily: e.target.value })}
                        placeholder="Consolas, ui-monospace, ..."
                      />
                      {hasOverride('fontFamily') ? <ResetButton onClick={() => resetKey('fontFamily')} /> : null}
                    </div>
                  </SettingRow>
                ) : null}

                {matchesQuery(query, 'Terminal Integrated Font Size', '字号') ? (
                  <SettingRow
                    title="Terminal › Integrated: Font Size"
                    description="终端字体大小。"
                  >
                    <div className="terminal-settings-control">
                      <SliderControl
                        value={Number(integratedSettings?.fontSize || 13)}
                        min={9}
                        max={24}
                        step={1}
                        onChange={(v) => onPatchScopeOverrides && onPatchScopeOverrides({ fontSize: v })}
                      />
                      {hasOverride('fontSize') ? <ResetButton onClick={() => resetKey('fontSize')} /> : null}
                    </div>
                  </SettingRow>
                ) : null}

                {matchesQuery(query, 'Terminal Integrated Line Height', '行高') ? (
                  <SettingRow
                    title="Terminal › Integrated: Line Height"
                    description="终端行高倍数。"
                  >
                    <div className="terminal-settings-control">
                      <SliderControl
                        value={Number(integratedSettings?.lineHeight || 1.2)}
                        min={1}
                        max={2}
                        step={0.05}
                        onChange={(v) => onPatchScopeOverrides && onPatchScopeOverrides({ lineHeight: v })}
                      />
                      {hasOverride('lineHeight') ? <ResetButton onClick={() => resetKey('lineHeight')} /> : null}
                    </div>
                  </SettingRow>
                ) : null}

                {matchesQuery(query, 'Terminal Integrated Cursor Style', '光标') ? (
                  <SettingRow
                    title="Terminal › Integrated: Cursor Style"
                    description="光标样式。"
                  >
                    <div className="terminal-settings-control">
                      <select
                        className="ghost-input bottom-panel-select terminal-settings-select"
                        value={integratedSettings?.cursorStyle || 'block'}
                        onChange={(e) => onPatchScopeOverrides && onPatchScopeOverrides({ cursorStyle: e.target.value })}
                      >
                        <option value="block">block</option>
                        <option value="underline">underline</option>
                        <option value="bar">bar</option>
                      </select>
                      {hasOverride('cursorStyle') ? <ResetButton onClick={() => resetKey('cursorStyle')} /> : null}
                    </div>
                  </SettingRow>
                ) : null}

                {matchesQuery(query, 'Terminal Integrated Cursor Blinking', '闪烁') ? (
                  <SettingRow
                    title="Terminal › Integrated: Cursor Blinking"
                    description="光标是否闪烁。"
                  >
                    <div className="terminal-settings-control">
                      <Switch
                        checked={!!integratedSettings?.cursorBlink}
                        onChange={(v) => onPatchScopeOverrides && onPatchScopeOverrides({ cursorBlink: v })}
                        label="Cursor Blinking"
                      />
                      {hasOverride('cursorBlink') ? <ResetButton onClick={() => resetKey('cursorBlink')} /> : null}
                    </div>
                  </SettingRow>
                ) : null}

                {matchesQuery(query, 'Terminal Integrated Scrollback', '回滚') ? (
                  <SettingRow
                    title="Terminal › Integrated: Scrollback"
                    description="终端回滚缓冲区行数。"
                  >
                    <div className="terminal-settings-control">
                      <input
                        type="number"
                        className="ghost-input terminal-settings-number"
                        value={Number(integratedSettings?.scrollback || 4000)}
                        min={100}
                        max={100000}
                        step={100}
                        onChange={(e) => onPatchScopeOverrides && onPatchScopeOverrides({ scrollback: Number(e.target.value) })}
                      />
                      {hasOverride('scrollback') ? <ResetButton onClick={() => resetKey('scrollback')} /> : null}
                    </div>
                  </SettingRow>
                ) : null}

                {matchesQuery(query, 'Terminal Integrated Convert EOL', '换行') ? (
                  <SettingRow
                    title="Terminal › Integrated: Convert Eol"
                    description="将 \\n 自动转换为 \\r\\n（更符合 Windows 命令行）。"
                  >
                    <div className="terminal-settings-control">
                      <Switch
                        checked={!!integratedSettings?.convertEol}
                        onChange={(v) => onPatchScopeOverrides && onPatchScopeOverrides({ convertEol: v })}
                        label="Convert EOL"
                      />
                      {hasOverride('convertEol') ? <ResetButton onClick={() => resetKey('convertEol')} /> : null}
                    </div>
                  </SettingRow>
                ) : null}
              </SectionCard>
            </>
          ) : null}

          {activeSection === 'profiles' ? (
            <>
              <div className="settings-group-title">Terminal › Profiles</div>
              <SectionCard>
                {matchesQuery(query, 'Default Profile', '默认') ? (
                  <SettingRow
                    title="Terminal › Integrated: Default Profile"
                    description="创建新终端时使用的默认 Profile。"
                  >
                    <select
                      className="ghost-input bottom-panel-select terminal-settings-select"
                      value={defaultProfile || 'cmd'}
                      onChange={(e) => onChangeDefaultProfile && onChangeDefaultProfile(e.target.value)}
                    >
                      <option value="cmd">Command Prompt (cmd)</option>
                      <option value="powershell">PowerShell</option>
                      <option value="bash">Bash</option>
                    </select>
                  </SettingRow>
                ) : null}

                {matchesQuery(query, 'Env', '环境变量') ? (
                  <SettingRow
                    title="Terminal › Profiles: Env"
                    description="为不同 Profile 设置环境变量（每行一个：KEY=VALUE，# 开头为注释）。"
                  >
                    <div className="terminal-settings-profiles-env">
                      <select
                        className="ghost-input bottom-panel-select terminal-settings-select"
                        value={profileEditing}
                        onChange={(e) => onChangeProfileEditing && onChangeProfileEditing(e.target.value)}
                        title="Profile"
                      >
                        <option value="cmd">cmd</option>
                        <option value="powershell">powershell</option>
                        <option value="bash">bash</option>
                      </select>
                      <textarea
                        className="terminal-settings-textarea"
                        value={profileEnvText?.[profileEditing] || ''}
                        onChange={(e) => onChangeProfileEnvText && onChangeProfileEnvText(profileEditing, e.target.value)}
                        spellCheck="false"
                        placeholder={`例如：\nHTTP_PROXY=http://127.0.0.1:7890\nHTTPS_PROXY=http://127.0.0.1:7890`}
                      />
                    </div>
                  </SettingRow>
                ) : null}
              </SectionCard>
            </>
          ) : null}
        </div>
      </SettingsLayout>
    </div>
  );
}

