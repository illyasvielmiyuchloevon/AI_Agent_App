import { lspDiagnosticToMonacoMarker } from '../adapters/fromLsp';

export function applyDiagnosticsToMonaco({ monaco, modelPathByUri, uri, diagnostics, owner = 'lsp' }) {
  if (!monaco?.editor?.setModelMarkers) return;
  const key = String(uri || '');
  const modelPath = modelPathByUri?.get?.(key) || '';
  if (!modelPath) return;

  const model = monaco.editor.getModel(monaco.Uri.parse(modelPath));
  if (!model) return;

  const list = Array.isArray(diagnostics) ? diagnostics : [];
  const markers = list.map((d) => lspDiagnosticToMonacoMarker(monaco, d)).filter((m) => m.message);
  monaco.editor.setModelMarkers(model, owner, markers);
}

