import React, { useMemo, useState } from 'react';
import { useAICore } from '../ai-core/AICoreProvider.jsx';

const ACTIONS = [
  { key: 'explain', label: '解释代码', description: '用自然语言解释选中代码' },
  { key: 'tests', label: '生成单元测试', description: '根据框架自动生成测试' },
  { key: 'optimize', label: '优化代码', description: '给出性能和可读性优化建议' },
  { key: 'annotate', label: '生成注释', description: '生成文档字符串和注释' },
  { key: 'rewrite', label: '重写', description: '按说明重写代码' },
  { key: 'review', label: '代码审阅', description: '提供改进建议' },
  { key: 'docs', label: '生成文档', description: '输出 Markdown 说明' },
];

export default function EditorAIActions({ code, path, selectionProvider, onResult }) {
  const { runEditorAction, loading } = useAICore();
  const [running, setRunning] = useState('');
  const selection = useMemo(() => {
    if (!selectionProvider) return '';
    try {
      return selectionProvider();
    } catch (e) {
      return '';
    }
  }, [selectionProvider, code]);

  const handleAction = async (action) => {
    setRunning(action);
    const source = selection?.trim() ? selection : code;
    try {
      const res = await runEditorAction(action, { source, path });
      onResult?.(res.message?.content || res.message?.text || JSON.stringify(res.message));
    } catch (err) {
      onResult?.(`执行失败: ${err.message}`);
    } finally {
      setRunning('');
    }
  };

  return (
    <div className="editor-ai-actions">
      <div className="muted" style={{ marginBottom: 4 }}>编辑器 AI Actions</div>
      <div className="action-grid">
        {ACTIONS.map((action) => (
          <button
            key={action.key}
            className={`ghost-btn action-chip ${running === action.key ? 'loading' : ''}`}
            title={action.description}
            onClick={() => handleAction(action.key)}
            disabled={loading || running}
          >
            {running === action.key ? '运行中…' : action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
