/**
 * NetworkTwin.tsx
 * Digital Twin + Control Engine view.
 *
 * Shows:
 *  - D3 force-directed graph of N1/N2/N3 and an edge hub,
 *    node colour driven by congestion state and ML risk.
 *  - Animated data-flow particles along edges when a node is active.
 *  - Per-node latency and state panel.
 *  - Control Engine routing decision panel (SHORTEST PATH / LOW-CONGESTION PATH).
 *  - Live refresh every 4 s from /api/twin and /api/nodes.
 *
 * Imports: d3 (already in package.json), react, api, types, theme.
 * Place at: dashboard-react/src/components/views/NetworkTwin.tsx
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { api, NODES } from '../../api';
import type { TwinNode, NodeState } from '../../types';
import { C } from '../../theme';
import { Alert } from '../ui/Alert';
import { Skeleton } from '../ui/Skeleton';

const POLL_MS = 4000;
const NODE_COLORS: Record<string, string> = { N1: C.amber, N2: C.teal, N3: C.muted };

function bool(v: boolean | string | undefined): boolean {
  if (typeof v === 'boolean') return v;
  return String(v).toLowerCase() === 'true';
}

/* ── Types ──────────────────────────────────────────────────────── */
interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  isHub: boolean;
  latency: number;      // ms
  state: 'normal' | 'congested';
  mlRisk: number;       // 0–1
  routing: string;
  battery: number;
  detected: boolean;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
  congested: boolean;
  latency: number;
}

/* ── Utility ────────────────────────────────────────────────────── */
function nodeColor(n: GraphNode): string {
  if (n.isHub) return C.text3;
  if (n.state === 'congested') return C.red;
  if (n.mlRisk >= 0.70) return C.red;
  if (n.mlRisk >= 0.40) return C.amber;
  return NODE_COLORS[n.id] ?? C.teal;
}

function riskLabel(r: number): string {
  if (r >= 0.70) return 'HIGH';
  if (r >= 0.40) return 'MED';
  return 'LOW';
}

function riskColor(r: number): string {
  if (r >= 0.70) return C.red;
  if (r >= 0.40) return C.amber;
  return C.teal;
}

/* ── D3 Graph ───────────────────────────────────────────────────── */
function TwinGraph({
  graphNodes,
  graphLinks,
  width,
  height,
}: {
  graphNodes: GraphNode[];
  graphLinks: GraphLink[];
  width: number;
  height: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);

  useEffect(() => {
    if (!svgRef.current || !width || !height) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    /* ── Defs: arrowhead + glow filter ── */
    const defs = svg.append('defs');

    defs.append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -4 8 8')
      .attr('refX', 26)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-4L8,0L0,4')
      .attr('fill', C.border);

    ['red', 'amber', 'teal'].forEach((name) => {
      const f = defs.append('filter').attr('id', `glow-${name}`).attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
      f.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'blur');
      const merge = f.append('feMerge');
      merge.append('feMergeNode').attr('in', 'blur');
      merge.append('feMergeNode').attr('in', 'SourceGraphic');
    });

    /* ── Simulation ── */
    const nodes: GraphNode[] = graphNodes.map(n => ({ ...n }));
    const links: GraphLink[] = graphLinks.map(l => ({ ...l }));

    // Pin the hub to center
    const hub = nodes.find(n => n.isHub);
    if (hub) { hub.fx = width / 2; hub.fy = height / 2; }

    const sim = d3.forceSimulation<GraphNode>(nodes)
      .force('link',   d3.forceLink<GraphNode, GraphLink>(links).id(d => d.id).distance(130).strength(0.6))
      .force('charge', d3.forceManyBody().strength(-320))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide(50));

    simRef.current = sim;

    /* ── Edges ── */
    const linkG = svg.append('g').attr('class', 'links');

    const linkLine = linkG.selectAll('line')
      .data(links)
      .enter()
      .append('line')
      .attr('stroke', (d: GraphLink) => d.congested ? C.red : C.border)
      .attr('stroke-width', (d: GraphLink) => d.congested ? 2 : 1)
      .attr('stroke-dasharray', (d: GraphLink) => d.congested ? '6 3' : 'none')
      .attr('stroke-opacity', 0.7)
      .attr('marker-end', 'url(#arrow)');

    /* ── Edge latency labels ── */
    const linkLabel = linkG.selectAll('text')
      .data(links)
      .enter()
      .append('text')
      .attr('fill', C.text3)
      .attr('font-size', 9)
      .attr('text-anchor', 'middle')
      .attr('dy', -5)
      .text((d: GraphLink) => d.latency > 0 ? `${d.latency.toFixed(0)}ms` : '');

    /* ── Particle group (data-flow dots) ── */
    const particleG = svg.append('g').attr('class', 'particles');

    /* ── Nodes ── */
    const nodeG = svg.append('g').attr('class', 'nodes');

    const nodeGroup = nodeG.selectAll('g')
      .data(nodes)
      .enter()
      .append('g')
      .attr('cursor', 'pointer')
      .call(
        d3.drag<SVGGElement, GraphNode>()
          .on('start', (event, d) => {
            if (!event.active) sim.alphaTarget(0.3).restart();
            d.fx = d.x; d.fy = d.y;
          })
          .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
          .on('end', (event, d) => {
            if (!event.active) sim.alphaTarget(0);
            if (!d.isHub) { d.fx = null; d.fy = null; }
          })
      );

    // Outer pulse ring (for active non-hub nodes)
    nodeGroup.filter((d: GraphNode) => !d.isHub)
      .append('circle')
      .attr('r', (d: GraphNode) => d.state === 'congested' ? 30 : 24)
      .attr('fill', 'none')
      .attr('stroke', (d: GraphNode) => nodeColor(d))
      .attr('stroke-width', 1)
      .attr('stroke-opacity', 0.25)
      .attr('class', 'pulse-outer');

    // Main circle
    nodeGroup.append('circle')
      .attr('r', (d: GraphNode) => d.isHub ? 14 : 20)
      .attr('fill', (d: GraphNode) => d.isHub ? C.bgElevated : `${nodeColor(d)}22`)
      .attr('stroke', (d: GraphNode) => nodeColor(d))
      .attr('stroke-width', (d: GraphNode) => d.isHub ? 1.5 : 2)
      .attr('filter', (d: GraphNode) => {
        if (d.isHub) return 'none';
        if (d.state === 'congested' || d.mlRisk >= 0.70) return 'url(#glow-red)';
        if (d.mlRisk >= 0.40) return 'url(#glow-amber)';
        return 'url(#glow-teal)';
      });

    // Node ID label
    nodeGroup.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', (d: GraphNode) => d.isHub ? '0.35em' : '-0.1em')
      .attr('fill', (d: GraphNode) => d.isHub ? C.text3 : nodeColor(d))
      .attr('font-size', (d: GraphNode) => d.isHub ? 10 : 13)
      .attr('font-weight', 700)
      .text((d: GraphNode) => d.isHub ? 'HUB' : d.id);

    // Risk label below node ID
    nodeGroup.filter((d: GraphNode) => !d.isHub)
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '1.1em')
      .attr('fill', C.text3)
      .attr('font-size', 9)
      .text((d: GraphNode) => riskLabel(d.mlRisk));

    // Latency below risk
    nodeGroup.filter((d: GraphNode) => !d.isHub)
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '2.3em')
      .attr('fill', C.text3)
      .attr('font-size', 8)
      .attr('class', 'lat-label')
      .text((d: GraphNode) => `${d.latency.toFixed(0)}ms`);

    /* ── Tick ── */
    sim.on('tick', () => {
      linkLine
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      linkLabel
        .attr('x', (d: any) => (d.source.x + d.target.x) / 2)
        .attr('y', (d: any) => (d.source.y + d.target.y) / 2);

      nodeGroup.attr('transform', (d: GraphNode) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    /* ── Animated particles ── */
    function spawnParticles() {
      links.forEach((link: any) => {
        if (Math.random() > 0.4) return;
        const src = link.source as GraphNode;
        const tgt = link.target as GraphNode;
        if (!src.x || !tgt.x) return;

        const particle = particleG.append('circle')
          .attr('r', link.congested ? 3 : 2)
          .attr('fill', link.congested ? C.red : C.teal)
          .attr('opacity', 0.8)
          .attr('cx', src.x ?? 0)
          .attr('cy', src.y ?? 0);

        particle.transition()
          .duration(900 + Math.random() * 600)
          .ease(d3.easeCubicInOut)
          .attr('cx', tgt.x ?? 0)
          .attr('cy', tgt.y ?? 0)
          .attr('opacity', 0)
          .remove();
      });
    }

    const particleInterval = setInterval(spawnParticles, 500);

    return () => {
      sim.stop();
      clearInterval(particleInterval);
    };
  }, [graphNodes, graphLinks, width, height]);

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      style={{ display: 'block', borderRadius: C.CARD_RADIUS }}
    />
  );
}

/* ── Routing Decision Card ──────────────────────────────────────── */
function RoutingPanel({ nodes }: { nodes: NodeState[] }) {
  return (
    <div style={{
      background: C.bgCard, border: `1px solid ${C.border}`,
      borderRadius: C.CARD_RADIUS, padding: C.CARD_PAD,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.text3, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>
        Control Engine — Routing Decisions
      </div>

      {nodes.length === 0 ? (
        <div style={{ fontSize: 12, color: C.text3 }}>No node data</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {nodes.map(n => {
            const isLowCong = n.routing?.includes('LOW');
            const congested = bool(n.congestion);
            const risk      = (n.ml_risk ?? 0) * 100;
            return (
              <div key={n.node_id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px', borderRadius: 8,
                background: congested ? 'rgba(239,68,68,0.05)' : C.bgElevated,
                border: `1px solid ${congested ? 'rgba(239,68,68,0.15)' : C.border}`,
              }}>
                {/* Node badge */}
                <span style={{
                  fontSize: 11, fontWeight: 700,
                  color: NODE_COLORS[n.node_id] ?? C.amber,
                  width: 26, flexShrink: 0,
                }}>{n.node_id}</span>

                {/* Routing path */}
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {/* Path visualisation */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: NODE_COLORS[n.node_id] ?? C.amber }} />
                      <div style={{
                        width: isLowCong ? 32 : 20,
                        height: 1.5,
                        background: isLowCong ? C.teal : C.text3,
                        transition: 'width 0.4s ease, background 0.4s',
                      }} />
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: isLowCong ? C.teal : C.text3 }} />
                    </div>
                    <span style={{
                      fontSize: 11, fontWeight: 600,
                      color: isLowCong ? C.teal : C.text2,
                    }}>
                      {n.routing || 'SHORTEST PATH'}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: C.text3, marginTop: 3 }}>
                    avg {(n.avg_delay_s * 1000).toFixed(1)} ms &nbsp;·&nbsp; risk {risk.toFixed(0)}%
                  </div>
                </div>

                {/* Action */}
                <span style={{
                  fontSize: 9, fontWeight: 600,
                  color: congested ? C.red : C.text3,
                  background: congested ? C.redDim : C.bgCard,
                  padding: '2px 6px', borderRadius: 4,
                  letterSpacing: '0.04em',
                  maxWidth: 130, textAlign: 'right',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {n.action || 'NORMAL'}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.borderSub}` }}>
        {[
          { col: C.text3, label: 'SHORTEST PATH — low delay, direct route' },
          { col: C.teal,  label: 'LOW-CONGESTION PATH — rerouted around backlog' },
        ].map(({ col, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 16, height: 2, background: col, borderRadius: 1 }} />
            <span style={{ fontSize: 10, color: C.text3 }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Node state sidebar ─────────────────────────────────────────── */
function NodeStatePanel({ twinNodes, liveNodes }: { twinNodes: TwinNode[]; liveNodes: NodeState[] }) {
  const liveMap = new Map(liveNodes.map(n => [n.node_id, n]));

  return (
    <div style={{
      background: C.bgCard, border: `1px solid ${C.border}`,
      borderRadius: C.CARD_RADIUS, padding: C.CARD_PAD,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.text3, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>
        Digital Twin — Node States
      </div>

      {twinNodes.length === 0 ? (
        <div style={{ fontSize: 12, color: C.text3 }}>No twin data — start edge controller</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {twinNodes.map(tn => {
            const live    = liveMap.get(tn.id);
            const risk    = (live?.ml_risk ?? 0);
            const col     = nodeColor({ id: tn.id, isHub: false, latency: tn.latency, state: tn.state, mlRisk: risk, routing: '', battery: 0, detected: false } as GraphNode);
            const battery = live?.battery_pct ?? null;

            return (
              <div key={tn.id} style={{
                borderRadius: 8, padding: '12px 14px',
                background: tn.state === 'congested' ? 'rgba(239,68,68,0.06)' : C.bgElevated,
                border: `1px solid ${tn.state === 'congested' ? 'rgba(239,68,68,0.2)' : C.border}`,
              }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <div style={{
                      width: 10, height: 10, borderRadius: '50%',
                      background: col,
                      boxShadow: `0 0 8px ${col}88`,
                    }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.text1 }}>{tn.id}</span>
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 600,
                    color: tn.state === 'congested' ? C.red : C.teal,
                    background: tn.state === 'congested' ? C.redDim : C.tealDim,
                    padding: '2px 7px', borderRadius: 4,
                    letterSpacing: '0.05em',
                  }}>
                    {tn.state.toUpperCase()}
                  </span>
                </div>

                {/* Stats */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {[
                    { label: 'Latency',  val: `${tn.latency.toFixed(1)} ms`,         col: tn.latency > 80 ? C.red : tn.latency > 30 ? C.amber : C.teal },
                    { label: 'ML Risk',  val: `${(risk * 100).toFixed(0)}% ${riskLabel(risk)}`, col: riskColor(risk) },
                    { label: 'Battery',  val: battery != null ? `${battery.toFixed(0)}%` : '—', col: battery != null && battery < 30 ? C.red : battery != null && battery < 60 ? C.amber : C.text2 },
                    { label: 'IR',       val: live ? (bool(live.detected) ? 'DETECTED' : 'clear') : '—', col: live && bool(live.detected) ? C.amber : C.text3 },
                  ].map(({ label, val, col: vc }) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: C.text3 }}>{label}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: vc }}>{val}</span>
                    </div>
                  ))}
                </div>

                {/* Latency bar */}
                <div style={{ marginTop: 8 }}>
                  <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 2,
                      width: `${Math.min(100, (tn.latency / 200) * 100)}%`,
                      background: col,
                      transition: 'width 0.6s ease',
                    }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Main view ──────────────────────────────────────────────────── */
export default function NetworkTwin() {
  const [twinNodes,  setTwinNodes]  = useState<TwinNode[]>([]);
  const [liveNodes,  setLiveNodes]  = useState<NodeState[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [graphSize,  setGraphSize]  = useState({ w: 600, h: 420 });

  // Measure container width
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(entries => {
      const w = entries[0].contentRect.width;
      setGraphSize({ w: Math.max(300, w), h: Math.max(300, Math.min(480, w * 0.65)) });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const fetch_ = useCallback(async () => {
    try {
      const [twin, nodes] = await Promise.all([
        api.twin().catch(() => [] as TwinNode[]),
        api.nodes(),
      ]);

      // If twin returns empty (backend not yet wired), synthesise from live nodes
      const effectiveTwin: TwinNode[] = twin.length > 0
        ? twin
        : nodes
            .filter(n => (NODES as readonly string[]).includes(n.node_id))
            .map(n => ({
              id:      n.node_id,
              latency: (n.avg_delay_s ?? 0) * 1000,
              state:   bool(n.congestion) ? 'congested' : 'normal',
            }));

      setTwinNodes(effectiveTwin);
      setLiveNodes(nodes.filter(n => (NODES as readonly string[]).includes(n.node_id)));
      setLastUpdate(new Date());
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

  /* Build graph data */
  const graphNodes: GraphNode[] = [
    // Hub node at centre
    { id: 'HUB', isHub: true, latency: 0, state: 'normal', mlRisk: 0, routing: '', battery: 100, detected: false },
    // IoT nodes
    ...twinNodes.map(tn => {
      const live = liveNodes.find(n => n.node_id === tn.id);
      return {
        id:       tn.id,
        isHub:    false,
        latency:  tn.latency,
        state:    tn.state,
        mlRisk:   live?.ml_risk ?? 0,
        routing:  live?.routing ?? 'SHORTEST PATH',
        battery:  live?.battery_pct ?? 100,
        detected: bool(live?.detected),
      } as GraphNode;
    }),
  ];

  const graphLinks: GraphLink[] = twinNodes.map(tn => ({
    source:    tn.id,
    target:    'HUB',
    congested: tn.state === 'congested',
    latency:   tn.latency,
  }));

  /* Summary stats */
  const totalCongested  = twinNodes.filter(n => n.state === 'congested').length;
  const avgLatency      = twinNodes.length
    ? twinNodes.reduce((s, n) => s + n.latency, 0) / twinNodes.length
    : 0;
  const activeRoutes    = liveNodes.filter(n => n.routing?.includes('LOW')).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: C.text1, lineHeight: 1.2 }}>Network Twin</h1>
          <p style={{ fontSize: 12, color: C.text3, marginTop: 5 }}>
            Live digital twin · NetworkX graph state · Control Engine routing
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {lastUpdate && (
            <span style={{ fontSize: 11, color: C.text3 }}>
              Updated {lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <button
            onClick={fetch_}
            style={{
              padding: '5px 13px', borderRadius: 7,
              border: `1px solid ${C.border}`,
              background: 'transparent', color: C.text2,
              fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >↻ Refresh</button>
        </div>
      </div>

      {error && <Alert message="Unable to reach API" detail={error} onRetry={fetch_} />}

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {[
          { label: 'Active Nodes',      val: `${twinNodes.length}/${NODES.length}`, col: twinNodes.length === NODES.length ? C.teal : C.amber },
          { label: 'Congested',         val: String(totalCongested),                col: totalCongested > 0 ? C.red : C.teal },
          { label: 'Avg Latency',       val: avgLatency > 0 ? `${avgLatency.toFixed(1)} ms` : '—', col: avgLatency > 80 ? C.red : avgLatency > 30 ? C.amber : C.teal },
          { label: 'Rerouted Paths',    val: String(activeRoutes),                  col: activeRoutes > 0 ? C.amber : C.text3 },
        ].map(({ label, val, col }) => (
          <div key={label} style={{
            background: C.bgCard, border: `1px solid ${C.border}`,
            borderRadius: C.CARD_RADIUS, padding: C.CARD_PAD,
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.text3, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
              {label}
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, color: col, lineHeight: 1, letterSpacing: '-1px' }}>
              {val}
            </div>
          </div>
        ))}
      </div>

      {/* Main content grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, alignItems: 'start' }}>

        {/* Left: graph */}
        <div style={{
          background: C.bgCard, border: `1px solid ${C.border}`,
          borderRadius: C.CARD_RADIUS, padding: C.CARD_PAD,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: C.text3, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Topology Graph
            </span>
            <div style={{ display: 'flex', gap: 12 }}>
              {[
                { col: C.teal,  label: 'Normal' },
                { col: C.amber, label: 'Medium Risk' },
                { col: C.red,   label: 'Congested / High Risk' },
              ].map(({ col, label }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: col, boxShadow: `0 0 6px ${col}` }} />
                  <span style={{ fontSize: 10, color: C.text3 }}>{label}</span>
                </div>
              ))}
            </div>
          </div>

          <div ref={containerRef} style={{ width: '100%' }}>
            {loading ? (
              <Skeleton width="100%" height={graphSize.h} radius={8} />
            ) : (
              <TwinGraph
                graphNodes={graphNodes}
                graphLinks={graphLinks}
                width={graphSize.w}
                height={graphSize.h}
              />
            )}
          </div>

          <div style={{ fontSize: 10, color: C.text3, marginTop: 10, textAlign: 'center' }}>
            Drag nodes to reposition · dots = live data packets flowing to hub
          </div>
        </div>

        {/* Right: node state panel */}
        {loading ? (
          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: C.CARD_RADIUS, padding: C.CARD_PAD }}>
            <Skeleton width="100%" height={320} />
          </div>
        ) : (
          <NodeStatePanel twinNodes={twinNodes} liveNodes={liveNodes} />
        )}
      </div>

      {/* Routing decisions */}
      {loading ? (
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: C.CARD_RADIUS, padding: C.CARD_PAD }}>
          <Skeleton width="100%" height={160} />
        </div>
      ) : (
        <RoutingPanel nodes={liveNodes} />
      )}
    </div>
  );
}