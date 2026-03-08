import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { simulationEngine } from './simulation/engine';
import { getWeatherForLocation, getWeatherForecast, getGraphHopperRoute, geocodeLocation, getVesselPosition, getShippoShipments, getShippoRates } from './api/external';

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

/* ─── Health ─── */
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/* ─── Simulation State ─── */
app.get('/api/simulation/state', (_req, res) => {
    res.json(simulationEngine.getState());
});

/* ─── Agent Trigger ─── */
app.post('/api/agent/trigger', async (_req, res) => {
    const { agent } = await import('./agent');
    await agent.runStep();
    res.json({ message: 'Agent cycle triggered', timestamp: new Date().toISOString() });
});

/* ─── Reroute Analysis ─── */
app.post('/api/reroute/analyze', async (req, res) => {
    const { shipmentId } = req.body as { shipmentId: string };
    if (!shipmentId) {
        res.status(400).json({ error: 'shipmentId required' });
        return;
    }
    const { agent } = await import('./agent');
    const result = await agent.analyzeReroute(shipmentId);
    if (!result) {
        res.status(404).json({ error: 'Shipment not found or no alternatives available' });
        return;
    }
    res.json(result);
});

/* ─── Reroute Confirm ─── */
app.post('/api/reroute/confirm', (req, res) => {
    const { shipmentId, routeId } = req.body as { shipmentId: string; routeId: string };
    if (!shipmentId || !routeId) {
        res.status(400).json({ error: 'shipmentId and routeId required' });
        return;
    }
    const committed = simulationEngine.rerouteShipment(shipmentId, routeId);
    if (!committed) {
        res.status(404).json({ error: 'Route or shipment not found' });
        return;
    }
    res.json({ success: true, committed });
});

/* ─── Weather: current conditions for a location ─── */
app.get('/api/weather/current', async (req, res) => {
    const q = req.query.q as string;
    if (!q) {
        res.status(400).json({ error: 'Query param ?q=<location> required' });
        return;
    }
    const data = await getWeatherForLocation(q);
    if (!data) {
        res.status(503).json({ error: 'Weather data unavailable for this location' });
        return;
    }
    res.json(data);
});

/* ─── Weather: multi-day forecast + alerts ─── */
app.get('/api/weather/forecast', async (req, res) => {
    const q = req.query.q as string;
    const days = Math.min(Number(req.query.days ?? 3), 10);
    if (!q) {
        res.status(400).json({ error: 'Query param ?q=<location> required' });
        return;
    }
    const data = await getWeatherForecast(q, days);
    if (!data) {
        res.status(503).json({ error: 'Forecast data unavailable' });
        return;
    }
    res.json(data);
});

/* ─── GraphHopper: geocode a city / location ─── */
app.get('/api/routing/geocode', async (req, res) => {
    const q = req.query.q as string;
    if (!q) {
        res.status(400).json({ error: 'Query param ?q=<location> required' });
        return;
    }
    const point = await geocodeLocation(q);
    if (!point) {
        res.status(404).json({ error: `Location not found: ${q}` });
        return;
    }
    res.json(point);
});

/* ─── GraphHopper: compute a route ─── */
app.post('/api/routing/route', async (req, res) => {
    const { points, vehicle } = req.body as { points: [number, number][]; vehicle?: string };
    if (!points || !Array.isArray(points) || points.length < 2) {
        res.status(400).json({ error: 'body.points must be an array of at least 2 [lat,lng] pairs' });
        return;
    }
    const waypoints = await getGraphHopperRoute(points, vehicle as any || 'car');
    if (!waypoints) {
        res.status(503).json({ error: 'Routing service unavailable or no route found' });
        return;
    }
    res.json({ waypoints });
});

/* ─── MyShipTracking: vessel live position ─── */
app.get('/api/vessels/:mmsi', async (req, res) => {
    const mmsi = Number(req.params.mmsi);
    if (isNaN(mmsi) || mmsi < 100000000 || mmsi > 999999999) {
        res.status(400).json({ error: 'Invalid MMSI — must be a 9-digit number' });
        return;
    }
    const data = await getVesselPosition(mmsi);
    if (!data) {
        res.status(404).json({ error: 'Vessel not found or tracking unavailable' });
        return;
    }
    res.json(data);
});

/* ─── Shippo: live shipments list ─── */
app.get('/api/shippo/shipments', async (_req, res) => {
    try {
        const shipments = await getShippoShipments();
        res.json({ count: shipments.length, results: shipments });
    } catch (err: any) {
        res.status(503).json({ error: err.message });
    }
});

/* ─── Shippo: rates for a shipment ─── */
app.get('/api/shippo/shipments/:id/rates', async (req, res) => {
    try {
        const rates = await getShippoRates(req.params.id);
        res.json({ count: rates.length, results: rates });
    } catch (err: any) {
        res.status(503).json({ error: err.message });
    }
});

/* ─── Boot ─── */
app.listen(port, () => {
    console.log(`Logistics Ops backend → http://localhost:${port}`);
    simulationEngine.start(5000);
});
