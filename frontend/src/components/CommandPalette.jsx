
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { pluginsService } from '../workbench/services/pluginsService';
import { outputService } from '../workbench/services/outputService';
import { getFileIconClass } from '../utils/appAlgorithms';

const CommandPalette = ({
    isOpen,
    onClose,
    initialQuery = '',
    context = null,
    files = [],
    editorGroups = [],
    activeGroupId = '',
    onOpenFile,
    onCloseEditor,
    onSearchText,
    onSearchWorkspaceSymbols,
    onSearchDocumentSymbols,
    workspaceRoots = [],
    aiInvoker
}) => {
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [symbolItems, setSymbolItems] = useState([]);
    const [symbolLoading, setSymbolLoading] = useState(false);
    const [ideCommands, setIdeCommands] = useState([]);
    const inputRef = useRef(null);
    const listRef = useRef(null);
    const symbolReqRef = useRef(0);
    const ideCmdReqRef = useRef(0);

    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
            setQuery(String(initialQuery || ''));
            setSelectedIndex(0);
        }
    }, [isOpen, initialQuery]);

    const loadIdeCommands = useCallback(async () => {
        const bus = globalThis?.window?.electronAPI?.ideBus;
        if (!bus?.request) return;
        const requestId = (ideCmdReqRef.current += 1);
        try {
            const res = await bus.request('commands/list');
            if (requestId !== ideCmdReqRef.current) return;
            const items = Array.isArray(res?.items) ? res.items : [];
            const normalized = items
                .map((it) => ({
                    id: String(it?.id || '').trim(),
                    title: String(it?.title || it?.id || '').trim(),
                    source: it?.source ? String(it.source) : '',
                }))
                .filter((it) => it.id);
            setIdeCommands(normalized);
        } catch {
            if (requestId !== ideCmdReqRef.current) return;
            setIdeCommands([]);
        }
    }, []);

    const appendIdeBusOutput = useCallback((text) => {
        const s = text == null ? '' : String(text);
        if (!s) return;
        outputService.append('IdeBus', s, { label: 'IDE Bus' });
    }, []);

    const runIdeBusRequest = useCallback(async (method, params) => {
        const bus = globalThis?.window?.electronAPI?.ideBus;
        if (!bus?.request) throw new Error('ideBus not available');
        return await bus.request(method, params);
    }, []);

    useEffect(() => {
        if (!isOpen) return;
        loadIdeCommands();
    }, [isOpen, loadIdeCommands]);

    useEffect(() => {
        const bus = globalThis?.window?.electronAPI?.ideBus;
        if (!bus?.onNotification) return undefined;
        const dispose = bus.onNotification('commands/changed', () => {
            loadIdeCommands();
        });
        return () => dispose?.();
    }, [loadIdeCommands]);

    const symbolState = useMemo(() => {
        const raw = String(query || '');
        const trimmedStart = raw.replace(/^\s+/, '');
        const prefix = trimmedStart.slice(0, 1);
        const mode = prefix === '@' ? 'document' : (prefix === '#' ? 'workspace' : '');
        const text = mode ? trimmedStart.slice(1).trim() : '';
        return { mode, text };
    }, [query]);

    const editorNavState = useMemo(() => {
        const raw = String(query || '').trim();
        const lower = raw.toLowerCase();
        const isEditorNav = lower === 'edt' || lower.startsWith('edt ') || lower.startsWith('>edt') || lower.startsWith('> edt');
        const normalized = lower.startsWith('>') ? lower.slice(1).trim() : lower;
        const filterText = normalized.startsWith('edt') ? normalized.slice(3).trim() : '';

        const groupIdHint = (context && typeof context === 'object' && context.type === 'editorNav' && context.groupId)
            ? String(context.groupId)
            : '';
        const groupId = groupIdHint || String(activeGroupId || '').trim() || (editorGroups[0]?.id ? String(editorGroups[0]?.id) : '');
        const groupIndex = editorGroups.findIndex((g) => String(g?.id) === groupId);
        const group = groupIndex >= 0 ? editorGroups[groupIndex] : (editorGroups[0] || null);

        return {
            isEditorNav,
            filterText,
            groupId: group ? String(group?.id || groupId) : groupId,
            groupIndex: groupIndex >= 0 ? groupIndex : (group ? 0 : -1),
            group,
        };
    }, [activeGroupId, context, editorGroups, query]);

    const symbolKindIcon = (kind) => {
        const k = Number(kind || 0);
        if (k === 5) return 'codicon-symbol-class';
        if (k === 6) return 'codicon-symbol-method';
        if (k === 7) return 'codicon-symbol-property';
        if (k === 8) return 'codicon-symbol-field';
        if (k === 9) return 'codicon-symbol-constructor';
        if (k === 11) return 'codicon-symbol-interface';
        if (k === 12) return 'codicon-symbol-function';
        if (k === 13) return 'codicon-symbol-variable';
        if (k === 14) return 'codicon-symbol-constant';
        if (k === 22) return 'codicon-symbol-enum-member';
        if (k === 23) return 'codicon-symbol-struct';
        return 'codicon-symbol-misc';
    };

    useEffect(() => {
        if (!isOpen) return;
        if (!symbolState.mode) {
            setSymbolItems([]);
            setSymbolLoading(false);
            return;
        }

        const requestId = (symbolReqRef.current += 1);
        setSymbolLoading(true);
        const timer = setTimeout(async () => {
            try {
                const group = editorNavState.group;
                const groupId = editorNavState.groupId || String(activeGroupId || '');
                const activeFile = group?.activeFile ? String(group.activeFile) : '';

                let results = [];
                if (symbolState.mode === 'workspace') {
                    if (typeof onSearchWorkspaceSymbols === 'function') {
                        results = await onSearchWorkspaceSymbols(symbolState.text);
                    }
                } else if (typeof onSearchDocumentSymbols === 'function' && activeFile) {
                    results = await onSearchDocumentSymbols(activeFile);
                }

                if (requestId !== symbolReqRef.current) return;
                const list = Array.isArray(results) ? results : [];

                const q = String(symbolState.text || '').toLowerCase();
                const filtered = (symbolState.mode === 'document' && q)
                    ? list.filter((s) => {
                        const name = String(s?.name || '').toLowerCase();
                        const container = String(s?.containerName || '').toLowerCase();
                        return name.includes(q) || container.includes(q);
                    })
                    : list;

                const mapped = filtered.slice(0, 120).map((s, idx) => {
                    const name = String(s?.name || '');
                    const kind = Number(s?.kind || 0);
                    const containerName = s?.containerName ? String(s.containerName) : '';
                    const modelPath = String(s?.modelPath || activeFile || '');
                    const range = s?.range || null;
                    const line = Number(range?.start?.line);
                    const ch = Number(range?.start?.character);
                    const line1 = Number.isFinite(line) ? (line + 1) : 1;
                    const col1 = Number.isFinite(ch) ? (ch + 1) : 1;

                    const descLeft = containerName ? `${containerName}` : '';
                    const descRight = modelPath ? `${modelPath}:${line1}` : `${line1}`;
                    const description = [descLeft, descRight].filter(Boolean).join('  •  ');

                    return {
                        type: 'symbol',
                        id: `symbol:${symbolState.mode}:${idx}:${modelPath}:${name}`,
                        label: name || '(anonymous)',
                        description,
                        icon: symbolKindIcon(kind),
                        action: () => {
                            if (!modelPath) return;
                            onOpenFile?.(modelPath, { groupId, mode: 'persistent' });
                            setTimeout(() => {
                                try {
                                    window.dispatchEvent(new CustomEvent('workbench:revealInActiveEditor', { detail: { line: line1, column: col1 } }));
                                } catch {
                                    // ignore
                                }
                            }, 50);
                        },
                    };
                });

                setSymbolItems(mapped);
            } catch {
                if (requestId === symbolReqRef.current) setSymbolItems([]);
            } finally {
                if (requestId === symbolReqRef.current) setSymbolLoading(false);
            }
        }, 120);

        return () => clearTimeout(timer);
    }, [
        activeGroupId,
        editorNavState.group,
        editorNavState.groupId,
        isOpen,
        onOpenFile,
        onSearchDocumentSymbols,
        onSearchWorkspaceSymbols,
        symbolState.mode,
        symbolState.text,
    ]);

    const filteredItems = useMemo(() => {
        if (symbolState.mode) return symbolItems;
        const items = [];
        const q = query.toLowerCase();

        if (editorNavState.isEditorNav) {
            const group = editorNavState.group;
            const groupId = editorNavState.groupId;
            const filter = String(editorNavState.filterText || '').toLowerCase();
            const openTabs = Array.isArray(group?.openTabs) ? group.openTabs.filter(Boolean) : [];
            const active = String(group?.activeFile || '').trim();

            const ordered = active && openTabs.includes(active)
                ? [active, ...openTabs.filter((t) => t !== active)]
                : openTabs;

            ordered
                .filter((p) => {
                    if (!filter) return true;
                    const hay = `${p.split('/').pop()} ${p}`.toLowerCase();
                    return hay.includes(filter);
                })
                .slice(0, 80)
                .forEach((p) => {
                    items.push({
                        type: 'editor',
                        id: `editor:${groupId}:${p}`,
                        label: p.split('/').pop(),
                        description: p,
                        action: () => onOpenFile?.(p, { groupId, mode: 'persistent' }),
                        icon: getFileIconClass(p),
                        closeAction: () => onCloseEditor?.(p, { groupId }),
                        isActive: active && p === active,
                    });
                });

            return items;
        }

        const trimmedQuery = query.trim();
        const inCommandMode = trimmedQuery.startsWith('>') || trimmedQuery.startsWith('/');
        const commandQuery = inCommandMode ? trimmedQuery.slice(1).trim().toLowerCase() : '';
        
        const pushIfMatch = (it) => {
            if (!inCommandMode) {
                items.push(it);
                return;
            }
            if (!commandQuery) {
                items.push(it);
                return;
            }
            const hay = `${it.label || ''} ${it.description || ''}`.toLowerCase();
            if (hay.includes(commandQuery)) items.push(it);
        };

        if (!inCommandMode && query) {
            items.push({
                type: 'action',
                id: 'search-text',
                label: `Search text "${query}"`,
                description: 'in all files',
                action: () => onSearchText(query),
                icon: 'codicon-search',
                shortcut: 'Ctrl + Shift + F'
            });
        }

        if (inCommandMode || !query) {
            pushIfMatch({
                type: 'action',
                id: 'search-files',
                label: 'Go to File...',
                description: 'Search files by name',
                action: () => {
                    if (inCommandMode) {
                        setQuery('');
                        setSelectedIndex(0);
                    }
                },
                icon: 'codicon-file',
                shortcut: 'Ctrl + P'
            });
            pushIfMatch({
                type: 'action',
                id: 'show-commands',
                label: 'Show and Run Commands >',
                description: 'Execute IDE commands',
                action: () => {
                    setQuery('> ');
                    setSelectedIndex(0);
                },
                icon: 'codicon-terminal',
                shortcut: 'Ctrl + Shift + P'
            });
             pushIfMatch({
                type: 'action',
                id: 'search-text-placeholder',
                label: 'Search text %',
                description: 'Find in files',
                action: () => onSearchText(''),
                icon: 'codicon-search'
            });
             pushIfMatch({
                type: 'action',
                id: 'go-to-symbol',
                label: 'Go to Symbol in Editor @',
                description: 'Jump to symbol',
                action: () => setQuery('@ '),
                icon: 'codicon-symbol-class',
                shortcut: 'Ctrl + Shift + O'
            });
             pushIfMatch({
                type: 'action',
                id: 'go-to-workspace-symbol',
                label: 'Go to Symbol in Workspace #',
                description: 'Search workspace symbols',
                action: () => setQuery('# '),
                icon: 'codicon-symbol-folder',
                shortcut: 'Ctrl + T'
            });

            pushIfMatch({
                type: 'action',
                id: 'editor-nav',
                label: '编辑器：打开编辑器导航 (edt)',
                description: '显示当前组已打开的编辑器',
                action: () => setQuery('edt '),
                icon: 'codicon-list-selection',
            });

            pushIfMatch({
                type: 'action',
                id: 'idebus-stats',
                label: 'IDE Bus: Show RPC Stats',
                description: 'Print telemetry/getRpcStats to Output',
                action: async () => {
                    try {
                        const res = await runIdeBusRequest('telemetry/getRpcStats');
                        const items = Array.isArray(res?.items) ? res.items : [];
                        const config = res?.config || null;
                        const top = items.slice(0, 60);
                        const header = `[idebus] rpc stats (${items.length} methods)`;
                        appendIdeBusOutput(header);
                        if (config) appendIdeBusOutput(`[idebus] trace config: ${JSON.stringify(config)}`);
                        if (top.length) {
                            appendIdeBusOutput(JSON.stringify(top, null, 2));
                        } else {
                            appendIdeBusOutput('[idebus] no stats yet');
                        }
                    } catch (err) {
                        appendIdeBusOutput(`[idebus] getRpcStats failed: ${err?.message || String(err)}`);
                    }
                },
                icon: 'codicon-graph',
            });

            pushIfMatch({
                type: 'action',
                id: 'idebus-reset-stats',
                label: 'IDE Bus: Reset RPC Stats',
                description: 'Clear aggregated RPC telemetry',
                action: async () => {
                    try {
                        await runIdeBusRequest('telemetry/resetRpcStats');
                        appendIdeBusOutput('[idebus] rpc stats reset');
                    } catch (err) {
                        appendIdeBusOutput(`[idebus] resetRpcStats failed: ${err?.message || String(err)}`);
                    }
                },
                icon: 'codicon-clear-all',
            });

            pushIfMatch({
                type: 'action',
                id: 'idebus-trace-off',
                label: 'IDE Bus: Trace Mode Off',
                description: 'Disable RPC trace output',
                action: async () => {
                    try {
                        const res = await runIdeBusRequest('telemetry/setRpcTraceConfig', { mode: 'off' });
                        appendIdeBusOutput(`[idebus] trace mode=off`);
                        if (res?.config) appendIdeBusOutput(`[idebus] ${JSON.stringify(res.config)}`);
                    } catch (err) {
                        appendIdeBusOutput(`[idebus] set trace mode failed: ${err?.message || String(err)}`);
                    }
                },
                icon: 'codicon-debug-stop',
            });

            pushIfMatch({
                type: 'action',
                id: 'idebus-trace-slow',
                label: 'IDE Bus: Trace Mode Slow',
                description: 'Log slow/errors based on thresholds',
                action: async () => {
                    try {
                        const res = await runIdeBusRequest('telemetry/setRpcTraceConfig', { mode: 'slow' });
                        appendIdeBusOutput(`[idebus] trace mode=slow`);
                        if (res?.config) appendIdeBusOutput(`[idebus] ${JSON.stringify(res.config)}`);
                    } catch (err) {
                        appendIdeBusOutput(`[idebus] set trace mode failed: ${err?.message || String(err)}`);
                    }
                },
                icon: 'codicon-dashboard',
            });

            pushIfMatch({
                type: 'action',
                id: 'idebus-trace-all',
                label: 'IDE Bus: Trace Mode All (sampled)',
                description: 'Sample and log all RPCs',
                action: async () => {
                    try {
                        const res = await runIdeBusRequest('telemetry/setRpcTraceConfig', { mode: 'all' });
                        appendIdeBusOutput(`[idebus] trace mode=all`);
                        if (res?.config) appendIdeBusOutput(`[idebus] ${JSON.stringify(res.config)}`);
                    } catch (err) {
                        appendIdeBusOutput(`[idebus] set trace mode failed: ${err?.message || String(err)}`);
                    }
                },
                icon: 'codicon-record',
            });

            pushIfMatch({
                type: 'action',
                id: 'idebus-trace-sample-5',
                label: 'IDE Bus: Set Sample Rate 5%',
                description: 'telemetry/setRpcTraceConfig sampleRate=0.05',
                action: async () => {
                    try {
                        const res = await runIdeBusRequest('telemetry/setRpcTraceConfig', { sampleRate: 0.05 });
                        appendIdeBusOutput(`[idebus] sampleRate=0.05`);
                        if (res?.config) appendIdeBusOutput(`[idebus] ${JSON.stringify(res.config)}`);
                    } catch (err) {
                        appendIdeBusOutput(`[idebus] set sample rate failed: ${err?.message || String(err)}`);
                    }
                },
                icon: 'codicon-settings-gear',
            });

            pushIfMatch({
                type: 'action',
                id: 'idebus-trace-slowms-200',
                label: 'IDE Bus: Set Slow Default 200ms',
                description: 'telemetry/setRpcTraceConfig slowDefaultMs=200',
                action: async () => {
                    try {
                        const res = await runIdeBusRequest('telemetry/setRpcTraceConfig', { slowDefaultMs: 200 });
                        appendIdeBusOutput(`[idebus] slowDefaultMs=200`);
                        if (res?.config) appendIdeBusOutput(`[idebus] ${JSON.stringify(res.config)}`);
                    } catch (err) {
                        appendIdeBusOutput(`[idebus] set slow default failed: ${err?.message || String(err)}`);
                    }
                },
                icon: 'codicon-clock',
            });

            pushIfMatch({
                type: 'action',
                id: 'idebus-show-trace-config',
                label: 'IDE Bus: Show Trace Config',
                description: 'telemetry/getRpcTraceConfig',
                action: async () => {
                    try {
                        const res = await runIdeBusRequest('telemetry/getRpcTraceConfig');
                        if (res?.config) {
                            appendIdeBusOutput(`[idebus] ${JSON.stringify(res.config, null, 2)}`);
                        } else {
                            appendIdeBusOutput('[idebus] no trace config returned');
                        }
                    } catch (err) {
                        appendIdeBusOutput(`[idebus] getRpcTraceConfig failed: ${err?.message || String(err)}`);
                    }
                },
                icon: 'codicon-settings-gear',
            });

            pushIfMatch({
                type: 'action',
                id: 'idebus-set-trace-config-json',
                label: 'IDE Bus: Set Trace Config (JSON)…',
                description: 'Edit telemetry/setRpcTraceConfig payload as JSON',
                action: async () => {
                    try {
                        const current = await runIdeBusRequest('telemetry/getRpcTraceConfig').catch(() => null);
                        const initial = current?.config && typeof current.config === 'object' ? current.config : { mode: 'slow', sampleRate: 0.05, slowDefaultMs: 200 };
                        const text = globalThis.prompt?.('IDE Bus trace config (JSON)', JSON.stringify(initial, null, 2));
                        if (text == null) return;
                        const parsed = JSON.parse(String(text));
                        if (!parsed || typeof parsed !== 'object') {
                            appendIdeBusOutput('[idebus] invalid JSON: expected an object');
                            return;
                        }
                        const res = await runIdeBusRequest('telemetry/setRpcTraceConfig', parsed);
                        appendIdeBusOutput('[idebus] trace config updated');
                        if (res?.config) appendIdeBusOutput(`[idebus] ${JSON.stringify(res.config, null, 2)}`);
                    } catch (err) {
                        appendIdeBusOutput(`[idebus] setRpcTraceConfig failed: ${err?.message || String(err)}`);
                    }
                },
                icon: 'codicon-edit',
            });

            if (aiInvoker && typeof aiInvoker.run === 'function') {
                pushIfMatch({ type: 'action', id: 'ai-explain', label: 'AI: Explain Code', description: 'Explain selection or file', action: () => aiInvoker.run('explain'), icon: 'codicon-lightbulb', shortcut: 'Ctrl + Alt + E' });
                pushIfMatch({ type: 'action', id: 'ai-tests', label: 'AI: Generate Unit Tests', description: 'Generate tests for selection or file', action: () => aiInvoker.run('generateTests'), icon: 'codicon-beaker', shortcut: 'Ctrl + Alt + T' });
                pushIfMatch({ type: 'action', id: 'ai-optimize', label: 'AI: Optimize Code', description: 'Optimize selection or file', action: () => aiInvoker.run('optimize'), icon: 'codicon-rocket', shortcut: 'Ctrl + Alt + O' });
                pushIfMatch({ type: 'action', id: 'ai-comments', label: 'AI: Generate Comments', description: 'Add comments following style', action: () => aiInvoker.run('generateComments'), icon: 'codicon-comment', shortcut: 'Ctrl + Alt + C' });
                pushIfMatch({ type: 'action', id: 'ai-review', label: 'AI: Code Review', description: 'Review selection or file', action: () => aiInvoker.run('review'), icon: 'codicon-checklist', shortcut: 'Ctrl + Alt + R' });
                pushIfMatch({ type: 'action', id: 'ai-rewrite', label: 'AI: Rewrite', description: 'Rewrite selection or file', action: () => aiInvoker.run('rewrite'), icon: 'codicon-replace', shortcut: 'Ctrl + Alt + W' });
                pushIfMatch({ type: 'action', id: 'ai-modify', label: 'AI: Modify with Instructions…', description: 'Edit using a custom instruction', action: () => aiInvoker.run('modify'), icon: 'codicon-edit', shortcut: 'Ctrl + Alt + M' });
                pushIfMatch({ type: 'action', id: 'ai-docs', label: 'AI: Generate Docs', description: 'Generate Markdown docs', action: () => aiInvoker.run('generateDocs'), icon: 'codicon-book', shortcut: 'Ctrl + Alt + D' });
            }

            // /plugin commands (install/uninstall/enable/disable/doctor)
            const isPluginCmd = commandQuery === 'plugin' || commandQuery.startsWith('plugin ');
            if (isPluginCmd) {
                const parts = commandQuery.split(/\s+/).filter(Boolean);
                const sub = parts[1] || '';
                const arg = parts.slice(2).join(' ').trim();

                const runInstall = async (q) => {
                    const wanted = String(q || '').trim();
                    if (!wanted) return;
                    outputService.append('LSP', `[PLUGIN] search+install: ${wanted}`);
                    const res = await pluginsService.search(wanted, ['official', 'github', 'openvsx']).catch((err) => ({ ok: false, items: [], error: err }));
                    const items = Array.isArray(res?.items) ? res.items : [];
                    const exact = items.find((it) => String(it?.id || '') === wanted) || (items.length === 1 ? items[0] : null);
                    if (!exact) {
                        outputService.append('LSP', `[PLUGIN] not found or ambiguous: ${wanted}`);
                        return;
                    }
                    await pluginsService.install({ providerId: exact?.source?.providerId || '', id: exact.id, version: exact.version || '' });
                    // Auto-enable official plugins for immediate LSP.
                    if (String(exact?.trust || '') === 'official') {
                        await pluginsService.enable(exact.id).catch(() => {});
                    }
                    outputService.append('LSP', `[PLUGIN] installed: ${exact.id}`);
                };

                const runEnable = async (q) => {
                    const wanted = String(q || '').trim();
                    if (!wanted) return;
                    const installed = await pluginsService.listInstalled().catch(() => ({ ok: false, items: [] }));
                    const it = (installed?.items || []).find((x) => String(x?.id || '') === wanted);
                    if (!it) return outputService.append('LSP', `[PLUGIN] not installed: ${wanted}`);
                    if (String(it?.trust || '') !== 'official') {
                        const ok = globalThis.confirm?.(`Trust and enable ${it.trust} plugin: ${wanted}?`);
                        if (!ok) return;
                        await pluginsService.enable(wanted, it.trust);
                    } else {
                        await pluginsService.enable(wanted);
                    }
                    outputService.append('LSP', `[PLUGIN] enabled: ${wanted}`);
                };

                const runDisable = async (q) => {
                    const wanted = String(q || '').trim();
                    if (!wanted) return;
                    await pluginsService.disable(wanted);
                    outputService.append('LSP', `[PLUGIN] disabled: ${wanted}`);
                };

                const runUninstall = async (q) => {
                    const wanted = String(q || '').trim();
                    if (!wanted) return;
                    const ok = globalThis.confirm?.(`Uninstall plugin: ${wanted}?`);
                    if (!ok) return;
                    await pluginsService.uninstall(wanted);
                    outputService.append('LSP', `[PLUGIN] uninstalled: ${wanted}`);
                };

                const runDoctor = async (q) => {
                    const wanted = String(q || '').trim();
                    const res = await pluginsService.doctor(wanted || undefined).catch((err) => ({ ok: false, error: err }));
                    outputService.append('LSP', `[PLUGIN] doctor: ${wanted || 'all'}`);
                    outputService.append('LSP', JSON.stringify(res, null, 2));
                };

                pushIfMatch({
                    type: 'action',
                    id: 'plugin-help',
                    label: 'Plugin: Commands',
                    description: 'plugin install|uninstall|enable|disable|doctor <id>',
                    action: () => {},
                    icon: 'codicon-extensions',
                });

                pushIfMatch({
                    type: 'action',
                    id: 'plugin-install',
                    label: `Plugin: Install ${arg || '<id>'}`,
                    description: 'Search across providers and install',
                    action: () => runInstall(arg),
                    icon: 'codicon-cloud-download',
                });

                pushIfMatch({
                    type: 'action',
                    id: 'plugin-enable',
                    label: `Plugin: Enable ${arg || '<id>'}`,
                    description: 'Enable an installed plugin',
                    action: () => runEnable(arg),
                    icon: 'codicon-check',
                });

                pushIfMatch({
                    type: 'action',
                    id: 'plugin-disable',
                    label: `Plugin: Disable ${arg || '<id>'}`,
                    description: 'Disable an installed plugin',
                    action: () => runDisable(arg),
                    icon: 'codicon-circle-slash',
                });

                pushIfMatch({
                    type: 'action',
                    id: 'plugin-uninstall',
                    label: `Plugin: Uninstall ${arg || '<id>'}`,
                    description: 'Remove an installed plugin',
                    action: () => runUninstall(arg),
                    icon: 'codicon-trash',
                });

                pushIfMatch({
                    type: 'action',
                    id: 'plugin-doctor',
                    label: `Plugin: Doctor ${arg || ''}`.trim(),
                    description: 'Check plugin health/deps',
                    action: () => runDoctor(arg),
                    icon: 'codicon-heart',
                });

                if (!sub) {
                    // convenience shortcuts
                    pushIfMatch({
                        type: 'action',
                        id: 'plugin-install-tsls',
                        label: 'Plugin: Install tsls (TypeScript)',
                        description: 'Install typescript-language-server (official)',
                        action: () => runInstall('tsls'),
                        icon: 'codicon-file-code',
                    });
                    pushIfMatch({
                        type: 'action',
                        id: 'plugin-install-pyright',
                        label: 'Plugin: Install pyright (Python)',
                        description: 'Install pyright-langserver (official)',
                        action: () => runInstall('pyright'),
                        icon: 'codicon-symbol-keyword',
                    });
                }
            }

            const bus = globalThis?.window?.electronAPI?.ideBus;
            if (bus?.request) {
                const list = Array.isArray(ideCommands) ? ideCommands : [];
                for (const cmd of list) {
                    const id = String(cmd?.id || '').trim();
                    if (!id) continue;
                    const title = String(cmd?.title || id);
                    pushIfMatch({
                        type: 'command',
                        id: `idecmd:${id}`,
                        label: title,
                        description: id,
                        action: async () => {
                            try {
                                const res = await bus.request('commands/execute', { command: id, args: [] });
                                const ok = !!res?.ok;
                                if (!ok) outputService.append('Extensions', `[ERROR] command failed: ${id}`);
                            } catch (err) {
                                outputService.append('Extensions', `[ERROR] command failed: ${id} ${err?.message || String(err)}`);
                            }
                        },
                        icon: 'codicon-play',
                    });
                }
            }
        }

        if (!inCommandMode && query) {
            // Simple fuzzy match: all chars must exist in order (or just includes for now for performance)
            const matchedFiles = files.filter(f => f.path.toLowerCase().includes(q)).slice(0, 50); // Limit to 50
            
            matchedFiles.forEach(f => {
                items.push({
                    type: 'file',
                    id: f.path,
                    label: f.path.split('/').pop(),
                    description: f.path,
                    action: () => onOpenFile(f.path),
                    icon: 'codicon-file' // Should use getIconClass ideally
                });
            });
        }

        return items;
    }, [aiInvoker, editorNavState, files, ideCommands, onCloseEditor, onOpenFile, onSearchText, query, symbolItems, symbolState.mode]);

    useEffect(() => {
        setSelectedIndex(0);
    }, [filteredItems]);

    const handleKeyDown = (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(prev => Math.min(prev + 1, filteredItems.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(prev => Math.max(prev - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (filteredItems[selectedIndex]) {
                filteredItems[selectedIndex].action();
                // Only close if it's a real action, not just a hint
                if (filteredItems[selectedIndex].id !== 'search-files'
                    && filteredItems[selectedIndex].id !== 'show-commands'
                    && filteredItems[selectedIndex].id !== 'editor-nav'
                    && filteredItems[selectedIndex].id !== 'go-to-symbol'
                    && filteredItems[selectedIndex].id !== 'go-to-workspace-symbol') {
                     onClose();
                }
            }
        } else if (e.key === 'Escape') {
            onClose();
        }
    };

    // Scroll selected item into view
    useEffect(() => {
        if (listRef.current) {
            const selectedElement = listRef.current.children[selectedIndex];
            if (selectedElement) {
                selectedElement.scrollIntoView({ block: 'nearest' });
            }
        }
    }, [selectedIndex]);

    if (!isOpen) return null;

    const palettePlaceholder = editorNavState.isEditorNav
        ? 'edt <filter> (Editor Navigation)'
        : (symbolState.mode === 'document'
            ? 'Go to Symbol in Editor: @ <query>'
            : (symbolState.mode === 'workspace' ? 'Go to Symbol in Workspace: # <query>' : 'Search files by name (append :<line> to go to line)'));

    const groupLabel = editorNavState.groupIndex >= 0
        ? `第 ${editorNavState.groupIndex + 1} 组`
        : (editorNavState.groupId ? String(editorNavState.groupId) : '');

    return createPortal(
        <div className="command-palette-overlay" onClick={onClose} style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100000, // Higher than everything
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'flex-start',
            paddingTop: '6px'
        }}>
            <div 
                className="command-palette-container" 
                onClick={e => e.stopPropagation()}
                style={{
                    width: '600px',
                    maxWidth: '90vw',
                    background: 'var(--panel)',
                    borderRadius: '6px',
                    boxShadow: '0 4px 24px rgba(0,0,0,0.25)',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    border: '1px solid var(--border)',
                    boxSizing: 'border-box'
                }}
            >
                <div className="command-palette-input-wrapper" style={{ padding: '8px', boxSizing: 'border-box' }}>
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={palettePlaceholder}
                        style={{
                            width: '100%',
                            background: 'var(--bg-subtle)',
                            border: '1px solid var(--border)',
                            padding: '8px 12px',
                            color: 'var(--text)',
                            borderRadius: '4px',
                            fontSize: '14px',
                            outline: 'none',
                            boxSizing: 'border-box'
                        }}
                    />
                </div>

                {editorNavState.isEditorNav ? (
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '6px 12px',
                        borderTop: '1px solid var(--border-subtle)',
                        borderBottom: '1px solid var(--border-subtle)',
                        background: 'var(--bg-subtle)'
                    }}>
                        <div style={{ flex: 1, color: 'var(--muted)', fontSize: 12 }}>
                            编辑器导航（当前组已打开的编辑器）
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text)' }}>
                            <span>{groupLabel}</span>
                            <button
                                type="button"
                                className="ghost-btn tiny"
                                style={{ height: 22, width: 22, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                onClick={onClose}
                                title="Close"
                            >
                                <i className="codicon codicon-close" aria-hidden />
                            </button>
                        </div>
                    </div>
                ) : null}
                
                <div 
                    className="command-palette-list" 
                    ref={listRef}
                    style={{
                        maxHeight: '400px',
                        overflowY: 'auto',
                        borderTop: editorNavState.isEditorNav ? 'none' : '1px solid var(--border-subtle)'
                    }}
                >
                    {filteredItems.map((item, index) => (
                        <div
                            key={item.id}
                            className={`command-item ${index === selectedIndex ? 'selected' : ''}`}
                            onClick={() => {
                                item.action();
                                if (item.id !== 'search-files'
                                    && item.id !== 'show-commands'
                                    && item.id !== 'editor-nav'
                                    && item.id !== 'go-to-symbol'
                                    && item.id !== 'go-to-workspace-symbol') {
                                    onClose();
                                }
                            }}
                            onMouseEnter={() => setSelectedIndex(index)}
                            style={{
                                padding: '6px 12px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                cursor: 'pointer',
                                background: index === selectedIndex ? 'var(--list-active-selection-background)' : 'transparent',
                                color: index === selectedIndex ? 'var(--list-active-selection-foreground)' : 'var(--text)'
                            }}
                        >
                            {/* Icon */}
                            <div style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'center', 
                                width: '20px', 
                                opacity: 0.8 
                            }}>
                                <i className={`codicon ${item.icon}`} style={{ fontSize: '16px' }} />
                            </div>

                            {/* Label & Description */}
                            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ fontSize: '13px', fontWeight: '500' }}>{item.label}</span>
                                    {item.description && (
                                        <span style={{ fontSize: '12px', opacity: 0.6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {item.description}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Shortcut */}
                            {item.shortcut && (
                                <div style={{ 
                                    fontSize: '11px', 
                                    opacity: 0.6, 
                                    background: 'var(--bg-subtle)', 
                                    padding: '2px 6px', 
                                    borderRadius: '3px',
                                    marginLeft: '8px' 
                                }}>
                                    {item.shortcut}
                                </div>
                            )}

                            {editorNavState.isEditorNav && item.type === 'editor' && typeof item.closeAction === 'function' ? (
                                <button
                                    type="button"
                                    className="ghost-btn tiny"
                                    style={{ height: 22, width: 22, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: 6 }}
                                    title="Close editor"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        item.closeAction();
                                    }}
                                >
                                    <i className="codicon codicon-close" aria-hidden />
                                </button>
                            ) : null}
                        </div>
                    ))}
                    {filteredItems.length === 0 && (
                        <div style={{ padding: '12px', color: 'var(--muted)', textAlign: 'center', fontSize: '13px' }}>
                            {symbolState.mode && symbolLoading ? 'Searching symbols…' : 'No results found'}
                        </div>
                    )}
                </div>
                {/* Optional Footer similar to VS Code */}
                 {!query && files.length > 0 && (
                    <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end', fontSize: '11px', color: 'var(--muted)' }}>
                         Recently opened
                    </div>
                 )}
            </div>
        </div>,
        document.body
    );
};

export default CommandPalette;
