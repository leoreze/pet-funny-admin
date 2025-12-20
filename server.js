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
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm || '').trim());
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

function getDowFromISODate(dateStr) {
  // dateStr: YYYY-MM-DD
  const d = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return null;
  // JS: 0=Sunday..6=Saturday => queremos 1=Mon..7=Sun
  const js = d.getDay();
  return js === 0 ? 7 : js;
}

function isHalfHourAligned(timeStr) {
  const mins = timeToMinutes(timeStr);
  return Number.isFinite(mins) && (mins % 30 === 0);
}

/**
 * Valida se um slot de agendamento está:
 * - dentro do horário de funcionamento do dia
 * - alinhado a cada 30 min
 * - respeita max_per_half_hour (capacidade por meia hora)
 */
async function validateBookingSlot({ date, time }) {
  const dow = getDowFromISODate(date);
  if (!dow) return { ok: false, error: 'Data inválida.' };

  const row = await db.get(
    `SELECT dow, is_closed, open_time, close_time, max_per_half_hour
     FROM opening_hours
     WHERE dow = $1`,
    [dow]
  );

  // Se não tiver config, assume fechado
  if (!row) return { ok: false, error: 'Horário de funcionamento não configurado.' };
  if (row.is_closed) return { ok: false, error: 'Dia fechado para agendamentos.' };

  if (!isHalfHourAligned(time)) {
    return { ok: false, error: 'Horário inválido. Use intervalos de 30 minutos (ex.: 07:30, 08:00, 08:30).' };
  }

  const openM = timeToMinutes(row.open_time);
  const closeM = timeToMinutes(row.close_time);
  const tM = timeToMinutes(time);

  if (!Number.isFinite(openM) || !Number.isFinite(closeM) || !Number.isFinite(tM)) {
    return { ok: false, error: 'Configuração de horário inválida.' };
  }

  // janela [open, close) — não permite iniciar no close
  if (tM < openM || tM >= closeM) {
    return { ok: false, error: `Fora do horário de funcionamento (${row.open_time}–${row.close_time}).` };
  }

  const cap = Number(row.max_per_half_hour ?? 1);
  if (cap <= 0) return { ok: false, error: 'Capacidade do dia está zerada (fechado para agendamentos).' };

  const cntRow = await db.get(
    `SELECT COUNT(*)::int AS cnt
     FROM bookings
     WHERE date = $1 AND time = $2 AND status <> 'cancelado'`,
    [date, time]
  );

  const cnt = cntRow?.cnt ?? 0;
  if (cnt >= cap) {
    return { ok: false, error: `Lotado para ${time}. Capacidade por meia hora atingida.` };
  }

  return { ok: true };
}

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
  try {
    const phone = sanitizePhone(req.body.phone);
    if (!phone) return res.status(400).json({ error: 'Telefone é obrigatório.' });

    const row = await db.get('SELECT * FROM customers WHERE phone = $1', [phone]);
    res.json({ customer: row });
  } catch (err) {
    console.error('Erro em lookup customers:', err);
    res.status(500).json({ error: 'Erro interno no lookup.' });
  }
});

// Criar/atualizar customer (upsert lógico por telefone)
app.post('/api/customers', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const phone = sanitizePhone(req.body.phone);
    const email = req.body.email ? String(req.body.email).trim() : null;
    const cpf = req.body.cpf ? String(req.body.cpf).replace(/\D/g, '') : null;
    const address = req.body.address ? String(req.body.address).trim() : null;
    const notes = req.body.notes ? String(req.body.notes).trim() : null;

    if (!name || !phone) {
      return res.status(400).json({ error: 'Nome e telefone são obrigatórios.' });
    }

    const existing = await db.get('SELECT id FROM customers WHERE phone = $1', [phone]);

    let row;
    if (existing) {
      row = await db.get(
        `UPDATE customers
         SET name=$1, email=$2, cpf=$3, address=$4, notes=$5, updated_at=NOW()
         WHERE phone=$6
         RETURNING *`,
        [name, email, cpf, address, notes, phone]
      );
    } else {
      row = await db.get(
        `INSERT INTO customers (name, phone, email, cpf, address, notes)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING *`,
        [name, phone, email, cpf, address, notes]
      );
    }

    res.json({ customer: row });
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
    console.error('Erro ao excluir cliente:', err);
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
      'SELECT * FROM pets WHERE customer_id = $1 ORDER BY id DESC',
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
    const customerId = Number(req.body.customer_id);
    const name = String(req.body.name || '').trim();

    // Compat: o front antigo pode enviar "info"; o schema atual usa "notes"
    const notesRaw = (req.body.notes ?? req.body.info);
    const notes = notesRaw != null && String(notesRaw).trim() !== '' ? String(notesRaw).trim() : null;

    const species = req.body.species ? String(req.body.species).trim().toLowerCase() : 'dog';
    const breed = req.body.breed ? String(req.body.breed).trim() : null;
    const size = req.body.size ? String(req.body.size).trim() : null;
    const coat = req.body.coat ? String(req.body.coat).trim() : null;

    if (!customerId || !name) {
      return res.status(400).json({ error: 'customer_id e name são obrigatórios.' });
    }

    const row = await db.get(
      `INSERT INTO pets (customer_id, name, species, breed, size, coat, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [customerId, name, species, breed, size, coat, notes]
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
    const name = String(req.body.name || '').trim();

    // Compat: o front antigo pode enviar "info"; o schema atual usa "notes"
    const notesRaw = (req.body.notes ?? req.body.info);
    const notes = notesRaw != null && String(notesRaw).trim() !== '' ? String(notesRaw).trim() : null;

    const species = req.body.species ? String(req.body.species).trim().toLowerCase() : 'dog';
    const breed = req.body.breed ? String(req.body.breed).trim() : null;
    const size = req.body.size ? String(req.body.size).trim() : null;
    const coat = req.body.coat ? String(req.body.coat).trim() : null;

    if (!id || !name) return res.status(400).json({ error: 'ID e name são obrigatórios.' });

    const row = await db.get(
      `UPDATE pets
       SET name=$2, species=$3, breed=$4, size=$5, coat=$6, notes=$7, updated_at=NOW()
       WHERE id=$1
       RETURNING *`,
      [id, name, species, breed, size, coat, notes]
    );

    if (!row) return res.status(404).json({ error: 'Pet não encontrado.' });
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

    await db.run('DELETE FROM pets WHERE id=$1', [id]);
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
    const rows = await db.all(
      `SELECT * FROM services
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
    const date = String(req.body.date || '').trim(); // YYYY-MM-DD
    const title = String(req.body.title || '').trim();
    const value_cents = Number(req.body.value_cents || 0);
    const is_active = req.body.is_active === false ? false : true;

    if (!date || !title) return res.status(400).json({ error: 'date e title são obrigatórios.' });
    if (!Number.isFinite(value_cents) || value_cents < 0) return res.status(400).json({ error: 'value_cents inválido.' });

    const row = await db.get(
      `INSERT INTO services (date, title, value_cents, is_active)
       VALUES ($1,$2,$3,$4)
       RETURNING *`,
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
    const date = String(req.body.date || '').trim();
    const title = String(req.body.title || '').trim();
    const value_cents = Number(req.body.value_cents || 0);
    const is_active = req.body.is_active === false ? false : true;

    if (!id || !date || !title) return res.status(400).json({ error: 'id, date e title são obrigatórios.' });
    if (!Number.isFinite(value_cents) || value_cents < 0) return res.status(400).json({ error: 'value_cents inválido.' });

    const row = await db.get(
      `UPDATE services
       SET date=$2, title=$3, value_cents=$4, is_active=$5, updated_at=NOW()
       WHERE id=$1
       RETURNING *`,
      [id, date, title, value_cents, is_active]
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
    await db.run('DELETE FROM services WHERE id=$1', [id]);
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
    const date = String(req.query.date || '').trim(); // opcional
    let sql = `
      SELECT b.*,
        c.name AS customer_name, c.phone AS customer_phone,
        p.name AS pet_name
      FROM bookings b
      LEFT JOIN customers c ON c.id = b.customer_id
      LEFT JOIN pets p ON p.id = b.pet_id
      WHERE 1=1
    `;
    const params = [];

    if (date) {
      params.push(date);
      sql += ` AND b.date = $${params.length}`;
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
    const pet_id = req.body.pet_id ? Number(req.body.pet_id) : null;
    const service_id = req.body.service_id ? Number(req.body.service_id) : null;
    const service = req.body.service ? String(req.body.service).trim() : null;

    const date = String(req.body.date || '').trim(); // YYYY-MM-DD
    const time = String(req.body.time || '').trim(); // HH:MM (30/30)
    const prize = String(req.body.prize || '').trim(); // mimo selecionado
    const notes = req.body.notes ? String(req.body.notes).trim() : null;
    const status = req.body.status ? String(req.body.status).trim() : 'agendado';
    const last_notification_at = req.body.last_notification_at ? req.body.last_notification_at : null;

    if (!customer_id || !date || !time || !prize) {
      return res.status(400).json({ error: 'customer_id, date, time e prize são obrigatórios.' });
    }

    // Horário de funcionamento + capacidade por meia hora (evita overbooking)
    const v = await validateBookingSlot({ date, time });
    if (!v.ok) return res.status(409).json({ error: v.error });

    const row = await db.get(
      `
      INSERT INTO bookings (customer_id, pet_id, service_id, service, date, time, prize, notes, status, last_notification_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
      `,
      [customer_id, pet_id, service_id, service, date, time, prize, notes, status, last_notification_at]
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
    const pet_id = req.body.pet_id ? Number(req.body.pet_id) : null;
    const service_id = req.body.service_id ? Number(req.body.service_id) : null;
    const service = req.body.service ? String(req.body.service).trim() : null;

    const date = String(req.body.date || '').trim();
    const time = String(req.body.time || '').trim();
    const prize = String(req.body.prize || '').trim();
    const notes = req.body.notes ? String(req.body.notes).trim() : null;
    const status = req.body.status ? String(req.body.status).trim() : 'agendado';
    const last_notification_at = req.body.last_notification_at ? req.body.last_notification_at : null;

    if (!id || !customer_id || !date || !time || !prize) {
      return res.status(400).json({ error: 'id, customer_id, date, time e prize são obrigatórios.' });
    }

    // Revalida slot se alterou data/hora (ou sempre, para segurança)
    const v = await validateBookingSlot({ date, time });
    if (!v.ok) return res.status(409).json({ error: v.error });

    const row = await db.get(
      `
      UPDATE bookings
      SET customer_id=$2, pet_id=$3, service_id=$4, service=$5, date=$6, time=$7, prize=$8, notes=$9, status=$10, last_notification_at=$11
      WHERE id=$1
      RETURNING *
      `,
      [id, customer_id, pet_id, service_id, service, date, time, prize, notes, status, last_notification_at]
    );

    if (!row) return res.status(404).json({ error: 'Agendamento não encontrado.' });
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
      sql += ` AND (LOWER(name) LIKE $${params.length} OR LOWER(COALESCE(notes,'')) LIKE $${params.length} OR LOWER(COALESCE(size,'')) LIKE $${params.length} OR LOWER(COALESCE(coat,'')) LIKE $${params.length})`;
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
    const size = String(req.body.size || '').trim(); // pequeno|medio|grande
    const coat = String(req.body.coat || '').trim(); // curta|media|longa

    // Compat: front pode enviar "characteristics"; schema usa "notes"
    const notesRaw = (req.body.notes ?? req.body.characteristics);
    const notes = notesRaw != null && String(notesRaw).trim() !== '' ? String(notesRaw).trim() : '';

    // history é JSONB (array de eventos); aceita string JSON, array, ou vazio
    const historyRaw = req.body.history;
    let history = [];
    if (Array.isArray(historyRaw)) {
      history = historyRaw;
    } else if (historyRaw && typeof historyRaw === 'object') {
      // se vier objeto, guarda como array com 1 item (evita quebrar)
      history = [historyRaw];
    } else if (typeof historyRaw === 'string' && historyRaw.trim() !== '') {
      try {
        const parsed = JSON.parse(historyRaw);
        history = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        history = [];
      }
    }

    const is_active = req.body.is_active === false ? false : true;

    if (!name || !size || !coat) {
      return res.status(400).json({ error: 'name, size e coat são obrigatórios.' });
    }

    const row = await db.get(
      `
      INSERT INTO dog_breeds (name, history, size, coat, notes, is_active, updated_at)
      VALUES ($1,$2::jsonb,$3,$4,$5,$6,NOW())
      RETURNING *
      `,
      [name, JSON.stringify(history), size, coat, notes, is_active]
    );

    res.json({ breed: row });
  } catch (err) {
    console.error('Erro ao criar breed:', err);
    res.status(500).json({ error: 'Erro interno ao salvar raça.' });
  }
});

app.put('/api/breeds/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const name = String(req.body.name || '').trim();
    const size = String(req.body.size || '').trim();
    const coat = String(req.body.coat || '').trim();

    // Compat: front pode enviar "characteristics"; schema usa "notes"
    const notesRaw = (req.body.notes ?? req.body.characteristics);
    const notes = notesRaw != null && String(notesRaw).trim() !== '' ? String(notesRaw).trim() : '';

    // history JSONB
    const historyRaw = req.body.history;
    let history = [];
    if (Array.isArray(historyRaw)) {
      history = historyRaw;
    } else if (historyRaw && typeof historyRaw === 'object') {
      history = [historyRaw];
    } else if (typeof historyRaw === 'string' && historyRaw.trim() !== '') {
      try {
        const parsed = JSON.parse(historyRaw);
        history = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        history = [];
      }
    }

    const is_active = req.body.is_active === false ? false : true;

    if (!id || !name || !size || !coat) {
      return res.status(400).json({ error: 'id, name, size e coat são obrigatórios.' });
    }

    const row = await db.get(
      `
      UPDATE dog_breeds
      SET name=$2, history=$3::jsonb, size=$4, coat=$5, notes=$6, is_active=$7, updated_at=NOW()
      WHERE id=$1
      RETURNING *
      `,
      [id, name, JSON.stringify(history), size, coat, notes, is_active]
    );

    if (!row) return res.status(404).json({ error: 'Raça não encontrada.' });
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

app.post('/api/opening-hours', async (req, res) => {
  try {
    const items = Array.isArray(req.body.opening_hours) ? req.body.opening_hours : null;
    if (!items) return res.status(400).json({ error: 'opening_hours deve ser um array.' });

    for (const it of items) {
      const dow = Number(it.dow);
      if (!dow || dow < 1 || dow > 7) continue;

      let is_closed = !!it.is_closed;
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

      await db.run(
        `
        INSERT INTO opening_hours (dow, is_closed, open_time, close_time, max_per_half_hour, updated_at)
        VALUES ($1,$2,$3,$4,$5,NOW())
        ON CONFLICT (dow)
        DO UPDATE SET
          is_closed=EXCLUDED.is_closed,
          open_time=EXCLUDED.open_time,
          close_time=EXCLUDED.close_time,
          max_per_half_hour=EXCLUDED.max_per_half_hour,
          updated_at=NOW()
        `,
        [dow, is_closed, open_time, close_time, max_per_half_hour]
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
    const description = String(req.body.description || '').trim();
    const value_cents = Number(req.body.value_cents || 0);
    const starts_at = req.body.starts_at ? String(req.body.starts_at).trim() : null;
    const ends_at = req.body.ends_at ? String(req.body.ends_at).trim() : null;
    const is_active = req.body.is_active === false ? false : true;

    if (!title) return res.status(400).json({ error: 'title é obrigatório.' });
    if (!Number.isFinite(value_cents) || value_cents < 0) return res.status(400).json({ error: 'value_cents inválido.' });
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
    res.status(500).json({ error: 'Erro interno ao salvar mimo.' });
  }
});

app.put('/api/mimos/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();
    const value_cents = Number(req.body.value_cents || 0);
    const starts_at = req.body.starts_at ? String(req.body.starts_at).trim() : null;
    const ends_at = req.body.ends_at ? String(req.body.ends_at).trim() : null;
    const is_active = req.body.is_active === false ? false : true;

    if (!id || !title) return res.status(400).json({ error: 'id e title são obrigatórios.' });
    if (!Number.isFinite(value_cents) || value_cents < 0) return res.status(400).json({ error: 'value_cents inválido.' });
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
