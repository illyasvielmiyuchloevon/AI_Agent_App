const { MessageReader } = require('../../lsp/transport/MessageReader');
const { MessageWriter } = require('../../lsp/transport/MessageWriter');

const reader = new MessageReader(process.stdin);
const writer = new MessageWriter(process.stdout);

let seq = 1;
let initialized = false;
let terminated = false;

const send = (msg) => writer.write(msg);
const event = (evt, body) => send({ seq: seq++, type: 'event', event: String(evt || ''), ...(body !== undefined ? { body } : {}) });

const respond = (req, body, { success = true, message } = {}) => {
  send({
    seq: seq++,
    type: 'response',
    request_seq: Number(req?.seq) || 0,
    success: success !== false,
    command: String(req?.command || ''),
    ...(message ? { message: String(message) } : {}),
    ...(body !== undefined ? { body } : {}),
  });
};

const normalizeBreakpoints = (args) => {
  const bps = Array.isArray(args?.breakpoints) ? args.breakpoints : [];
  const now = Date.now();
  return bps.map((bp, i) => ({
    id: i + 1,
    verified: true,
    line: Number(bp?.line) || 1,
    message: `ok (${now})`,
  }));
};

const shutdown = () => {
  if (terminated) return;
  terminated = true;
  event('terminated', {});
  event('exited', { exitCode: 0 });
  setTimeout(() => process.exit(0), 10);
};

const onRequest = async (req) => {
  const cmd = String(req?.command || '');
  const args = req?.arguments || {};

  if (cmd === 'initialize') {
    initialized = true;
    respond(req, {
      supportsConfigurationDoneRequest: true,
      supportsEvaluateForHovers: true,
      supportsSetVariable: false,
    });
    setTimeout(() => event('initialized', {}), 5);
    return;
  }

  if (cmd === 'launch' || cmd === 'attach') {
    if (!initialized) {
      respond(req, undefined, { success: false, message: 'not initialized' });
      return;
    }
    const program = args?.program ? String(args.program) : '';
    event('output', { category: 'console', output: `fake dap: ${cmd}${program ? ` program=${program}` : ''}\n` });
    respond(req, {});
    return;
  }

  if (cmd === 'configurationDone') {
    respond(req, {});
    return;
  }

  if (cmd === 'setBreakpoints') {
    respond(req, { breakpoints: normalizeBreakpoints(args) });
    return;
  }

  if (cmd === 'threads') {
    respond(req, { threads: [{ id: 1, name: 'Main' }] });
    return;
  }

  if (cmd === 'stackTrace') {
    respond(req, {
      stackFrames: [
        {
          id: 1,
          name: 'fake',
          line: 1,
          column: 1,
          source: { name: 'fake', path: '' },
        },
      ],
      totalFrames: 1,
    });
    return;
  }

  if (cmd === 'scopes') {
    respond(req, { scopes: [{ name: 'Locals', variablesReference: 1, expensive: false }] });
    return;
  }

  if (cmd === 'variables') {
    const ref = Number(args?.variablesReference) || 0;
    if (ref !== 1) {
      respond(req, { variables: [] });
      return;
    }
    respond(req, {
      variables: [
        { name: 'answer', value: '42', variablesReference: 0 },
        { name: 'hint', value: '"this is a fake adapter"', variablesReference: 0 },
      ],
    });
    return;
  }

  if (cmd === 'evaluate') {
    const expr = args?.expression != null ? String(args.expression) : '';
    respond(req, { result: expr ? `echo: ${expr}` : 'undefined', variablesReference: 0 });
    return;
  }

  if (cmd === 'disconnect') {
    respond(req, {});
    shutdown();
    return;
  }

  if (cmd === 'terminate' || cmd === 'restart') {
    respond(req, {});
    shutdown();
    return;
  }

  respond(req, undefined, { success: false, message: `unsupported command: ${cmd}` });
};

reader.on('message', (msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type !== 'request') return;
  onRequest(msg).catch((err) => {
    respond(msg, undefined, { success: false, message: err?.message || String(err) });
  });
});

reader.on('close', () => shutdown());
