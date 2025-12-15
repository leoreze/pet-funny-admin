// backend/server.js
const path = require('path');
const express = require('express');
const cors = require('cors');
const db = require('./db'); // db.js (SQLite agora / PostgreSQL depois)

const app = express();
app.use(cors());
app.use(express.json());

/* =========================
   STATIC FILES
========================= */

// Admin (admin.html, logo, etc)
app.use(express.static(__dirname));



/* =========================
   INIT DATABASE
========================= */
(async () => {
  try {
    await db.initDb();
    console.log('Banco inicializado com sucesso');
  } catch (err) {
    console.error('Erro ao inicializar banco:', err);
  }
})();

/* =========================
   CLIENTES
========================= */

// Listar clientes
app.get('/api/customers', async (req, res) => {
  try {
    const sql = `
      SELECT c.*,
        (SELECT COUNT(*) FROM pets p WHERE p.customer_id = c.id) AS pets_count
      FROM customers c
      ORDER BY c.name
    `;
    const rows = await db.all(sql);
    res.json({ customers: rows });
  } catch (err) {
    console.error('Erro ao listar customers:', err);
    res.status(500).json({ error: 'Erro interno ao buscar clientes.' });
  }
});

// Lookup por telefone
app.post('/api/customers/lookup', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Telefone é obrigatório.' });

  try {
    const row = await db.get(
      'SELECT * FROM customers WHERE phone = $1',
      [phone]
    );
    if (!row) return res.json({ exists: false });
    res.json({ exists: true, customer: row });
  } catch (err) {
    console.error('Erro em lookup customers:', err);
    res.status(500).json({ error: 'Erro interno ao buscar cliente.' });
  }
});

// Criar / atualizar cliente
app.post('/api/customers', async (req, res) => {
  const { phone, name } = req.body;
  if (!phone || !name) {
    return res.status(400).json({ error: 'Telefone e nome são obrigatórios.' });
  }

  try {
    const row = await db.get(
      'SELECT * FROM customers WHERE phone = $1',
      [phone]
    );

    if (row) {
      await db.run(
        'UPDATE customers SET name = $1 WHERE id = $2',
        [name, row.id]
      );
      return res.json({ customer: { ...row, name }, existed: true });
    }

    const result = await db.run(
      'INSERT INTO customers (phone, name) VALUES ($1, $2)',
      [phone, name]
    );

    const novo = await db.get(
      'SELECT * FROM customers WHERE id = $1',
      [result.lastID]
    );

    res.json({ customer: novo, existed: false });
  } catch (err) {
    console.error('Erro ao salvar customer:', err);
    res.status(500).json({ error: 'Erro interno ao salvar cliente.' });
  }
});

// Excluir cliente
app.delete('/api/customers/:id', async (req, res) => {
  try {
    const result = await db.run(
      'DELETE FROM customers WHERE id = $1',
      [req.params.id]
    );
    res.json({ deleted: result.changes > 0 });
  } catch (err) {
    console.error('Erro ao excluir cliente:', err);
    res.status(500).json({ error: 'Erro interno ao excluir cliente.' });
  }
});

/* =========================
   PETS
========================= */

app.get('/api/pets', async (req, res) => {
  const { customer_id } = req.query;
  if (!customer_id) return res.json({ pets: [] });

  try {
    const rows = await db.all(
      'SELECT * FROM pets WHERE customer_id = $1 ORDER BY name',
      [customer_id]
    );
    res.json({ pets: rows });
  } catch (err) {
    console.error('Erro ao listar pets:', err);
    res.status(500).json({ error: 'Erro interno ao buscar pets.' });
  }
});

app.post('/api/pets', async (req, res) => {
  const { customer_id, name, breed, info } = req.body;

  if (!customer_id || !name) {
    return res.status(400).json({ error: 'Cliente e nome do pet são obrigatórios.' });
  }

  try {
    const result = await db.run(
      'INSERT INTO pets (customer_id, name, breed, info) VALUES ($1, $2,$3, $4)',
      [customer_id, name, breed || null, info || null]
    );

    const pet = await db.get(
      'SELECT * FROM pets WHERE id = $1',
      [result.lastID]
    );

    res.json({ pet });
  } catch (err) {
    console.error('Erro ao salvar pet:', err);
    res.status(500).json({ error: 'Erro interno ao salvar pet.' });
  }
});

app.put('/api/pets/:id', async (req, res) => {
  const { name, breed, info } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome do pet é obrigatório.' });

  try {
    await db.run(
      'UPDATE pets SET name = $1, breed = $2, info = $3 WHERE id = $4',
      [name, breed || null, info || null, req.params.id]
    );

    const pet = await db.get(
      'SELECT * FROM pets WHERE id = $1',
      [req.params.id]
    );

    res.json({ pet });
  } catch (err) {
    console.error('Erro ao atualizar pet:', err);
    res.status(500).json({ error: 'Erro interno ao atualizar pet.' });
  }
});

app.delete('/api/pets/:id', async (req, res) => {
  try {
    const result = await db.run(
      'DELETE FROM pets WHERE id = $1',
      [req.params.id]
    );
    res.json({ deleted: result.changes > 0 });
  } catch (err) {
    console.error('Erro ao excluir pet:', err);
    res.status(500).json({ error: 'Erro interno ao excluir pet.' });
  }
});

/* =========================
   BOOKINGS (AGENDA)
========================= */

app.post('/api/bookings', async (req, res) => {
  const {
    customer_id,
    pet_id,
    date,
    time,
    service,
    prize,
    notes,
    status
  } = req.body;

  // ✅ validação correta
  if (!customer_id || !date || !time || !service || !prize) {
    return res.status(400).json({
      error: 'Cliente, data, horário, serviço e mimo são obrigatórios.'
    });
  }

  // ✅ pet_id pode ser NULL
  let safePetId = null;
  if (pet_id !== undefined && pet_id !== null && pet_id !== '') {
    const parsed = Number(pet_id);
    safePetId = Number.isFinite(parsed) ? parsed : null;
  }

  try {
    const result = await db.run(
      `
      INSERT INTO bookings
        (customer_id, pet_id, date, time, service, prize, notes, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        customer_id,
        safePetId,
        date,
        time,
        service,
        prize,
        notes || null,
        status || 'agendado'
      ]
    );

    res.json({ id: result.lastID });
  } catch (err) {
    console.error('Erro ao salvar booking:', err);
    res.status(500).json({ error: 'Erro interno ao salvar agendamento.' });
  }
});


// ================== SERVICES ==================
app.get('/api/services', async (req, res) => {
  try {
    const { date, search } = req.query;

    const where = [];
    const params = [];

    if (date) {
      params.push(date);
      where.push(`date = $${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      where.push(`LOWER(title) LIKE LOWER($${params.length})`);
    }

    const sql = `
      SELECT id, date, title, price, created_at, updated_at
      FROM services
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY date DESC, id DESC
    `;

    const services = await db.all(sql, params);
    res.json({ services });
  } catch (e) {
    console.error('Erro em GET /api/services:', e);
    res.status(500).json({ error: e.message || 'Erro ao buscar serviços.' });
  }
});

app.post('/api/services', async (req, res) => {
  try {
    const { date, title, price } = req.body || {};

    if (!date || !String(title || '').trim()) {
      return res.status(400).json({ error: 'Campos obrigatórios: date, title.' });
    }

    const priceNum = Number(price);
    if (Number.isNaN(priceNum) || priceNum < 0) {
      return res.status(400).json({ error: 'Preço inválido.' });
    }

    const row = await db.get(
      `INSERT INTO services (date, title, price)
       VALUES ($1, $2, $3)
       RETURNING id, date, title, price, created_at, updated_at`,
      [date, String(title).trim(), priceNum]
    );

    res.json({ service: row });
  } catch (e) {
    console.error('Erro em POST /api/services:', e);
    res.status(500).json({ error: e.message || 'Erro ao salvar serviço.' });
  }
});

app.put('/api/services/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    const { date, title, price } = req.body || {};
    if (!date || !String(title || '').trim()) {
      return res.status(400).json({ error: 'Campos obrigatórios: date, title.' });
    }

    const priceNum = Number(price);
    if (Number.isNaN(priceNum) || priceNum < 0) {
      return res.status(400).json({ error: 'Preço inválido.' });
    }

    const row = await db.get(
      `UPDATE services
         SET date = $1,
             title = $2,
             price = $3,
             updated_at = NOW()
       WHERE id = $4
       RETURNING id, date, title, price, created_at, updated_at`,
      [date, String(title).trim(), priceNum, id]
    );

    if (!row) return res.status(404).json({ error: 'Serviço não encontrado.' });
    res.json({ service: row });
  } catch (e) {
    console.error('Erro em PUT /api/services/:id:', e);
    res.status(500).json({ error: e.message || 'Erro ao atualizar serviço.' });
  }
});

app.delete('/api/services/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    const row = await db.get(
      `DELETE FROM services WHERE id = $1 RETURNING id`,
      [id]
    );

    if (!row) return res.status(404).json({ error: 'Serviço não encontrado.' });
    res.json({ ok: true });
  } catch (e) {
    console.error('Erro em DELETE /api/services/:id:', e);
    res.status(500).json({ error: e.message || 'Erro ao excluir serviço.' });
  }
});

app.get('/api/bookings', async (req, res) => {
  const { date, search } = req.query;

  let sql = `
    SELECT
      b.*,
      c.name AS customer_name,
      c.phone,
      p.name AS pet_name,
      p.breed AS pet_breed
    FROM bookings b
    LEFT JOIN customers c ON c.id = b.customer_id
    LEFT JOIN pets p ON p.id = b.pet_id
    WHERE 1=1
  `;
  const params = [];

  if (date) {
    sql += ' AND b.date = $1';
    params.push(date);
  }

  if (search) {
    sql += `
      AND (
        c.name LIKE $1
        OR p.name LIKE $2
        OR c.phone LIKE $3
      )
    `;
    params.push(`%${search}%`, `%${search}%`, `%${search.replace(/\D/g, '')}%`);
  }

  sql += ' ORDER BY b.date ASC, b.time ASC';

  try {
    const rows = await db.all(sql, params);
    res.json({ bookings: rows });
  } catch (err) {
    console.error('Erro ao listar bookings:', err);
    res.status(500).json({ error: 'Erro ao buscar agendamentos.' });
  }
});

app.put('/api/bookings/:id', async (req, res) => {
  const {
    customer_id,
    pet_id,
    date,
    time,
    service,
    prize,
    notes,
    status,
    last_notification_at
  } = req.body;

  let safePetId = null;
  if (pet_id !== undefined && pet_id !== null && pet_id !== '') {
    const parsed = Number(pet_id);
    safePetId = Number.isFinite(parsed) ? parsed : null;
  }

  try {
    await db.run(
      `
      UPDATE bookings SET
        customer_id = $1,
        pet_id = $2,
        date = $3,
        time = $4,
        service = $5,
        prize = $6,
        notes = $7,
        status = $8,
        last_notification_at = $1
      WHERE id = $10
      `,9
      [
        customer_id,
        safePetId,
        date,
        time,
        service,
        prize,
        notes || null,
        status || 'agendado',
        last_notification_at || null,
        req.params.id
      ]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao atualizar booking:', err);
    res.status(500).json({ error: 'Erro ao atualizar agendamento.' });
  }
});

app.delete('/api/bookings/:id', async (req, res) => {
  try {
    await db.run(
      'DELETE FROM bookings WHERE id = $1',
      [req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao excluir booking:', err);
    res.status(500).json({ error: 'Erro ao excluir agendamento.' });
  }
});

/* =========================
   ROTAS DE PÁGINAS
========================= */

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log('🚀 Pet Funny API rodando na porta', PORT);
});
