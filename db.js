// db.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    /* =======================
       CUSTOMERS
    ======================= */
    await client.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    /* =======================
       PETS
    ======================= */
    await client.query(`
      CREATE TABLE IF NOT EXISTS pets (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        breed TEXT,
        info TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    /* =======================
       SERVICES (PADRÃO CORRETO)
    ======================= */
    await client.query(`
      CREATE TABLE IF NOT EXISTS services (
        id SERIAL PRIMARY KEY,
        date DATE,
        title TEXT NOT NULL,
        value_cents INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    /* =======================
       BOOKINGS (COM service_id)
    ======================= */
    await client.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER REFERENCES customers(id),
        pet_id INTEGER REFERENCES pets(id),
        service_id INTEGER REFERENCES services(id),
        service TEXT, -- compatibilidade / snapshot
        prize TEXT,
        date DATE NOT NULL,
        time TIME NOT NULL,
        notes TEXT,
        status TEXT DEFAULT 'agendado',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    /* =======================
       MIGRATIONS DEFENSIVAS
    ======================= */
    await client.query(`
      ALTER TABLE services
      ADD COLUMN IF NOT EXISTS value_cents INTEGER DEFAULT 0;
    `);

    await client.query(`
      ALTER TABLE bookings
      ADD COLUMN IF NOT EXISTS service_id INTEGER;
    `);

    await client.query('COMMIT');
    console.log('DB pronto');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erro ao inicializar DB:', err);
    throw err;
  } finally {
    client.release();
  }
}

async function all(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

async function get(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows[0];
}

async function run(sql, params = []) {
  return pool.query(sql, params);
}

module.exports = {
  initDb,
  all,
  get,
  run
};
