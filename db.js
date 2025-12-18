// backend/db.js
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL não definido (Postgres). Configure no Render/Host.');
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
    const res = await client.query(sql, params);
    return res;
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
   Helpers
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

function normalizeBreedHistory(b) {
  // garante estrutura mínima p/ evitar erros na UI
  const history = safeJsonParse(b.history, []);
  return { ...b, history };
}

function uniqueBreedsByName(rows) {
  const map = new Map();
  for (const b of rows) {
    const key = (b.name || '').trim().toLowerCase();
    if (!key) continue;
    if (map.has(key)) continue;
    map.set(key, b);
  }
  // remove registros “placeholder”
  return Array.from(map.values()).filter(
    b => !String(b.history || '').includes('Entrada duplicada')
  );
}

/* =========================
   Init / Migration
========================= */
async function initDb() {
  // customers
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

  await query(`
    CREATE INDEX IF NOT EXISTS customers_phone_idx
    ON customers (phone);
  `);

  // pets
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

  await query(`
    CREATE INDEX IF NOT EXISTS pets_customer_idx
    ON pets (customer_id);
  `);

  // services
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

  // orders / appointments
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

  await query(`
    CREATE INDEX IF NOT EXISTS appointments_starts_idx
    ON appointments (starts_at);
  `);

  /* =========================
     DOG BREEDS
     - compat: server.js usa tabela dog_breeds
  ========================= */
// Migração best-effort: breeds (legado) -> dog_breeds (atual)
// Importante: dog_breeds pode ter colunas NOT NULL como size/coat etc.
// Então inserimos preenchendo apenas as colunas que EXISTEM e garantindo defaults.
await query(`
  DO $$
  DECLARE
    r RECORD;
    j JSONB;

    has_size BOOLEAN := FALSE;
    has_coat BOOLEAN := FALSE;
    has_is_active BOOLEAN := FALSE;
    has_updated_at BOOLEAN := FALSE;

    cols TEXT := '';
    vals TEXT := '';
    sql TEXT := '';
  BEGIN
    -- Se não existir tabela legado, sai
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name='breeds'
    ) THEN
      RETURN;
    END IF;

    -- Detecta colunas existentes em dog_breeds
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

    -- Monta lista de colunas/valores base
    cols := 'name, history';
    vals := '$1, $2';

    -- Adiciona defaults para colunas NOT NULL prováveis, se existirem
    IF has_size THEN
      cols := cols || ', size';
      vals := vals || ', $3';
    END IF;

    IF has_coat THEN
      cols := cols || ', coat';
      vals := vals || ', $4';
    END IF;

    IF has_is_active THEN
      cols := cols || ', is_active';
      vals := vals || ', $5';
    END IF;

    IF has_updated_at THEN
      cols := cols || ', updated_at';
      vals := vals || ', NOW()';
    END IF;

    sql := 'INSERT INTO dog_breeds (' || cols || ') VALUES (' || vals || ')
            ON CONFLICT (LOWER(name)) DO NOTHING';

    FOR r IN
      SELECT name, history
      FROM breeds
    LOOP
      BEGIN
        j := COALESCE(r.history::jsonb, '[]'::jsonb);
      EXCEPTION WHEN others THEN
        j := '[]'::jsonb;
      END;

      -- Valores default seguros:
      -- size: 'N/A' (ou 'indefinido') | coat: '' | is_active: true
      IF has_size AND has_coat AND has_is_active THEN
        EXECUTE sql USING r.name, j, 'N/A', '', TRUE;
      ELSIF has_size AND has_coat THEN
        EXECUTE sql USING r.name, j, 'N/A', '';
      ELSIF has_size AND has_is_active THEN
        EXECUTE sql USING r.name, j, 'N/A', TRUE;
      ELSIF has_size THEN
        EXECUTE sql USING r.name, j, 'N/A';
      ELSIF has_coat AND has_is_active THEN
        EXECUTE sql USING r.name, j, '', TRUE;
      ELSIF has_coat THEN
        EXECUTE sql USING r.name, j, '';
      ELSIF has_is_active THEN
        EXECUTE sql USING r.name, j, TRUE;
      ELSE
        EXECUTE sql USING r.name, j;
      END IF;

    END LOOP;

  END $$;
`);



  /* =========================
     OPENING HOURS (horário de funcionamento)
     - dow: 0=Dom ... 6=Sáb
     - is_closed: dia fechado
     - open_time / close_time: HH:MM
     - max_per_half_hour: capacidade por slot de 30min
     ========================= */

  // 1) Cria tabela se não existir (para instalações novas)
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

  // 2) Migra schema legado (se a tabela já existia com nomes diferentes)
  //    - day_of_week -> dow
  //    - max_per_slot -> max_per_half_hour
  //    - garante colunas essenciais
  //    - garante UNIQUE em dow (para ON CONFLICT funcionar)
  {
    const cols = await all(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='opening_hours'
    `);
    const colset = new Set((cols || []).map(c => c.column_name));

    // renomes seguros (apenas se destino não existir)
    if (colset.has('day_of_week') && !colset.has('dow')) {
      await query(`ALTER TABLE opening_hours RENAME COLUMN day_of_week TO dow;`);
      colset.add('dow'); colset.delete('day_of_week');
    }
    if (colset.has('max_per_slot') && !colset.has('max_per_half_hour')) {
      await query(`ALTER TABLE opening_hours RENAME COLUMN max_per_slot TO max_per_half_hour;`);
      colset.add('max_per_half_hour'); colset.delete('max_per_slot');
    }

    if (!colset.has('dow')) {
      await query(`ALTER TABLE opening_hours ADD COLUMN dow INTEGER;`);
      colset.add('dow');
    }
    if (!colset.has('is_closed')) {
      await query(`ALTER TABLE opening_hours ADD COLUMN is_closed BOOLEAN NOT NULL DEFAULT FALSE;`);
      colset.add('is_closed');
    }
    if (!colset.has('open_time')) {
      await query(`ALTER TABLE opening_hours ADD COLUMN open_time TEXT;`);
      colset.add('open_time');
    }
    if (!colset.has('close_time')) {
      await query(`ALTER TABLE opening_hours ADD COLUMN close_time TEXT;`);
      colset.add('close_time');
    }
    if (!colset.has('max_per_half_hour')) {
      await query(`ALTER TABLE opening_hours ADD COLUMN max_per_half_hour INTEGER NOT NULL DEFAULT 1;`);
      colset.add('max_per_half_hour');
    }
    if (!colset.has('updated_at')) {
      await query(`ALTER TABLE opening_hours ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
      colset.add('updated_at');
    }

    // normaliza dados (evita NULLs e valores inválidos)
    await query(`UPDATE opening_hours SET max_per_half_hour = 0 WHERE max_per_half_hour IS NULL;`);
    await query(`UPDATE opening_hours SET is_closed = FALSE WHERE is_closed IS NULL;`);

    // dow precisa estar entre 0..6 para a UI
    await query(`DELETE FROM opening_hours WHERE dow IS NULL OR dow < 0 OR dow > 6;`);

    // garante unicidade em dow
    // (ON CONFLICT precisa de constraint UNIQUE/PK na coluna alvo)
    await query(`
      DO $$
      BEGIN
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
  }

  // 3) Seed padrão se vazio
  const ohCount = await get(`SELECT COUNT(*)::int AS n FROM opening_hours;`);
  if ((ohCount?.n || 0) === 0) {
    const seed = [
      { dow: 1, is_closed: false, open_time: '07:30', close_time: '17:30', max_per_half_hour: 1 }, // Seg
      { dow: 2, is_closed: false, open_time: '07:30', close_time: '17:30', max_per_half_hour: 1 }, // Ter
      { dow: 3, is_closed: false, open_time: '07:30', close_time: '17:30', max_per_half_hour: 1 }, // Qua
      { dow: 4, is_closed: false, open_time: '07:30', close_time: '17:30', max_per_half_hour: 1 }, // Qui
      { dow: 5, is_closed: false, open_time: '07:30', close_time: '17:30', max_per_half_hour: 1 }, // Sex
      { dow: 6, is_closed: false, open_time: '07:30', close_time: '13:00', max_per_half_hour: 1 }, // Sáb
      { dow: 0, is_closed: true,  open_time: null,   close_time: null,   max_per_half_hour: 0 }, // Dom fechado
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
        [r.dow, r.is_closed, r.open_time, r.close_time, r.max_per_half_hour]
      );
    }
    console.log('✔ opening_hours seeded');
  } else {
    console.log('✔ opening_hours table ready (seed skipped)');
  }
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
