// server.js
const path = require('path');
const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

/* =========================
   FRONT
========================= */
app.get('/', (_, res) =>
  res.sendFile(path.join(__dirname, 'index.html'))
);

app.get('/admin', (_, res) =>
  res.sendFile(path.join(__dirname, 'admin.html'))
);

/* =========================
   SERVICES
========================= */
app.get('/api/services', async (_, res) => {
  const services = await db.all(`
    SELECT id, title, value_cents
    FROM services
    ORDER BY title
  `);
  res.json({ services });
});

app.post('/api/services', async (req, res) => {
  const { title, value_cents } = req.body;
  const s = await db.get(
    `INSERT INTO services (title, value_cents)
     VALUES ($1,$2) RETURNING *`,
    [title, value_cents]
  );
  res.json({ service: s });
});

/* =========================
   BOOKINGS
========================= */
app.get('/api/bookings', async (req, res) => {
  const { date } = req.query;
  const bookings = await db.all(`
    SELECT
      b.*,
      c.name AS customer_name,
      c.phone,
      p.name AS pet_name,
      s.title AS service_title,
      s.value_cents
    FROM bookings b
    LEFT JOIN customers c ON c.id = b.customer_id
    LEFT JOIN pets p ON p.id = b.pet_id
    LEFT JOIN services s ON s.id = b.service_id
    WHERE ($1::date IS NULL OR b.date = $1)
    ORDER BY b.date, b.time
  `, [date || null]);

  res.json({ bookings });
});

app.post('/api/bookings', async (req, res) => {
  const {
    customer_id,
    pet_id,
    service_id,
    prize,
    date,
    time,
    notes,
    status
  } = req.body;

  const service = service_id
    ? (await db.get('SELECT title FROM services WHERE id=$1', [service_id]))?.title
    : null;

  await db.run(`
    INSERT INTO bookings
    (customer_id, pet_id, service_id, service, prize, date, time, notes, status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
  `, [
    customer_id,
    pet_id,
    service_id,
    service,
    prize,
    date,
    time,
    notes,
    status || 'agendado'
  ]);

  res.json({ ok: true });
});

/* =========================
   START
========================= */
(async () => {
  await db.initDb();
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () =>
    console.log('Server rodando na porta', PORT)
  );
})();
