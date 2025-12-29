function requestFormatting(connection, params, options) {
  return connection.sendRequest('textDocument/formatting', params, options);
}

module.exports = { requestFormatting };

