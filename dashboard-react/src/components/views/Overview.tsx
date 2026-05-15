import { useEffect, useState, useCallback, useRef } from 'react';
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { api, NODES } from '../../api';
import type { NodeState, LogEntry, NodeStats } from '../../types';
import { C } from '../../theme';
import { Alert } from '../ui/Alert';
import { Skeleton } from '../ui/Skeleton';

const POLL_MS = 5000;
const NODE_COLORS: Record<string, string> = { N1: C.amber, N2: C.teal, N3: C.muted };

function bool(v: boolean | string | undefined): boolean {
  if (typeof v === 'boolean') return v;
  return String(v).toLowerCase() === 'true';
}

/* ─── Toast alert ────────────────────────────────────────────────── */
interface Toast { id: number; node: string; risk: number; }

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div style={{
      position: 'fixed', top: 64, right: 24, zIndex: 1000,
      display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none',
    }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: '#1a0a0a', border: `1px solid ${C.red}`,
          borderRadius: 10, padding: '10px 14px',
          boxShadow: `0 0 20px rgba(239,68,68,0.25)`,
          pointerEvents: 'all', minWidth: 220,
          animation: 'slideIn 0.2s ease',
        }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: C.red, flexShrink: 0,
            boxShadow: `0 0 6px ${C.red}`,
          }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.red }}>HIGH RISK — Node {t.node}</div>
            <div style={{ fontSize: 11, color: C.text3, marginTop: 1 }}>ML risk at {t.risk.toFixed(0)}%</div>
          </div>
          <button
            onClick={() => onDismiss(t.id)}
            style={{ background: 'none', border: 'none', color: C.text3, cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 2 }}
          >×</button>
        </div>
      ))}
    </div>
  );
}

/* ─── Pulse dot ──────────────────────────────────────────────────── */
function PulseDot({ active }: { active: boolean }) {
  return (
    <div style={{ position: 'relative', width: 8, height: 8, flexShrink: 0 }}>
      {active && (
        <div className="pulse-ring" style={{
          position: 'absolute', inset: 0, borderRadius: '50%', background: C.green,
        }} />
      )}
      <div style={{
        position: 'relative', width: 8, height: 8, borderRadius: '50%',
        background: active ? C.green : C.text3, zIndex: 1,
      }} />
    </div>
  );
}

/* ─── Sparkline ──────────────────────────────────────────────────── */
function SparkLine({ data, color }: { data: { v: number | null }[]; color: string }) {
  if (!data.length) return <div style={{ height: 32 }} />;
  return (
    <ResponsiveContainer width="100%" height={32}>
      <LineChart data={data} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
        <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5}
          dot={false} connectNulls isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/* ─── Ring gauge ─────────────────────────────────────────────────── */
function RingGauge({ pct, size = 120 }: { pct: number; size?: number }) {
  const sw   = 10;
  const r    = (size - sw) / 2;
  const cx   = size / 2;
  const cy   = size / 2;
  const circ = 2 * Math.PI * r;
  const fill = circ * Math.min(1, Math.max(0, pct / 100));
  const col  = pct > 70 ? C.teal : pct > 40 ? C.amber : C.red;
  return (
    <svg width={size} height={size} style={{ display: 'block' }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.bgElevated} strokeWidth={sw} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={col} strokeWidth={sw}
        strokeDasharray={`${fill} ${circ - fill}`} strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ transition: 'stroke-dasharray 0.6s ease' }} />
      <text x={cx} y={cy - 5} textAnchor="middle" fill={C.text1} fontSize={20} fontWeight={700} style={{ fontFamily: 'Inter, sans-serif' }}>
        {Math.round(pct)}%
      </text>
      <text x={cx} y={cy + 13} textAnchor="middle" fill={C.text3} fontSize={10} style={{ fontFamily: 'Inter, sans-serif' }}>
        HEALTH
      </text>
    </svg>
  );
}

/* ─── Trend badge ────────────────────────────────────────────────── */
function TrendBadge({ curr, prev, higherIsBad = true }: { curr: number; prev: number | null; higherIsBad?: boolean }) {
  if (prev === null || prev === 0 || curr === prev) return null;
  const pct  = ((curr - prev) / Math.abs(prev)) * 100;
  if (Math.abs(pct) < 1) return null;
  const up   = pct > 0;
  const good = higherIsBad ? !up : up;
  const col  = good ? C.teal : C.amber;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 10, fontWeight: 600,
      color: col, background: good ? C.tealDim : C.amberDim,
      padding: '2px 6px', borderRadius: 4, lineHeight: 1.4,
    }}>
      {up ? '↑' : '↓'} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

/* ─── Metric card ────────────────────────────────────────────────── */
function MetricCard({ label, value, sub, accent = C.text1, curr, prev, higherIsBad }: {
  label: string; value: string; sub: string; accent?: string;
  curr?: number; prev?: number | null; higherIsBad?: boolean;
}) {
  return (
    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: C.CARD_RADIUS, padding: C.CARD_PAD }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: C.text3, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {label}
        </span>
        {curr != null && prev !== undefined && (
          <TrendBadge curr={curr} prev={prev ?? null} higherIsBad={higherIsBad} />
        )}
      </div>
      <div style={{ fontSize: 28, fontWeight: 600, color: accent, lineHeight: 1, letterSpacing: '-1px', marginBottom: 6 }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: C.text3 }}>{sub}</div>
    </div>
  );
}

/* ─── Uptime badge ───────────────────────────────────────────────── */
function UptimeBadge({ stats }: { stats: NodeStats | undefined }) {
  if (!stats) return null;
  const pct = stats.uptime_pct;
  const col = pct >= 98 ? C.teal : pct >= 90 ? C.amber : C.red;
  const dim = pct >= 98 ? C.tealDim : pct >= 90 ? C.amberDim : C.redDim;
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 4,
      padding: '8px 10px', borderRadius: 8,
      background: dim, border: `1px solid ${col}22`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: col, fontWeight: 600, letterSpacing: '0.06em' }}>UPTIME</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: col }}>{pct.toFixed(1)}%</span>
      </div>
      {/* Mini progress bar */}
      <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 2,
          width: `${Math.min(100, pct)}%`,
          background: col,
          transition: 'width 0.6s ease',
        }} />
      </div>
      <div style={{ fontSize: 10, color: C.text3 }}>
        loss: {stats.packet_loss_pct.toFixed(1)}% &nbsp;·&nbsp; {stats.total_packets.toLocaleString()} pkts
      </div>
    </div>
  );
}

/* ─── Node card ──────────────────────────────────────────────────── */
function NodeCard({ nodeId, state, spark, stats }: {
  nodeId: string; state: NodeState | undefined;
  spark: { v: number | null }[]; stats: NodeStats | undefined;
}) {
  const color = NODE_COLORS[nodeId] ?? C.amber;
  if (!state) {
    return (
      <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: C.CARD_RADIUS, padding: C.CARD_PAD }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <PulseDot active={false} />
          <span style={{ fontSize: 13, fontWeight: 600, color: C.text2 }}>Node {nodeId}</span>
          <span style={{ fontSize: 10, color: C.text3, background: C.bgElevated, padding: '2px 7px', borderRadius: 4, marginLeft: 'auto', letterSpacing: '0.05em' }}>
            WAITING
          </span>
        </div>
        <div style={{ height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 12, color: C.text3 }}>No telemetry received</span>
        </div>
      </div>
    );
  }
  const detected  = bool(state.detected);
  const congested = bool(state.congestion);
  const battery   = state.battery_pct ?? 0;
  const delayMs   = state.avg_delay_s != null ? state.avg_delay_s * 1000 : null;
  const mlRisk    = (state.ml_risk ?? 0) * 100;

  return (
    <div style={{
      background: C.bgCard,
      border: `1px solid ${congested ? 'rgba(239,68,68,0.2)' : C.border}`,
      borderRadius: C.CARD_RADIUS, padding: C.CARD_PAD,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <PulseDot active />
        <span style={{ fontSize: 13, fontWeight: 600, color: C.text1 }}>Node {nodeId}</span>
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          {congested && <span style={{ fontSize: 10, fontWeight: 600, color: C.red, background: C.redDim, padding: '2px 7px', borderRadius: 4, letterSpacing: '0.04em' }}>CONGESTED</span>}
          {detected  && <span style={{ fontSize: 10, fontWeight: 600, color, background: `${color}18`, padding: '2px 7px', borderRadius: 4, letterSpacing: '0.04em' }}>IR ACTIVE</span>}
          {!congested && !detected && <span style={{ fontSize: 10, fontWeight: 600, color: C.teal, background: C.tealDim, padding: '2px 7px', borderRadius: 4, letterSpacing: '0.04em' }}>NORMAL</span>}
        </div>
      </div>
      <div style={{ marginBottom: 10, marginLeft: -4, marginRight: -4 }}>
        <SparkLine data={spark} color={color} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {[
          { label: 'Avg Delay',  value: delayMs != null ? `${delayMs.toFixed(1)} ms` : '—', color },
          { label: 'IR Reading', value: String(state.ir_value),      color: C.text1 },
          { label: 'ML Risk',    value: `${mlRisk.toFixed(0)}%`,     color: mlRisk > 70 ? C.red : mlRisk > 40 ? C.amber : C.teal },
          { label: 'Battery',    value: `${battery.toFixed(0)}%`,    color: battery < 30 ? C.red : battery < 60 ? C.amber : C.text2 },
          { label: 'Routing',    value: state.routing,               color: C.text3 },
        ].map(({ label, value, color: vc }) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: C.text3 }}>{label}</span>
            <span style={{ fontSize: 11, color: vc, fontWeight: vc === C.text3 ? 400 : 500 }}>{value}</span>
          </div>
        ))}
      </div>
      {/* Uptime badge */}
      <div style={{ marginTop: 12 }}>
        <UptimeBadge stats={stats} />
      </div>
    </div>
  );
}

/* ─── Congestion Heatmap ─────────────────────────────────────────── */
interface HeatCell { t: string; N1: number; N2: number; N3: number; }

function CongestionHeatmap({ data }: { data: HeatCell[] }) {
  if (!data.length) {
    return (
      <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 12, color: C.text3 }}>No data</span>
      </div>
    );
  }

  function riskColor(risk: number): string {
    if (risk >= 0.70) return C.red;
    if (risk >= 0.40) return C.amber;
    return C.teal;
  }

  function riskBg(risk: number): string {
    if (risk >= 0.70) return `rgba(239,68,68,${0.1 + risk * 0.55})`;
    if (risk >= 0.40) return `rgba(245,166,35,${0.1 + risk * 0.5})`;
    return `rgba(0,201,167,${0.07 + risk * 0.3})`;
  }

  const visible = data.slice(-48); // last 48 time buckets

  return (
    <div>
      {/* Node row labels */}
      {NODES.map(nid => (
        <div key={nid} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: NODE_COLORS[nid], width: 22, flexShrink: 0 }}>{nid}</span>
          <div style={{ display: 'flex', gap: 2, flex: 1 }}>
            {visible.map((cell, i) => {
              const risk = cell[nid as 'N1' | 'N2' | 'N3'];
              return (
                <div
                  key={i}
                  title={`${nid} @ ${cell.t}: ${(risk * 100).toFixed(0)}% risk`}
                  style={{
                    flex: 1,
                    height: 18,
                    borderRadius: 2,
                    background: riskBg(risk),
                    border: `1px solid ${riskColor(risk)}22`,
                    cursor: 'default',
                    transition: 'transform 0.1s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scaleY(1.3)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scaleY(1)'; }}
                />
              );
            })}
          </div>
        </div>
      ))}
      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, marginTop: 8, justifyContent: 'flex-end' }}>
        {[{ col: C.teal, label: 'Low' }, { col: C.amber, label: 'Medium' }, { col: C.red, label: 'High' }].map(({ col, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: col, opacity: 0.7 }} />
            <span style={{ fontSize: 10, color: C.text3 }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Recent event row ───────────────────────────────────────────── */
function EventRow({ entry }: { entry: LogEntry }) {
  const detected  = bool(entry.detected);
  const congested = bool(entry.congestion);
  const dot  = congested ? C.red : detected ? C.amber : C.green;
  const ts   = new Date(entry.wall_time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: `1px solid ${C.borderSub}` }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: dot, flexShrink: 0 }} />
      <span style={{ fontSize: 12, fontWeight: 600, color: C.amber, width: 24, flexShrink: 0 }}>{entry.node_id}</span>
      <span className="mono" style={{ fontSize: 11, color: C.text2, width: 32, flexShrink: 0 }}>{entry.ir_value}</span>
      <span className="mono" style={{ fontSize: 10, color: C.text3, marginLeft: 'auto' }}>{ts}</span>
    </div>
  );
}

/* ─── Overview ───────────────────────────────────────────────────── */
interface ChartRow { i: number; N1: number|null; N2: number|null; N3: number|null; }

export default function Overview() {
  const [nodes,        setNodes]        = useState<NodeState[]>([]);
  const [history,      setHistory]      = useState<Record<string, { v: number | null }[]>>({});
  const [chartData,    setChartData]    = useState<ChartRow[]>([]);
  const [heatData,     setHeatData]     = useState<HeatCell[]>([]);
  const [recentEvents, setRecentEvents] = useState<LogEntry[]>([]);
  const [nodeStats,    setNodeStats]    = useState<Record<string, import('../../types').NodeStats>>({});
  const [toasts,       setToasts]       = useState<{ id: number; node: string; risk: number }[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const prevRef    = useRef<Record<string, number | null>>({});
  const toastIdRef = useRef(0);
  const alreadyAlerted = useRef<Set<string>>(new Set());

  const dismissToast = (id: number) => setToasts(t => t.filter(x => x.id !== id));

  const fetch_ = useCallback(async () => {
    try {
      const [nodesData, histData, logsData] = await Promise.all([
        api.nodes(),
        api.history(),
        api.logs(1, 5),
      ]);

      // Try stats endpoint (gracefully degrade if backend not yet updated)
      let statsMap: Record<string, import('../../types').NodeStats> = {};
      try {
        const statsResp = await api.stats();
        statsMap = Object.fromEntries(statsResp.nodes.map(n => [n.node_id, n]));
      } catch { /* backend may not have /api/stats yet */ }

      const known = nodesData.filter(n => (NODES as readonly string[]).includes(n.node_id));
      setNodes(prev => {
        prevRef.current = Object.fromEntries(prev.map(n => [n.node_id, n.avg_delay_s]));
        return known;
      });
      setNodeStats(statsMap);

      // HIGH RISK toasts
      known.forEach(n => {
        const risk = (n.ml_risk ?? 0) * 100;
        const key  = n.node_id;
        if (risk >= 70 && !alreadyAlerted.current.has(key)) {
          alreadyAlerted.current.add(key);
          const id = ++toastIdRef.current;
          setToasts(t => [...t, { id, node: key, risk }]);
          setTimeout(() => dismissToast(id), 6000);
        } else if (risk < 40) {
          alreadyAlerted.current.delete(key);
        }
      });

      // Sparklines + chart
      const spark: Record<string, { v: number | null }[]> = {};
      const perNode: Record<string, (number | null)[]> = {};
      NODES.forEach(nid => {
        const rows = histData.filter(r => r.node_id === nid).slice(-40);
        spark[nid]   = rows.map(r => ({ v: r.avg_delay_s != null ? r.avg_delay_s * 1000 : null }));
        perNode[nid] = rows.map(r => r.avg_delay_s != null ? r.avg_delay_s * 1000 : null);
      });
      const maxLen = Math.max(...NODES.map(n => perNode[n].length), 0);
      setChartData(Array.from({ length: maxLen }, (_, i) => ({
        i,
        N1: perNode['N1']?.[i] ?? null,
        N2: perNode['N2']?.[i] ?? null,
        N3: perNode['N3']?.[i] ?? null,
      })));
      setHistory(spark);

      // Heatmap: merge history into time-bucketed grid
      const heatRows: HeatCell[] = [];
      const allTimes = [...new Set(histData.map(r => r.wall_time))].sort();
      const step = Math.max(1, Math.floor(allTimes.length / 60));
      for (let i = 0; i < allTimes.length; i += step) {
        const bucket = allTimes.slice(i, i + step);
        const cell: HeatCell = {
          t: new Date(allTimes[i] * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          N1: 0, N2: 0, N3: 0,
        };
        NODES.forEach(nid => {
          const rows = histData.filter(r => r.node_id === nid && bucket.includes(r.wall_time));
          if (rows.length) {
            cell[nid as 'N1' | 'N2' | 'N3'] = rows.reduce((s, r) => s + (r.ml_risk ?? 0), 0) / rows.length;
          }
        });
        heatRows.push(cell);
      }
      setHeatData(heatRows);
      setRecentEvents(logsData.data.slice(0, 5));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch_();
    const id = setInterval(fetch_, POLL_MS);
    return () => clearInterval(id);
  }, [fetch_]);

  const nodeMap      = new Map(nodes.map(n => [n.node_id, n]));
  const activeCount  = nodes.length;
  const congestCount = nodes.filter(n => bool(n.congestion)).length;
  const detectCount  = nodes.filter(n => bool(n.detected)).length;
  const avgDelayMs   = nodes.length ? nodes.reduce((s, n) => s + (n.avg_delay_s ?? 0) * 1000, 0) / nodes.length : 0;
  const avgMlRisk    = nodes.length ? nodes.reduce((s, n) => s + (n.ml_risk ?? 0) * 100, 0) / nodes.length : 0;
  const avgBattery   = nodes.length ? nodes.reduce((s, n) => s + (n.battery_pct ?? 0), 0) / nodes.length : 0;
  const healthPct    = Math.max(0, Math.min(100, 100 - congestCount / NODES.length * 60 - avgMlRisk * 0.4));
  const prevAvgDelay = Object.keys(prevRef.current).length > 0
    ? (Object.values(prevRef.current).reduce((s: number, v) => s + (v ?? 0), 0) / NODES.length) * 1000
    : null;

  const chartAxisProps = { tick: { fontSize: 9, fill: C.text3 }, tickLine: false as const, axisLine: false as const };
  const tooltipStyle   = {
    contentStyle: { background: '#111118', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11, padding: '6px 10px' },
    labelStyle: { color: C.text3, fontSize: 9 }, itemStyle: { color: C.text1 },
    cursor: { stroke: 'rgba(255,255,255,0.05)', strokeWidth: 1 },
  };

  if (loading) return <OverviewSkeleton />;

  return (
    <>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {error && <Alert message="Unable to reach API" detail={error} onRetry={fetch_} />}

        {/* ── Row 1: metric cards ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, flexShrink: 0 }}>
          <MetricCard label="Active Nodes"   value={`${activeCount}/${NODES.length}`} sub="reporting telemetry"
            accent={activeCount === NODES.length ? C.teal : C.amber} />
          <MetricCard label="Avg Delay"      value={avgDelayMs > 0 ? `${avgDelayMs.toFixed(1)}` : '—'} sub="ms per packet"
            accent={avgDelayMs < 30 ? C.teal : avgDelayMs < 80 ? C.amber : C.red}
            curr={avgDelayMs} prev={prevAvgDelay} higherIsBad />
          <MetricCard label="Congested"      value={String(congestCount)} sub={congestCount > 0 ? 'above threshold' : 'all clear'}
            accent={congestCount > 0 ? C.red : C.text3} />
          <MetricCard label="IR Detections"  value={String(detectCount)} sub={detectCount > 0 ? 'active events' : 'no events'}
            accent={detectCount > 0 ? C.amber : C.text3} />
        </div>

        {/* ── Row 2: main content ── */}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '65fr 35fr', gap: 14, minHeight: 0 }}>

          {/* LEFT */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>

            {/* Node cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {NODES.map(id => (
                <NodeCard key={id} nodeId={id} state={nodeMap.get(id)} spark={history[id] ?? []} stats={nodeStats[id]} />
              ))}
            </div>

            {/* Congestion Heatmap */}
            <div style={{
              background: C.bgCard, border: `1px solid ${C.border}`,
              borderRadius: C.CARD_RADIUS, padding: C.CARD_PAD, flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: C.text3, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  Congestion Heatmap
                </span>
                <span style={{ fontSize: 10, color: C.text3 }}>ML risk per node · last 200 packets</span>
              </div>
              <CongestionHeatmap data={heatData} />
            </div>

            {/* Network Activity chart */}
            <div style={{
              background: C.bgCard, border: `1px solid ${C.border}`,
              borderRadius: C.CARD_RADIUS, padding: C.CARD_PAD,
              display: 'flex', flexDirection: 'column', flex: 1, minHeight: 120,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexShrink: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: C.text3, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  Network Activity
                </span>
                <div style={{ display: 'flex', gap: 12 }}>
                  {NODES.map(n => (
                    <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <div style={{ width: 14, height: 2, background: NODE_COLORS[n], borderRadius: 1 }} />
                      <span style={{ fontSize: 10, color: C.text3 }}>N{n.slice(1)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ flex: 1, minHeight: 80 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="0" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="i" hide />
                    <YAxis {...chartAxisProps} unit=" ms" width={44} />
                    <Tooltip {...tooltipStyle} formatter={(v, name) => [v != null ? `${v} ms` : '—', `Node ${name}`]} />
                    {(['N1', 'N2', 'N3'] as const).map(n => (
                      <Area key={n} type="monotone" dataKey={n}
                        stroke={NODE_COLORS[n]} strokeWidth={1.5}
                        fill={NODE_COLORS[n]} fillOpacity={n === 'N1' ? 0.12 : n === 'N2' ? 0.10 : 0.06}
                        dot={false} connectNulls isAnimationActive={false}
                        activeDot={{ r: 3, fill: NODE_COLORS[n], stroke: C.bgCard, strokeWidth: 1 }}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* RIGHT */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>

            {/* Health ring */}
            <div style={{
              background: C.bgCard, border: `1px solid ${C.border}`,
              borderRadius: C.CARD_RADIUS, padding: C.CARD_PAD,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, flexShrink: 0,
            }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: C.text3, letterSpacing: '0.08em', textTransform: 'uppercase', alignSelf: 'flex-start' }}>
                Network Health
              </span>
              <RingGauge pct={healthPct} size={120} />
            </div>

            {/* System status */}
            <div style={{
              background: C.bgCard, border: `1px solid ${C.border}`,
              borderRadius: C.CARD_RADIUS, padding: C.CARD_PAD, flexShrink: 0,
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.text3, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
                System Status
              </div>
              {[
                { label: 'Active Nodes', val: `${activeCount} / ${NODES.length}`, col: activeCount === NODES.length ? C.teal : C.amber },
                { label: 'Avg ML Risk',  val: `${avgMlRisk.toFixed(1)}%`,         col: avgMlRisk > 70 ? C.red : avgMlRisk > 40 ? C.amber : C.teal },
                { label: 'Avg Battery',  val: nodes.length ? `${avgBattery.toFixed(0)}%` : '—', col: C.text1 },
                { label: 'Avg Delay',    val: avgDelayMs > 0 ? `${avgDelayMs.toFixed(1)} ms` : '—', col: C.amber },
                { label: 'Congested',    val: String(congestCount), col: congestCount > 0 ? C.red : C.teal },
                { label: 'Detections',   val: String(detectCount),  col: detectCount > 0 ? C.amber : C.text3 },
              ].map(({ label, val, col }, i) => (
                <div key={label} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 0', borderBottom: i < 5 ? `1px solid ${C.borderSub}` : 'none',
                }}>
                  <span style={{ fontSize: 12, color: C.text3 }}>{label}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: col }}>{val}</span>
                </div>
              ))}
            </div>

            {/* Recent Events */}
            <div style={{
              background: C.bgCard, border: `1px solid ${C.border}`,
              borderRadius: C.CARD_RADIUS, padding: C.CARD_PAD, flex: 1, overflowY: 'auto',
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.text3, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
                Recent Events
              </div>
              {recentEvents.length === 0 ? (
                <div style={{ fontSize: 12, color: C.text3, padding: '8px 0' }}>No events yet</div>
              ) : (
                recentEvents.map((e, i) => <EventRow key={i} entry={e} />)
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function OverviewSkeleton() {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, flexShrink: 0 }}>
        {[1,2,3,4].map(i => (
          <div key={i} style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: C.CARD_RADIUS, padding: C.CARD_PAD }}>
            <Skeleton width={80} height={11} style={{ marginBottom: 10 }} />
            <Skeleton width={60} height={28} style={{ marginBottom: 6 }} />
            <Skeleton width={100} height={11} />
          </div>
        ))}
      </div>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '65fr 35fr', gap: 14, minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {[1,2,3].map(i => (
              <div key={i} style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: C.CARD_RADIUS, padding: C.CARD_PAD }}>
                <Skeleton width="100%" height={160} />
              </div>
            ))}
          </div>
          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: C.CARD_RADIUS, padding: C.CARD_PAD }}>
            <Skeleton width="100%" height={80} />
          </div>
          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: C.CARD_RADIUS, padding: C.CARD_PAD, flex: 1 }}>
            <Skeleton width="100%" height={100} />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: C.CARD_RADIUS, padding: C.CARD_PAD }}>
            <Skeleton width="100%" height={160} />
          </div>
          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: C.CARD_RADIUS, padding: C.CARD_PAD, flex: 1 }}>
            <Skeleton width="100%" height="80%" />
          </div>
        </div>
      </div>
    </div>
  );
}