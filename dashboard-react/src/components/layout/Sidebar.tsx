import { LayoutDashboard, BarChart2, Activity, FileText, Network, Lightbulb } from 'lucide-react';
import { NODES } from '../../api';
import { C } from '../../theme';
import type { View } from '../../types';

const API_HOST = import.meta.env.VITE_API_HOST ?? 'localhost:5000';

const NAV: { id: View; label: string; Icon: React.FC<{ size?: number; color?: string }> }[] = [
  { id: 'overview',      label: 'OVERVIEW',      Icon: LayoutDashboard },
  { id: 'charts',        label: 'CHARTS',        Icon: BarChart2 },
  { id: 'ml-metrics',   label: 'ML METRICS',    Icon: Activity },
  { id: 'event-log',    label: 'EVENT LOG',     Icon: FileText },
  { id: 'network-twin',   label: 'NETWORK TWIN', Icon: Network },
  { id: 'explainability', label: 'WHY?',         Icon: Lightbulb },
];

function GeoIcon() {
  return (
    <svg width={28} height={28} viewBox="0 0 28 28" fill="none">
      <rect width={28} height={28} rx={6} fill={C.bgElevated} />
      <polygon
        points="14,4 24,9 24,19 14,24 4,19 4,9"
        fill="none"
        stroke={C.amber}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <circle cx={14} cy={14} r={2.5} fill={C.amber} />
    </svg>
  );
}

interface SidebarProps {
  active: View;
  onNavigate: (v: View) => void;
  collapsed: boolean;
}

export default function Sidebar({ active, onNavigate, collapsed }: SidebarProps) {
  const w = collapsed ? 64 : 240;

  return (
    <aside style={{
      width: w, minWidth: w, height: '100vh',
      background: '#0d0d14', borderRight: `1px solid ${C.border}`,
      display: 'flex', flexDirection: 'column',
      position: 'sticky', top: 0,
      transition: 'width 0.2s ease, min-width 0.2s ease',
      overflow: 'hidden', flexShrink: 0,
    }}>

      {/* Logo */}
      <div style={{
        height: 52, display: 'flex', alignItems: 'center',
        padding: collapsed ? '0 18px' : '0 16px',
        borderBottom: `1px solid ${C.border}`, gap: 10, flexShrink: 0,
      }}>
        <div style={{ flexShrink: 0 }}><GeoIcon /></div>
        {!collapsed && (
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text1, lineHeight: 1, letterSpacing: '-0.3px', whiteSpace: 'nowrap' }}>
              NeuroNet
            </div>
            <div style={{ fontSize: 9, color: C.text3, letterSpacing: '0.12em', marginTop: 3, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
              IoT Platform
            </div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV.map(({ id, label, Icon }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              title={collapsed ? label : undefined}
              style={{
                position: 'relative', display: 'flex', alignItems: 'center', gap: 10,
                height: 40, padding: collapsed ? '0 10px' : '0 12px',
                justifyContent: collapsed ? 'center' : 'flex-start',
                borderRadius: 8, border: 'none', cursor: 'pointer',
                background: isActive ? C.bgActiveNav : 'transparent',
                color: isActive ? C.amber : C.text3,
                width: '100%', textAlign: 'left', fontFamily: 'inherit',
                transition: 'background 0.12s, color 0.12s',
              }}
              onMouseEnter={e => {
                if (!isActive) {
                  (e.currentTarget as HTMLButtonElement).style.background = C.bgHover;
                  (e.currentTarget as HTMLButtonElement).style.color = C.text2;
                }
              }}
              onMouseLeave={e => {
                if (!isActive) {
                  (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                  (e.currentTarget as HTMLButtonElement).style.color = C.text3;
                }
              }}
            >
              {isActive && (
                <span style={{
                  position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)',
                  width: 2, height: 20, borderRadius: '0 2px 2px 0', background: C.amber,
                }} />
              )}
              <Icon size={15} color={isActive ? C.amber : undefined} />
              {!collapsed && (
                <span style={{ fontSize: 11, fontWeight: isActive ? 600 : 500, letterSpacing: '0.07em', whiteSpace: 'nowrap' }}>
                  {label}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      {!collapsed && (
        <div style={{ padding: '12px 16px 16px', borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{ fontSize: 10, color: C.text3, marginBottom: 10, letterSpacing: '0.04em' }}>v1.0.0</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: C.green, flexShrink: 0 }} />
              <span style={{ fontSize: 10, color: C.text3 }}>API</span>
              <span style={{ fontSize: 10, color: C.text3, marginLeft: 'auto', opacity: 0.6 }}>{API_HOST}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: C.green, flexShrink: 0 }} />
              <span style={{ fontSize: 10, color: C.text3 }}>SERIAL</span>
              <span style={{ fontSize: 10, color: C.text3, marginLeft: 'auto', opacity: 0.6 }}>USB</span>
            </div>
          </div>
          <div style={{ marginTop: 10, fontSize: 10, color: C.text3 }}>{NODES.join(' · ')}</div>
        </div>
      )}
    </aside>
  );
}