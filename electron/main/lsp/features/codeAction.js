function requestCodeAction(connection, params, options) {
  return connection.sendRequest('textDocument/codeAction', params, options);
}

module.exports = { requestCodeAction };

