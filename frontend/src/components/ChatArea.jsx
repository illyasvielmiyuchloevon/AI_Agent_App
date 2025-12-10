import React, { useRef, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import ModeSelector from './ModeSelector';

const Icon = ({ name, size = 18 }) => {
    const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
    switch (name) {
        case 'plus':
            return (
                <svg {...common}>
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
            );
        case 'mic':
            return (
                <svg {...common}>
                    <path d="M12 4a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V7a3 3 0 0 0-3-3Z"></path>
                    <path d="M19 11v1a7 7 0 0 1-14 0v-1"></path>
                    <line x1="12" y1="19" x2="12" y2="22"></line>
                    <line x1="9" y1="22" x2="15" y2="22"></line>
                </svg>
            );
        case 'stop':
            return (
                <svg {...common} fill="currentColor">
                    <rect x="7" y="7" width="10" height="10" rx="2" ry="2"></rect>
                </svg>
            );
        case 'send':
            return (
                <svg {...common}>
                    <line x1="22" y1="2" x2="11" y2="13"></line>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                </svg>
            );
        case 'paperclip':
            return (
                <svg {...common}>
                    <path d="M21.44 11.05l-9.19 9.19a5 5 0 1 1-7.07-7.07l9.19-9.19a3 3 0 1 1 4.24 4.24L9.88 16.24a1 1 0 0 1-1.41-1.41L15.31 8"></path>
                </svg>
            );
        default:
            return null;
    }
};

function ChatArea({ 
    messages, 
    input, 
    setInput, 
    loading, 
    onSend, 
    onStop,
    onToggleLogs,
    currentSession,
    logStatus,
    mode,
    modeOptions,
    onModeChange,
    toolRuns = {}
}) {
    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);
    const recognitionRef = useRef(null);
    const voiceBufferRef = useRef('');
    const imageInputRef = useRef(null);
    const fileInputRef = useRef(null);
    const [attachments, setAttachments] = useState([]);
    const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
    const [recording, setRecording] = useState(false);
    const [dragActive, setDragActive] = useState(false);
    const [expandedRuns, setExpandedRuns] = useState({});

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(scrollToBottom, [messages]);
    
    // Auto focus input when session changes
    useEffect(() => {
        if (currentSession && !loading) {
            inputRef.current?.focus();
        }
    }, [currentSession, loading]);

    const extractContent = (content, fallbackMode) => {
        let textParts = [];
        const images = [];
        const files = [];
        let modeTag = fallbackMode;
        let payload = content;

        if (payload && typeof payload === 'object' && payload.message) {
            modeTag = payload.mode || modeTag;
            payload = payload.message.content ?? payload.message;
        }

        if (payload && typeof payload === 'object' && payload.attachments) {
            modeTag = payload.mode || modeTag;
            const attList = Array.isArray(payload.attachments) ? payload.attachments : [];
            attList.forEach((att) => {
                if (att.type === 'image') images.push(att);
                else files.push(att);
            });
        }

        if (Array.isArray(payload)) {
            payload.forEach((p) => {
                if (p.type === 'text' && p.text) textParts.push(p.text);
                if (p.type === 'image_url' && p.image_url?.url) images.push({ type: 'image', data: p.image_url.url, name: p.image_url.name || 'image' });
            });
        } else if (payload && typeof payload === 'object') {
            if (typeof payload.text === 'string') textParts.push(payload.text);
            if (Array.isArray(payload.content)) {
                payload.content.forEach((p) => {
                    if (p.type === 'text' && p.text) textParts.push(p.text);
                    if (p.type === 'image_url' && p.image_url?.url) images.push({ type: 'image', data: p.image_url.url, name: p.image_url.name || 'image' });
                });
            } else if (typeof payload.content === 'string') {
                textParts.push(payload.content);
            }
        } else if (typeof payload === 'string') {
            textParts.push(payload);
        }

        return { 
            text: textParts.join('\n').trim(), 
            images, 
            files, 
            modeTag 
        };
    };

    const readFile = (file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({
            type: file.type.startsWith('image/') ? 'image' : 'file',
            name: file.name,
            mime_type: file.type,
            data: reader.result
        });
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });

    const handleFiles = async (fileList) => {
        const list = Array.from(fileList || []);
        if (!list.length) return;
        try {
            const loaded = await Promise.all(list.map(readFile));
            setAttachments((prev) => [...prev, ...loaded]);
        } catch (err) {
            console.error(err);
        } finally {
            setShowAttachmentMenu(false);
        }
    };

    const handleDrop = async (e) => {
        e.preventDefault();
        setDragActive(false);
        if (e.dataTransfer?.files?.length) {
            await handleFiles(e.dataTransfer.files);
        }
    };

    const handlePaste = async (e) => {
        const items = e.clipboardData?.items || [];
        const images = [];
        for (const item of items) {
            if (item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (file) images.push(file);
            }
        }
        if (images.length) {
            e.preventDefault();
            await handleFiles(images);
        }
    };

    const removeAttachment = (idx) => {
        setAttachments((prev) => prev.filter((_, i) => i !== idx));
    };

    const handleMicStart = () => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert('当前浏览器不支持语音输入');
            return;
        }
        const rec = new SpeechRecognition();
        rec.lang = 'zh-CN';
        rec.continuous = true;
        rec.interimResults = true;
        voiceBufferRef.current = '';
        rec.onresult = (event) => {
            let transcript = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                transcript += event.results[i][0].transcript;
            }
            voiceBufferRef.current = transcript;
            setInput(transcript);
        };
        rec.onend = () => {
            setRecording(false);
            if (voiceBufferRef.current.trim()) {
                onSend({ text: voiceBufferRef.current.trim(), attachments: [] });
                voiceBufferRef.current = '';
            }
        };
        recognitionRef.current = rec;
        setRecording(true);
        rec.start();
    };

    const handleMicStop = () => {
        recognitionRef.current?.stop();
        setRecording(false);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!input.trim() && attachments.length === 0) return;
        await onSend({ text: input, attachments });
        setAttachments([]);
        setShowAttachmentMenu(false);
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
        }
    };

    const toggleRunDetail = (key) => {
        setExpandedRuns((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    const focusInput = () => {
        inputRef.current?.focus();
    };

    const renderRunBadge = (run, messageKey) => {
        const runKey = `${messageKey}-${run.id || run.name}`;
        const expanded = !!expandedRuns[runKey];
        const statusColor = run.status === 'done' ? 'var(--success)' : (run.status === 'error' ? 'var(--danger)' : 'var(--accent)');
        const statusLabel = run.status === 'done' ? '已完成' : run.status === 'error' ? '失败' : '执行中';
        const detailPreview = run.detail || '';
        const shortDetail = detailPreview.length > 80 ? `${detailPreview.slice(0, 80)}…` : detailPreview;
        return (
            <div 
                key={runKey} 
                className={`tool-run-chip ${run.status || 'running'}`} 
                onClick={() => toggleRunDetail(runKey)}
                title="收起/展开工具调用详情"
            >
                <div className="tool-run-chip-main">
                    <span className="tool-run-chip-icon" style={{ color: statusColor }}>
                        {run.status === 'done' ? '✔︎' : (run.status === 'error' ? '⚠' : <span className="tool-run-spinner" />)}
                    </span>
                    <div className="tool-run-chip-text">
                        <div className="tool-run-chip-title">[工具] {run.name || '调用'}</div>
                        <div className="tool-run-chip-desc" style={{ color: statusColor }}>
                            {statusLabel} {shortDetail ? `· ${shortDetail}` : ''}
                        </div>
                    </div>
                </div>
                {run.status === 'running' && <div className="tool-run-progress" />}
                {expanded && (
                    <div className="tool-run-chip-detail">
                        {run.args && (
                            <div className="tool-run-chip-block">
                                <div className="tool-run-chip-label">入参</div>
                                <pre>{typeof run.args === 'string' ? run.args : JSON.stringify(run.args, null, 2)}</pre>
                            </div>
                        )}
                        {run.result && (
                            <div className="tool-run-chip-block">
                                <div className="tool-run-chip-label">返回值</div>
                                <pre>{typeof run.result === 'string' ? run.result : JSON.stringify(run.result, null, 2)}</pre>
                            </div>
                        )}
                        {!run.args && !run.result && detailPreview && (
                            <div className="tool-run-chip-block">
                                <pre>{detailPreview}</pre>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', overflowX: 'hidden' }}>
            {/* Chat Header */}
            <div style={{ 
                padding: '0 0.5rem', 
                borderBottom: '1px solid var(--border)', 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                background: 'var(--panel)',
                height: '50px',
                boxSizing: 'border-box'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', overflow: 'hidden' }}>
                    <h3 style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '1rem', color: 'var(--text)' }}>
                        {currentSession ? currentSession.title : 'Chat'}
                    </h3>
                </div>
                {currentSession && (
                    <button 
                        onClick={onToggleLogs} 
                        className="ghost-btn"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', padding: '0 0.3rem', height: '28px' }}
                        title="查看本会话 API 日志"
                    >
                        <span style={{ fontSize: '1.2rem' }}>📋</span>
                        {logStatus && (
                            <span style={{ display: 'inline-flex', gap: '0.15rem', alignItems: 'center' }}>
                                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: logStatus.requestOk ? 'var(--success)' : 'var(--danger)', display: 'inline-block' }} />
                                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: logStatus.parseOk ? 'var(--success)' : 'var(--warning)', display: 'inline-block' }} />
                            </span>
                        )}
                    </button>
                )}
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem', background: 'var(--panel-sub)' }}>
                {!currentSession ? (
                    <div style={{ textAlign: 'center', color: 'var(--muted)', marginTop: '2rem' }}>
                        Select a chat to start messaging
                    </div>
                ) : messages.length === 0 ? (
                    <div style={{ textAlign: 'center', color: 'var(--muted)', marginTop: '2rem' }}>
                        Start a conversation...
                    </div>
                ) : (
                    messages.map((msg, index) => {
                        const parsed = extractContent(msg.content, msg.mode);
                        const messageKey = msg._cid || msg.id || index;
                        const runs = toolRuns[messageKey] || [];
                        const isUserMessage = msg.role === 'user';
                        const isToolMessage = msg.role === 'tool';
                        const bubbleMaxWidth = isUserMessage ? '85%' : '96%';
                        const bubbleWidth = isUserMessage ? 'auto' : '100%';
                        const senderLabel = msg.role === 'assistant' ? 'Agent' : msg.role;
                        const alignSide = isUserMessage ? 'flex-end' : 'flex-start';
                        return (
                            <div
                                key={messageKey}
                                style={{
                                    alignSelf: alignSide,
                                    width: bubbleWidth,
                                    maxWidth: bubbleMaxWidth,
                                    padding: '0.8rem 1rem',
                                    borderRadius: 'var(--radius)',
                                    backgroundColor: isUserMessage ? 'var(--accent)' : 'var(--panel)',
                                    color: isUserMessage ? '#fff' : 'var(--text)',
                                    border: isUserMessage ? '1px solid var(--accent-2)' : '1px solid var(--border)',
                                    boxShadow: 'var(--shadow-soft)',
                                    fontSize: isUserMessage ? '0.9rem' : '0.85rem',
                                    lineHeight: '1.5',
                                    wordBreak: 'break-word',
                                    overflowWrap: 'anywhere'
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                                    {!isUserMessage && (
                                        <div style={{ marginBottom: '0.3rem', fontSize: '0.7rem', opacity: 0.6, fontWeight: 'bold' }}>
                                            {senderLabel}
                                        </div>
                                    )}
                                    {parsed.modeTag && (
                                        <span style={{ fontSize: '0.6rem', padding: '0.2rem 0.45rem', background: 'var(--tag-bg)', color: 'var(--tag-text)', borderRadius: '999px' }}>
                                            {parsed.modeTag}
                                        </span>
                                    )}
                                </div>
                                {isToolMessage ? (
                                    <div style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', fontSize: '0.82rem', background: 'var(--panel-sub)', padding: '0.6rem', borderRadius: 'var(--radius)', color: 'var(--muted)', border: '1px dashed var(--border)', width: '100%', boxSizing: 'border-box' }}>
                                        工具调用结果已隐藏
                                    </div>
                                ) : (
                                    <>
                                        {parsed.text && (
                                            <div className="markdown-content">
                                                <ReactMarkdown>
                                                    {parsed.text}
                                                </ReactMarkdown>
                                            </div>
                                        )}
                                        {(parsed.images.length > 0 || parsed.files.length > 0) && (
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.6rem' }}>
                                                {parsed.images.map((img, idx) => (
                                                    <div key={idx} style={{ width: '120px', height: '90px', overflow: 'hidden', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--panel)' }}>
                                                        <img src={img.data} alt={img.name || 'attachment'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                    </div>
                                                ))}
                                                {parsed.files.map((file, idx) => (
                                                    <div key={`file-${idx}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.35rem 0.6rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--panel-sub)' }}>
                                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                            <path d="M21.44 11.05l-9.19 9.19a5 5 0 1 1-7.07-7.07l9.19-9.19a3 3 0 0 1 4.24 4.24L9.88 16.24a1 1 0 0 1-1.41-1.41L15.31 8"></path>
                                                        </svg>
                                                        <span>{file.name || 'file'}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </>
                                )}
                                {msg.role !== 'user' && runs.length > 0 && (
                                    <div className="tool-run-row">
                                        {runs.map((run) => renderRunBadge(run, messageKey))}
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
                {loading && (
                    <div style={{ alignSelf: 'flex-start', color: 'var(--muted)', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem' }}>
                        <div className="spinner"></div> Thinking...
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <form 
                onSubmit={handleSubmit} 
                onDragOver={(e) => { e.preventDefault(); setDragActive(true); }} 
                onDragLeave={() => setDragActive(false)} 
                onDrop={handleDrop}
                style={{ padding: '1rem', borderTop: '1px solid var(--border)', background: 'var(--panel)' }}
            >
                <div 
                    className={`input-shell ${dragActive ? 'dragging' : ''}`} 
                    style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', background: 'var(--panel-sub)', padding: 0, borderRadius: 'var(--radius)', border: '1px solid var(--border)', position: 'relative', cursor: 'text', overflow: 'visible' }}
                    onClick={(e) => {
                        const tag = e.target?.tagName?.toLowerCase();
                        if (tag !== 'button' && tag !== 'svg' && tag !== 'path' && tag !== 'line' && tag !== 'polygon' && tag !== 'rect') {
                            focusInput();
                        }
                    }}
                >
                    <div style={{ padding: 0 }}>
                        <textarea
                            className="chat-textarea"
                            ref={inputRef}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            onPaste={handlePaste}
                            placeholder=""
                            style={{ 
                                width: '100%',
                                padding: '0.85rem 3.25rem 0.85rem 1rem',
                                borderRadius: 0,
                                border: 'none',
                                background: 'transparent',
                                resize: 'none',
                                outline: 'none',
                                fontFamily: 'inherit',
                                fontSize: '0.9rem',
                                minHeight: '5rem',
                                lineHeight: 1.5,
                                color: 'var(--text)'
                            }}
                            disabled={loading}
                        />
                    </div>

                    {attachments.length > 0 && (
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', padding: '0 1rem' }}>
                            {attachments.map((att, idx) => (
                                <div key={idx} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0.4rem', background: 'var(--panel)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    {att.type === 'image' ? (
                                        <img src={att.data} alt={att.name} style={{ width: '56px', height: '42px', objectFit: 'cover', borderRadius: 'var(--radius)' }} />
                                    ) : (
                                        <Icon name="paperclip" size={18} />
                                    )}
                                    <span style={{ fontSize: '0.85rem' }}>{att.name}</span>
                                    <button type="button" onClick={() => removeAttachment(idx)} className="chat-icon-btn" style={{ fontSize: '0.85rem', width: '26px', height: '26px', borderRadius: '6px', padding: 0 }}>×</button>
                                </div>
                            ))}
                        </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', padding: '0 5px 5px 5px', minHeight: '40px', boxSizing: 'border-box' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0, height: '40px' }}>
                            <div style={{ position: 'relative' }}>
                                <button 
                                    type="button"
                                    onClick={() => setShowAttachmentMenu(!showAttachmentMenu)}
                                    className="chat-icon-btn"
                                    title="添加图片/文件"
                                >
                                    <Icon name="plus" size={20} />
                                </button>
                                {showAttachmentMenu && (
                                    <div className="attachment-menu">
                                        <div className="attachment-item" onClick={() => imageInputRef.current?.click()}>上传图片</div>
                                        <div className="attachment-item" onClick={() => fileInputRef.current?.click()}>上传文件</div>
                                        <div className="attachment-item" onClick={() => inputRef.current?.focus()}>粘贴图片</div>
                                    </div>
                                )}
                            </div>
                            <button 
                                type="button"
                                onClick={recording ? handleMicStop : handleMicStart}
                                className="chat-icon-btn"
                                title="语音输入"
                                style={{ background: recording ? 'var(--danger-pill)' : 'var(--panel)', color: recording ? 'var(--danger)' : 'var(--muted)' }}
                            >
                                <Icon name="mic" size={20} />
                            </button>
                        </div>
                        <ModeSelector value={mode} options={modeOptions} onChange={onModeChange} />
                    </div>
                    <div style={{ position: 'absolute', right: '5px', bottom: '5px', display: 'flex', alignItems: 'center', gap: '0.4rem', pointerEvents: 'auto' }}>
                        {loading ? (
                            <button 
                                type="button"
                                onClick={onStop}
                                className="chat-stop-btn"
                                title="Stop Generation"
                            >
                                <Icon name="stop" size={20} />
                            </button>
                        ) : (
                            <button 
                                type="submit" 
                                disabled={!input.trim() && attachments.length === 0} 
                                className="chat-send-btn"
                                title="Send"
                            >
                                <Icon name="send" size={20} />
                            </button>
                        )}
                    </div>
                </div>
                <input ref={imageInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => handleFiles(e.target.files)} />
                <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={(e) => handleFiles(e.target.files)} />
            </form>
        </div>
    );
}

export default ChatArea;
