/**
 * create_tables.ts — runs once to create all required tables in the new Supabase DB.
 * Run: npx ts-node scripts/create_tables.ts
 */
import dotenv from 'dotenv';
dotenv.config();
import { Client } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || '';
if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL not set in .env');
    process.exit(1);
}

// Parse pg connection params manually to handle special chars (&, #) in password
function parsePgUrl(url: string) {
    const match = url.match(/^postgresql:\/\/([^:]+):(.+)@([^:]+):(\d+)\/(.+)$/);
    if (!match) throw new Error('Cannot parse DATABASE_URL: ' + url.replace(/:([^@]+)@/, ':***@'));
    return { user: match[1], password: match[2], host: match[3], port: parseInt(match[4]), database: match[5] };
}

const pgConfig = parsePgUrl(DATABASE_URL);

const client = new Client({
    ...pgConfig,
    ssl: { rejectUnauthorized: false },
});

const DDL = `
-- Warehouses
CREATE TABLE IF NOT EXISTS warehouses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  lat           numeric,
  lng           numeric,
  queue_length  integer DEFAULT 0,
  throughput    integer DEFAULT 0,
  loading_dock_availability integer DEFAULT 1,
  capacity      integer DEFAULT 1000,
  current_load  integer DEFAULT 0,
  status        text DEFAULT 'OPERATIONAL',
  created_at    timestamptz DEFAULT now()
);

-- Carriers
CREATE TABLE IF NOT EXISTS carriers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  on_time_pickup_rate   numeric DEFAULT 0.9,
  reliability_score     numeric DEFAULT 0.9,
  vehicle_availability  numeric DEFAULT 0.8,
  carrier_type          text DEFAULT 'SEA',
  cost                  numeric DEFAULT 5000,
  created_at            timestamptz DEFAULT now()
);

-- Shipments (enriched with Shippo fields)
CREATE TABLE IF NOT EXISTS shipments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origin_id            uuid REFERENCES warehouses(id),
  destination_id       uuid REFERENCES warehouses(id),
  carrier_id           uuid REFERENCES carriers(id),
  status               text DEFAULT 'PENDING',
  priority             integer DEFAULT 2,
  lat                  numeric,
  lng                  numeric,
  eta                  timestamptz,
  sla_deadline         timestamptz,
  -- Shippo enrichment
  shippo_id            text,
  origin_name          text,
  origin_city          text,
  origin_country       text,
  origin_street        text,
  destination_name     text,
  destination_city     text,
  destination_country  text,
  destination_street   text,
  parcel_weight        text,
  parcel_weight_unit   text,
  parcel_length        text,
  parcel_width         text,
  parcel_height        text,
  carrier_name         text,
  tracking_number      text,
  tracking_status      text,
  tracking_substatus   text,
  estimated_days       integer,
  rate_amount          numeric,
  rate_currency        text,
  metadata             text,
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now()
);

-- Enable RLS (Row Level Security) with public access for app reads
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE carriers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipments  ENABLE ROW LEVEL SECURITY;

-- Allow authenticated reads from application
CREATE POLICY IF NOT EXISTS "Allow all reads on warehouses" ON warehouses FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "Allow all reads on carriers"   ON carriers   FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "Allow all reads on shipments"  ON shipments  FOR SELECT USING (true);

-- Allow service role full access
GRANT ALL ON warehouses TO service_role;
GRANT ALL ON carriers   TO service_role;
GRANT ALL ON shipments  TO service_role;
`;

async function createTables() {
    console.log('🔌 Connecting to new Supabase DB:', DATABASE_URL.replace(/:([^@]+)@/, ':***@'));
    await client.connect();
    console.log('✅ Connected!');

    const result = await client.query('SELECT current_database()');
    console.log('📂 Database:', result.rows[0].current_database);

    console.log('\n📐 Running DDL...');
    await client.query(DDL);
    console.log('✅ All tables created successfully!');

    // Verify
    const tables = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name IN ('warehouses','carriers','shipments')
        ORDER BY table_name
    `);
    console.log('📋 Tables in new DB:', tables.rows.map((r: any) => r.table_name).join(', '));

    await client.end();
}

createTables().catch(err => {
    console.error('❌ Failed:', err.message);
    client.end();
    process.exit(1);
});
