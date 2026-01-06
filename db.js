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
  await query("CREATE INDEX IF NOT EXISTS customers_phone_idx ON customers (phone);");
  // Automação WhatsApp: opt-out
  await query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS opt_out_whatsapp BOOLEAN NOT NULL DEFAULT FALSE;`);


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
  await query("CREATE INDEX IF NOT EXISTS pets_customer_idx ON pets (customer_id);");
/* -------------------------
   dog_breeds (Raças de Cães)
------------------------- */
await query(`
  CREATE TABLE IF NOT EXISTS dog_breeds (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    history TEXT,
    size TEXT NOT NULL,
    coat TEXT NOT NULL,
    characteristics TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`);
  await query("CREATE INDEX IF NOT EXISTS dog_breeds_name_idx ON dog_breeds (name);");
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

  
  
  
  /* -------------------------
     PATCH compat: migrations de services (bases antigas)
     - suporta colunas antigas: name, price (NUMERIC), tempo_min, duration, etc.
  ------------------------- */
  await query(`
    DO $$
    BEGIN
      -- title (antigo: name)
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='services' AND column_name='title'
      ) THEN
        ALTER TABLE services ADD COLUMN title TEXT;
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='services' AND column_name='name'
      ) THEN
        UPDATE services SET title = COALESCE(title, name) WHERE (title IS NULL OR title = '');
      END IF;

      -- value_cents (antigo: price NUMERIC)
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='services' AND column_name='value_cents'
      ) THEN
        ALTER TABLE services ADD COLUMN value_cents INTEGER NOT NULL DEFAULT 0;
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='services' AND column_name='price'
      ) THEN
        UPDATE services
           SET value_cents = COALESCE(value_cents, ROUND(COALESCE(price,0) * 100)::INT)
         WHERE value_cents IS NULL OR value_cents = 0;
      END IF;

      -- duration_min (antigos: tempo_min, duration)
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='services' AND column_name='duration_min'
      ) THEN
        ALTER TABLE services ADD COLUMN duration_min INTEGER NOT NULL DEFAULT 0;
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='services' AND column_name='tempo_min'
      ) THEN
        UPDATE services
           SET duration_min = COALESCE(duration_min, tempo_min)
         WHERE duration_min IS NULL OR duration_min = 0;
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='services' AND column_name='duration'
      ) THEN
        UPDATE services
           SET duration_min = COALESCE(duration_min, duration)
         WHERE duration_min IS NULL OR duration_min = 0;
      END IF;

      -- Garantias finais de NOT NULL (quando possível)
      UPDATE services SET title = COALESCE(title, '') WHERE title IS NULL;
      UPDATE services SET value_cents = COALESCE(value_cents, 0) WHERE value_cents IS NULL;
      UPDATE services SET duration_min = COALESCE(duration_min, 0) WHERE duration_min IS NULL;
    END $$;
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

  // Campos adicionais do agendamento (pagamento + valor/tempo do(s) serviço(s))
  await query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'Não Pago';`);
  await query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT '';`);
  await query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_value_cents INTEGER;`);
  await query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_duration_min INTEGER;`);
  await query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS services_json JSONB NOT NULL DEFAULT '[]'::jsonb;`);


  // ===== Mercado Pago (Pix) =====
  await query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS mp_payment_id TEXT;`);
  await query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS mp_status TEXT;`);
  await query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS mp_qr_code TEXT;`);
  await query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS mp_qr_code_base64 TEXT;`);
  await query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS mp_paid_at TIMESTAMPTZ;`);




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
  await query("CREATE INDEX IF NOT EXISTS idx_bookings_customer_id ON bookings(customer_id);");
  await query("CREATE INDEX IF NOT EXISTS idx_bookings_pet_id ON bookings(pet_id);");
  await query("CREATE INDEX IF NOT EXISTS idx_bookings_service_id ON bookings(service_id);");
  await query("CREATE INDEX IF NOT EXISTS idx_bookings_date_time ON bookings(date, time);");
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

  
  /* -------------------------
     PACOTES (por porte) + VENDAS DE PACOTE
  ------------------------- */
  // Migração: versões antigas podem ter coluna `frequency` em vez de `type`
  await query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='service_packages' AND column_name='frequency'
      )
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='service_packages' AND column_name='type'
      )
      THEN
        ALTER TABLE service_packages RENAME COLUMN frequency TO type;
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='service_packages' AND column_name='package_type'
      )
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='service_packages' AND column_name='type'
      )
      THEN
        ALTER TABLE service_packages RENAME COLUMN package_type TO type;
      END IF;
    END $$;
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS service_packages (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'mensal', -- mensal | quinzenal
      porte TEXT NOT NULL,                -- Pequeno | Médio | Grande
      validity_days INTEGER NOT NULL DEFAULT 30,
      bath_qty INTEGER NOT NULL DEFAULT 4,
      bath_discount_percent INTEGER NOT NULL DEFAULT 0,
      bath_service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
      includes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Migração: versões antigas do schema podem não ter `bath_service_id`
  // (em algumas versões anteriores havia bath_service_id_p/m/g). Aqui garantimos
  // a coluna e tentamos popular automaticamente quando possível.
  await query(`ALTER TABLE service_packages ADD COLUMN IF NOT EXISTS bath_service_id INTEGER;`);
  await query(`
    DO $$
    BEGIN
      -- Se existirem colunas antigas bath_service_id_p/m/g, tenta mapear para bath_service_id
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='service_packages' AND column_name='bath_service_id_p'
      ) THEN
        UPDATE service_packages
           SET bath_service_id = CASE
             WHEN porte = 'Pequeno' THEN bath_service_id_p
             WHEN porte = 'Médio' THEN bath_service_id_m
             WHEN porte = 'Grande' THEN bath_service_id_g
             ELSE bath_service_id
           END
         WHERE bath_service_id IS NULL;
      END IF;
    END $$;
  `);
  await query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='service_packages' AND column_name='type'
      ) THEN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname='public' AND tablename='service_packages' AND indexname='service_packages_type_idx'
        ) THEN
          CREATE INDEX service_packages_type_idx ON service_packages (type);
        END IF;
      END IF;
    END $$;
  `);
  await query(`ALTER TABLE service_packages ADD COLUMN IF NOT EXISTS porte TEXT NOT NULL DEFAULT '';`);
  await query("CREATE INDEX IF NOT EXISTS service_packages_porte_idx ON service_packages (porte);");
await query(`
    CREATE TABLE IF NOT EXISTS package_sales (
      id SERIAL PRIMARY KEY,
      package_id INTEGER NOT NULL REFERENCES service_packages(id) ON DELETE RESTRICT,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      pet_id INTEGER REFERENCES pets(id) ON DELETE SET NULL,
      porte TEXT NOT NULL,
      start_date TEXT NOT NULL,
      time TEXT NOT NULL,
      expires_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'vigente', -- vigente | vencido | cancelado
      total_cents INTEGER NOT NULL DEFAULT 0,
      payment_status TEXT NOT NULL DEFAULT 'Pago',
      payment_method TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await query("CREATE INDEX IF NOT EXISTS package_sales_customer_idx ON package_sales (customer_id);");
  await query("CREATE INDEX IF NOT EXISTS package_sales_pet_idx ON package_sales (pet_id);");
  /* -------------------------
     AUTOMAÇÕES (WhatsApp)
  ------------------------- */
  await query(`
    CREATE TABLE IF NOT EXISTS message_templates (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      channel TEXT NOT NULL DEFAULT 'whatsapp',
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS automation_rules (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      trigger TEXT NOT NULL,
      delay_minutes INTEGER NOT NULL DEFAULT 0,
      cooldown_days INTEGER NOT NULL DEFAULT 0,
      audience_filter JSONB NOT NULL DEFAULT '{}'::jsonb,
      template_id INTEGER REFERENCES message_templates(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await query("CREATE INDEX IF NOT EXISTS automation_rules_trigger_idx ON automation_rules (trigger);");
  /* -------------------------
     EVENTOS + FILA (WhatsApp)
     - motor de eventos → message_queue → envio (manual link no MVP)
  ------------------------- */
  await query(`
    CREATE TABLE IF NOT EXISTS automation_events (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await query("CREATE INDEX IF NOT EXISTS automation_events_type_idx ON automation_events (type);");
  await query("CREATE INDEX IF NOT EXISTS automation_events_occurred_idx ON automation_events (occurred_at);");

  await query(`
    CREATE TABLE IF NOT EXISTS message_queue (
      id SERIAL PRIMARY KEY,
      channel TEXT NOT NULL DEFAULT 'whatsapp',
      status TEXT NOT NULL DEFAULT 'queued', -- queued | sending | sent | failed | cancelled
      to_phone TEXT NOT NULL,
      customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      rule_id INTEGER REFERENCES automation_rules(id) ON DELETE SET NULL,
      template_id INTEGER REFERENCES message_templates(id) ON DELETE SET NULL,
      event_id INTEGER REFERENCES automation_events(id) ON DELETE SET NULL,
      scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sent_at TIMESTAMPTZ,
      body TEXT NOT NULL,
      wa_link TEXT, -- link wa.me para envio manual (MVP)
      provider TEXT NOT NULL DEFAULT 'manual_link',
      meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await query("CREATE INDEX IF NOT EXISTS message_queue_status_sched_idx ON message_queue (status, scheduled_at);");
  await query("CREATE INDEX IF NOT EXISTS message_queue_customer_idx ON message_queue (customer_id);");

  await query(`
    CREATE TABLE IF NOT EXISTS message_delivery_log (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      to_phone TEXT NOT NULL,
      rule_id INTEGER REFERENCES automation_rules(id) ON DELETE SET NULL,
      template_id INTEGER REFERENCES message_templates(id) ON DELETE SET NULL,
      event_id INTEGER REFERENCES automation_events(id) ON DELETE SET NULL,
      message_queue_id INTEGER REFERENCES message_queue(id) ON DELETE SET NULL,
      status TEXT NOT NULL, -- sent | failed | cancelled
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      meta JSONB NOT NULL DEFAULT '{}'::jsonb
    );
  `);
  await query("CREATE INDEX IF NOT EXISTS message_delivery_log_customer_rule_idx ON message_delivery_log (customer_id, rule_id, sent_at);");

  await query(`
    CREATE TABLE IF NOT EXISTS whatsapp_inbound (
      id SERIAL PRIMARY KEY,
      from_phone TEXT NOT NULL,
      body TEXT NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      matched_command TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await query("CREATE INDEX IF NOT EXISTS whatsapp_inbound_from_idx ON whatsapp_inbound (from_phone, received_at);");

  // Seeds idempotentes (somente se estiver vazio)
  const tplCount = await get(`SELECT COUNT(*)::int AS n FROM message_templates;`);
  if ((tplCount?.n || 0) === 0) {
    await run(
      `INSERT INTO message_templates (code, channel, body) VALUES
        ('TPL_APPT_CONFIRM','whatsapp',$1),
        ('TPL_APPT_REMINDER','whatsapp',$2),
        ('TPL_POST_SERVICE','whatsapp',$3),
        ('TPL_RETENTION','whatsapp',$4),
        ('TPL_REFERRAL','whatsapp',$5)
      `,
      [
        "Oi {{customer_name}}! 🐾\nSeu agendamento no PetFunny está confirmado:\n\n• Pet: {{pet_name}}\n• Serviço: {{service_summary}}\n• Data/hora: {{date_br}} às {{time_br}}\n\nSe precisar reagendar, responda *REAGENDAR*.",
        "Oi {{customer_name}}! 🐾\nPassando pra lembrar do agendamento do(a) {{pet_name}}:\n\nAmanhã ({{date_br}}) às {{time_br}}.\n\nResponda:\n1️⃣ Confirmar\n2️⃣ Reagendar",
        "Oi {{customer_name}}! 🐾\nComo foi a experiência do(a) {{pet_name}} hoje no PetFunny?\n\nResponda com uma nota de 1 a 5 ⭐\n(1 = não gostei | 5 = amei)",
        "Oi {{customer_name}}! 🐾\nJá faz {{days_since_last}} dias desde o último banho do(a) {{pet_name}}.\n\nQuer que eu te mande os melhores horários pra esta semana?",
        "Oi {{customer_name}}! 🐾\nSe você gostou do PetFunny, posso te pedir uma ajuda?\n\nIndicando um amigo do bairro, você ganha um mimo na próxima visita.\n\nSeu código: *{{ref_code}}*\nQuer que eu te mande uma mensagem prontinha pra encaminhar?"
      ]
    );
  }

  const ruleCount = await get(`SELECT COUNT(*)::int AS n FROM automation_rules;`);
  if ((ruleCount?.n || 0) === 0) {
    const tpls = await all(`SELECT id, code FROM message_templates;`);
    const idByCode = new Map(tpls.map(t => [t.code, t.id]));
    await run(
      `INSERT INTO automation_rules (code, name, is_enabled, trigger, delay_minutes, cooldown_days, audience_filter, template_id)
       VALUES
        ('APPT_CONFIRM_D0','Confirmação imediata (D0)', TRUE,'appointment_created',0,0,'{}'::jsonb,$1),
        ('APPT_REMINDER_D1','Lembrete 24h antes (D-1)', TRUE,'appointment_reminder_24h',0,0,'{}'::jsonb,$2),
        ('POST_SERVICE_D0','Pós-atendimento (D0 + 1h)', TRUE,'appointment_completed',60,3,'{}'::jsonb,$3),
        ('RETENTION_D15','Retenção (D+15)', TRUE,'retention_15',0,7,'{}'::jsonb,$4),
        ('REFERRAL_D1','Indique & Ganhe (D+1)', TRUE,'first_visit_completed',1440,30,'{}'::jsonb,$5)
      `,
      [
        idByCode.get('TPL_APPT_CONFIRM') || null,
        idByCode.get('TPL_APPT_REMINDER') || null,
        idByCode.get('TPL_POST_SERVICE') || null,
        idByCode.get('TPL_RETENTION') || null,
        idByCode.get('TPL_REFERRAL') || null,
      ]
    );
  }

    // vincular agendamentos ao pacote
  await query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS package_sale_id INTEGER REFERENCES package_sales(id) ON DELETE SET NULL;`);
  await query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS package_seq INTEGER;`);
  await query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS package_total INTEGER;`);

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
  