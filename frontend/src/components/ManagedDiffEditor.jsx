import React, { useCallback, useEffect, useRef } from 'react';

const MonacoDiffEditor = React.lazy(() =>
  import('@monaco-editor/react').then((mod) => ({ default: mod.DiffEditor }))
);

export default function ManagedDiffEditor(props) {
  const modelRef = useRef({ original: null, modified: null });

  const onMount = useCallback((editor, monaco) => {
    const model = editor?.getModel?.();
    modelRef.current = {
      original: model?.original || null,
      modified: model?.modified || null,
    };
    if (typeof props.onMount === 'function') {
      props.onMount(editor, monaco);
    }
  }, [props]);

  useEffect(() => () => {
    const { original, modified } = modelRef.current;
    setTimeout(() => {
      try {
        if (original && typeof original.isDisposed === 'function' && !original.isDisposed()) {
          original.dispose();
        }
        if (modified && typeof modified.isDisposed === 'function' && !modified.isDisposed()) {
          modified.dispose();
        }
      } catch {
      }
    }, 0);
  }, []);

  const { onMount: _ignore, ...rest } = props;
  return (
    <MonacoDiffEditor
      {...rest}
      onMount={onMount}
      keepCurrentOriginalModel={true}
      keepCurrentModifiedModel={true}
    />
  );
}
