// backend/db.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function query(sql, params = []) {
  const res = await pool.query(sql, params);
  return res;
}
async function all(sql, params = []) {
  const res = await query(sql, params);
  return res.rows;
}
async function get(sql, params = []) {
  const res = await query(sql, params);
  return res.rows[0] || null;
}
async function run(sql, params = []) {
  await query(sql, params);
}

async function initDb() {
  // core tables
  await run(`
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS pets (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      breed TEXT,
      size TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS breeds (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS services (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      value_cents INTEGER NOT NULL DEFAULT 0
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS mimos (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      start_date DATE,
      end_date DATE
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS opening_hours (
      weekday INTEGER PRIMARY KEY, -- 0=Sun..6=Sat
      open_time TEXT,
      close_time TEXT,
      closed BOOLEAN NOT NULL DEFAULT FALSE,
      max_per_slot INTEGER NOT NULL DEFAULT 0
    );
  `);

  // bookings
  await run(`
    CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY,
      date DATE NOT NULL,
      time TEXT NOT NULL,
      phone TEXT,
      notes TEXT,
      prize TEXT,
      customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      pet_id INTEGER REFERENCES pets(id) ON DELETE SET NULL,
      mimo_id INTEGER REFERENCES mimos(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Legacy columns from older versions (safe no-op if already exists)
  await run(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_id INTEGER;`);
  await run(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service TEXT;`);
  await run(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS mimo TEXT;`);

  // booking_services junction
  await run(`
    CREATE TABLE IF NOT EXISTS booking_services (
      booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
      qty INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (booking_id, service_id)
    );
  `);

  // If booking_services existed without qty in older deploys
  await run(`ALTER TABLE booking_services ADD COLUMN IF NOT EXISTS qty INTEGER NOT NULL DEFAULT 1;`);

  // One-time backfill: migrate legacy bookings.service_id into booking_services
  await run(`
    INSERT INTO booking_services (booking_id, service_id, qty)
    SELECT b.id, b.service_id, 1
    FROM bookings b
    WHERE b.service_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM booking_services bs WHERE bs.booking_id = b.id
      )
    ON CONFLICT DO NOTHING;
  `);
}

module.exports = { query, all, get, run, initDb };
