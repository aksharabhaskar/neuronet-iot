import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, ReferenceLine,
} from 'recharts';
import { api, NODES } from '../../api';
import type { MLMetrics, NodeState } from '../../types';
import { C } from '../../theme';
import { Alert } from '../ui/Alert';
import { Skeleton } from '../ui/Skeleton';

const TOOLTIP_STYLE = {
  contentStyle: {
    background: '#111118', border: `1px solid ${C.border}`,
    borderRadius: 8, fontSize: 11,
    boxShadow: '0 4px 24px rgba(0,0,0,0.5)', padding: '8px 12px',
  },
  labelStyle:  { color: C.text3, marginBottom: 4, fontSize: 10 },
  itemStyle:   { color: C.text1 },
  cursor:      { stroke: 'rgba(255,255,255,0.05)', strokeWidth: 1 },
};

const axisProps = {
  tick:     { fontSize: 10, fill: C.text3 },
  tickLine: false as const,
  axisLine: false as const,
};

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: C.bgCard, border: `1px solid ${C.border}`,
      borderRadius: C.CARD_RADIUS, padding: C.CARD_PAD, ...style,
    }}>{children}</div>
  );
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 600, color: C.text1, marginBottom: 18 }}>{children}</div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <Card>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.text3, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>{label}</div>
      <div className="mono" style={{ fontSize: 26, fontWeight: 700, color: color ?? C.text1, lineHeight: 1, letterSpacing: '-0.5px', marginBottom: 6 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.text3 }}>{sub}</div>}
    </Card>
  );
}

function ConfusionMatrix({ matrix }: { matrix: number[][] }) {
  const labels = ['Normal', 'Congested'];
  const total  = matrix.flat().reduce((a, b) => a + b, 0);
  const max    = Math.max(...matrix.flat(), 1);

  return (
    <div>
      <div style={{ fontSize: 10, color: C.text3, marginBottom: 12, letterSpacing: '0.04em' }}>
        Rows = Actual &nbsp;·&nbsp; Columns = Predicted
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr', gap: 6 }}>
        <div />
        {labels.map(l => (
          <div key={l} style={{ fontSize: 11, color: C.text3, textAlign: 'center', paddingBottom: 4, fontWeight: 500 }}>{l}</div>
        ))}
        {matrix.map((row, ri) => [
          <div key={`L${ri}`} style={{
            fontSize: 11, color: C.text3, display: 'flex',
            alignItems: 'center', fontWeight: 500, justifyContent: 'flex-end', paddingRight: 10,
          }}>{labels[ri]}</div>,
          ...row.map((val, ci) => {
            const isDiag    = ri === ci;
            const intensity = val / max;
            const bg = isDiag
              ? `rgba(0,201,167,${0.08 + intensity * 0.42})`
              : `rgba(239,68,68,${intensity * 0.3})`;
            const textColor = isDiag ? C.teal : C.red;
            return (
              <div key={`${ri}-${ci}`} style={{
                background: bg,
                border: `1px solid ${isDiag ? 'rgba(245,166,35,0.2)' : 'rgba(239,68,68,0.15)'}`,
                borderRadius: 8, padding: '14px 8px', textAlign: 'center',
              }}>
                <div className="mono" style={{ fontSize: 20, fontWeight: 700, color: textColor }}>{val.toLocaleString()}</div>
                <div style={{ fontSize: 10, color: C.text3, marginTop: 3 }}>{(val / total * 100).toFixed(1)}%</div>
              </div>
            );
          }),
        ])}
      </div>
    </div>
  );
}

/* ─── Prediction vs Actual panel ────────────────────────────────── */
function PredVsActual() {
  const [pvData, setPvData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState('N1');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.history(selectedNode)
      .then(rows => {
        if (cancelled) return;
        // For each packet: ml_risk is forward prediction; congestion is actual state
        // A "correct HIGH" = ml_risk >= 0.70 AND subsequent packets show congestion
        // We can approximate by checking if congestion was true within ±3 packets
        const data = rows.slice(-80).map((row: NodeState, i: number, arr: NodeState[]) => {
          const risk      = (row.ml_risk ?? 0) * 100;
          const predicted = risk >= 70 ? 'HIGH' : risk >= 40 ? 'MED' : 'LOW';
          // Actual: look at next 10 packets avg delay to see if congestion materialised
          const futureSlice = arr.slice(i, i + 10);
          const futureAvg   = futureSlice.length
            ? futureSlice.reduce((s, r) => s + (r.avg_delay_s ?? 0), 0) / futureSlice.length * 1000
            : null;
          const actualCongested = futureAvg != null && futureAvg > 80;
          const match = (predicted === 'HIGH' || predicted === 'MED') === actualCongested;

          return {
            i,
            risk,
            actual_delay: futureAvg != null ? parseFloat(futureAvg.toFixed(1)) : null,
            predicted,
            actualCongested,
            match,
            _t: new Date(row.wall_time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          };
        });
        setPvData(data);
      })
      .catch(() => {/* silently degrade */})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedNode]);

  const total    = pvData.length;
  const correct  = pvData.filter(d => d.match).length;
  const accuracy = total > 0 ? ((correct / total) * 100).toFixed(1) : '—';
  const falsePos = pvData.filter(d => (d.predicted === 'HIGH' || d.predicted === 'MED') && !d.actualCongested).length;
  const falseNeg = pvData.filter(d =>  d.predicted === 'LOW' && d.actualCongested).length;

  const NODE_COLORS: Record<string, string> = { N1: C.amber, N2: C.teal, N3: C.muted };

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <CardTitle>Prediction vs Actual</CardTitle>
        <div style={{ display: 'inline-flex', background: C.bgElevated, borderRadius: 8, padding: 3, gap: 2 }}>
          {NODES.map(n => {
            const active = n === selectedNode;
            return (
              <button key={n} onClick={() => setSelectedNode(n)} style={{
                padding: '4px 12px', borderRadius: 6, border: 'none',
                background: active ? C.bgCard : 'transparent',
                color: active ? NODE_COLORS[n] : C.text3,
                fontSize: 12, fontWeight: active ? 600 : 400,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>{n}</button>
            );
          })}
        </div>
      </div>

      {/* Summary row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Live Accuracy',  val: `${accuracy}%`, col: parseFloat(accuracy) >= 90 ? C.teal : C.amber },
          { label: 'Correct',        val: String(correct),   col: C.teal },
          { label: 'False Positives', val: String(falsePos),  col: C.amber },
          { label: 'False Negatives', val: String(falseNeg),  col: C.red },
        ].map(({ label, val, col }) => (
          <div key={label} style={{
            background: C.bgElevated, borderRadius: 8, padding: '10px 12px',
            display: 'flex', flexDirection: 'column', gap: 4,
          }}>
            <span style={{ fontSize: 10, color: C.text3, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</span>
            <span className="mono" style={{ fontSize: 18, fontWeight: 700, color: col }}>{val}</span>
          </div>
        ))}
      </div>

      {loading ? (
        <Skeleton width="100%" height={200} />
      ) : pvData.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '32px 0', color: C.text3, fontSize: 12 }}>No history data available</div>
      ) : (
        <>
          {/* Overlay chart: ML risk line + actual congestion fill */}
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={pvData} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="0" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="_t" {...axisProps} interval="preserveStartEnd" />
              <YAxis {...axisProps} domain={[0, 100]} unit="%" width={42} />
              <Tooltip
                {...TOOLTIP_STYLE}
                formatter={(v, name) => [
                  name === 'risk' ? `${v}%` : v === 100 ? 'Congested' : 'Normal',
                  name === 'risk' ? 'ML Risk' : 'Actual',
                ]}
              />
              <ReferenceLine y={70} stroke={C.red}   strokeDasharray="3 3" strokeOpacity={0.5} />
              <ReferenceLine y={40} stroke={C.amber} strokeDasharray="3 3" strokeOpacity={0.4} />
              {/* Actual congestion as a filled region (mapped to 0 or 85) */}
              <Line
                type="stepAfter" dataKey={(d: any) => d.actualCongested ? 85 : 0}
                stroke={C.red} strokeWidth={0}
                dot={false} isAnimationActive={false}
                fill={C.red} fillOpacity={0.1}
              />
              <Line
                type="monotone" dataKey="risk"
                stroke={NODE_COLORS[selectedNode]} strokeWidth={2}
                dot={false} isAnimationActive={false}
                activeDot={{ r: 4, fill: NODE_COLORS[selectedNode], stroke: C.bgCard, strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>

          {/* Match/mismatch strip */}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 10, color: C.text3, marginBottom: 6 }}>Prediction accuracy per packet (green = correct, red = wrong)</div>
            <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', gap: 1 }}>
              {pvData.map((d, i) => (
                <div key={i} style={{
                  flex: 1,
                  background: d.match ? C.teal : C.red,
                  opacity: 0.7,
                }} />
              ))}
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

/* ─── MLMetrics view ────────────────────────────────────────────── */
export default function MLMetricsView() {
  const [metrics, setMetrics] = useState<MLMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const fetch_ = () => {
    setLoading(true);
    api.metrics()
      .then(m => { setMetrics(m); setError(null); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(fetch_, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {[1,2,3,4].map(i => (
            <div key={i} style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: C.CARD_RADIUS, padding: C.CARD_PAD }}>
              <Skeleton width={90} height={11} style={{ marginBottom: 10 }} />
              <Skeleton width={60} height={28} style={{ marginBottom: 6 }} />
              <Skeleton width={120} height={11} />
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: C.CARD_RADIUS, padding: C.CARD_PAD }}>
            <Skeleton width="100%" height={240} />
          </div>
          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: C.CARD_RADIUS, padding: C.CARD_PAD }}>
            <Skeleton width="100%" height={240} />
          </div>
        </div>
      </div>
    );
  }

  if (error || !metrics) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: C.text1 }}>ML Model Metrics</h1>
        <Alert message="Unable to load ML metrics" detail={error ?? undefined} onRetry={fetch_} />
      </div>
    );
  }

  const featureData = metrics.feature_names
    .map((name, i) => ({ name, importance: parseFloat((metrics.feature_importance[i] * 100).toFixed(1)) }))
    .sort((a, b) => b.importance - a.importance);

  const rocData = metrics.roc_fpr.map((fpr, i) => ({
    fpr: parseFloat(fpr.toFixed(3)),
    tpr: parseFloat((metrics.roc_tpr[i] ?? 0).toFixed(3)),
  }));

  const total = metrics.train_size + metrics.val_size + metrics.test_size;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Header */}
      <div>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: C.text1, lineHeight: 1.2 }}>ML Model Metrics</h1>
        <p style={{ fontSize: 12, color: C.text3, marginTop: 5 }}>
          {metrics.model_type} &nbsp;·&nbsp; {metrics.n_estimators} estimators &nbsp;·&nbsp;
          window {metrics.window_size ?? '—'} &nbsp;·&nbsp; threshold {metrics.threshold}s
        </p>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <StatCard label="Test Accuracy" value={`${(metrics.test_accuracy * 100).toFixed(2)}%`} sub="held-out test set" color={C.teal} />
        <StatCard label="Test AUC"      value={metrics.test_auc.toFixed(4)} sub="ROC area under curve" color={C.amber} />
        <StatCard label="CV F1 Mean"    value={`${(metrics.cv_f1_mean * 100).toFixed(2)}%`} sub={`± ${(metrics.cv_f1_std * 100).toFixed(2)}% std`} color={C.amber} />
        <StatCard label="Total Samples" value={total.toLocaleString()} sub={`${metrics.train_size.toLocaleString()} train / ${metrics.test_size.toLocaleString()} test`} />
      </div>

      {/* Feature importance + Confusion matrix */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Card>
          <CardTitle>Feature Importance</CardTitle>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={featureData} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="0" stroke="rgba(255,255,255,0.05)" horizontal={false} />
              <XAxis type="number" {...axisProps} unit="%" />
              <YAxis type="category" dataKey="name" {...axisProps} width={80} tick={{ fontSize: 11, fill: C.text2 }} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v) => [`${v}%`, 'Importance']} />
              <Bar dataKey="importance" fill={C.teal} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <CardTitle>Confusion Matrix</CardTitle>
          <ConfusionMatrix matrix={metrics.confusion_matrix} />
        </Card>
      </div>

      {/* Prediction vs Actual — NEW */}
      <PredVsActual />

      {/* ROC curve */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.text1 }}>ROC Curve</span>
          <span style={{
            fontSize: 11, fontWeight: 600, color: C.amber,
            background: C.amberDim, padding: '2px 8px', borderRadius: 4,
          }}>
            AUC = {metrics.test_auc.toFixed(4)}
          </span>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={rocData} margin={{ top: 4, right: 8, bottom: 24, left: 0 }}>
            <CartesianGrid strokeDasharray="0" stroke="rgba(255,255,255,0.05)" />
            <XAxis
              dataKey="fpr" {...axisProps}
              label={{ value: 'False Positive Rate', position: 'insideBottom', offset: -14, style: { fontSize: 11, fill: C.text3 } }}
            />
            <YAxis
              {...axisProps} domain={[0, 1]}
              label={{ value: 'True Positive Rate', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: C.text3 } }}
            />
            <Tooltip {...TOOLTIP_STYLE} formatter={(v, name) => [Number(v ?? 0).toFixed(3), name === 'tpr' ? 'TPR' : 'FPR']} />
            <Line
              type="monotone" dataKey="tpr" stroke={C.amber} strokeWidth={2.5}
              dot={false} activeDot={{ r: 4, fill: C.amber, stroke: C.bgCard, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {/* Classification report */}
      <Card>
        <CardTitle>Classification Report</CardTitle>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Class', 'Precision', 'Recall', 'F1 Score', 'Support'].map(h => (
                <th key={h} style={{
                  padding: '8px 12px',
                  textAlign: h === 'Class' ? 'left' : 'right',
                  fontSize: 10, fontWeight: 600, color: C.text3,
                  borderBottom: `1px solid ${C.border}`,
                  letterSpacing: '0.06em', textTransform: 'uppercase',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(['Normal', 'Congested'] as const).map((cls, i) => {
              const row = metrics.classification_report[cls];
              return (
                <tr key={cls} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                  <td style={{ padding: '11px 12px', color: C.text1, fontWeight: 600, borderBottom: `1px solid ${C.borderSub}` }}>{cls}</td>
                  <td className="mono" style={{ padding: '11px 12px', textAlign: 'right', color: C.text2, borderBottom: `1px solid ${C.borderSub}` }}>{(row.precision * 100).toFixed(2)}%</td>
                  <td className="mono" style={{ padding: '11px 12px', textAlign: 'right', color: C.text2, borderBottom: `1px solid ${C.borderSub}` }}>{(row.recall * 100).toFixed(2)}%</td>
                  <td className="mono" style={{ padding: '11px 12px', textAlign: 'right', color: C.amber, fontWeight: 600, borderBottom: `1px solid ${C.borderSub}` }}>{(row['f1-score'] * 100).toFixed(2)}%</td>
                  <td className="mono" style={{ padding: '11px 12px', textAlign: 'right', color: C.text3, borderBottom: `1px solid ${C.borderSub}` }}>{row.support.toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}