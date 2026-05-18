import { useEffect, useState, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';
import { api, NODES } from '../../api';
import type { Explanation, ExplainResponse, LogEntry } from '../../types';
import { C } from '../../theme';
import { Skeleton } from '../ui/Skeleton';

const POLL_MS = 2000;
const NODE_COLORS: Record<string, string> = { N1: C.amber, N2: C.teal, N3: C.muted };

function RiskBadge({ label, risk }: { label: string; risk: number }) {
  const col = label === 'HIGH' ? C.red : label === 'MEDIUM' ? C.amber : C.teal;
  const bg  = label === 'HIGH' ? C.redDim : label === 'MEDIUM' ? C.amberDim : C.tealDim;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ fontSize: 40, fontWeight: 700, color: col, lineHeight: 1, letterSpacing: '-2px' }}>
        {Math.round(risk * 100)}%
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color: col, background: bg, padding: '3px 8px', borderRadius: 4 }}>
        {label} RISK
      </span>
    </div>
  );
}

function ShapChart({ contributions }: { contributions: Explanation['contributions'] }) {
  const data = contributions.map(c => ({ name: c.feature, value: c.shap_value }));
  return (
    <ResponsiveContainer width="100%" height={contributions.length * 32 + 24}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 80 }}>
        <XAxis
          type="number"
          tick={{ fontSize: 9, fill: C.text3 }} tickLine={false} axisLine={false}
          tickFormatter={v => (v as number).toFixed(3)}
        />
        <YAxis
          type="category" dataKey="name"
          tick={{ fontSize: 11, fill: C.text2 }} tickLine={false} axisLine={false} width={80}
        />
        <ReferenceLine x={0} stroke={C.border} />
        <Tooltip
          contentStyle={{ background: '#111118', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11, padding: '6px 10px' }}
          formatter={(v: number) => [(v as number).toFixed(5), 'SHAP value']}
        />
        <Bar dataKey="value" radius={[0, 3, 3, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.value >= 0 ? C.red : C.teal} fillOpacity={0.85} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function LogTable({ entries }: { entries: LogEntry[] }) {
  if (!entries.length) {
    return <div style={{ fontSize: 12, color: C.text3, padding: '8px 0' }}>No log entries yet.</div>;
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr>
            {['Time', 'Rationale', 'Route'].map(h => (
              <th key={h} style={{
                textAlign: 'left', padding: '4px 8px', color: C.text3, fontWeight: 600,
                borderBottom: `1px solid ${C.border}`, letterSpacing: '0.06em',
                fontSize: 10, textTransform: 'uppercase',
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${C.borderSub}` }}>
              <td style={{ padding: '5px 8px', color: C.text3, whiteSpace: 'nowrap' }}>
                {new Date(e.wall_time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </td>
              <td style={{ padding: '5px 8px', color: C.text2, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {e.ml_rationale || '—'}
              </td>
              <td style={{ padding: '5px 8px', color: C.teal, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                {e.routing_path ? e.routing_path.split('->').join(' → ') : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NodeExplainCard({ nodeId, explanation, logs }: {
  nodeId: string; explanation: Explanation | undefined; logs: LogEntry[];
}) {
  const color = NODE_COLORS[nodeId] ?? C.amber;
  return (
    <div style={{
      background: C.bgCard, border: `1px solid ${C.border}`,
      borderRadius: C.CARD_RADIUS, padding: C.CARD_PAD,
      display: 'flex', flexDirection: 'column', gap: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}` }} />
        <span style={{ fontSize: 14, fontWeight: 700, color: C.text1 }}>Node {nodeId}</span>
        <span style={{ fontSize: 10, color: C.text3, marginLeft: 'auto' }}>SHAP · Random Forest</span>
      </div>

      {!explanation ? (
        <div style={{ fontSize: 12, color: C.text3 }}>Waiting for predictions…</div>
      ) : (
        <>
          <RiskBadge label={explanation.risk_label} risk={explanation.risk} />

          {explanation.contributions.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: C.text3, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
                Feature Contributions
              </div>
              <ShapChart contributions={explanation.contributions} />
              <div style={{ display: 'flex', gap: 12, marginTop: 6, justifyContent: 'flex-end' }}>
                {[{ col: C.red, label: 'Increases risk' }, { col: C.teal, label: 'Decreases risk' }].map(({ col, label }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: col, opacity: 0.8 }} />
                    <span style={{ fontSize: 10, color: C.text3 }}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div style={{ fontSize: 10, color: C.text3, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
              Why?
            </div>
            <div style={{
              background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`,
              borderLeft: `3px solid ${C.amber}`,
              borderRadius: 6, padding: '10px 14px',
              fontSize: 12, color: C.text2, lineHeight: 1.6,
            }}>
              {explanation.rationale || '—'}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 10, color: C.text3, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
              Recent Decisions
            </div>
            <LogTable entries={logs} />
          </div>
        </>
      )}
    </div>
  );
}

export default function Explainability() {
  const [explanations, setExplanations] = useState<ExplainResponse>({});
  const [nodeLogs,     setNodeLogs]     = useState<Record<string, LogEntry[]>>({});
  const [loading,      setLoading]      = useState(true);

  const fetch_ = useCallback(async () => {
    try {
      const [expl, ...logsArr] = await Promise.all([
        api.explain(),
        ...NODES.map(n => api.logs(1, 10, n).then(r => r.data)),
      ]);
      setExplanations(expl);
      const lm: Record<string, LogEntry[]> = {};
      NODES.forEach((n, i) => { lm[n] = logsArr[i]; });
      setNodeLogs(lm);
    } catch { /* degrade */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetch_();
    const id = setInterval(fetch_, POLL_MS);
    return () => clearInterval(id);
  }, [fetch_]);

  if (loading) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {NODES.map(n => (
          <div key={n} style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: C.CARD_RADIUS, padding: C.CARD_PAD }}>
            <Skeleton width="100%" height={320} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
      {NODES.map(n => (
        <NodeExplainCard key={n} nodeId={n} explanation={explanations[n]} logs={nodeLogs[n] ?? []} />
      ))}
    </div>
  );
}
