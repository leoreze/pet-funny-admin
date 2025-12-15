// backend/server.js
const path = require('path');
const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

/* =========================
   STATIC FILES
========================= */
app.use(express.static(__dirname));

/* =========================
   INIT DATABASE
========================= */
(async () => {
  try {
    await db.initDb();
    console.log('✅ Banco inicializado');
  } catch (err) {
    console.error('❌ Erro ao inicializar banco:', err);
  }
})();

/* =========================
   CLIENTES
========================= */

app.post('/api/customers/lookup', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Telefone obrigatório' });

  const customer = await db.get(
    'SELECT * FROM customers WHERE phone = $1',
    [phone]
  );

  if (!customer) return res.json({ exists: false });
  res.json({ exists: true, customer });
});

app.post('/api/customers', async (req, res) => {
  const { phone, name } = req.body;
  if (!phone || !name) {
    return res.status(400).json({ error: 'Nome e telefone obrigatórios' });
  }

  const existing = await db.get(
    'SELECT * FROM customers WHERE phone = $1',
    [phone]
  );

  if (existing) {
    await db.run(
      'UPDATE customers SET name = $1 WHERE id = $2',
      [name, existing.id]
    );
    return res.json({ customer: { ...existing, name } });
  }

  const result = await db.run(
    'INSERT INTO customers (phone, name) VALUES ($1, $2) RETURNING id',
    [phone, name]
  );

  const customer = await db.get(
    'SELECT * FROM customers WHERE id = $1',
    [result.lastID]
  );

  res.json({ customer });
});

/* =========================
   PETS
========================= */

app.get('/api/pets', async (req, res) => {
  const { customer_id } = req.query;
  if (!customer_id) return res.json({ pets: [] });

  const pets = await db.all(
    'SELECT * FROM pets WHERE customer_id = $1 ORDER BY name',
    [customer_id]
  );

  res.json({ pets });
});

app.post('/api/pets', async (req, res) => {
  const { customer_id, name, breed, info } = req.body;

  if (!customer_id || !name) {
    return res.status(400).json({ error: 'Cliente e nome obrigatórios' });
  }

  const result = await db.run(
    `
    INSERT INTO pets (customer_id, name, breed, info)
    VALUES ($1, $2, $3, $4)
    RETURNING id
    `,
    [customer_id, name, breed || null, info || null]
  );

  const pet = await db.get(
    'SELECT * FROM pets WHERE id = $1',
    [result.lastID]
  );

  res.json({ pet });
});

/* =========================
   SERVICES (CATÁLOGO)
========================= */

app.get('/api/services', async (_req, res) => {
  const services = await db.all(`
    SELECT
      id,
      title,
      value_cents
    FROM services
    ORDER BY title
  `);

  res.json({ services });
});

/* =========================
   BOOKINGS
========================= */

app.post('/api/bookings', async (req, res) => {
  const {
    customer_id,
    pet_id,
    date,
    time,
    service_id,
    prize,
    notes
  } = req.body;

  if (!customer_id || !date || !time || !service_id || !prize) {
    return res.status(400).json({
      error: 'Cliente, data, horário, serviço e mimo são obrigatórios'
    });
  }

  const service = await db.get(
    'SELECT title FROM services WHERE id = $1',
    [service_id]
  );

  if (!service) {
    return res.status(400).json({ error: 'Serviço inválido' });
  }

  const result = await db.run(
    `
    INSERT INTO bookings (
      customer_id,
      pet_id,
      date,
      time,
      service_id,
      service_title,
      prize,
      notes,
      status
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'agendado')
    RETURNING id
    `,
    [
      customer_id,
      pet_id || null,
      date,
      time,
      service_id,
      service.title,
      prize,
      notes || null
    ]
  );

  res.json({ id: result.lastID });
});

app.get('/api/bookings', async (req, res) => {
  const { date } = req.query;

  const bookings = await db.all(
    `
    SELECT
      b.*,
      c.name AS customer_name,
      p.name AS pet_name
    FROM bookings b
    JOIN customers c ON c.id = b.customer_id
    LEFT JOIN pets p ON p.id = b.pet_id
    WHERE ($1::text IS NULL OR b.date = $1)
    ORDER BY b.date, b.time
    `,
    [date || null]
  );

  res.json({ bookings });
});

/* =========================
   PAGES
========================= */

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

/* =========================
   START
========================= */

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Pet Funny rodando na porta ${PORT}`);
});
