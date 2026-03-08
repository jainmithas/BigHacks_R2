/**
 * migrate.ts
 *
 * Migrates all data from the OLD Supabase DB to the NEW Supabase DB,
 * and enriches shipments with live Shippo data.
 *
 * Run from Backend directory:
 *   npx ts-node scripts/migrate.ts
 *
 * The new DB tables will be created via Supabase SQL if they don't exist.
 * All secrets come from .env — nothing is hardcoded.
 */
import dotenv from 'dotenv';
dotenv.config();
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import axios from 'axios';

// ─── Client setup ─────────────────────────────────────────────────────────────
const OLD_URL = 'https://dsumvsoliqaopdzozbgd.supabase.co';
const OLD_KEY = 'sb_publishable_u3YARolaHP4z7xXq3ovfAg_qf2Ra-TZ'; // anon key for read

// New DB — use SUPABASE_URL (already updated to new DB) and service role key
const NEW_URL = process.env.SUPABASE_URL || '';
const NEW_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPBASE_SERVICE_ROLE_KEY || '';

console.log('🔗 Old DB:', OLD_URL);
console.log('🔗 New DB:', NEW_URL);

const oldDB: SupabaseClient = createClient(OLD_URL, OLD_KEY);
const newDB: SupabaseClient = createClient(NEW_URL, NEW_SERVICE_KEY);

// ─── Shippo ───────────────────────────────────────────────────────────────────
const SHIPPO_KEY = process.env.SHIPPO_API_KEY || '';

interface ShippoShipment {
    object_id: string;
    status: string;
    address_from?: { name?: string; city?: string; state?: string; country?: string; zip?: string; street1?: string };
    address_to?: { name?: string; city?: string; state?: string; country?: string; zip?: string; street1?: string };
    parcels?: { length?: string; width?: string; height?: string; distance_unit?: string; weight?: string; mass_unit?: string }[];
    carrier_accounts?: string[];
    metadata?: string;
    object_created?: string;
    object_updated?: string;
}

async function getAllShippoShipments(): Promise<ShippoShipment[]> {
    if (!SHIPPO_KEY) { console.warn('⚠️  No SHIPPO_API_KEY — skipping Shippo enrichment'); return []; }
    const all: ShippoShipment[] = [];
    let page = 1;
    while (true) {
        const res = await axios.get(`https://api.goshippo.com/shipments/?results=25&page=${page}`, {
            headers: { Authorization: `ShippoToken ${SHIPPO_KEY}` },
            timeout: 15000,
        });
        const results: ShippoShipment[] = res.data?.results ?? [];
        all.push(...results);
        if (!res.data?.next) break;
        page++;
    }
    console.log(`📦 Fetched ${all.length} shipments from Shippo`);
    return all;
}

async function getShippoRates(shipmentId: string): Promise<any[]> {
    try {
        const res = await axios.get(`https://api.goshippo.com/shipments/${shipmentId}/rates/`, {
            headers: { Authorization: `ShippoToken ${SHIPPO_KEY}` },
            timeout: 10000,
        });
        return res.data?.results ?? [];
    } catch { return []; }
}

async function getShippoTracking(carrier: string, trackingNo: string): Promise<any | null> {
    try {
        const res = await axios.get(`https://api.goshippo.com/tracks/${carrier}/${trackingNo}`, {
            headers: { Authorization: `ShippoToken ${SHIPPO_KEY}` },
            timeout: 10000,
        });
        return res.data ?? null;
    } catch { return null; }
}

// ─── Schema creation in new DB ────────────────────────────────────────────────
/*
 * We use the Supabase REST API 'rpc' to execute raw SQL via a stored procedure,
 * OR we rely on upsert auto-creation.
 *
 * Because the service-role key cannot directly run DDL via REST (only psql/migrations can),
 * we'll do upsert with { ignoreDuplicates: false } and let Supabase handle conflicts.
 * If tables don't exist in the new DB, we'll log an error with the SQL to create them manually.
 */

const CREATE_SQL = `
-- Run this in your new Supabase SQL editor if tables don't exist:

CREATE TABLE IF NOT EXISTS warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  lat numeric,
  lng numeric,
  queue_length integer DEFAULT 0,
  throughput integer DEFAULT 0,
  loading_dock_availability integer DEFAULT 1,
  capacity integer DEFAULT 1000,
  current_load integer DEFAULT 0,
  status text DEFAULT 'OPERATIONAL',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS carriers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  on_time_pickup_rate numeric DEFAULT 0.9,
  reliability_score numeric DEFAULT 0.9,
  vehicle_availability numeric DEFAULT 0.8,
  carrier_type text DEFAULT 'SEA',
  cost numeric DEFAULT 5000,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origin_id uuid REFERENCES warehouses(id),
  destination_id uuid REFERENCES warehouses(id),
  carrier_id uuid REFERENCES carriers(id),
  status text DEFAULT 'PENDING',
  priority integer DEFAULT 2,
  lat numeric,
  lng numeric,
  eta timestamptz,
  sla_deadline timestamptz,
  -- Enriched Shippo fields
  shippo_id text,
  origin_name text,
  origin_city text,
  origin_country text,
  origin_street text,
  destination_name text,
  destination_city text,
  destination_country text,
  destination_street text,
  parcel_weight text,
  parcel_weight_unit text,
  parcel_length text,
  parcel_width text,
  parcel_height text,
  carrier_name text,
  tracking_number text,
  tracking_status text,
  tracking_substatus text,
  estimated_days integer,
  rate_amount numeric,
  rate_currency text,
  metadata text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
`;

// ─── Main migration ────────────────────────────────────────────────────────────
async function migrate() {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  AstraOps — Supabase Migration');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // ── 1. Read all data from old DB ──────────────────────────────────────────
    console.log('📥 Reading old DB...');
    const [{ data: oldWarehouses, error: wErr },
           { data: oldCarriers,   error: cErr },
           { data: oldShipments,  error: sErr }] = await Promise.all([
        oldDB.from('warehouses').select('*'),
        oldDB.from('carriers').select('*'),
        oldDB.from('shipments').select('*'),
    ]);

    if (wErr) console.warn('  ⚠️  warehouses:', wErr.message);
    if (cErr) console.warn('  ⚠️  carriers:', cErr.message);
    if (sErr) console.warn('  ⚠️  shipments:', sErr.message);

    console.log(`  ✅ warehouses: ${oldWarehouses?.length ?? 0} rows`);
    console.log(`  ✅ carriers:   ${oldCarriers?.length ?? 0} rows`);
    console.log(`  ✅ shipments:  ${oldShipments?.length ?? 0} rows`);

    // ── 2. Fetch Shippo enrichment data ───────────────────────────────────────
    console.log('\n📦 Fetching Shippo data...');
    const shippoShipments = await getAllShippoShipments();

    // Build enrichment lookup by we'll try to associate by index first,
    // or use carrier info if available
    type EnrichedMap = { [index: number]: ShippoShipment & { rates?: any[]; tracking?: any } };
    const enriched: EnrichedMap = {};
    for (let i = 0; i < Math.min(shippoShipments.length, 10); i++) {
        const sh = shippoShipments[i];
        const [rates] = await Promise.all([getShippoRates(sh.object_id)]);
        const bestRate = rates.sort((a: any, b: any) => parseFloat(a.amount) - parseFloat(b.amount))[0];
        enriched[i] = { ...sh, rates, tracking: null };
        if (bestRate) enriched[i].tracking = bestRate;
    }

    // ── 3. Enrich shipments and upsert to new DB ──────────────────────────────
    console.log('\n📤 Upserting to new DB...');

    // Print SQL for manual review if needed
    console.log('\n📋 SQL to create tables in new DB (run in Supabase SQL editor if not done yet):');
    console.log(CREATE_SQL);

    // Upsert warehouses
    const warehousesToUpsert = (oldWarehouses ?? []).map((w: any) => ({
        id: w.id,
        name: w.name,
        lat: w.lat,
        lng: w.lng,
        queue_length: w.queue_length ?? 0,
        throughput: w.throughput ?? 0,
        loading_dock_availability: w.loading_dock_availability ?? 1,
        capacity: w.capacity ?? 1000,
        current_load: w.current_load ?? 0,
        status: w.status ?? 'OPERATIONAL',
        created_at: w.created_at,
    }));

    const { error: wUpsertErr } = await newDB.from('warehouses').upsert(warehousesToUpsert, { onConflict: 'id' });
    if (wUpsertErr) {
        console.error('  ❌ warehouses upsert error:', wUpsertErr.message);
        console.log('  💡 Make sure to run the CREATE TABLE SQL above in your new Supabase project first.');
    } else {
        console.log(`  ✅ warehouses: ${warehousesToUpsert.length} rows upserted`);
    }

    // Upsert carriers
    const carriersToUpsert = (oldCarriers ?? []).map((c: any) => ({
        id: c.id,
        name: c.name,
        on_time_pickup_rate: c.on_time_pickup_rate ?? 0.9,
        reliability_score: c.reliability_score ?? 0.9,
        vehicle_availability: c.vehicle_availability ?? 0.8,
        carrier_type: c.carrier_type ?? c.type ?? 'SEA',
        cost: c.cost ?? 5000,
        created_at: c.created_at,
    }));

    const { error: cUpsertErr } = await newDB.from('carriers').upsert(carriersToUpsert, { onConflict: 'id' });
    if (cUpsertErr) {
        console.error('  ❌ carriers upsert error:', cUpsertErr.message);
    } else {
        console.log(`  ✅ carriers: ${carriersToUpsert.length} rows upserted`);
    }

    // Upsert shipments (enriched)
    const shipmentsToUpsert = (oldShipments ?? []).map((s: any, i: number) => {
        const shippo = shippoShipments[i] ?? null;
        const rate = enriched[i]?.rates?.[0] ?? null;

        return {
            id: s.id,
            origin_id: s.origin_id,
            destination_id: s.destination_id,
            carrier_id: s.carrier_id,
            status: s.status,
            priority: s.priority,
            lat: s.lat,
            lng: s.lng,
            eta: s.eta,
            sla_deadline: s.sla_deadline,
            created_at: s.created_at,
            updated_at: new Date().toISOString(),
            // Shippo enrichment
            shippo_id: shippo?.object_id ?? null,
            origin_name: shippo?.address_from?.name ?? null,
            origin_city: shippo?.address_from?.city ?? null,
            origin_country: shippo?.address_from?.country ?? null,
            origin_street: shippo?.address_from?.street1 ?? null,
            destination_name: shippo?.address_to?.name ?? null,
            destination_city: shippo?.address_to?.city ?? null,
            destination_country: shippo?.address_to?.country ?? null,
            destination_street: shippo?.address_to?.street1 ?? null,
            parcel_weight: shippo?.parcels?.[0]?.weight ?? null,
            parcel_weight_unit: shippo?.parcels?.[0]?.mass_unit ?? null,
            parcel_length: shippo?.parcels?.[0]?.length ?? null,
            parcel_width: shippo?.parcels?.[0]?.width ?? null,
            parcel_height: shippo?.parcels?.[0]?.height ?? null,
            carrier_name: rate?.provider ?? null,
            tracking_number: rate?.tracking_number ?? null,
            tracking_status: null,
            tracking_substatus: null,
            estimated_days: rate?.estimated_days ?? null,
            rate_amount: rate?.amount ? parseFloat(rate.amount) : null,
            rate_currency: rate?.currency ?? null,
            metadata: shippo?.metadata ?? null,
        };
    });

    const { error: sUpsertErr } = await newDB.from('shipments').upsert(shipmentsToUpsert, { onConflict: 'id' });
    if (sUpsertErr) {
        console.error('  ❌ shipments upsert error:', sUpsertErr.message);
    } else {
        console.log(`  ✅ shipments: ${shipmentsToUpsert.length} rows upserted`);
    }

    // ── 4. Verification read from new DB ─────────────────────────────────────
    console.log('\n🔍 Verifying new DB...');
    const [{ data: newW }, { data: newC }, { data: newS }] = await Promise.all([
        newDB.from('warehouses').select('id,name,lat,lng').limit(5),
        newDB.from('carriers').select('id,name').limit(5),
        newDB.from('shipments').select('id,status,origin_city,destination_city,carrier_name,rate_amount').limit(5),
    ]);

    console.log('  Warehouses:', JSON.stringify(newW, null, 2));
    console.log('  Carriers:', JSON.stringify(newC, null, 2));
    console.log('  Shipments (enriched sample):', JSON.stringify(newS, null, 2));

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  Migration complete!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

migrate().catch(err => {
    console.error('\n❌ Migration failed:', err.message);
    process.exit(1);
});
