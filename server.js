// backend/server.js
const path = require('path');
const express = require('express');
const cors = require('cors');
const db = require('./db'); // PostgreSQL

const app = express();
app.use(cors());
app.use(express.json());

/* =========================
   STATIC FILES
========================= */

// Admin (admin.html, logos etc) + index.html
app.use(express.static(__dirname));

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
    const row = await db.get('SELECT * FROM customers WHERE phone = $1', [phone]);
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
  if (!phone || !name) return res.status(400).json({ error: 'Telefone e nome são obrigatórios.' });

  try {
    const existing = await db.get('SELECT * FROM customers WHERE phone = $1', [phone]);

    if (existing) {
      const updated = await db.get(
        'UPDATE customers SET name = $1 WHERE id = $2 RETURNING *',
        [name, existing.id]
      );
      return res.json({ customer: updated, existed: true });
    }

    const created = await db.get(
      'INSERT INTO customers (phone, name) VALUES ($1, $2) RETURNING *',
      [phone, name]
    );

    return res.json({ customer: created, existed: false });
  } catch (err) {
    console.error('Erro ao salvar customer:', err);
    res.status(500).json({ error: 'Erro interno ao salvar cliente.' });
  }
});


// Excluir cliente
app.delete('/api/customers/:id', async (req, res) => {
  try {
    const result = await db.run('DELETE FROM customers WHERE id = $1', [req.params.id]);
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
  if (!customer_id || !name) return res.status(400).json({ error: 'Cliente e nome do pet são obrigatórios.' });

  try {
    const pet = await db.get(
      'INSERT INTO pets (customer_id, name, breed, info) VALUES ($1, $2, $3, $4) RETURNING *',
      [customer_id, name, breed || null, info || null]
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

    const pet = await db.get('SELECT * FROM pets WHERE id = $1', [req.params.id]);
    res.json({ pet });
  } catch (err) {
    console.error('Erro ao atualizar pet:', err);
    res.status(500).json({ error: 'Erro interno ao atualizar pet.' });
  }
});

app.delete('/api/pets/:id', async (req, res) => {
  try {
    const result = await db.run('DELETE FROM pets WHERE id = $1', [req.params.id]);
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
  const { customer_id, pet_id, date, time, service, prize, notes, status } = req.body;

  if (!customer_id || !date || !time || !service || !prize) {
    return res.status(400).json({
      error: 'Cliente, data, horário, serviço e mimo são obrigatórios.'
    });
  }

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
      [customer_id, safePetId, date, time, service, prize, notes || null, status || 'agendado']
    );

    res.json({ id: result.lastID });
  } catch (err) {
    console.error('Erro ao salvar booking:', err);
    res.status(500).json({ error: 'Erro interno ao salvar agendamento.' });
  }
});

/* =========================
   SERVICES
========================= */

// Listar serviços
app.get('/api/services', async (req, res) => {
  try {
    const services = await db.all(
      `
      SELECT
        id,
        name,
        duration_min,
        value_cents,
        is_active,
        created_at
      FROM services
      WHERE is_active = true
      ORDER BY name
      `
    );

    res.json({ services });
  } catch (err) {
    console.error('Erro ao listar services:', err);
    res.status(500).json({ error: 'Erro ao buscar serviços.' });
  }
});

// Criar serviço
app.post('/api/services', async (req, res) => {
  const { name, duration_min, value_cents } = req.body;

  if (!String(name || '').trim()) {
    return res.status(400).json({ error: 'Nome do serviço é obrigatório.' });
  }

  const duration = Number(duration_min) || 60;
  const cents = Number(value_cents);

  if (!Number.isInteger(cents) || cents < 0) {
    return res.status(400).json({ error: 'value_cents inválido.' });
  }

  try {
    const service = await db.get(
      `
      INSERT INTO services (name, duration_min, value_cents)
      VALUES ($1, $2, $3)
      RETURNING *
      `,
      [name.trim(), duration, cents]
    );

    res.json({ service });
  } catch (err) {
    console.error('Erro ao criar service:', err);
    res.status(500).json({ error: 'Erro ao salvar serviço.' });
  }
});

// Atualizar serviço
app.put('/api/services/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { name, duration_min, value_cents, is_active } = req.body;

  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'ID inválido.' });
  }

  const duration = Number(duration_min) || 60;
  const cents = Number(value_cents);

  if (!String(name || '').trim() || !Number.isInteger(cents) || cents < 0) {
    return res.status(400).json({ error: 'Dados inválidos.' });
  }

  try {
    const service = await db.get(
      `
      UPDATE services
      SET
        name = $1,
        duration_min = $2,
        value_cents = $3,
        is_active = $4
      WHERE id = $5
      RETURNING *
      `,
      [name.trim(), duration, cents, is_active !== false, id]
    );

    if (!service) {
      return res.status(404).json({ error: 'Serviço não encontrado.' });
    }

    res.json({ service });
  } catch (err) {
    console.error('Erro ao atualizar service:', err);
    res.status(500).json({ error: 'Erro ao atualizar serviço.' });
  }
});

// Soft delete
app.delete('/api/services/:id', async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'ID inválido.' });
  }

  try {
    await db.run(
      `UPDATE services SET is_active = false WHERE id = $1`,
      [id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao desativar service:', err);
    res.status(500).json({ error: 'Erro ao excluir serviço.' });
  }
});


/* =========================
   BOOKINGS (GET/PUT/DELETE)
========================= */

app.get('/api/bookings', async (req, res) => {
  const { date, search } = req.query;

  const where = [];
  const params = [];

  if (date) {
    params.push(date);
    where.push(`b.date = $${params.length}`);
  }

  if (search) {
    const s = String(search);

    params.push(`%${s}%`);
    const pName = `$${params.length}`;

    params.push(`%${s}%`);
    const pPet = `$${params.length}`;

    params.push(`%${s.replace(/\D/g, '')}%`);
    const pPhone = `$${params.length}`;

    // ILIKE para nome/pet (case-insensitive); phone normal com LIKE
    where.push(`(c.name ILIKE ${pName} OR p.name ILIKE ${pPet} OR c.phone LIKE ${pPhone})`);
  }

  const sql = `
    SELECT
      b.*,
      c.name AS customer_name,
      c.phone,
      p.name AS pet_name,
      p.breed AS pet_breed
    FROM bookings b
    LEFT JOIN customers c ON c.id = b.customer_id
    LEFT JOIN pets p ON p.id = b.pet_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY b.date ASC, b.time ASC
  `;

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
    safePetId = Number.isInteger(parsed) ? parsed : null;
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
        last_notification_at = $9
      WHERE id = $10
      `,
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
    await db.run('DELETE FROM bookings WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao excluir booking:', err);
    res.status(500).json({ error: 'Erro ao excluir agendamento.' });
  }
});

/* =========================
   ROTAS DE PÁGINAS
========================= */

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

/* =========================
   START SERVER (aguarda initDb)
========================= */
const PORT = process.env.PORT || 4000;

(async () => {
  try {
    await db.initDb();
    console.log('Banco inicializado com sucesso');

    app.listen(PORT, () => {
      console.log('🚀 Pet Funny API rodando na porta', PORT);
    });
  } catch (err) {
    console.error('Erro fatal ao inicializar banco:', err);
    process.exit(1);
  }
})();
