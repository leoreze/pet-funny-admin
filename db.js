// backend/db.js — PostgreSQL (pg)
// Requer: npm i pg

const { Pool } = require('pg');

// Render geralmente injeta DATABASE_URL
const DATABASE_URL = process.env.DATABASE_URL;

// SSL: no Render normalmente precisa em produção.
// Se você estiver rodando local, pode deixar PGSSLMODE=disable ou NODE_ENV=development.
const isProduction = process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

/**
 * Helper para queries:
 * - all: retorna array
 * - get: retorna 1 linha ou null
 * - run: retorna { lastID, changes }
 */
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

/**
 * run:
 * - Para INSERT com RETURNING id, lastID vem.
 * - Para UPDATE/DELETE, changes vem de rowCount.
 */
async function run(sql, params = []) {
  const res = await query(sql, params);

  let lastID;
  // Se tiver RETURNING id, pega o primeiro
  if (res.rows && res.rows[0]) {
    if (res.rows[0].id !== undefined && res.rows[0].id !== null) {
      lastID = Number(res.rows[0].id);
    }
  }

  return {
    lastID,
    changes: typeof res.rowCount === 'number' ? res.rowCount : undefined,
  };
}

/**
 * initDb:
 * - Cria tabelas/índices se não existirem (idempotente)
 * - Mantém pet_id NULL em bookings
 */
async function initDb() {
  // Observação: Postgres não suporta "CREATE TABLE IF NOT EXISTS" com FK inline? Suporta sim.
  // E índices com IF NOT EXISTS também.
  const sql = `
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      phone TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS pets (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      breed TEXT,
      info TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      pet_id INTEGER REFERENCES pets(id) ON DELETE SET NULL, -- ✅ pode ser NULL
      date TEXT NOT NULL,   -- YYYY-MM-DD
      time TEXT NOT NULL,   -- HH:MM
      service TEXT NOT NULL,
      prize TEXT NOT NULL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'agendado',
      last_notification_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
    CREATE INDEX IF NOT EXISTS idx_pets_customer_id ON pets(customer_id);
    CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);
    CREATE INDEX IF NOT EXISTS idx_bookings_customer_id ON bookings(customer_id);
    CREATE INDEX IF NOT EXISTS idx_bookings_pet_id ON bookings(pet_id);
  `;

  await query(sql);
}

module.exports = {
  pool,
  initDb,
  all,
  get,
  run,
};
