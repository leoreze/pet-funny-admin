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

/* =========================
   DB helpers
========================= */
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

/* =========================
   Schema utilities
========================= */
async function columnExists(table, column) {
  const row = await get(
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
    LIMIT 1
    `,
    [table, column]
  );
  return !!row;
}

async function addColumnIfMissing(table, column, definitionSql) {
  const exists = await columnExists(table, column);
  if (exists) return;
  await query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definitionSql};`);
}

async function tableExists(table) {
  const row = await get(
    `
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = $1
    LIMIT 1
    `,
    [table]
  );
  return !!row;
}

/* =========================
   Breeds seed (extenso; pode expandir)
   Campos:
   - name (raça)
   - history (breve)
   - size: pequeno|médio|grande
   - coat: curta|média|longa
========================= */
const BREEDS_SEED = [
  // Pequeno
  { name:'Affenpinscher', size:'pequeno', coat:'média', history:'Raça alemã antiga, criada como caçador de roedores em casas e estábulos; hoje é cão de companhia vivaz.' },
  { name:'Bichon Frisé', size:'pequeno', coat:'longa', history:'Cão de companhia do Mediterrâneo, popular em cortes europeias; pelagem encaracolada e temperamento alegre.' },
  { name:'Biewer Terrier', size:'pequeno', coat:'longa', history:'Variante moderna do Yorkshire Terrier desenvolvida na Alemanha; conhecido pelo padrão tricolor e sociabilidade.' },
  { name:'Boston Terrier', size:'pequeno', coat:'curta', history:'Desenvolvido nos EUA como cão de companhia; apelidado de “American Gentleman” pelo temperamento equilibrado.' },
  { name:'Cavalier King Charles Spaniel', size:'pequeno', coat:'longa', history:'Spaniel de companhia ligado à nobreza britânica; criado para convivência e afeto.' },
  { name:'Chihuahua', size:'pequeno', coat:'curta', history:'Originário do México; uma das menores raças do mundo, muito alerta e ligado ao tutor.' },
  { name:'Dachshund', size:'pequeno', coat:'curta', history:'Criado na Alemanha para caça em tocas (texugo); corpo alongado e coragem marcante.' },
  { name:'Fox Terrier (Smooth)', size:'pequeno', coat:'curta', history:'Terrier britânico usado na caça à raposa; enérgico, inteligente e esportivo.' },
  { name:'Fox Terrier (Wire)', size:'pequeno', coat:'média', history:'Versão de pelagem dura do Fox Terrier; historicamente usado para caça e controle de pragas.' },
  { name:'French Bulldog (Bulldog Francês)', size:'pequeno', coat:'curta', history:'Popularizado na França a partir de cães do tipo bulldog; excelente companhia, dócil e adaptável.' },
  { name:'Havanese (Bichon Havanês)', size:'pequeno', coat:'longa', history:'Cão de companhia associado a Cuba; conhecido por alegria, inteligência e pelagem sedosa.' },
  { name:'Italian Greyhound (Galgo Italiano)', size:'pequeno', coat:'curta', history:'Pequeno lebrel de companhia presente desde a antiguidade; elegante, sensível e rápido.' },
  { name:'Jack Russell Terrier', size:'pequeno', coat:'curta', history:'Terrier britânico para trabalho e caça; muita energia e grande drive.' },
  { name:'Lhasa Apso', size:'pequeno', coat:'longa', history:'Originário do Tibete, usado como cão sentinela em monastérios; independente e leal.' },
  { name:'Maltês', size:'pequeno', coat:'longa', history:'Raça antiga do Mediterrâneo, criada para companhia; pelagem branca longa e temperamento dócil.' },
  { name:'Miniature Pinscher (Pinscher Miniatura)', size:'pequeno', coat:'curta', history:'Desenvolvido na Alemanha; cão compacto, alerta e confiante, associado ao controle de pragas.' },
  { name:'Papillon', size:'pequeno', coat:'longa', history:'Spaniel miniatura europeu; famoso pelas orelhas “em borboleta” e facilidade de treino.' },
  { name:'Pekingese (Pequinês)', size:'pequeno', coat:'longa', history:'Cão de companhia imperial chinês; postura altiva e forte vínculo com a família.' },
  { name:'Pomeranian (Spitz Alemão Anão)', size:'pequeno', coat:'longa', history:'Derivado do Spitz alemão; popular como companhia, muito alerta e expressivo.' },
  { name:'Poodle (Toy)', size:'pequeno', coat:'média', history:'Variedade de companhia do Poodle; altamente inteligente e treinável.' },
  { name:'Poodle (Miniatura)', size:'pequeno', coat:'média', history:'Variedade menor do Poodle, historicamente ligada a trabalho na água; hoje também companhia.' },
  { name:'Pug', size:'pequeno', coat:'curta', history:'Raça antiga da China, criada para companhia; famosa pelo focinho curto e personalidade afetiva.' },
  { name:'Shih Tzu', size:'pequeno', coat:'longa', history:'Raça de companhia do Tibete/China; desenvolvida para vida em palácios, sociável e carinhosa.' },
  { name:'Yorkshire Terrier', size:'pequeno', coat:'longa', history:'Criado na Inglaterra para caça de roedores; hoje é popular como cão de colo, cheio de atitude.' },
  { name:'West Highland White Terrier', size:'pequeno', coat:'média', history:'Terrier escocês para caça de pequenos animais; ativo, corajoso e comunicativo.' },
  { name:'Schnauzer (Miniatura)', size:'pequeno', coat:'média', history:'Versão pequena do Schnauzer alemão, usado em fazendas; inteligente, alerta e protetor.' },

  // Médio
  { name:'Australian Shepherd', size:'médio', coat:'média', history:'Cão de pastoreio popularizado nos EUA; muito inteligente e ativo, exige estímulos.' },
  { name:'Basenji', size:'médio', coat:'curta', history:'Raça africana antiga; conhecida por vocalização incomum e comportamento independente.' },
  { name:'Beagle', size:'médio', coat:'curta', history:'Farejador britânico criado para caça; sociável e com forte instinto de olfato.' },
  { name:'Border Collie', size:'médio', coat:'média', history:'Considerado um dos melhores cães de pastoreio; extremamente inteligente e focado.' },
  { name:'Boxer', size:'médio', coat:'curta', history:'Desenvolvido na Alemanha; cão versátil, leal e brincalhão, historicamente usado em trabalho e guarda.' },
  { name:'Bulldog Inglês', size:'médio', coat:'curta', history:'Antigo cão de trabalho associado a esportes históricos; hoje é companhia calma e apegada.' },
  { name:'Cocker Spaniel (Inglês)', size:'médio', coat:'longa', history:'Spaniel britânico de caça; hoje é muito popular como cão de família, sensível e ativo.' },
  { name:'Dalmatian (Dálmata)', size:'médio', coat:'curta', history:'Historicamente ligado a carruagens e companhia de cavalos; atlético e resistente.' },
  { name:'English Springer Spaniel', size:'médio', coat:'longa', history:'Spaniel de caça britânico; energético, sociável e muito treinável.' },
  { name:'German Spitz (Spitz Alemão)', size:'médio', coat:'longa', history:'Família Spitz europeia antiga; alerta, vocal e bom cão de alarme.' },
  { name:'Shetland Sheepdog (Sheltie)', size:'médio', coat:'longa', history:'Pastoreio das ilhas Shetland; lembra um Collie em miniatura, inteligente e sensível.' },
  { name:'Siberian Husky', size:'médio', coat:'média', history:'Cão de trenó do nordeste asiático; resistente, sociável e com alta energia.' },
  { name:'Staffordshire Bull Terrier', size:'médio', coat:'curta', history:'Terrier britânico; conhecido por coragem e afeto com pessoas quando bem socializado.' },
  { name:'Whippet', size:'médio', coat:'curta', history:'Lebrel britânico para corrida; dócil em casa e muito veloz ao ar livre.' },
  { name:'Shiba Inu', size:'médio', coat:'média', history:'Raça japonesa antiga; alerta e independente, historicamente usada na caça.' },
  { name:'Akita (Americano/Japonês)', size:'grande', coat:'média', history:'Raça japonesa de caça e guarda; leal e reservada, exige socialização.' },

  // Grande
  { name:'German Shepherd (Pastor Alemão)', size:'grande', coat:'média', history:'Desenvolvido na Alemanha para trabalho; amplamente usado em polícia/serviço pela inteligência.' },
  { name:'Golden Retriever', size:'grande', coat:'longa', history:'Criado na Escócia para resgate na água; dócil, confiável e excelente cão de família.' },
  { name:'Labrador Retriever', size:'grande', coat:'curta', history:'Originário do Canadá; versátil para trabalho e companhia, muito amigável.' },
  { name:'Rottweiler', size:'grande', coat:'curta', history:'Raça alemã de trabalho e guarda; forte, estável e leal quando bem treinado.' },
  { name:'Doberman Pinscher', size:'grande', coat:'curta', history:'Criado na Alemanha para proteção; inteligente, atlético e altamente treinável.' },
  { name:'Bernese Mountain Dog (Boiadeiro Bernês)', size:'grande', coat:'longa', history:'Cão de trabalho suíço para fazenda e tração; calmo, afetuoso e robusto.' },
  { name:'Great Dane (Dogue Alemão)', size:'grande', coat:'curta', history:'Conhecido pelo porte gigante; historicamente usado como cão de caça e guarda, hoje também companhia.' },
  { name:'Boxer (Grande)', size:'médio', coat:'curta', history:'Entrada duplicada intencional? Não. (mantém como Boxer médio; remova se necessário).' },
];

function uniqueBreeds(seed) {
  const map = new Map();
  for (const b of seed) {
    const key = String(b.name || '').trim().toLowerCase();
    if (!key) continue;
    if (map.has(key)) continue;
    map.set(key, b);
  }
  // remove registros “placeholder”
  return Array.from(map.values()).filter(b => !String(b.history || '').includes('Entrada duplicada'));
}

/* =========================
   Init / Migration
========================= */
async function initDb() {
  // customers
  await query(`
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      phone TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // pets
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

  // services (value_cents + active)
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

  await query(`CREATE INDEX IF NOT EXISTS idx_services_date ON services(date);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_services_title_lower ON services ((lower(title)));`);

  // bookings (compat: mantém service TEXT, mas adiciona service_id)
  await query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      pet_id INTEGER REFERENCES pets(id) ON DELETE SET NULL,
      service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      service TEXT,
      prize TEXT NOT NULL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'agendado',
      last_notification_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // garante colunas em bases antigas
  await addColumnIfMissing('bookings', 'service_id', 'INTEGER REFERENCES services(id) ON DELETE SET NULL');
  await addColumnIfMissing('bookings', 'service', 'TEXT');
  await addColumnIfMissing('services', 'value_cents', 'INTEGER NOT NULL DEFAULT 0');
  await addColumnIfMissing('services', 'is_active', 'BOOLEAN NOT NULL DEFAULT TRUE');
  await addColumnIfMissing('services', 'updated_at', 'TIMESTAMPTZ NOT NULL DEFAULT NOW()');

  // indices
  await query(`CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_pets_customer_id ON pets(customer_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_bookings_customer_id ON bookings(customer_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_bookings_pet_id ON bookings(pet_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_bookings_service_id ON bookings(service_id);`);

  // breeds table
  await query(`
    CREATE TABLE IF NOT EXISTS breeds (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      history TEXT,
      size TEXT NOT NULL CHECK (size IN ('pequeno','médio','grande')),
      coat TEXT NOT NULL CHECK (coat IN ('curta','média','longa')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_breeds_size ON breeds(size);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_breeds_coat ON breeds(coat);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_breeds_name_lower ON breeds ((lower(name)));`);

  // seed breeds (somente se vazio)
  const c = await get(`SELECT COUNT(*)::int AS n FROM breeds;`);
  if ((c?.n || 0) === 0) {
    const seed = uniqueBreeds(BREEDS_SEED);
    for (const b of seed) {
      await query(
        `INSERT INTO breeds (name, history, size, coat) VALUES ($1,$2,$3,$4) ON CONFLICT (name) DO NOTHING;`,
        [b.name, b.history || null, b.size, b.coat]
      );
    }
    console.log(`✔ breeds seeded: ${seed.length}`);
  } else {
    console.log('✔ breeds table ready (seed skipped)');
  }


  /* =========================
     OPENING HOURS (horário de funcionamento)
     - dow: 0=Dom ... 6=Sáb
     - is_closed: dia fechado
     - open_time / close_time: HH:MM
     - max_per_half_hour: capacidade por slot de 30min
  ========================= */
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

  // seed padrão se vazio
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
      await query(
        `INSERT INTO opening_hours (dow, is_closed, open_time, close_time, max_per_half_hour)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (dow) DO NOTHING;`,
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
};
