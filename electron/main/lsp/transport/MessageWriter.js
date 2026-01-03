class MessageWriter {
  constructor(writable) {
    this.writable = writable;
  }

  write(msg) {
    const json = JSON.stringify(msg);
    const bytes = Buffer.from(json, 'utf8');
    const header = Buffer.from(`Content-Length: ${bytes.length}\r\n\r\n`, 'ascii');
    this.writable.write(Buffer.concat([header, bytes]));
  }
}

module.exports = { MessageWriter };

