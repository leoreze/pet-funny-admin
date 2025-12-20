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
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
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

  // Migração defensiva (caso seu banco já exista com schema antigo)
  // - adiciona colunas novas se faltarem
  // - migra "info" -> "notes" se existir
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='pets' AND column_name='species'
      ) THEN
        ALTER TABLE pets ADD COLUMN species TEXT NOT NULL DEFAULT 'dog';
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='pets' AND column_name='size'
      ) THEN
        ALTER TABLE pets ADD COLUMN size TEXT;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='pets' AND column_name='coat'
      ) THEN
        ALTER TABLE pets ADD COLUMN coat TEXT;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='pets' AND column_name='notes'
      ) THEN
        ALTER TABLE pets ADD COLUMN notes TEXT;
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='pets' AND column_name='info'
      ) THEN
        -- copia conteúdo do info para notes, sem sobrescrever notes já preenchido
        EXECUTE 'UPDATE pets SET notes = COALESCE(notes, info) WHERE info IS NOT NULL';
        ALTER TABLE pets DROP COLUMN info;
      END IF;
    END $$;
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS bookings_date_time_idx ON bookings (date, time);`);
  await query(`CREATE INDEX IF NOT EXISTS bookings_customer_idx ON bookings (customer_id);`);

  /* -------------------------
     dog_breeds (CRUD atual do server.js)
     - Se NÃO existir, cria versão "flexível" (sem NOT NULL/CHECK), para não quebrar seed/migração.
     - Se JÁ existir com constraints (produção), não altera schema.
  ------------------------- */
  await query(`
    CREATE TABLE IF NOT EXISTS dog_breeds (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      history JSONB NOT NULL DEFAULT '[]'::jsonb,
      size TEXT,
      coat TEXT,
      notes TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Migração defensiva (caso dog_breeds exista com schema antigo)
  // - garante colunas esperadas pelo server.js
  // - migra "characteristics" -> "notes" se existir
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='dog_breeds' AND column_name='notes'
      ) THEN
        ALTER TABLE dog_breeds ADD COLUMN notes TEXT;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='dog_breeds' AND column_name='history'
      ) THEN
        ALTER TABLE dog_breeds ADD COLUMN history JSONB NOT NULL DEFAULT '[]'::jsonb;
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='dog_breeds' AND column_name='characteristics'
      ) THEN
        EXECUTE 'UPDATE dog_breeds SET notes = COALESCE(notes, characteristics) WHERE characteristics IS NOT NULL';
        ALTER TABLE dog_breeds DROP COLUMN characteristics;
      END IF;
    END $$;
  `);

  // índice único por LOWER(name) para evitar duplicatas (sem quebrar caso já exista)
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname='public' AND tablename='dog_breeds' AND indexname='dog_breeds_name_unique_idx'
      ) THEN
        EXECUTE 'CREATE UNIQUE INDEX dog_breeds_name_unique_idx ON dog_breeds (LOWER(name))';
      END IF;
    END $$;
  `);

  /* -------------------------
     Migração opcional: tabela antiga breeds -> dog_breeds (se existir)
  ------------------------- */
  try {
    await query(`
      DO $$
      DECLARE
        has_old BOOLEAN;
        r RECORD;
      BEGIN
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema='public' AND table_name='breeds'
        ) INTO has_old;

        IF has_old THEN
          -- tenta copiar dados se fizer sentido; ignora erros
          FOR r IN
            SELECT * FROM breeds
          LOOP
            BEGIN
              INSERT INTO dog_breeds (name, history, size, coat, notes, is_active, updated_at)
              VALUES (
                COALESCE(r.name, 'Sem nome'),
                '[]'::jsonb,
                COALESCE(r.size, NULL),
                COALESCE(r.coat, NULL),
                COALESCE(r.notes, NULL),
                COALESCE(r.is_active, TRUE),
                NOW()
              )
              ON CONFLICT (LOWER(name)) DO NOTHING;
            EXCEPTION WHEN others THEN
              PERFORM 1;
            END;
          END LOOP;
        END IF;
      END $$;
    `);
  } catch (err) {
    console.warn('⚠️ Migração breeds -> dog_breeds falhou (ignorada):', err?.message || err);
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
        WHERE schemaname='public' AND tablename='mimos' AND indexname='mimos_active_idx'
      ) THEN
        EXECUTE 'CREATE INDEX mimos_active_idx ON mimos (is_active)';
      END IF;
    END $$;
  `);

  /* -------------------------
     OPENING HOURS (horário funcionamento)
  ------------------------- */
  await query(`
    CREATE TABLE IF NOT EXISTS opening_hours (
      dow INTEGER NOT NULL,
      is_closed BOOLEAN NOT NULL DEFAULT FALSE,
      open_time TEXT,
      close_time TEXT,
      max_per_half_hour INTEGER NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Unique index para permitir ON CONFLICT(dow)
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname='public' AND tablename='opening_hours' AND indexname='opening_hours_dow_unique_idx'
      ) THEN
        EXECUTE 'CREATE UNIQUE INDEX opening_hours_dow_unique_idx ON opening_hours (dow)';
      END IF;
    END $$;
  `);

  // Seed inicial (se tabela estiver vazia)
  const seed = await get(`SELECT COUNT(*)::int AS cnt FROM opening_hours`);
  if ((seed?.cnt ?? 0) === 0) {
    const defaults = [
      { dow: 1, is_closed: false, open_time: '07:30', close_time: '17:30', max_per_half_hour: 1 },
      { dow: 2, is_closed: false, open_time: '07:30', close_time: '17:30', max_per_half_hour: 1 },
      { dow: 3, is_closed: false, open_time: '07:30', close_time: '17:30', max_per_half_hour: 1 },
      { dow: 4, is_closed: false, open_time: '07:30', close_time: '17:30', max_per_half_hour: 1 },
      { dow: 5, is_closed: false, open_time: '07:30', close_time: '17:30', max_per_half_hour: 1 },
      { dow: 6, is_closed: false, open_time: '08:00', close_time: '12:00', max_per_half_hour: 1 },
      { dow: 7, is_closed: true, open_time: null, close_time: null, max_per_half_hour: 0 },
    ];

    for (const d of defaults) {
      await run(
        `
        INSERT INTO opening_hours (dow, is_closed, open_time, close_time, max_per_half_hour, updated_at)
        VALUES ($1,$2,$3,$4,$5,NOW())
        ON CONFLICT (dow)
        DO UPDATE SET
          is_closed=EXCLUDED.is_closed,
          open_time=EXCLUDED.open_time,
          close_time=EXCLUDED.close_time,
          max_per_half_hour=EXCLUDED.max_per_half_hour,
          updated_at=NOW()
        `,
        [d.dow, d.is_closed, d.open_time, d.close_time, d.max_per_half_hour]
      );
    }
  }
}

module.exports = {
  query,
  all,
  get,
  run,
  initDb,
  pool,
  normalizePhone,
  normalizePlate,
  normalizeCPF,
  safeJsonParse,
};
