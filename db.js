// backend/db.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
    ? { rejectUnauthorized: false }
    : undefined,
});

/* =========================
   Helpers DB
========================= */
async function query(sql, params) {
  const client = await pool.connect();
  try {
    const res = await client.query(sql, params);
    return res;
  } finally {
    client.release();
  }
}
async function all(sql, params) {
  const res = await query(sql, params);
  return res.rows;
}
async function get(sql, params) {
  const res = await query(sql, params);
  return res.rows[0] || null;
}
async function run(sql, params) {
  const res = await query(sql, params);
  return res;
}

/* =========================
   Utilities
========================= */
function safeJsonParse(str, fallback) {
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
     Core tables (safe)
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
      birthdate DATE,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS pets_customer_idx ON pets (customer_id);`);

  await query(`
    CREATE TABLE IF NOT EXISTS services (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      value_cents INTEGER NOT NULL DEFAULT 0,
      duration_min INTEGER NOT NULL DEFAULT 60,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      pet_id INTEGER REFERENCES pets(id) ON DELETE SET NULL,
      service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,

      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      pet_name TEXT,
      pet_breed TEXT,
      pet_size TEXT,

      service_name TEXT,
      service_value_cents INTEGER NOT NULL DEFAULT 0,
      service_duration_min INTEGER NOT NULL DEFAULT 60,

      start_at TIMESTAMPTZ NOT NULL,
      end_at TIMESTAMPTZ NOT NULL,

      status TEXT NOT NULL DEFAULT 'scheduled',
      notes TEXT,

      -- Campo legado de “mimo” em texto (mantém compatibilidade com seu admin/agenda)
    prize TEXT,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS bookings_start_at_idx ON bookings (start_at);`);
  await query(`CREATE INDEX IF NOT EXISTS bookings_phone_idx ON bookings (customer_phone);`);

  /* -------------------------
     Breeds (legado) + dog_breeds (novo)
  ------------------------- */
  await query(`
    CREATE TABLE IF NOT EXISTS breeds (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      history TEXT,
      size TEXT,
      coat TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS breeds_lower_name_ux ON breeds (LOWER(name));`);

  await query(`
    CREATE TABLE IF NOT EXISTS dog_breeds (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      history JSONB NOT NULL DEFAULT '[]'::jsonb,
      size TEXT NOT NULL DEFAULT 'pequeno',
      coat TEXT NOT NULL DEFAULT 'curta',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT dog_breeds_lower_name_ux UNIQUE (LOWER(name)),
      CONSTRAINT dog_breeds_size_check CHECK (size IN ('pequeno','medio','grande','gigante')),
      CONSTRAINT dog_breeds_coat_check CHECK (coat IN ('curta','media','longa'))
    );
  `);

  /* -------------------------
     Migração breeds -> dog_breeds (NUNCA derruba servidor)
     Corrige:
     - history TEXT não-JSON (ex.: "Raça alemã...") => vira []
     - size NULL => default válido
     - coat inválido (ex.: N/A, média com acento) => normaliza
  ------------------------- */
  try {
    await query(`
      DO $$
      DECLARE
        has_history BOOLEAN := FALSE;
        has_size BOOLEAN := FALSE;
        has_coat BOOLEAN := FALSE;
        has_is_active BOOLEAN := FALSE;
        has_updated_at BOOLEAN := FALSE;

        r RECORD;
        j JSONB;

        size_default TEXT := NULL;
        coat_default TEXT := NULL;

        sql_min TEXT := 'INSERT INTO dog_breeds (name, history) VALUES ($1, $2)
                         ON CONFLICT (LOWER(name)) DO NOTHING';
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema='public' AND table_name='breeds'
        ) THEN
          RETURN;
        END IF;

        SELECT EXISTS(
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='breeds' AND column_name='history'
        ) INTO has_history;

        SELECT EXISTS(
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='breeds' AND column_name='size'
        ) INTO has_size;

        SELECT EXISTS(
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='breeds' AND column_name='coat'
        ) INTO has_coat;

        SELECT EXISTS(
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='breeds' AND column_name='is_active'
        ) INTO has_is_active;

        SELECT EXISTS(
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='breeds' AND column_name='updated_at'
        ) INTO has_updated_at;

        -- defaults seguros (compatíveis com CHECK)
        SELECT size FROM dog_breeds WHERE size IS NOT NULL LIMIT 1 INTO size_default;
        IF size_default IS NULL THEN size_default := 'pequeno'; END IF;

        SELECT coat FROM dog_breeds WHERE coat IS NOT NULL LIMIT 1 INTO coat_default;
        IF coat_default IS NULL THEN coat_default := 'curta'; END IF;

        FOR r IN
          SELECT * FROM breeds
        LOOP
          -- history: tenta JSON, senão []
          IF has_history THEN
            BEGIN
              j := COALESCE(r.history::jsonb, '[]'::jsonb);
            EXCEPTION WHEN others THEN
              j := '[]'::jsonb;
            END;
          ELSE
            j := '[]'::jsonb;
          END IF;

          -- size: normaliza para ('pequeno','medio','grande','gigante')
          -- aceita entradas com acento/variações
          IF has_size THEN
            IF r.size IS NULL OR btrim(r.size) = '' THEN
              r.size := size_default;
            ELSE
              r.size := lower(btrim(r.size));
              r.size := replace(r.size, 'médio', 'medio');
              r.size := replace(r.size, 'média', 'media');
              IF r.size NOT IN ('pequeno','medio','grande','gigante') THEN
                r.size := size_default;
              END IF;
            END IF;
          END IF;

          -- coat: normaliza para ('curta','media','longa')
          IF has_coat THEN
            IF r.coat IS NULL OR btrim(r.coat) = '' THEN
              r.coat := coat_default;
            ELSE
              r.coat := lower(btrim(r.coat));
              r.coat := replace(r.coat, 'médio', 'medio');
              r.coat := replace(r.coat, 'média', 'media');
              IF r.coat NOT IN ('curta','media','longa') THEN
                r.coat := coat_default;
              END IF;
            END IF;
          END IF;

          -- tenta inserir com o máximo de colunas possível
          BEGIN
            IF has_size AND has_coat THEN
              EXECUTE 'INSERT INTO dog_breeds (name, history, size, coat, is_active, updated_at)
                       VALUES ($1, $2, $3, $4, TRUE, NOW())
                       ON CONFLICT (LOWER(name)) DO NOTHING'
                USING r.name, j, r.size, r.coat;
            ELSIF has_size AND NOT has_coat THEN
              EXECUTE 'INSERT INTO dog_breeds (name, history, size, is_active, updated_at)
                       VALUES ($1, $2, $3, TRUE, NOW())
                       ON CONFLICT (LOWER(name)) DO NOTHING'
                USING r.name, j, r.size;
            ELSIF (NOT has_size) AND has_coat THEN
              EXECUTE 'INSERT INTO dog_breeds (name, history, coat, is_active, updated_at)
                       VALUES ($1, $2, $3, TRUE, NOW())
                       ON CONFLICT (LOWER(name)) DO NOTHING'
                USING r.name, j, r.coat;
            ELSE
              EXECUTE sql_min USING r.name, j;
            END IF;
          EXCEPTION WHEN others THEN
            -- ignora linha problemática e segue
            NULL;
          END;
        END LOOP;
      END $$;
    `);
  } catch (err) {
    // IMPORTANTE: não derrubar o servidor por seed/migração de raças
    console.warn('Aviso: migração breeds->dog_breeds falhou, seguindo sem derrubar:', err?.message || err);
  }

  /* -------------------------
     mimos (prêmios da roleta)
     - title
     - description (com emojis)
     - value_cents (inteiro, centavos)
     - starts_at / ends_at (período em que aparece na roleta)
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

  // Índices úteis para filtro por período
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
     opening_hours (Horário de Funcionamento)
  ------------------------- */
  await query(`
    CREATE TABLE IF NOT EXISTS opening_hours (
      id SERIAL PRIMARY KEY,
      weekday SMALLINT NOT NULL,   -- 0=Dom ... 6=Sáb
      is_closed BOOLEAN NOT NULL DEFAULT FALSE,
      open_time TEXT,             -- "09:00"
      close_time TEXT,            -- "18:00"
      max_per_half_hour INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT opening_hours_weekday_ux UNIQUE (weekday)
    );
  `);

  // garante 7 dias
  await query(`
    INSERT INTO opening_hours (weekday, is_closed, open_time, close_time, max_per_half_hour)
    SELECT d, FALSE, '09:00', '18:00', 1
    FROM generate_series(0,6) d
    ON CONFLICT (weekday) DO NOTHING;
  `);
}

module.exports = {
  pool,
  query,
  all,
  get,
  run,
  initDb,
  normalizeBreedHistory,
  uniqueBreedsByName,
};
