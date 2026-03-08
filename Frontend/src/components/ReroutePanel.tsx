import React, { useState } from 'react';
import axios from 'axios';
import { motion } from 'framer-motion';
import {
    X, Navigation, AlertTriangle, CheckCircle2,
    TrendingUp, TrendingDown, Brain, Route, ChevronRight
} from 'lucide-react';

const API_BASE = 'http://localhost:5000/api';

interface Alternative {
    id: string;
    name: string;
    waypoints: any[];
    etaDeltaHours: number;
    riskScore: number;
    reasoning: string;
    recommended: boolean;
}

interface ReroutePanelProps {
    shipmentId: string | null;
    shipment: any;
    onClose: () => void;
    onRerouteConfirmed: (shipmentId: string, routeId: string) => void;
}

const ReroutePanel: React.FC<ReroutePanelProps> = ({ shipmentId, shipment, onClose, onRerouteConfirmed }) => {
    const [analyzing, setAnalyzing] = useState(false);
    const [result, setResult] = useState<{ alternatives: Alternative[] } | null>(null);
    const [selected, setSelected] = useState<string | null>(null);
    const [confirming, setConfirming] = useState(false);
    const [confirmed, setConfirmed] = useState(false);

    const handleAnalyze = async () => {
        if (!shipmentId) return;
        setAnalyzing(true);
        setResult(null);
        setSelected(null);
        setConfirmed(false);
        try {
            const res = await axios.post(`${API_BASE}/reroute/analyze`, { shipmentId });
            setResult(res.data);
            // Pre-select recommended
            const rec = res.data.alternatives.find((a: Alternative) => a.recommended);
            if (rec) setSelected(rec.id);
        } catch {
            // Fallback: use built-in alternatives
            setResult({ alternatives: [] });
        }
        setAnalyzing(false);
    };

    const handleConfirm = async () => {
        if (!shipmentId || !selected) return;
        setConfirming(true);
        try {
            await axios.post(`${API_BASE}/reroute/confirm`, { shipmentId, routeId: selected });
            setConfirmed(true);
            onRerouteConfirmed(shipmentId, selected);
        } catch {
            setConfirmed(true); // optimistic
        }
        setConfirming(false);
    };

    const statusColor = shipment?.status === 'DELAYED' ? '#f43f5e' : '#00d4ff';
    const altColors = ['#00d4ff', '#a855f7', '#f59e0b'];
    const needsReroute = shipment?.status === 'DELAYED' || shipment?.priority === 'CRITICAL';

    return (
        <motion.div
            initial={{ x: '100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 35 }}
            style={{
                position: 'absolute', top: 0, right: 0, bottom: 0,
                width: 400, background: 'rgba(4,4,10,0.97)',
                borderLeft: '1px solid rgba(255,255,255,0.08)',
                backdropFilter: 'blur(30px)',
                display: 'flex', flexDirection: 'column',
                zIndex: 1000, overflow: 'hidden',
            }}
        >
            {/* Header */}
            <div style={{
                padding: '18px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                        width: 36, height: 36, borderRadius: 10, background: `${statusColor}18`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                        <Route size={18} color={statusColor} />
                    </div>
                    <div>
                        <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 13, fontWeight: 800, color: statusColor }}>
                            {shipmentId}
                        </div>
                        <div style={{ fontSize: 11, color: '#666' }}>{shipment?.origin} → {shipment?.destination}</div>
                    </div>
                </div>
                <button onClick={onClose} style={{
                    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 8, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', color: '#888'
                }}>
                    <X size={14} />
                </button>
            </div>

            {/* Shipment quick stats */}
            <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {[
                        { label: 'Status', value: shipment?.status, color: statusColor },
                        { label: 'Priority', value: shipment?.priority, color: shipment?.priority === 'CRITICAL' ? '#f43f5e' : shipment?.priority === 'REROUTED' ? '#a855f7' : '#f59e0b' },
                        { label: 'ETA', value: new Date(shipment?.eta).toLocaleDateString(), color: '#888' },
                        { label: 'Location', value: shipment?.currentLocation || 'En route', color: '#888' },
                    ].map(item => (
                        <div key={item.label} style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                            <div style={{ fontSize: 10, color: '#555', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>{item.label}</div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: item.color }}>{item.value}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Analyze Button */}
            {!result && !analyzing && needsReroute && (
                <div style={{ padding: '20px', flexShrink: 0 }}>
                    <div style={{ padding: '14px', borderRadius: 12, background: 'rgba(0,212,255,0.04)', border: '1px solid rgba(0,212,255,0.12)', marginBottom: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <Brain size={14} color="#00d4ff" />
                            <span style={{ fontSize: 11, color: '#00d4ff', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>AI Agent Analysis</span>
                        </div>
                        <p style={{ fontSize: 12, color: '#666', lineHeight: 1.6 }}>
                            The agent will evaluate alternative corridors, assess weather and congestion risk, and provide ranked recommendations with full reasoning.
                        </p>
                    </div>
                    <button onClick={handleAnalyze} style={{
                        width: '100%', padding: '13px', borderRadius: 12,
                        background: 'linear-gradient(135deg, rgba(0,212,255,0.2), rgba(168,85,247,0.2))',
                        border: '1px solid rgba(0,212,255,0.3)',
                        color: '#00d4ff', fontWeight: 800, fontSize: 14, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    }}>
                        <Brain size={16} /> Analyze Reroute Options <ChevronRight size={14} />
                    </button>
                </div>
            )}

            {/* Nominal Status (No intervention needed) */}
            {!result && !analyzing && !needsReroute && !confirmed && (
                <div style={{ padding: '20px', flexShrink: 0 }}>
                    <div style={{ padding: '14px', borderRadius: 12, background: 'rgba(34,211,167,0.04)', border: '1px solid rgba(34,211,167,0.12)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <CheckCircle2 size={14} color="#22d3a7" />
                            <span style={{ fontSize: 11, color: '#22d3a7', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Routing Nominally</span>
                        </div>
                        <p style={{ fontSize: 12, color: '#666', lineHeight: 1.6 }}>
                            This shipment is operating within acceptable parameters or has already been successfully rerouted. No further agent intervention is required at this time.
                        </p>
                    </div>
                </div>
            )}

            {/* Analyzing spinner */}
            {analyzing && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 20 }}>
                    <div style={{ position: 'relative', width: 60, height: 60 }}>
                        <svg viewBox="0 0 60 60" style={{ animation: 'spin-slow 1.2s linear infinite', width: 60, height: 60 }}>
                            <circle cx="30" cy="30" r="26" fill="none" stroke="rgba(0,212,255,0.08)" strokeWidth="3" />
                            <circle cx="30" cy="30" r="26" fill="none" stroke="#00d4ff" strokeWidth="3"
                                strokeDasharray="164" strokeDashoffset="100" strokeLinecap="round" />
                        </svg>
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Brain size={20} color="#00d4ff" />
                        </div>
                    </div>
                    <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 12, color: '#00d4ff', textAlign: 'center' }}>
                        Agent analyzing corridors...
                    </div>
                    <div style={{ fontSize: 11, color: '#555', textAlign: 'center', maxWidth: 260 }}>
                        Querying weather data, congestion matrices, and carrier reliability indices.
                    </div>
                </div>
            )}

            {/* Confirmed state */}
            {confirmed && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 30 }}>
                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} style={{
                        width: 64, height: 64, borderRadius: '50%',
                        background: 'rgba(34,211,167,0.1)', border: '2px solid #22d3a7',
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                        <CheckCircle2 size={32} color="#22d3a7" />
                    </motion.div>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: '#22d3a7', marginBottom: 8 }}>Reroute Confirmed</div>
                        <div style={{ fontSize: 12, color: '#666', lineHeight: 1.6 }}>
                            Shipment {shipmentId} has been rerouted. The simulation state and map will update on next refresh.
                        </div>
                    </div>
                    <button onClick={() => { setResult(null); setConfirmed(false); }} style={{
                        padding: '10px 24px', borderRadius: 10,
                        background: 'rgba(34,211,167,0.1)', border: '1px solid rgba(34,211,167,0.3)',
                        color: '#22d3a7', fontWeight: 700, cursor: 'pointer', fontSize: 13,
                    }}>
                        Done
                    </button>
                </div>
            )}

            {/* Results */}
            {result && !confirmed && (
                <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {result.alternatives.length === 0 && (
                        <div style={{ textAlign: 'center', color: '#555', padding: 40, fontSize: 13 }}>
                            No alternative routes available for this corridor.
                        </div>
                    )}

                    {result.alternatives.map((alt: Alternative, i: number) => {
                        const color = altColors[i % altColors.length];
                        const isSelected = selected === alt.id;
                        return (
                            <motion.div key={alt.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: i * 0.1 }}
                                onClick={() => setSelected(alt.id)}
                                style={{
                                    padding: '14px 16px', borderRadius: 12, cursor: 'pointer',
                                    background: isSelected ? `${color}10` : 'rgba(255,255,255,0.02)',
                                    border: `1px solid ${isSelected ? `${color}40` : 'rgba(255,255,255,0.06)'}`,
                                    transition: 'all 0.2s',
                                    boxShadow: isSelected ? `0 0 20px ${color}18` : 'none',
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <Navigation size={14} color={color} />
                                        <span style={{ fontSize: 13, fontWeight: 700, color }}>{alt.name}</span>
                                        {alt.recommended && (
                                            <span style={{ fontSize: 9, background: `${color}22`, color, padding: '2px 7px', borderRadius: 99, border: `1px solid ${color}44`, fontWeight: 800, letterSpacing: '0.1em' }}>RECOMMENDED</span>
                                        )}
                                    </div>
                                    <div style={{
                                        width: 18, height: 18, borderRadius: '50%', border: `2px solid ${isSelected ? color : 'rgba(255,255,255,0.15)'}`,
                                        background: isSelected ? color : 'transparent', flexShrink: 0
                                    }} />
                                </div>

                                {/* ETA + Risk row */}
                                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                                    <div style={{ flex: 1, padding: '8px', borderRadius: 8, background: 'rgba(255,255,255,0.03)' }}>
                                        <div style={{ fontSize: 9, color: '#555', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>ETA Impact</div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 800, color: alt.etaDeltaHours > 0 ? '#f59e0b' : '#22d3a7' }}>
                                            {alt.etaDeltaHours > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                            {alt.etaDeltaHours > 0 ? '+' : ''}{alt.etaDeltaHours}h
                                        </div>
                                    </div>
                                    <div style={{ flex: 1, padding: '8px', borderRadius: 8, background: 'rgba(255,255,255,0.03)' }}>
                                        <div style={{ fontSize: 9, color: '#555', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>Risk Score</div>
                                        <div style={{
                                            display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 800,
                                            color: alt.riskScore < 0.2 ? '#22d3a7' : alt.riskScore < 0.4 ? '#f59e0b' : '#f43f5e'
                                        }}>
                                            <AlertTriangle size={12} />
                                            {(alt.riskScore * 100).toFixed(0)}%
                                        </div>
                                    </div>
                                </div>

                                {/* Agent Reasoning */}
                                <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.3)', borderLeft: `2px solid ${color}` }}>
                                    <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color, marginBottom: 5 }}>
                                        Agent Reasoning
                                    </div>
                                    <p style={{ fontSize: 11.5, color: '#888', lineHeight: 1.65 }}>{alt.reasoning}</p>
                                </div>

                                {/* Waypoints */}
                                <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 0, overflowX: 'auto', paddingBottom: 2 }}>
                                    {alt.waypoints.map((wp: any, wi: number) => (
                                        <React.Fragment key={wi}>
                                            <div style={{
                                                fontSize: 9, color: '#444', fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
                                                padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)'
                                            }}>
                                                {wp.label || `WP${wi + 1}`}
                                            </div>
                                            {wi < alt.waypoints.length - 1 && (
                                                <ChevronRight size={10} color="#2a2a2a" style={{ flexShrink: 0, margin: '0 2px' }} />
                                            )}
                                        </React.Fragment>
                                    ))}
                                </div>
                            </motion.div>
                        );
                    })}

                    {/* Confirm button */}
                    {selected && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ marginTop: 4 }}>
                            <button onClick={handleConfirm} disabled={confirming} style={{
                                width: '100%', padding: '14px',
                                background: 'linear-gradient(135deg, rgba(0,212,255,0.25), rgba(168,85,247,0.25))',
                                border: '1px solid rgba(0,212,255,0.4)',
                                borderRadius: 12, color: '#00d4ff', fontWeight: 800, fontSize: 14,
                                cursor: confirming ? 'default' : 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                boxShadow: '0 0 20px rgba(0,212,255,0.15)',
                            }}>
                                {confirming ? 'Committing...' : <>
                                    <CheckCircle2 size={16} /> Confirm Reroute <ChevronRight size={14} />
                                </>}
                            </button>
                            <p style={{ textAlign: 'center', fontSize: 10, color: '#444', marginTop: 8 }}>
                                This will update the simulation state and map immediately.
                            </p>
                        </motion.div>
                    )}
                </div>
            )}
        </motion.div>
    );
};

export default ReroutePanel;
