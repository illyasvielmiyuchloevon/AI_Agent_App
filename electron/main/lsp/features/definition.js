function requestDefinition(connection, params, options) {
  return connection.sendRequest('textDocument/definition', params, options);
}

module.exports = { requestDefinition };

