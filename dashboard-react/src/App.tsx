import { useState, useEffect } from 'react';
import Sidebar from './components/layout/Sidebar';
import TopBar from './components/layout/TopBar';
import Overview from './components/views/Overview';
import Charts from './components/views/Charts';
import MLMetricsView from './components/views/MLMetrics';
import EventLog from './components/views/EventLog';
import NetworkTwin from './components/views/NetworkTwin';
import type { View } from './types';
import { C } from './theme';

export default function App() {
  const [view, setView] = useState<View>('overview');
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const update = () => setCollapsed(window.innerWidth < 900);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: C.bgBase }}>
      <Sidebar active={view} onNavigate={setView} collapsed={collapsed} />
      <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <TopBar view={view} onNavigate={setView} />
        <div
          key={view}
          className="fade-in"
          style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '24px 28px' }}
        >
          {view === 'overview'      && <Overview />}
          {view === 'charts'        && <Charts />}
          {view === 'ml-metrics'    && <MLMetricsView />}
          {view === 'event-log'     && <EventLog />}
          {view === 'network-twin'  && <NetworkTwin />}
        </div>
      </main>
    </div>
  );
}