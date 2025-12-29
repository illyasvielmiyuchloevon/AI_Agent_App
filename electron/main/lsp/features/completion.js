function requestCompletion(connection, params, options) {
  return connection.sendRequest('textDocument/completion', params, options);
}

module.exports = { requestCompletion };

