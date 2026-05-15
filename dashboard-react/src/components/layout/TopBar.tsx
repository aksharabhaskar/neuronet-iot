import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { C } from '../../theme';
import type { View } from '../../types';

const TABS: { id: View; label: string }[] = [
  { id: 'overview',      label: 'Overview' },
  { id: 'charts',        label: 'Charts' },
  { id: 'ml-metrics',   label: 'ML Metrics' },
  { id: 'event-log',    label: 'Event Log' },
  { id: 'network-twin', label: 'Network Twin' },
];

type Status = 'checking' | 'ok' | 'error';

interface TopBarProps {
  view: View;
  onNavigate: (v: View) => void;
}

export default function TopBar({ view, onNavigate }: TopBarProps) {
  const [apiStatus, setApiStatus] = useState<Status>('checking');
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const check = () =>
      fetch('/api/nodes')
        .then(r => setApiStatus(r.ok ? 'ok' : 'error'))
        .catch(() => setApiStatus('error'));
    check();
    const id = setInterval(check, 15000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const dotColor = apiStatus === 'ok' ? C.green : apiStatus === 'error' ? C.red : C.amber;

  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 20, height: 52,
      background: C.bgBase, borderBottom: `1px solid ${C.border}`,
      display: 'flex', alignItems: 'stretch', justifyContent: 'space-between',
      padding: '0 28px', flexShrink: 0,
    }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 0 }}>
        {TABS.map(tab => {
          const active = tab.id === view;
          return (
            <button
              key={tab.id}
              onClick={() => onNavigate(tab.id)}
              style={{
                position: 'relative', padding: '0 16px',
                border: 'none', background: 'transparent',
                color: active ? C.text1 : C.text3,
                fontSize: 13, fontWeight: active ? 600 : 400,
                cursor: 'pointer', fontFamily: 'inherit',
                transition: 'color 0.15s',
                display: 'flex', alignItems: 'center',
              }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.color = C.text2; }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.color = C.text3; }}
            >
              {tab.label}
              {active && (
                <span style={{
                  position: 'absolute', bottom: 0, left: 16, right: 16,
                  height: 2, background: C.amber, borderRadius: '2px 2px 0 0',
                }} />
              )}
            </button>
          );
        })}
      </div>

      {/* Right: search + status + clock */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <button style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 30, height: 30, borderRadius: 8,
          border: `1px solid ${C.border}`, background: 'transparent',
          color: C.text3, cursor: 'pointer',
          transition: 'border-color 0.15s, color 0.15s',
        }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = C.text3; (e.currentTarget as HTMLButtonElement).style.color = C.text2; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = C.border; (e.currentTarget as HTMLButtonElement).style.color = C.text3; }}
        >
          <Search size={13} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor }} />
          <span style={{ fontSize: 11, color: C.text3 }}>API</span>
        </div>

        <span className="mono" style={{ fontSize: 11, color: C.text3 }}>
          {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
      </div>
    </div>
  );
}