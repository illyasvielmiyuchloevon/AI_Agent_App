const { pathToFileURL, fileURLToPath } = require('url');

function toFileUri(fsPath) {
  try {
    return pathToFileURL(String(fsPath)).toString();
  } catch {
    return '';
  }
}

function fromFileUri(uri) {
  try {
    return fileURLToPath(String(uri));
  } catch {
    return '';
  }
}

module.exports = { toFileUri, fromFileUri };

