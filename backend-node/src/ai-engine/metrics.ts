export interface AiEngineMetricSample {
  capability: string;
  provider: string;
  model?: string;
  ok: boolean;
  latencyMs: number;
}

export interface AiEngineMetricsSnapshot {
  counters: Record<string, number>;
  p95LatencyMsByCapability: Record<string, number>;
  lastError?: { at: number; message: string };
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export class AiEngineMetrics {
  private counters: Record<string, number> = {};
  private latency: Record<string, number[]> = {};
  private lastError: { at: number; message: string } | undefined;
  private maxSamplesPerKey = 2000;

  record(sample: AiEngineMetricSample) {
    const capKey = `capability.${sample.capability}.total`;
    this.counters[capKey] = (this.counters[capKey] || 0) + 1;
    const okKey = `capability.${sample.capability}.${sample.ok ? 'ok' : 'error'}`;
    this.counters[okKey] = (this.counters[okKey] || 0) + 1;
    const routeKey = `route.${sample.provider}.${sample.model || 'default'}.total`;
    this.counters[routeKey] = (this.counters[routeKey] || 0) + 1;

    const latencyKey = `capability.${sample.capability}`;
    if (!this.latency[latencyKey]) this.latency[latencyKey] = [];
    const arr = this.latency[latencyKey];
    arr.push(sample.latencyMs);
    if (arr.length > this.maxSamplesPerKey) arr.splice(0, arr.length - this.maxSamplesPerKey);
  }

  recordError(message: string) {
    this.lastError = { at: Date.now(), message };
    this.counters['errors.total'] = (this.counters['errors.total'] || 0) + 1;
  }

  snapshot(): AiEngineMetricsSnapshot {
    const p95LatencyMsByCapability: Record<string, number> = {};
    Object.entries(this.latency).forEach(([key, values]) => {
      const cap = key.replace(/^capability\./, '');
      p95LatencyMsByCapability[cap] = percentile(values, 95);
    });
    return { counters: { ...this.counters }, p95LatencyMsByCapability, lastError: this.lastError };
  }
}

