/**
 * data.ts — DEPRECATED stub.
 *
 * The SimulationEngine no longer loads from this module.
 * Data is now fetched at runtime from:
 *   - Supabase   → warehouses, carriers
 *   - Shippo     → shipments
 *   - routes.ts  → maritime corridor waypoints (route geometry)
 *
 * This file is intentionally left empty so that any accidental imports
 * result in a clean compile rather than stale hardcoded data being
 * silently used.
 */
