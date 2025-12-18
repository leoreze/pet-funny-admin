// backend/server.js
const path = require('path');
const express = require('express');
const cors = require('cors');
const db = require('./db'); // PostgreSQL helpers

const app = express();
app.use(cors());
app.use(express.json());

/* =========================
   STATIC FILES
========================= */
app.use(express.static(__dirname));

/* =========================
   HELPERS
========================= */
function normStr(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/* =========================
   CLIENTES
========================= */

// Listar clientes (com contagem de pets)
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

// Criar/atualizar cliente por phone (upsert)
app.post('/api/customers', async (req, res) => {
  try {
    const { phone, name } = req.body || {};
    if (!phone || !name) return res.status(400).json({ error: 'phone e name são obrigatórios.' });

    const existing = await db.get('SELECT * FROM customers WHERE phone = $1', [phone]);
    if (existing) {
      await db.query('UPDATE customers SET name = $1 WHERE id = $2', [name, existing.id]);
      const updated = await db.get('SELECT * FROM customers WHERE id = $1', [existing.id]);
      return res.json({ customer: updated });
    }

    const insert = await db.query(
      'INSERT INTO customers (phone, name) VALUES ($1,$2) RETURNING *',
      [phone, name]
    );
    res.json({ customer: insert.rows[0] });
  } catch (err) {
    console.error('Erro ao salvar customer:', err);
    res.status(500).json({ error: 'Erro interno ao salvar cliente.' });
  }
});

// Lookup por telefone
app.post('/api/customers/lookup', async (req, res) => {
  try {
    const { phone } = req.body || {};
    if (!phone) return res.status(400).json({ error: 'phone é obrigatório.' });

    const customer = await db.get('SELECT * FROM customers WHERE phone = $1', [phone]);
    if (!customer) return res.json({ exists: false });

    return res.json({ exists: true, customer });
  } catch (err) {
    console.error('Erro em lookup customers:', err);
    res.status(500).json({ error: 'Erro interno no lookup.' });
  }
});

// Excluir cliente
app.delete('/api/customers/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    await db.query('DELETE FROM customers WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao excluir customer:', err);
    res.status(500).json({ error: 'Erro interno ao excluir cliente.' });
  }
});

/* =========================
   PETS
========================= */

app.get('/api/pets', async (req, res) => {
  try {
    const customerId = req.query.customer_id ? Number(req.query.customer_id) : null;
    if (!customerId) return res.status(400).json({ error: 'customer_id é obrigatório.' });

    const rows = await db.all(
      'SELECT * FROM pets WHERE customer_id = $1 ORDER BY name',
      [customerId]
    );
    res.json({ pets: rows });
  } catch (err) {
    console.error('Erro ao listar pets:', err);
    res.status(500).json({ error: 'Erro interno ao buscar pets.' });
  }
});

app.post('/api/pets', async (req, res) => {
  try {
    const { customer_id, name, breed, info } = req.body || {};
    if (!customer_id || !name) return res.status(400).json({ error: 'customer_id e name são obrigatórios.' });

    const ins = await db.query(
      'INSERT INTO pets (customer_id, name, breed, info) VALUES ($1,$2,$3,$4) RETURNING *',
      [Number(customer_id), name, breed || null, info || null]
    );
    res.json({ pet: ins.rows[0] });
  } catch (err) {
    console.error('Erro ao criar pet:', err);
    res.status(500).json({ error: 'Erro interno ao criar pet.' });
  }
});

app.put('/api/pets/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, breed, info } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name é obrigatório.' });

    const upd = await db.query(
      'UPDATE pets SET name = $1, breed = $2, info = $3 WHERE id = $4 RETURNING *',
      [name, breed || null, info || null, id]
    );
    res.json({ pet: upd.rows[0] });
  } catch (err) {
    console.error('Erro ao atualizar pet:', err);
    res.status(500).json({ error: 'Erro interno ao atualizar pet.' });
  }
});

app.delete('/api/pets/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    await db.query('DELETE FROM pets WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao excluir pet:', err);
    res.status(500).json({ error: 'Erro interno ao excluir pet.' });
  }
});

/* =========================
   SERVIÇOS
========================= */

app.get('/api/services', async (req, res) => {
  try {
    const rows = await db.all('SELECT * FROM services ORDER BY date DESC, id DESC');
    res.json({ services: rows });
  } catch (err) {
    console.error('Erro ao listar services:', err);
    res.status(500).json({ error: 'Erro interno ao buscar serviços.' });
  }
});

app.post('/api/services', async (req, res) => {
  try {
    const { date, title, value_cents } = req.body || {};
    if (!date || !title || value_cents === undefined || value_cents === null) {
      return res.status(400).json({ error: 'date, title e value_cents são obrigatórios.' });
    }
    const ins = await db.query(
      `INSERT INTO services (date, title, value_cents, updated_at) VALUES ($1,$2,$3,NOW()) RETURNING *`,
      [date, title, Number(value_cents)]
    );
    res.json({ service: ins.rows[0] });
  } catch (err) {
    console.error('Erro ao criar service:', err);
    res.status(500).json({ error: 'Erro interno ao criar serviço.' });
  }
});

app.put('/api/services/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { date, title, value_cents, is_active } = req.body || {};
    if (!date || !title || value_cents === undefined || value_cents === null) {
      return res.status(400).json({ error: 'date, title e value_cents são obrigatórios.' });
    }
    const upd = await db.query(
      `UPDATE services SET date = $1, title = $2, value_cents = $3, is_active = COALESCE($4, is_active), updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [date, title, Number(value_cents), (typeof is_active === 'boolean' ? is_active : null), id]
    );
    res.json({ service: upd.rows[0] });
  } catch (err) {
    console.error('Erro ao atualizar service:', err);
    res.status(500).json({ error: 'Erro interno ao atualizar serviço.' });
  }
});

app.delete('/api/services/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    await db.query('DELETE FROM services WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao excluir service:', err);
    res.status(500).json({ error: 'Erro interno ao excluir serviço.' });
  }
});

/* =========================
   AGENDAMENTOS
========================= */

app.get('/api/bookings', async (req, res) => {
  try {
    const { date, search } = req.query;

    const params = [];
    const where = [];

    if (date) {
      params.push(String(date));
      where.push(`b.date = $${params.length}`);
    }

    if (search) {
      const s = `%${String(search).trim()}%`;
      params.push(s);
      const idx = params.length;
      where.push(`
        (
          c.name ILIKE $${idx}
          OR c.phone ILIKE $${idx}
          OR p.name ILIKE $${idx}
          OR COALESCE(b.service,'') ILIKE $${idx}
        )
      `);
    }

    const sql = `
      SELECT
        b.*,
        c.name AS customer_name,
        c.phone AS phone,
        p.name AS pet_name
      FROM bookings b
      JOIN customers c ON c.id = b.customer_id
      LEFT JOIN pets p ON p.id = b.pet_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY b.date DESC, b.time ASC, b.id DESC
    `;

    const rows = await db.all(sql, params);
    res.json({ bookings: rows });
  } catch (err) {
    console.error('Erro ao listar bookings:', err);
    res.status(500).json({ error: 'Erro interno ao buscar agendamentos.' });
  }
});

app.post('/api/bookings', async (req, res) => {
  try {
    const {
      customer_id,
      pet_id,
      service_id,
      service, // compat
      date,
      time,
      prize,
      notes,
      status,
      last_notification_at
    } = req.body || {};

    if (!customer_id || !date || !time || !prize) {
      return res.status(400).json({ error: 'customer_id, date, time e prize são obrigatórios.' });
    }

    const ins = await db.query(
      `
      INSERT INTO bookings
        (customer_id, pet_id, service_id, service, date, time, prize, notes, status, last_notification_at)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
      `,
      [
        Number(customer_id),
        (pet_id ? Number(pet_id) : null),
        (service_id ? Number(service_id) : null),
        (service || null),
        String(date),
        String(time),
        String(prize),
        (notes || null),
        (status || 'agendado'),
        (last_notification_at ? new Date(last_notification_at).toISOString() : null),
      ]
    );

    res.json({ booking: ins.rows[0] });
  } catch (err) {
    console.error('Erro ao criar booking:', err);
    res.status(500).json({ error: 'Erro interno ao criar agendamento.' });
  }
});

app.put('/api/bookings/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const {
      pet_id,
      service_id,
      service,
      date,
      time,
      prize,
      notes,
      status,
      last_notification_at
    } = req.body || {};

    if (!date || !time || !prize) {
      return res.status(400).json({ error: 'date, time e prize são obrigatórios.' });
    }

    const upd = await db.query(
      `
      UPDATE bookings
      SET pet_id = $1,
          service_id = $2,
          service = $3,
          date = $4,
          time = $5,
          prize = $6,
          notes = $7,
          status = $8,
          last_notification_at = $9
      WHERE id = $10
      RETURNING *
      `,
      [
        (pet_id ? Number(pet_id) : null),
        (service_id ? Number(service_id) : null),
        (service || null),
        String(date),
        String(time),
        String(prize),
        (notes || null),
        (status || 'agendado'),
        (last_notification_at ? new Date(last_notification_at).toISOString() : null),
        id,
      ]
    );

    res.json({ booking: upd.rows[0] });
  } catch (err) {
    console.error('Erro ao atualizar booking:', err);
    res.status(500).json({ error: 'Erro interno ao atualizar agendamento.' });
  }
});

app.delete('/api/bookings/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    await db.query('DELETE FROM bookings WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao excluir booking:', err);
    res.status(500).json({ error: 'Erro interno ao excluir agendamento.' });
  }
});

/* =========================
   RAÇAS (CRUD)
========================= */

app.get('/api/breeds', async (req, res) => {
  try {
    const { search, size, coat } = req.query || {};
    const params = [];
    const where = [];

    if (size) { params.push(String(size)); where.push(`size = $${params.length}`); }
    if (coat) { params.push(String(coat)); where.push(`coat = $${params.length}`); }
    if (search) {
      params.push(`%${String(search).trim()}%`);
      where.push(`(name ILIKE $${params.length} OR history ILIKE $${params.length})`);
    }

    const sql = `
      SELECT * FROM breeds
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY name
    `;
    const rows = await db.all(sql, params);
    res.json({ breeds: rows });
  } catch (err) {
    console.error('Erro ao listar breeds:', err);
    res.status(500).json({ error: 'Erro interno ao buscar raças.' });
  }
});

app.post('/api/breeds', async (req, res) => {
  try {
    const { name, history, size, coat } = req.body || {};
    if (!name || !size || !coat) return res.status(400).json({ error: 'name, size e coat são obrigatórios.' });

    const ins = await db.query(
      `INSERT INTO breeds (name, history, size, coat, updated_at) VALUES ($1,$2,$3,$4,NOW()) RETURNING *`,
      [name.trim(), (history || null), size, coat]
    );
    res.json({ breed: ins.rows[0] });
  } catch (err) {
    console.error('Erro ao criar breed:', err);
    const msg = String(err?.message || '');
    if (msg.includes('duplicate key')) return res.status(409).json({ error: 'Já existe uma raça com esse nome.' });
    res.status(500).json({ error: 'Erro interno ao criar raça.' });
  }
});

app.put('/api/breeds/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, history, size, coat } = req.body || {};
    if (!name || !size || !coat) return res.status(400).json({ error: 'name, size e coat são obrigatórios.' });

    const upd = await db.query(
      `UPDATE breeds SET name=$1, history=$2, size=$3, coat=$4, updated_at=NOW() WHERE id=$5 RETURNING *`,
      [name.trim(), (history || null), size, coat, id]
    );
    res.json({ breed: upd.rows[0] });
  } catch (err) {
    console.error('Erro ao atualizar breed:', err);
    res.status(500).json({ error: 'Erro interno ao atualizar raça.' });
  }
});

app.delete('/api/breeds/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    await db.query('DELETE FROM breeds WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao excluir breed:', err);
    res.status(500).json({ error: 'Erro interno ao excluir raça.' });
  }
});

/* =========================
   ROOT (fallback)
========================= */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

/* =========================
   START
========================= */
(async () => {
  try {
    await db.initDb();
    const port = process.env.PORT || 3000;
    app.listen(port, () => console.log('✅ Server on port', port));
  } catch (err) {
    console.error('Erro fatal ao inicializar banco:', err);
    process.exit(1);
  }
})();
