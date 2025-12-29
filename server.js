// PATCH: customers address fields in /api/customers - 2025-12-24
// backend/server.js (UPDATED)
const path = require('path');
const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

// Static files (admin.html, index.html, assets)
app.use(express.static(__dirname));

app.get(['/admin', '/admin/'], (req, res) => {
  return res.sendFile(path.join(__dirname, 'admin.html'));
});


/* =========================
   HELPERS
========================= */
function sanitizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function timeToMinutes(hhmm) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(String(hhmm || '').trim());
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

function getDowFromISODate(dateStr) {
  // dateStr: YYYY-MM-DD (interpreta como meia-noite local)
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.getDay(); // 0=Dom..6=Sáb
}

async function validateBookingSlot({ date, time, excludeBookingId = null }) {
  const dow = getDowFromISODate(date);
  if (dow == null) return { ok: false, error: 'Data inválida.' };

  const oh = await db.get(
    `SELECT dow, is_closed, open_time, close_time, max_per_half_hour
     FROM opening_hours WHERE dow = $1`,
    [dow]
  );

  // Se não existir linha (banco antigo), assume aberto padrão.
  if (!oh) return { ok: true };
  if (oh.is_closed) return { ok: false, error: 'Dia fechado para agendamentos.' };

  const t = timeToMinutes(time);
  const open = timeToMinutes(oh.open_time);
  const close = timeToMinutes(oh.close_time);
  if (!Number.isFinite(t) || !Number.isFinite(open) || !Number.isFinite(close)) {
    return { ok: false, error: 'Horário inválido.' };
  }
  if (t < open || t > close) {
    return { ok: false, error: 'Horário fora do funcionamento.' };
  }
  if ((t - open) % 30 !== 0) {
    return { ok: false, error: 'Horário deve ser em intervalos de 30 minutos.' };
  }

  const cap = Number(oh.max_per_half_hour);
  if (!Number.isFinite(cap) || cap <= 0) {
    return { ok: false, error: 'Capacidade do horário está zerada.' };
  }

  const params = [date, String(time).slice(0, 5)];
  let sql = `
    SELECT COUNT(*)::int AS n
    FROM bookings
    WHERE date = $1
      AND time = $2
      AND COALESCE(status,'') NOT IN ('cancelado','cancelada')
  `;
  if (excludeBookingId) {
    params.push(Number(excludeBookingId));
    sql += ` AND id <> $${params.length}`;
  }
  const cnt = await db.get(sql, params);
  const n = cnt?.n || 0;
  if (n >= cap) {
    return { ok: false, error: 'Este horário já atingiu o limite de agendamentos.' };
  }
  return { ok: true };
}

/* =========================
   CUSTOMERS
========================= */

// List customers
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

// Lookup by phone
app.post('/api/customers/lookup', async (req, res) => {
  try {
    const phone = sanitizePhone(req.body.phone);
    if (!phone) return res.status(400).json({ error: 'Telefone é obrigatório.' });

    const row = await db.get('SELECT * FROM customers WHERE phone = $1', [phone]);
    if (!row) return res.json({ exists: false });

    res.json({ exists: true, customer: row });
  } catch (err) {
    console.error('Erro em lookup customers:', err);
    res.status(500).json({ error: 'Erro interno ao buscar cliente.' });
  }
});

// Create/update customer (idempotente por phone)
app.post('/api/customers', async (req, res) => {
  try {
    const phone = sanitizePhone(req.body.phone);
    const name = String(req.body.name || '').trim();
    const cep = String(req.body.cep || '').replace(/\D/g, '').slice(0, 8) || null;
    const street = String(req.body.street || '').trim() || null;
    const number = String(req.body.number || '').trim() || null;
    const complement = String(req.body.complement || '').trim() || null;
    const neighborhood = String(req.body.neighborhood || '').trim() || null;
    const city = String(req.body.city || '').trim() || null;
    const state = String(req.body.state || '').trim().toUpperCase().slice(0, 2) || null;
    if (!phone || !name) return res.status(400).json({ error: 'Telefone e nome são obrigatórios.' });

    const existing = await db.get('SELECT * FROM customers WHERE phone = $1', [phone]);

    if (!existing) {
      const ins = await db.get(
        'INSERT INTO customers (phone, name, cep, street, number, complement, neighborhood, city, state) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
        [phone, name, cep, street, number, complement, neighborhood, city, state]
      );
      return res.json({ customer: ins });
    }

    const upd = await db.get(
      'UPDATE customers SET name=$2, cep=$3, street=$4, number=$5, complement=$6, neighborhood=$7, city=$8, state=$9 WHERE phone=$1 RETURNING *',
      [phone, name, cep, street, number, complement, neighborhood, city, state]
    );
    res.json({ customer: upd });
  } catch (err) {
    console.error('Erro ao salvar customer:', err);
    res.status(500).json({ error: 'Erro interno ao salvar cliente.' });
  }
});

app.delete('/api/customers/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    await db.run('DELETE FROM customers WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao deletar customer:', err);
    res.status(500).json({ error: 'Erro interno ao excluir cliente.' });
  }
});

/* =========================
   PETS
========================= */

// List pets (by customer_id)
app.get('/api/pets', async (req, res) => {
  try {
    const customerId = Number(req.query.customer_id);
    if (!customerId) return res.status(400).json({ error: 'customer_id é obrigatório.' });

    const rows = await db.all(
      `SELECT *,
              COALESCE(notes,'') AS info
         FROM pets
        WHERE customer_id = $1
        ORDER BY id DESC`,
      [customerId]
    );
    res.json({ pets: rows });
  } catch (err) {
    console.error('Erro ao listar pets:', err);
    res.status(500).json({ error: 'Erro interno ao buscar pets.' });
  }
});

// Create pet
app.post('/api/pets', async (req, res) => {
  try {
    const customerId = Number(req.body.customer_id);
    const name = String(req.body.name || '').trim();
    const breed = req.body.breed ? String(req.body.breed).trim() : null;

    // Novos campos (porte / pelagem)
    const size = req.body.size ? String(req.body.size).trim() : null;
    const coat = req.body.coat ? String(req.body.coat).trim() : null;

    // Compatibilidade: aceitar "info" (antigo) como notes
    const notesRaw = (req.body.notes ?? req.body.info);
    const notes = notesRaw ? String(notesRaw).trim() : null;

    if (!customerId || !name) return res.status(400).json({ error: 'customer_id e name são obrigatórios.' });

    const row = await db.get(
      `INSERT INTO pets (customer_id, name, breed, size, coat, notes)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [customerId, name, breed, size, coat, notes]
    );

    // resposta com campo info também (compat)
    row.info = row.notes ?? null;
    res.json({ pet: row });
  } catch (err) {
    console.error('Erro ao criar pet:', err);
    res.status(500).json({ error: 'Erro interno ao salvar pet.' });
  }
});

// Update pet
app.put('/api/pets/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const name = String(req.body.name || '').trim();
    const breed = req.body.breed ? String(req.body.breed).trim() : null;

    // Novos campos (porte / pelagem)
    const size = req.body.size ? String(req.body.size).trim() : null;
    const coat = req.body.coat ? String(req.body.coat).trim() : null;

    // Compatibilidade: aceitar "info" (antigo) como notes
    const notesRaw = (req.body.notes ?? req.body.info);
    const notes = notesRaw ? String(notesRaw).trim() : null;

    if (!id || !name) return res.status(400).json({ error: 'ID e name são obrigatórios.' });

    const row = await db.get(
      `UPDATE pets
         SET name=$2, breed=$3, size=$4, coat=$5, notes=$6, updated_at=NOW()
       WHERE id=$1
       RETURNING *`,
      [id, name, breed, size, coat, notes]
    );

    if (row) row.info = row.notes ?? null; // compat
    res.json({ pet: row });
  } catch (err) {
    console.error('Erro ao atualizar pet:', err);
    res.status(500).json({ error: 'Erro interno ao atualizar pet.' });
  }
});

app.delete('/api/pets/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    await db.run('DELETE FROM pets WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao deletar pet:', err);
    res.status(500).json({ error: 'Erro interno ao excluir pet.' });
  }
});

/* =========================
   SERVICES (value_cents)
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
    const today = new Date().toISOString().slice(0, 10);

    const date = String(req.body.date || today).slice(0, 10);
    const title = String(req.body.title || '').trim();
    const value_cents = Number(req.body.value_cents);

    const category = String(req.body.category || 'Banho').trim();
    const porte = String(req.body.porte || '').trim();
    const duration_min = Number(req.body.duration_min ?? req.body.tempo_min ?? 0);

    if (!title || !Number.isFinite(value_cents)) {
      return res.status(400).json({ error: 'title e value_cents são obrigatórios.' });
    }
    if (!Number.isFinite(duration_min) || duration_min < 0) {
      return res.status(400).json({ error: 'duration_min inválido.' });
    }

    const row = await db.get(
      `
      INSERT INTO services (date, category, title, porte, value_cents, duration_min, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,NOW())
      RETURNING *
      `,
      [date, category, title, porte || null, value_cents, duration_min]
    );
    res.json({ service: row });
  } catch (err) {
    console.error('Erro ao criar service:', err);
    res.status(500).json({ error: 'Erro interno ao criar serviço.' });
  }
});

app.put('/api/services/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const today = new Date().toISOString().slice(0, 10);

    const date = String(req.body.date || today).slice(0, 10);
    const title = String(req.body.title || '').trim();
    const value_cents = Number(req.body.value_cents);

    const category = String(req.body.category || 'Banho').trim();
    const porte = String(req.body.porte || '').trim();
    const duration_min = Number(req.body.duration_min ?? req.body.tempo_min ?? 0);

    if (!id || !title || !Number.isFinite(value_cents)) {
      return res.status(400).json({ error: 'id, title e value_cents são obrigatórios.' });
    }
    if (!Number.isFinite(duration_min) || duration_min < 0) {
      return res.status(400).json({ error: 'duration_min inválido.' });
    }

    const row = await db.get(
      `
      UPDATE services
      SET date=$2,
          category=$3,
          title=$4,
          porte=$5,
          value_cents=$6,
          duration_min=$7,
          updated_at=NOW()
      WHERE id=$1
      RETURNING *
      `,
      [id, date, category, title, porte || null, value_cents, duration_min]
    );

    res.json({ service: row });
  } catch (err) {
    console.error('Erro ao atualizar service:', err);
    res.status(500).json({ error: 'Erro interno ao atualizar serviço.' });
  }
});

app.delete('/api/services/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    await db.run('DELETE FROM services WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao deletar service:', err);
    res.status(500).json({ error: 'Erro interno ao excluir serviço.' });
  }
});

/* =========================
   BOOKINGS
========================= */

app.get('/api/bookings', async (req, res) => {
  try {
    const {
      q,
      search,
      status,
      date,
      date_from,
      date_to,
      customer_id,
      pet_id
    } = req.query;

    // Compatibilidade: front antigo usa `search` e `date`
    const qFinal = (q && String(q).trim())
      ? String(q).trim()
      : ((search && String(search).trim()) ? String(search).trim() : '');

    const dateFinal = (date && String(date).trim()) ? String(date).trim().slice(0, 10) : '';
    const dateFromFinal = (date_from && String(date_from).trim()) ? String(date_from).trim().slice(0, 10) : (dateFinal || '');
    const dateToFinal = (date_to && String(date_to).trim()) ? String(date_to).trim().slice(0, 10) : (dateFinal || '');

    const where = [];
    const params = [];

    if (qFinal) {
      const like = `%${qFinal.toLowerCase()}%`;
      params.push(like);
      const p = `$${params.length}`;
      where.push(`(
        LOWER(c.name) LIKE ${p}
        OR LOWER(COALESCE(c.phone, '')) LIKE ${p}
        OR LOWER(COALESCE(pet.name, '')) LIKE ${p}
        OR LOWER(COALESCE(b.notes, '')) LIKE ${p}
        OR LOWER(COALESCE(b.prize, '')) LIKE ${p}
      )`);
    }

    if (status && String(status).trim()) {
      params.push(String(status).trim());
      where.push(`b.status = $${params.length}`);
    }

    if (dateFromFinal) {
      params.push(dateFromFinal);
      where.push(`b.date >= $${params.length}`);
    }

    if (dateToFinal) {
      params.push(dateToFinal);
      where.push(`b.date <= $${params.length}`);
    }

    if (customer_id != null && String(customer_id).trim() !== '') {
      params.push(Number(customer_id));
      where.push(`b.customer_id = $${params.length}`);
    }

    if (pet_id != null && String(pet_id).trim() !== '') {
      params.push(Number(pet_id));
      where.push(`b.pet_id = $${params.length}`);
    }

    const sql = `
      SELECT
        b.*,
        c.name AS customer_name,
        c.phone AS customer_phone,
        c.phone AS phone,
        pet.name AS pet_name,

        -- serviço único (compatível com snapshot no booking)
        COALESCE((b.services_json->0->>'title'), s.title) AS service_title,
        COALESCE((b.services_json->0->>'value_cents')::int, b.service_value_cents, s.value_cents, 0) AS service_value_cents,
        COALESCE((b.services_json->0->>'duration_min')::int, b.service_duration_min, s.duration_min, 0) AS service_duration_min,

        -- múltiplos serviços (novo): armazenado em bookings.services_json
        COALESCE(b.services_json, '[]'::jsonb) AS services,
        COALESCE(b.service_value_cents, 0) AS services_total_cents,
        COALESCE(b.service_duration_min, 0) AS services_total_min
      FROM bookings b
      JOIN customers c ON c.id = b.customer_id
      LEFT JOIN pets pet ON pet.id = b.pet_id
      LEFT JOIN services s ON s.id = b.service_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY b.date DESC, b.time DESC, b.id DESC
    `;

    const rows = await db.all(sql, params);
    res.json({ bookings: rows });
  } catch (err) {
    console.error('Erro ao listar bookings:', err);
    res.status(500).json({ error: 'Erro interno ao listar agendamentos.' });
  }
});


app.post('/api/bookings', async (req, res) => {
  try {
    const customer_id = Number(req.body.customer_id);
    const pet_id = req.body.pet_id != null ? Number(req.body.pet_id) : null;
    const service_id = req.body.service_id != null ? Number(req.body.service_id) : null;

    const service = req.body.service ? String(req.body.service).trim() : null;
    const date = String(req.body.date || '').slice(0, 10);
    const time = String(req.body.time || '').slice(0, 5);
    const prize = String(req.body.prize || '').trim();
    const notes = req.body.notes ? String(req.body.notes).trim() : null;
    const status = req.body.status ? String(req.body.status).trim() : 'agendado';
    const last_notification_at = req.body.last_notification_at ? String(req.body.last_notification_at) : null;

    const payment_status = req.body.payment_status ? String(req.body.payment_status).trim() : 'Não Pago';
    const payment_method = req.body.payment_method ? String(req.body.payment_method).trim() : '';

    const service_value_cents = (req.body.service_value_cents != null && String(req.body.service_value_cents).trim() !== '')
      ? Number(req.body.service_value_cents)
      : null;
    const service_duration_min = (req.body.service_duration_min != null && String(req.body.service_duration_min).trim() !== '')
      ? Number(req.body.service_duration_min)
      : null;

    // Múltiplos serviços (novo): array de objetos {id,title,value_cents,duration_min}
    let services_json = Array.isArray(req.body.services) ? req.body.services : (Array.isArray(req.body.services_json) ? req.body.services_json : null);
    if (!services_json && service_id != null) {
      // compat: serviço único vira lista
      services_json = [{ id: service_id }];
    }
    if (!services_json) services_json = [];
    // normaliza e calcula totais
    services_json = services_json.map(s => ({
      id: s && s.id != null ? Number(s.id) : null,
      title: s && s.title != null ? String(s.title) : null,
      value_cents: s && s.value_cents != null ? Number(s.value_cents) : null,
      duration_min: s && s.duration_min != null ? Number(s.duration_min) : null
    })).filter(s => s.id != null || s.title);
    const total_cents_from_list = services_json.reduce((acc, s) => acc + (Number.isFinite(s.value_cents) ? s.value_cents : 0), 0);
    const total_min_from_list = services_json.reduce((acc, s) => acc + (Number.isFinite(s.duration_min) ? s.duration_min : 0), 0);
    const svcTotalsCents = (service_value_cents != null) ? service_value_cents : (services_json.length ? total_cents_from_list : null);
    const svcTotalsMin = (service_duration_min != null) ? service_duration_min : (services_json.length ? total_min_from_list : null);

    // `prize` (mimo) pode ser vazio.
    if (!customer_id || !date || !time) {
      return res.status(400).json({ error: 'customer_id, date e time são obrigatórios.' });
    }

    if (service_value_cents != null && (!Number.isFinite(service_value_cents) || service_value_cents < 0)) {
      return res.status(400).json({ error: 'service_value_cents inválido.' });
    }
    if (service_duration_min != null && (!Number.isFinite(service_duration_min) || service_duration_min < 0)) {
      return res.status(400).json({ error: 'service_duration_min inválido.' });
    }

    // Horário de funcionamento + capacidade por meia hora (evita overbooking)
    const v = await validateBookingSlot({ date, time });
    if (!v.ok) return res.status(409).json({ error: v.error });

    const row = await db.get(
      `
      INSERT INTO bookings (
        customer_id, pet_id, service_id, service,
        date, time, prize, notes, status, last_notification_at,
        payment_status, payment_method,
        service_value_cents, service_duration_min,
        services_json
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *
      `,
      [
        customer_id, pet_id, service_id, service,
        date, time, prize, notes, status, last_notification_at,
        payment_status, payment_method,
        svcTotalsCents, svcTotalsMin,
        JSON.stringify(services_json)
      ]
    );
    res.json({ booking: row });
  } catch (err) {
    console.error('Erro ao criar booking:', err);
    res.status(500).json({ error: 'Erro interno ao salvar agendamento.' });
  }
});

app.put('/api/bookings/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const customer_id = Number(req.body.customer_id);
    const pet_id = req.body.pet_id != null ? Number(req.body.pet_id) : null;
    const service_id = req.body.service_id != null ? Number(req.body.service_id) : null;

    const service = req.body.service ? String(req.body.service).trim() : null;
    const date = String(req.body.date || '').slice(0, 10);
    const time = String(req.body.time || '').slice(0, 5);
    const prize = String(req.body.prize || '').trim();
    const notes = req.body.notes ? String(req.body.notes).trim() : null;
    const status = req.body.status ? String(req.body.status).trim() : 'agendado';
    const last_notification_at = req.body.last_notification_at ? String(req.body.last_notification_at) : null;

    const payment_status = req.body.payment_status ? String(req.body.payment_status).trim() : 'Não Pago';
    const payment_method = req.body.payment_method ? String(req.body.payment_method).trim() : '';

    const service_value_cents = (req.body.service_value_cents != null && String(req.body.service_value_cents).trim() !== '')
      ? Number(req.body.service_value_cents)
      : null;
    const service_duration_min = (req.body.service_duration_min != null && String(req.body.service_duration_min).trim() !== '')
      ? Number(req.body.service_duration_min)
      : null;

// Múltiplos serviços (novo): array de objetos {id,title,value_cents,duration_min}
let services_json = Array.isArray(req.body.services) ? req.body.services
  : (Array.isArray(req.body.services_json) ? req.body.services_json : null);
if (!services_json && service_id != null) {
  // compat: serviço único vira lista
  services_json = [{ id: service_id }];
}
if (!services_json) services_json = [];
// normaliza e calcula totais
services_json = services_json.map(s => ({
  id: s && s.id != null ? Number(s.id) : null,
  title: s && s.title != null ? String(s.title) : null,
  value_cents: s && s.value_cents != null ? Number(s.value_cents) : null,
  duration_min: s && s.duration_min != null ? Number(s.duration_min) : null
})).filter(s => s.id != null || s.title);

const total_cents_from_list = services_json.reduce((acc, s) => acc + (Number.isFinite(s.value_cents) ? s.value_cents : 0), 0);
const total_min_from_list = services_json.reduce((acc, s) => acc + (Number.isFinite(s.duration_min) ? s.duration_min : 0), 0);
const svcTotalsCents = (service_value_cents != null) ? service_value_cents : (services_json.length ? total_cents_from_list : null);
const svcTotalsMin = (service_duration_min != null) ? service_duration_min : (services_json.length ? total_min_from_list : null);


    // `id` vem da URL (/api/bookings/:id). `prize` (mimo) pode ser vazio.
    if (!id || !customer_id || !date || !time) {
      return res.status(400).json({ error: 'customer_id, date e time são obrigatórios.' });
    }

    if (service_value_cents != null && (!Number.isFinite(service_value_cents) || service_value_cents < 0)) {
      return res.status(400).json({ error: 'service_value_cents inválido.' });
    }
    if (service_duration_min != null && (!Number.isFinite(service_duration_min) || service_duration_min < 0)) {
      return res.status(400).json({ error: 'service_duration_min inválido.' });
    }

    // Horário de funcionamento + capacidade por meia hora (exclui o próprio agendamento)
    const v = await validateBookingSlot({ date, time, excludeBookingId: id });
    if (!v.ok) return res.status(409).json({ error: v.error });

    const row = await db.get(
      `
      UPDATE bookings
      SET
        customer_id=$2,
        pet_id=$3,
        service_id=$4,
        service=$5,
        date=$6,
        time=$7,
        prize=$8,
        notes=$9,
        status=$10,
        last_notification_at=$11,
        payment_status=$12,
        payment_method=$13,
        service_value_cents=$14,
        service_duration_min=$15,
        services_json=$16
      WHERE id=$1
      RETURNING *
      `,
      [
        id, customer_id, pet_id, service_id, service,
        date, time, prize, notes, status, last_notification_at,
        payment_status, payment_method,
        svcTotalsCents, svcTotalsMin,
        JSON.stringify(services_json)
      ]
    );
    res.json({ booking: row });
  } catch (err) {
    console.error('Erro ao atualizar booking:', err);
    res.status(500).json({ error: 'Erro interno ao atualizar agendamento.' });
  }
});

app.delete('/api/bookings/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    await db.run('DELETE FROM bookings WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao deletar booking:', err);
    res.status(500).json({ error: 'Erro interno ao excluir agendamento.' });
  }
});

/* =========================
   BREEDS (dog_breeds) - NOVO CRUD
========================= */

app.get('/api/breeds', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const active = String(req.query.active || '').trim(); // "1" para apenas ativos

    let sql = `SELECT * FROM dog_breeds WHERE 1=1`;
    const params = [];

    if (active === '1') sql += ` AND is_active = TRUE`;

    if (q) {
      params.push(`%${q.toLowerCase()}%`);
      sql += ` AND (LOWER(name) LIKE $${params.length} OR LOWER(size) LIKE $${params.length} OR LOWER(coat) LIKE $${params.length})`;
    }

    sql += ` ORDER BY name ASC`;
    const rows = await db.all(sql, params);
    res.json({ breeds: rows });
  } catch (err) {
    console.error('Erro ao listar breeds:', err);
    res.status(500).json({ error: 'Erro interno ao buscar raças.' });
  }
});

app.post('/api/breeds', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const history = String(req.body.history || '').trim();
    const size = String(req.body.size || '').trim(); // pequeno|medio|grande
    const coat = String(req.body.coat || '').trim(); // curta|media|longa
    const characteristics = String(req.body.characteristics || '').trim();
    const is_active = req.body.is_active === false ? false : true;

    if (!name || !size || !coat) {
      return res.status(400).json({ error: 'name, size e coat são obrigatórios.' });
    }

    const row = await db.get(
      `
      INSERT INTO dog_breeds (name, history, size, coat, characteristics, is_active, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,NOW())
      RETURNING *
      `,
      [name, history, size, coat, characteristics, is_active]
    );

    res.json({ breed: row });
  } catch (err) {
    console.error('Erro ao criar breed:', err);
    res.status(500).json({ error: 'Erro interno ao salvar raça (pode ser nome duplicado).' });
  }
});

app.put('/api/breeds/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const name = String(req.body.name || '').trim();
    const history = String(req.body.history || '').trim();
    const size = String(req.body.size || '').trim();
    const coat = String(req.body.coat || '').trim();
    const characteristics = String(req.body.characteristics || '').trim();
    const is_active = req.body.is_active === false ? false : true;

    if (!id || !name || !size || !coat) {
      return res.status(400).json({ error: 'id, name, size e coat são obrigatórios.' });
    }

    const row = await db.get(
      `
      UPDATE dog_breeds
      SET name=$2, history=$3, size=$4, coat=$5, characteristics=$6, is_active=$7, updated_at=NOW()
      WHERE id=$1
      RETURNING *
      `,
      [id, name, history, size, coat, characteristics, is_active]
    );

    res.json({ breed: row });
  } catch (err) {
    console.error('Erro ao atualizar breed:', err);
    res.status(500).json({ error: 'Erro interno ao atualizar raça.' });
  }
});

app.delete('/api/breeds/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    await db.run('DELETE FROM dog_breeds WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao deletar breed:', err);
    res.status(500).json({ error: 'Erro interno ao excluir raça.' });
  }
});

/* =========================
   MIMOS (prêmios da roleta)
========================= */

app.get('/api/mimos', async (req, res) => {
  try {
    const onlyActive = String(req.query.active || '').trim() === '1';
    const at = req.query.at ? String(req.query.at) : null; // ISO opcional

    if (onlyActive) {
      const rows = await db.all(
        `SELECT id, title, description, value_cents, starts_at, ends_at, is_active, updated_at
         FROM mimos
         WHERE is_active = TRUE
           AND (starts_at IS NULL OR starts_at <= COALESCE($1::timestamptz, NOW()))
           AND (ends_at   IS NULL OR ends_at   >= COALESCE($1::timestamptz, NOW()))
         ORDER BY COALESCE(starts_at, NOW()) DESC, id DESC`,
        [at]
      );
      return res.json({ mimos: rows });
    }

    const rows = await db.all(
      `SELECT id, title, description, value_cents, starts_at, ends_at, is_active, updated_at
       FROM mimos
       ORDER BY id DESC`
    );
    res.json({ mimos: rows });
  } catch (err) {
    console.error('Erro ao listar mimos:', err);
    res.status(500).json({ error: 'Erro interno ao buscar mimos.' });
  }
});

app.post('/api/mimos', async (req, res) => {
  try {
    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();
    const value_cents = Number(req.body.value_cents ?? 0);
    const starts_at = req.body.starts_at ? String(req.body.starts_at) : null;
    const ends_at = req.body.ends_at ? String(req.body.ends_at) : null;
    const is_active = req.body.is_active === false ? false : true;

    if (!title) return res.status(400).json({ error: 'Informe o título.' });
    if (!Number.isFinite(value_cents) || value_cents < 0) return res.status(400).json({ error: 'Valor inválido.' });

    const row = await db.get(
      `INSERT INTO mimos (title, description, value_cents, starts_at, ends_at, is_active, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       RETURNING id, title, description, value_cents, starts_at, ends_at, is_active, updated_at`,
      [title, description, Math.round(value_cents), starts_at, ends_at, is_active]
    );
    res.json({ mimo: row });
  } catch (err) {
    console.error('Erro ao criar mimo:', err);
    res.status(500).json({ error: 'Erro interno ao criar mimo.' });
  }
});

app.put('/api/mimos/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'ID inválido.' });

    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();
    const value_cents = Number(req.body.value_cents ?? 0);
    const starts_at = req.body.starts_at ? String(req.body.starts_at) : null;
    const ends_at = req.body.ends_at ? String(req.body.ends_at) : null;
    const is_active = req.body.is_active === false ? false : true;

    if (!title) return res.status(400).json({ error: 'Informe o título.' });
    if (!Number.isFinite(value_cents) || value_cents < 0) return res.status(400).json({ error: 'Valor inválido.' });

    const row = await db.get(
      `UPDATE mimos
       SET title=$1, description=$2, value_cents=$3, starts_at=$4, ends_at=$5, is_active=$6, updated_at=NOW()
       WHERE id=$7
       RETURNING id, title, description, value_cents, starts_at, ends_at, is_active, updated_at`,
      [title, description, Math.round(value_cents), starts_at, ends_at, is_active, id]
    );

    if (!row) return res.status(404).json({ error: 'Mimo não encontrado.' });
    res.json({ mimo: row });
  } catch (err) {
    console.error('Erro ao atualizar mimo:', err);
    res.status(500).json({ error: 'Erro interno ao atualizar mimo.' });
  }
});

app.delete('/api/mimos/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'ID inválido.' });

    await db.run(`DELETE FROM mimos WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao excluir mimo:', err);
    res.status(500).json({ error: 'Erro interno ao excluir mimo.' });
  }
});



/* =========================
   OPENING HOURS (horário de funcionamento)
========================= */

app.get('/api/opening-hours', async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT dow, is_closed, open_time, close_time, max_per_half_hour, updated_at
       FROM opening_hours
       ORDER BY dow`
    );
    res.json({ opening_hours: rows });
  } catch (err) {
    console.error('Erro ao listar opening_hours:', err);
    res.status(500).json({ error: 'Erro interno ao buscar horários de funcionamento.' });
  }
});

// Atualização em lote (envia 7 linhas)
app.put('/api/opening-hours', async (req, res) => {
  try {
    const items = Array.isArray(req.body.opening_hours) ? req.body.opening_hours : [];
    if (!items.length) return res.status(400).json({ error: 'Envie opening_hours como array.' });

    // validação leve
    const byDow = new Map();
    for (const it of items) {
      const dow = Number(it.dow);
      if (![0,1,2,3,4,5,6].includes(dow)) continue;

      const is_closed = !!it.is_closed;
      let open_time = it.open_time != null ? String(it.open_time).trim() : null;
      let close_time = it.close_time != null ? String(it.close_time).trim() : null;
      let max_per_half_hour = it.max_per_half_hour != null ? Number(it.max_per_half_hour) : 1;

      if (!Number.isFinite(max_per_half_hour) || max_per_half_hour < 0) max_per_half_hour = 0;

      if (is_closed) {
        open_time = null;
        close_time = null;
        if (max_per_half_hour !== 0) max_per_half_hour = 0;
      } else {
        // formato HH:MM básico
        const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
        if (!hhmm.test(open_time || '')) open_time = '07:30';
        if (!hhmm.test(close_time || '')) close_time = '17:30';
        if (max_per_half_hour === 0) max_per_half_hour = 1;
      }

      byDow.set(dow, { dow, is_closed, open_time, close_time, max_per_half_hour });
    }

    // garante todos os dias (se vier incompleto, mantém os atuais)
    const existing = await db.all(`SELECT dow, is_closed, open_time, close_time, max_per_half_hour FROM opening_hours;`);
    const existingMap = new Map(existing.map(r => [Number(r.dow), r]));

    const finalRows = [];
    for (const dow of [0,1,2,3,4,5,6]) {
      const v = byDow.get(dow) || existingMap.get(dow) || { dow, is_closed: true, open_time: null, close_time: null, max_per_half_hour: 0 };
      finalRows.push(v);
    }

    for (const r of finalRows) {
      await db.query(
        `INSERT INTO opening_hours (dow, is_closed, open_time, close_time, max_per_half_hour, updated_at)
         VALUES ($1,$2,$3,$4,$5,NOW())
         ON CONFLICT (dow)
         DO UPDATE SET
           is_closed = EXCLUDED.is_closed,
           open_time = EXCLUDED.open_time,
           close_time = EXCLUDED.close_time,
           max_per_half_hour = EXCLUDED.max_per_half_hour,
           updated_at = NOW();`,
        [r.dow, r.is_closed, r.open_time, r.close_time, r.max_per_half_hour]
      );
    }

    const rows = await db.all(
      `SELECT dow, is_closed, open_time, close_time, max_per_half_hour, updated_at
       FROM opening_hours
       ORDER BY dow`
    );
    res.json({ opening_hours: rows });
  } catch (err) {
    console.error('Erro ao atualizar opening_hours:', err);
    res.status(500).json({ error: 'Erro interno ao salvar horários de funcionamento.' });
  }
});

/* =========================
   MIMOS (roleta) - CRUD
========================= */

app.get('/api/mimos', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const rows = await db.all(
      `SELECT id, title, description, value_cents, starts_at, ends_at, is_active, created_at, updated_at
       FROM mimos
       WHERE ($1 = '' OR LOWER(title) LIKE $2 OR LOWER(description) LIKE $2)
       ORDER BY is_active DESC, COALESCE(starts_at, '1970-01-01') DESC, id DESC`,
      [q, q ? `%${q}%` : '']
    );
    res.json({ mimos: rows });
  } catch (err) {
    console.error('Erro ao listar mimos:', err);
    res.status(500).json({ error: 'Erro interno ao buscar mimos.' });
  }
});

app.post('/api/mimos', async (req, res) => {
  try {
    const title = String(req.body.title || '').trim();
    const description = req.body.description != null ? String(req.body.description) : '';
    const value_cents = Number(req.body.value_cents || 0) || 0;
    const starts_at = req.body.starts_at ? String(req.body.starts_at) : null;
    const ends_at = req.body.ends_at ? String(req.body.ends_at) : null;
    const is_active = req.body.is_active === false ? false : true;

    if (!title) return res.status(400).json({ error: 'title é obrigatório.' });
    if (ends_at && starts_at && new Date(ends_at) < new Date(starts_at)) {
      return res.status(400).json({ error: 'ends_at não pode ser menor que starts_at.' });
    }

    const row = await db.get(
      `INSERT INTO mimos (title, description, value_cents, starts_at, ends_at, is_active)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [title, description, value_cents, starts_at, ends_at, is_active]
    );
    res.json({ mimo: row });
  } catch (err) {
    console.error('Erro ao criar mimo:', err);
    res.status(500).json({ error: 'Erro interno ao criar mimo.' });
  }
});

app.put('/api/mimos/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    const title = String(req.body.title || '').trim();
    const description = req.body.description != null ? String(req.body.description) : '';
    const value_cents = Number(req.body.value_cents || 0) || 0;
    const starts_at = req.body.starts_at ? String(req.body.starts_at) : null;
    const ends_at = req.body.ends_at ? String(req.body.ends_at) : null;
    const is_active = req.body.is_active === false ? false : true;

    if (!title) return res.status(400).json({ error: 'title é obrigatório.' });
    if (ends_at && starts_at && new Date(ends_at) < new Date(starts_at)) {
      return res.status(400).json({ error: 'ends_at não pode ser menor que starts_at.' });
    }

    const row = await db.get(
      `UPDATE mimos
       SET title=$1, description=$2, value_cents=$3, starts_at=$4, ends_at=$5, is_active=$6, updated_at=NOW()
       WHERE id=$7
       RETURNING *`,
      [title, description, value_cents, starts_at, ends_at, is_active, id]
    );

    if (!row) return res.status(404).json({ error: 'Mimo não encontrado.' });
    res.json({ mimo: row });
  } catch (err) {
    console.error('Erro ao atualizar mimo:', err);
    res.status(500).json({ error: 'Erro interno ao atualizar mimo.' });
  }
});

app.delete('/api/mimos/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    await db.run(`DELETE FROM mimos WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao deletar mimo:', err);
    res.status(500).json({ error: 'Erro interno ao excluir mimo.' });
  }
});


/* =========================
   START
========================= */
const port = process.env.PORT || 3000;

(async () => {        
  try {
    await db.initDb();
    app.listen(port, () => console.log('PetFunny API rodando na porta', port));
  } catch (e) {
    console.error('Erro fatal ao inicializar banco:', e);
    process.exit(1);
  }
})();
