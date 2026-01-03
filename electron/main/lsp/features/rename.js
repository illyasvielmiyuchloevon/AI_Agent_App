function requestRename(connection, params, options) {
  return connection.sendRequest('textDocument/rename', params, options);
}

module.exports = { requestRename };

