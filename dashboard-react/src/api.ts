import type { NodeState, MLMetrics, LogsResponse, StatsResponse, ConfigResponse, TwinNode } from './types';

const BASE = '/api';

export const NODES = ['N1', 'N2', 'N3'] as const;
export type NodeId = typeof NODES[number];

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

export const api = {
  nodes: (): Promise<NodeState[]> =>
    get('/nodes'),

  history: (node?: string): Promise<NodeState[]> =>
    get(`/history${node ? `?node=${node}` : ''}`),

  metrics: (): Promise<MLMetrics> =>
    get('/metrics'),

  logs: (page = 1, perPage = 50, node?: string): Promise<LogsResponse> =>
    get(`/logs?page=${page}&per_page=${perPage}${node ? `&node=${node}` : ''}`),

  /** Per-node packet counts and uptime percentages */
  stats: (): Promise<StatsResponse> =>
    get('/stats'),

  /** Current threshold config */
  config: (): Promise<ConfigResponse> =>
    get('/config'),

  /** Update thresholds live */
  setConfig: (body: Partial<ConfigResponse>): Promise<ConfigResponse> =>
    post('/config', body),

  /** Digital twin graph nodes */
  twin: (): Promise<TwinNode[]> =>
    get('/twin'),

  /** Trigger CSV download directly */
  csvUrl: (): string => `${BASE}/logs/export`,
};