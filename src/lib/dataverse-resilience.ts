import { CircuitBreaker, fetchWithResilience, type ResilienceConfig } from './graph-resilience.js';

function readNonNegativeInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function loadDataverseResilienceConfig(): ResilienceConfig {
  return {
    maxRetries: readNonNegativeInt('MS365_MCP_DYNAMICS_MAX_RETRIES', 3),
    baseBackoffMs: readNonNegativeInt('MS365_MCP_DYNAMICS_BASE_BACKOFF_MS', 200),
    maxBackoffMs: readNonNegativeInt('MS365_MCP_DYNAMICS_MAX_BACKOFF_MS', 5_000),
    fetchTimeoutMs: readNonNegativeInt('MS365_MCP_DYNAMICS_TIMEOUT_MS', 100_000),
    circuitFailureThreshold: readNonNegativeInt('MS365_MCP_DYNAMICS_CIRCUIT_THRESHOLD', 5),
    circuitCooldownMs: readNonNegativeInt('MS365_MCP_DYNAMICS_CIRCUIT_COOLDOWN_MS', 30_000),
    circuitDisabled:
      process.env.MS365_MCP_DYNAMICS_CIRCUIT_DISABLED === 'true' ||
      process.env.MS365_MCP_DYNAMICS_CIRCUIT_DISABLED === '1',
    // Dataverse mutations are never retried, including after a throttle.
    retryThrottledMutations: false,
  };
}

let breaker: CircuitBreaker | undefined;

export async function fetchDataverseWithResilience(
  url: string,
  init: Parameters<typeof fetch>[1]
): Promise<Response> {
  const config = loadDataverseResilienceConfig();
  breaker ??= new CircuitBreaker(
    config.circuitFailureThreshold,
    config.circuitCooldownMs,
    config.circuitDisabled
  );
  return fetchWithResilience(url, init, config, breaker);
}

export function __resetDataverseBreakerForTests(): void {
  breaker = undefined;
}
