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

// Helpers
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

async function tableExists(table) {
  const r = await get(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
    [table]
  );
  return !!r;
}

async function columnExists(table, column) {
  const r = await get(
    `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
    [table, column]
  );
  return !!r;
}

async function ensureIndex(sql) {
  await query(sql);
}

/* ============================
   INIT DB (idempotente)
   ============================ */
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

  // services (novo padrão: value_cents + is_active)
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

  await addColumnIfMissing('services','is_active', `ALTER TABLE services ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;`);
  await addColumnIfMissing('services','created_at', `ALTER TABLE services ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await addColumnIfMissing('services','updated_at', `ALTER TABLE services ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);


  // migrações seguras para serviços (caso tabela antiga exista)
  if (await tableExists('services')) {
    if (!(await columnExists('services', 'value_cents'))) {
      await query(`ALTER TABLE services ADD COLUMN value_cents INTEGER NOT NULL DEFAULT 0;`);
    }
    if (!(await columnExists('services', 'is_active'))) {
      await query(`ALTER TABLE services ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;`);
    }
    if (!(await columnExists('services', 'updated_at'))) {
      await query(`ALTER TABLE services ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
    }

    // tenta migrar coluna antiga "price" (se existir) para value_cents
    if (await columnExists('services', 'price')) {
      // se era integer em centavos, esta linha mantém; se era numeric em reais, você pode ajustar depois
      await query(`UPDATE services SET value_cents = COALESCE(value_cents, price) WHERE value_cents IS NULL OR value_cents = 0;`);
    }
  }

  // bookings (adiciona compatibilidade: service_id)
  await query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      pet_id INTEGER REFERENCES pets(id) ON DELETE SET NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      service TEXT NOT NULL,
      service_id INTEGER,
      prize TEXT NOT NULL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'agendado',
      last_notification_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  if (!(await columnExists('bookings', 'service_id'))) {
    await query(`ALTER TABLE bookings ADD COLUMN service_id INTEGER;`);
  }

  // garante FK (só cria se ainda não existir)
  // Nota: Postgres não tem "ADD CONSTRAINT IF NOT EXISTS" (até versões recentes), então usamos tentativa/erro.
  try {
    await query(`ALTER TABLE bookings
      ADD CONSTRAINT bookings_service_id_fkey
      FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL;`);
  } catch (_) {}

  // dog_breeds (raças)
  await query(`
    CREATE TABLE IF NOT EXISTS dog_breeds (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      history TEXT,
      size TEXT NOT NULL CHECK (size IN ('pequeno','medio','grande')),
      coat TEXT NOT NULL CHECK (coat IN ('curta','media','longa')),
      characteristics TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Migrações defensivas (caso a tabela já exista sem algumas colunas)
  await addColumnIfMissing('dog_breeds','is_active', `ALTER TABLE dog_breeds ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;`);
  await addColumnIfMissing('dog_breeds','created_at', `ALTER TABLE dog_breeds ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await addColumnIfMissing('dog_breeds','updated_at', `ALTER TABLE dog_breeds ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);


  // índices
  await ensureIndex(`CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);`);
  await ensureIndex(`CREATE INDEX IF NOT EXISTS idx_pets_customer_id ON pets(customer_id);`);
  await ensureIndex(`CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);`);
  await ensureIndex(`CREATE INDEX IF NOT EXISTS idx_bookings_customer_id ON bookings(customer_id);`);
  await ensureIndex(`CREATE INDEX IF NOT EXISTS idx_bookings_pet_id ON bookings(pet_id);`);
  await ensureIndex(`CREATE INDEX IF NOT EXISTS idx_services_date ON services(date);`);
  if (await columnExists('services', 'is_active')) {
    await ensureIndex(`CREATE INDEX IF NOT EXISTS idx_services_is_active ON services(is_active);`);
  }
  await ensureIndex(`CREATE INDEX IF NOT EXISTS idx_dog_breeds_size ON dog_breeds(size);`);
  if (await columnExists('dog_breeds', 'is_active')) {
    await ensureIndex(`CREATE INDEX IF NOT EXISTS idx_dog_breeds_is_active ON dog_breeds(is_active);`);
  }

  // seed dog_breeds (idempotente)
  await seedDogBreeds();
}

async function seedDogBreeds() {
  const breeds = [
    { name: 'Affenpinscher', size: 'pequeno', coat_length: 'media', history: 'Raça alemã antiga de companhia e caçador de roedores.', characteristics: 'Ativo, curioso, personalidade forte.' },
    { name: 'Airedale Terrier', size: 'grande', coat_length: 'media', history: 'Originário da Inglaterra (Vale do Aire), criado para caça e trabalho.', characteristics: 'Inteligente, versátil, precisa de atividade.' },
    { name: 'Akita Inu', size: 'grande', coat_length: 'media', history: 'Raça japonesa tradicional usada para guarda e caça.', characteristics: 'Leal, reservado, forte instinto protetor.' },
    { name: 'Alaskan Malamute', size: 'grande', coat_length: 'longa', history: 'Desenvolvido no Alasca para tração e trabalho pesado.', characteristics: 'Forte, sociável, precisa de exercícios.' },
    { name: 'American Staffordshire Terrier', size: 'medio', coat_length: 'curta', history: 'Desenvolvido nos EUA a partir de terriers de trabalho.', characteristics: 'Confiante, afetuoso, musculoso.' },
    { name: 'Australian Cattle Dog', size: 'medio', coat_length: 'curta', history: 'Criado na Austrália para condução de gado em longas distâncias.', characteristics: 'Muito ativo, inteligente, focado.' },
    { name: 'Australian Shepherd', size: 'medio', coat_length: 'media', history: 'Popularizado nos EUA como cão de pastoreio.', characteristics: 'Enérgico, inteligente, aprende rápido.' },
    { name: 'Basenji', size: 'pequeno', coat_length: 'curta', history: 'Originário da África Central, usado para caça.', characteristics: 'Independente, silencioso (pouco late), ativo.' },
    { name: 'Basset Artesien Normand', size: 'medio', coat_length: 'curta', history: 'Basset francês tradicional para caça por faro.', characteristics: 'Calmo, bom faro, orelhas longas.' },
    { name: 'Basset Hound', size: 'medio', coat_length: 'curta', history: 'Originário da França, farejador de caça de pequeno porte.', characteristics: 'Calmo, teimoso, ótimo faro.' },
    { name: 'Beagle', size: 'medio', coat_length: 'curta', history: 'Raça britânica clássica de caça por faro.', characteristics: 'Amigável, ativo, curioso.' },
    { name: 'Belgian Malinois', size: 'grande', coat_length: 'curta', history: 'Variedade belga de pastoreio, muito usada em trabalho policial.', characteristics: 'Muito ativo, focado, aprende rápido.' },
    { name: 'Bergamasco', size: 'grande', coat_length: 'longa', history: 'Cão pastor italiano com pelagem em ‘dreadlocks’.', characteristics: 'Calmo, protetor, rústico.' },
    { name: 'Bernese Mountain Dog', size: 'grande', coat_length: 'longa', history: 'Da Suíça, usado em fazendas e para tração.', characteristics: 'Gentil, forte, pelagem longa.' },
    { name: 'Bichon Frisé', size: 'pequeno', coat_length: 'media', history: 'Raça de companhia de origem mediterrânea, popularizada na França.', characteristics: 'Alegre, sociável, pelagem encaracolada.' },
    { name: 'Border Collie', size: 'medio', coat_length: 'media', history: 'Desenvolvido no Reino Unido para pastoreio de ovelhas.', characteristics: 'Extremamente inteligente, trabalhador.' },
    { name: 'Borzoi', size: 'grande', coat_length: 'longa', history: 'Galgo russo criado para caça por visão.', characteristics: 'Elegante, reservado, veloz.' },
    { name: 'Boston Terrier', size: 'pequeno', coat_length: 'curta', history: 'Criado nos EUA como cão de companhia.', characteristics: 'Carinhoso, alerta, fácil de conviver.' },
    { name: 'Bouvier des Flandres', size: 'grande', coat_length: 'media', history: 'Da Bélgica, cão de fazenda e pastoreio.', characteristics: 'Trabalhador, leal, robusto.' },
    { name: 'Boxer', size: 'grande', coat_length: 'curta', history: 'Raça alemã usada como guarda e trabalho.', characteristics: 'Brincalhão, protetor, enérgico.' },
    { name: 'Briard', size: 'grande', coat_length: 'longa', history: 'Pastor francês tradicional.', characteristics: 'Inteligente, protetor, pelagem longa.' },
    { name: 'Brittany (Epagneul Breton)', size: 'medio', coat_length: 'media', history: 'Da França, cão de caça apontador.', characteristics: 'Ativo, amigável, versátil.' },
    { name: 'Bull Terrier', size: 'medio', coat_length: 'curta', history: 'Criado na Inglaterra, conhecido pela cabeça oval.', characteristics: 'Energético, leal, brincalhão.' },
    { name: 'Bulldog Francês', size: 'pequeno', coat_length: 'curta', history: 'Desenvolvido na França a partir de bulldogs menores.', characteristics: 'Companheiro, divertido, adapta-se bem a apartamento.' },
    { name: 'Bulldog Inglês', size: 'medio', coat_length: 'curta', history: 'Raça britânica histórica, hoje principalmente companhia.', characteristics: 'Calmo, teimoso, precisa de cuidados com calor.' },
    { name: 'Cairn Terrier', size: 'pequeno', coat_length: 'media', history: 'Terrier escocês criado para caçar pequenos animais.', characteristics: 'Valente, ativo, independente.' },
    { name: 'Cane Corso', size: 'grande', coat_length: 'curta', history: 'Mastim italiano usado para guarda e trabalho rural.', characteristics: 'Protetor, equilibrado, forte.' },
    { name: 'Cane da Pastore Maremmano-Abruzzese', size: 'grande', coat_length: 'longa', history: 'Da Itália, guardião de rebanhos.', characteristics: 'Independente, protetor, resistente.' },
    { name: 'Caramelo (SRD Brasileiro)', size: 'medio', coat_length: 'curta', history: 'Não é raça oficial; símbolo do SRD no Brasil.', characteristics: 'Adaptável, resistente, personalidade varia.' },
    { name: 'Cavalier (King Charles)', size: 'pequeno', coat_length: 'media', history: 'Spaniel britânico de companhia.', characteristics: 'Muito afetuoso e sociável.' },
    { name: 'Cavalier King Charles Spaniel', size: 'pequeno', coat_length: 'media', history: 'Spaniel britânico de companhia, ligado à nobreza.', characteristics: 'Doce, afetuoso, sociável.' },
    { name: 'Chihuahua', size: 'pequeno', coat_length: 'curta', history: 'Originário do México, uma das menores raças.', characteristics: 'Alerta, fiel, confiante.' },
    { name: 'Chinese Crested', size: 'pequeno', coat_length: 'curta', history: 'Raça de companhia conhecida por variedade sem pelos.', characteristics: 'Carinhoso, sensível, precisa de cuidados de pele.' },
    { name: 'Chow Chow', size: 'medio', coat_length: 'longa', history: 'Raça antiga chinesa usada para guarda e trabalho.', characteristics: 'Reservado, independente, pelagem densa.' },
    { name: 'Cocker Spaniel Inglês', size: 'medio', coat_length: 'media', history: 'Da Inglaterra, criado para caça e companhia.', characteristics: 'Afetuoso, ativo, orelhas longas.' },
    { name: 'Collie (Rough)', size: 'grande', coat_length: 'longa', history: 'Associado à Escócia, cão de pastoreio.', characteristics: 'Gentil, inteligente, pelagem longa.' },
    { name: 'Coton de Tulear', size: 'pequeno', coat_length: 'longa', history: 'De Madagascar, cão de companhia.', characteristics: 'Alegre, sociável, pelagem macia.' },
    { name: 'Curly-Coated Retriever', size: 'grande', coat_length: 'media', history: 'Retriever inglês de trabalho na água.', characteristics: 'Ativo, inteligente, pelagem encaracolada.' },
    { name: 'Cão Lobo Saarloos', size: 'grande', coat_length: 'media', history: 'Desenvolvido na Holanda com influência de lobo.', characteristics: 'Reservado, sensível, precisa de experiência.' },
    { name: 'Cão Lobo Tchecoslovaco', size: 'grande', coat_length: 'media', history: 'Criado a partir de cruzamentos controlados para trabalho.', characteristics: 'Muito ativo, exige manejo e socialização.' },
    { name: 'Cão Pastor Alemão', size: 'grande', coat_length: 'media', history: 'Da Alemanha, criado para pastoreio e trabalho.', characteristics: 'Versátil, protetor, treinável.' },
    { name: 'Cão Pastor Australiano (Kelpie)', size: 'medio', coat_length: 'curta', history: 'Da Austrália, pastoreio intensivo.', characteristics: 'Ativo, inteligente, resistente.' },
    { name: 'Cão Pastor de Anatolia (Kangal)', size: 'grande', coat_length: 'curta', history: 'Da Turquia, guardião de rebanhos.', characteristics: 'Protetor, independente, forte.' },
    { name: 'Cão Pastor de Beauce (Beauceron)', size: 'grande', coat_length: 'curta', history: 'Pastor francês de trabalho.', characteristics: 'Inteligente, atlético, protetor.' },
    { name: 'Cão Pastor de Berna (Entlebucher)', size: 'medio', coat_length: 'curta', history: 'Suíça, cão de fazenda.', characteristics: 'Ativo, alerta, leal.' },
    { name: 'Cão Pastor de Brie (Briard)', size: 'grande', coat_length: 'longa', history: 'Pastor francês tradicional.', characteristics: 'Trabalhador, protetor, pelagem longa.' },
    { name: 'Cão Pastor de Shetland', size: 'pequeno', coat_length: 'longa', history: 'Variante de pastoreio das Ilhas Shetland.', characteristics: 'Sensível, inteligente, bom em agility.' },
    { name: 'Cão da Groenlândia', size: 'grande', coat_length: 'media', history: 'Tipo spitz ártico de tração.', characteristics: 'Resistente, independente, ativo.' },
    { name: 'Cão de Santo Humberto (Bloodhound)', size: 'grande', coat_length: 'curta', history: 'Farejador belga/inglês histórico, referência em rastreio.', characteristics: 'Excelente faro, dócil, persistente.' },
    { name: 'Cão de Água Português', size: 'medio', coat_length: 'media', history: 'De Portugal, auxiliava pescadores e trabalho na água.', characteristics: 'Energético, inteligente, gosta de água.' },
    { name: 'Dachshund (Teckel)', size: 'pequeno', coat_length: 'curta', history: 'Da Alemanha, criado para caça em tocas.', characteristics: 'Corajoso, curioso, corpo alongado.' },
    { name: 'Dandie Dinmont Terrier', size: 'pequeno', coat_length: 'media', history: 'Terrier escocês tradicional.', characteristics: 'Corajoso, leal, independente.' },
    { name: 'Doberman Pinscher', size: 'grande', coat_length: 'curta', history: 'Criado na Alemanha para proteção e guarda.', characteristics: 'Inteligente, protetor, obediente.' },
    { name: 'Dobermann', size: 'grande', coat_length: 'curta', history: 'Cão de proteção alemão moderno.', characteristics: 'Alerta, inteligente, muito treinável.' },
    { name: 'Dogo Argentino', size: 'grande', coat_length: 'curta', history: 'Desenvolvido na Argentina para caça de grande porte.', characteristics: 'Forte, leal, requer socialização.' },
    { name: 'Dogue de Bordeaux', size: 'grande', coat_length: 'curta', history: 'Mastim francês tradicional.', characteristics: 'Calmo, poderoso, protetor.' },
    { name: 'Dálmata', size: 'grande', coat_length: 'curta', history: 'Histórico como cão de carruagem e companhia.', characteristics: 'Ativo, resistente, precisa de exercício.' },
    { name: 'English Setter', size: 'grande', coat_length: 'media', history: 'Raça britânica apontadora de caça.', characteristics: 'Gentil, ativo, elegante.' },
    { name: 'English Springer Spaniel', size: 'medio', coat_length: 'media', history: 'Spaniel inglês para caça.', characteristics: 'Sociável, ativo, obediente.' },
    { name: 'Eurasier', size: 'medio', coat_length: 'longa', history: 'Raça europeia moderna com base em spitz.', characteristics: 'Calmo, equilibrado, familiar.' },
    { name: 'Fila Brasileiro', size: 'grande', coat_length: 'curta', history: 'Raça brasileira tradicional de guarda e condução.', characteristics: 'Protetor, leal, exige manejo experiente.' },
    { name: 'Finnish Spitz', size: 'medio', coat_length: 'longa', history: 'Da Finlândia, usado para caça.', characteristics: 'Alerta, vocal, energético.' },
    { name: 'Fox Terrier', size: 'pequeno', coat_length: 'curta', history: 'Terrier inglês criado para caça.', characteristics: 'Vivo, ativo, inteligente.' },
    { name: 'Galgo Afegão', size: 'grande', coat_length: 'longa', history: 'Raça antiga do Afeganistão.', characteristics: 'Elegante, independente, pelagem longa.' },
    { name: 'Galgo Italiano', size: 'pequeno', coat_length: 'curta', history: 'Variante pequena de galgos, companhia.', characteristics: 'Delicado, afetuoso, rápido.' },
    { name: 'German Shorthaired Pointer', size: 'grande', coat_length: 'curta', history: 'Da Alemanha, cão de caça versátil.', characteristics: 'Ativo, obediente, atlético.' },
    { name: 'Golden Retriever', size: 'grande', coat_length: 'media', history: 'Criado no Reino Unido para resgate em caça.', characteristics: 'Amigável, inteligente, ótimo com famílias.' },
    { name: 'Gordon Setter', size: 'grande', coat_length: 'media', history: 'Setter escocês de caça.', characteristics: 'Ativo, leal, resistente.' },
    { name: 'Great Dane (Dogue Alemão)', size: 'grande', coat_length: 'curta', history: 'Desenvolvido na Europa como cão de caça e guarda.', characteristics: 'Gentil, grande porte, precisa de espaço.' },
    { name: 'Great Pyrenees (Cão dos Pireneus)', size: 'grande', coat_length: 'longa', history: 'Guardião de rebanhos nos Pireneus.', characteristics: 'Calmo, protetor, independente.' },
    { name: 'Greyhound', size: 'grande', coat_length: 'curta', history: 'Uma das raças mais antigas, corredor por visão.', characteristics: 'Calmo em casa, atlético ao ar livre.' },
    { name: 'Griffon Bruxellois', size: 'pequeno', coat_length: 'media', history: 'De Bélgica, cão de companhia.', characteristics: 'Vivo, apegado, expressivo.' },
    { name: 'Havanese', size: 'pequeno', coat_length: 'longa', history: 'De Cuba, cão de companhia.', characteristics: 'Alegre, sociável, pelagem sedosa.' },
    { name: 'Husky Siberiano', size: 'grande', coat_length: 'media', history: 'Da Sibéria, criado para tração em neve.', characteristics: 'Sociável, energético, independente.' },
    { name: 'Irish Setter', size: 'grande', coat_length: 'media', history: 'Da Irlanda, cão de caça.', characteristics: 'Muito ativo, amigável, elegante.' },
    { name: 'Irish Wolfhound', size: 'grande', coat_length: 'curta', history: 'Galgo irlandês de grande porte.', characteristics: 'Gentil, calmo, gigante.' },
    { name: 'Italian Spinone', size: 'grande', coat_length: 'media', history: 'Cão de caça italiano versátil.', characteristics: 'Calmo, resistente, bom em água.' },
    { name: 'Jack Russell Terrier', size: 'pequeno', coat_length: 'curta', history: 'Terrier britânico para caça de raposas.', characteristics: 'Muito ativo, inteligente, incansável.' },
    { name: 'Japanese Spitz', size: 'pequeno', coat_length: 'longa', history: 'Spitz japonês de companhia.', characteristics: 'Alegre, alerta, pelagem branca.' },
    { name: 'Keeshond', size: 'medio', coat_length: 'longa', history: 'Spitz holandês tradicional.', characteristics: 'Sociável, alerta, pelagem espessa.' },
    { name: 'Komondor', size: 'grande', coat_length: 'longa', history: 'Da Hungria, guardião com pelagem em cordas.', characteristics: 'Protetor, independente, rústico.' },
    { name: 'Kuvasz', size: 'grande', coat_length: 'media', history: 'Da Hungria, guardião de rebanhos.', characteristics: 'Protetor, independente, forte.' },
    { name: 'Labrador Retriever', size: 'grande', coat_length: 'curta', history: 'Do Canadá (Terra Nova), popularizado como retriever.', characteristics: 'Amigável, treinável, versátil.' },
    { name: 'Lakeland Terrier', size: 'pequeno', coat_length: 'media', history: 'Terrier inglês de caça.', characteristics: 'Ativo, corajoso, alerta.' },
    { name: 'Leonberger', size: 'grande', coat_length: 'longa', history: 'Da Alemanha, criado como cão de companhia grande.', characteristics: 'Gentil, grande porte, pelagem longa.' },
    { name: 'Lhasa Apso', size: 'pequeno', coat_length: 'longa', history: 'Do Tibete, criado como cão sentinela em monastérios.', characteristics: 'Alerta, independente, pelagem longa.' },
    { name: 'Lowchen', size: 'pequeno', coat_length: 'longa', history: 'Raça europeia de companhia.', characteristics: 'Alegre, sociável.' },
    { name: 'Maltês', size: 'pequeno', coat_length: 'longa', history: 'Antiga raça mediterrânea de companhia.', characteristics: 'Doce, brincalhão, pelagem longa.' },
    { name: 'Mastiff Inglês', size: 'grande', coat_length: 'curta', history: 'Mastim britânico histórico de guarda.', characteristics: 'Calmo, gigante, protetor.' },
    { name: 'Miniature Schnauzer', size: 'pequeno', coat_length: 'media', history: 'Da Alemanha, originalmente para controle de pragas.', characteristics: 'Alerta, inteligente, pelagem típica.' },
    { name: 'Newfoundland (Terra-Nova)', size: 'grande', coat_length: 'longa', history: 'Do Canadá, famoso por resgate aquático.', characteristics: 'Gentil, forte, gosta de água.' },
    { name: 'Old English Sheepdog', size: 'grande', coat_length: 'longa', history: 'Pastor inglês tradicional.', characteristics: 'Brincalhão, pelagem abundante.' },
    { name: 'Papillon', size: 'pequeno', coat_length: 'longa', history: 'Spaniel continental de companhia.', characteristics: 'Vivo, inteligente, orelhas em ‘borboleta’.' },
    { name: 'Pekingese', size: 'pequeno', coat_length: 'longa', history: 'Raça imperial chinesa de companhia.', characteristics: 'Reservado, corajoso, pelagem longa.' },
    { name: 'Pharaoh Hound', size: 'medio', coat_length: 'curta', history: 'Associado ao Mediterrâneo, cão de caça por visão.', characteristics: 'Atlético, alerta, afetuoso.' },
    { name: 'Poodle', size: 'pequeno', coat_length: 'media', history: 'Raça europeia usada para trabalho na água; hoje muito popular.', characteristics: 'Muito inteligente, hipoalergênico (tendência), aprende rápido.' },
    { name: 'Pug', size: 'pequeno', coat_length: 'curta', history: 'Raça de companhia de origem asiática, popular na Europa.', characteristics: 'Carinhoso, divertido, sensível ao calor.' },
    { name: 'Rhodesian Ridgeback', size: 'grande', coat_length: 'curta', history: 'Da África do Sul, usado para caça e guarda.', characteristics: 'Atlético, independente, leal.' },
    { name: 'Rottweiler', size: 'grande', coat_length: 'curta', history: 'Da Alemanha, usado para condução e guarda.', characteristics: 'Forte, leal, requer socialização.' },
    { name: 'Saint Bernard (São Bernardo)', size: 'grande', coat_length: 'longa', history: 'Dos Alpes, histórico em resgate.', characteristics: 'Gentil, grande porte, precisa de cuidados.' },
    { name: 'Saluki', size: 'grande', coat_length: 'curta', history: 'Galgo antigo do Oriente Médio.', characteristics: 'Elegante, reservado, veloz.' },
    { name: 'Samoyed', size: 'grande', coat_length: 'longa', history: 'Da Sibéria, tração e companhia.', characteristics: 'Sociável, sorridente, pelagem densa.' },
    { name: 'Scottish Terrier', size: 'pequeno', coat_length: 'media', history: 'Terrier escocês tradicional.', characteristics: 'Independente, corajoso, leal.' },
    { name: 'Shar Pei', size: 'medio', coat_length: 'curta', history: 'Da China, conhecido pelas dobras.', characteristics: 'Reservado, calmo, protetor.' },
    { name: 'Shetland Sheepdog', size: 'pequeno', coat_length: 'longa', history: 'Das Ilhas Shetland, cão de pastoreio.', characteristics: 'Sensível e inteligente; pelagem longa com subpelo.' },
    { name: 'Shiba Inu', size: 'pequeno', coat_length: 'media', history: 'Raça japonesa antiga de caça.', characteristics: 'Independente, alerta, limpo.' },
    { name: 'Shih Tzu', size: 'pequeno', coat_length: 'longa', history: 'Do Tibete/China, criado para companhia.', characteristics: 'Afetuoso, calmo, pelagem longa.' },
    { name: 'Siberian Husky', size: 'grande', coat_length: 'media', history: 'Da Sibéria, tração em neve.', characteristics: 'Energético, sociável, independente.' },
    { name: 'Soft Coated Wheaten Terrier', size: 'medio', coat_length: 'media', history: 'Terrier irlandês de fazenda.', characteristics: 'Alegre, afetuoso, pelagem macia.' },
    { name: 'Spitz Alemão (Lulu da Pomerânia)', size: 'pequeno', coat_length: 'longa', history: 'Família spitz alemã de companhia.', characteristics: 'Vivo, alerta, pelagem volumosa.' },
    { name: 'Staffordshire Bull Terrier', size: 'medio', coat_length: 'curta', history: 'Terrier britânico de trabalho, hoje companhia.', characteristics: 'Afetuoso, corajoso, enérgico.' },
    { name: 'Tibetan Mastiff', size: 'grande', coat_length: 'longa', history: 'Do Tibete, guardião tradicional.', characteristics: 'Independente, protetor, pelagem densa.' },
    { name: 'Tibetan Spaniel', size: 'pequeno', coat_length: 'media', history: 'Do Tibete, companhia e sentinela.', characteristics: 'Alerta, afetuoso, independente.' },
    { name: 'Vizsla', size: 'grande', coat_length: 'curta', history: 'Da Hungria, cão de caça apontador.', characteristics: 'Afetuoso, atlético, treinável.' },
    { name: 'Weimaraner', size: 'grande', coat_length: 'curta', history: 'Da Alemanha, cão de caça.', characteristics: 'Atlético, fiel, precisa de atividade.' },
    { name: 'West Highland White Terrier', size: 'pequeno', coat_length: 'media', history: 'Terrier escocês de caça.', characteristics: 'Ativo, confiante, sociável.' },
    { name: 'Whippet', size: 'medio', coat_length: 'curta', history: 'Da Inglaterra, corredor por visão.', characteristics: 'Gentil, veloz, bom companheiro.' },
    { name: 'Xoloitzcuintli', size: 'pequeno', coat_length: 'curta', history: 'Raça mexicana antiga; existe variedade sem pelos.', characteristics: 'Calmo, leal, precisa de cuidados de pele.' },
    { name: 'Yorkshire Terrier', size: 'pequeno', coat_length: 'longa', history: 'Terrier inglês criado para caça de roedores.', characteristics: 'Vivo, valente, pelagem longa.' },
  ];

  // upsert simples por name
  for (const b of breeds) {
    await query(
      `
      INSERT INTO dog_breeds (name, history, size, coat, characteristics, is_active)
      VALUES ($1, $2, $3, $4, $5, TRUE)
      ON CONFLICT (name) DO UPDATE SET
        history = EXCLUDED.history,
        size = EXCLUDED.size,
        coat = EXCLUDED.coat,
        characteristics = EXCLUDED.characteristics,
        updated_at = NOW()
      `,
      [b.name, b.history || null, b.size, b.coat, b.characteristics || null]
    );
  }
}

module.exports = {
  pool,
  initDb,
  all,
  get,
  run,
};
