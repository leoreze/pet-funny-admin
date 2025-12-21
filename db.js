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

pool.on('error', (err) => {
  console.error('❌ Erro inesperado no pool do PostgreSQL:', err);
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
function normalizeBreedHistory(b) {
  const history = safeJsonParse(b.history, []);
  return { ...b, history };
}
function uniqueBreedsByName(rows) {
  const map = new Map();
  for (const b of rows) {
    const key = (b.name || '').trim().toLowerCase();
    if (!key) continue;
    if (!map.has(key)) map.set(key, b);
  }
  return Array.from(map.values());
}

/* =========================
   Init / Migration
========================= */
async function initDb() {
  /* -------------------------
     Core
  ------------------------- */
  await query(`
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT,
      cpf TEXT,
      address TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
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

  // índices úteis
  await query(`CREATE INDEX IF NOT EXISTS idx_bookings_customer_id ON bookings(customer_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_bookings_pet_id ON bookings(pet_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_bookings_service_id ON bookings(service_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_bookings_date_time ON bookings(date, time);`);

  /* -------------------------
     BREEDS (LEGADO) - se existir, mantém
     (Não derrubar o serviço por seed inválido)
  ------------------------- */
  await query(`
    CREATE TABLE IF NOT EXISTS breeds (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      history TEXT,
      size TEXT,
      coat TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  /* -------------------------
     dog_breeds (CRUD atual do server.js)
     - Alinhado com o server.js: history TEXT, characteristics TEXT
  ------------------------- */
  await query(`
    CREATE TABLE IF NOT EXISTS dog_breeds (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      history TEXT,
      size TEXT,
      coat TEXT,
      characteristics TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // índice único por LOWER(name) para ON CONFLICT (LOWER(name))
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname='public' AND tablename='dog_breeds' AND indexname='dog_breeds_name_lower_unique'
      ) THEN
        CREATE UNIQUE INDEX dog_breeds_name_lower_unique ON dog_breeds (LOWER(name));
      END IF;
    END $$;
  `);

  /* -------------------------
     Ajustes de compatibilidade + Migração best-effort: breeds -> dog_breeds
     - Garante colunas e tipos compatíveis com o server.js (history TEXT, characteristics TEXT)
     - Migra dados do legado (breeds) sem derrubar o serviço
  ------------------------- */
  try {
  await query(`
    DO $$
    DECLARE
      c_name TEXT;
    BEGIN
      -- Se existir coluna "notes" (versões antigas), renomeia para "characteristics"
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='dog_breeds' AND column_name='notes'
      )
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='dog_breeds' AND column_name='characteristics'
      )
      THEN
        ALTER TABLE dog_breeds RENAME COLUMN notes TO characteristics;
      END IF;

      -- Garante coluna characteristics
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='dog_breeds' AND column_name='characteristics'
      )
      THEN
        ALTER TABLE dog_breeds ADD COLUMN characteristics TEXT;
      END IF;

      -- Se history estiver como JSONB (versões antigas), converte para TEXT
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema='public' AND table_name='dog_breeds' AND column_name='history' AND data_type='jsonb'
      )
      THEN
        ALTER TABLE dog_breeds
          ALTER COLUMN history TYPE TEXT
          USING (history::text);
      END IF;

      /* =========================
         PATCH: remover CHECK antiga do coat (se existir)
         (evita "violates check constraint dog_breeds_coat_check")
      ========================= */
      SELECT con.conname INTO c_name
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE nsp.nspname='public'
        AND rel.relname='dog_breeds'
        AND con.contype='c'
        AND con.conname ILIKE '%coat%';

      IF c_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.dog_breeds DROP CONSTRAINT %I', c_name);
      END IF;

      -- Migra do legado (breeds) se existir
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name='breeds'
      ) THEN
        INSERT INTO dog_breeds (name, history, size, coat, characteristics, is_active, updated_at)
        SELECT
          b.name,
          b.history,
          b.size,
          b.coat,
          NULL,
          TRUE,
          NOW()
        FROM breeds b
        ON CONFLICT (LOWER(name)) DO NOTHING;
      END IF;
    END $$;
  `);
} catch (err) {
  console.warn('⚠️ Compat/migração dog_breeds falhou (ignorada):', err?.message || err);
}


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
      dow INTEGER PRIMARY KEY,
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
        ALTER TABLE opening_hours ADD COLUMN dow INT;
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
      { dow: 0, is_closed: true, open_time: null, close_time: null, max: 0 }, // domingo fechado
      { dow: 1, is_closed: false, open_time: '07:30', close_time: '17:30', max: 1 },
      { dow: 2, is_closed: false, open_time: '07:30', close_time: '17:30', max: 1 },
      { dow: 3, is_closed: false, open_time: '07:30', close_time: '17:30', max: 1 },
      { dow: 4, is_closed: false, open_time: '07:30', close_time: '17:30', max: 1 },
      { dow: 5, is_closed: false, open_time: '07:30', close_time: '17:30', max: 1 },
      { dow: 6, is_closed: false, open_time: '07:30', close_time: '12:00', max: 1 }, // sábado meio período
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
  normalizeBreedHistory,
  uniqueBreedsByName,
};
