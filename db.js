// backend/db.js (UPDATED)
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL não definido no ambiente.');
}

const pool = new Pool({
  connectionString,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function run(sql, params = []) {
  return pool.query(sql, params);
}

async function all(sql, params = []) {
  const res = await pool.query(sql, params);
  return res.rows;
}

async function get(sql, params = []) {
  const res = await pool.query(sql, params);
  return res.rows[0] || null;
}

/* =========================
   INIT DB (idempotente)
========================= */
async function initDb() {
  // ====== CUSTOMERS ======
  await run(`
    CREATE TABLE IF NOT EXISTS customers (
      id BIGSERIAL PRIMARY KEY,
      phone TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // ====== PETS ======
  // (server.js atual usa campo "info". Vamos padronizar o DB para "info")
  await run(`
    CREATE TABLE IF NOT EXISTS pets (
      id BIGSERIAL PRIMARY KEY,
      customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      breed TEXT,
      info TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // MIGRAÇÃO defensiva (caso tabela antiga esteja com notes)
  await run(`ALTER TABLE pets ADD COLUMN IF NOT EXISTS info TEXT;`);

  // ====== SERVICES ======
  // (admin/server usam value_cents; mantemos is_active para soft-delete)
  await run(`
    CREATE TABLE IF NOT EXISTS services (
      id BIGSERIAL PRIMARY KEY,
      date DATE NOT NULL DEFAULT CURRENT_DATE,
      title TEXT NOT NULL,
      value_cents INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Migrations defensivas
  await run(`ALTER TABLE services ADD COLUMN IF NOT EXISTS value_cents INTEGER NOT NULL DEFAULT 0;`);
  await run(`ALTER TABLE services ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;`);
  await run(`ALTER TABLE services ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await run(`ALTER TABLE services ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);

  // ====== BOOKINGS ======
  await run(`
    CREATE TABLE IF NOT EXISTS bookings (
      id BIGSERIAL PRIMARY KEY,
      customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      pet_id BIGINT REFERENCES pets(id) ON DELETE SET NULL,
      service_id BIGINT REFERENCES services(id) ON DELETE SET NULL,
      service TEXT, -- compat
      date DATE NOT NULL,
      time TIME NOT NULL,
      prize TEXT NOT NULL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'agendado',
      last_notification_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Migrations defensivas
  await run(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_id BIGINT REFERENCES services(id) ON DELETE SET NULL;`);
  await run(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service TEXT;`);
  await run(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS last_notification_at TIMESTAMPTZ;`);

  // ====== DOG BREEDS (NOVA TABELA) ======
  await run(`
    CREATE TABLE IF NOT EXISTS dog_breeds (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      history TEXT NOT NULL DEFAULT '',
      size TEXT NOT NULL CHECK (size IN ('pequeno','medio','grande')),
      coat TEXT NOT NULL CHECK (coat IN ('curta','media','longa')),
      characteristics TEXT NOT NULL DEFAULT '',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Índices
  await run(`CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);`);
  await run(`CREATE INDEX IF NOT EXISTS idx_pets_customer_id ON pets(customer_id);`);
  await run(`CREATE INDEX IF NOT EXISTS idx_services_active ON services(is_active);`);
  await run(`CREATE INDEX IF NOT EXISTS idx_bookings_date_time ON bookings(date, time);`);
  await run(`CREATE INDEX IF NOT EXISTS idx_bookings_customer_id ON bookings(customer_id);`);
  await run(`CREATE INDEX IF NOT EXISTS idx_breeds_active ON dog_breeds(is_active);`);
  await run(`CREATE INDEX IF NOT EXISTS idx_breeds_name ON dog_breeds(name);`);

  // ====== SEED BREEDS (inicial) ======
  // Catálogo inicial (principais raças + SRD). Você pode expandir pelo Admin.
  const seed = [
    // Pequeno
    { name:'Chihuahua', size:'pequeno', coat:'curta', history:'Originário do México; associado a cães de companhia desde civilizações pré-colombianas.', characteristics:'Alerta, fiel, pode ser territorial; sensível ao frio.' },
    { name:'Poodle (Toy/Miniatura)', size:'pequeno', coat:'media', history:'Raízes na Europa; desenvolvido como cão de água/caça e depois popularizado como companhia.', characteristics:'Muito inteligente; pelagem cresce continuamente; exige tosa e escovação.' },
    { name:'Yorkshire Terrier', size:'pequeno', coat:'longa', history:'Inglaterra; criado para controle de roedores em fábricas e minas.', characteristics:'Corajoso, enérgico; pelagem longa e fina; tende a ser vocal.' },
    { name:'Shih Tzu', size:'pequeno', coat:'longa', history:'China; cão de companhia ligado à corte imperial.', characteristics:'Afetuoso; pode ter sensibilidade respiratória; demanda grooming frequente.' },
    { name:'Lhasa Apso', size:'pequeno', coat:'longa', history:'Tibete; cão sentinela em mosteiros.', characteristics:'Independente, desconfiado com estranhos; pelagem longa.' },
    { name:'Maltês', size:'pequeno', coat:'longa', history:'Mediterrâneo; companhia de nobreza.', characteristics:'Dócil, sociável; exige cuidados com pelagem e lacrimejamento.' },
    { name:'Pug', size:'pequeno', coat:'curta', history:'China; cão de companhia antigo.', characteristics:'Braquicefálico; sensível ao calor; tendência a ganho de peso.' },
    { name:'Pinscher Miniatura', size:'pequeno', coat:'curta', history:'Alemanha; cão de alerta e controle de roedores.', characteristics:'Muito ativo; pode ser teimoso; precisa de socialização.' },
    { name:'Dachshund', size:'pequeno', coat:'curta', history:'Alemanha; criado para caça a animais de toca.', characteristics:'Corpo alongado; risco de problemas de coluna; personalidade marcante.' },
    { name:'Spitz Alemão (Pomerânia)', size:'pequeno', coat:'longa', history:'Alemanha; cão do grupo Spitz popularizado como companhia.', characteristics:'Vocal, inteligente; pelagem densa; exige escovação.' },

    // Médio
    { name:'Beagle', size:'medio', coat:'curta', history:'Reino Unido; cão de caça por faro.', characteristics:'Excelente olfato; pode ser escapista; amigável.' },
    { name:'Border Collie', size:'medio', coat:'media', history:'Reino Unido; desenvolvido para pastoreio.', characteristics:'Altíssima inteligência; precisa de estímulo mental e físico.' },
    { name:'Bulldog Francês', size:'medio', coat:'curta', history:'França; companhia, derivado de Bulldogs menores.', characteristics:'Braquicefálico; sensível ao calor; muito sociável.' },
    { name:'Cocker Spaniel', size:'medio', coat:'media', history:'Inglaterra; caça de aves.', characteristics:'Alegre; orelhas exigem higiene; pode ter predisposição a otites.' },
    { name:'Schnauzer (Médio)', size:'medio', coat:'media', history:'Alemanha; cão de trabalho e guarda.', characteristics:'Protetor; pelagem áspera; precisa de trimming/tosa.' },
    { name:'Basset Hound', size:'medio', coat:'curta', history:'França; caça por faro.', characteristics:'Calmo; orelhas longas; tendência a sobrepeso.' },

    // Grande
    { name:'Labrador Retriever', size:'grande', coat:'curta', history:'Canadá (Terra Nova); cão de água e caça.', characteristics:'Muito dócil; ótimo para famílias; tendência a obesidade.' },
    { name:'Golden Retriever', size:'grande', coat:'media', history:'Escócia; caça e recuperação.', characteristics:'Afetuoso; precisa de escovação; excelente temperamento.' },
    { name:'Pastor Alemão', size:'grande', coat:'media', history:'Alemanha; desenvolvido para trabalho e guarda.', characteristics:'Inteligente; protetor; requer socialização e atividade.' },
    { name:'Rottweiler', size:'grande', coat:'curta', history:'Alemanha; condução/guarda de gado.', characteristics:'Forte; leal; exige manejo e socialização.' },
    { name:'Boxer', size:'grande', coat:'curta', history:'Alemanha; cão de trabalho e companhia.', characteristics:'Brincalhão; energético; pode roncar e babar.' },
    { name:'Husky Siberiano', size:'grande', coat:'media', history:'Sibéria; trenós e trabalho.', characteristics:'Independente; precisa de exercício; sensível ao calor.' },

    // SRD
    { name:'SRD (Sem Raça Definida)', size:'medio', coat:'curta', history:'Mistura genética natural; grande variação regional.', characteristics:'Variável; muitas vezes mais resistente; porte/pelagem podem variar.' },
  ];

  for (const b of seed) {
    await run(
      `
      INSERT INTO dog_breeds (name, history, size, coat, characteristics, is_active)
      VALUES ($1,$2,$3,$4,$5,TRUE)
      ON CONFLICT (name) DO NOTHING;
      `,
      [b.name, b.history, b.size, b.coat, b.characteristics]
    );
  }
}

module.exports = {
  pool,
  run,
  all,
  get,
  initDb,
};
