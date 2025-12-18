"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = __importDefault(require("assert"));
const promises_1 = __importDefault(require("fs/promises"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const router_1 = require("./ai-engine/router");
const runtime_config_1 = require("./ai-engine/runtime_config");
const config_store_1 = require("./ai-engine/config_store");
async function testRouterDecisions() {
    const cfg = (0, runtime_config_1.normalizeRuntimeConfig)({
        env: 'test',
        defaultProvider: 'openai',
        providers: {
            openai: { defaultPoolId: 'default', pools: { default: { apiKey: 'sk-test-openai', baseUrl: '' } } },
            anthropic: { defaultPoolId: 'default', pools: { default: { apiKey: 'sk-test-anthropic', baseUrl: '' } } }
        },
        thresholds: { longTextChars: 10 }
    });
    const short = (0, router_1.decideRoute)({ capability: 'chat', message: 'hi', stream: false }, cfg);
    assert_1.default.equal(short.primary.provider, 'openai');
    const long = (0, router_1.decideRoute)({ capability: 'chat', message: 'x'.repeat(200), stream: false }, cfg);
    assert_1.default.equal(long.primary.provider, 'anthropic');
    assert_1.default.ok(long.reason.includes('long-context'));
    const byCapability = (0, runtime_config_1.normalizeRuntimeConfig)({
        env: 'test',
        defaultProvider: 'openai',
        providers: cfg.providers,
        routing: {
            chat: [{ provider: 'anthropic', model: 'claude-test', tags: ['forced'] }]
        },
        thresholds: { longTextChars: 1000000 }
    });
    const routed = (0, router_1.decideRoute)({ capability: 'chat', message: 'hello', stream: false }, byCapability);
    assert_1.default.equal(routed.primary.provider, 'anthropic');
    assert_1.default.equal(routed.primary.model, 'claude-test');
    assert_1.default.equal(routed.reason, 'routing.config');
}
async function testConfigStore() {
    const dir = await promises_1.default.mkdtemp(path_1.default.join(os_1.default.tmpdir(), 'ai-engine-config-'));
    const p = path_1.default.join(dir, 'ai_engine_config.json');
    await promises_1.default.writeFile(p, JSON.stringify({ env: 'test', defaultProvider: 'anthropic' }), 'utf-8');
    const store = new config_store_1.AiEngineConfigStore({ configPath: p });
    const cfg = await store.loadOnce();
    assert_1.default.equal(cfg.env, 'test');
    assert_1.default.equal(cfg.defaultProvider, 'anthropic');
}
async function testRouterBenchmark() {
    const cfg = (0, runtime_config_1.normalizeRuntimeConfig)({
        env: 'test',
        defaultProvider: 'openai',
        providers: {
            openai: { defaultPoolId: 'default', pools: { default: { apiKey: 'sk-test-openai' } } },
            anthropic: { defaultPoolId: 'default', pools: { default: { apiKey: 'sk-test-anthropic' } } }
        },
        thresholds: { longTextChars: 12000 }
    });
    const start = Date.now();
    for (let i = 0; i < 20000; i += 1) {
        (0, router_1.decideRoute)({ capability: 'chat', message: `hello ${i}`, stream: false }, cfg);
    }
    const elapsed = Date.now() - start;
    assert_1.default.ok(elapsed < 1500);
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
