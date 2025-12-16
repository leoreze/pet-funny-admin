// db.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

/* =========================
   HELPERS
========================= */

async function columnExists(table, column) {
  const q = `
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = $1 AND column_name = $2
  `;
  const r = await pool.query(q, [table, column]);
  return r.rowCount > 0;
}

/* =========================
   MIGRATIONS
========================= */

async function ensureCustomersTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      phone TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

async function ensurePetsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pets (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      breed TEXT,
      info TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

async function ensureServicesTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS services (
      id SERIAL PRIMARY KEY,
      date DATE NOT NULL,
      title TEXT NOT NULL,
      value_cents INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // remove coluna antiga "price" se existir
  if (await columnExists('services', 'price')) {
    await pool.query(`ALTER TABLE services DROP COLUMN price`);
  }
}

async function ensureBookingsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER REFERENCES customers(id),
      pet_id INTEGER REFERENCES pets(id),
      service TEXT, -- compatibilidade
      service_id INTEGER REFERENCES services(id),
      prize TEXT,
      date DATE NOT NULL,
      time TEXT NOT NULL,
      status TEXT DEFAULT 'agendado',
      notes TEXT,
      phone TEXT NOT NULL,
      last_notification_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  if (!(await columnExists('bookings', 'service_id'))) {
    await pool.query(`ALTER TABLE bookings ADD COLUMN service_id INTEGER REFERENCES services(id)`);
  }
}

/* =========================
   INIT
========================= */

async function init() {
  await ensureCustomersTable();
  await ensurePetsTable();
  await ensureServicesTable();
  await ensureBookingsTable();
}

init().catch(err => {
  console.error('Erro ao inicializar banco:', err);
  process.exit(1);
});

/* =========================
   EXPORTS
========================= */

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
