const sqlite3 = require('sqlite3').verbose();
const path = require('path');

/**
 * Caminho do banco
 * No Render: fica dentro do projeto
 * Local: funciona igual
 */
const dbPath = path.join(__dirname, 'petfunny.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Erro ao conectar no SQLite:', err.message);
  } else {
    console.log('✅ Banco SQLite conectado:', dbPath);
  }
});

/**
 * =========================
 * CRIAÇÃO DAS TABELAS
 * =========================
 */
db.serialize(() => {
  /**
   * CLIENTES
   */
  db.run(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  /**
   * PETS
   */
  db.run(`
    CREATE TABLE IF NOT EXISTS pets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      breed TEXT,
      info TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    )
  `);

  /**
   * AGENDAMENTOS
   */
  db.run(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      pet_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      service TEXT NOT NULL,
      prize TEXT,
      status TEXT DEFAULT 'agendado',
      notes TEXT,
      last_notification_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (pet_id) REFERENCES pets(id)
    )
  `);

  /**
   * LOG DE NOTIFICAÇÕES (opcional, mas recomendado)
   */
  db.run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (booking_id) REFERENCES bookings(id)
    )
  `);

  console.log('✅ Tabelas verificadas/criadas com sucesso');
});

module.exports = db;
