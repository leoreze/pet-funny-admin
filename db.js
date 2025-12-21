// backend/db.js
'use strict';

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false'
    ? false
    : (process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false),
});

async function query(sql, params = []) {
  return pool.query(sql, params);
}

async function all(sql, params = []) {
  const r = await query(sql, params);
  return r.rows;
}

async function get(sql, params = []) {
  const r = await query(sql, params);
  return r.rows[0] || null;
}

async function run(sql, params = []) {
  await query(sql, params);
  return true;
}

async function initDb() {
  // Customers
  await run(`
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Pets
  await run(`
    CREATE TABLE IF NOT EXISTS pets (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      breed TEXT DEFAULT '',
      size TEXT DEFAULT '',
      coat TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Services (value_cents = centavos)
  await run(`
    CREATE TABLE IF NOT EXISTS services (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      value_cents INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Bookings
  await run(`
    CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      pet_id INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
      service TEXT NOT NULL DEFAULT '',
      service_id INTEGER NULL REFERENCES services(id) ON DELETE SET NULL,
      date DATE NOT NULL,
      time TEXT NOT NULL,
      prize TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Dog breeds
  await run(`
    CREATE TABLE IF NOT EXISTS dog_breeds (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      history TEXT DEFAULT '',
      size TEXT NOT NULL DEFAULT '',
      coat TEXT NOT NULL DEFAULT '',
      characteristics TEXT DEFAULT '',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Mimos
  await run(`
    CREATE TABLE IF NOT EXISTS mimos (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      value_cents INTEGER NOT NULL DEFAULT 0,
      starts_at TIMESTAMPTZ NULL,
      ends_at TIMESTAMPTZ NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Opening Hours (dow 0-6)
  await run(`
    CREATE TABLE IF NOT EXISTS opening_hours (
      dow INTEGER NOT NULL,
      is_closed BOOLEAN NOT NULL DEFAULT FALSE,
      open_time TEXT DEFAULT '08:00',
      close_time TEXT DEFAULT '18:00',
      max_per_half_hour INTEGER NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Garantir UNIQUE em dow (necessário para ON CONFLICT (dow))
  await run(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'opening_hours_dow_unique'
      ) THEN
        -- remove duplicados antes de criar unique
        DELETE FROM opening_hours a
        USING opening_hours b
        WHERE a.dow = b.dow
          AND a.ctid < b.ctid;

        CREATE UNIQUE INDEX opening_hours_dow_unique ON opening_hours(dow);
      END IF;
    END$$;
  `);

  // Backfill padrão de 0..6 caso vazio
  await run(`
    DO $$
    DECLARE d INT;
    BEGIN
      FOR d IN 0..6 LOOP
        INSERT INTO opening_hours (dow, is_closed, open_time, close_time, max_per_half_hour, updated_at)
        VALUES (d, FALSE, '08:00', '18:00', 1, NOW())
        ON CONFLICT (dow) DO NOTHING;
      END LOOP;
    END$$;
  `);
}

module.exports = {
  pool,
  query,
  all,
  get,
  run,
  initDb,
};
