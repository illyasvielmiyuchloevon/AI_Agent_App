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
  const [modelListState, setModelListState] = useState({ loading: false, models: [], error: '' });

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

  const updateProviderConfig = (patch = {}) => {
    setConfig((prev) => ({
      ...prev,
      [prev.provider]: {
        ...prev[prev.provider],
        ...patch
      }
    }));
  };

  const getActiveInstance = () => {
    const instances = Array.isArray(currentConfig.instances) ? currentConfig.instances : [];
    const activeId = String(currentConfig.active_instance_id || instances[0]?.id || 'default');
    const active = instances.find((i) => String(i?.id) === activeId) || instances[0] || null;
    return { instances, activeId, active };
  };

  const updateActiveInstance = (field, value) => {
    setConfig((prev) => {
      const providerId = prev.provider;
      const providerCfg = prev?.[providerId] || {};
      const instances = Array.isArray(providerCfg.instances) ? providerCfg.instances : [];
      const activeId = String(providerCfg.active_instance_id || instances[0]?.id || 'default');
      const nextInstances = instances.length
        ? instances.map((inst) => (String(inst?.id) === activeId ? { ...inst, [field]: value } : inst))
        : [{ id: activeId, label: 'Default', api_key: '', base_url: '', [field]: value }];
      const syncPatch = (field === 'api_key' || field === 'base_url') ? { [field]: value } : {};
      return {
        ...prev,
        [providerId]: {
          ...providerCfg,
          ...syncPatch,
          instances: nextInstances,
          active_instance_id: activeId
        }
      };
    });
  };

  const updateDefaultModel = (field, value) => {
    setConfig((prev) => ({
      ...prev,
      default_models: {
        ...((prev.default_models && typeof prev.default_models === 'object') ? prev.default_models : {}),
        [field]: value
      }
    }));
  };

  const updateKeybinding = (id, value) => {
    const key = String(id || '').trim();
    if (!key) return;
    setConfig((prev) => ({
      ...prev,
      keybindings: {
        ...((prev.keybindings && typeof prev.keybindings === 'object') ? prev.keybindings : {}),
        [key]: value
      }
    }));
  };

  const baseUrlPlaceholder =
    currentProvider === 'openai'
      ? 'https://api.openai.com/v1'
      : currentProvider === 'anthropic'
        ? 'https://api.anthropic.com'
        : currentProvider === 'openrouter'
          ? 'https://openrouter.ai/api/v1'
          : currentProvider === 'xai'
            ? 'https://api.x.ai/v1'
            : currentProvider === 'ollama'
              ? 'http://localhost:11434/v1'
              : currentProvider === 'lmstudio'
                ? 'http://localhost:1234/v1'
                : '';

  const listModelsLabel = language === 'zh' ? '获取模型列表' : 'Fetch models';
  const listModels = async () => {
    setModelListState({ loading: true, models: [], error: '' });
    try {
      const { active } = getActiveInstance();
      const apiKey = (active && typeof active.api_key === 'string') ? active.api_key : currentConfig.api_key;
      const baseUrl = (active && typeof active.base_url === 'string') ? active.base_url : currentConfig.base_url;
      const res = await fetch('/api/ai-engine/models/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: currentProvider,
          api_key: apiKey,
          base_url: baseUrl
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || res.statusText || 'Request failed');
      const models = Array.isArray(data?.models) ? data.models.filter(Boolean) : [];
      setModelListState({ loading: false, models, error: '' });
    } catch (e) {
      setModelListState({ loading: false, models: [], error: e?.message || String(e) });
    }
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
        temperature: 0.8,
        top_p: 0.9
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
      { id: 'shortcuts', label: language === 'zh' ? '快捷键' : 'Shortcuts', icon: MenuIcon },
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
    const undoLimitRaw = Number(config?.editorUndoRedoLimit);
    const undoLimitValue = Number.isFinite(undoLimitRaw) ? Math.max(8, Math.min(64, Math.round(undoLimitRaw))) : 16;

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

          <SettingRow
            title={language === 'zh' ? '撤销/重做历史上限' : 'Undo/Redo history limit'}
            description={language === 'zh' ? '每个文件独立；仅对新打开/新建文件生效（8–64，默认 16）' : 'Per file; applies to newly opened/created files only (8–64, default 16).'}
            htmlFor="settings-editor-undo-limit"
          >
            <input
              id="settings-editor-undo-limit"
              type="number"
              className="settings-control compact"
              min={8}
              max={64}
              step={1}
              value={undoLimitValue}
              onChange={(e) => {
                const raw = Number(e.target.value);
                const next = Number.isFinite(raw) ? Math.max(8, Math.min(64, Math.round(raw))) : 16;
                setConfig((prev) => ({ ...prev, editorUndoRedoLimit: next }));
              }}
            />
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
    const { instances, activeId, active } = getActiveInstance();
    const activeLabel = language === 'zh' ? '实例' : 'Instance';
    const addLabel = language === 'zh' ? '新增' : 'Add';
    const removeLabel = language === 'zh' ? '删除' : 'Remove';
    const defaultModelsTitle = language === 'zh' ? '默认模型（按能力）' : 'Default models (by capability)';
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
              <option value="openrouter">OpenRouter</option>
              <option value="xai">xAI</option>
              <option value="ollama">Ollama</option>
              <option value="lmstudio">LM Studio</option>
            </select>
          </SettingRow>

          <SettingRow title={activeLabel} description={language === 'zh' ? '选择当前 Provider 的连接实例' : 'Select the active connection instance.'} htmlFor="settings-provider-instance">
            <div style={{ display: 'flex', gap: 8, width: '100%' }}>
              <select
                id="settings-provider-instance"
                className="settings-control"
                value={activeId}
                onChange={(e) => updateProviderConfig({ active_instance_id: e.target.value })}
              >
                {instances.map((inst) => (
                  <option key={String(inst?.id)} value={String(inst?.id)}>
                    {String(inst?.label || inst?.id || 'default')}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="ghost-btn"
                style={{ height: 34, whiteSpace: 'nowrap' }}
                onClick={() => {
                  const id = `inst-${Date.now()}`;
                  const nextInst = { id, label: `Instance ${instances.length + 1}`, api_key: '', base_url: baseUrlPlaceholder };
                  updateProviderConfig({
                    instances: [...instances, nextInst],
                    active_instance_id: id
                  });
                }}
              >
                {addLabel}
              </button>
              <button
                type="button"
                className="ghost-btn"
                style={{ height: 34, whiteSpace: 'nowrap' }}
                disabled={instances.length <= 1}
                onClick={() => {
                  if (instances.length <= 1) return;
                  const nextInstances = instances.filter((inst) => String(inst?.id) !== activeId);
                  const nextActive = String(nextInstances[0]?.id || 'default');
                  updateProviderConfig({ instances: nextInstances, active_instance_id: nextActive });
                }}
              >
                {removeLabel}
              </button>
            </div>
          </SettingRow>

          <SettingRow title={language === 'zh' ? '实例名称' : 'Instance name'} description={language === 'zh' ? '仅用于区分多个连接' : 'Label shown in the instance selector.'} htmlFor="settings-instance-label">
            <input
              id="settings-instance-label"
              type="text"
              className="settings-control"
              value={(active && typeof active.label === 'string') ? active.label : ''}
              onChange={(e) => updateActiveInstance('label', e.target.value)}
              placeholder={language === 'zh' ? '例如：公司代理 / 本地' : 'e.g. Work proxy / Local'}
              autoComplete="off"
            />
          </SettingRow>

          <SettingRow title={t('apiKey')} description={language === 'zh' ? '用于调用模型 API 的密钥' : 'API key for provider.'} htmlFor="settings-api-key">
            <input
              id="settings-api-key"
              type="password"
              className="settings-control"
              value={(active && typeof active.api_key === 'string') ? active.api_key : (currentConfig.api_key || '')}
              onChange={(e) => updateActiveInstance('api_key', e.target.value)}
              placeholder={currentProvider === 'ollama' || currentProvider === 'lmstudio' ? (language === 'zh' ? '无需填写（可留空）' : 'Optional') : 'sk-...'}
              autoComplete="off"
            />
          </SettingRow>

          <SettingRow title={t('baseUrl')} description={language === 'zh' ? '自定义 API Base URL（可选）' : 'Override base URL (optional).'} htmlFor="settings-base-url">
            <input
              id="settings-base-url"
              type="text"
              className="settings-control"
              value={(active && typeof active.base_url === 'string') ? active.base_url : (currentConfig.base_url || '')}
              onChange={(e) => updateActiveInstance('base_url', e.target.value)}
              placeholder={baseUrlPlaceholder}
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

          <SettingRow title={language === 'zh' ? '模型列表' : 'Model list'} description={language === 'zh' ? '从当前 Provider 获取可用模型' : 'Fetch available models from the provider.'}>
            <div style={{ display: 'flex', gap: 8, width: '100%', alignItems: 'center' }}>
              <button type="button" className="ghost-btn" onClick={listModels} style={{ height: 34, whiteSpace: 'nowrap' }} disabled={modelListState.loading}>
                {modelListState.loading ? (language === 'zh' ? '获取中…' : 'Loading…') : listModelsLabel}
              </button>
              {modelListState.models.length > 0 ? (
                <select
                  className="settings-control"
                  value={currentConfig.model || ''}
                  onChange={(e) => updateCurrent('model', e.target.value)}
                >
                  <option value="">{language === 'zh' ? '选择模型…' : 'Select a model…'}</option>
                  {modelListState.models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
            {modelListState.error ? <div style={{ marginTop: 6, color: 'var(--danger)' }}>{modelListState.error}</div> : null}
          </SettingRow>

          <SettingRow
            title={t('statusCheckModel')}
            description={
              language === 'zh'
                ? '用于“测试连接”的模型名称（可选）'
                : 'Model used for "Test connection" (optional).'
            }
            htmlFor="settings-check-model"
          >
            <input
              id="settings-check-model"
              type="text"
              className="settings-control"
              value={currentConfig.check_model || ''}
              onChange={(e) => updateCurrent('check_model', e.target.value)}
              placeholder={currentProvider === 'openai' ? 'gpt-4o-mini' : 'claude-3-haiku-20240307'}
              autoComplete="off"
            />
          </SettingRow>
        </SectionCard>

        <div className="settings-group-title">{defaultModelsTitle}</div>
        <SectionCard>
          <SettingRow title={language === 'zh' ? '通用' : 'General'} description={language === 'zh' ? '默认聊天/生成模型' : 'Default model for chat/generation.'}>
            <input
              type="text"
              className="settings-control"
              value={config?.default_models?.general || ''}
              onChange={(e) => updateDefaultModel('general', e.target.value)}
              placeholder={language === 'zh' ? '留空则使用上方 Model' : 'Empty uses the provider model above'}
            />
          </SettingRow>
          <SettingRow
            title={language === 'zh' ? 'Inline（行内补全）' : 'Inline'}
            description={language === 'zh' ? '编辑器行内补全使用的模型（可选）' : 'Model used for editor inline completion (optional).'}
          >
            <input
              type="text"
              className="settings-control"
              value={config?.default_models?.fast || ''}
              onChange={(e) => updateDefaultModel('fast', e.target.value)}
            />
          </SettingRow>
          <SettingRow title={language === 'zh' ? '推理' : 'Reasoning'} description={language === 'zh' ? '需要更强推理的模型（可选）' : 'Model used for stronger reasoning (optional).'}>
            <input
              type="text"
              className="settings-control"
              value={config?.default_models?.reasoning || ''}
              onChange={(e) => updateDefaultModel('reasoning', e.target.value)}
            />
          </SettingRow>
          <SettingRow title={language === 'zh' ? '工具' : 'Tools'} description={language === 'zh' ? '用于工具调用/函数调用（可选）' : 'Model used for tool/function calls (optional).'}>
            <input
              type="text"
              className="settings-control"
              value={config?.default_models?.tools || ''}
              onChange={(e) => updateDefaultModel('tools', e.target.value)}
            />
          </SettingRow>
          <SettingRow title={language === 'zh' ? '向量' : 'Embeddings'} description={language === 'zh' ? '向量模型（可选）' : 'Embeddings model (optional).'}>
            <input
              type="text"
              className="settings-control"
              value={config?.default_models?.embeddings || ''}
              onChange={(e) => updateDefaultModel('embeddings', e.target.value)}
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
            title={language === 'zh' ? 'Top P' : 'Top P'}
            description={language === 'zh' ? '控制采样的截断概率（0.1–1.0）' : 'Nucleus sampling probability (0.1–1.0).'}
          >
            <SliderControl
              language={language}
              value={currentConfig.top_p ?? 0.9}
              min={0.1}
              max={1.0}
              step={0.05}
              defaultValue={0.9}
              onChange={(val) => updateCurrent('top_p', val)}
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

  const renderShortcutsPage = () => {
    const pageTitle = language === 'zh' ? '快捷键' : 'Shortcuts';
    const rows = [
      {
        id: 'app.quickOpen',
        title: language === 'zh' ? '打开文件/命令面板' : 'Quick open',
        description: language === 'zh' ? '打开命令面板（默认 Ctrl+P）' : 'Open command palette (default Ctrl+P).',
        placeholder: 'Ctrl+P',
      },
      {
        id: 'app.commandPalette',
        title: language === 'zh' ? '打开命令面板（命令）' : 'Command palette',
        description: language === 'zh' ? '打开命令面板（默认 Ctrl+Shift+P）' : 'Open command palette (default Ctrl+Shift+P).',
        placeholder: 'Ctrl+Shift+P',
      },
      {
        id: 'editor.ai.explain',
        title: language === 'zh' ? 'AI：解释代码' : 'AI: Explain',
        description: language === 'zh' ? '编辑器动作快捷键（可留空使用默认值）' : 'Editor action shortcut (leave empty to use default).',
        placeholder: 'Ctrl+Alt+E',
      },
      { id: 'editor.ai.tests', title: language === 'zh' ? 'AI：生成单元测试' : 'AI: Generate tests', description: '', placeholder: 'Ctrl+Alt+T' },
      { id: 'editor.ai.optimize', title: language === 'zh' ? 'AI：优化代码' : 'AI: Optimize', description: '', placeholder: 'Ctrl+Alt+O' },
      { id: 'editor.ai.comments', title: language === 'zh' ? 'AI：生成注释' : 'AI: Generate comments', description: '', placeholder: 'Ctrl+Alt+C' },
      { id: 'editor.ai.review', title: language === 'zh' ? 'AI：审阅代码' : 'AI: Review', description: '', placeholder: 'Ctrl+Alt+R' },
      { id: 'editor.ai.rewrite', title: language === 'zh' ? 'AI：重写代码' : 'AI: Rewrite', description: '', placeholder: 'Ctrl+Alt+W' },
      { id: 'editor.ai.modify', title: language === 'zh' ? 'AI：按指令修改' : 'AI: Modify', description: '', placeholder: 'Ctrl+Alt+M' },
      { id: 'editor.ai.docs', title: language === 'zh' ? 'AI：生成文档' : 'AI: Generate docs', description: '', placeholder: 'Ctrl+Alt+D' },
    ];

    const kb = (config?.keybindings && typeof config.keybindings === 'object') ? config.keybindings : {};

    return (
      <>
        <h1 className="settings-page-title">{pageTitle}</h1>
        <p className="settings-page-intro">
          {language === 'zh'
            ? '输入形如 Ctrl+Shift+P 的组合键；留空表示使用默认值。'
            : 'Enter shortcuts like Ctrl+Shift+P. Leave empty to use defaults.'}
        </p>

        <div className="settings-group-title">{language === 'zh' ? '全局' : 'Global'}</div>
        <SectionCard>
          {rows.slice(0, 2).map((r) => (
            <SettingRow key={r.id} title={r.title} description={r.description || undefined}>
              <input
                type="text"
                className="settings-control"
                value={typeof kb[r.id] === 'string' ? kb[r.id] : ''}
                onChange={(e) => updateKeybinding(r.id, e.target.value)}
                placeholder={r.placeholder}
                autoComplete="off"
              />
            </SettingRow>
          ))}
        </SectionCard>

        <div className="settings-group-title">{language === 'zh' ? '编辑器（AI）' : 'Editor (AI)'}</div>
        <SectionCard>
          {rows.slice(2).map((r) => (
            <SettingRow key={r.id} title={r.title} description={r.description || undefined}>
              <input
                type="text"
                className="settings-control"
                value={typeof kb[r.id] === 'string' ? kb[r.id] : ''}
                onChange={(e) => updateKeybinding(r.id, e.target.value)}
                placeholder={r.placeholder}
                autoComplete="off"
              />
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
          : activeTab === 'shortcuts'
            ? renderShortcutsPage()
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
    save: variant === 'inline' ? (language === 'zh' ? '保存' : 'Save') : language === 'zh' ? '保存并关闭' : 'Save & close'
  };

  const showTopActions = variant === 'modal';

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
        {showTopActions ? (
          <div className="settings-footer-actions">
            <button type="button" className="ghost-btn" onClick={onOpenInEditor} style={{ height: 34 }}>
              {actionLabels.openInEditor}
            </button>
            <button type="button" className="ghost-btn" onClick={onToggleFullscreen} style={{ height: 34 }}>
              {actionLabels.fullscreen}
            </button>
            <button type="button" className="ghost-btn" onClick={onClose} style={{ height: 34 }}>
              {actionLabels.close}
            </button>
          </div>
        ) : null}
      </div>

      <div className="settings-main-scroll">{page}</div>

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
              if (variant !== 'inline') onClose && onClose();
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
      <div className="config-inline-shell" style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <SettingsLayout variant="inline" sidebar={sidebar} sidebarOpen={sidebarOpen} onSidebarOpenChange={setSidebarOpen}>
          {content}
        </SettingsLayout>
      </div>
    );
  }

  return (
    <div className="config-modal-backdrop">
      <div className="config-modal" style={fullscreen ? { width: '100vw', height: '100vh', maxWidth: '100vw', maxHeight: '100vh', borderRadius: 0 } : undefined}>
        <SettingsLayout variant="modal" sidebar={sidebar} sidebarOpen={sidebarOpen} onSidebarOpenChange={setSidebarOpen}>
          {content}
        </SettingsLayout>
      </div>
    </div>
  );
}

export default ConfigPanel;

