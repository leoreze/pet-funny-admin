// db.js
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL não definido. Configure no seu host (Render/Prod).');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
});

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

async function all(sql, params = []) {
  const res = await query(sql, params);
  return res.rows || [];
}

async function get(sql, params = []) {
  const res = await query(sql, params);
  return (res.rows && res.rows[0]) ? res.rows[0] : null;
}

async function run(sql, params = []) {
  const res = await query(sql, params);
  return { rowCount: res.rowCount };
}

/* =========================
   Helpers (compat)
========================= */
function normalizePhone(phone) {
  if (!phone) return null;
  return String(phone).replace(/\D/g, '');
}
function normalizePlate(plate) {
  if (!plate) return null;
  return String(plate).trim().toUpperCase();
}
function normalizeCPF(cpf) {
  if (!cpf) return null;
  return String(cpf).replace(/\D/g, '');
}
function safeJsonParse(str, fallback = null) {
  if (str == null) return fallback;
  if (typeof str === 'object') return str;
  try { return JSON.parse(str); } catch { return fallback; }
}


async function initDb() {
  /* -------------------------
     Core
  ------------------------- */
  // Customers
  await query(`
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      phone TEXT NOT NULL,
      name TEXT NOT NULL,
      cep TEXT,
      street TEXT,
      number TEXT,
      complement TEXT,
      neighborhood TEXT,
      city TEXT,
      state TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // PATCH: add detailed address fields to customers (CEP, street, etc) - 2025-12-24
  await query(`
    ALTER TABLE customers
      ADD COLUMN IF NOT EXISTS cep TEXT,
      ADD COLUMN IF NOT EXISTS street TEXT,
      ADD COLUMN IF NOT EXISTS number TEXT,
      ADD COLUMN IF NOT EXISTS complement TEXT,
      ADD COLUMN IF NOT EXISTS neighborhood TEXT,
      ADD COLUMN IF NOT EXISTS city TEXT,
      ADD COLUMN IF NOT EXISTS state TEXT;
  `);
  await query(`CREATE INDEX IF NOT EXISTS customers_phone_idx ON customers (phone);`);

  await query(`
    CREATE TABLE IF NOT EXISTS pets (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      species TEXT NOT NULL DEFAULT 'dog',
      breed TEXT,
      size TEXT,
      coat TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS pets_customer_idx ON pets (customer_id);`);

  // PATCH compat: garante colunas de auditoria mesmo em bancos antigos
  await query(`ALTER TABLE pets ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await query(`ALTER TABLE pets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await query(`UPDATE pets SET created_at = NOW() WHERE created_at IS NULL;`);
  await query(`UPDATE pets SET updated_at = NOW() WHERE updated_at IS NULL;`);
  // Compat + novos campos (porte/pelagem/observações)
  // Mantém a coluna "info" por compatibilidade com versões antigas do backend/admin.
  await query(`ALTER TABLE pets ADD COLUMN IF NOT EXISTS size TEXT;`);
  await query(`ALTER TABLE pets ADD COLUMN IF NOT EXISTS coat TEXT;`);
  await query(`ALTER TABLE pets ADD COLUMN IF NOT EXISTS notes TEXT;`);
  await query(`ALTER TABLE pets ADD COLUMN IF NOT EXISTS info TEXT;`);

  // IMPORTANTE: este schema de services é o que o server.js usa (date,title,value_cents)
  await query(`
    CREATE TABLE IF NOT EXISTS services (
      id SERIAL PRIMARY KEY,
      date DATE NOT NULL,
      title TEXT NOT NULL,
      value_cents INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  
  
  // ===== services: novos campos (categoria/porte/tempo) =====
  await query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'Banho';`);
  await query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS porte TEXT;`);
  await query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS duration_min INTEGER NOT NULL DEFAULT 0;`);

  // Normaliza dados existentes
  await query(`UPDATE services SET category = 'Banho' WHERE category IS NULL OR category = '';`);
  await query(`UPDATE services SET duration_min = 0 WHERE duration_min IS NULL;`);

// services - novos campos (categoria, porte, tempo)
  await query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS category TEXT;`);
  await query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS porte TEXT;`);
  await query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS duration_min INTEGER;`);
// bookings (agendamentos) - compat com seu server.js (date/time como texto)
  await query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      pet_id INTEGER REFERENCES pets(id) ON DELETE SET NULL,
      service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      service TEXT,
      prize TEXT NOT NULL DEFAULT '',
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'agendado',
      last_notification_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);


  // ===== bookings: campos de pagamento =====
  await query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'Não Pago';`);
  await query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT '';`);
  await query(`UPDATE bookings SET payment_status = 'Não Pago' WHERE payment_status IS NULL OR payment_status = '';`);
  await query(`UPDATE bookings SET payment_method = '' WHERE payment_method IS NULL;`);

/* =========================
     BOOKING_SERVICES (múltiplos serviços por agendamento)
  ========================= */
  await run(`
    CREATE TABLE IF NOT EXISTS booking_services (
      booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
      qty INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (booking_id, service_id)
    );
  `);

  // Migração automática: converte o serviço legado (bookings.service_id) em linhas em booking_services
  await run(`
    INSERT INTO booking_services (booking_id, service_id, qty)
    SELECT b.id, b.service_id, 1
    FROM bookings b
    WHERE b.service_id IS NOT NULL
    ON CONFLICT (booking_id, service_id) DO NOTHING;
  `);


  // índices úteis
  await query(`CREATE INDEX IF NOT EXISTS idx_bookings_customer_id ON bookings(customer_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_bookings_pet_id ON bookings(pet_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_bookings_service_id ON bookings(service_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_bookings_date_time ON bookings(date, time);`);


  /* -------------------------
     MIMOS (novo)
  ------------------------- */
  await query(`
    CREATE TABLE IF NOT EXISTS mimos (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      value_cents INTEGER NOT NULL DEFAULT 0,
      starts_at TIMESTAMPTZ,
      ends_at TIMESTAMPTZ,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname='public' AND tablename='mimos' AND indexname='mimos_active_period_idx'
      ) THEN
        CREATE INDEX mimos_active_period_idx ON mimos(is_active, starts_at, ends_at);
      END IF;
    END $$;
  `);

  /* -------------------------
     opening_hours
  ------------------------- */
  await query(`
    CREATE TABLE IF NOT EXISTS opening_hours (
      dow INTEGER,
      is_closed BOOLEAN NOT NULL DEFAULT FALSE,
      open_time TEXT,
      close_time TEXT,
      max_per_half_hour INTEGER NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='opening_hours' AND column_name='day_of_week'
      )
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='opening_hours' AND column_name='dow'
      )
      THEN
        ALTER TABLE opening_hours RENAME COLUMN day_of_week TO dow;
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='opening_hours' AND column_name='max_per_slot'
      )
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='opening_hours' AND column_name='max_per_half_hour'
      )
      THEN
        ALTER TABLE opening_hours RENAME COLUMN max_per_slot TO max_per_half_hour;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='opening_hours' AND column_name='dow'
      ) THEN
        ALTER TABLE opening_hours ADD COLUMN dow INTEGER;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='opening_hours' AND column_name='is_closed'
      ) THEN
        ALTER TABLE opening_hours ADD COLUMN is_closed BOOLEAN NOT NULL DEFAULT FALSE;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='opening_hours' AND column_name='open_time'
      ) THEN
        ALTER TABLE opening_hours ADD COLUMN open_time TEXT;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='opening_hours' AND column_name='close_time'
      ) THEN
        ALTER TABLE opening_hours ADD COLUMN close_time TEXT;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='opening_hours' AND column_name='max_per_half_hour'
      ) THEN
        ALTER TABLE opening_hours ADD COLUMN max_per_half_hour INTEGER NOT NULL DEFAULT 1;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='opening_hours' AND column_name='updated_at'
      ) THEN
        ALTER TABLE opening_hours ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      END IF;

      UPDATE opening_hours SET is_closed = FALSE WHERE is_closed IS NULL;
      UPDATE opening_hours SET max_per_half_hour = 0 WHERE max_per_half_hour IS NULL;

      DELETE FROM opening_hours WHERE dow IS NULL OR dow < 0 OR dow > 6;

      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname='public' AND tablename='opening_hours' AND indexname='opening_hours_dow_unique'
      ) THEN
        CREATE UNIQUE INDEX opening_hours_dow_unique ON opening_hours(dow);
      END IF;
    END $$;
  `);

  // seed se vazio
  const ohCount = await get(`SELECT COUNT(*)::int AS n FROM opening_hours;`);
  if ((ohCount?.n || 0) === 0) {
    const seed = [
      { dow: 1, is_closed: false, open_time: '07:30', close_time: '17:30', max: 1 },
      { dow: 2, is_closed: false, open_time: '07:30', close_time: '17:30', max: 1 },
      { dow: 3, is_closed: false, open_time: '07:30', close_time: '17:30', max: 1 },
      { dow: 4, is_closed: false, open_time: '07:30', close_time: '17:30', max: 1 },
      { dow: 5, is_closed: false, open_time: '07:30', close_time: '17:30', max: 1 },
      { dow: 6, is_closed: false, open_time: '07:30', close_time: '13:00', max: 1 },
      { dow: 0, is_closed: true,  open_time: null,   close_time: null,   max: 0 },
    ];
    for (const r of seed) {
      await run(
        `INSERT INTO opening_hours (dow, is_closed, open_time, close_time, max_per_half_hour)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (dow) DO UPDATE
           SET is_closed=EXCLUDED.is_closed,
               open_time=EXCLUDED.open_time,
               close_time=EXCLUDED.close_time,
               max_per_half_hour=EXCLUDED.max_per_half_hour,
               updated_at=NOW()`,
        [r.dow, r.is_closed, r.open_time, r.close_time, r.max]
      );
    }
    console.log('✔ opening_hours seeded');
  }

  console.log('✔ initDb finalizado');
}

module.exports = {
  pool,
  initDb,
  all,
  get,
  run,
  query,
  normalizePhone,
  normalizePlate,
  normalizeCPF,
  safeJsonParse,
};
