import React from 'react';

const WorkspaceTaskReviewFloating = ({
  visible,
  activeFile,
  pendingBlocks,
  currentPendingIndex,
  taskBlocks,
  onTaskRevertFile,
  onTaskKeepFile,
  onTaskResetFile,
  setTaskCursor,
}) => {
  if (!visible) return null;

  return (
    <div className="task-review-floating" role="region" aria-label="Task Review">
      <div className="task-review-floating-main">
        <div className="task-review-floating-text">变更已完成，请确认是否采纳</div>
        <div className="task-review-floating-actions">
          {typeof onTaskRevertFile === 'function' ? (
            <button type="button" className="task-review-btn" onClick={() => onTaskRevertFile(activeFile)}>
              全部撤销
            </button>
          ) : null}
          {typeof onTaskKeepFile === 'function' ? (
            <button type="button" className="task-review-btn" onClick={() => onTaskKeepFile(activeFile)}>
              全部采纳
            </button>
          ) : null}
          {typeof onTaskResetFile === 'function' ? (
            <button type="button" className="task-review-btn" onClick={() => onTaskResetFile(activeFile)} title="还原所有变更到 Diff 状态">
              还原 Diff
            </button>
          ) : null}
        </div>
      </div>
      <div className="task-review-floating-nav">
        <div className="task-review-floating-count">
          {currentPendingIndex !== -1 ? `${currentPendingIndex + 1}/${pendingBlocks.length}` : `-/${pendingBlocks.length}`}
        </div>
        <button
          type="button"
          className="task-review-btn"
          disabled={currentPendingIndex <= 0}
          onClick={() => {
            const target = pendingBlocks[currentPendingIndex - 1];
            if (target) {
              const realIdx = taskBlocks.findIndex((b) => b.id === target.id);
              if (realIdx !== -1) setTaskCursor(realIdx);
            }
          }}
          title="上一处待处理变更"
        >
          <span className="codicon codicon-chevron-up" aria-hidden />
        </button>
        <button
          type="button"
          className="task-review-btn"
          disabled={currentPendingIndex === -1 || currentPendingIndex >= pendingBlocks.length - 1}
          onClick={() => {
            const target = pendingBlocks[currentPendingIndex + 1];
            if (target) {
              const realIdx = taskBlocks.findIndex((b) => b.id === target.id);
              if (realIdx !== -1) setTaskCursor(realIdx);
            }
          }}
          title="下一处待处理变更"
        >
          <span className="codicon codicon-chevron-down" aria-hidden />
        </button>
      </div>
    </div>
  );
};

export default React.memo(WorkspaceTaskReviewFloating);

