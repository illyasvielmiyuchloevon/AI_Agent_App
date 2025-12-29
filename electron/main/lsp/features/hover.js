function requestHover(connection, params, options) {
  return connection.sendRequest('textDocument/hover', params, options);
}

module.exports = { requestHover };

