const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// caminho do banco
const dbPath = path.join(__dirname, 'petfunny.db');

// cria / abre o banco
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Erro ao abrir banco SQLite:', err.message);
  } else {
    console.log('Banco SQLite conectado:', dbPath);
  }
});

// inicialização das tabelas
db.serialize(() => {
  // CLIENTES
  db.run(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    )
  `);

  // PETS
  db.run(`
    CREATE TABLE IF NOT EXISTS pets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      breed TEXT,
      info TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    )
  `);

  // AGENDAMENTOS
  db.run(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      pet_id INTEGER,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      service TEXT NOT NULL,
      prize TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'agendado',
      notes TEXT,
      last_notification_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (pet_id) REFERENCES pets(id)
    )
  `);
});

module.exports = db;
