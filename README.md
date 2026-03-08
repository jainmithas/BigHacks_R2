# AstraOps — AI-Powered Global Logistics Command Centre

> Real-time maritime and cargo shipment operations, rerouting intelligence, and live logistics analytics — powered by an autonomous AI agent.

---

## Overview

**AstraOps** is a full-stack logistics operations platform that replaces static dashboards with a live, AI-driven command centre. It tracks shipments across global maritime corridors in real time, monitors warehouse capacity across 22 world-class port hubs, and uses an autonomous AI agent to recommend — or automatically execute — dynamic reroutes when delays, weather events, or SLA breaches are detected.

```
Frontend (React + Vite)  ←→  Backend (Node.js / Express)  ←→  Supabase DB
                                        ↕
                        Shippo · WeatherAPI · GraphHopper · MyShipTracking
```

---

## Features

| Category | What It Does |
|----------|-------------|
|  **Live Map** | Interactive physical-terrain map (OpenTopoMap) with real-time shipment positions, polyline route overlays, and warehouse markers |
|  **Shipment Tracking** | 20+ live shipments with status, priority, ETA, SLA deadline, and current geo-position |
|  **AI Agent** | Autonomous rerouting engine using Gemini AI — observes telemetry, reasons about risk, and issues decisions |
|  **Dynamic Rerouting** | One-click reroute analysis with alternative route scoring, ETA delta, and risk assessment |
|  **Warehouse Intelligence** | 22 global port hubs tracked with capacity load, status, and congestion alerts |
|  **Carrier Fleet** | 16 real carriers (DHL, UPS, USPS, DPD, FedEx etc.) with reliability scoring |
|  **Live Weather** | Current conditions and forecasts for any route waypoint via WeatherAPI |
|  **Vessel Tracking** | Live vessel position lookup by MMSI via MyShipTracking |
|  **Twilio Alerts** | SMS/WhatsApp dispatch for critical SLA breaches |
|  **SLA Dashboard** | Real-time SLA rate ring, sparkline trend, in-transit/delayed counters |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  FRONTEND (Vite + React)             │
│  App.tsx — Dashboard, Sidebar, Tabs                  │
│  MapView.tsx — Leaflet map, markers, polylines       │
│  ReroutePanel.tsx — AI reroute analysis UI           │
└────────────────────┬────────────────────────────────┘
                     │ REST API (axios)
┌────────────────────▼────────────────────────────────┐
│               BACKEND (Express + TypeScript)         │
│  src/index.ts — All REST endpoints                   │
│  src/simulation/engine.ts — Live sim loop (5s tick)  │
│  src/agent/index.ts — Gemini AI rerouting agent      │
│  src/api/external.ts — External API adapters         │
│  src/lib/supabase.ts — DB client                     │
└──────┬──────────┬──────────┬──────────┬─────────────┘
       │          │          │          │
  Supabase    Shippo    WeatherAPI  GraphHopper
  (DB)        (shipments) (weather) (routing/geocode)
                                        │
                               MyShipTracking
                               (vessel AIS data)
```

### Backend Modules

| Module | Purpose |
|--------|---------|
| `simulation/engine.ts` | 5-second tick loop — fetches live data from Supabase + Shippo, moves shipments via corridor waypoints, detects anomalies |
| `agent/index.ts` | Gemini-powered AI agent — runs observe→reason→decide→act loops and produces reroute alternatives |
| `api/external.ts` | Clean adapter layer for all 4 external APIs with error handling and typed responses |
| `index.ts` | Express router with 10+ REST endpoints including weather, routing, vessel tracking, Shippo, and simulation state |

---

## Tech Stack

### Frontend
- **React 18** + **TypeScript** via **Vite 7**
- **Leaflet** + **React-Leaflet** — interactive map (OpenTopoMap physical tiles)
- **Framer Motion** — animated sidebar sections, card transitions
- **Lucide React** — icon system
- **Axios** — HTTP client with 5s polling

### Backend
- **Node.js** + **Express** + **TypeScript** (ts-node for dev)
- **Supabase JS** — PostgreSQL database client
- **Axios** — external API requests
- **dotenv** — environment variable management

### Database
- **Supabase** (PostgreSQL) — warehouses, carriers, shipments tables
- **Row Level Security** enabled with service-role admin access for migration scripts

### External APIs
| API | Usage |
|-----|-------|
| [Shippo](https://goshippo.com/docs) | Live shipment objects, carrier accounts, rates |
| [WeatherAPI](https://www.weatherapi.com) | Current weather + multi-day forecast for route waypoints |
| [GraphHopper](https://docs.graphhopper.com) | Route calculation + geocoding for hub coordinates |
| [MyShipTracking](https://www.myshiptracking.com/developers) | Live vessel AIS position by MMSI |
| [Gemini AI](https://ai.google.dev) | Autonomous rerouting agent reasoning engine |
| [Twilio](https://www.twilio.com) | SMS/WhatsApp alerts for critical SLA breaches |

---

## Project Structure

```
Didi/
├── Frontend/
│   ├── src/
│   │   ├── App.tsx               # Main dashboard (sidebar, tabs, data)
│   │   ├── components/
│   │   │   ├── MapView.tsx       # Leaflet map component
│   │   │   └── ReroutePanel.tsx  # AI reroute analysis drawer
│   │   └── index.css             # Design system tokens + animations
│   ├── .env                      # VITE_API_URL
│   └── vite.config.ts
│
└── Backend/
    ├── src/
    │   ├── index.ts              # Express server + all REST routes
    │   ├── agent/index.ts        # Gemini AI agent
    │   ├── api/external.ts       # Shippo, WeatherAPI, GraphHopper, MST adapters
    │   ├── simulation/
    │   │   ├── engine.ts         # Live simulation tick engine
    │   │   └── routes.ts         # Maritime corridor waypoints
    │   ├── lib/supabase.ts       # Supabase client
    │   └── types/index.ts        # Shared TypeScript interfaces
    ├── scripts/
    │   ├── create_tables.ts      # DDL — creates DB tables in new project
    │   ├── migrate.ts            # Migrates data between Supabase projects
    │   └── seed_data.ts          # Seeds carriers (Shippo) + port hubs (GraphHopper)
    └── .env                      # All API keys and DB credentials
```

---

## Getting Started

### Prerequisites
- Node.js 18+
- A [Supabase](https://supabase.com) project (free tier works)
- API keys for: Shippo, WeatherAPI, GraphHopper, Gemini

### 1. Clone and install

```bash
# Backend
cd Backend
npm install

# Frontend
cd ../Frontend
npm install
```

### 2. Configure environment variables

**`Backend/.env`**
```env
PORT=5000

# Supabase
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_KEY=<your-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
DB_HOST=db.<your-project>.supabase.co
DB_USER=postgres
DB_PASSWORD="<your-db-password>"
DB_NAME=postgres
DB_PORT=5432

# External APIs
SHIPPO_API_KEY=shippo_test_...
WEATHER_API_KEY=...
GRAPHOPPER_API_KEY=...
MYSHIPTRACKING_API_KEY=...
GEMINI_API_KEY=...

# Twilio (optional — for SMS alerts)
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE=+1...
```

**`Frontend/.env`**
```env
VITE_API_URL=http://localhost:5000/api
```

### 3. Set up the database

Run the schema SQL in your Supabase SQL editor, or use the setup script:

```bash
cd Backend
npx ts-node scripts/create_tables.ts
```

### 4. Seed initial data

```bash
# Migrates from an existing Supabase project (optional)
npx ts-node scripts/migrate.ts

# Seeds carriers from Shippo + 19 global port hubs via GraphHopper
npx ts-node scripts/seed_data.ts
```

### 5. Run locally

```bash
# Terminal 1 — Backend
cd Backend
npm run dev      # starts on http://localhost:5000

# Terminal 2 — Frontend
cd Frontend
npm run dev      # starts on http://localhost:5173
```

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/api/simulation/state` | Full live simulation state (shipments, warehouses, carriers) |
| `POST` | `/api/agent/trigger` | Manually trigger AI agent cycle |
| `POST` | `/api/reroute/analyze` | AI reroute analysis for a shipment |
| `POST` | `/api/reroute/confirm` | Confirm and commit a reroute |
| `GET` | `/api/weather/current?q=<city>` | Current weather for a location |
| `GET` | `/api/weather/forecast?q=<city>&days=N` | N-day weather forecast |
| `GET` | `/api/routing/geocode?q=<city>` | Geocode a location to lat/lng |
| `POST` | `/api/routing/route` | Calculate a road/sea route between points |
| `GET` | `/api/vessels/:mmsi` | Live vessel position by MMSI |
| `GET` | `/api/shippo/shipments` | All Shippo shipments |
| `GET` | `/api/shippo/shipments/:id/rates` | Carrier rates for a Shippo shipment |

---

## Database Schema

```sql
warehouses   — id, name, lat, lng, capacity, current_load, status, queue_length, throughput
carriers     — id, name, reliability_score, on_time_pickup_rate, vehicle_availability, carrier_type
shipments    — id, origin_id, destination_id, carrier_id, status, priority, lat, lng, eta,
               sla_deadline, shippo enrichment fields (origin_city, carrier_name, rate_amount, ...)
```

---

## Global Warehouse Coverage

22 port hubs tracked across all major shipping regions:

| Region | Hubs |
|--------|------|
| Asia Pacific | Singapore, Shanghai Yangshan, Busan, Hong Kong, Port Klang, Mumbai JNPT, Chennai, Dubai Jebel Ali |
| Europe | Rotterdam, Antwerp, Hamburg, Felixstowe |
| Americas | Los Angeles, Long Beach, New York/NJ, Houston, Santos Brazil |
| Africa/Middle East | Port Said Egypt, Durban South Africa |
| US Originals | North Hub (NYC), South Hub (LA), West Hub (SF) |

---

## License

MIT — built for BigHacks R2.
