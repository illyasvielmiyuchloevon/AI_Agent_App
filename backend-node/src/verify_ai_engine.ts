import assert from 'assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { decideRoute } from './ai-engine/router';
import { normalizeRuntimeConfig } from './ai-engine/runtime_config';
import { AiEngineConfigStore } from './ai-engine/config_store';

async function testRouterDecisions() {
  const cfg = normalizeRuntimeConfig({
    env: 'test',
    defaultProvider: 'openai',
    providers: {
      openai: { apiKey: 'sk-test-openai', baseUrl: '' },
      anthropic: { apiKey: 'sk-test-anthropic', baseUrl: '' }
    },
    thresholds: { longTextChars: 10 }
  });

  const short = decideRoute({ capability: 'chat', message: 'hi', stream: false }, cfg);
  assert.equal(short.primary.provider, 'openai');

  const long = decideRoute({ capability: 'chat', message: 'x'.repeat(200), stream: false }, cfg);
  assert.equal(long.primary.provider, 'anthropic');
  assert.ok(long.reason.includes('long-context'));

  const byCapability = normalizeRuntimeConfig({
    env: 'test',
    defaultProvider: 'openai',
    providers: cfg.providers,
    routing: {
      chat: [{ provider: 'anthropic', model: 'claude-test', tags: ['forced'] }]
    },
    thresholds: { longTextChars: 1000000 }
  });
  const routed = decideRoute({ capability: 'chat', message: 'hello', stream: false }, byCapability);
  assert.equal(routed.primary.provider, 'anthropic');
  assert.equal(routed.primary.model, 'claude-test');
  assert.equal(routed.reason, 'routing.config');
}

async function testConfigStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-engine-config-'));
  const p = path.join(dir, 'ai_engine_config.json');
  await fs.writeFile(p, JSON.stringify({ env: 'test', defaultProvider: 'anthropic' }), 'utf-8');

  const store = new AiEngineConfigStore({ configPath: p });
  const cfg = await store.loadOnce();
  assert.equal(cfg.env, 'test');
  assert.equal(cfg.defaultProvider, 'anthropic');
}

async function testRouterBenchmark() {
  const cfg = normalizeRuntimeConfig({
    env: 'test',
    defaultProvider: 'openai',
    providers: {
      openai: { apiKey: 'sk-test-openai' },
      anthropic: { apiKey: 'sk-test-anthropic' }
    },
    thresholds: { longTextChars: 12000 }
  });

  const start = Date.now();
  for (let i = 0; i < 20000; i += 1) {
    decideRoute({ capability: 'chat', message: `hello ${i}`, stream: false }, cfg);
  }
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 1500);
}

async function run() {
  await testRouterDecisions();
  console.log('AI Engine router decisions: Passed');
  await testConfigStore();
  console.log('AI Engine config store: Passed');
  await testRouterBenchmark();
  console.log('AI Engine router benchmark: Passed');
}

run().catch((e) => {
  console.error('AI Engine tests failed:', e);
  process.exit(1);
});

