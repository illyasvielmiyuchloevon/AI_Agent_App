function registerDiagnosticsFeature(connection, onPublishDiagnostics) {
  if (!connection?.onNotification) return;
  connection.onNotification('textDocument/publishDiagnostics', onPublishDiagnostics);
}

module.exports = { registerDiagnosticsFeature };

