import React, { useCallback, useState } from 'react';
import AppWorkbenchContainer, { AppShellContainer } from './AppWorkbenchContainer';
import { usePreferences } from './hooks/usePreferences';
import { useLayoutResize } from './hooks/useLayoutResize';
import {
  DEBUG_SEPARATORS,
  buildBackendConfigPayload as buildBackendConfigPayloadUtil,
  normalizeGlobalConfig,
} from './utils/appDefaults';
import { readGlobalConfig } from './utils/appPersistence';

function App() {
  const prefs = usePreferences();
  const [config, setConfig] = useState(() => {
    const stored = readGlobalConfig();
    return normalizeGlobalConfig(stored);
  });
  const getBackendConfig = useCallback(() => {
    return buildBackendConfigPayloadUtil(config);
  }, [config]);

  const [showConfig, setShowConfig] = useState(false);
  const [apiStatus, setApiStatus] = useState('unknown');
  const [apiMessage, setApiMessage] = useState('');

  const [inputModal, setInputModal] = useState({
    isOpen: false,
    title: '',
    label: '',
    defaultValue: '',
    placeholder: '',
    confirmText: '确定',
    icon: 'codicon-edit',
    onConfirm: () => {},
    onClose: () => {},
  });

  const layout = useLayoutResize({ debugSeparators: DEBUG_SEPARATORS });

  return (
    <AppWorkbenchContainer
      config={config}
      setConfig={setConfig}
      getBackendConfig={getBackendConfig}
      toolSettings={prefs.toolSettings}
      setToolSettings={prefs.setToolSettings}
      mergeToolSettings={prefs.mergeToolSettings}
      globalConfigHydratedRef={prefs.globalConfigHydratedRef}
      userThemePreferenceRef={prefs.userThemePreferenceRef}
      theme={prefs.theme}
      setTheme={prefs.setTheme}
      sidebarWidth={layout.sidebarWidth}
      setSidebarWidth={layout.setSidebarWidth}
      sidebarCollapsed={layout.sidebarCollapsed}
      setSidebarCollapsed={layout.setSidebarCollapsed}
      setActiveSidebarPanel={layout.setActiveSidebarPanel}
      lastSidebarWidthRef={layout.lastSidebarWidthRef}
      setInputModal={setInputModal}
    >
      <AppShellContainer
        config={config}
        setConfig={setConfig}
        getBackendConfig={getBackendConfig}
        showConfig={showConfig}
        setShowConfig={setShowConfig}
        apiStatus={apiStatus}
        setApiStatus={setApiStatus}
        apiMessage={apiMessage}
        setApiMessage={setApiMessage}
        inputModal={inputModal}
        setInputModal={setInputModal}
        layout={layout}
        prefs={prefs}
      />
    </AppWorkbenchContainer>
  );
}

export default App;
