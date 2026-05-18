export interface NodeState {
  node_id: string;
  wall_time: number;
  device_ts: number;
  network_delay_s: number | null;
  avg_delay_s: number;
  congestion: boolean | string;
  ml_risk?: number;
  action: string;
  routing: string;
  routing_path?: string;
  ir_value: number;
  detected: boolean | string;
  battery_pct: number;
}

export interface LogEntry extends NodeState {
  risk_label?: string;
  ml_rationale?: string;
}

export interface MLMetrics {
  val_accuracy: number;
  val_auc: number;
  test_accuracy: number;
  test_auc: number;
  cv_f1_mean: number;
  cv_f1_std: number;
  feature_importance: number[];
  feature_names: string[];
  confusion_matrix: number[][];
  classification_report: {
    Normal: ClassMetrics;
    Congested: ClassMetrics;
    accuracy: number;
  };
  train_size: number;
  val_size: number;
  test_size: number;
  model_type: string;
  n_estimators: number;
  threshold: number;
  window_size?: number;
  roc_fpr: number[];
  roc_tpr: number[];
}

interface ClassMetrics {
  precision: number;
  recall: number;
  'f1-score': number;
  support: number;
}

export interface LogsResponse {
  total: number;
  page: number;
  per_page: number;
  data: LogEntry[];
}

/** Per-node uptime stats from /api/stats */
export interface NodeStats {
  node_id: string;
  total_packets: number;
  expected_packets: number;
  uptime_pct: number;
  packet_loss_pct: number;
  first_seen: number;
  last_seen: number;
}

export interface StatsResponse {
  nodes: NodeStats[];
}

/** Thresholds from /api/config */
export interface ConfigResponse {
  congestion_threshold: number;
  congestion_clear: number;
}

/** Digital twin graph node from /api/twin */
export interface TwinNode {
  id: string;
  latency: number;
  state: 'normal' | 'congested';
}

export interface Contribution {
  feature: string;
  value: number;
  shap_value: number;
  direction: 'increases_risk' | 'decreases_risk';
}

export interface Explanation {
  risk: number;
  risk_label: 'LOW' | 'MEDIUM' | 'HIGH';
  contributions: Contribution[];
  rationale: string;
}

export type ExplainResponse = Record<string, Explanation>;

export interface FailoverState {
  dead_nodes: string[];
  last_seen: Record<string, string>;
  events: string[];
}

export type View = 'overview' | 'charts' | 'ml-metrics' | 'event-log' | 'network-twin' | 'explainability';