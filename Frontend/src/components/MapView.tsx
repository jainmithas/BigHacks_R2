import React, { useEffect, useRef } from 'react';
import {
    MapContainer, TileLayer, Marker, Polyline,
    Popup, ZoomControl, useMap
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/* ─── Fix default icon path (Vite/Leaflet quirk) ─── */
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

/* ─── Custom ship icon factory ─── */
const makeShipIcon = (color: string, label: string, pulse: boolean) =>
    L.divIcon({
        className: '',
        iconSize: [38, 38],
        iconAnchor: [19, 19],
        html: `
      <div style="
        position:relative; width:38px; height:38px;
        display:flex; align-items:center; justify-content:center;
      ">
        ${pulse ? `<span style="
          position:absolute; inset:0; border-radius:50%;
          background:${color}; opacity:0.20;
          animation:leaflet-pulse 1.8s ease-out infinite;
        "></span>` : ''}
        <div style="
          width:28px; height:28px; border-radius:50%;
          background:#0d1520;
          border:2.5px solid ${color};
          box-shadow:0 2px 8px rgba(0,0,0,0.55), 0 0 10px ${color}77;
          display:flex; align-items:center; justify-content:center;
        ">
          <span style="
            font-size:7px; font-weight:800; color:${color};
            font-family:monospace; letter-spacing:-0.5px;
          ">${label}</span>
        </div>
      </div>
    `,
    });

/* ─── Warehouse icon ─── */
const warehouseIcon = (congested: boolean) =>
    L.divIcon({
        className: '',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        html: `<div style="
      width:24px; height:24px; border-radius:4px;
      background:${congested ? '#f43f5e22' : '#22d3a722'};
      border:1.5px solid ${congested ? '#f43f5e' : '#22d3a7'};
      display:flex; align-items:center; justify-content:center;
      font-size:9px; font-weight:800; color:${congested ? '#f43f5e' : '#22d3a7'};
      font-family:monospace;
    ">WH</div>`,
    });

/* ─── Status colour mapping ─── */
const STATUS_COLOR: Record<string, string> = {
    IN_TRANSIT: '#00d4ff',
    DELAYED: '#f43f5e',
    PENDING: '#f59e0b',
    ARRIVED: '#22d3a7',
    CANCELLED: '#a855f7',
};

/* ─── Auto-pan to a position — fires only when the selected ID changes, not on every position poll ─── */
const FlyTo = ({ pos, selectedId }: { pos: [number, number] | null; selectedId: string | null }) => {
    const map = useMap();
    const lastFiredId = useRef<string | null>(null);
    useEffect(() => {
        if (pos && selectedId && selectedId !== lastFiredId.current) {
            lastFiredId.current = selectedId;
            map.flyTo(pos, 6, { duration: 1.2 });
        }
    }, [selectedId, pos, map]);
    return null;
};

/* ─── Props ─── */
interface MapViewProps {
    shipments: any[];
    warehouses: any[];
    selected: string | null;
    onSelect: (id: string) => void;
}

/* ─── Main component ─── */
const MapView: React.FC<MapViewProps> = ({ shipments, warehouses, selected, onSelect }) => {
    const selectedShipment = shipments.find(s => s.id === selected);

    const flyTarget: [number, number] | null =
        selectedShipment?.currentPosition
            ? [selectedShipment.currentPosition.lat, selectedShipment.currentPosition.lng]
            : null;

    return (
        <div style={{ width: '100%', height: '100%', position: 'relative', borderRadius: 'inherit', overflow: 'hidden' }}>
            {/* Leaflet pulse keyframe injection */}
            <style>{`
        @keyframes leaflet-pulse {
          0%   { transform: scale(1); opacity: 0.5; }
          100% { transform: scale(3); opacity: 0; }
        }
        /* Physical map: natural colors, gently muted — no hue shift */
        .leaflet-container { background: #a8c8d8 !important; }
        .leaflet-tile {
          filter:
            brightness(0.87)
            saturate(0.72)
            contrast(0.93) !important;
        }
        .leaflet-popup-content-wrapper {
          background: rgba(8,18,24,0.95) !important;
          border: 1px solid rgba(0,196,210,0.18) !important;
          border-radius: 12px !important; color: #d8eef2 !important;
          box-shadow: 0 0 24px rgba(0,0,0,0.55) !important;
        }
        .leaflet-popup-tip { background: rgba(8,18,24,0.95) !important; }
        .leaflet-popup-close-button { color: #6ab4c0 !important; }
      `}</style>

            <MapContainer
                center={[20, 80]}
                zoom={3}
                minZoom={2}
                maxZoom={10}
                zoomControl={false}
                style={{ width: '100%', height: '100%' }}
                worldCopyJump
            >
                <TileLayer
                    url="https://tile.opentopomap.org/{z}/{x}/{y}.png"
                    attribution='&copy; <a href="https://opentopomap.org">OpenTopoMap</a> contributors (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)'
                    maxZoom={17}
                />
                <ZoomControl position="bottomright" />

                {flyTarget && <FlyTo pos={flyTarget} selectedId={selected} />}

                {/* ── Warehouse Markers ── */}
                {warehouses.map((wh: any) =>
                    wh.position ? (
                        <Marker
                            key={wh.id}
                            position={[wh.position.lat, wh.position.lng]}
                            icon={warehouseIcon(wh.status === 'CONGESTED')}
                        >
                            <Popup>
                                <div style={{ fontFamily: 'JetBrains Mono,monospace', minWidth: 180 }}>
                                    <div style={{ fontSize: 11, fontWeight: 800, color: wh.status === 'CONGESTED' ? '#f43f5e' : '#22d3a7', marginBottom: 6 }}>
                                        {wh.id} — {wh.location}
                                    </div>
                                    <div style={{ fontSize: 11, color: '#888' }}>Status: <b style={{ color: '#e0e0e6' }}>{wh.status}</b></div>
                                    <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                                        Load: <b style={{ color: '#e0e0e6' }}>{Math.round(wh.currentLoad / wh.capacity * 100)}%</b>
                                        &nbsp;({wh.currentLoad}/{wh.capacity})
                                    </div>
                                </div>
                            </Popup>
                        </Marker>
                    ) : null
                )}

                {/* ── Shipment Markers + Routes ── */}
                {shipments.map((shp: any) => {
                    const color = STATUS_COLOR[shp.status] || '#aaa';
                    const isSelected = shp.id === selected;
                    const waypoints = shp.waypoints || [];

                    return (
                        <React.Fragment key={`${shp.id}-${shp.status}`}>
                            {/* Original / active route polyline */}
                            {waypoints.length > 1 && (
                                <Polyline
                                    key={`poly-${shp.id}-${shp.status}-${shp.activeRoute}`}
                                    positions={waypoints.map((w: any) => [w.lat, w.lng])}
                                    pathOptions={{
                                        color: isSelected ? color : `${color}55`,
                                        weight: isSelected ? 2.5 : 1.5,
                                        dashArray: shp.status === 'DELAYED' ? '8 6' : undefined,
                                        opacity: 1,
                                    }}
                                />
                            )}

                            {/* Ship position marker */}
                            {shp.currentPosition && (
                                <Marker
                                    key={`marker-${shp.id}-${shp.status}`}
                                    position={[shp.currentPosition.lat, shp.currentPosition.lng]}
                                    icon={makeShipIcon(color, shp.id.slice(-3), shp.status === 'DELAYED')}
                                    eventHandlers={{ click: () => onSelect(shp.id) }}
                                >
                                    <Popup>
                                        <div style={{ fontFamily: 'JetBrains Mono,monospace', minWidth: 200 }}>
                                            <div style={{ fontSize: 12, fontWeight: 800, color, marginBottom: 6 }}>{shp.id}</div>
                                            <div style={{ fontSize: 11, color: '#aaa' }}>{shp.origin} → {shp.destination}</div>
                                            <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
                                                <span style={{ fontSize: 10, background: `${color}22`, color, padding: '2px 7px', borderRadius: 99, border: `1px solid ${color}44`, fontWeight: 700 }}>{shp.status}</span>
                                                <span style={{ fontSize: 10, background: 'rgba(255,255,255,0.05)', color: '#aaa', padding: '2px 7px', borderRadius: 99, fontWeight: 700 }}>{shp.priority}</span>
                                            </div>
                                            <div style={{ fontSize: 11, color: '#666', marginTop: 6 }}>ETA: {new Date(shp.eta).toLocaleDateString()}</div>
                                            {shp.currentLocation && <div style={{ fontSize: 11, color: '#666' }}>📍 {shp.currentLocation}</div>}
                                            {(shp.status === 'DELAYED' || shp.priority === 'CRITICAL') && (
                                                <button
                                                    onClick={() => onSelect(shp.id)}
                                                    style={{
                                                        marginTop: 10, width: '100%', padding: '7px 0',
                                                        background: `${color}22`, border: `1px solid ${color}55`,
                                                        color, borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer'
                                                    }}
                                                >
                                                    Analyze Reroute →
                                                </button>
                                            )}
                                        </div>
                                    </Popup>
                                </Marker>
                            )}
                        </React.Fragment>
                    );
                })}
            </MapContainer>
        </div>
    );
};

export default MapView;
