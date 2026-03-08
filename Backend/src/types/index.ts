export type ShipmentStatus = 'PENDING' | 'IN_TRANSIT' | 'ARRIVED' | 'DELAYED' | 'CANCELLED';

export interface LatLng {
    lat: number;
    lng: number;
    label?: string; // optional waypoint name
}

export interface RouteAlternative {
    id: string;
    name: string;
    waypoints: LatLng[];
    etaDeltaHours: number; // relative to original ETA (negative = faster)
    riskScore: number;     // 0-1 (0=safe)
    reasoning: string;
    recommended: boolean;
}

export interface Shipment {
    id: string;
    origin: string;
    destination: string;
    carrierId: string;
    status: ShipmentStatus;
    eta: string;
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'REROUTED';
    currentLocation?: string;
    currentPosition?: LatLng;   // live geo position
    waypoints?: LatLng[];       // active route waypoints
    activeRoute?: string;       // 'direct' | alt route id
    rerouteHistory?: { timestamp: string; routeId: string; reason: string }[];
}

export interface Warehouse {
    id: string;
    location: string;
    capacity: number;
    currentLoad: number;
    status: 'OPERATIONAL' | 'CONGESTED' | 'MAINTENANCE';
    position?: LatLng;
}

export interface Carrier {
    id: string;
    name: string;
    reliability: number;
    cost: number;
    type: 'AIR' | 'SEA' | 'LAND';
    currentLocation?: string;
}

export interface Route {
    id: string;
    origin: string;
    destination: string;
    distance: number;
    estimatedTime: number;
}

export interface SimulationState {
    shipments: Shipment[];
    warehouses: Warehouse[];
    carriers: Carrier[];
    routes: Route[];
    timestamp: string;
}
