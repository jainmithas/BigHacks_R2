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
          { id: 'ops', icon: <Globe size={18} />, label: 'Operations' },
          { id: 'map', icon: <Map size={18} />, label: 'Live Map' },
          { id: 'analytics', icon: <BarChart3 size={18} />, label: 'Analytics' },
          { id: 'agent', icon: <Brain size={18} />, label: 'Agent' },
          { id: 'security', icon: <Shield size={18} />, label: 'Security' },
        ].map(n => (
          <button key={n.id} title={n.label} className={`nav-btn ${activeNav === n.id ? 'active' : ''}`}
            onClick={() => { setActiveNav(n.id); if (n.id === 'map') setMainTab('map'); }}>
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

        {/* SLA Ring */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text-dim)', textTransform: 'uppercase' }}>SLA Rate</div>
            <TrendingUp size={14} color="var(--success)" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <Ring pct={slaRate} color="var(--success)" size={72} strokeW={6} />
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 15, fontWeight: 800, color: 'var(--success)'
              }}>{slaRate}%</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-normal)' }}>In transit: <b style={{ color: 'var(--text-bright)' }}>{inTransit}</b></div>
              <div style={{ fontSize: 12, color: 'var(--text-normal)', marginTop: 4 }}>Delayed: <b style={{ color: 'var(--danger)' }}>{delayed}</b></div>
              <div style={{ marginTop: 8 }}><Sparkline data={sparkData} color="var(--success)" /></div>
            </div>
          </div>
        </div>

        {/* Metric cards */}
        {[
          { label: 'Shipments', val: shipments.length, icon: <Package size={16} />, color: 'var(--primary)', cls: 'glow-cyan' },
          { label: 'Warehouses', val: warehouses.length, icon: <Warehouse size={16} />, color: 'var(--secondary)', cls: 'glow-purple' },
          { label: 'Carriers', val: carriers.length, icon: <Truck size={16} />, color: 'var(--accent)', cls: 'glow-orange' },
        ].map(m => (
          <motion.div key={m.label} className={`card ${m.cls}`} style={{ padding: '14px 16px' }}
            initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 10, background: `${m.color}15`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: m.color
                }}>{m.icon}</div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{m.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: m.color, lineHeight: 1 }}>{m.val}</div>
                </div>
              </div>
              <Ring pct={75} color={m.color} size={44} strokeW={4} />
            </div>
          </motion.div>
        ))}

        {/* Warehouse bars */}
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>Warehouse Load</div>
          {warehouses.map((wh: Warehouse) => {
            const pct = Math.round((wh.currentLoad / wh.capacity) * 100);
            const col = pct > 90 ? 'var(--danger)' : pct > 70 ? 'var(--warning)' : 'var(--success)';
            return (
              <div key={wh.id} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-normal)' }}>{wh.location}</span>
                  <span style={{ fontSize: 11, color: col, fontWeight: 700 }}>{pct}%</span>
                </div>
                <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden' }}>
                  <motion.div className="bar-fill" style={{ background: col, boxShadow: `0 0 6px ${col}88` }}
                    initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 1.2, ease: 'easeOut' }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Agent trigger */}
        <div style={{ marginTop: 'auto' }}>
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
          <div style={{ display: 'flex', gap: 4 }}>
            {([['map', 'Live Map', <Map size={13} />], ['feed', 'Ops Feed', <Globe size={13} />]] as const).map(([id, label, icon]) => (
              <button key={id} onClick={() => setMainTab(id as 'map' | 'feed')} style={{
                padding: '5px 14px', borderRadius: 99, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
                background: mainTab === id ? 'var(--primary-dim)' : 'transparent',
                border: `1px solid ${mainTab === id ? 'rgba(0,212,255,0.3)' : 'var(--border)'}`,
                color: mainTab === id ? 'var(--primary)' : 'var(--text-dim)',
              }}>
                {icon} {label}
              </button>
            ))}
          </div>
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
            ) : activeNav === 'security' ? (
              <div style={{ flex: 1, padding: 30, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <Shield size={48} color="var(--success)" style={{ marginBottom: 16, opacity: 0.8 }} />
                <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-bright)', marginBottom: 8 }}>Vessel Security Nominal</h2>
                <p style={{ fontSize: 13, color: 'var(--text-dim)', textAlign: 'center', maxWidth: 400 }}>All active carriers are reporting secure transponders. No piracy threat sectors intercepted in the last 48 hours.</p>
              </div>
            ) : activeNav === 'map' || activeNav === 'ops' ? (
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
                  const anomalies: { id: string; msg: string; severity: 'danger' | 'warning' }[] = [];

                  // Delayed/Critical shipments
                  shipments.forEach((s: Shipment) => {
                    if (s.status === 'DELAYED') {
                      anomalies.push({
                        id: s.id,
                        msg: `${s.priority === 'CRITICAL' ? 'CRITICAL delay' : 'Delay detected'} — ${s.origin} → ${s.destination}${s.currentLocation ? ` (${s.currentLocation})` : ''}`,
                        severity: s.priority === 'CRITICAL' ? 'danger' : 'warning',
                      });
                    } else if (s.priority === 'CRITICAL' && s.status === 'IN_TRANSIT') {
                      anomalies.push({
                        id: s.id,
                        msg: `CRITICAL cargo en route — monitoring active. ${s.origin} → ${s.destination}`,
                        severity: 'warning',
                      });
                    }
                  });

                  // Congested warehouses
                  warehouses.forEach((wh: Warehouse) => {
                    const pct = Math.round((wh.currentLoad / wh.capacity) * 100);
                    if (wh.status === 'CONGESTED' || pct >= 90) {
                      anomalies.push({
                        id: wh.id,
                        msg: `${wh.location} hub exceeding ${pct}% capacity threshold`,
                        severity: pct >= 95 ? 'danger' : 'warning',
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

                  return anomalies.map(a => (
                    <motion.div key={a.id} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                      onClick={() => { if (a.id.startsWith('SHP')) handleSelectShipment(a.id); }}
                      style={{
                        flexShrink: 0, padding: '10px 14px', borderRadius: 10, cursor: a.id.startsWith('SHP') ? 'pointer' : 'default',
                        background: a.severity === 'danger' ? 'var(--danger-dim)' : 'var(--warning-dim)',
                        border: `1px solid ${a.severity === 'danger' ? 'rgba(244,63,94,0.25)' : 'rgba(245,158,11,0.25)'}`,
                        minWidth: 210, maxWidth: 280,
                      }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{
                          fontFamily: 'JetBrains Mono,monospace', fontSize: 11, fontWeight: 700,
                          color: a.severity === 'danger' ? 'var(--danger)' : 'var(--warning)'
                        }}>{a.id}</span>
                        <span style={{
                          fontSize: 9, padding: '1px 6px', borderRadius: 99, fontWeight: 700,
                          background: a.severity === 'danger' ? 'rgba(244,63,94,0.15)' : 'rgba(245,158,11,0.15)',
                          color: a.severity === 'danger' ? 'var(--danger)' : 'var(--warning)'
                        }}>{a.severity === 'danger' ? 'CRITICAL' : 'WARNING'}</span>
                      </div>
                      <p style={{ fontSize: 11, color: 'var(--text-normal)', lineHeight: 1.4 }}>{a.msg}</p>
                      {a.id.startsWith('SHP') && (
                        <div style={{ marginTop: 6, fontSize: 10, color: 'var(--primary)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                          Analyze Reroute <ChevronRight size={10} />
                        </div>
                      )}
                    </motion.div>
                  ));
                })()}
              </div>

            </div>

            {/* Carrier Fleet */}
            <div style={{ width: 380, borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <Activity size={14} color="var(--accent)" />
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Carrier Fleet</span>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {carriers.map((c: Carrier) => {
                  const typeColor = c.type === 'AIR' ? 'var(--primary)' : c.type === 'SEA' ? 'var(--accent)' : 'var(--success)';
                  return (
                    <div key={c.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '8px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                          width: 28, height: 28, borderRadius: 8, background: `${typeColor}18`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                          {c.type === 'AIR' ? <Zap size={13} color={typeColor} /> : c.type === 'SEA' ? <Navigation size={13} color={typeColor} /> : <Truck size={13} color={typeColor} />}
                        </div>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-bright)' }}>{c.name}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{c.id} · {c.type}</div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: c.reliability > 0.95 ? 'var(--success)' : 'var(--warning)' }}>
                          {(c.reliability * 100).toFixed(0)}%
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>reliability</div>
                      </div>
                    </div>
                  );
                })}
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
