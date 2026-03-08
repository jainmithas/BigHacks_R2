/**
 * external.ts — Live API adapters for Shippo, WeatherAPI, GraphHopper, and MyShipTracking.
 * ALL secrets are read from process.env (populated by .env via dotenv).
 */
import axios from 'axios';
import { LatLng } from '../types';

// ─── Shippo ───────────────────────────────────────────────────────────────────
const SHIPPO_BASE = 'https://api.goshippo.com';

export async function getShippoShipments(): Promise<any[]> {
    const key = process.env.SHIPPO_API_KEY;
    if (!key) throw new Error('Missing SHIPPO_API_KEY in environment');
    try {
        const res = await axios.get(`${SHIPPO_BASE}/shipments/?results=10`, {
            headers: { Authorization: `ShippoToken ${key}` },
            timeout: 10000,
        });
        return res.data?.results ?? [];
    } catch (err: any) {
        console.error('[Shippo] Error fetching shipments:', err.message);
        return [];
    }
}

export async function getShippoRates(shipmentObjectId: string): Promise<any[]> {
    const key = process.env.SHIPPO_API_KEY;
    if (!key) throw new Error('Missing SHIPPO_API_KEY in environment');
    try {
        const res = await axios.get(`${SHIPPO_BASE}/shipments/${shipmentObjectId}/rates/`, {
            headers: { Authorization: `ShippoToken ${key}` },
            timeout: 10000,
        });
        return res.data?.results ?? [];
    } catch (err: any) {
        console.error('[Shippo] Error fetching rates:', err.message);
        return [];
    }
}

// ─── WeatherAPI ───────────────────────────────────────────────────────────────
const WEATHER_BASE = 'https://api.weatherapi.com/v1';

export interface WeatherCondition {
    location: string;
    temp_c: number;
    condition: string;
    wind_kph: number;
    wind_dir: string;
    humidity: number;
    visibility_km: number;
    is_day: number;
}

export async function getWeatherForLocation(query: string): Promise<WeatherCondition | null> {
    const key = process.env.WEATHER_API_KEY;
    if (!key) throw new Error('Missing WEATHER_API_KEY in environment');
    try {
        const res = await axios.get(`${WEATHER_BASE}/current.json`, {
            params: { key, q: query },
            timeout: 10000,
        });
        const d = res.data;
        return {
            location: d.location?.name ?? query,
            temp_c: d.current?.temp_c ?? 0,
            condition: d.current?.condition?.text ?? 'Unknown',
            wind_kph: d.current?.wind_kph ?? 0,
            wind_dir: d.current?.wind_dir ?? '',
            humidity: d.current?.humidity ?? 0,
            visibility_km: d.current?.vis_km ?? 0,
            is_day: d.current?.is_day ?? 1,
        };
    } catch (err: any) {
        console.error('[WeatherAPI] Error for', query, ':', err.message);
        return null;
    }
}

export async function getWeatherForecast(query: string, days = 3): Promise<any | null> {
    const key = process.env.WEATHER_API_KEY;
    if (!key) throw new Error('Missing WEATHER_API_KEY in environment');
    try {
        const res = await axios.get(`${WEATHER_BASE}/forecast.json`, {
            params: { key, q: query, days, aqi: 'no', alerts: 'yes' },
            timeout: 10000,
        });
        return res.data;
    } catch (err: any) {
        console.error('[WeatherAPI] Forecast error for', query, ':', err.message);
        return null;
    }
}

// ─── GraphHopper ─────────────────────────────────────────────────────────────
const GH_BASE = 'https://graphhopper.com/api/1';

export async function getGraphHopperRoute(
    points: [number, number][],  // [lat, lng][]
    vehicle: 'car' | 'foot' | 'bike' = 'car'
): Promise<LatLng[] | null> {
    const key = process.env.GRAPHOPPER_API_KEY;
    if (!key) throw new Error('Missing GRAPHOPPER_API_KEY in environment');
    try {
        const res = await axios.get(`${GH_BASE}/route`, {
            params: {
                key,
                vehicle,
                point: points.map(p => `${p[0]},${p[1]}`),
                points_encoded: false,
                locale: 'en',
            },
            timeout: 15000,
        });
        const path = res.data?.paths?.[0];
        if (!path) return null;
        // path.points.coordinates is [lng, lat, elevation?]
        return path.points.coordinates.map((c: number[]) => ({ lat: c[1], lng: c[0] }));
    } catch (err: any) {
        console.error('[GraphHopper] Error getting route:', err.message);
        return null;
    }
}

export async function geocodeLocation(query: string): Promise<LatLng | null> {
    const key = process.env.GRAPHOPPER_API_KEY;
    if (!key) throw new Error('Missing GRAPHOPPER_API_KEY in environment');
    try {
        const res = await axios.get(`${GH_BASE}/geocode`, {
            params: { key, q: query, limit: 1, locale: 'en' },
            timeout: 10000,
        });
        const hit = res.data?.hits?.[0];
        if (!hit) return null;
        return { lat: hit.point.lat, lng: hit.point.lng, label: hit.name ?? query };
    } catch (err: any) {
        console.error('[GraphHopper] Geocode error for', query, ':', err.message);
        return null;
    }
}

// ─── MyShipTracking ──────────────────────────────────────────────────────────
const MST_BASE = 'https://api.myshiptracking.com/api/v2';

export interface VesselPosition {
    vessel_name: string;
    mmsi: number;
    lat: number;
    lng: number;
    speed: number;
    course: number;
    nav_status: string | number;
    received: string;
}

export async function getVesselPosition(mmsi: number): Promise<VesselPosition | null> {
    const key = process.env.MYSHIPTRACKING_API_KEY;
    if (!key) throw new Error('Missing MYSHIPTRACKING_API_KEY in environment');
    try {
        const res = await axios.get(`${MST_BASE}/vessel`, {
            params: { mmsi, response: 'simple' },
            headers: { 'x-api-key': key },
            timeout: 10000,
        });
        if (res.data?.status !== 'success') return null;
        return res.data.data as VesselPosition;
    } catch (err: any) {
        console.error('[MyShipTracking] Error for MMSI', mmsi, ':', err.message);
        return null;
    }
}
