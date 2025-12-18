// db.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : (process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false),
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
  return res.rows;
}

async function get(sql, params = []) {
  const res = await query(sql, params);
  return res.rows[0] || null;
}

async function run(sql, params = []) {
  return query(sql, params);
}

async function initDb() {
  // Core tables
  await run(`
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS pets (
      id SERIAL PRIMARY KEY,
      customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      breed TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS services (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      value_cents INT NOT NULL DEFAULT 0,
      duration_min INT NOT NULL DEFAULT 60,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Backward compatibility for older schemas
  await run(`ALTER TABLE services ADD COLUMN IF NOT EXISTS value_cents INT NOT NULL DEFAULT 0`);
  await run(`ALTER TABLE services ADD COLUMN IF NOT EXISTS duration_min INT NOT NULL DEFAULT 60`);
  await run(`ALTER TABLE services ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`);
  await run(`ALTER TABLE services ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);

  await run(`
    CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY,
      customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      pet_id INT REFERENCES pets(id) ON DELETE SET NULL,
      date DATE NOT NULL,
      time TEXT NOT NULL,
      service TEXT NOT NULL,
      prize TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'agendado',
      last_notification_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await run(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pet_id INT REFERENCES pets(id) ON DELETE SET NULL`);
  await run(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS prize TEXT`);
  await run(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS notes TEXT`);
  await run(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'agendado'`);
  await run(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS last_notification_at TIMESTAMPTZ`);
  await run(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);

  // Dog breeds table
  await run(`
    CREATE TABLE IF NOT EXISTS dog_breeds (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      size TEXT NOT NULL CHECK (size IN ('pequeno','medio','grande')),
      coat TEXT NOT NULL CHECK (coat IN ('curta','media','longa')),
      history TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Opening hours table
  await run(`
    CREATE TABLE IF NOT EXISTS opening_hours (
      day_of_week INT PRIMARY KEY CHECK (day_of_week BETWEEN 0 AND 6),
      is_closed BOOLEAN NOT NULL DEFAULT FALSE,
      open_time TIME,
      close_time TIME,
      capacity_per_slot INT NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Seed opening hours if empty
  const ohCount = await get(`SELECT COUNT(*)::int AS n FROM opening_hours`);
  if (!ohCount || ohCount.n === 0) {
    const defaults = [
      // dow, closed, open, close, cap
      [1, false, '07:30', '17:30', 1],
      [2, false, '07:30', '17:30', 1],
      [3, false, '07:30', '17:30', 1],
      [4, false, '07:30', '17:30', 1],
      [5, false, '07:30', '17:30', 1],
      [6, false, '08:00', '12:00', 1],
      [0, true,  null,    null,    0],
    ];
    for (const d of defaults) {
      await run(
        `INSERT INTO opening_hours (day_of_week, is_closed, open_time, close_time, capacity_per_slot)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (day_of_week) DO UPDATE SET
           is_closed=EXCLUDED.is_closed,
           open_time=EXCLUDED.open_time,
           close_time=EXCLUDED.close_time,
           capacity_per_slot=EXCLUDED.capacity_per_slot,
           updated_at=NOW()`,
        d
      );
    }
  }

  // Seed dog breeds if empty (amostra ampla; você pode acrescentar mais via CRUD)
  const bCount = await get(`SELECT COUNT(*)::int AS n FROM dog_breeds`);
  if (!bCount || bCount.n === 0) {
    const breeds = [
      // name, size, coat, history
      ['SRD (Vira-lata)', 'medio', 'media', 'Cães sem raça definida, muito comuns no Brasil; variam em aparência e costumam ser resistentes.'],
      ['Shih Tzu', 'pequeno', 'longa', 'Originário do Tibete/China; companhia, pelagem longa e necessidade de manutenção regular.'],
      ['Poodle (Toy/Mini)', 'pequeno', 'media', 'Muito inteligente; pelagem encaracolada e baixa queda; requer tosa.'],
      ['Yorkshire Terrier', 'pequeno', 'longa', 'Terrier de companhia; pelagem fina e longa; alerta e ativo.'],
      ['Lhasa Apso', 'pequeno', 'longa', 'Cão tibetano tradicionalmente de guarda de interior; pelagem longa e densa.'],
      ['Maltês', 'pequeno', 'longa', 'Companheiro antigo do Mediterrâneo; pelagem branca longa e delicada.'],
      ['Pug', 'pequeno', 'curta', 'Raça antiga chinesa; braquicefálico; atenção a calor e respiração.'],
      ['Buldogue Francês', 'pequeno', 'curta', 'Companheiro; braquicefálico; tolerância moderada a exercícios intensos.'],
      ['Chihuahua', 'pequeno', 'curta', 'Pequeno e alerta; popular como cão de companhia; pode ser de pelo curto ou longo.'],
      ['Dachshund (Salsicha)', 'pequeno', 'curta', 'Criado para caça em tocas; corpo alongado; cuidado com coluna.'],
      ['Beagle', 'medio', 'curta', 'Farejador; muito sociável; energia alta e tendência a seguir cheiros.'],
      ['Cocker Spaniel Inglês', 'medio', 'longa', 'Spaniel de caça/companhia; pelagem requer escovação e tosa.'],
      ['Border Collie', 'medio', 'media', 'Pastor muito inteligente; exige estímulo mental e físico.'],
      ['Australian Shepherd', 'medio', 'media', 'Pastor ativo; pelagem média; precisa de atividade diária.'],
      ['Schnauzer (Mini/Std)', 'medio', 'media', 'Terrier/pastor; pelagem dura; costuma exigir tosa.'],
      ['Spitz Alemão (Lulu)', 'pequeno', 'longa', 'Companheiro; pelagem densa dupla; escovação frequente.'],
      ['Boston Terrier', 'pequeno', 'curta', 'Companheiro; braquicefálico moderado; alegre e sociável.'],
      ['Basset Hound', 'medio', 'curta', 'Farejador de baixa estatura; orelhas longas; cuidado com pele/orelhas.'],
      ['Bulldog Inglês', 'medio', 'curta', 'Braquicefálico; precisa de cuidados com calor e dobras de pele.'],
      ['Labrador Retriever', 'grande', 'curta', 'Retrievers de trabalho; muito popular; sociável e energético.'],
      ['Golden Retriever', 'grande', 'longa', 'Retrievers; dócil; pelagem longa com subpelo; escovação regular.'],
      ['Pastor Alemão', 'grande', 'media', 'Cão de trabalho versátil; inteligente; precisa de treino e atividade.'],
      ['Rottweiler', 'grande', 'curta', 'Guarda/trabalho; forte; socialização e manejo responsáveis são essenciais.'],
      ['Doberman', 'grande', 'curta', 'Guarda; atlético; alta energia; precisa de estímulo e socialização.'],
      ['Boxer', 'grande', 'curta', 'Ativo e brincalhão; braquicefálico moderado; atenção ao calor.'],
      ['Husky Siberiano', 'grande', 'longa', 'Trenó; muita energia; pelagem dupla; tolera frio, sofre no calor.'],
      ['Akita', 'grande', 'longa', 'Japonesa; leal; pelagem dupla; exige socialização e manejo.'],
      ['Cane Corso', 'grande', 'curta', 'Mastim italiano; guarda; porte grande; treino e socialização fundamentais.'],
      ['Mastim Napolitano', 'grande', 'curta', 'Mastim pesado; dobras de pele; cuidados com higiene e calor.'],
      ['São Bernardo', 'grande', 'longa', 'Montanha; gigante; pelagem densa; atenção a calor e articulações.'],
      ['Dogue Alemão', 'grande', 'curta', 'Gigante; temperamento geralmente dócil; atenção a saúde e crescimento.'],
      ['Poodle (Standard)', 'grande', 'media', 'Poodle grande; muito inteligente; pelagem encaracolada; tosa.'],
      ['Pit Bull (Tipo)', 'medio', 'curta', 'Termo guarda-chuva; forte e ativo; manejo responsável e socialização.'],
      ['American Bully', 'medio', 'curta', 'Seleção recente; estrutura robusta; cuidados com peso e exercícios.'],
      ['Shar Pei', 'medio', 'curta', 'Dobras de pele; atenção a dermatites; temperamento reservado.'],
      ['Chow Chow', 'medio', 'longa', 'Pelagem densa; temperamento reservado; precisa de socialização.'],
      ['Dálmata', 'grande', 'curta', 'Ativo; histórico com carruagens; atenção a questões urinárias.'],
      ['Weimaraner', 'grande', 'curta', 'Caça; atlético; precisa de exercício e companhia.'],
      ['Whippet', 'medio', 'curta', 'Galgo médio; veloz; em casa costuma ser tranquilo.'],
      ['Greyhound', 'grande', 'curta', 'Galgo; corrida; geralmente calmo em casa; cuidado com frio.'],
      ['Pomeranian', 'pequeno', 'longa', 'Variação do Spitz; pelagem volumosa; escovação frequente.'],
      ['Poodle (Médio)', 'medio', 'media', 'Variedade intermediária; inteligente; exige manutenção de pelagem.'],
      ['Jack Russell Terrier', 'pequeno', 'curta', 'Terrier de caça; altíssima energia; precisa de atividades.'],
      ['Cavalier King Charles Spaniel', 'pequeno', 'longa', 'Companheiro; dócil; atenção a saúde cardíaca.'],
      ['Bichon Frisé', 'pequeno', 'media', 'Companhia; pelagem encaracolada; requer tosa e escovação.'],
      ['Pekingese', 'pequeno', 'longa', 'Companheiro antigo; pelagem longa; braquicefálico.'],
      ['Pinscher', 'pequeno', 'curta', 'Ativo e vigilante; popular no Brasil; energia alta.'],
      ['Fox Paulistinha', 'pequeno', 'curta', 'Raça brasileira; terrier; ativo e alerta.'],
      ['Fila Brasileiro', 'grande', 'curta', 'Raça brasileira; guarda; requer manejo experiente e socialização.'],
      ['Cão de Fila de São Miguel', 'medio', 'curta', 'Trabalho/boiadeiro; forte; precisa de atividade e socialização.'],
      ['Cão de Água Português', 'medio', 'media', 'Trabalho na água; pelagem encaracolada/ondulada; tosa.'],
    ];
    for (const b of breeds) {
      await run(
        `INSERT INTO dog_breeds (name, size, coat, history)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (name) DO NOTHING`,
        b
      );
    }
  }
}

module.exports = { query, all, get, run, initDb, pool };
