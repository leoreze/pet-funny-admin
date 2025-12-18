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

  // ====== OPENING HOURS (Horário de Funcionamento) ======
  await run(`
    CREATE TABLE IF NOT EXISTS opening_hours (
      id BIGSERIAL PRIMARY KEY,
      day_of_week SMALLINT NOT NULL UNIQUE, -- 0=Dom ... 6=Sáb
      is_closed BOOLEAN NOT NULL DEFAULT FALSE,
      open_time TIME,
      close_time TIME,
      capacity_per_slot INTEGER NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Seed padrão (se vazio): Seg–Sex 07:30–17:30, Sáb 07:30–13:00, Dom fechado
  const ohCount = await get(`SELECT COUNT(*)::int AS c FROM opening_hours;`);
  if ((ohCount?.c || 0) === 0) {
    const seedOH = [
      { d:0, closed:true,  open:null,    close:null,   cap:1 }, // Domingo
      { d:1, closed:false, open:'07:30', close:'17:30', cap:1 }, // Segunda
      { d:2, closed:false, open:'07:30', close:'17:30', cap:1 }, // Terça
      { d:3, closed:false, open:'07:30', close:'17:30', cap:1 }, // Quarta
      { d:4, closed:false, open:'07:30', close:'17:30', cap:1 }, // Quinta
      { d:5, closed:false, open:'07:30', close:'17:30', cap:1 }, // Sexta
      { d:6, closed:false, open:'07:30', close:'13:00', cap:1 }, // Sábado
    ];
    for (const r of seedOH) {
      await run(
        `INSERT INTO opening_hours (day_of_week, is_closed, open_time, close_time, capacity_per_slot)
         VALUES ($1,$2,$3,$4,$5)`,
        [r.d, r.closed, r.open, r.close, r.cap]
      );
    }
  }

    console.log('✔ services table ready');
  } catch (err) {
    console.error('✖ error creating services table:', err);
  }
}

// roda automaticamente ao subir o servidor
ensureServicesTable();

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
