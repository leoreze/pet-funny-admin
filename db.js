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



/* ============================
   MIGRATION: SERVICES TABLE
   ============================ */
async function ensureServicesTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS services (
      id SERIAL PRIMARY KEY,
      date DATE NOT NULL,
      title TEXT NOT NULL,
      price INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE services
    ADD COLUMN IF NOT EXISTS price NUMERIC(10,2) NOT NULL DEFAULT 0;

    CREATE INDEX IF NOT EXISTS idx_services_date
      ON services(date);
  `;
  try {
    await pool.query(sql);
    console.log('✔ services table ready');
  } catch (err) {
    console.error('✖ error creating services table:', err);
  }
}

// roda automaticamente ao subir o servidor
ensureServicesTable();

// Init DB (idempotente e seguro)
async function ensureOpeningHoursTable() {
  // 0=Domingo ... 6=Sábado (padrão JS Date.getDay)
  await run(`
    CREATE TABLE IF NOT EXISTS opening_hours (
      dow INTEGER PRIMARY KEY,
      is_closed BOOLEAN NOT NULL DEFAULT FALSE,
      open_time TIME NULL,
      close_time TIME NULL,
      max_per_half_hour INTEGER NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Seed default rows if missing
  const existing = await all(`SELECT dow FROM opening_hours ORDER BY dow`);
  const existingSet = new Set(existing.map(r => Number(r.dow)));

  const defaults = [
    { dow: 0, is_closed: true,  open_time: null,    close_time: null,    max_per_half_hour: 0 }, // Domingo
    { dow: 1, is_closed: false, open_time: '09:00', close_time: '18:00', max_per_half_hour: 1 }, // Segunda
    { dow: 2, is_closed: false, open_time: '09:00', close_time: '18:00', max_per_half_hour: 1 }, // Terça
    { dow: 3, is_closed: false, open_time: '09:00', close_time: '18:00', max_per_half_hour: 1 }, // Quarta
    { dow: 4, is_closed: false, open_time: '09:00', close_time: '18:00', max_per_half_hour: 1 }, // Quinta
    { dow: 5, is_closed: false, open_time: '09:00', close_time: '18:00', max_per_half_hour: 1 }, // Sexta
    { dow: 6, is_closed: false, open_time: '09:00', close_time: '13:00', max_per_half_hour: 1 }, // Sábado
  ];

  for (const d of defaults) {
    if (existingSet.has(d.dow)) continue;
    await run(
      `INSERT INTO opening_hours (dow, is_closed, open_time, close_time, max_per_half_hour)
       VALUES ($1,$2,$3,$4,$5)`,
      [d.dow, d.is_closed, d.open_time, d.close_time, d.max_per_half_hour]
    );
  }
}

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

  
  await ensureOpeningHoursTable();

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
