import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getTranslation } from '../utils/i18n';
import SettingsLayout from './settings/SettingsLayout';
import SettingsSidebar from './settings/SettingsSidebar';
import SectionCard from './settings/SectionCard';
import SettingRow from './settings/SettingRow';
import Switch from './settings/Switch';
import { GeneralIcon, MenuIcon, PaletteIcon, SlidersIcon, ToolsIcon } from './settings/icons';

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));

function SliderControl({
  value,
  min,
  max,
  step,
  unit = '',
  defaultValue,
  onChange,
  language = 'zh'
}) {
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleNumberChange = (e) => {
    const nextRaw = e.target.value;
    setLocalValue(nextRaw);
    const next = Number(nextRaw);
    if (!Number.isFinite(next)) return;
    onChange && onChange(clampNumber(next, min, max));
  };

  const handleBlur = () => {
    const next = clampNumber(Number(localValue), min, max);
    const fixed = Number.isFinite(next) ? next : defaultValue ?? min;
    setLocalValue(fixed);
    onChange && onChange(fixed);
  };

  const resetLabel = language === 'zh' ? '重置' : 'Reset';

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
          onChange={handleNumberChange}
          onBlur={handleBlur}
        />
        {unit ? <span className="settings-slider-unit">{unit}</span> : null}
      </div>
      <button
        type="button"
        className="ghost-btn"
        style={{ height: 34, padding: '0 10px', fontSize: '0.86rem' }}
        onClick={() => {
          const next = defaultValue ?? min;
          setLocalValue(next);
          onChange && onChange(next);
        }}
      >
        {resetLabel}
      </button>
    </div>
  );
}

function ConfigPanel({
  config,
  setConfig,
  toolSettings,
  onToolSettingsChange,
  onSave,
  onClose,
  checkApiStatus,
  apiStatus,
  apiMessage,
  appearanceMode = 'system',
  onChangeAppearanceMode,
  language = 'zh',
  onLanguageChange,
  displayPreferences,
  onChangeDisplayPreference,
  onOpenInEditor,
  fullscreen,
  onToggleFullscreen,
  variant = 'modal'
}) {
  const [activeTab, setActiveTab] = useState('app');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const t = (key) => getTranslation(language, key);
  const currentProvider = config?.provider || 'openai';
  const currentConfig = config?.[currentProvider] || {};
  const isFirstRun = useRef(true);

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    const timer = setTimeout(() => {
      if (onSave) onSave({ silent: true });
    }, 1000);
    return () => clearTimeout(timer);
  }, [config, onSave]);

  const updateCurrent = (field, value) => {
    setConfig((prev) => ({
      ...prev,
      [prev.provider]: {
        ...prev[prev.provider],
        [field]: value
      }
    }));
  };

  const resetParameters = () => {
    const okLabel =
      language === 'zh'
        ? '确定要将会话与模型参数重置为默认值吗？'
        : 'Reset all session and model parameters to defaults?';
    if (!window.confirm(okLabel)) return;

    setConfig((prev) => ({
      ...prev,
      [prev.provider]: {
        ...prev[prev.provider],
        context_independent: true,
        context_max_length: 128000,
        context_min_length: 32000,
        output_max_tokens: 32768,
        output_min_tokens: 1,
        temperature: 0.8
      }
    }));
  };

  const toggleTool = (modeKey, toolKey, nextEnabled) => {
    onToolSettingsChange((prev) => ({
      ...prev,
      [modeKey]: {
        ...prev[modeKey],
        [toolKey]: typeof nextEnabled === 'boolean' ? nextEnabled : !prev[modeKey][toolKey]
      }
    }));
  };

  const navItems = useMemo(
    () => [
      { id: 'app', label: language === 'zh' ? '通用' : 'General', icon: GeneralIcon },
      { id: 'appearance', label: language === 'zh' ? '外观' : 'Appearance', icon: PaletteIcon },
      { id: 'general', label: language === 'zh' ? '模型与会话' : 'LLM & Session', icon: SlidersIcon },
      { id: 'agent', label: language === 'zh' ? '智能体' : 'Agent', icon: ToolsIcon },
      { id: 'canva', label: language === 'zh' ? '对话流' : 'Canva', icon: ToolsIcon }
    ],
    [language]
  );

  const statusText =
    apiStatus === 'checking'
      ? language === 'zh'
        ? '检测中…'
        : 'Checking…'
      : apiStatus === 'ok'
        ? language === 'zh'
          ? '已连接'
          : 'Connected'
        : apiStatus === 'error'
          ? language === 'zh'
            ? '连接失败'
            : 'Connection failed'
          : '';

  const renderAppPage = () => {
    const pageTitle = language === 'zh' ? '通用' : 'General';
    const languageLabel = language === 'zh' ? '语言' : t('language');
    const languageDesc =
      language === 'zh' ? '选择按钮标签与应用内文本的语言' : 'Choose the language for UI text and labels.';

    return (
      <>
        <h1 className="settings-page-title">{pageTitle}</h1>
        <p className="settings-page-intro">{t('globalSettingsDesc')}</p>

        <div className="settings-group-title">{language === 'zh' ? '基础设置' : 'Basics'}</div>
        <SectionCard>
          <SettingRow title={languageLabel} description={languageDesc} htmlFor="settings-language">
            <select
              id="settings-language"
              className="settings-control compact"
              value={language}
              onChange={(e) => onLanguageChange && onLanguageChange(e.target.value)}
            >
              <option value="zh">中文</option>
              <option value="en">English</option>
              <option value="ja">日本語</option>
            </select>
          </SettingRow>

          <SettingRow
            title={language === 'zh' ? '设置面板位置' : 'Settings panel location'}
            description={language === 'zh' ? '选择打开设置时的默认展示位置' : 'Choose where Settings opens by default.'}
            htmlFor="settings-view-settings"
          >
            <select
              id="settings-view-settings"
              className="settings-control compact"
              value={displayPreferences?.settings || 'modal'}
              onChange={(e) => onChangeDisplayPreference && onChangeDisplayPreference('settings', e.target.value)}
            >
              <option value="modal">{language === 'zh' ? '弹窗' : 'Modal'}</option>
              <option value="editor">{language === 'zh' ? '编辑器' : 'Editor'}</option>
            </select>
          </SettingRow>

          <SettingRow
            title={language === 'zh' ? 'Diff 查看位置' : 'Diff viewer location'}
            description={language === 'zh' ? '选择打开 Diff 时的默认展示位置' : 'Choose where Diff opens by default.'}
            htmlFor="settings-view-diff"
          >
            <select
              id="settings-view-diff"
              className="settings-control compact"
              value={displayPreferences?.diff || 'modal'}
              onChange={(e) => onChangeDisplayPreference && onChangeDisplayPreference('diff', e.target.value)}
            >
              <option value="modal">{language === 'zh' ? '弹窗' : 'Modal'}</option>
              <option value="editor">{language === 'zh' ? '编辑器' : 'Editor'}</option>
            </select>
          </SettingRow>
        </SectionCard>
      </>
    );
  };

  const renderAppearancePage = () => {
    const pageTitle = language === 'zh' ? '外观' : 'Appearance';
    return (
      <>
        <h1 className="settings-page-title">{pageTitle}</h1>
        <p className="settings-page-intro">
          {language === 'zh' ? '调整主题模式与外观显示，支持跟随系统。' : 'Adjust theme and appearance, including system mode.'}
        </p>

        <div className="settings-group-title">{language === 'zh' ? '基础设置' : 'Basics'}</div>
        <SectionCard>
          <SettingRow
            title={language === 'zh' ? '主题模式' : 'Theme mode'}
            description={language === 'zh' ? '跟随系统或固定为浅色/深色' : 'Follow system or force light/dark.'}
            htmlFor="settings-theme-mode"
          >
            <select
              id="settings-theme-mode"
              className="settings-control compact"
              value={appearanceMode}
              onChange={(e) => onChangeAppearanceMode && onChangeAppearanceMode(e.target.value)}
            >
              <option value="system">{language === 'zh' ? '跟随系统' : 'System'}</option>
              <option value="light">{language === 'zh' ? '浅色' : 'Light'}</option>
              <option value="dark">{language === 'zh' ? '深色' : 'Dark'}</option>
            </select>
          </SettingRow>
        </SectionCard>
      </>
    );
  };

  const renderModelPage = () => {
    const pageTitle = language === 'zh' ? '模型与会话' : t('llmAndSession');
    return (
      <>
        <h1 className="settings-page-title">{pageTitle}</h1>
        <p className="settings-page-intro">
          {language === 'zh'
            ? '配置模型供应商、连接信息与会话参数。更改会自动保存。'
            : 'Configure provider, connection, and session parameters. Changes auto-save.'}
        </p>

        <div className="settings-group-title">{language === 'zh' ? '连接设置' : 'Connection'}</div>
        <SectionCard>
          <SettingRow title={t('provider')} description={language === 'zh' ? '选择模型服务提供方' : 'Select provider.'} htmlFor="settings-provider">
            <select
              id="settings-provider"
              className="settings-control"
              value={currentProvider}
              onChange={(e) => setConfig({ ...config, provider: e.target.value })}
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </SettingRow>

          <SettingRow title={t('apiKey')} description={language === 'zh' ? '用于调用模型 API 的密钥' : 'API key for provider.'} htmlFor="settings-api-key">
            <input
              id="settings-api-key"
              type="password"
              className="settings-control"
              value={currentConfig.api_key || ''}
              onChange={(e) => updateCurrent('api_key', e.target.value)}
              placeholder="sk-..."
              autoComplete="off"
            />
          </SettingRow>

          <SettingRow title={t('baseUrl')} description={language === 'zh' ? '自定义 API Base URL（可选）' : 'Override base URL (optional).'} htmlFor="settings-base-url">
            <input
              id="settings-base-url"
              type="text"
              className="settings-control"
              value={currentConfig.base_url || ''}
              onChange={(e) => updateCurrent('base_url', e.target.value)}
              placeholder={currentProvider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com'}
            />
          </SettingRow>

          <SettingRow title={t('model')} description={language === 'zh' ? '默认使用的模型名称' : 'Default model name.'} htmlFor="settings-model">
            <input
              id="settings-model"
              type="text"
              className="settings-control"
              value={currentConfig.model || ''}
              onChange={(e) => updateCurrent('model', e.target.value)}
              placeholder={currentProvider === 'openai' ? 'gpt-4-turbo' : 'claude-3-opus-20240229'}
            />
          </SettingRow>
        </SectionCard>

        <div className="settings-group-title">{language === 'zh' ? '会话上下文' : 'Session context'}</div>
        <SectionCard>
          <SettingRow
            title={t('independentSessionContext')}
            description={t('independentSessionContextDesc')}
          >
            <Switch
              checked={!!currentConfig.context_independent}
              label={t('independentSessionContext')}
              onChange={(next) => updateCurrent('context_independent', next)}
            />
          </SettingRow>

          <SettingRow
            title={t('contextWindowLimit')}
            description={language === 'zh' ? '设置最大上下文长度（32k–256k tokens）' : 'Set max context length (32k–256k tokens).'}
          >
            <SliderControl
              language={language}
              value={currentConfig.context_max_length ?? 128000}
              min={32000}
              max={256000}
              step={1024}
              defaultValue={128000}
              unit="tk"
              onChange={(val) => updateCurrent('context_max_length', val)}
            />
          </SettingRow>
        </SectionCard>

        <div className="settings-group-title">{language === 'zh' ? '模型参数' : 'Model parameters'}</div>
        <SectionCard>
          <SettingRow
            title={language === 'zh' ? '最大输出 Tokens' : 'Max output tokens'}
            description={language === 'zh' ? '限制生成 token 数量（1–65536）' : 'Limit output tokens (1–65,536).'}
          >
            <SliderControl
              language={language}
              value={currentConfig.output_max_tokens ?? 32768}
              min={1}
              max={65536}
              step={1}
              defaultValue={32768}
              unit="tk"
              onChange={(val) => updateCurrent('output_max_tokens', val)}
            />
          </SettingRow>

          <SettingRow
            title={t('temperature')}
            description={language === 'zh' ? '控制随机性与创造性（0.1–2.0）' : 'Creativity control (0.1–2.0).'}
          >
            <SliderControl
              language={language}
              value={currentConfig.temperature ?? 0.8}
              min={0.1}
              max={2.0}
              step={0.1}
              defaultValue={0.8}
              onChange={(val) => updateCurrent('temperature', val)}
            />
          </SettingRow>

          <SettingRow
            title={language === 'zh' ? '重置参数' : 'Reset parameters'}
            description={language === 'zh' ? '将会话与模型参数恢复为默认值' : 'Restore session/model parameters to defaults.'}
          >
            <button type="button" className="ghost-btn" onClick={resetParameters} style={{ height: 34 }}>
              {language === 'zh' ? '重置为默认值' : t('resetToDefaults')}
            </button>
          </SettingRow>
        </SectionCard>
      </>
    );
  };

  const renderToolPage = (modeKey) => {
    const pageTitle =
      modeKey === 'agent'
        ? language === 'zh'
          ? '智能体'
          : 'Agent'
        : language === 'zh'
          ? '对话流'
          : 'Canva';
    const entries = Object.entries(toolSettings?.[modeKey] || {});

    return (
      <>
        <h1 className="settings-page-title">{pageTitle}</h1>
        <p className="settings-page-intro">
          {language === 'zh'
            ? '按模式管理可用工具开关。'
            : 'Enable/disable tools available in this mode.'}
        </p>

        <div className="settings-group-title">{language === 'zh' ? '工具开关' : 'Tools'}</div>
        <SectionCard>
          {entries.map(([key, enabled]) => (
            <SettingRow key={key} title={key} description={searchQuery ? undefined : undefined}>
              <Switch checked={!!enabled} label={key} onChange={(next) => toggleTool(modeKey, key, next)} />
            </SettingRow>
          ))}
        </SectionCard>
      </>
    );
  };

  const page =
    activeTab === 'app'
      ? renderAppPage()
      : activeTab === 'appearance'
        ? renderAppearancePage()
        : activeTab === 'general'
          ? renderModelPage()
          : activeTab === 'agent'
            ? renderToolPage('agent')
            : renderToolPage('canva');

  const sidebar = (
    <SettingsSidebar
      userName={language === 'zh' ? '用户' : 'User'}
      isPro={false}
      query={searchQuery}
      onQueryChange={setSearchQuery}
      items={navItems}
      activeId={activeTab}
      onSelect={(id) => {
        setActiveTab(id);
        setSidebarOpen(false);
      }}
      language={language}
    />
  );

  const actionLabels = {
    openInEditor: language === 'zh' ? '在编辑器查看' : 'Open in editor',
    fullscreen: fullscreen ? (language === 'zh' ? '退出全屏' : 'Exit fullscreen') : language === 'zh' ? '全屏显示' : 'Fullscreen',
    close: language === 'zh' ? '关闭' : 'Close',
    test: language === 'zh' ? '测试连接' : 'Test connection',
    save: language === 'zh' ? '保存并关闭' : 'Save & close'
  };

  const content = (
    <>
      <div className="settings-toolbar">
        <div className="settings-toolbar-left">
          <button
            type="button"
            className="settings-menu-btn"
            onClick={() => setSidebarOpen(true)}
            aria-label={language === 'zh' ? '打开设置导航' : 'Open settings navigation'}
          >
            <MenuIcon />
          </button>
        </div>
        <div className="settings-footer-actions">
          {variant === 'modal' && (
            <>
              <button type="button" className="ghost-btn" onClick={onOpenInEditor} style={{ height: 34 }}>
                {actionLabels.openInEditor}
              </button>
              <button type="button" className="ghost-btn" onClick={onToggleFullscreen} style={{ height: 34 }}>
                {actionLabels.fullscreen}
              </button>
            </>
          )}
          <button type="button" className="ghost-btn" onClick={onClose} style={{ height: 34 }}>
            {actionLabels.close}
          </button>
        </div>
      </div>

      {page}

      <div className="settings-footer" aria-label={language === 'zh' ? '设置操作' : 'Settings actions'}>
        <div className={`config-status ${apiStatus || 'unknown'}`} aria-live="polite">
          {apiStatus && apiStatus !== 'unknown' ? (
            <>
              <span className="dot" />
              {statusText}
            </>
          ) : null}
          {apiMessage ? (
            <span style={{ marginLeft: 10, fontSize: 12, color: apiStatus === 'ok' ? 'var(--success)' : 'var(--danger)' }}>
              {apiMessage}
            </span>
          ) : null}
        </div>

        <div className="settings-footer-actions">
          <button type="button" className="ghost-btn" onClick={checkApiStatus} style={{ height: 34 }}>
            {actionLabels.test}
          </button>
          <button
            type="button"
            className="primary-btn"
            onClick={() => {
              onSave && onSave();
              onClose && onClose();
            }}
            style={{ height: 34 }}
          >
            {actionLabels.save}
          </button>
        </div>
      </div>
    </>
  );

  if (variant === 'inline') {
    return (
      <div className="config-inline-shell" style={{ flex: 1, minHeight: 0 }}>
        <div className="config-modal" style={{ width: '100%', height: '100%', maxWidth: 'none', maxHeight: 'none', borderRadius: 0 }}>
          <SettingsLayout sidebar={sidebar} sidebarOpen={sidebarOpen} onSidebarOpenChange={setSidebarOpen}>
            {content}
          </SettingsLayout>
        </div>
      </div>
    );
  }

  return (
    <div className="config-modal-backdrop">
      <div className="config-modal" style={fullscreen ? { width: '100vw', height: '100vh', maxWidth: '100vw', maxHeight: '100vh', borderRadius: 0 } : undefined}>
        <SettingsLayout sidebar={sidebar} sidebarOpen={sidebarOpen} onSidebarOpenChange={setSidebarOpen}>
          {content}
        </SettingsLayout>
      </div>
    </div>
  );
}

export default ConfigPanel;

