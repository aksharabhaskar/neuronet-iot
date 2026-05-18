import { useEffect, useState, useCallback, useRef } from 'react';
import { api, NODES as NODE_IDS } from '../../api';
import type { LogEntry } from '../../types';
import { C } from '../../theme';
import { Alert } from '../ui/Alert';
import { Skeleton } from '../ui/Skeleton';

const NODES    = ['All', ...NODE_IDS];
const PER_PAGE = 50;
const NODE_COLORS: Record<string, string> = { N1: C.amber, N2: C.teal, N3: C.muted };

function bool(v: boolean | string | undefined) {
  return typeof v === 'boolean' ? v : String(v).toLowerCase() === 'true';
}

function statusColor(congested: boolean, detected: boolean) {
  if (congested) return C.red;
  if (detected)  return C.amber;
  return C.teal;
}

/* ─── Status pill ────────────────────────────────────────────────── */
function StatusPill({ congested, detected }: { congested: boolean; detected: boolean }) {
  const col  = statusColor(congested, detected);
  const dim  = congested ? C.redDim : detected ? C.amberDim : C.tealDim;
  const text = congested ? 'CONGESTED' : detected ? 'DETECTED' : 'NORMAL';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 10, fontWeight: 600, color: col,
      background: dim, padding: '2px 7px', borderRadius: 4,
      letterSpacing: '0.05em',
    }}>
      <span style={{ width: 4, height: 4, borderRadius: '50%', background: col, flexShrink: 0 }} />
      {text}
    </span>
  );
}

/* ─── Filter pill ────────────────────────────────────────────────── */
function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 12px', borderRadius: 6,
        border: `1px solid ${active ? C.amber : C.border}`,
        background: active ? C.amberDim : 'transparent',
        color: active ? C.amber : C.text3,
        fontSize: 12, fontWeight: active ? 600 : 400,
        cursor: 'pointer', transition: 'all 0.12s', fontFamily: 'inherit',
      }}
      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.borderColor = C.text3; }}
      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.borderColor = C.border; }}
    >{label}</button>
  );
}

/* ─── Page button ────────────────────────────────────────────────── */
function PageBtn({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick} disabled={disabled}
      style={{
        padding: '4px 12px', borderRadius: 6,
        border: `1px solid ${C.border}`,
        background: 'transparent',
        color: disabled ? C.text3 : C.text2,
        fontSize: 11, cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1, fontFamily: 'inherit',
        transition: 'opacity 0.12s',
      }}
    >{label}</button>
  );
}

/* ─── CSV Export ─────────────────────────────────────────────────── */
function CSVExportButton({ entries }: { entries: LogEntry[] }) {
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      // Try /api/logs/export first (server-side full export)
      const res = await fetch('/api/logs/export');
      if (res.ok) {
        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `neuronet-logs-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        // Fallback: export current page as CSV
        exportPageAsCSV(entries);
      }
    } catch {
      exportPageAsCSV(entries);
    } finally {
      setExporting(false);
    }
  };

  function exportPageAsCSV(rows: LogEntry[]) {
    const headers = ['timestamp', 'node_id', 'ir_value', 'detected', 'congestion',
      'network_delay_s', 'avg_delay_s', 'ml_risk', 'risk_label', 'battery_pct', 'action', 'routing'];
    const lines = [
      headers.join(','),
      ...rows.map(r => [
        new Date(r.wall_time * 1000).toISOString(),
        r.node_id, r.ir_value,
        bool(r.detected), bool(r.congestion),
        r.network_delay_s ?? '',
        r.avg_delay_s ?? '',
        r.ml_risk ?? '',
        r.risk_label ?? '',
        r.battery_pct ?? '',
        `"${r.action}"`, `"${r.routing}"`,
      ].join(',')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `neuronet-page-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      onClick={handleExport} disabled={exporting || entries.length === 0}
      style={{
        padding: '6px 14px', borderRadius: 7,
        border: `1px solid ${C.teal}`,
        background: C.tealDim, color: C.teal,
        fontSize: 12, fontWeight: 600,
        cursor: exporting ? 'wait' : 'pointer',
        opacity: entries.length === 0 ? 0.4 : 1,
        fontFamily: 'inherit', transition: 'all 0.15s',
        display: 'flex', alignItems: 'center', gap: 5,
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,201,167,0.22)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = C.tealDim; }}
    >
      {exporting ? '⏳' : '↓'} {exporting ? 'Exporting…' : 'Export CSV'}
    </button>
  );
}

/* ─── Notification toggle ────────────────────────────────────────── */
function NotificationToggle() {
  const [enabled,  setEnabled]  = useState(false);
  const [perm,     setPerm]     = useState<NotificationPermission>('default');

  useEffect(() => {
    if ('Notification' in window) {
      setPerm(Notification.permission);
      setEnabled(Notification.permission === 'granted');
    }
  }, []);

  const toggle = async () => {
    if (!('Notification' in window)) return;
    if (perm === 'denied') return;
    if (!enabled) {
      const result = await Notification.requestPermission();
      setPerm(result);
      setEnabled(result === 'granted');
    } else {
      setEnabled(false);
    }
  };

  const denied  = perm === 'denied';
  const col     = enabled ? C.teal : denied ? C.text3 : C.text3;

  return (
    <div
      title={denied ? 'Notifications blocked — allow in browser settings' : enabled ? 'Disable HIGH RISK alerts' : 'Enable HIGH RISK browser notifications'}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 12px', borderRadius: 7,
        border: `1px solid ${enabled ? C.teal : C.border}`,
        background: enabled ? C.tealDim : 'transparent',
        cursor: denied ? 'not-allowed' : 'pointer',
        opacity: denied ? 0.4 : 1,
        transition: 'all 0.15s',
      }}
      onClick={toggle}
    >
      <span style={{ fontSize: 13 }}>{enabled ? '🔔' : '🔕'}</span>
      <span style={{ fontSize: 12, fontWeight: enabled ? 600 : 400, color: col }}>
        {denied ? 'Blocked' : enabled ? 'Alerts ON' : 'Alerts OFF'}
      </span>
    </div>
  );
}

/* ─── Live event feed ────────────────────────────────────────────── */
function EventFeed({ entries }: { entries: LogEntry[] }) {
  const recent = entries.slice(0, 12);
  if (!recent.length) {
    return <div style={{ fontSize: 12, color: C.text3, textAlign: 'center', padding: '20px 0' }}>No events yet</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {recent.map((entry, i) => {
        const detected  = bool(entry.detected);
        const congested = bool(entry.congestion);
        const col = statusColor(congested, detected);
        const ts  = new Date(entry.wall_time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        return (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '9px 0',
            borderBottom: i < recent.length - 1 ? `1px solid ${C.borderSub}` : 'none',
          }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: col, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.text1 }}>Node {entry.node_id}</div>
              <div className="mono" style={{ fontSize: 10, color: C.text3, marginTop: 1 }}>{ts}</div>
            </div>
            <span style={{ fontSize: 10, fontWeight: 600, color: col }}>
              {congested ? 'CONG' : detected ? 'DET' : 'OK'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Table skeleton ─────────────────────────────────────────────── */
function TableSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} style={{
          display: 'flex', gap: 16, padding: '12px 14px',
          background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
        }}>
          {[70, 30, 40, 70, 60, 60, 70, 40, 40, 140, 90].map((w, j) => (
            <Skeleton key={j} width={w} height={12} />
          ))}
        </div>
      ))}
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
  return (
    <th style={{
      padding: '10px 12px', fontSize: 10, fontWeight: 600, color: C.text3,
      textAlign: align, borderBottom: `1px solid ${C.border}`,
      letterSpacing: '0.07em', textTransform: 'uppercase', whiteSpace: 'nowrap',
      background: C.bgCard,
    }}>{children}</th>
  );
}

function Td({ children, align = 'left', mono = false, muted = false }: {
  children: React.ReactNode; align?: 'left' | 'right' | 'center'; mono?: boolean; muted?: boolean;
}) {
  return (
    <td className={mono ? 'mono' : ''} style={{
      padding: '9px 12px', fontSize: 12,
      color: muted ? C.text3 : C.text2,
      textAlign: align,
      borderBottom: `1px solid ${C.borderSub}`,
      whiteSpace: 'nowrap',
    }}>{children}</td>
  );
}

/* ─── EventLog ───────────────────────────────────────────────────── */
export default function EventLog() {
  const [entries, setEntries]   = useState<LogEntry[]>([]);
  const [total, setTotal]       = useState(0);
  const [page, setPage]         = useState(1);
  const [nodeFilter, setFilter] = useState('All');
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const prevHighRiskRef         = useRef<Set<string>>(new Set());

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const node = nodeFilter === 'All' ? undefined : nodeFilter;
      const res  = await api.logs(page, PER_PAGE, node);
      setEntries(res.data);
      setTotal(res.total);
      setError(null);

      // Browser notifications for HIGH RISK rows (new since last fetch)
      if ('Notification' in window && Notification.permission === 'granted') {
        const highRiskRows = res.data.filter(e => e.risk_label === 'HIGH RISK' || (e.ml_risk ?? 0) >= 0.70);
        highRiskRows.forEach(e => {
          const key = `${e.node_id}-${e.wall_time}`;
          if (!prevHighRiskRef.current.has(key)) {
            prevHighRiskRef.current.add(key);
            new Notification(`NeuroNet — HIGH RISK: Node ${e.node_id}`, {
              body: `ML risk ${((e.ml_risk ?? 0) * 100).toFixed(0)}% · avg delay ${(e.avg_delay_s * 1000).toFixed(1)} ms`,
              icon: '/favicon.ico',
            });
          }
        });
        // Prune old keys
        if (prevHighRiskRef.current.size > 200) {
          prevHighRiskRef.current = new Set([...prevHighRiskRef.current].slice(-100));
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [page, nodeFilter]);

  useEffect(() => { fetch_(); }, [fetch_]);
  useEffect(() => { setPage(1); }, [nodeFilter]);

  const totalPages = Math.ceil(total / PER_PAGE);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '65fr 35fr', gap: 20 }}>

      {/* LEFT: table */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: C.text1, lineHeight: 1.2 }}>Event Log</h1>
            <p style={{ fontSize: 11, color: C.text3, marginTop: 4 }}>
              {total.toLocaleString()} records &nbsp;·&nbsp; data/logs.csv
            </p>
          </div>
          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <NotificationToggle />
            <CSVExportButton entries={entries} />
            <button
              onClick={fetch_} disabled={loading}
              style={{
                padding: '6px 14px', borderRadius: 7,
                border: `1px solid ${C.border}`,
                background: 'transparent', color: C.text2,
                fontSize: 12, fontWeight: 500,
                cursor: loading ? 'wait' : 'pointer',
                opacity: loading ? 0.5 : 1, fontFamily: 'inherit',
                transition: 'opacity 0.12s',
              }}
            >{loading ? 'Loading…' : '↻ Refresh'}</button>
          </div>
        </div>

        {error && <Alert message="Unable to load event log" detail={error} onRetry={fetch_} />}

        {/* Filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: C.text3, marginRight: 4 }}>Node:</span>
          {NODES.map(n => (
            <FilterPill key={n} label={n} active={nodeFilter === n} onClick={() => setFilter(n)} />
          ))}
        </div>

        {/* Table */}
        <div style={{
          background: C.bgCard, border: `1px solid ${C.border}`,
          borderRadius: C.CARD_RADIUS, overflow: 'hidden',
        }}>
          <div style={{ overflowX: 'auto' }}>
            {loading ? (
              <TableSkeleton />
            ) : entries.length === 0 ? (
              <div style={{ padding: '60px 24px', textAlign: 'center' }}>
                <div style={{ fontSize: 24, marginBottom: 8 }}>◎</div>
                <div style={{ fontSize: 13, color: C.text3 }}>No entries match this filter</div>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
                <thead>
                  <tr>
                    <Th>Time</Th>
                    <Th>Node</Th>
                    <Th align="right">IR Val</Th>
                    <Th align="center">Status</Th>
                    <Th align="right">Net Delay</Th>
                    <Th align="right">Avg Delay</Th>
                    <Th align="right">ML Risk</Th>
                    <Th align="right">Battery</Th>
                    <Th>Action</Th>
                    <Th>Route</Th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((row, i) => {
                    const detected  = bool(row.detected);
                    const congested = bool(row.congestion);
                    const delayMs   = row.network_delay_s != null ? (Number(row.network_delay_s) * 1000).toFixed(1) : '—';
                    const avgMs     = row.avg_delay_s != null ? (row.avg_delay_s * 1000).toFixed(1) : null;
                    const riskPct   = row.ml_risk != null ? (row.ml_risk * 100) : null;
                    const risk      = riskPct != null ? `${riskPct.toFixed(0)}%` : '—';
                    const riskCol   = riskPct != null ? (riskPct >= 70 ? C.red : riskPct >= 40 ? C.amber : C.teal) : C.text3;
                    const ts        = new Date(row.wall_time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    const isHighRisk = (row.ml_risk ?? 0) >= 0.70;
                    return (
                      <tr key={i} className="log-row" style={{
                        background: isHighRisk ? 'rgba(239,68,68,0.04)' : undefined,
                      }}>
                        <Td muted mono>{ts}</Td>
                        <Td>
                          <span style={{ fontSize: 12, fontWeight: 600, color: NODE_COLORS[row.node_id] ?? C.amber }}>{row.node_id}</span>
                        </Td>
                        <Td align="right" mono>{row.ir_value}</Td>
                        <Td align="center">
                          <StatusPill congested={congested} detected={detected} />
                        </Td>
                        <Td align="right" mono muted>{delayMs}</Td>
                        <Td align="right" mono>{avgMs != null ? `${avgMs} ms` : '—'}</Td>
                        <Td align="right" mono>
                          <span style={{ color: riskCol, fontWeight: isHighRisk ? 700 : 400 }}>{risk}</span>
                        </Td>
                        <Td align="right" mono muted>{row.battery_pct?.toFixed(0) ?? '—'}%</Td>
                        <Td>
                          <span style={{ fontSize: 11, color: C.text3, lineHeight: 1.3 }}>{row.action}</span>
                        </Td>
                        <Td muted>{row.routing}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 14px', borderTop: `1px solid ${C.border}`,
            }}>
              <span style={{ fontSize: 11, color: C.text3 }}>
                Page {page} of {totalPages} &nbsp;·&nbsp; {total.toLocaleString()} total
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <PageBtn label="← Prev" disabled={page === 1}         onClick={() => setPage(p => p - 1)} />
                <PageBtn label="Next →" disabled={page === totalPages} onClick={() => setPage(p => p + 1)} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: live feed + summary */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{
          background: C.bgCard, border: `1px solid ${C.border}`,
          borderRadius: C.CARD_RADIUS, padding: C.CARD_PAD,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: C.text3, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Live Feed
            </span>
            <div style={{ display: 'flex', gap: 10 }}>
              {[{ col: C.teal, label: 'OK' }, { col: C.amber, label: 'DET' }, { col: C.red, label: 'CONG' }].map(({ col, label }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: col }} />
                  <span style={{ fontSize: 9, color: C.text3 }}>{label}</span>
                </div>
              ))}
            </div>
          </div>
          <EventFeed entries={entries} />
        </div>

        {/* Summary card */}
        {entries.length > 0 && (() => {
          const congestPct = (entries.filter(e => bool(e.congestion)).length / entries.length * 100).toFixed(1);
          const detectPct  = (entries.filter(e => bool(e.detected)).length  / entries.length * 100).toFixed(1);
          const highRiskPct = (entries.filter(e => (e.ml_risk ?? 0) >= 0.70).length / entries.length * 100).toFixed(1);
          const validDelay = entries.filter(e => e.avg_delay_s != null);
          const avgDelay   = validDelay.length
            ? (validDelay.reduce((s, e) => s + (e.avg_delay_s ?? 0), 0) / validDelay.length * 1000).toFixed(1)
            : '—';
          return (
            <div style={{
              background: C.bgCard, border: `1px solid ${C.border}`,
              borderRadius: C.CARD_RADIUS, padding: C.CARD_PAD,
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.text3, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>
                Page Summary
              </div>
              {[
                { label: 'Congested rows', val: `${congestPct}%`,   col: parseFloat(congestPct)  > 20 ? C.red   : C.teal },
                { label: 'Detection rows', val: `${detectPct}%`,    col: parseFloat(detectPct)   > 0  ? C.amber : C.text3 },
                { label: 'HIGH RISK rows', val: `${highRiskPct}%`,  col: parseFloat(highRiskPct) > 5  ? C.red   : C.teal },
                { label: 'Avg delay',      val: avgDelay !== '—' ? `${avgDelay} ms` : '—', col: avgDelay === '—' ? C.text3 : parseFloat(avgDelay) < 30 ? C.teal : parseFloat(avgDelay) < 80 ? C.amber : C.red },
                { label: 'Rows shown',     val: String(entries.length), col: C.text2 },
              ].map(({ label, val, col }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${C.borderSub}` }}>
                  <span style={{ fontSize: 12, color: C.text3 }}>{label}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: col }}>{val}</span>
                </div>
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
}