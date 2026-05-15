import { C } from '../../theme';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  radius?: number;
  style?: React.CSSProperties;
}

export function Skeleton({ width = '100%', height = 14, radius = 6, style }: SkeletonProps) {
  return (
    <div className="shimmer" style={{ width, height, borderRadius: radius, flexShrink: 0, ...style }} />
  );
}

function CardShell({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: C.bgCard, border: `1px solid ${C.border}`,
      borderRadius: C.CARD_RADIUS, padding: C.CARD_PAD,
      display: 'flex', flexDirection: 'column', gap: 14,
      ...style,
    }}>
      {children}
    </div>
  );
}

export function SkeletonNodeCard() {
  return (
    <CardShell>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Skeleton width={8} height={8} radius={99} />
          <Skeleton width={70} height={14} />
        </div>
        <Skeleton width={52} height={18} radius={4} />
      </div>
      <Skeleton width="100%" height={32} radius={4} />
      {[1, 2, 3, 4].map(i => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Skeleton width={60} height={11} />
          <Skeleton width={80} height={11} />
        </div>
      ))}
    </CardShell>
  );
}

export function SkeletonStatCard() {
  return (
    <CardShell>
      <Skeleton width={90} height={11} />
      <Skeleton width={60} height={28} />
      <Skeleton width={110} height={11} />
    </CardShell>
  );
}

export function SkeletonChart() {
  return (
    <CardShell>
      <Skeleton width={140} height={14} />
      <Skeleton width="100%" height={200} radius={8} />
    </CardShell>
  );
}
