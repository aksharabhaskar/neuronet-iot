import { useEffect, useState, useCallback } from 'react';
import {
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { api, NODES } from '../../api';
import type { NodeState } from '../../types';
import { C } from '../../theme';
import { Alert } from '../ui/Alert';
import { Skeleton } from '../ui/Skeleton';

const POLL_MS = 10000;
const NODE_COLORS: Record<string, string> = { N1: C.amber, N2: C.teal, N3: C.muted };

function bool(v: boolean | string | undefined) {
  return typeof v === 'boolean' ? v : String(v).toLowerCase() === 'true';
}

const TOOLTIP_STYLE = {
  contentStyle: {
    background: '#111118',
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    fontSize: 11,
    boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
    padding: '8px 12px',
  },
  labelStyle:  { color: C.text3, marginBottom: 6, fontSize: 10 },
  itemStyle:   { color: C.text1, padding: '1px 0' },
  cursor:      { stroke: 'rgba(255,255,255,0.06)', strokeWidth: 1 },
};

/* ─── Segmented control ─────────────────────────────────────────── */
function Segmented({ options, value, onChange, colors }: {
  options: string[]; value: string;
  onChange: (v: string) => void;
  colors?: Record<string, string>;
}) {
  return (
    <div style={{
      display: 'inline-flex', background: C.bgElevated,
      borderRadius: 8, padding: 3, gap: 2,
    }}>
      {options.map(opt => {
        const active = opt === value;
        const col    = colors?.[opt] ?? C.amber;
        return (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            style={{
              padding: '4px 14px', borderRadius: 6, border: 'none',
              background: active ? C.bgCard : 'transparent',
              color: active ? col : C.text3,
              fontSize: 12, fontWeight: active ? 600 : 400,
              cursor: 'pointer', fontFamily: 'inherit',
              transition: 'all 0.12s',
              boxShadow: active ? '0 1px 4px rgba(0,0,0,0.4)' : 'none',
            }}
            onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.color = C.text2; }}
            onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.color = C.text3; }}
          >{opt}</button>
        );
      })}
    </div>
  );
}

/* ─── Chart card ────────────────────────────────────────────────── */
function ChartCard({ title, right, children }: {
  title: string; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div style={{
      background: C.bgCard, border: `1px solid ${C.border}`,
      borderRadius: C.CARD_RADIUS, padding: C.CARD_PAD,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.text1 }}>{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

/* ─── Mini histogram ────────────────────────────────────────────── */
function MiniHistogram({ values, color, label }: { values: (number | null)[]; color: string; label: string }) {
  const max = Math.max(...values.map(v => v ?? 0), 0.001);
  return (
    <div>
      <div style={{ fontSize: 11, color: C.text3, marginBottom: 8 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 56 }}>
        {values.map((v, i) => (
          <div key={i} style={{
            flex: 1, minWidth: 3,
            height: v != null && v > 0 ? `${Math.max(4, (v / max) * 100)}%` : '4%',
            background: v != null && v > 0 ? color : C.bgElevated,
            borderRadius: '2px 2px 0 0',
            opacity: 0.4 + (i / values.length) * 0.6,
            transition: 'height 0.3s ease',
          }} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        <span style={{ fontSize: 9, color: C.text3 }}>oldest</span>
        <span style={{ fontSize: 9, color: C.text3 }}>latest</span>
      </div>
    </div>
  );
}

/* ─── IR Detection Timeline ─────────────────────────────────────── */
function IRTimeline({ allData }: { allData: Record<string, any[]> }) {
  return (
    <div>
      {NODES.map(nid => {
        const rows = allData[nid] ?? [];
        if (!rows.length) return null;
        return (
          <div key={nid} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: NODE_COLORS[nid], width: 22, flexShrink: 0 }}>{nid}</span>
            <div style={{
              flex: 1, height: 20, borderRadius: 4,
              background: C.bgElevated,
              display: 'flex', overflow: 'hidden',
              position: 'relative',
            }}>
              {rows.map((r, i) => {
                const detected = r.det_n === 1;
                const widthPct = (1 / rows.length) * 100;
                return (
                  <div
                    key={i}
                    title={`${nid} @ ${r._t}: ${detected ? 'DETECTED' : 'no object'} · delay ${r.delay_ms ?? '—'} ms`}
                    style={{
                      width: `${widthPct}%`,
                      height: '100%',
                      background: detected
                        ? `${NODE_COLORS[nid]}cc`
                        : 'transparent',
                      borderRight: detected ? 'none' : undefined,
                      flexShrink: 0,
                      cursor: 'default',
                    }}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
      <div style={{ display: 'flex', gap: 12, marginTop: 6, justifyContent: 'flex-end' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 12, height: 8, borderRadius: 2, background: C.amber, opacity: 0.8 }} />
          <span style={{ fontSize: 10, color: C.text3 }}>IR Detected</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 12, height: 8, borderRadius: 2, background: C.bgElevated }} />
          <span style={{ fontSize: 10, color: C.text3 }}>Clear</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Threshold Sliders ─────────────────────────────────────────── */
function ThresholdPanel() {
  const [congestionThreshold, setCT] = useState(80);   // ms
  const [congestionClear,     setCC] = useState(50);   // ms
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [loadErr, setLoadErr] = useState(false);

  useEffect(() => {
    api.config()
      .then(cfg => {
        setCT(Math.round(cfg.congestion_threshold * 1000));
        setCC(Math.round(cfg.congestion_clear * 1000));
      })
      .catch(() => setLoadErr(true));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.setConfig({
        congestion_threshold: congestionThreshold / 1000,
        congestion_clear:     congestionClear / 1000,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* silently fail if backend not updated yet */ }
    finally { setSaving(false); }
  };

  function SliderRow({ label, value, min, max, onChange, color }: {
    label: string; value: number; min: number; max: number;
    onChange: (v: number) => void; color: string;
  }) {
    return (
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: C.text3 }}>{label}</span>
          <span style={{ fontSize: 12, fontWeight: 600, color }}>{value} ms</span>
        </div>
        <input
          type="range" min={min} max={max} value={value}
          onChange={e => onChange(Number(e.target.value))}
          style={{ width: '100%', accentColor: color, cursor: 'pointer' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
          <span style={{ fontSize: 9, color: C.text3 }}>{min}ms</span>
          <span style={{ fontSize: 9, color: C.text3 }}>{max}ms</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      {loadErr && (
        <div style={{ fontSize: 11, color: C.text3, marginBottom: 10 }}>
          ⚠ /api/config not available — changes are preview only
        </div>
      )}
      <SliderRow
        label="Congestion Threshold (mark congested above)"
        value={congestionThreshold} min={20} max={500}
        onChange={v => setCT(Math.max(v, congestionClear + 5))}
        color={C.red}
      />
      <SliderRow
        label="Congestion Clear (clear congestion below)"
        value={congestionClear} min={10} max={200}
        onChange={v => setCC(Math.min(v, congestionThreshold - 5))}
        color={C.teal}
      />
      <div style={{ fontSize: 10, color: C.text3, marginBottom: 12 }}>
        Hysteresis gap: {congestionThreshold - congestionClear} ms
      </div>
      <button
        onClick={handleSave} disabled={saving}
        style={{
          padding: '7px 16px', borderRadius: 7,
          border: `1px solid ${saved ? C.teal : C.amber}`,
          background: saved ? C.tealDim : C.amberDim,
          color: saved ? C.teal : C.amber,
          fontSize: 12, fontWeight: 600,
          cursor: saving ? 'wait' : 'pointer',
          fontFamily: 'inherit', transition: 'all 0.2s',
        }}
      >
        {saving ? 'Saving…' : saved ? '✓ Saved' : 'Apply Thresholds'}
      </button>
    </div>
  );
}

/* ─── Merge arrays ──────────────────────────────────────────────── */
interface Row {
  _t: string;
  N1_delay: number | null; N2_delay: number | null; N3_delay: number | null;
  N1_risk:  number | null; N2_risk:  number | null; N3_risk:  number | null;
  N1_cong:  number;        N2_cong:  number;        N3_cong:  number;
  N1_det:   number;        N2_det:   number;        N3_det:   number;
  N1_bat:   number | null; N2_bat:   number | null; N3_bat:   number | null;
}

function mergeData(allData: Record<string, any[]>): Row[] {
  const maxLen = Math.max(...NODES.map(n => allData[n]?.length ?? 0), 0);
  if (maxLen === 0) return [];
  return Array.from({ length: maxLen }, (_, i) => {
    const row: any = { _t: '' };
    NODES.forEach(nid => {
      const item = allData[nid]?.[i];
      row[`${nid}_delay`] = item?.delay_ms ?? null;
      row[`${nid}_risk`]  = item?.risk_pct ?? null;
      row[`${nid}_cong`]  = item?.cong_n   ?? 0;
      row[`${nid}_det`]   = item?.det_n    ?? 0;
      row[`${nid}_bat`]   = item?.battery  ?? null;
      if (item?._t) row._t = item._t;
    });
    return row as Row;
  });
}

/* ─── Charts view ───────────────────────────────────────────────── */
export default function Charts() {
  const [allData, setAllData]     = useState<Record<string, any[]>>({});
  const [selectedNode, setNode]   = useState<string>('N1');
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [lastUpdated, setLast]    = useState<Date | null>(null);

  const fetch_ = useCallback(async () => {
    try {
      const results = await Promise.all(NODES.map(n => api.history(n)));
      const map: Record<string, any[]> = {};
      NODES.forEach((n, i) => {
        map[n] = results[i].slice(-60).map((row: NodeState) => ({
          _t:       new Date(row.wall_time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          delay_ms: row.avg_delay_s != null ? parseFloat((row.avg_delay_s * 1000).toFixed(2)) : null,
          risk_pct: parseFloat(((row.ml_risk ?? 0) * 100).toFixed(1)),
          cong_n:   bool(row.congestion) ? 1 : 0,
          det_n:    bool(row.detected)   ? 1 : 0,
          net_ms:   row.network_delay_s != null ? parseFloat((row.network_delay_s * 1000).toFixed(2)) : null,
          battery:  row.battery_pct != null ? parseFloat(row.battery_pct.toFixed(1)) : null,
        }));
      });
      setAllData(map);
      setLast(new Date());
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

  const merged       = mergeData(allData);
  const selData      = allData[selectedNode] ?? [];
  const histValues   = selData.map(r => r.net_ms as number | null);
  const nodeColor    = NODE_COLORS[selectedNode] ?? C.amber;

  const axisProps = {
    tick:     { fontSize: 10, fill: C.text3 },
    tickLine: false as const,
    axisLine: false as const,
  };
  const gridProps = {
    strokeDasharray: '0',
    stroke:          'rgba(255,255,255,0.05)',
    vertical:        false as const,
  };

  const legend = (
    <div style={{ display: 'flex', gap: 14 }}>
      {NODES.map(n => (
        <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 16, height: 2, background: NODE_COLORS[n], borderRadius: 1 }} />
          <span style={{ fontSize: 11, color: C.text3 }}>Node {n}</span>
        </div>
      ))}
    </div>
  );

  if (loading) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '65fr 35fr', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {[1,2,3,4,5].map(i => (
            <div key={i} style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: C.CARD_RADIUS, padding: C.CARD_PAD }}>
              <Skeleton width={140} height={14} style={{ marginBottom: 20 }} />
              <Skeleton width="100%" height={180} radius={8} />
            </div>
          ))}
        </div>
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: C.CARD_RADIUS, padding: C.CARD_PAD }}>
          <Skeleton width="100%" height={400} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '65fr 35fr', gap: 20 }}>

      {/* LEFT: charts */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error && <Alert message="Unable to fetch chart data" detail={error} onRetry={fetch_} />}

        {/* Network delay */}
        <ChartCard title="Network Delay" right={legend}>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={merged} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="_t" {...axisProps} interval="preserveStartEnd" />
              <YAxis {...axisProps} unit=" ms" width={52} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v, name) => [`${v} ms`, String(name).replace('_delay', '')]} />
              {NODES.map(n => (
                <Line
                  key={n} type="monotone" dataKey={`${n}_delay`}
                  stroke={NODE_COLORS[n]} strokeWidth={1.5}
                  dot={false} connectNulls isAnimationActive={false}
                  activeDot={{ r: 3, fill: NODE_COLORS[n], stroke: C.bgCard, strokeWidth: 2 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* ML Risk */}
        <ChartCard title="ML Congestion Risk">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={merged} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="_t" {...axisProps} interval="preserveStartEnd" />
              <YAxis {...axisProps} unit="%" domain={[0, 100]} width={42} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v, name) => [`${v}%`, String(name).replace('_risk', '')]} />
              {/* Risk threshold lines */}
              <ReferenceLine y={70} stroke={C.red}   strokeDasharray="3 3" strokeOpacity={0.5} label={{ value: 'HIGH', fontSize: 9, fill: C.red,   position: 'right' }} />
              <ReferenceLine y={40} stroke={C.amber} strokeDasharray="3 3" strokeOpacity={0.5} label={{ value: 'MED',  fontSize: 9, fill: C.amber, position: 'right' }} />
              {NODES.map(n => (
                <Line
                  key={n} type="monotone" dataKey={`${n}_risk`}
                  stroke={NODE_COLORS[n]} strokeWidth={1.5}
                  dot={false} connectNulls isAnimationActive={false}
                  activeDot={{ r: 3, fill: NODE_COLORS[n], stroke: C.bgCard, strokeWidth: 2 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Battery trend — NEW */}
        <ChartCard title="Battery Trend" right={legend}>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={merged} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="_t" {...axisProps} interval="preserveStartEnd" />
              <YAxis {...axisProps} unit="%" domain={[0, 100]} width={42} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v, name) => [`${v}%`, String(name).replace('_bat', '')]} />
              <ReferenceLine y={40} stroke={C.amber} strokeDasharray="3 3" strokeOpacity={0.4}
                label={{ value: 'LOW', fontSize: 9, fill: C.amber, position: 'right' }} />
              <ReferenceLine y={20} stroke={C.red}   strokeDasharray="3 3" strokeOpacity={0.4}
                label={{ value: 'CRIT', fontSize: 9, fill: C.red, position: 'right' }} />
              {NODES.map(n => (
                <Line
                  key={n} type="monotone" dataKey={`${n}_bat`}
                  stroke={NODE_COLORS[n]} strokeWidth={1.5}
                  dot={false} connectNulls isAnimationActive={false}
                  activeDot={{ r: 3, fill: NODE_COLORS[n], stroke: C.bgCard, strokeWidth: 2 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* IR Detection Timeline — NEW */}
        <ChartCard title="IR Detection Timeline">
          <div style={{ fontSize: 11, color: C.text3, marginBottom: 14 }}>
            Each bar = one packet interval. Coloured = object detected.
          </div>
          <IRTimeline allData={allData} />
        </ChartCard>

        {/* Event area stream */}
        <ChartCard title="Congestion &amp; IR Event Stream">
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={merged} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="_t" {...axisProps} interval="preserveStartEnd" />
              <YAxis {...axisProps} domain={[0, 1.5]} width={30} tick={false} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v, name) => [v === 1 ? 'Yes' : 'No', String(name).replace(/_\w+/, '') + (String(name).includes('cong') ? ' Congested' : ' Detected')]} />
              {NODES.map(n => (
                <Area key={`${n}_c`} type="stepAfter" dataKey={`${n}_cong`}
                  stroke={C.teal} strokeWidth={1} fill={C.teal} fillOpacity={0.18}
                  dot={false} isAnimationActive={false} />
              ))}
              {NODES.map(n => (
                <Area key={`${n}_d`} type="stepAfter" dataKey={`${n}_det`}
                  stroke={C.amber} strokeWidth={1} fill={C.amber} fillOpacity={0.25}
                  dot={false} isAnimationActive={false} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* RIGHT: node detail + threshold panel */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{
          background: C.bgCard, border: `1px solid ${C.border}`,
          borderRadius: C.CARD_RADIUS, padding: C.CARD_PAD,
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.text3, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>
            Node Detail
          </div>
          <Segmented options={[...NODES]} value={selectedNode} onChange={setNode} colors={NODE_COLORS} />
        </div>

        {/* Node stats */}
        {(() => {
          const last = selData[selData.length - 1];
          return (
            <div style={{
              background: C.bgCard, border: `1px solid ${C.border}`,
              borderRadius: C.CARD_RADIUS, padding: C.CARD_PAD,
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.text3, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>
                Latest — Node {selectedNode}
              </div>
              {last ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {[
                    { label: 'Avg Delay',  val: last.delay_ms != null ? `${last.delay_ms} ms` : '—', col: nodeColor },
                    { label: 'Net Delay',  val: last.net_ms   != null ? `${last.net_ms} ms`   : '—', col: C.text1 },
                    { label: 'ML Risk',    val: `${last.risk_pct}%`, col: last.risk_pct > 70 ? C.red : last.risk_pct > 40 ? C.amber : C.teal },
                    { label: 'Battery',    val: last.battery  != null ? `${last.battery}%`    : '—', col: last.battery < 40 ? C.amber : C.text2 },
                    { label: 'Congested',  val: last.cong_n ? 'Yes' : 'No', col: last.cong_n ? C.red : C.teal },
                    { label: 'Detected',   val: last.det_n  ? 'Yes' : 'No', col: last.det_n  ? C.amber : C.text3 },
                    { label: 'Readings',   val: String(selData.length), col: C.text2 },
                  ].map(({ label, val, col }) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 12, color: C.text3 }}>{label}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: col }}>{val}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: C.text3, textAlign: 'center', padding: '20px 0' }}>
                  No data for Node {selectedNode}
                </div>
              )}
            </div>
          );
        })()}

        {/* Mini histogram */}
        <div style={{
          background: C.bgCard, border: `1px solid ${C.border}`,
          borderRadius: C.CARD_RADIUS, padding: C.CARD_PAD,
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.text3, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>
            Delay Spikes — {selectedNode}
          </div>
          <MiniHistogram values={histValues.slice(-30)} color={nodeColor} label="network_delay_s (last 30 packets)" />
        </div>

        {/* Threshold sliders — NEW */}
        <div style={{
          background: C.bgCard, border: `1px solid ${C.border}`,
          borderRadius: C.CARD_RADIUS, padding: C.CARD_PAD,
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.text3, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 16 }}>
            Threshold Override
          </div>
          <ThresholdPanel />
        </div>

        {lastUpdated && (
          <div style={{ fontSize: 11, color: C.text3, textAlign: 'center' }}>
            Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            &nbsp;· refreshes every {POLL_MS / 1000}s
          </div>
        )}
      </div>
    </div>
  );
}