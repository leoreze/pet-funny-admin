// backend/db.js
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL não definida nas variáveis de ambiente');
}

const isProduction = process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

// Helpers
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
    lastID: res.rows?.[0]?.id ? Number(res.rows[0].id) : undefined,
    changes: res.rowCount,
  };
}

// Init DB (idempotente e seguro)
async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      phone TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS pets (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      breed TEXT,
      info TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      pet_id INTEGER REFERENCES pets(id) ON DELETE SET NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      service TEXT NOT NULL,
      prize TEXT NOT NULL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'agendado',
      last_notification_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_pets_customer_id ON pets(customer_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_bookings_customer_id ON bookings(customer_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_bookings_pet_id ON bookings(pet_id);`);
}

module.exports = {
  pool,
  initDb,
  all,
  get,
  run,
};
