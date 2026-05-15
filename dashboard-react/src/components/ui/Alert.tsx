import { AlertTriangle, RefreshCw } from 'lucide-react';
import { C } from '../../theme';

interface AlertProps {
  message: string;
  detail?: string;
  onRetry?: () => void;
}

export function Alert({ message, detail, onRetry }: AlertProps) {
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      padding: '10px 14px',
      borderRadius: 8,
      background: C.redDim,
      border: `1px solid rgba(239,68,68,0.18)`,
      maxWidth: '100%',
    }}>
      <AlertTriangle size={14} color={C.red} style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: C.redLight }}>{message}</span>
        {detail && <span style={{ fontSize: 11, color: C.text3, marginLeft: 6 }}>{detail}</span>}
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '3px 8px', borderRadius: 5,
            border: `1px solid rgba(239,68,68,0.25)`,
            background: 'transparent',
            color: C.redLight,
            fontSize: 11, fontWeight: 500,
            cursor: 'pointer', flexShrink: 0,
            fontFamily: 'inherit',
          }}
        >
          <RefreshCw size={10} />
          Retry
        </button>
      )}
    </div>
  );
}
