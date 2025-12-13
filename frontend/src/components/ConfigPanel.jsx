import React, { useState, useEffect, useRef } from 'react';

const ConfigSlider = ({ label, value, min, max, step, onChange, helpText, unit = '', defaultValue }) => {
    const [localValue, setLocalValue] = useState(value);
    
    // Update local value when prop changes
    useEffect(() => {
        setLocalValue(value);
    }, [value]);

    const handleNumberChange = (e) => {
        const newVal = e.target.value;
        setLocalValue(newVal);
        const numVal = Number(newVal);
        if (!isNaN(numVal) && numVal >= min && numVal <= max) {
            onChange(numVal);
        }
    };

    const handleBlur = () => {
        let numVal = Number(localValue);
        if (isNaN(numVal)) numVal = defaultValue || min;
        if (numVal < min) numVal = min;
        if (numVal > max) numVal = max;
        setLocalValue(numVal);
        onChange(numVal);
    };

    return (
        <div className="config-field" style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', alignItems: 'center' }}>
                 <label className="config-label" style={{ marginBottom: 0 }}>
                    {label}
                    {helpText && (
                        <span className="config-help-icon" title={helpText} style={{ 
                            marginLeft: '6px', 
                            cursor: 'help', 
                            fontSize: '12px', 
                            border: '1px solid #888', 
                            borderRadius: '50%', 
                            width: '14px', 
                            height: '14px', 
                            display: 'inline-flex', 
                            alignItems: 'center', 
                            justifyContent: 'center',
                            color: '#888'
                        }}>?</span>
                    )}
                 </label>
                 <button 
                    type="button" 
                    className="ghost-btn" 
                    style={{ fontSize: '10px', padding: '2px 6px', height: 'auto' }}
                    onClick={() => {
                        setLocalValue(defaultValue);
                        onChange(defaultValue);
                    }}
                 >
                    Reset
                 </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input 
                    type="range" 
                    min={min} 
                    max={max} 
                    step={step} 
                    value={typeof localValue === 'number' ? localValue : min} 
                    onChange={(e) => {
                        const val = Number(e.target.value);
                        setLocalValue(val);
                        onChange(val);
                    }}
                    style={{ flex: 1 }}
                />
                <div style={{ position: 'relative' }}>
                    <input 
                        type="number" 
                        min={min} 
                        max={max} 
                        step={step} 
                        value={localValue} 
                        onChange={handleNumberChange}
                        onBlur={handleBlur}
                        className="config-input"
                        style={{ width: '120px', padding: '4px', textAlign: 'right', paddingRight: unit ? '24px' : '4px' }}
                    />
                    {unit && <span style={{ position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)', fontSize: '10px', color: '#888', pointerEvents: 'none' }}>{unit}</span>}
                </div>
            </div>
            <div style={{ fontSize: '11px', color: '#666', marginTop: '4px' }}>
                {helpText}
            </div>
        </div>
    );
};

function ConfigPanel({ config, setConfig, toolSettings, onToolSettingsChange, onSave, onClose, checkApiStatus, apiStatus, apiMessage, appearanceMode = 'system', onChangeAppearanceMode, displayPreferences, onChangeDisplayPreference, onOpenInEditor, fullscreen, onToggleFullscreen, variant = 'modal' }) {
    const [activeTab, setActiveTab] = useState('general');
    const currentConfig = config[config.provider];
    const isFirstRun = useRef(true);

    // Auto-save with debounce
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
        setConfig(prev => ({
            ...prev,
            [prev.provider]: {
                ...prev[prev.provider],
                [field]: value
            }
        }));
    };

    const resetParameters = () => {
        if (!window.confirm('Are you sure you want to reset all session and model parameters to defaults?')) return;
        
        setConfig(prev => ({
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

    const toggleTool = (modeKey, toolKey) => {
        onToolSettingsChange(prev => ({
            ...prev,
            [modeKey]: {
                ...prev[modeKey],
                [toolKey]: !prev[modeKey][toolKey]
            }
        }));
    };

    const renderAppSettings = () => (
        <>
            <div className="config-section-title">App General</div>
            <div className="config-field">
                <label className="config-label">Global Settings</label>
                <div style={{ fontSize: '12px', color: '#666' }}>
                    Application level preferences such as theme and appearance are applied globally across all projects.
                </div>
            </div>
            <div className="config-field">
                <label className="config-label">Default View Location</label>
                <div className="config-grid" style={{ gridTemplateColumns: '1fr' }}>
                    <div style={{ fontSize: '12px', marginBottom: '4px', color: '#666' }}>Settings Panel</div>
                    <label className="config-tool-row">
                        <input
                            type="radio"
                            name="view-settings"
                            checked={displayPreferences?.settings === 'modal'}
                            onChange={() => onChangeDisplayPreference && onChangeDisplayPreference('settings', 'modal')}
                        />
                        <span>Use Modal Window</span>
                    </label>
                    <label className="config-tool-row">
                        <input
                            type="radio"
                            name="view-settings"
                            checked={displayPreferences?.settings === 'editor'}
                            onChange={() => onChangeDisplayPreference && onChangeDisplayPreference('settings', 'editor')}
                        />
                        <span>Use Editor View</span>
                    </label>

                    <div style={{ fontSize: '12px', margin: '8px 0 4px', color: '#666' }}>Diff Viewer</div>
                    <label className="config-tool-row">
                        <input
                            type="radio"
                            name="view-diff"
                            checked={displayPreferences?.diff === 'modal'}
                            onChange={() => onChangeDisplayPreference && onChangeDisplayPreference('diff', 'modal')}
                        />
                        <span>Use Modal Window</span>
                    </label>
                    <label className="config-tool-row">
                        <input
                            type="radio"
                            name="view-diff"
                            checked={displayPreferences?.diff === 'editor'}
                            onChange={() => onChangeDisplayPreference && onChangeDisplayPreference('diff', 'editor')}
                        />
                        <span>Use Editor View</span>
                    </label>
                </div>
            </div>
        </>
    );

    const renderAppearanceSettings = () => (
        <>
            <div className="config-section-title">Theme & Appearance</div>
            <div className="config-field">
                <label className="config-label">Theme Mode</label>
                <div className="config-grid" style={{ gridTemplateColumns: '1fr' }}>
                    <label className="config-tool-row">
                        <input
                            type="radio"
                            name="theme-mode"
                            checked={appearanceMode === 'system'}
                            onChange={() => onChangeAppearanceMode && onChangeAppearanceMode('system')}
                        />
                        <span>Follow System</span>
                    </label>
                    <label className="config-tool-row">
                        <input
                            type="radio"
                            name="theme-mode"
                            checked={appearanceMode === 'light'}
                            onChange={() => onChangeAppearanceMode && onChangeAppearanceMode('light')}
                        />
                        <span>Light</span>
                    </label>
                    <label className="config-tool-row">
                        <input
                            type="radio"
                            name="theme-mode"
                            checked={appearanceMode === 'dark'}
                            onChange={() => onChangeAppearanceMode && onChangeAppearanceMode('dark')}
                        />
                        <span>Dark</span>
                    </label>
                </div>
            </div>
        </>
    );

    const renderGeneralSettings = () => (
        <>
            <div className="config-section-title">General Settings</div>
            <div className="config-field">
                <label className="config-label">Provider</label>
                <select
                    value={config.provider}
                    onChange={(e) => setConfig({ ...config, provider: e.target.value })}
                    className="config-input"
                >
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                </select>
            </div>
            <div className="config-field">
                <label className="config-label">API Key</label>
                <input
                    type="password"
                    value={currentConfig.api_key}
                    onChange={(e) => updateCurrent('api_key', e.target.value)}
                    className="config-input"
                    placeholder="sk-..."
                />
            </div>
            <div className="config-field">
                <label className="config-label">Base URL (Optional)</label>
                <input
                    type="text"
                    value={currentConfig.base_url}
                    onChange={(e) => updateCurrent('base_url', e.target.value)}
                    className="config-input"
                    placeholder={config.provider === 'openai' ? "https://api.openai.com/v1" : "https://api.anthropic.com"}
                />
            </div>
            <div className="config-field">
                <label className="config-label">Model (Optional)</label>
                <input
                    type="text"
                    value={currentConfig.model}
                    onChange={(e) => updateCurrent('model', e.target.value)}
                    className="config-input"
                    placeholder={config.provider === 'openai' ? 'gpt-4-turbo' : 'claude-3-opus-20240229'}
                />
            </div>
            <div className="config-field">
                <label className="config-label">Status Check Model (Optional)</label>
                <input
                    type="text"
                    value={currentConfig.check_model}
                    onChange={(e) => updateCurrent('check_model', e.target.value)}
                    className="config-input"
                    placeholder="Model used for connection test"
                />
            </div>

            <div className="config-section-title" style={{ marginTop: '24px' }}>Session Context</div>
            <div className="config-field">
                <label className="config-tool-row">
                    <input 
                        type="checkbox" 
                        checked={currentConfig.context_independent ?? true} 
                        onChange={(e) => updateCurrent('context_independent', e.target.checked)} 
                    />
                    <span>Independent Session Context</span>
                </label>
                <div style={{ fontSize: '11px', color: '#666', marginTop: '4px', marginLeft: '24px' }}>
                    Each session maintains its own context to prevent interference.
                </div>
            </div>

            <ConfigSlider
                label="Context Window Limit"
                value={currentConfig.context_max_length ?? 128000}
                min={32000}
                max={256000}
                step={1024}
                defaultValue={128000}
                unit=" tk"
                helpText="Maximum context length (Range: 32k - 256k tokens). Default: 128k."
                onChange={(val) => updateCurrent('context_max_length', val)}
            />

            <div className="config-section-title" style={{ marginTop: '24px' }}>Model Parameters</div>

            <ConfigSlider
                label="Max Output Tokens"
                value={currentConfig.output_max_tokens ?? 32768}
                min={1}
                max={65536}
                step={1}
                defaultValue={32768}
                unit=" tk"
                helpText="Limit the number of tokens generated (Range: 1 - 65,536). Default: 32,768."
                onChange={(val) => updateCurrent('output_max_tokens', val)}
            />

            <ConfigSlider
                label="Temperature"
                value={currentConfig.temperature ?? 0.8}
                min={0.1}
                max={2.0}
                step={0.1}
                defaultValue={0.8}
                helpText="Creativity control: 0.1 (Deterministic) to 2.0 (Creative). Default: 0.8."
                onChange={(val) => updateCurrent('temperature', val)}
            />

            <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid rgba(0,0,0,0.1)' }}>
                <button 
                    type="button" 
                    className="ghost-btn" 
                    onClick={resetParameters}
                    style={{ width: '100%', justifyContent: 'center', color: '#666' }}
                >
                    Reset Parameters to Defaults
                </button>
            </div>
        </>
    );

    const renderToolSettings = (modeKey, title) => (
        <>
            <div className="config-section-title">{title}</div>
            <div className="config-grid">
                {Object.entries(toolSettings[modeKey] || {}).map(([key, enabled]) => (
                    <label key={key} className="config-tool-row">
                        <input type="checkbox" checked={enabled} onChange={() => toggleTool(modeKey, key)} />
                        <span>{key}</span>
                    </label>
                ))}
            </div>
        </>
    );

    const content = (
        <>
            <div className="config-header">
                <h2 className="config-title">Global Settings</h2>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    {variant === 'modal' && (
                        <>
                            <button
                                type="button"
                                className="ghost-btn"
                                onClick={onOpenInEditor}
                                style={{ height: 28, fontSize: '0.85rem' }}
                            >
                                在编辑器查看
                            </button>
                            <button
                                type="button"
                                className="ghost-btn"
                                onClick={onToggleFullscreen}
                                style={{ height: 28, fontSize: '0.85rem' }}
                            >
                                {fullscreen ? '退出全屏' : '全屏显示'}
                            </button>
                        </>
                    )}
                    <button className="config-close" onClick={onClose} aria-label="关闭设置">×</button>
                </div>
            </div>
            
            <div className="config-layout">
                <div className="config-sidebar">
                    <div 
                        className={`config-sidebar-item ${activeTab === 'app' ? 'active' : ''}`}
                        onClick={() => setActiveTab('app')}
                    >
                        App General
                    </div>
                    <div 
                        className={`config-sidebar-item ${activeTab === 'appearance' ? 'active' : ''}`}
                        onClick={() => setActiveTab('appearance')}
                    >
                        Theme & Appearance
                    </div>
                    <div 
                        className={`config-sidebar-item ${activeTab === 'general' ? 'active' : ''}`}
                        onClick={() => setActiveTab('general')}
                    >
                        LLM & Session
                    </div>
                    <div 
                        className={`config-sidebar-item ${activeTab === 'agent' ? 'active' : ''}`}
                        onClick={() => setActiveTab('agent')}
                    >
                        Agent Tools
                    </div>
                    <div 
                        className={`config-sidebar-item ${activeTab === 'canva' ? 'active' : ''}`}
                        onClick={() => setActiveTab('canva')}
                    >
                        Canva Tools
                    </div>
                </div>
                
                <div className="config-content">
                    {activeTab === 'app' && renderAppSettings()}
                    {activeTab === 'appearance' && renderAppearanceSettings()}
                    {activeTab === 'general' && renderGeneralSettings()}
                    {activeTab === 'agent' && renderToolSettings('agent', 'Agent Mode Tools')}
                    {activeTab === 'canva' && renderToolSettings('canva', 'Canva Mode Tools')}
                </div>
            </div>

            <div className="config-footer">
                 <div className="config-actions" style={{ width: '100%' }}>
                    <div className={`config-status ${apiStatus}`} style={{ marginRight: 'auto', display: 'flex', alignItems: 'center' }}>
                        {apiStatus !== 'unknown' && (
                            <>
                                <span className="dot" />
                                {apiStatus === 'checking' ? 'Checking...' : (apiStatus === 'ok' ? 'Connected' : 'Connection Failed')}
                            </>
                        )}
                        {apiMessage && (
                            <span style={{ marginLeft: '10px', fontSize: '12px', color: apiStatus === 'ok' ? '#4caf50' : '#f44336' }}>
                                {apiMessage}
                            </span>
                        )}
                    </div>
                    
                    <div className="config-buttons">
                         <button type="button" className="ghost-btn" onClick={checkApiStatus}>
                            Test Connection
                        </button>
                        <button type="button" className="primary-btn" onClick={() => { onSave(); onClose(); }}>
                            Save & Close
                        </button>
                    </div>
                 </div>
            </div>
        </>
    );

    if (variant === 'inline') {
        return (
            <div className="config-inline-shell" style={{ flex: 1, minHeight: 0 }}>
                <div className="config-modal" style={{ width: '100%', height: '100%', maxWidth: 'none', maxHeight: 'none', borderRadius: 0 }}>
                    {content}
                </div>
            </div>
        );
    }

    return (
        <div className="config-modal-backdrop">
            <div className="config-modal" style={fullscreen ? { width: '100vw', height: '100vh', maxWidth: '100vw', maxHeight: '100vh', borderRadius: 0 } : undefined}>
                {content}
            </div>
        </div>
    );
}

export default ConfigPanel;
