import { LatLng, RouteAlternative } from '../types';

/**
 * Predefined corridor waypoint sets.
 * Each corridor has: direct route + 1-2 alternative (storm/congestion avoidance) routes.
 */
export const CORRIDORS: Record<string, {
    direct: LatLng[];
    alternatives: RouteAlternative[];
}> = {

    /* Mumbai → Dubai */
    'SHP-001': {
        direct: [
            { lat: 18.96, lng: 72.82, label: 'Mumbai' },
            { lat: 19.5, lng: 65.0, label: 'Arabian Sea' },
            { lat: 22.0, lng: 60.0, label: 'Gulf of Oman Approach' },
            { lat: 25.27, lng: 55.30, label: 'Dubai' },
        ],
        alternatives: [
            {
                id: 'coastal-oman',
                name: 'Coastal Oman Route',
                waypoints: [
                    { lat: 18.96, lng: 72.82, label: 'Mumbai' },
                    { lat: 17.5, lng: 67.5, label: 'South-West Deflection' },
                    { lat: 20.5, lng: 58.5, label: 'Oman Coast' },
                    { lat: 23.6, lng: 58.5, label: 'Muscat Anchorage' },
                    { lat: 25.27, lng: 55.30, label: 'Dubai' },
                ],
                etaDeltaHours: 8,
                riskScore: 0.15,
                reasoning: 'Active cyclone advisory in central Arabian Sea (lat 19-21°N, lon 61-65°E). Coastal Oman route adds 8 hours but reduces storm exposure risk from 72% to 11% and preserves cargo integrity.',
                recommended: true,
            },
        ],
    },

    /* Singapore → Chennai */
    'SHP-002': {
        direct: [
            { lat: 1.29, lng: 103.85, label: 'Singapore' },
            { lat: 5.0, lng: 97.0, label: 'Malacca Strait Exit' },
            { lat: 8.0, lng: 88.0, label: 'Bay of Bengal' },
            { lat: 13.08, lng: 80.27, label: 'Chennai' },
        ],
        alternatives: [
            {
                id: 'srilanka-bypass',
                name: 'Sri Lanka Southern Bypass',
                waypoints: [
                    { lat: 1.29, lng: 103.85, label: 'Singapore' },
                    { lat: 4.0, lng: 98.5, label: 'Riau Passage' },
                    { lat: 5.9, lng: 80.0, label: 'Colombo Waypoint' },
                    { lat: 7.9, lng: 77.5, label: 'South Sri Lanka' },
                    { lat: 13.08, lng: 80.27, label: 'Chennai' },
                ],
                etaDeltaHours: 12,
                riskScore: 0.10,
                reasoning: 'Bay of Bengal monsoon depression forming at 8°N / 88°E (IMD advisory). Southern bypass via Colombo avoids the depression zone. Additional 12 hours offset by reduced risk of 48-hour port delay at Chennai due to weather hold.',
                recommended: true,
            },
        ],
    },

    /* London → New York */
    'SHP-003': {
        direct: [
            { lat: 51.5, lng: -0.12, label: 'London' },
            { lat: 51.0, lng: -10.0, label: 'Celtic Sea' },
            { lat: 47.0, lng: -30.0, label: 'Mid-Atlantic' },
            { lat: 40.71, lng: -74.01, label: 'New York' },
        ],
        alternatives: [
            {
                id: 'azores-detour',
                name: 'Azores Southern Detour',
                waypoints: [
                    { lat: 51.5, lng: -0.12, label: 'London' },
                    { lat: 48.5, lng: -12.0, label: 'Bay of Biscay Exit' },
                    { lat: 39.0, lng: -28.0, label: 'Azores' },
                    { lat: 36.0, lng: -45.0, label: 'Trade Wind Belt' },
                    { lat: 40.71, lng: -74.01, label: 'New York' },
                ],
                etaDeltaHours: 18,
                riskScore: 0.08,
                reasoning: 'Category-1 Atlantic storm system tracking NE at 45°W (NOAA bulletin). Azores detour trades 18 hours for a 94% reduction in wave-height risk (max 2m vs projected 8m on direct track). Cargo insurance SLA mandates diversion above 6m.',
                recommended: true,
            },
        ],
    },

    /* Shanghai → Los Angeles */
    'SHP-004': {
        direct: [
            { lat: 31.23, lng: 121.47, label: 'Shanghai' },
            { lat: 35.0, lng: 145.0, label: 'North Pacific Entry' },
            { lat: 38.0, lng: 170.0, label: 'International Date Line' },
            { lat: 36.0, lng: -155.0, label: 'North Pacific Mid' },
            { lat: 33.95, lng: -118.4, label: 'Los Angeles' },
        ],
        alternatives: [
            {
                id: 'south-pacific',
                name: 'South Pacific Route',
                waypoints: [
                    { lat: 31.23, lng: 121.47, label: 'Shanghai' },
                    { lat: 25.0, lng: 130.0, label: 'East China Sea' },
                    { lat: 20.0, lng: 150.0, label: 'Micronesia' },
                    { lat: 10.0, lng: 170.0, label: 'Equatorial Band' },
                    { lat: 20.0, lng: -155.0, label: 'Hawaii Approach' },
                    { lat: 33.95, lng: -118.4, label: 'Los Angeles' },
                ],
                etaDeltaHours: 36,
                riskScore: 0.12,
                reasoning: 'North Pacific winter storm system (Bomb Cyclone) detected at 38°N / 165°E — sustained winds 85 knots. South Pacific route adds 36 hours but reduces structural stress rate from 0.91 to 0.08. CRITICAL cargo must comply with IMO MARPOL — reroute is mandatory above 70-knot forecasts.',
                recommended: true,
            },
            {
                id: 'northern-great-circle',
                name: 'Great Circle Northern Arc',
                waypoints: [
                    { lat: 31.23, lng: 121.47, label: 'Shanghai' },
                    { lat: 42.0, lng: 140.0, label: 'Japan Coast' },
                    { lat: 50.0, lng: 160.0, label: 'Aleutian Pass' },
                    { lat: 52.0, lng: -175.0, label: 'Alaska Arc' },
                    { lat: 48.0, lng: -155.0, label: 'North Pacific South' },
                    { lat: 33.95, lng: -118.4, label: 'Los Angeles' },
                ],
                etaDeltaHours: 20,
                riskScore: 0.35,
                reasoning: 'Arctic front approaching Aleutian region — risk score 0.35. Moderately better than direct by 16 hours but still within risk tolerance. Not recommended while CRITICAL cargo aboard; marked as secondary option.',
                recommended: false,
            },
        ],
    },
};

/** Interpolate current position along waypoints based on % progress */
export function interpolatePosition(waypoints: LatLng[], progress: number): LatLng {
    if (progress <= 0) return waypoints[0];
    if (progress >= 1) return waypoints[waypoints.length - 1];

    const totalSegs = waypoints.length - 1;
    const segProgress = progress * totalSegs;
    const segIdx = Math.floor(segProgress);
    const segFraction = segProgress - segIdx;

    const a = waypoints[Math.min(segIdx, totalSegs - 1)];
    const b = waypoints[Math.min(segIdx + 1, totalSegs)];

    return {
        lat: a.lat + (b.lat - a.lat) * segFraction,
        lng: a.lng + (b.lng - a.lng) * segFraction,
    };
}
