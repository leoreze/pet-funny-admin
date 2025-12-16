// backend/db.js
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL não definida');
}

const isProduction = process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

/* =========================
   HELPERS
========================= */

async function query(sql, params = []) {
  return pool.query(sql, params);
}

async function all(sql, params = []) {
  const res = await query(sql, params);
  return res.rows || [];
}

async function get(sql, params = []) {
  const res = await query(sql, params);
  return res.rows?.[0] || null;
}

async function run(sql, params = []) {
  const res = await query(sql, params);
  return {
    changes: res.rowCount,
  };
}

/* =========================
   INIT DB (somente tabelas base)
   ⚠️ NÃO altera schema em produção
========================= */
async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS customers (
      id BIGSERIAL PRIMARY KEY,
      phone TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS pets (
      id BIGSERIAL PRIMARY KEY,
      customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      breed TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS services (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      duration_min INT NOT NULL DEFAULT 60,
      value_cents INT NOT NULL CHECK (value_cents >= 0),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_pets_customer_id ON pets(customer_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_services_active ON services(is_active);`);
}

module.exports = {
  pool,
  initDb,
  all,
  get,
  run,
};
