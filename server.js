// backend/server.js (UPDATED)
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

// Static files (admin.html, index.html, assets)
// Em alguns deploys (ex: server.js dentro de /backend), __dirname não é o mesmo diretório do admin.html.
// Então escolhemos automaticamente o diretório correto.
function resolveStaticRoot() {
  const candidates = [
    process.cwd(),
    __dirname,
    path.resolve(__dirname, '..'),
  ];

  for (const dir of candidates) {
    try {
      const adminPath = path.join(dir, 'admin.html');
      const indexPath = path.join(dir, 'index.html');
      if (fs.existsSync(adminPath) && fs.existsSync(indexPath)) return dir;
    } catch {
      // ignore
    }
  }
  // fallback
  return __dirname;
}

const STATIC_ROOT = resolveStaticRoot();
app.use(express.static(STATIC_ROOT));

// Rotas HTML explícitas
app.get(['/', '/index', '/index.html'], (req, res) => {
  return res.sendFile(path.join(STATIC_ROOT, 'index.html'));
});

// /admin e também /admin/* (para evitar "Cannot GET /admin" caso exista algum rewrite)
app.get(['/admin', '/admin/', /^\/admin\b.*$/], (req, res) => {
  return res.sendFile(path.join(STATIC_ROOT, 'admin.html'));
});

/* =========================
   HELPERS
========================= */
function sanitizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function timeToMinutes(hhmm) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm || '').trim());
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

function getDowFromISODate(dateStr) {
  // dateStr: YYYY-MM-DD (interpreta como meia-noite local)
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.getDay(); // 0=Dom.6=Sáb
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
  if (t < open || t >= close) {
    return { ok: false, error: 'Horário fora do funcionamento.' };
  }
  if ((t - open) % 30 !== 0) {
    return { ok: false, error: 'Horário deve ser em intervalos de 30 minutos.' };
  }

  const cap = Number(oh.max_per_half_hour);
  if (!Number.isFinite(cap) || cap <= 0) {
    return { ok: false, error: 'Capacidade do horário está zerada.' };
  }

  // Conta quantos agendamentos já existem nesse slot
  const params = [date, time];
  let whereExtra = '';
  if (excludeBookingId != null) {
    params.push(Number(excludeBookingId));
    whereExtra = ` AND id <> $3 `;
  }

  const row = await db.get(
    `SELECT COUNT(*)::int AS n
     FROM bookings
     WHERE date = $1 AND time = $2
       AND status <> 'cancelado'
       ${whereExtra}`,
    params
  );

  const used = row?.n || 0;
  if (used >= cap) {
    return { ok: false, error: 'Horário lotado. Escolha outro horário.' };
  }

  return { ok: true };
}

/* =========================
   CUSTOMERS
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
  try {
    const phoneRaw = req.body.phone || '';
    const phone = sanitizePhone(phoneRaw);
    if (!phone) return res.status(400).json({ error: 'Informe um telefone.' });

    // Compatibilidade: alguns cadastros podem ter "55" (DDI) gravado e outros não.
    // Tentamos múltiplas variações para aumentar a taxa de match sem quebrar o legado.
    const variants = new Set();
    variants.add(phone);

    // Se vier 11 dígitos (DDD+cel), tenta com DDI 55
    if (phone.length === 11) variants.add('55' + phone);

    // Se vier com 55 + 11 dígitos (13), tenta sem 55
    if (phone.length === 13 && phone.startsWith('55')) variants.add(phone.slice(2));

    const arr = Array.from(variants);
    const row = await db.get(
      `SELECT * FROM customers
       WHERE phone = ANY($1::text[])
       LIMIT 1`,
      [arr]
    );

    if (!row) return res.json({ exists: false, customer: null });
    res.json({ exists: true, customer: row });
  } catch (err) {
    console.error('Erro em lookup customers:', err);
    res.status(500).json({ error: 'Erro interno ao buscar cliente.' });
  }
});

// Criar cliente
app.post('/api/customers', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const phone = sanitizePhone(req.body.phone || '');
    const email = req.body.email ? String(req.body.email).trim() : null;
    const cpf = req.body.cpf ? String(req.body.cpf).trim() : null;
    const address = req.body.address ? String(req.body.address).trim() : null;
    const notes = req.body.notes ? String(req.body.notes) : null;

    if (!name || !phone) return res.status(400).json({ error: 'Nome e telefone são obrigatórios.' });

    const row = await db.get(
      `
      INSERT INTO customers (name, phone, email, cpf, address, notes, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,NOW())
      RETURNING *
      `,
      [name, phone, email, cpf, address, notes]
    );

    res.json({ customer: row });
  } catch (err) {
    console.error('Erro ao criar customer:', err);
    res.status(500).json({ error: 'Erro interno ao salvar cliente.' });
  }
});

// Atualizar cliente
app.put('/api/customers/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const name = String(req.body.name || '').trim();
    const phone = sanitizePhone(req.body.phone || '');
    const email = req.body.email ? String(req.body.email).trim() : null;
    const cpf = req.body.cpf ? String(req.body.cpf).trim() : null;
    const address = req.body.address ? String(req.body.address).trim() : null;
    const notes = req.body.notes ? String(req.body.notes) : null;

    if (!id || !name || !phone) return res.status(400).json({ error: 'ID, nome e telefone são obrigatórios.' });

    const row = await db.get(
      `
      UPDATE customers
      SET name=$2, phone=$3, email=$4, cpf=$5, address=$6, notes=$7, updated_at=NOW()
      WHERE id=$1
      RETURNING *
      `,
      [id, name, phone, email, cpf, address, notes]
    );

    res.json({ customer: row });
  } catch (err) {
    console.error('Erro ao atualizar customer:', err);
    res.status(500).json({ error: 'Erro interno ao atualizar cliente.' });
  }
});

// Deletar cliente
app.delete('/api/customers/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    await db.run(`DELETE FROM customers WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao excluir customer:', err);
    res.status(500).json({ error: 'Erro interno ao excluir cliente.' });
  }
});

/* =========================
   PETS
========================= */

// Listar pets
app.get('/api/pets', async (req, res) => {
  try {
    const customerId = req.query.customer_id ? Number(req.query.customer_id) : null;

    let sql = `
      SELECT p.*, c.name AS customer_name
      FROM pets p
      JOIN customers c ON c.id = p.customer_id
    `;
    const params = [];
    if (customerId) {
      params.push(customerId);
      sql += ` WHERE p.customer_id = $1 `;
    }
    sql += ` ORDER BY p.name `;

    const rows = await db.all(sql, params);
    res.json({ pets: rows });
  } catch (err) {
    console.error('Erro ao listar pets:', err);
    res.status(500).json({ error: 'Erro interno ao buscar pets.' });
  }
});

// Criar pet
app.post('/api/pets', async (req, res) => {
  try {
    const customer_id = Number(req.body.customer_id);
    const name = String(req.body.name || '').trim();
    const species = req.body.species ? String(req.body.species).trim() : 'dog';
    const breed = req.body.breed ? String(req.body.breed).trim() : null;
    const size = req.body.size ? String(req.body.size).trim() : null;
    const coat = req.body.coat ? String(req.body.coat).trim() : null;
    const notes = req.body.notes ? String(req.body.notes) : null;

    if (!customer_id || !name) return res.status(400).json({ error: 'customer_id e name são obrigatórios.' });

    const row = await db.get(
      `
      INSERT INTO pets (customer_id, name, species, breed, size, coat, notes, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
      RETURNING *
      `,
      [customer_id, name, species, breed, size, coat, notes]
    );

    res.json({ pet: row });
  } catch (err) {
    console.error('Erro ao criar pet:', err);
    res.status(500).json({ error: 'Erro interno ao salvar pet.' });
  }
});

// Atualizar pet
app.put('/api/pets/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const customer_id = Number(req.body.customer_id);
    const name = String(req.body.name || '').trim();
    const species = req.body.species ? String(req.body.species).trim() : 'dog';
    const breed = req.body.breed ? String(req.body.breed).trim() : null;
    const size = req.body.size ? String(req.body.size).trim() : null;
    const coat = req.body.coat ? String(req.body.coat).trim() : null;
    const notes = req.body.notes ? String(req.body.notes) : null;

    if (!id || !customer_id || !name) return res.status(400).json({ error: 'id, customer_id e name são obrigatórios.' });

    const row = await db.get(
      `
      UPDATE pets
      SET customer_id=$2, name=$3, species=$4, breed=$5, size=$6, coat=$7, notes=$8, updated_at=NOW()
      WHERE id=$1
      RETURNING *
      `,
      [id, customer_id, name, species, breed, size, coat, notes]
    );

    res.json({ pet: row });
  } catch (err) {
    console.error('Erro ao atualizar pet:', err);
    res.status(500).json({ error: 'Erro interno ao atualizar pet.' });
  }
});

// Deletar pet
app.delete('/api/pets/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    await db.run(`DELETE FROM pets WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao excluir pet:', err);
    res.status(500).json({ error: 'Erro interno ao excluir pet.' });
  }
});

/* =========================
   SERVICES
========================= */

app.get('/api/services', async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT id, date, title, value_cents, is_active, updated_at
       FROM services
       ORDER BY date DESC, id DESC`
    );
    res.json({ services: rows });
  } catch (err) {
    console.error('Erro ao listar services:', err);
    res.status(500).json({ error: 'Erro interno ao buscar serviços.' });
  }
});

app.post('/api/services', async (req, res) => {
  try {
    const date = String(req.body.date || '').slice(0, 10);
    const title = String(req.body.title || '').trim();
    const value_cents = Number(req.body.value_cents);
    const is_active = req.body.is_active === false ? false : true;

    if (!date || !title || !Number.isFinite(value_cents)) {
      return res.status(400).json({ error: 'date, title e value_cents são obrigatórios.' });
    }

    const row = await db.get(
      `
      INSERT INTO services (date, title, value_cents, is_active, updated_at)
      VALUES ($1,$2,$3,$4,NOW())
      RETURNING *
      `,
      [date, title, value_cents, is_active]
    );

    res.json({ service: row });
  } catch (err) {
    console.error('Erro ao criar service:', err);
    res.status(500).json({ error: 'Erro interno ao salvar serviço.' });
  }
});

app.put('/api/services/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const date = String(req.body.date || '').slice(0, 10);
    const title = String(req.body.title || '').trim();
    const value_cents = Number(req.body.value_cents);

    if (!id || !date || !title || !Number.isFinite(value_cents)) {
      return res.status(400).json({ error: 'id, date, title e value_cents são obrigatórios.' });
    }

    const row = await db.get(
      `
      UPDATE services
      SET date=$2, title=$3, value_cents=$4, updated_at=NOW()
      WHERE id=$1
      RETURNING *
      `,
      [id, date, title, value_cents]
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
    console.error('Erro ao excluir service:', err);
    res.status(500).json({ error: 'Erro interno ao excluir serviço.' });
  }
});

/* =========================
   BOOKINGS
========================= */

app.get('/api/bookings', async (req, res) => {
  try {
    const rows = await db.all(
      `
      SELECT b.*,
        c.name AS customer_name,
        c.phone AS customer_phone,
        p.name AS pet_name,
        s.title AS service_title,
        s.value_cents AS service_value_cents
      FROM bookings b
      LEFT JOIN customers c ON c.id = b.customer_id
      LEFT JOIN pets p ON p.id = b.pet_id
      LEFT JOIN services s ON s.id = b.service_id
      ORDER BY b.date DESC, b.time DESC, b.id DESC
      `
    );
    res.json({ bookings: rows });
  } catch (err) {
    console.error('Erro ao listar bookings:', err);
    res.status(500).json({ error: 'Erro interno ao buscar agendamentos.' });
  }
});

app.post('/api/bookings', async (req, res) => {
  try {
    const customer_id = Number(req.body.customer_id);
    const pet_id = req.body.pet_id != null ? Number(req.body.pet_id) : null;
    const service_id = req.body.service_id != null ? Number(req.body.service_id) : null;

    const date = String(req.body.date || '').slice(0, 10);
    const time = String(req.body.time || '').slice(0, 5);

    const service = req.body.service ? String(req.body.service) : null;
    const prize = req.body.prize ? String(req.body.prize) : '';
    const notes = req.body.notes ? String(req.body.notes) : null;
    const status = req.body.status ? String(req.body.status) : 'agendado';

    if (!customer_id || !date || !time) {
      return res.status(400).json({ error: 'customer_id, date e time são obrigatórios.' });
    }

    const v = await validateBookingSlot({ date, time });
    if (!v.ok) return res.status(400).json({ error: v.error });

    const row = await db.get(
      `
      INSERT INTO bookings (customer_id, pet_id, service_id, date, time, service, prize, notes, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
      `,
      [customer_id, pet_id, service_id, date, time, service, prize, notes, status]
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

    const date = String(req.body.date || '').slice(0, 10);
    const time = String(req.body.time || '').slice(0, 5);

    const service = req.body.service ? String(req.body.service) : null;
    const prize = req.body.prize ? String(req.body.prize) : '';
    const notes = req.body.notes ? String(req.body.notes) : null;
    const status = req.body.status ? String(req.body.status) : 'agendado';

    if (!id || !customer_id || !date || !time) {
      return res.status(400).json({ error: 'id, customer_id, date e time são obrigatórios.' });
    }

    const v = await validateBookingSlot({ date, time, excludeBookingId: id });
    if (!v.ok) return res.status(400).json({ error: v.error });

    const row = await db.get(
      `
      UPDATE bookings
      SET customer_id=$2, pet_id=$3, service_id=$4,
          date=$5, time=$6, service=$7, prize=$8, notes=$9, status=$10
      WHERE id=$1
      RETURNING *
      `,
      [id, customer_id, pet_id, service_id, date, time, service, prize, notes, status]
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

    await db.run(`DELETE FROM bookings WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao excluir booking:', err);
    res.status(500).json({ error: 'Erro interno ao excluir agendamento.' });
  }
});

/* =========================
   MIMOS (prêmios da roleta)
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
      if (![0, 1, 2, 3, 4, 5, 6].includes(dow)) continue;

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
    const existingMap = new Map(existing.map((r) => [Number(r.dow), r]));

    const finalRows = [];
    for (const dow of [0, 1, 2, 3, 4, 5, 6]) {
      const v =
        byDow.get(dow) ||
        existingMap.get(dow) ||
        { dow, is_closed: true, open_time: null, close_time: null, max_per_half_hour: 0 };
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
