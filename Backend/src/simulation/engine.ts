import { SimulationState, Shipment, ShipmentStatus, LatLng, Warehouse, Carrier } from '../types';
import { supabase } from '../lib/supabase';
import { CORRIDORS, interpolatePosition } from './routes';
import { getShippoShipments, getWeatherForLocation } from '../api/external';

// Track simulation progress per shipment (0–1)
const shipmentProgress: Record<string, number> = {};

// ─── Shippo → internal Shipment mapper ───────────────────────────────────────
function mapShippoToShipment(raw: any, index: number): Shipment {
    const id = `SHP-${String(index + 1).padStart(3, '0')}`;
    const addressFrom = raw.address_from ?? {};
    const addressTo = raw.address_to ?? {};
    const origin = [addressFrom.city, addressFrom.country].filter(Boolean).join(', ') || 'Unknown';
    const destination = [addressTo.city, addressTo.country].filter(Boolean).join(', ') || 'Unknown';

    // Derive a rough status from Shippo status
    const shippoStatus: string = raw.status ?? '';
    let status: ShipmentStatus = 'PENDING';
    if (shippoStatus === 'TRANSIT') status = 'IN_TRANSIT';
    else if (shippoStatus === 'DELIVERED') status = 'ARRIVED';
    else if (shippoStatus === 'FAILURE' || shippoStatus === 'RETURNED') status = 'CANCELLED';
    else if (shippoStatus === 'DELAYED') status = 'DELAYED';

    const eta = raw.eta ?? new Date(Date.now() + 7 * 86400000).toISOString();
    const priority = index === 0 ? 'HIGH' : index === 1 ? 'CRITICAL' : 'MEDIUM';

    return {
        id,
        origin,
        destination,
        carrierId: raw.carrier ?? 'CRR-001',
        status,
        eta,
        priority,
        currentLocation: raw.tracking_status?.location?.city ?? undefined,
        waypoints: CORRIDORS[id]?.direct ?? [],
        activeRoute: 'direct',
        rerouteHistory: [],
    };
}

// ─── Supabase fetchers ────────────────────────────────────────────────────────
async function fetchWarehousesFromSupabase(): Promise<Warehouse[]> {
    const { data, error } = await supabase.from('warehouses').select('*');
    if (error || !data || data.length === 0) {
        console.warn('[Engine] Supabase warehouses unavailable, using seed data:', error?.message);
        return SEED_WAREHOUSES;
    }
    return data.map((w: any) => ({
        id: w.id,
        location: w.name ?? w.location ?? w.city ?? w.id.slice(0, 8),
        capacity: Number(w.capacity) || 1000,
        currentLoad: Number(w.current_load ?? w.currentLoad) || 0,
        status: w.status ?? 'OPERATIONAL',
        position: (w.lat && w.lng) ? { lat: Number(w.lat), lng: Number(w.lng) } : undefined,
    }));
}

async function fetchCarriersFromSupabase(): Promise<Carrier[]> {
    const { data, error } = await supabase.from('carriers').select('*');
    if (error || !data || data.length === 0) {
        console.warn('[Engine] Supabase carriers unavailable, using seed data:', error?.message);
        return SEED_CARRIERS;
    }
    return data.map((c: any) => ({
        id: c.id,
        name: c.name,
        reliability: Number(c.reliability_score ?? c.reliability ?? c.on_time_pickup_rate ?? 0.90),
        cost: Number(c.cost ?? c.rate ?? 5000),
        type: c.carrier_type ?? c.type ?? 'SEA',
        currentLocation: c.current_location ?? undefined,
    }));
}

// ─── Fallback seed data (used only if Supabase tables are empty/unreachable) ──
const SEED_WAREHOUSES: Warehouse[] = [
    { id: 'WH-001', location: 'Mumbai', capacity: 1000, currentLoad: 850, status: 'OPERATIONAL', position: { lat: 18.96, lng: 72.82 } },
    { id: 'WH-002', location: 'Dubai', capacity: 2000, currentLoad: 1900, status: 'CONGESTED', position: { lat: 25.27, lng: 55.30 } },
    { id: 'WH-003', location: 'Chennai', capacity: 1500, currentLoad: 600, status: 'OPERATIONAL', position: { lat: 13.08, lng: 80.27 } },
];
const SEED_CARRIERS: Carrier[] = [
    { id: 'CRR-001', name: 'Global Maritime', reliability: 0.95, cost: 5000, type: 'SEA' },
    { id: 'CRR-002', name: 'Swift Air Cargo', reliability: 0.98, cost: 15000, type: 'AIR' },
    { id: 'CRR-003', name: 'Euro Logistic Line', reliability: 0.92, cost: 3000, type: 'LAND' },
];

// ─── Shippo shipments (with corridor fallback) ────────────────────────────────
async function fetchShipmentsLive(): Promise<Shipment[]> {
    const raw = await getShippoShipments();
    if (raw.length > 0) {
        const mapped = raw.slice(0, 8).map((r, i) => mapShippoToShipment(r, i));
        // Inject CORRIDORS waypoints where available
        mapped.forEach(s => {
            const corridor = CORRIDORS[s.id];
            if (corridor) {
                s.waypoints = corridor.direct;
                s.activeRoute = 'direct';
                shipmentProgress[s.id] = shipmentProgress[s.id] ?? 0.3;
                s.currentPosition = interpolatePosition(corridor.direct, shipmentProgress[s.id]);
            }
        });
        console.log(`[Engine] Loaded ${mapped.length} shipments from Shippo.`);
        return mapped;
    }

    // Fallback: create seed shipments from CORRIDORS (no raw hardcoded arrays)
    console.warn('[Engine] Shippo returned no shipments — using corridor seed shipments.');
    return Object.entries(CORRIDORS).map(([id, corridor], i) => {
        const labels = corridor.direct;
        const origin = labels[0]?.label ?? 'Unknown';
        const dest = labels[labels.length - 1]?.label ?? 'Unknown';
        const priorities: Shipment['priority'][] = ['HIGH', 'MEDIUM', 'LOW', 'CRITICAL'];
        const statuses: ShipmentStatus[] = ['IN_TRANSIT', 'IN_TRANSIT', 'PENDING', 'DELAYED'];
        const daysOffset = [4, 1, 6, 7];

        shipmentProgress[id] = shipmentProgress[id] ?? [0.45, 0.60, 0.10, 0.30][i] ?? 0.3;
        return {
            id,
            origin,
            destination: dest,
            carrierId: `CRR-00${(i % 3) + 1}`,
            status: statuses[i] ?? 'PENDING',
            eta: new Date(Date.now() + daysOffset[i] * 86400000).toISOString(),
            priority: priorities[i] ?? 'MEDIUM',
            currentLocation: labels[Math.floor(labels.length / 2)]?.label,
            waypoints: corridor.direct,
            activeRoute: 'direct',
            rerouteHistory: [],
            currentPosition: interpolatePosition(corridor.direct, shipmentProgress[id]),
        };
    });
}

// ─── Engine ───────────────────────────────────────────────────────────────────
export class SimulationEngine {
    private state: SimulationState;
    private initialized = false;

    constructor() {
        // Start with empty state — will be filled on first async load
        this.state = {
            shipments: [],
            warehouses: SEED_WAREHOUSES,
            carriers: SEED_CARRIERS,
            routes: [],
            timestamp: new Date().toISOString(),
        };
    }

    async initialize() {
        if (this.initialized) return;
        this.initialized = true;

        const [warehouses, carriers, shipments] = await Promise.all([
            fetchWarehousesFromSupabase(),
            fetchCarriersFromSupabase(),
            fetchShipmentsLive(),
        ]);

        this.state.warehouses = warehouses;
        this.state.carriers = carriers;
        this.state.shipments = shipments;
        this.state.timestamp = new Date().toISOString();

        // Assign warehouse positions from known geo-cache
        const warehouseGeo: Record<string, LatLng> = {
            'Mumbai': { lat: 18.96, lng: 72.82 },
            'Dubai': { lat: 25.27, lng: 55.30 },
            'Chennai': { lat: 13.08, lng: 80.27 },
            'Singapore': { lat: 1.29, lng: 103.85 },
            'Shanghai': { lat: 31.23, lng: 121.47 },
            'London': { lat: 51.50, lng: -0.12 },
            'New York': { lat: 40.71, lng: -74.01 },
            'Los Angeles': { lat: 33.95, lng: -118.40 },
        };
        this.state.warehouses.forEach(w => {
            if (!w.position) {
                const geo = warehouseGeo[w.location];
                if (geo) w.position = geo;
            }
        });

        console.log(`[Engine] Initialized — ${shipments.length} shipments, ${warehouses.length} warehouses, ${carriers.length} carriers.`);
    }

    getState(): SimulationState {
        return this.state;
    }

    updateShipmentStatus(id: string, status: ShipmentStatus) {
        const shipment = this.state.shipments.find(s => s.id === id);
        if (shipment) shipment.status = status;
    }

    rerouteShipment(id: string, routeId: string) {
        const shipment = this.state.shipments.find(s => s.id === id);
        const corridor = CORRIDORS[id];
        if (!shipment || !corridor) return null;

        const alt = corridor.alternatives.find(a => a.id === routeId);
        if (!alt) return null;

        shipment.waypoints = alt.waypoints;
        shipment.activeRoute = routeId;

        if (shipment.status === 'DELAYED' || shipment.status === 'PENDING') {
            shipment.status = 'IN_TRANSIT';
        }
        shipment.priority = 'REROUTED';

        const currentEta = new Date(shipment.eta);
        currentEta.setHours(currentEta.getHours() + alt.etaDeltaHours);
        shipment.eta = currentEta.toISOString();

        shipment.rerouteHistory = shipment.rerouteHistory || [];
        shipment.rerouteHistory.push({
            timestamp: new Date().toISOString(),
            routeId,
            reason: alt.reasoning,
        });

        this.addEvent(`[REROUTE] Shipment ${id} rerouted to "${alt.name}" → status set to IN_TRANSIT. (+${alt.etaDeltaHours}h ETA)`);
        return alt;
    }

    addEvent(event: string) {
        console.log(`[Simulation Event] ${new Date().toISOString()}: ${event}`);
    }

    async tick() {
        this.state.timestamp = new Date().toISOString();

        this.state.shipments.forEach(s => {
            if (s.status === 'IN_TRANSIT' || s.status === 'DELAYED') {
                const speed = s.status === 'DELAYED' ? 0.001 : 0.003;
                shipmentProgress[s.id] = Math.min(1, (shipmentProgress[s.id] || 0) + speed);

                const waypoints = s.waypoints || CORRIDORS[s.id]?.direct || [];
                s.currentPosition = interpolatePosition(waypoints, shipmentProgress[s.id]);

                if (Math.random() < 0.02) {
                    s.status = s.status === 'DELAYED' ? 'IN_TRANSIT' : 'DELAYED';
                    this.addEvent(`Shipment ${s.id} status flipped to ${s.status}.`);
                }
            }
        });
    }

    async refreshShipments() {
        const fresh = await fetchShipmentsLive();
        // Preserve reroute history and current progress for existing shipments
        const existingMap = new Map(this.state.shipments.map(s => [s.id, s]));
        this.state.shipments = fresh.map(s => {
            const existing = existingMap.get(s.id);
            if (existing) {
                return {
                    ...s,
                    rerouteHistory: existing.rerouteHistory,
                    currentPosition: existing.currentPosition,
                    waypoints: existing.waypoints,
                    activeRoute: existing.activeRoute,
                };
            }
            return s;
        });
        console.log('[Engine] Shipments refreshed from Shippo.');
    }

    async start(intervalMs: number = 5000) {
        await this.initialize();
        console.log('Simulation started with live API data.');
        setInterval(async () => {
            await this.tick();
            if (Math.random() < 0.3) {
                const { agent } = await import('../agent');
                await agent.runStep();
            }
        }, intervalMs);

        // Refresh shipments from Shippo every 5 minutes
        setInterval(() => this.refreshShipments(), 5 * 60 * 1000);
    }
}

export const simulationEngine = new SimulationEngine();
