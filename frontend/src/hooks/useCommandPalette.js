import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_PROJECT_CONFIG } from '../utils/appDefaults';

export function useCommandPalette({
  keybindingsRef,
  activeGroupIdRef,
  editorGroupsRef,
  specialTabs = [],
  diffTabPrefix = '',
} = {}) {
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [commandPaletteInitialQuery, setCommandPaletteInitialQuery] = useState('');
  const [commandPaletteContext, setCommandPaletteContext] = useState({ type: '', groupId: '' });

  const specialTabStateRef = useRef({ special: new Set(), diffPrefix: '' });
  useEffect(() => {
    specialTabStateRef.current = {
      special: new Set((Array.isArray(specialTabs) ? specialTabs : []).filter(Boolean).map((v) => String(v))),
      diffPrefix: String(diffTabPrefix || ''),
    };
  }, [diffTabPrefix, specialTabs]);

  const openCommandPalette = useCallback((options = {}) => {
    const initialQuery = String(options?.initialQuery || '');
    const ctx = options?.context && typeof options.context === 'object' ? options.context : { type: '', groupId: '' };
    setCommandPaletteInitialQuery(initialQuery);
    setCommandPaletteContext({ type: String(ctx.type || ''), groupId: String(ctx.groupId || '') });
    setShowCommandPalette(true);
  }, []);

  const closeCommandPalette = useCallback(() => {
    setShowCommandPalette(false);
    setCommandPaletteInitialQuery('');
    setCommandPaletteContext({ type: '', groupId: '' });
  }, []);

  useEffect(() => {
    const normalizeShortcut = (value) => {
      const raw = String(value || '').trim();
      if (!raw) return '';
      const parts = raw.split('+').map((p) => p.trim()).filter(Boolean);
      if (!parts.length) return '';
      let hasCtrl = false;
      let hasAlt = false;
      let hasShift = false;
      let key = '';
      parts.forEach((p) => {
        const t = p.toLowerCase();
        if (t === 'ctrl' || t === 'control' || t === 'cmd' || t === 'command' || t === 'meta') hasCtrl = true;
        else if (t === 'alt' || t === 'option') hasAlt = true;
        else if (t === 'shift') hasShift = true;
        else key = p;
      });
      const normKey = String(key || '').trim();
      if (!normKey) return '';
      const upperKey = normKey.length === 1 ? normKey.toUpperCase() : normKey;
      const out = [];
      if (hasCtrl) out.push('Ctrl');
      if (hasAlt) out.push('Alt');
      if (hasShift) out.push('Shift');
      out.push(upperKey);
      return out.join('+');
    };

    const eventToShortcut = (e) => {
      const k = String(e.key || '');
      const lower = k.toLowerCase();
      if (lower === 'control' || lower === 'meta' || lower === 'shift' || lower === 'alt') return '';

      const mods = [];
      if (e.metaKey || e.ctrlKey) mods.push('Ctrl');
      if (e.altKey) mods.push('Alt');
      if (e.shiftKey) mods.push('Shift');
      if (!mods.length) return '';

      let keyToken = '';
      if (k.length === 1) keyToken = k.toUpperCase();
      else if (lower === 'escape' || lower === 'esc') keyToken = 'Escape';
      else if (lower === 'enter') keyToken = 'Enter';
      else if (lower === 'tab') keyToken = 'Tab';
      else if (k === ',') keyToken = ',';
      else if (k === '.') keyToken = '.';
      else if (/^f\d{1,2}$/i.test(k)) keyToken = k.toUpperCase();
      else keyToken = k;

      return normalizeShortcut([...mods, keyToken].join('+'));
    };

    const matchShortcut = (e, shortcut) => {
      const expected = normalizeShortcut(shortcut);
      if (!expected) return false;
      const got = eventToShortcut(e);
      return !!got && got === expected;
    };

    const isSpecialTab = (p) => {
      const str = String(p || '');
      if (!str) return false;
      const { special, diffPrefix } = specialTabStateRef.current;
      if (special?.has(str)) return true;
      return !!diffPrefix && str.startsWith(diffPrefix);
    };

    const onKeyDown = (e) => {
      const tag = String(e.target?.tagName || '').toUpperCase();
      const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable;
      const inMonaco = !!e.target?.closest?.('.monaco-editor');
      if (isEditable && !inMonaco) return;

      const kb = keybindingsRef?.current || {};
      const quickOpen = kb['app.quickOpen'] || DEFAULT_PROJECT_CONFIG.keybindings['app.quickOpen'];
      const commandPalette = kb['app.commandPalette'] || DEFAULT_PROJECT_CONFIG.keybindings['app.commandPalette'];
      const openEditors = kb['editor.openEditors'] || DEFAULT_PROJECT_CONFIG.keybindings['editor.openEditors'];

      if (matchShortcut(e, commandPalette) || matchShortcut(e, quickOpen)) {
        e.preventDefault();
        openCommandPalette();
        return;
      }

      if (matchShortcut(e, openEditors)) {
        const groupId = String(activeGroupIdRef?.current || 'group-1');
        const groups = editorGroupsRef?.current || [];
        const group = Array.isArray(groups) ? groups.find((g) => String(g?.id || '') === groupId) : null;
        const openTabs = Array.isArray(group?.openTabs) ? group.openTabs : [];
        const hasRealEditor = openTabs.some((p) => p && !isSpecialTab(p));
        if (!hasRealEditor) return;

        e.preventDefault();
        openCommandPalette({ initialQuery: 'edt ', context: { type: 'editorNav', groupId } });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeGroupIdRef, editorGroupsRef, keybindingsRef, openCommandPalette]);

  return {
    showCommandPalette,
    commandPaletteInitialQuery,
    commandPaletteContext,
    openCommandPalette,
    closeCommandPalette,
  };
}

