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

app.get(['/', '/index', '/index.html'], (req, res) => {
  return res.sendFile(path.join(__dirname, 'index.html'));
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

    const pets = await db.all('SELECT * FROM pets WHERE customer_id = $1 ORDER BY name', [row.id]);
    res.json({ exists: true, customer: row, pets });
  } catch (err) {
    console.error('Erro em lookup customers:', err);
    res.status(500).json({ error: 'Erro interno ao buscar cliente.' });
  }
});

// Create customer
app.post('/api/customers', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const phone = sanitizePhone(req.body.phone);
    const email = String(req.body.email || '').trim() || null;
    const cpf = db.normalizeCPF(req.body.cpf) || null;
    const address = String(req.body.address || '').trim() || null;
    const notes = String(req.body.notes || '').trim() || null;

    if (!name || !phone) {
      return res.status(400).json({ error: 'Nome e telefone são obrigatórios.' });
    }

    // evita duplicado por telefone
    const existing = await db.get('SELECT id FROM customers WHERE phone = $1', [phone]);
    if (existing) {
      return res.status(409).json({ error: 'Já existe um cliente com este telefone.' });
    }

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

// Update customer
app.put('/api/customers/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const name = String(req.body.name || '').trim();
    const phone = sanitizePhone(req.body.phone);
    const email = String(req.body.email || '').trim() || null;
    const cpf = db.normalizeCPF(req.body.cpf) || null;
    const address = String(req.body.address || '').trim() || null;
    const notes = String(req.body.notes || '').trim() || null;

    if (!id || !name || !phone) {
      return res.status(400).json({ error: 'ID, nome e telefone são obrigatórios.' });
    }

    // se telefone alterou, checa duplicidade
    const dup = await db.get('SELECT id FROM customers WHERE phone = $1 AND id <> $2', [phone, id]);
    if (dup) return res.status(409).json({ error: 'Outro cliente já usa este telefone.' });

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

// Delete customer
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

// List pets (optional by customer_id)
app.get('/api/pets', async (req, res) => {
  try {
    const customer_id = req.query.customer_id ? Number(req.query.customer_id) : null;

    let sql = `SELECT * FROM pets WHERE 1=1`;
    const params = [];
    if (customer_id) {
      params.push(customer_id);
      sql += ` AND customer_id = $${params.length}`;
    }
    sql += ` ORDER BY name`;

    const rows = await db.all(sql, params);
    res.json({ pets: rows });
  } catch (err) {
    console.error('Erro ao listar pets:', err);
    res.status(500).json({ error: 'Erro interno ao buscar pets.' });
  }
});

// Create pet
app.post('/api/pets', async (req, res) => {
  try {
    const customer_id = Number(req.body.customer_id);
    const name = String(req.body.name || '').trim();
    const species = String(req.body.species || 'dog').trim();
    const breed = String(req.body.breed || '').trim() || null;
    const size = String(req.body.size || '').trim() || null;
    const coat = String(req.body.coat || '').trim() || null;
    const notes = String(req.body.notes || '').trim() || null;

    if (!customer_id || !name) {
      return res.status(400).json({ error: 'customer_id e name são obrigatórios.' });
    }

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

// Update pet
app.put('/api/pets/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const customer_id = Number(req.body.customer_id);
    const name = String(req.body.name || '').trim();
    const species = String(req.body.species || 'dog').trim();
    const breed = String(req.body.breed || '').trim() || null;
    const size = String(req.body.size || '').trim() || null;
    const coat = String(req.body.coat || '').trim() || null;
    const notes = String(req.body.notes || '').trim() || null;

    if (!id || !customer_id || !name) {
      return res.status(400).json({ error: 'id, customer_id e name são obrigatórios.' });
    }

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

// Delete pet
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
   SERVICES
========================= */

app.get('/api/services', async (req, res) => {
  try {
    const active = String(req.query.active || '').trim(); // "1" => apenas ativos
    let sql = `SELECT * FROM services WHERE 1=1`;
    const params = [];
    if (active === '1') sql += ` AND is_active = TRUE`;
    sql += ` ORDER BY date DESC, id DESC`;

    const rows = await db.all(sql, params);
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
    console.error('Erro ao deletar service:', err);
    res.status(500).json({ error: 'Erro interno ao excluir serviço.' });
  }
});

/* =========================
   BOOKINGS
========================= */

app.get('/api/bookings', async (req, res) => {
  try {
    const date = String(req.query.date || '').slice(0, 10);
    const search = String(req.query.search || '').trim();

    // Join para trazer nome do tutor e nome do pet (opcional)
    let sql = `
      SELECT
        b.*,
        c.name AS customer_name,
        c.phone AS phone,
        p.name AS pet_name
      FROM bookings b
      JOIN customers c ON c.id = b.customer_id
      LEFT JOIN pets p ON p.id = b.pet_id
      WHERE 1=1
    `;
    const params = [];

    if (date) {
      params.push(date);
      sql += ` AND b.date = $${params.length}`;
    }

    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      sql += `
        AND (
          LOWER(c.name) LIKE $${params.length}
          OR c.phone LIKE $${params.length}
          OR LOWER(COALESCE(p.name,'')) LIKE $${params.length}
          OR LOWER(COALESCE(b.service,'')) LIKE $${params.length}
        )
      `;
    }

    sql += ` ORDER BY b.date DESC, b.time ASC, b.id DESC`;

    const rows = await db.all(sql, params);
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
    const service = String(req.body.service || '').trim() || null;
    const prize = String(req.body.prize || '').trim() || '';
    const notes = String(req.body.notes || '').trim() || null;
    const status = String(req.body.status || 'agendado').trim() || 'agendado';

    if (!customer_id || !date || !time) {
      return res.status(400).json({ error: 'customer_id, date e time são obrigatórios.' });
    }

    const slot = await validateBookingSlot({ date, time });
    if (!slot.ok) return res.status(400).json({ error: slot.error });

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
    const service = String(req.body.service || '').trim() || null;
    const prize = String(req.body.prize || '').trim() || '';
    const notes = String(req.body.notes || '').trim() || null;
    const status = String(req.body.status || 'agendado').trim() || 'agendado';

    if (!id || !customer_id || !date || !time) {
      return res.status(400).json({ error: 'id, customer_id, date e time são obrigatórios.' });
    }

    const slot = await validateBookingSlot({ date, time, excludeBookingId: id });
    if (!slot.ok) return res.status(400).json({ error: slot.error });

    const row = await db.get(
      `
      UPDATE bookings
      SET customer_id=$2, pet_id=$3, service_id=$4, date=$5, time=$6, service=$7, prize=$8, notes=$9, status=$10
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

    if (!title) return res.status(400).json({ error: 'title é obrigatório.' });
    if (!Number.isFinite(value_cents)) return res.status(400).json({ error: 'value_cents inválido.' });

    const row = await db.get(
      `
      INSERT INTO mimos (title, description, value_cents, starts_at, ends_at, is_active, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,NOW())
      RETURNING *
      `,
      [title, description, value_cents, starts_at, ends_at, is_active]
    );

    res.json({ mimo: row });
  } catch (err) {
    console.error('Erro ao criar mimo:', err);
    res.status(500).json({ error: 'Erro interno ao salvar mimo.' });
  }
});

app.put('/api/mimos/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();
    const value_cents = Number(req.body.value_cents ?? 0);
    const starts_at = req.body.starts_at ? String(req.body.starts_at) : null;
    const ends_at = req.body.ends_at ? String(req.body.ends_at) : null;
    const is_active = req.body.is_active === false ? false : true;

    if (!id || !title) return res.status(400).json({ error: 'id e title são obrigatórios.' });
    if (!Number.isFinite(value_cents)) return res.status(400).json({ error: 'value_cents inválido.' });

    const row = await db.get(
      `
      UPDATE mimos
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
