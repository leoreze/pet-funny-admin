// db.js — Turso (libSQL) + fallback local (opcional)
// Requer: npm i @libsql/client

const fs = require("fs");
const path = require("path");
const { createClient } = require("@libsql/client");

// Variáveis padrão (Render)
const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL || process.env.TURSO_URL || "";
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || "";

// Opcional: fallback local (para dev). Se não quiser, pode remover.
const USE_LOCAL_SQLITE =
  !TURSO_DATABASE_URL ||
  TURSO_DATABASE_URL.trim() === "";

// Fallback local via arquivo SQLite usando libsql local (file:...)
const LOCAL_DB_FILE = process.env.LOCAL_DB_FILE || "pet-funny.sqlite";
const LOCAL_DB_URL = `file:${path.join(__dirname, LOCAL_DB_FILE)}`;

const client = createClient({
  url: USE_LOCAL_SQLITE ? LOCAL_DB_URL : TURSO_DATABASE_URL,
  authToken: USE_LOCAL_SQLITE ? undefined : TURSO_AUTH_TOKEN,
});

async function exec(sql, args = []) {
  return client.execute({ sql, args });
}

async function execMany(sql) {
  // executeMultiple aceita várias instruções separadas por ;
  return client.executeMultiple(sql);
}

/**
 * Migração/Inicialização:
 * - Cria tabelas se não existirem
 * - Garante defaults para created_at
 * - Se a tabela customers já existir COM created_at NOT NULL sem default, recria corretamente.
 */
async function initDb() {
  // 1) Cria schema base (idempotente)
  await execMany(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );

    CREATE TABLE IF NOT EXISTS pets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      breed TEXT,
      info TEXT,
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      pet_id INTEGER,
      date TEXT NOT NULL,         -- YYYY-MM-DD
      time TEXT NOT NULL,         -- HH:MM
      service TEXT NOT NULL,
      prize TEXT NOT NULL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'agendado',
      last_notification_at TEXT,
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
      FOREIGN KEY (pet_id) REFERENCES pets(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
    CREATE INDEX IF NOT EXISTS idx_pets_customer_id ON pets(customer_id);
    CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);
    CREATE INDEX IF NOT EXISTS idx_bookings_customer_id ON bookings(customer_id);
  `);

  // 2) Correção do seu cenário específico:
  // Se customers.created_at está NOT NULL mas SEM DEFAULT, inserts falham.
  // A forma mais segura é recriar a tabela.
  // Vamos detectar se existe DEFAULT no schema do customers.created_at.
  const info = await exec(`PRAGMA table_info(customers);`);
  const cols = info.rows || [];

  const createdAtCol = cols.find((c) => c.name === "created_at");
  const hasDefault = createdAtCol && createdAtCol.dflt_value;

  if (createdAtCol && !hasDefault) {
    // recria tabela customers com default correto
    await execMany(`
      PRAGMA foreign_keys = OFF;

      CREATE TABLE IF NOT EXISTS customers_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
      );

      INSERT INTO customers_new (id, phone, name, created_at)
      SELECT id, phone, name,
             COALESCE(created_at, CURRENT_TIMESTAMP)
      FROM customers;

      DROP TABLE customers;
      ALTER TABLE customers_new RENAME TO customers;

      CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

      PRAGMA foreign_keys = ON;
    `);
  }
}

/**
 * Helpers com padrão parecido com sqlite:
 * - all/get/run para facilitar no server.js
 */
async function all(sql, args = []) {
  const res = await exec(sql, args);
  return res.rows || [];
}

async function get(sql, args = []) {
  const rows = await all(sql, args);
  return rows[0] || null;
}

async function run(sql, args = []) {
  const res = await exec(sql, args);
  // libsql retorna lastInsertRowid / rowsAffected
  return {
    lastID: res.lastInsertRowid ? Number(res.lastInsertRowid) : undefined,
    changes: typeof res.rowsAffected === "number" ? res.rowsAffected : undefined,
  };
}

module.exports = {
  client,
  initDb,
  all,
  get,
  run,
};
