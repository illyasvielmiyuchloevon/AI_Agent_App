"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiEngineMetrics = void 0;
function percentile(values, p) {
    if (values.length === 0)
        return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[idx];
}
class AiEngineMetrics {
    counters = {};
    latency = {};
    lastError;
    maxSamplesPerKey = 2000;
    record(sample) {
        const capKey = `capability.${sample.capability}.total`;
        this.counters[capKey] = (this.counters[capKey] || 0) + 1;
        const okKey = `capability.${sample.capability}.${sample.ok ? 'ok' : 'error'}`;
        this.counters[okKey] = (this.counters[okKey] || 0) + 1;
        const routeKey = `route.${sample.provider}.${sample.model || 'default'}.total`;
        this.counters[routeKey] = (this.counters[routeKey] || 0) + 1;
        const latencyKey = `capability.${sample.capability}`;
        if (!this.latency[latencyKey])
            this.latency[latencyKey] = [];
        const arr = this.latency[latencyKey];
        arr.push(sample.latencyMs);
        if (arr.length > this.maxSamplesPerKey)
            arr.splice(0, arr.length - this.maxSamplesPerKey);
    }
    recordError(message) {
        this.lastError = { at: Date.now(), message };
        this.counters['errors.total'] = (this.counters['errors.total'] || 0) + 1;
    }
    snapshot() {
        const p95LatencyMsByCapability = {};
        Object.entries(this.latency).forEach(([key, values]) => {
            const cap = key.replace(/^capability\./, '');
            p95LatencyMsByCapability[cap] = percentile(values, 95);
        });
        return { counters: { ...this.counters }, p95LatencyMsByCapability, lastError: this.lastError };
    }
}
exports.AiEngineMetrics = AiEngineMetrics;
