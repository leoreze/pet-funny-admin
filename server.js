// backend/server.js
const path = require('path');
const express = require('express');
const cors = require('cors');
const db = require('./db'); // PostgreSQL

const app = express();
app.use(cors());
app.use(express.json());

/* =========================
   HORÁRIO DE FUNCIONAMENTO
========================= */

// Buscar horários (dow 0=Domingo .. 6=Sábado)
app.get('/api/opening-hours', async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT dow, is_closed, 
             to_char(open_time, 'HH24:MI') AS open_time,
             to_char(close_time, 'HH24:MI') AS close_time,
             max_per_half_hour,
             updated_at
      FROM opening_hours
      ORDER BY dow
    `);
    res.json({ opening_hours: rows });
  } catch (err) {
    console.error('Erro ao buscar horários de funcionamento:', err);
    res.status(500).json({ error: 'Erro interno ao buscar horários de funcionamento.' });
  }
});

// Salvar horários (upsert por dow)
app.put('/api/opening-hours', async (req, res) => {
  try {
    const opening_hours = Array.isArray(req.body?.opening_hours) ? req.body.opening_hours : null;
    if (!opening_hours) {
      return res.status(400).json({ error: 'Payload inválido. Envie { opening_hours: [...] }.' });
    }

    // Normaliza por dow (0..6)
    const byDow = new Map();
    for (const r of opening_hours) {
      const dow = Number(r.dow);
      if (!Number.isInteger(dow) || dow < 0 || dow > 6) continue;
      byDow.set(dow, {
        dow,
        is_closed: !!r.is_closed,
        open_time: r.open_time ? String(r.open_time).slice(0,5) : null,
        close_time: r.close_time ? String(r.close_time).slice(0,5) : null,
        max_per_half_hour: Math.max(0, Number(r.max_per_half_hour ?? 0) || 0),
      });
    }

    // garante 7 linhas
    const existing = await db.all(`SELECT dow, is_closed, open_time, close_time, max_per_half_hour FROM opening_hours ORDER BY dow`);
    const existingMap = new Map(existing.map(x => [Number(x.dow), x]));

    const rowsToSave = [];
    for (let dow = 0; dow <= 6; dow++) {
      const v = byDow.get(dow) || existingMap.get(dow) || { dow, is_closed: true, open_time: null, close_time: null, max_per_half_hour: 0 };

      // validações básicas
      if (!v.is_closed) {
        if (!v.open_time || !v.close_time) {
          return res.status(400).json({ error: `Dia ${dow}: informe abertura e fechamento ou marque como fechado.` });
        }
        if (v.open_time >= v.close_time) {
          return res.status(400).json({ error: `Dia ${dow}: horário de abertura deve ser menor que o de fechamento.` });
        }
      } else {
        v.open_time = null;
        v.close_time = null;
      }

      rowsToSave.push(v);
    }

    await db.run('BEGIN');
    try {
      for (const r of rowsToSave) {
        await db.run(
          `INSERT INTO opening_hours (dow, is_closed, open_time, close_time, max_per_half_hour, updated_at)
           VALUES ($1,$2,$3,$4,$5, NOW())
           ON CONFLICT (dow) DO UPDATE
             SET is_closed = EXCLUDED.is_closed,
                 open_time = EXCLUDED.open_time,
                 close_time = EXCLUDED.close_time,
                 max_per_half_hour = EXCLUDED.max_per_half_hour,
                 updated_at = NOW()`,
          [r.dow, r.is_closed, r.open_time, r.close_time, r.max_per_half_hour]
        );
      }
      await db.run('COMMIT');
    } catch (e) {
      await db.run('ROLLBACK');
      throw e;
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao salvar horários de funcionamento:', err);
    res.status(500).json({ error: 'Erro interno ao salvar horários de funcionamento.' });
  }
});

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
      params.push(`%${String(search).toLowerCase()}%`);
      where.push(`LOWER(title) LIKE $${params.length}`);
    }

    const sql = `
      SELECT
        id,
        date,
        title,
        value_cents,
        created_at,
        updated_at
      FROM services
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY date DESC, id DESC
    `;

    const services = await db.all(sql, params);
    res.json({ services });
  } catch (e) {
    console.error('Erro em GET /api/services:', e);
    res.status(500).json({ error: 'Erro ao buscar serviços.' });
  }
});

app.post('/api/services', async (req, res) => {
  try {
    const { date, title, value_cents } = req.body || {};

    if (!date || !String(title || '').trim()) {
      return res.status(400).json({ error: 'Campos obrigatórios: date, title.' });
    }

    const cents = Number(value_cents);
    if (!Number.isInteger(cents) || cents < 0) {
      return res.status(400).json({ error: 'Valor inválido.' });
    }

    const row = await db.get(
      `
      INSERT INTO services (date, title, value_cents)
      VALUES ($1, $2, $3)
      RETURNING id, date, title, value_cents, created_at, updated_at
      `,
      [date, String(title).trim(), cents]
    );

    res.json({ service: row });
  } catch (e) {
    console.error('Erro em POST /api/services:', e);
    res.status(500).json({ error: 'Erro ao salvar serviço.' });
  }
});

app.put('/api/services/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'ID inválido.' });
    }

    const { date, title, value_cents } = req.body || {};

    if (!date || !String(title || '').trim()) {
      return res.status(400).json({ error: 'Campos obrigatórios: date, title.' });
    }

    const cents = Number(value_cents);
    if (!Number.isInteger(cents) || cents < 0) {
      return res.status(400).json({ error: 'Valor inválido.' });
    }

    const row = await db.get(
      `
      UPDATE services
      SET
        date = $1,
        title = $2,
        value_cents = $3,
        updated_at = NOW()
      WHERE id = $4
      RETURNING id, date, title, value_cents, created_at, updated_at
      `,
      [date, String(title).trim(), cents, id]
    );

    if (!row) return res.status(404).json({ error: 'Serviço não encontrado.' });

    res.json({ service: row });
  } catch (e) {
    console.error('Erro em PUT /api/services:', e);
    res.status(500).json({ error: 'Erro ao atualizar serviço.' });
  }
});

app.delete('/api/services/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'ID inválido.' });
    }

    const row = await db.get('DELETE FROM services WHERE id = $1 RETURNING id', [id]);
    if (!row) return res.status(404).json({ error: 'Serviço não encontrado.' });

    res.json({ ok: true });
  } catch (e) {
    console.error('Erro em DELETE /api/services:', e);
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
