/**
 * seed_data.ts
 * Enriches the new Supabase DB with:
 *   - Real carrier accounts from Shippo (/carrier_accounts/)
 *   - Well-known global port/logistics hubs (geocoded via GraphHopper)
 *     as additional Warehouse entries
 *
 * Run: npx ts-node scripts/seed_data.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

const newDB = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const SHIPPO_KEY = process.env.SHIPPO_API_KEY!;
const GH_KEY     = process.env.GRAPHOPPER_API_KEY!;
const MST_KEY    = process.env.MYSHIPTRACKING_API_KEY!;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function ghFriendlyType(type: string | null): string {
    if (!type) return 'SEA';
    if (type.toLowerCase().includes('air')) return 'AIR';
    if (type.toLowerCase().includes('ground') || type.toLowerCase().includes('land')) return 'LAND';
    return 'SEA';
}

async function geocode(q: string): Promise<{lat: number, lng: number} | null> {
    try {
        const r = await axios.get('https://graphhopper.com/api/1/geocode', {
            params: { key: GH_KEY, q, limit: 1, locale: 'en' },
            timeout: 8000
        });
        const h = r.data?.hits?.[0];
        if (!h) return null;
        return { lat: h.point.lat, lng: h.point.lng };
    } catch { return null; }
}

// ─── 1. Carriers from Shippo ──────────────────────────────────────────────────
async function seedCarriers() {
    console.log('\n━━━ Carriers (Shippo) ━━━');
    let allCarriers: any[] = [];
    let url = 'https://api.goshippo.com/carrier_accounts/?active=true&results=100';

    while (url) {
        const r = await axios.get(url, {
            headers: { Authorization: `ShippoToken ${SHIPPO_KEY}` },
            timeout: 10000
        });
        allCarriers.push(...(r.data?.results ?? []));
        url = r.data?.next ?? null;
    }
    console.log(`  Found ${allCarriers.length} Shippo carrier accounts`);

    const rows = allCarriers.map((c: any) => ({
        // Use Shippo object_id as carrier id prefix — not a uuid, so we generate a stable one
        name: (c.carrier_name ?? c.carrier ?? 'Unknown Carrier')
                .replace(/_/g, ' ')
                .replace(/\b\w/g, (l: string) => l.toUpperCase()),
        on_time_pickup_rate: c.parameters?.service_levels?.length
            ? Math.min(0.99, 0.85 + c.parameters.service_levels.length * 0.01)
            : 0.90,
        reliability_score: c.active ? 0.95 : 0.70,
        vehicle_availability: c.active ? 0.85 : 0.50,
        carrier_type: ghFriendlyType(c.carrier ?? ''),
        cost: c.carrier === 'usps' ? 8 : c.carrier === 'ups' ? 20 : c.carrier === 'fedex' ? 22 : c.carrier?.includes('air') ? 15000 : 5000,
    }));

    // Upsert into carriers table (no conflict on name for now — use insert with ignoreDuplicates false)
    const { error, data } = await newDB.from('carriers').upsert(rows, { ignoreDuplicates: false });
    if (error) {
        console.error('  ❌ Carriers upsert error:', error.message);
    } else {
        console.log(`  ✅ Inserted/updated ${rows.length} carriers from Shippo`);
        rows.forEach((c: any) => console.log(`     · ${c.name} (${c.carrier_type})`));
    }
}

// ─── 2. Warehouses from major global logistics hubs ───────────────────────────
// These are real-world major shipping ports / logistics hubs
const GLOBAL_HUBS = [
    // Asia Pacific
    { name: 'Singapore Port Hub',         query: 'Port of Singapore, Singapore',       status: 'OPERATIONAL', capacity: 5000, current_load: 4200 },
    { name: 'Shanghai Yangshan Terminal', query: 'Yangshan Port, Shanghai, China',      status: 'CONGESTED',   capacity: 8000, current_load: 7600 },
    { name: 'Busan Newport Terminal',     query: 'Busan Port, South Korea',             status: 'OPERATIONAL', capacity: 4500, current_load: 3200 },
    { name: 'Hong Kong Container Port',   query: 'Kwai Tsing Container Terminal, Hong Kong', status: 'OPERATIONAL', capacity: 3800, current_load: 2900 },
    { name: 'Port Klang Hub',             query: 'Port Klang, Selangor, Malaysia',      status: 'OPERATIONAL', capacity: 3000, current_load: 2100 },
    { name: 'Mumbai JNPT',                query: 'Jawaharlal Nehru Port, Navi Mumbai, India', status: 'CONGESTED', capacity: 2500, current_load: 2350 },
    { name: 'Chennai Port Hub',           query: 'Chennai Port, Tamil Nadu, India',     status: 'OPERATIONAL', capacity: 1800, current_load: 1200 },
    { name: 'Dubai Jebel Ali Terminal',   query: 'Jebel Ali Port, Dubai, UAE',          status: 'OPERATIONAL', capacity: 6000, current_load: 4800 },
    // Europe
    { name: 'Rotterdam Eurogate Hub',     query: 'Port of Rotterdam, Netherlands',      status: 'OPERATIONAL', capacity: 7000, current_load: 5500 },
    { name: 'Antwerp Gateway Terminal',   query: 'Port of Antwerp, Belgium',            status: 'OPERATIONAL', capacity: 5500, current_load: 4300 },
    { name: 'Hamburg HHLA Terminal',      query: 'Port of Hamburg, Germany',            status: 'OPERATIONAL', capacity: 4800, current_load: 3600 },
    { name: 'Felixstowe UK Hub',          query: 'Port of Felixstowe, Suffolk, UK',     status: 'OPERATIONAL', capacity: 3200, current_load: 2400 },
    // Americas
    { name: 'Los Angeles Port Hub',       query: 'Port of Los Angeles, California, USA', status: 'CONGESTED', capacity: 6500, current_load: 6300 },
    { name: 'Long Beach Terminal',        query: 'Port of Long Beach, California, USA', status: 'OPERATIONAL', capacity: 5800, current_load: 4700 },
    { name: 'New York/New Jersey Hub',    query: 'Port of New York and New Jersey, USA', status: 'OPERATIONAL', capacity: 4200, current_load: 3100 },
    { name: 'Houston Barbours Cut',       query: 'Port of Houston, Texas, USA',         status: 'OPERATIONAL', capacity: 3500, current_load: 2600 },
    { name: 'Santos Brazil Hub',          query: 'Port of Santos, São Paulo, Brazil',   status: 'OPERATIONAL', capacity: 3800, current_load: 2800 },
    // Africa / Middle East
    { name: 'Port Said East Terminal',    query: 'Port Said, Egypt',                    status: 'OPERATIONAL', capacity: 2200, current_load: 1700 },
    { name: 'Durban Pier Container Hub',  query: 'Port of Durban, South Africa',        status: 'OPERATIONAL', capacity: 2000, current_load: 1500 },
];

async function seedWarehouses() {
    console.log('\n━━━ Warehouses (Global Port Hubs) ━━━');

    // Check which hubs already exist by name
    const { data: existing } = await newDB.from('warehouses').select('name');
    const existingNames = new Set((existing ?? []).map((w: any) => w.name));

    const toInsert = GLOBAL_HUBS.filter(h => !existingNames.has(h.name));
    console.log(`  ${toInsert.length} new hubs to geocode and insert (${GLOBAL_HUBS.length - toInsert.length} already exist)`);

    const rows: any[] = [];
    for (const hub of toInsert) {
        process.stdout.write(`  → Geocoding: ${hub.name}... `);
        const geo = await geocode(hub.query);
        if (!geo) {
            console.log('⚠️  not found, skipping');
            continue;
        }
        console.log(`✅ [${geo.lat.toFixed(2)}, ${geo.lng.toFixed(2)}]`);
        rows.push({
            name: hub.name,
            lat: geo.lat,
            lng: geo.lng,
            queue_length: Math.floor(Math.random() * 15) + 3,
            throughput: Math.floor(hub.capacity / 10),
            loading_dock_availability: Math.random() > 0.3 ? 1 : 0,
            capacity: hub.capacity,
            current_load: hub.current_load,
            status: hub.status,
        });
        // Small delay to avoid rate limiting GraphHopper free tier
        await new Promise(r => setTimeout(r, 300));
    }

    if (rows.length === 0) {
        console.log('  ℹ️  No new rows to insert');
        return;
    }

    const { error } = await newDB.from('warehouses').insert(rows);
    if (error) {
        console.error('  ❌ Warehouses insert error:', error.message);
    } else {
        console.log(`  ✅ Inserted ${rows.length} new warehouse hubs`);
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  AstraOps — Data Seeding');
    console.log('  Target DB:', process.env.SUPABASE_URL);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    await seedCarriers();
    await seedWarehouses();

    // Final count
    console.log('\n🔍 Final counts:');
    const [{ count: wc }, { count: cc }] = await Promise.all([
        newDB.from('warehouses').select('*', { count: 'exact', head: true }),
        newDB.from('carriers').select('*', { count: 'exact', head: true }),
    ]);
    console.log(`  Warehouses: ${wc}`);
    console.log(`  Carriers:   ${cc}`);
    console.log('\n✅ Seeding complete!');
}

main().catch(err => {
    console.error('\n❌ Seeding failed:', err.message);
    process.exit(1);
});
