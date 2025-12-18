// backend/server.js
const path = require('path');
const express = require('express');
const cors = require('cors');
const db = require('./db'); // PostgreSQL

const app = express();
app.use(cors());
app.use(express.json());

/* =========================
   OPENING HOURS / SLOT VALIDATION
========================= */
function parseDowFromDate(dateStr) {
  // dateStr: YYYY-MM-DD
  // Use noon UTC to avoid TZ edge cases
  const d = new Date(dateStr + 'T12:00:00.000Z');
  return d.getUTCDay(); // 0=Sun..6=Sat
}

function isValidHalfHour(timeStr) {
  // HH:MM
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(timeStr || '');
  if (!m) return false;
  return (m[2] === '00' || m[2] === '30');
}

async function getOpeningRule(dow) {
  const row = await db.get(`SELECT * FROM opening_hours WHERE day_of_week=$1`, [dow]);
  // Default rule if not configured
  if (!row) return { day_of_week: dow, is_closed: false, open_time: '07:30:00', close_time: '17:30:00', capacity_per_slot: 1 };
  return row;
}

function timeToHHMM(t) {
  if (!t) return null;
  return String(t).slice(0, 5);
}

async function ensureSlotAvailable({ date, time, excludeBookingId = null }) {
  if (!date || !time) throw new Error('Data e horário são obrigatórios.');
  if (!isValidHalfHour(time)) throw new Error('Horário inválido. Use slots de 30 min (ex.: 09:00 ou 09:30).');

  const dow = parseDowFromDate(date);
  const rule = await getOpeningRule(dow);

  if (rule.is_closed) throw new Error('Dia indisponível (fechado).');

  const openHHMM = timeToHHMM(rule.open_time);
  const closeHHMM = timeToHHMM(rule.close_time);

  if (!openHHMM || !closeHHMM) throw new Error('Horário de funcionamento não configurado para este dia.');
  if (time < openHHMM || time >= closeHHMM) throw new Error(`Horário fora do funcionamento (${openHHMM}–${closeHHMM}).`);

  const cap = Math.max(0, parseInt(rule.capacity_per_slot || 0, 10));
  if (cap === 0) throw new Error('Capacidade por slot está zerada para este dia/horário.');

  const params = excludeBookingId ? [date, time, excludeBookingId] : [date, time];
  const whereExclude = excludeBookingId ? 'AND id <> $3' : '';
  const row = await db.get(
    `SELECT COUNT(*)::int AS n
     FROM bookings
     WHERE date=$1 AND time=$2
       AND (status IS NULL OR status NOT IN ('cancelado','cancelled'))
       ${whereExclude}`,
    params
  );

  if ((row?.n || 0) >= cap) {
    throw new Error(`Limite atingido para ${date} ${time}. Capacidade: ${cap} agendamento(s) por slot.`);
  }
}


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

          await ensureSlotAvailable({ date, time, excludeBookingId: parseInt(req.params.id,10) });
await ensureSlotAvailable({ date, time });
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



/* =========================
   RAÇAS DE CÃES
========================= */

// Listar raças (com busca)
app.get('/api/breeds', async (req, res) => {
  try {
    const search = (req.query.search || '').trim();
    const params = [];
    let where = '';
    if (search) {
      params.push('%' + search + '%');
      where = 'WHERE name ILIKE $1';
    }
    const rows = await db.all(`SELECT * FROM dog_breeds ${where} ORDER BY name`, params);
    res.json({ breeds: rows });
  } catch (err) {
    console.error('Erro ao listar raças:', err);
    res.status(500).json({ error: 'Erro interno ao listar raças.' });
  }
});

// Criar raça
app.post('/api/breeds', async (req, res) => {
  try {
    const { name, size, coat, history } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Nome é obrigatório.' });
    const row = await db.get(
      `INSERT INTO dog_breeds (name, size, coat, history)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (name) DO UPDATE SET
         size=EXCLUDED.size,
         coat=EXCLUDED.coat,
         history=EXCLUDED.history,
         updated_at=NOW()
       RETURNING *`,
      [(name || '').trim(), size || 'medio', coat || 'media', history || null]
    );
    res.json({ breed: row });
  } catch (err) {
    console.error('Erro ao criar raça:', err);
    res.status(500).json({ error: 'Erro interno ao criar raça.' });
  }
});

// Atualizar raça
app.put('/api/breeds/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, size, coat, history } = req.body || {};
    if (!id) return res.status(400).json({ error: 'ID inválido.' });
    if (!name) return res.status(400).json({ error: 'Nome é obrigatório.' });

    const row = await db.get(
      `UPDATE dog_breeds
       SET name=$1, size=$2, coat=$3, history=$4, updated_at=NOW()
       WHERE id=$5
       RETURNING *`,
      [(name || '').trim(), size || 'medio', coat || 'media', history || null, id]
    );
    if (!row) return res.status(404).json({ error: 'Raça não encontrada.' });
    res.json({ breed: row });
  } catch (err) {
    console.error('Erro ao atualizar raça:', err);
    res.status(500).json({ error: 'Erro interno ao atualizar raça.' });
  }
});

// Excluir raça
app.delete('/api/breeds/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });
    await db.run(`DELETE FROM dog_breeds WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao excluir raça:', err);
    res.status(500).json({ error: 'Erro interno ao excluir raça.' });
  }
});

/* =========================
   HORÁRIO DE FUNCIONAMENTO
========================= */

// Listar horários
app.get('/api/opening-hours', async (req, res) => {
  try {
    const rows = await db.all(`SELECT * FROM opening_hours ORDER BY day_of_week`);
    res.json({ opening_hours: rows });
  } catch (err) {
    console.error('Erro ao listar horários:', err);
    res.status(500).json({ error: 'Erro interno ao listar horários.' });
  }
});

// Atualizar horários (upsert em lote)
app.put('/api/opening-hours', async (req, res) => {
  try {
    const items = (req.body && req.body.items) || [];
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Lista de horários vazia.' });
    }

    for (const it of items) {
      const dow = Number(it.day_of_week);
      const is_closed = !!it.is_closed;
      const open_time = is_closed ? null : it.open_time;
      const close_time = is_closed ? null : it.close_time;
      const cap = Math.max(0, parseInt(it.capacity_per_slot || 0, 10));

      await db.run(
        `INSERT INTO opening_hours (day_of_week, is_closed, open_time, close_time, capacity_per_slot)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (day_of_week) DO UPDATE SET
           is_closed=EXCLUDED.is_closed,
           open_time=EXCLUDED.open_time,
           close_time=EXCLUDED.close_time,
           capacity_per_slot=EXCLUDED.capacity_per_slot,
           updated_at=NOW()`,
        [dow, is_closed, open_time, close_time, cap]
      );
    }

    const rows = await db.all(`SELECT * FROM opening_hours ORDER BY day_of_week`);
    res.json({ opening_hours: rows });
  } catch (err) {
    console.error('Erro ao salvar horários:', err);
    res.status(500).json({ error: 'Erro interno ao salvar horários.' });
  }
});

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
