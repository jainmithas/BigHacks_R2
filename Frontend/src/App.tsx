import React, { useEffect, useRef, useState, lazy, Suspense } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity, AlertTriangle, BarChart3, Brain,
  ChevronRight, Globe, Package, RefreshCw,
  Shield, Truck, Warehouse, Zap, TrendingUp,
  Navigation, Server, Map
} from 'lucide-react';
import ReroutePanel from './components/ReroutePanel';

// Lazy-load the Map to avoid SSR issues with Leaflet
const MapView = lazy(() => import('./components/MapView'));

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:5000/api';

type ShipmentStatus = 'PENDING' | 'IN_TRANSIT' | 'ARRIVED' | 'DELAYED' | 'CANCELLED';
interface Shipment {
  id: string; origin: string; destination: string;
  carrierId: string; status: ShipmentStatus;
  eta: string; priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'REROUTED';
  currentLocation?: string;
  currentPosition?: { lat: number; lng: number };
  waypoints?: { lat: number; lng: number; label?: string }[];
  activeRoute?: string;
  rerouteHistory?: any[];
}
interface Warehouse { id: string; location: string; capacity: number; currentLoad: number; status: string; position?: any; }
interface Carrier { id: string; name: string; reliability: number; cost: number; type: string; }

const STATUS_COLOR: Record<ShipmentStatus, string> = {
  PENDING: 'badge-warning', IN_TRANSIT: 'badge-cyan',
  ARRIVED: 'badge-success', DELAYED: 'badge-danger', CANCELLED: 'badge-purple',
};

const THOUGHT_POOL = [
  { type: 'observe', text: 'Ingesting telemetry from 4 active shipments across 3 maritime corridors.' },
  { type: 'observe', text: 'WH-002 (Dubai) at 95% — flagging as critical bottleneck.' },
  { type: 'reason', text: 'SHP-004 (CRITICAL) crossing Pacific. Projected ETA delta: +6.2 hrs if storm persists.' },
  { type: 'reason', text: 'Routing model: 23% congestion risk at Port of LA in next 48 hrs.' },
  { type: 'decide', text: 'Recommend pre-positioning at WH-003 (Chennai) to buffer Dubai overflow.' },
  { type: 'decide', text: 'Alternative carrier CRR-002 (air) identified for SHP-003 ETA breach.' },
  { type: 'act', text: 'Hold advisory dispatched for SHP-001 Dubai ingress until dock slot opens.' },
  { type: 'act', text: 'Weather alert forwarded to CRR-001: Arabian Sea corridor (lat 18°N).' },
];

const Ring = ({ pct, color, size = 56, strokeW = 5 }: { pct: number; color: string; size?: number; strokeW?: number }) => {
  const r = (size - strokeW * 2) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={strokeW} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={strokeW}
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 1.2s ease', filter: `drop-shadow(0 0 5px ${color}88)` }} />
    </svg>
  );
};

const Sparkline = ({ data, color }: { data: number[]; color: string }) => {
  const w = 80, h = 28;
  const min = Math.min(...data), max = Math.max(...data);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / (max - min + 1)) * h;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={w} height={h} style={{ overflow: 'visible' }}>
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={pts}
        style={{ filter: `drop-shadow(0 0 4px ${color}88)` }} />
    </svg>
  );
};

const rand = (a: number, b: number) => Math.floor(Math.random() * (b - a + 1)) + a;

const LoadingScreen = () => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#04040a', gap: 24 }}>
    <div style={{ position: 'relative', width: 100, height: 100 }}>
      <svg viewBox="0 0 100 100" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(0,212,255,0.08)" strokeWidth="2" />
        <circle cx="50" cy="50" r="44" fill="none" stroke="#00d4ff" strokeWidth="2"
          strokeDasharray="276" strokeDashoffset="200" strokeLinecap="round" className="ring-1" />
        <circle cx="50" cy="50" r="30" fill="none" stroke="#a855f7" strokeWidth="1"
          strokeDasharray="188" strokeDashoffset="120" strokeLinecap="round" className="ring-2" />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Zap size={28} color="#00d4ff" />
      </div>
    </div>
    <div style={{ fontFamily: 'JetBrains Mono,monospace', color: '#00d4ff', fontSize: 13, letterSpacing: '0.2em' }} className="cursor">
      BOOTING ASTRA OPS
    </div>
  </div>
);

/* ══════════════════════════════════════════════════════════════
   MAIN APP
══════════════════════════════════════════════════════════════ */
const App: React.FC = () => {
  const [simState, setSimState] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [thoughts, setThoughts] = useState<typeof THOUGHT_POOL>([]);
  const [activeNav, setActiveNav] = useState('ops');
  const [mainTab, setMainTab] = useState<'feed' | 'map'>('map');
  const [refreshing, setRefreshing] = useState(false);
  const [selectedShipment, setSelectedShipment] = useState<string | null>(null);
  const [reroutePanelOpen, setReroutePanelOpen] = useState(false);
  const [sparkData] = useState(() => Array.from({ length: 12 }, () => rand(70, 100)));
  const [expandSection, setExpandSection] = useState<Record<string, boolean>>({
    sla: true, warehouses: false, carriers: false
  });
  const toggleSection = (k: string) => setExpandSection(prev => ({ ...prev, [k]: !prev[k] }));
  const thoughtRef = useRef<HTMLDivElement>(null);
  const tickRef = useRef(0);

  const fetchData = async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const res = await axios.get(`${API_BASE}/simulation/state`);
      setSimState(res.data);
    } catch (err) {
      console.error('[AstraOps] Failed to reach backend:', err);
      // Show empty state with error timestamp rather than fake mock data
      if (!simState) {
        setSimState({ shipments: [], warehouses: [], carriers: [], routes: [], timestamp: new Date().toISOString() });
      }
    } finally {
      setLoading(false);
      if (manual) setTimeout(() => setRefreshing(false), 600);
    }
  };

  useEffect(() => {
    const push = () => {
      const t = THOUGHT_POOL[tickRef.current % THOUGHT_POOL.length];
      tickRef.current++;
      setThoughts(prev => [t, ...prev].slice(0, 12));
    };
    push();
    const iv = setInterval(push, 3500);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 5000);
    return () => clearInterval(iv);
  }, []);

  if (loading) return <LoadingScreen />;

  const { shipments, warehouses, carriers } = simState;
  const delayed = shipments.filter((s: Shipment) => s.status === 'DELAYED').length;
  const inTransit = shipments.filter((s: Shipment) => s.status === 'IN_TRANSIT').length;
  const slaRate = Math.round((1 - delayed / shipments.length) * 100);
  const selectedShipmentData = shipments.find((s: Shipment) => s.id === selectedShipment);

  const handleSelectShipment = (id: string) => {
    setSelectedShipment(id);
    setReroutePanelOpen(true);
    setMainTab('map');
  };

  const handleRerouteConfirmed = (shipmentId: string, routeId: string) => {
    // ── Optimistic update: patch state immediately so the UI reflects the
    //    change before the next polling cycle fires. ──────────────────────
    setSimState((prev: any) => {
      if (!prev) return prev;
      const updatedShipments = prev.shipments.map((s: Shipment) => {
        if (s.id !== shipmentId) return s;
        return {
          ...s,
          status: 'IN_TRANSIT' as ShipmentStatus,
          priority: 'REROUTED' as any,
          activeRoute: routeId,
          // Keep the waypoints as-is; backend will persist the correct ones,
          // and the next poll will replace them with the confirmed alternative.
        };
      });
      return { ...prev, shipments: updatedShipments, timestamp: new Date().toISOString() };
    });

    // ── Background sync: fetch fresh state from backend ──────────────────
    fetchData(true);
  };

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden', background: 'var(--bg-void)' }}>

      {/* ── Icon Nav ─────────────────────────────────────── */}
      <nav style={{
        width: 64, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 0', gap: 12,
        borderRight: '1px solid var(--border)', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(20px)', zIndex: 10, flexShrink: 0
      }}>
        <div style={{
          marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 40, height: 40, background: 'var(--primary-dim)', borderRadius: 12,
          border: '1px solid rgba(0,212,255,0.3)', boxShadow: '0 0 20px var(--primary-glow)'
        }}>
          <Zap size={20} color="var(--primary)" />
        </div>
        {[
          { id: 'map',       icon: <Map size={18} />,       label: 'Live Map' },
          { id: 'feed',      icon: <Globe size={18} />,     label: 'Ops Feed' },
          { id: 'analytics', icon: <BarChart3 size={18} />, label: 'Analytics' },
          { id: 'agent',     icon: <Brain size={18} />,     label: 'Agent' },
          { id: 'security',  icon: <Shield size={18} />,    label: 'Security' },
        ].map(n => (
          <button key={n.id} title={n.label} className={`nav-btn ${activeNav === n.id ? 'active' : ''}`}
            onClick={() => {
              setActiveNav(n.id);
              if (n.id === 'map') setMainTab('map');
              if (n.id === 'feed') setMainTab('feed');
            }}>
            {n.icon}
          </button>
        ))}
        <div style={{ flexGrow: 1 }} />
        <button className="nav-btn" onClick={() => fetchData(true)} title="Refresh" style={{ marginBottom: 8 }}>
          <RefreshCw size={16} style={{ animation: refreshing ? 'spin-slow 0.8s linear infinite' : 'none' }} />
        </button>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)', boxShadow: '0 0 8px var(--success)', marginBottom: 8 }} />
      </nav>

      {/* ── Metrics Sidebar ──────────────────────────────── */}
      <aside style={{
        width: 280, borderRight: '1px solid var(--border)', background: 'rgba(4,4,10,0.85)',
        backdropFilter: 'blur(20px)', padding: 20, display: 'flex', flexDirection: 'column', gap: 16, flexShrink: 0, overflowY: 'auto'
      }}>
        <div>
          <div style={{ fontSize: 9, letterSpacing: '0.25em', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>ASTRA OPS · GLOBAL CONTROL</div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-bright)' }}>Live <span style={{ color: 'var(--primary)' }}>Dashboard</span></h1>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4, fontFamily: 'JetBrains Mono,monospace' }}>
            {new Date(simState.timestamp).toUTCString().slice(5, 25)} UTC
          </div>
        </div>

        {/* SLA Ring — collapsible */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <button
            onClick={() => toggleSection('sla')}
            style={{ width: '100%', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <TrendingUp size={14} color="var(--success)" />
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text-dim)', textTransform: 'uppercase' }}>SLA Rate</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--success)' }}>{isNaN(slaRate) ? '—' : slaRate + '%'}</span>
              <ChevronRight size={14} color="var(--text-dim)" style={{ transform: expandSection.sla ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
            </div>
          </button>
          <AnimatePresence initial={false}>
            {expandSection.sla && (
              <motion.div key="sla-body" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} style={{ overflow: 'hidden' }}>
                <div style={{ padding: '0 16px 16px', display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <Ring pct={isNaN(slaRate) ? 0 : slaRate} color="var(--success)" size={72} strokeW={6} />
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 800, color: 'var(--success)' }}>{isNaN(slaRate) ? '—' : slaRate + '%'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text-normal)' }}>In transit: <b style={{ color: 'var(--text-bright)' }}>{inTransit}</b></div>
                    <div style={{ fontSize: 12, color: 'var(--text-normal)', marginTop: 4 }}>Delayed: <b style={{ color: 'var(--danger)' }}>{delayed}</b></div>
                    <div style={{ marginTop: 8 }}><Sparkline data={sparkData} color="var(--success)" /></div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Metric cards — Shipments (plain), Warehouses + Carriers collapsible */}
        {/* Shipments count — plain card */}
        <motion.div className="card glow-cyan" style={{ padding: '14px 16px' }}
          initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(0,212,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)' }}><Package size={16} /></div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Shipments</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--primary)', lineHeight: 1 }}>{shipments.length}</div>
              </div>
            </div>
            <Ring pct={Math.round(inTransit / Math.max(shipments.length, 1) * 100)} color="var(--primary)" size={44} strokeW={4} />
          </div>
        </motion.div>

        {/* Warehouses — collapsible icon grid */}
        <div className="card glow-purple" style={{ padding: 0, overflow: 'hidden' }}>
          <button onClick={() => toggleSection('warehouses')} style={{ width: '100%', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(168,85,247,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--secondary)' }}><Warehouse size={16} /></div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Warehouses</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--secondary)', lineHeight: 1 }}>{warehouses.length}</div>
              </div>
            </div>
            <ChevronRight size={16} color="var(--text-dim)" style={{ transform: expandSection.warehouses ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
          </button>
          <AnimatePresence initial={false}>
            {expandSection.warehouses && (
              <motion.div key="wh-body" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} style={{ overflow: 'hidden' }}>
                <div style={{ padding: '0 12px 12px', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {warehouses.map((wh: Warehouse) => {
                    const label = (wh as any).name ?? wh.location ?? wh.id.slice(0, 6);
                    const pct = wh.capacity > 0 ? Math.round((wh.currentLoad / wh.capacity) * 100) : 0;
                    const col = pct > 90 ? 'var(--danger)' : pct > 70 ? 'var(--warning)' : 'var(--success)';
                    const abbr = label.split(' ').map((w: string) => w[0]).join('').slice(0, 3).toUpperCase();
                    return (
                      <button key={wh.id} title={`${label}\n${pct}% load (${wh.currentLoad}/${wh.capacity})\nStatus: ${wh.status}`}
                        style={{ position: 'relative', width: 52, height: 52, borderRadius: 12, background: `${col}15`, border: `1.5px solid ${col}55`, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, padding: 0 }}
                        onClick={() => setSelectedShipment(null)}>
                        <span style={{ fontSize: 9, fontWeight: 800, color: col, fontFamily: 'JetBrains Mono,monospace', lineHeight: 1 }}>{abbr}</span>
                        <span style={{ fontSize: 9, fontWeight: 700, color: col }}>{pct}%</span>
                        {/* Mini ring */}
                        <svg width="46" height="46" style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}>
                          <circle cx="23" cy="23" r="19" fill="none" stroke={`${col}20`} strokeWidth="3" />
                          <circle cx="23" cy="23" r="19" fill="none" stroke={col} strokeWidth="3"
                            strokeDasharray={`${2 * Math.PI * 19}`}
                            strokeDashoffset={`${2 * Math.PI * 19 * (1 - pct / 100)}`}
                            strokeLinecap="round" />
                        </svg>
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Carriers — collapsible list */}
        <div className="card glow-orange" style={{ padding: 0, overflow: 'hidden' }}>
          <button onClick={() => toggleSection('carriers')} style={{ width: '100%', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(251,146,60,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}><Truck size={16} /></div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Carriers</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)', lineHeight: 1 }}>{carriers.length}</div>
              </div>
            </div>
            <ChevronRight size={16} color="var(--text-dim)" style={{ transform: expandSection.carriers ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
          </button>
          <AnimatePresence initial={false}>
            {expandSection.carriers && (
              <motion.div key="cr-body" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} style={{ overflow: 'hidden' }}>
                <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
                  {carriers.map((c: Carrier) => {
                    const rel = Math.round(((c as any).reliability_score ?? c.reliability ?? 0.9) * 100);
                    const col = rel >= 95 ? 'var(--success)' : rel >= 85 ? 'var(--warning)' : 'var(--danger)';
                    return (
                      <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Navigation size={12} color="var(--accent)" />
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-normal)' }}>{c.name}</span>
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 800, color: col }}>{rel}%</span>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Warehouse load — removed, now inside the collapsible Warehouses card above */}

        {/* Agent trigger */}
        <div style={{ paddingTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Agent</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--success)' }}>
              <span className="pulse-dot green" /><span style={{ fontWeight: 700 }}>Active</span>
            </div>
          </div>
          <button className="btn-neon" style={{ width: '100%', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 13 }}
            onClick={() => axios.post(`${API_BASE}/agent/trigger`).catch(() => { })}>
            <Zap size={15} /> Manual Trigger <ChevronRight size={14} />
          </button>
        </div>
      </aside>

      {/* ── Main Panel ───────────────────────────────────── */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Top bar */}
        <div style={{
          height: 52, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center',
          padding: '0 24px', justifyContent: 'space-between', background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(20px)', flexShrink: 0
        }}>
          <div style={{ display: 'flex', gap: 4 }} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {selectedShipment && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 99,
                background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.2)', fontSize: 12
              }}>
                <span className="pulse-dot cyan" style={{ width: 6, height: 6 }} />
                <span style={{ color: 'var(--primary)', fontWeight: 700, fontFamily: 'JetBrains Mono,monospace' }}>{selectedShipment}</span>
                <span style={{ color: 'var(--text-dim)' }}>selected</span>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { label: 'Operations', icon: <Navigation size={12} /> },
                { label: `${shipments.length} Threads`, icon: <Server size={12} /> },
              ].map((item, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-dim)', fontWeight: 500 }}>
                  <span style={{ color: 'var(--primary)' }}>{item.icon}</span>{item.label}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Main content */}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 380px', gridTemplateRows: '1fr 220px', gap: 1, overflow: 'hidden', background: 'var(--border)' }}>

          {/* ── Dynamic Main View ─── */}
          <div className="card grid-bg" style={{ borderRadius: 0, border: 'none', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

            {activeNav === 'analytics' ? (
              <div style={{ flex: 1, padding: 30, overflowY: 'auto' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                  <BarChart3 size={24} color="var(--primary)" />
                  <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-bright)' }}>System Analytics</h2>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div className="card" style={{ padding: 20, minHeight: 200, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', border: '1px solid rgba(0,212,255,0.1)' }}>
                    <div style={{ fontSize: 48, fontWeight: 800, color: 'var(--success)', filter: 'drop-shadow(0 0 10px rgba(34,211,167,0.3))' }}>98.2%</div>
                    <div style={{ fontSize: 12, color: 'var(--text-dim)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 8 }}>7-Day SLA Compliance</div>
                  </div>
                  <div className="card" style={{ padding: 20, minHeight: 200, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', border: '1px solid rgba(244,63,94,0.1)' }}>
                    <div style={{ fontSize: 48, fontWeight: 800, color: 'var(--danger)', filter: 'drop-shadow(0 0 10px rgba(244,63,94,0.3))' }}>12h</div>
                    <div style={{ fontSize: 12, color: 'var(--text-dim)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 8 }}>Avg Reroute Savings</div>
                  </div>
                </div>
              </div>
            ) : activeNav === 'agent' ? (
              <div style={{ flex: 1, padding: 30, overflowY: 'auto' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                  <Brain size={24} color="var(--secondary)" />
                  <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-bright)' }}>AI Agent Configuration</h2>
                </div>
                <div className="card" style={{ padding: 24, background: 'rgba(168,85,247,0.05)', border: '1px solid rgba(168,85,247,0.2)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                    <div>
                      <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-bright)', marginBottom: 4 }}>Autonomous Rerouting</h3>
                      <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>Allow the agent to execute reroutes without manual approval if risk &gt; 80%</p>
                    </div>
                    <div style={{ width: 44, height: 24, borderRadius: 99, background: 'var(--secondary)', display: 'flex', alignItems: 'center', padding: 2, justifyContent: 'flex-end', cursor: 'pointer' }}>
                      <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#fff' }} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-bright)', marginBottom: 4 }}>Carrier Escalation Model</h3>
                      <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>Automatically switch from SEA to AIR for CRITICAL SLA breaches</p>
                    </div>
                    <div style={{ width: 44, height: 24, borderRadius: 99, background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', padding: 2, cursor: 'pointer' }}>
                      <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#888' }} />
                    </div>
                  </div>
                </div>
              </div>
            ) : activeNav === 'anomalies' ? (
              <div style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                  <AlertTriangle size={22} color="var(--danger)" />
                  <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-bright)' }}>Active Anomalies</h2>
                  <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 99, background: 'rgba(244,63,94,0.12)', color: 'var(--danger)', fontWeight: 700, border: '1px solid rgba(244,63,94,0.2)' }}>
                    LIVE
                  </span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                  {(() => {
                    const items: { id: string; label: string; msg: string; severity: 'danger' | 'warning' }[] = [];
                    shipments.forEach((s: Shipment) => {
                      const label = s.origin && s.destination ? `${s.origin} → ${s.destination}` : s.id.slice(0, 8);
                      if (s.status === 'DELAYED') items.push({ id: s.id, label, msg: `${s.priority === 'CRITICAL' ? 'CRITICAL delay' : 'Delay detected'} — ${label}${s.currentLocation ? ` (${s.currentLocation})` : ''}`, severity: s.priority === 'CRITICAL' ? 'danger' : 'warning' });
                      else if (s.priority === 'CRITICAL' && s.status === 'IN_TRANSIT') items.push({ id: s.id, label, msg: `CRITICAL cargo en route — ${label}`, severity: 'warning' });
                    });
                    warehouses.forEach((wh: Warehouse) => {
                      const pct = Math.round(((wh.currentLoad ?? 0) / (wh.capacity || 1)) * 100);
                      const whName = (wh as any).name ?? wh.location ?? wh.id.slice(0, 8);
                      if (wh.status === 'CONGESTED' || pct >= 90) items.push({ id: wh.id, label: whName, msg: `${whName} hub exceeding ${pct}% capacity threshold`, severity: pct >= 95 ? 'danger' : 'warning' });
                    });
                    if (items.length === 0) return (
                      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, gap: 12 }}>
                        <span style={{ fontSize: 36 }}>✅</span>
                        <span style={{ color: 'var(--success)', fontSize: 15, fontWeight: 700 }}>All systems nominal — no active anomalies</span>
                      </div>
                    );
                    return items.map(a => (
                      <motion.div key={a.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                        onClick={() => { if (shipments.find((s: Shipment) => s.id === a.id)) handleSelectShipment(a.id); }}
                        style={{ padding: '14px 18px', borderRadius: 12, minWidth: 260, maxWidth: 340, flex: '1 1 260px',
                          cursor: shipments.find((s: Shipment) => s.id === a.id) ? 'pointer' : 'default',
                          background: a.severity === 'danger' ? 'var(--danger-dim)' : 'var(--warning-dim)',
                          border: `1px solid ${a.severity === 'danger' ? 'rgba(244,63,94,0.3)' : 'rgba(245,158,11,0.3)'}` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                          <span style={{ fontWeight: 800, fontSize: 12, color: a.severity === 'danger' ? 'var(--danger)' : 'var(--warning)' }}>{a.label}</span>
                          <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 99, fontWeight: 700, background: a.severity === 'danger' ? 'rgba(244,63,94,0.15)' : 'rgba(245,158,11,0.15)', color: a.severity === 'danger' ? 'var(--danger)' : 'var(--warning)' }}>{a.severity === 'danger' ? 'CRITICAL' : 'WARNING'}</span>
                        </div>
                        <p style={{ fontSize: 12, color: 'var(--text-normal)', lineHeight: 1.5 }}>{a.msg}</p>
                        {shipments.find((s: Shipment) => s.id === a.id) && (
                          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--primary)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                            Analyze Reroute <ChevronRight size={11} />
                          </div>
                        )}
                      </motion.div>
                    ));
                  })()}
                </div>
              </div>
            ) : activeNav === 'fleet' ? (
              <div style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                  <Activity size={22} color="var(--accent)" />
                  <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-bright)' }}>Carrier Fleet</h2>
                  <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 99, background: 'rgba(251,146,60,0.1)', color: 'var(--accent)', fontWeight: 700, border: '1px solid rgba(251,146,60,0.2)' }}>
                    {carriers.length} carriers
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
                  {carriers.map((c: Carrier) => {
                    const cType = (c as any).carrier_type ?? c.type ?? 'SEA';
                    const typeColor = cType === 'AIR' ? 'var(--primary)' : cType === 'SEA' ? 'var(--accent)' : 'var(--success)';
                    const rel = Math.round(((c as any).reliability_score ?? c.reliability ?? 0.9) * 100);
                    const relColor = rel >= 95 ? 'var(--success)' : rel >= 80 ? 'var(--warning)' : 'var(--danger)';
                    return (
                      <div key={c.id} className="card" style={{ padding: '14px 16px', border: `1px solid ${typeColor}22` }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                          <div style={{ width: 36, height: 36, borderRadius: 10, background: `${typeColor}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {cType === 'AIR' ? <Zap size={16} color={typeColor} /> : cType === 'SEA' ? <Navigation size={16} color={typeColor} /> : <Truck size={16} color={typeColor} />}
                          </div>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-bright)' }}>{c.name}</div>
                            <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: `${typeColor}18`, color: typeColor, fontWeight: 700 }}>{cType}</span>
                          </div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Reliability</span>
                          <span style={{ fontSize: 13, fontWeight: 800, color: relColor }}>{rel}%</span>
                        </div>
                        <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${rel}%`, background: relColor, borderRadius: 99, transition: 'width 1s ease', boxShadow: `0 0 6px ${relColor}88` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : activeNav === 'security' ? (
              <div style={{ flex: 1, padding: 30, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <Shield size={48} color="var(--success)" style={{ marginBottom: 16, opacity: 0.8 }} />
                <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-bright)', marginBottom: 8 }}>Vessel Security Nominal</h2>
                <p style={{ fontSize: 13, color: 'var(--text-dim)', textAlign: 'center', maxWidth: 400 }}>All active carriers are reporting secure transponders. No piracy threat sectors intercepted in the last 48 hours.</p>
              </div>
            ) : activeNav === 'map' || activeNav === 'ops' || activeNav === 'feed' ? (
              // Map & Ops Feed View (Default)
              <>
                {mainTab === 'map' ? (
                  <Suspense fallback={
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)', fontFamily: 'JetBrains Mono,monospace', fontSize: 12 }}>
                      Loading map...
                    </div>
                  }>
                    <MapView
                      shipments={shipments}
                      warehouses={warehouses}
                      selected={selectedShipment}
                      onSelect={handleSelectShipment}
                    />
                  </Suspense>
                ) : (
                  <>
                    <div className="scan-line" />
                    <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Globe size={16} color="var(--primary)" />
                        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Global Operations Feed</span>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {(['IN_TRANSIT', 'DELAYED', 'PENDING'] as ShipmentStatus[]).map(s => (
                          <span key={s} className={`badge ${STATUS_COLOR[s]}`}>{shipments.filter((sh: Shipment) => sh.status === s).length} {s.replace('_', ' ')}</span>
                        ))}
                      </div>
                    </div>
                    <div style={{ flex: 1, padding: '16px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <AnimatePresence>
                        {shipments.map((shp: Shipment, i: number) => (
                          <ShipmentCard key={shp.id} shipment={shp} delay={i * 0.08} onSelect={handleSelectShipment} />
                        ))}
                      </AnimatePresence>
                    </div>
                  </>
                )}

                {/* Reroute slide-in panel */}
                <AnimatePresence>
                  {reroutePanelOpen && selectedShipment && (
                    <ReroutePanel
                      shipmentId={selectedShipment}
                      shipment={selectedShipmentData}
                      onClose={() => setReroutePanelOpen(false)}
                      onRerouteConfirmed={handleRerouteConfirmed}
                    />
                  )}
                </AnimatePresence>
              </>
            ) : null}
          </div>

          {/* ── Agent Reasoning Panel ─── */}
          <div className="card" style={{ borderRadius: 0, border: 'none', borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Brain size={16} color="var(--secondary)" style={{ filter: 'drop-shadow(0 0 6px #a855f7)' }} />
                <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Agent Reasoning</span>
              </div>
              <span className="badge badge-purple">ORADAL Loop</span>
            </div>
            <div ref={thoughtRef} style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <AnimatePresence>
                {thoughts.map((t, i) => (
                  <motion.div key={`${t.text}-${i}`}
                    initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }} transition={{ duration: 0.35 }}
                    className={`thought-block thought-${t.type}`}>
                    <div style={{
                      fontSize: 9, fontWeight: 800, letterSpacing: '0.15em', textTransform: 'uppercase',
                      color: t.type === 'observe' ? 'var(--primary)' : t.type === 'reason' ? 'var(--secondary)' : t.type === 'decide' ? 'var(--accent)' : 'var(--success)',
                      marginBottom: 3
                    }}>[{t.type.toUpperCase()}]</div>
                    {t.text}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>

          {/* ── Bottom Row ─── */}
          <div style={{ borderTop: '1px solid var(--border)', background: 'rgba(4,4,10,0.92)', display: 'flex', gap: 1, overflow: 'hidden' }}>
            {/* Anomaly List */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <AlertTriangle size={14} color="var(--danger)" />
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Active Anomalies</span>
              </div>
              <div style={{ padding: '8px 16px', display: 'flex', gap: 8, overflowX: 'auto', alignItems: 'center', flex: 1 }}>
                {(() => {
                  // Build anomaly list dynamically from live state
                  const anomalies: { id: string; msg: string; severity: 'danger' | 'warning'; label?: string }[] = [];

                  // Delayed/Critical shipments
                  shipments.forEach((s: Shipment) => {
                    const label = s.origin && s.destination
                      ? `${s.origin} → ${s.destination}`
                      : s.id.slice(0, 8);
                    if (s.status === 'DELAYED') {
                      anomalies.push({
                        id: s.id,
                        msg: `${s.priority === 'CRITICAL' ? 'CRITICAL delay' : 'Delay detected'} — ${label}${s.currentLocation ? ` (${s.currentLocation})` : ''}`,
                        severity: s.priority === 'CRITICAL' ? 'danger' : 'warning',
                        label,
                      });
                    } else if (s.priority === 'CRITICAL' && s.status === 'IN_TRANSIT') {
                      anomalies.push({
                        id: s.id,
                        msg: `CRITICAL cargo en route — monitoring active. ${label}`,
                        severity: 'warning',
                        label,
                      });
                    }
                  });

                  // Congested warehouses
                  warehouses.forEach((wh: Warehouse) => {
                    const pct = Math.round((wh.currentLoad / wh.capacity) * 100);
                    const whName = (wh as any).name ?? wh.location ?? wh.id.slice(0, 8);
                    if (wh.status === 'CONGESTED' || pct >= 90) {
                      anomalies.push({
                        id: wh.id,
                        msg: `${whName} hub exceeding ${pct}% capacity threshold`,
                        severity: pct >= 95 ? 'danger' : 'warning',
                        label: whName,
                      });
                    }
                  });

                  if (anomalies.length === 0) {
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px', color: 'var(--success)', fontSize: 12, fontWeight: 700 }}>
                        <span className="pulse-dot green" /> All systems nominal — no active anomalies
                      </div>
                    );
                  }

                  return (anomalies as any[]).map(a => (
                    <motion.div key={a.id} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                      onClick={() => { if (shipments.find((s: Shipment) => s.id === a.id)) handleSelectShipment(a.id); }}
                      style={{
                        flexShrink: 0, padding: '10px 14px', borderRadius: 10,
                        cursor: shipments.find((s: Shipment) => s.id === a.id) ? 'pointer' : 'default',
                        background: a.severity === 'danger' ? 'var(--danger-dim)' : 'var(--warning-dim)',
                        border: `1px solid ${a.severity === 'danger' ? 'rgba(244,63,94,0.25)' : 'rgba(245,158,11,0.25)'}`,
                        minWidth: 210, maxWidth: 280,
                      }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{
                          fontFamily: 'JetBrains Mono,monospace', fontSize: 11, fontWeight: 700,
                          color: a.severity === 'danger' ? 'var(--danger)' : 'var(--warning)'
                        }}>{a.label ?? a.id.slice(0, 12)}</span>
                        <span style={{
                          fontSize: 9, padding: '1px 6px', borderRadius: 99, fontWeight: 700,
                          background: a.severity === 'danger' ? 'rgba(244,63,94,0.15)' : 'rgba(245,158,11,0.15)',
                          color: a.severity === 'danger' ? 'var(--danger)' : 'var(--warning)'
                        }}>{a.severity === 'danger' ? 'CRITICAL' : 'WARNING'}</span>
                      </div>
                      <p style={{ fontSize: 11, color: 'var(--text-normal)', lineHeight: 1.4 }}>{a.msg}</p>
                      {shipments.find((s: Shipment) => s.id === a.id) && (
                        <div style={{ marginTop: 6, fontSize: 10, color: 'var(--primary)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                          Analyze Reroute <ChevronRight size={10} />
                        </div>
                      )}
                    </motion.div>
                  ));
                })()}
              </div>

            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

/* ── Shipment Card ── */
const ShipmentCard = ({ shipment, delay, onSelect }: { shipment: Shipment; delay: number; onSelect: (id: string) => void }) => {
  const isDelayed = shipment.status === 'DELAYED';
  const isCritical = shipment.priority === 'CRITICAL';
  const isRerouted = shipment.priority === 'REROUTED';
  const color = isDelayed ? '#f43f5e' : isCritical ? '#f59e0b' : isRerouted ? '#a855f7' : '#00d4ff';
  return (
    <motion.div initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4, delay }}
      onClick={() => onSelect(shipment.id)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderRadius: 12, cursor: 'pointer',
        background: isDelayed ? 'rgba(244,63,94,0.06)' : isCritical ? 'rgba(245,158,11,0.05)' : 'var(--bg-card)',
        border: `1px solid ${isDelayed ? 'rgba(244,63,94,0.2)' : isCritical ? 'rgba(245,158,11,0.2)' : 'var(--border)'}`,
        transition: 'all 0.2s'
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          position: 'relative', width: 36, height: 36, borderRadius: 10, flexShrink: 0,
          background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <Truck size={16} color={color} />
          {isDelayed && <span style={{
            position: 'absolute', top: -3, right: -3, width: 8, height: 8,
            borderRadius: '50%', background: 'var(--danger)', border: '2px solid var(--bg-void)'
          }} />}
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <span style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 13, fontWeight: 700, color: 'var(--text-bright)' }}>{shipment.id}</span>
            <span className={`badge priority-${isRerouted ? 'REROUTED' : shipment.priority}`} style={isRerouted ? { background: 'rgba(168,85,247,0.15)', color: '#a855f7', border: '1px solid rgba(168,85,247,0.3)' } : {}}>{shipment.priority}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            {shipment.origin}<span style={{ color: 'var(--primary)', margin: '0 6px', opacity: 0.6 }}>→</span>{shipment.destination}
            {shipment.currentLocation && <span style={{ color: 'var(--text-dim)' }}> · {shipment.currentLocation}</span>}
          </div>
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
        <span className={`badge ${STATUS_COLOR[shipment.status]}`}>{shipment.status.replace('_', ' ')}</span>
        <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>ETA {new Date(shipment.eta).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>
        <div style={{ fontSize: 10, color: 'var(--primary)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 3 }}>
          <Navigation size={9} /> View on map
        </div>
      </div>
    </motion.div>
  );
};

// Mock data removed — all data is fetched live from the backend API.
// Configure the backend URL via the VITE_API_URL environment variable.
// See Frontend/.env or Vite docs for details.

export default App;
