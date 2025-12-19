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
      coat TEXT,
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
      description TEXT,
      duration_minutes INTEGER NOT NULL DEFAULT 60,
      value_cents INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS appointments (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      pet_id INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
      service_id INTEGER NOT NULL REFERENCES services(id),
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled',
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS appointments_starts_idx ON appointments (starts_at);`);

  /* -------------------------
     Compat: tabela bookings (legada)
     - Se existir em produção, normaliza start_at/end_at
     - Evita erro: "column start_at does not exist" ao criar índices
  ------------------------- */
  await query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name='bookings'
      ) THEN

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='bookings' AND column_name='starts_at'
        )
        AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='bookings' AND column_name='start_at'
        ) THEN
          ALTER TABLE bookings RENAME COLUMN starts_at TO start_at;
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='bookings' AND column_name='ends_at'
        )
        AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='bookings' AND column_name='end_at'
        ) THEN
          ALTER TABLE bookings RENAME COLUMN ends_at TO end_at;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='bookings' AND column_name='start_at'
        ) THEN
          ALTER TABLE bookings ADD COLUMN start_at TIMESTAMPTZ;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='bookings' AND column_name='end_at'
        ) THEN
          ALTER TABLE bookings ADD COLUMN end_at TIMESTAMPTZ;
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='bookings' AND column_name='start_at'
        )
        AND NOT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname='public' AND tablename='bookings' AND indexname='bookings_start_at_idx'
        ) THEN
          CREATE INDEX bookings_start_at_idx ON bookings (start_at);
        END IF;

      END IF;
    END $$;
  `);

  /* -------------------------
     dog_breeds (compat)
     - Se NÃO existir, cria versão simples (ambientes novos)
     - Se JÁ existir com constraints, não altera schema
  ------------------------- */
  await query(`
    CREATE TABLE IF NOT EXISTS dog_breeds (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      history JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

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
     Migração segura: breeds (legado) -> dog_breeds (atual)
     - Não derruba o serviço
  ------------------------- */
  try {
    await query(`
      DO $$
      DECLARE
        r RECORD;
        j JSONB;

        has_size BOOLEAN := FALSE;
        has_coat BOOLEAN := FALSE;
        has_is_active BOOLEAN := FALSE;
        has_updated_at BOOLEAN := FALSE;

        size_default TEXT := NULL;
        coat_default TEXT := NULL;

        cols TEXT := '';
        vals TEXT := '';
        sql TEXT := '';

        cols_no_coat TEXT := '';
        vals_no_coat TEXT := '';
        sql_no_coat TEXT := '';

        sql_min TEXT := 'INSERT INTO dog_breeds (name, history) VALUES ($1, $2)
                         ON CONFLICT (LOWER(name)) DO NOTHING';
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema='public' AND table_name='breeds'
        ) THEN
          RETURN;
        END IF;

        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='dog_breeds' AND column_name='size'
        ) INTO has_size;

        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='dog_breeds' AND column_name='coat'
        ) INTO has_coat;

        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='dog_breeds' AND column_name='is_active'
        ) INTO has_is_active;

        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='dog_breeds' AND column_name='updated_at'
        ) INTO has_updated_at;

        IF has_size THEN
          SELECT size FROM dog_breeds WHERE size IS NOT NULL LIMIT 1 INTO size_default;
          IF size_default IS NULL THEN size_default := 'PEQUENO'; END IF;
        END IF;

        IF has_coat THEN
          SELECT coat FROM dog_breeds WHERE coat IS NOT NULL LIMIT 1 INTO coat_default;
          IF coat_default IS NULL THEN coat_default := 'CURTA'; END IF;
        END IF;

        cols := 'name, history';
        vals := '$1, $2';

        IF has_size THEN cols := cols || ', size'; vals := vals || ', $3'; END IF;
        IF has_coat THEN cols := cols || ', coat'; vals := vals || ', $4'; END IF;
        IF has_is_active THEN cols := cols || ', is_active'; vals := vals || ', $5'; END IF;
        IF has_updated_at THEN cols := cols || ', updated_at'; vals := vals || ', NOW()'; END IF;

        sql := 'INSERT INTO dog_breeds (' || cols || ') VALUES (' || vals || ')
                ON CONFLICT (LOWER(name)) DO NOTHING';

        cols_no_coat := 'name, history';
        vals_no_coat := '$1, $2';

        IF has_size THEN cols_no_coat := cols_no_coat || ', size'; vals_no_coat := vals_no_coat || ', $3'; END IF;
        IF has_is_active THEN cols_no_coat := cols_no_coat || ', is_active'; vals_no_coat := vals_no_coat || ', $4'; END IF;
        IF has_updated_at THEN cols_no_coat := cols_no_coat || ', updated_at'; vals_no_coat := vals_no_coat || ', NOW()'; END IF;

        sql_no_coat := 'INSERT INTO dog_breeds (' || cols_no_coat || ') VALUES (' || vals_no_coat || ')
                        ON CONFLICT (LOWER(name)) DO NOTHING';

        FOR r IN
          SELECT name, history FROM breeds
        LOOP
          BEGIN
            j := COALESCE(r.history::jsonb, '[]'::jsonb);
          EXCEPTION WHEN others THEN
            j := '[]'::jsonb;
          END;

          BEGIN
            IF has_size AND has_coat AND has_is_active THEN
              EXECUTE sql USING r.name, j, size_default, coat_default, TRUE;
            ELSIF has_size AND has_coat THEN
              EXECUTE sql USING r.name, j, size_default, coat_default;
            ELSIF has_size AND has_is_active THEN
              EXECUTE sql USING r.name, j, size_default, TRUE;
            ELSIF has_size THEN
              EXECUTE sql USING r.name, j, size_default;
            ELSIF has_coat AND has_is_active THEN
              EXECUTE sql USING r.name, j, coat_default, TRUE;
            ELSIF has_coat THEN
              EXECUTE sql USING r.name, j, coat_default;
            ELSIF has_is_active THEN
              EXECUTE sql USING r.name, j, TRUE;
            ELSE
              EXECUTE sql USING r.name, j;
            END IF;

          EXCEPTION WHEN check_violation OR not_null_violation THEN
            BEGIN
              IF has_size AND has_is_active THEN
                EXECUTE sql_no_coat USING r.name, j, size_default, TRUE;
              ELSIF has_size THEN
                EXECUTE sql_no_coat USING r.name, j, size_default;
              ELSIF has_is_active THEN
                EXECUTE sql_no_coat USING r.name, j, TRUE;
              ELSE
                EXECUTE sql_min USING r.name, j;
              END IF;
            EXCEPTION WHEN others THEN
              PERFORM 1;
            END;
          EXCEPTION WHEN others THEN
            PERFORM 1;
          END;
        END LOOP;
      END $$;
    `);
  } catch (err) {
    console.warn('⚠️ Migração breeds -> dog_breeds falhou (ignorada para não derrubar o serviço):', err?.message || err);
  }

  /* -------------------------
     MIMOS (novo) - CRUD da aba "Mimos"
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
      )
      THEN
        ALTER TABLE opening_hours ADD COLUMN dow INTEGER;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='opening_hours' AND column_name='is_closed'
      )
      THEN
        ALTER TABLE opening_hours ADD COLUMN is_closed BOOLEAN NOT NULL DEFAULT FALSE;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='opening_hours' AND column_name='open_time'
      )
      THEN
        ALTER TABLE opening_hours ADD COLUMN open_time TEXT;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='opening_hours' AND column_name='close_time'
      )
      THEN
        ALTER TABLE opening_hours ADD COLUMN close_time TEXT;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='opening_hours' AND column_name='max_per_half_hour'
      )
      THEN
        ALTER TABLE opening_hours ADD COLUMN max_per_half_hour INTEGER NOT NULL DEFAULT 1;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='opening_hours' AND column_name='updated_at'
      )
      THEN
        ALTER TABLE opening_hours ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      END IF;

      UPDATE opening_hours SET is_closed = FALSE WHERE is_closed IS NULL;
      UPDATE opening_hours SET max_per_half_hour = 0 WHERE max_per_half_hour IS NULL;
      DELETE FROM opening_hours WHERE dow IS NULL OR dow < 0 OR dow > 6;

      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname='public'
          AND tablename='opening_hours'
          AND indexname='opening_hours_dow_unique'
      ) THEN
        CREATE UNIQUE INDEX opening_hours_dow_unique ON opening_hours(dow);
      END IF;
    END $$;
  `);

  const ohCount = await get(`SELECT COUNT(*)::int AS n FROM opening_hours;`);
  if ((ohCount?.n || 0) === 0) {
    const seed = [
      { dow: 1, is_closed: false, open_time: '07:30', close_time: '17:30', max: 1 },
      { dow: 2, is_closed: false, open_time: '07:30', close_time: '17:30', max: 1 },
      { dow: 3, is_closed: false, open_time: '07:30', close_time: '17:30', max: 1 },
      { dow: 4, is_closed: false, open_time: '07:30', close_time: '17:30', max: 1 },
      { dow: 5, is_closed: false, open_time: '07:30', close_time: '17:30', max: 1 },
      { dow: 6, is_closed: false, open_time: '07:30', close_time: '13:00', max: 1 },
      { dow: 0, is_closed: true, open_time: null, close_time: null, max: 0 },
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
