// backend/server.js
'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');
const db = require('./db'); // PostgreSQL

const app = express();

/* =========================
   MIDDLEWARES
========================= */

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Static files (admin.html, index.html, assets)
app.use(express.static(__dirname));

/* =========================
   HELPERS
========================= */

function sanitizePhone(phone) {
  return String(phone || '').replace(/\D/g, '').trim();
}

function isValidISODate(dateStr) {
  if (!dateStr) return false;
  // aceita YYYY-MM-DD
  return /^\d{4}-\d{2}-\d{2}$/.test(String(dateStr).trim());
}

function isValidTimeHHMM(timeStr) {
  if (!timeStr) return false;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(timeStr).trim());
}

/* =========================
   HEALTH
========================= */

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

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
    if (!phone) return res.status(400).json({ error: 'Telefone obrigatório.' });

    const row = await db.get(`SELECT * FROM customers WHERE phone=$1`, [phone]);
    res.json({ customer: row || null });
  } catch (err) {
    console.error('Erro em lookup customers:', err);
    res.status(500).json({ error: 'Erro interno ao buscar cliente.' });
  }
});

// Criar/atualizar cliente pelo telefone (UPSERT)
app.post('/api/customers', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const phone = sanitizePhone(req.body.phone);
    const notes = String(req.body.notes || '').trim();

    if (!name) return res.status(400).json({ error: 'Nome obrigatório.' });
    if (!phone) return res.status(400).json({ error: 'Telefone obrigatório.' });

    const row = await db.get(
      `
      INSERT INTO customers (name, phone, notes, updated_at)
      VALUES ($1,$2,$3,NOW())
      ON CONFLICT (phone) DO UPDATE
        SET name=EXCLUDED.name,
            notes=EXCLUDED.notes,
            updated_at=NOW()
      RETURNING *
      `,
      [name, phone, notes]
    );

    res.json({ customer: row });
  } catch (err) {
    console.error('Erro ao salvar customer:', err);
    res.status(500).json({ error: 'Erro interno ao salvar cliente.' });
  }
});

/* =========================
   PETS
========================= */

app.get('/api/pets', async (req, res) => {
  try {
    const customer_id = Number(req.query.customer_id);
    if (!customer_id) return res.status(400).json({ error: 'customer_id obrigatório.' });

    const rows = await db.all(
      `SELECT * FROM pets WHERE customer_id=$1 ORDER BY name`,
      [customer_id]
    );
    res.json({ pets: rows });
  } catch (err) {
    console.error('Erro ao listar pets:', err);
    res.status(500).json({ error: 'Erro interno ao buscar pets.' });
  }
});

app.post('/api/pets', async (req, res) => {
  try {
    const customer_id = Number(req.body.customer_id);
    const name = String(req.body.name || '').trim();
    const breed = String(req.body.breed || '').trim();
    const size = String(req.body.size || '').trim();
    const coat = String(req.body.coat || '').trim();
    const notes = String(req.body.notes || '').trim();

    if (!customer_id) return res.status(400).json({ error: 'customer_id obrigatório.' });
    if (!name) return res.status(400).json({ error: 'Nome do pet obrigatório.' });

    const row = await db.get(
      `
      INSERT INTO pets (customer_id, name, breed, size, coat, notes, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,NOW())
      RETURNING *
      `,
      [customer_id, name, breed, size, coat, notes]
    );

    res.json({ pet: row });
  } catch (err) {
    console.error('Erro ao criar pet:', err);
    res.status(500).json({ error: 'Erro interno ao salvar pet.' });
  }
});

app.put('/api/pets/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    const name = String(req.body.name || '').trim();
    const breed = String(req.body.breed || '').trim();
    const size = String(req.body.size || '').trim();
    const coat = String(req.body.coat || '').trim();
    const notes = String(req.body.notes || '').trim();

    if (!name) return res.status(400).json({ error: 'Nome do pet obrigatório.' });

    const row = await db.get(
      `
      UPDATE pets
      SET name=$1, breed=$2, size=$3, coat=$4, notes=$5, updated_at=NOW()
      WHERE id=$6
      RETURNING *
      `,
      [name, breed, size, coat, notes, id]
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

    await db.run(`DELETE FROM pets WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao deletar pet:', err);
    res.status(500).json({ error: 'Erro interno ao excluir pet.' });
  }
});

/* =========================
   SERVIÇOS
========================= */

app.get('/api/services', async (req, res) => {
  try {
    const rows = await db.all(`SELECT * FROM services ORDER BY created_at DESC, id DESC`);
    res.json({ services: rows });
  } catch (err) {
    console.error('Erro ao listar services:', err);
    res.status(500).json({ error: 'Erro interno ao buscar serviços.' });
  }
});

app.post('/api/services', async (req, res) => {
  try {
    const title = String(req.body.title || '').trim();
    const value_cents = Number(req.body.value_cents ?? NaN);

    if (!title) return res.status(400).json({ error: 'Título obrigatório.' });
    if (!Number.isFinite(value_cents) || value_cents < 0) return res.status(400).json({ error: 'Valor inválido.' });

    const row = await db.get(
      `
      INSERT INTO services (title, value_cents, updated_at)
      VALUES ($1,$2,NOW())
      RETURNING *
      `,
      [title, Math.round(value_cents)]
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
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    const title = String(req.body.title || '').trim();
    const value_cents = Number(req.body.value_cents ?? NaN);

    if (!title) return res.status(400).json({ error: 'Título obrigatório.' });
    if (!Number.isFinite(value_cents) || value_cents < 0) return res.status(400).json({ error: 'Valor inválido.' });

    const row = await db.get(
      `
      UPDATE services
      SET title=$1, value_cents=$2, updated_at=NOW()
      WHERE id=$3
      RETURNING *
      `,
      [title, Math.round(value_cents), id]
    );

    if (!row) return res.status(404).json({ error: 'Serviço não encontrado.' });
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

    await db.run(`DELETE FROM services WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao deletar service:', err);
    res.status(500).json({ error: 'Erro interno ao excluir serviço.' });
  }
});

/* =========================
   BOOKINGS (AGENDAMENTOS)
========================= */

// Listar agendamentos (por data opcional)
app.get('/api/bookings', async (req, res) => {
  try {
    const date = req.query.date ? String(req.query.date).trim() : '';
    if (date && !isValidISODate(date)) {
      return res.status(400).json({ error: 'date inválido (use YYYY-MM-DD).' });
    }

    const params = [];
    let sql = `
      SELECT b.*,
             c.name AS customer_name, c.phone AS customer_phone,
             p.name AS pet_name, p.breed AS pet_breed, p.size AS pet_size, p.coat AS pet_coat
      FROM bookings b
      LEFT JOIN customers c ON c.id = b.customer_id
      LEFT JOIN pets p ON p.id = b.pet_id
      WHERE 1=1
    `;

    if (date) {
      params.push(date);
      sql += ` AND b.date = $${params.length}`;
    }

    sql += ` ORDER BY b.date DESC, b.time DESC, b.id DESC`;

    const rows = await db.all(sql, params);
    res.json({ bookings: rows });
  } catch (err) {
    console.error('Erro ao listar bookings:', err);
    res.status(500).json({ error: 'Erro interno ao buscar agendamentos.' });
  }
});

// Criar agendamento (cliente)
app.post('/api/bookings', async (req, res) => {
  try {
    const customer_id = Number(req.body.customer_id);
    const pet_id = Number(req.body.pet_id);
    const service = String(req.body.service || '').trim();
    const service_id = req.body.service_id != null ? Number(req.body.service_id) : null;

    const date = String(req.body.date || '').trim();
    const time = String(req.body.time || '').trim();

    const prize = String(req.body.prize || '').trim();
    const notes = String(req.body.notes || '').trim();

    if (!customer_id) return res.status(400).json({ error: 'customer_id obrigatório.' });
    if (!pet_id) return res.status(400).json({ error: 'pet_id obrigatório.' });
    if (!date || !isValidISODate(date)) return res.status(400).json({ error: 'date inválido (YYYY-MM-DD).' });
    if (!time || !isValidTimeHHMM(time)) return res.status(400).json({ error: 'time inválido (HH:MM).' });
    if (!service && !service_id) return res.status(400).json({ error: 'Informe service ou service_id.' });

    // Capacidade (meia em meia hora) via opening_hours
    const dow = new Date(date + 'T00:00:00').getDay();
    const oh = await db.get(
      `SELECT * FROM opening_hours WHERE dow=$1`,
      [dow]
    );

    if (oh && oh.is_closed) {
      return res.status(400).json({ error: 'Dia fechado para agendamentos.' });
    }

    // Se existir configuração, valida janela
    if (oh && oh.open_time && oh.close_time) {
      const t = time;
      if (t < oh.open_time || t >= oh.close_time) {
        return res.status(400).json({ error: 'Horário fora do funcionamento.' });
      }
    }

    // Capacidade por slot (date+time)
    const maxCap = (oh && oh.max_per_half_hour != null) ? Number(oh.max_per_half_hour) : null;
    if (maxCap != null && Number.isFinite(maxCap) && maxCap >= 0) {
      const countRow = await db.get(
        `SELECT COUNT(*)::int AS cnt FROM bookings WHERE date=$1 AND time=$2`,
        [date, time]
      );
      const cnt = countRow ? countRow.cnt : 0;
      if (cnt >= maxCap) {
        return res.status(400).json({ error: 'Capacidade esgotada para este horário.' });
      }
    }

    // Se service_id foi enviado, puxa title para manter compatibilidade com campos legacy
    let service_title = service;
    if (!service_title && service_id) {
      const svc = await db.get(`SELECT * FROM services WHERE id=$1`, [service_id]);
      service_title = svc ? svc.title : '';
    }

    const row = await db.get(
      `
      INSERT INTO bookings (customer_id, pet_id, service, service_id, date, time, prize, notes, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
      RETURNING *
      `,
      [customer_id, pet_id, service_title, service_id, date, time, prize, notes]
    );

    res.json({ booking: row });
  } catch (err) {
    console.error('Erro ao criar booking:', err);
    res.status(500).json({ error: 'Erro interno ao criar agendamento.' });
  }
});

// Atualizar agendamento (admin)
app.put('/api/bookings/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    const date = String(req.body.date || '').trim();
    const time = String(req.body.time || '').trim();
    const service = String(req.body.service || '').trim();
    const service_id = req.body.service_id != null ? Number(req.body.service_id) : null;

    const prize = String(req.body.prize || '').trim();
    const notes = String(req.body.notes || '').trim();

    if (!date || !isValidISODate(date)) return res.status(400).json({ error: 'date inválido (YYYY-MM-DD).' });
    if (!time || !isValidTimeHHMM(time)) return res.status(400).json({ error: 'time inválido (HH:MM).' });
    if (!service && !service_id) return res.status(400).json({ error: 'Informe service ou service_id.' });

    // capacidade (ignora o próprio id na contagem)
    const dow = new Date(date + 'T00:00:00').getDay();
    const oh = await db.get(`SELECT * FROM opening_hours WHERE dow=$1`, [dow]);

    if (oh && oh.is_closed) {
      return res.status(400).json({ error: 'Dia fechado para agendamentos.' });
    }

    if (oh && oh.open_time && oh.close_time) {
      if (time < oh.open_time || time >= oh.close_time) {
        return res.status(400).json({ error: 'Horário fora do funcionamento.' });
      }
    }

    const maxCap = (oh && oh.max_per_half_hour != null) ? Number(oh.max_per_half_hour) : null;
    if (maxCap != null && Number.isFinite(maxCap) && maxCap >= 0) {
      const countRow = await db.get(
        `SELECT COUNT(*)::int AS cnt FROM bookings WHERE date=$1 AND time=$2 AND id<>$3`,
        [date, time, id]
      );
      const cnt = countRow ? countRow.cnt : 0;
      if (cnt >= maxCap) {
        return res.status(400).json({ error: 'Capacidade esgotada para este horário.' });
      }
    }

    let service_title = service;
    if (!service_title && service_id) {
      const svc = await db.get(`SELECT * FROM services WHERE id=$1`, [service_id]);
      service_title = svc ? svc.title : '';
    }

    const row = await db.get(
      `
      UPDATE bookings
      SET date=$1, time=$2, service=$3, service_id=$4, prize=$5, notes=$6, updated_at=NOW()
      WHERE id=$7
      RETURNING *
      `,
      [date, time, service_title, service_id, prize, notes, id]
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
   BREEDS (dog_breeds)
========================= */

app.get('/api/breeds', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const active = String(req.query.active || '').trim();

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
    const size = String(req.body.size || '').trim();
    const coat = String(req.body.coat || '').trim();
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
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    const name = String(req.body.name || '').trim();
    const history = String(req.body.history || '').trim();
    const size = String(req.body.size || '').trim();
    const coat = String(req.body.coat || '').trim();
    const characteristics = String(req.body.characteristics || '').trim();
    const is_active = req.body.is_active === false ? false : true;

    if (!name || !size || !coat) {
      return res.status(400).json({ error: 'name, size e coat são obrigatórios.' });
    }

    const row = await db.get(
      `
      UPDATE dog_breeds
      SET name=$1, history=$2, size=$3, coat=$4, characteristics=$5, is_active=$6, updated_at=NOW()
      WHERE id=$7
      RETURNING *
      `,
      [name, history, size, coat, characteristics, is_active, id]
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

    await db.run(`DELETE FROM dog_breeds WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao deletar breed:', err);
    res.status(500).json({ error: 'Erro interno ao excluir raça.' });
  }
});

/* =========================
   OPENING HOURS
========================= */

app.get('/api/opening-hours', async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT dow, is_closed, open_time, close_time, max_per_half_hour, updated_at
      FROM opening_hours
      ORDER BY dow ASC
    `);
    res.json({ opening_hours: rows });
  } catch (err) {
    console.error('Erro ao buscar opening_hours:', err);
    res.status(500).json({ error: 'Erro interno ao buscar horários de funcionamento.' });
  }
});

app.put('/api/opening-hours', async (req, res) => {
  try {
    const list = Array.isArray(req.body.opening_hours) ? req.body.opening_hours : null;
    if (!list) return res.status(400).json({ error: 'opening_hours deve ser um array.' });

    // validação básica + upsert por dow
    for (const r of list) {
      const dow = Number(r.dow);
      const is_closed = !!r.is_closed;
      const open_time = r.open_time ? String(r.open_time).trim() : null;
      const close_time = r.close_time ? String(r.close_time).trim() : null;
      const max_per_half_hour = r.max_per_half_hour == null ? null : Number(r.max_per_half_hour);

      if (!Number.isFinite(dow) || dow < 0 || dow > 6) {
        return res.status(400).json({ error: 'dow inválido (0-6).' });
      }

      if (!is_closed) {
        if (!open_time || !isValidTimeHHMM(open_time)) {
          return res.status(400).json({ error: `open_time inválido no dow=${dow}.` });
        }
        if (!close_time || !isValidTimeHHMM(close_time)) {
          return res.status(400).json({ error: `close_time inválido no dow=${dow}.` });
        }
        if (close_time <= open_time) {
          return res.status(400).json({ error: `close_time deve ser maior que open_time no dow=${dow}.` });
        }
      }

      if (max_per_half_hour != null) {
        if (!Number.isFinite(max_per_half_hour) || max_per_half_hour < 0 || max_per_half_hour > 99) {
          return res.status(400).json({ error: `max_per_half_hour inválido no dow=${dow}.` });
        }
      }

      await db.run(
        `
        INSERT INTO opening_hours (dow, is_closed, open_time, close_time, max_per_half_hour, updated_at)
        VALUES ($1,$2,$3,$4,$5,NOW())
        ON CONFLICT (dow) DO UPDATE SET
          is_closed=EXCLUDED.is_closed,
          open_time=EXCLUDED.open_time,
          close_time=EXCLUDED.close_time,
          max_per_half_hour=EXCLUDED.max_per_half_hour,
          updated_at=NOW()
        `,
        [dow, is_closed, open_time, close_time, max_per_half_hour]
      );
    }

    const rows = await db.all(`
      SELECT dow, is_closed, open_time, close_time, max_per_half_hour, updated_at
      FROM opening_hours
      ORDER BY dow ASC
    `);

    res.json({ opening_hours: rows });
  } catch (err) {
    console.error('Erro ao atualizar opening_hours:', err);
    res.status(500).json({ error: 'Erro interno ao salvar horários de funcionamento.' });
  }
});

/* =========================
   MIMOS (ROULETA) - ÚNICO CRUD/GET
========================= */

app.get('/api/mimos', async (req, res) => {
  try {
    const onlyActive = String(req.query.active || '').trim() === '1';
    const q = String(req.query.q || '').trim().toLowerCase();
    const at = req.query.at ? String(req.query.at) : null; // ISO opcional

    const params = [];
    let sql = `
      SELECT id, title, description, value_cents, starts_at, ends_at, is_active, created_at, updated_at
      FROM mimos
      WHERE 1=1
    `;

    if (q) {
      params.push(`%${q}%`);
      sql += ` AND (LOWER(title) LIKE $${params.length} OR LOWER(description) LIKE $${params.length})`;
    }

    if (onlyActive) {
      sql += ` AND is_active = TRUE
               AND (starts_at IS NULL OR starts_at <= COALESCE($${params.length + 1}::timestamptz, NOW()))
               AND (ends_at   IS NULL OR ends_at   >= COALESCE($${params.length + 1}::timestamptz, NOW()))`;
      params.push(at);
    }

    sql += ` ORDER BY is_active DESC, COALESCE(starts_at, NOW()) DESC, id DESC`;

    const rows = await db.all(sql, params);
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
    const value_cents = Number(req.body.value_cents ?? NaN);
    const starts_at = req.body.starts_at ? String(req.body.starts_at) : null;
    const ends_at = req.body.ends_at ? String(req.body.ends_at) : null;
    const is_active = req.body.is_active === false ? false : true;

    if (!title) return res.status(400).json({ error: 'Informe o título.' });
    if (!Number.isFinite(value_cents) || value_cents < 0) return res.status(400).json({ error: 'Valor inválido.' });
    if (starts_at && ends_at && new Date(ends_at) < new Date(starts_at)) {
      return res.status(400).json({ error: 'ends_at não pode ser menor que starts_at.' });
    }

    const row = await db.get(
      `
      INSERT INTO mimos (title, description, value_cents, starts_at, ends_at, is_active, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,NOW())
      RETURNING id, title, description, value_cents, starts_at, ends_at, is_active, created_at, updated_at
      `,
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
    const value_cents = Number(req.body.value_cents ?? NaN);
    const starts_at = req.body.starts_at ? String(req.body.starts_at) : null;
    const ends_at = req.body.ends_at ? String(req.body.ends_at) : null;
    const is_active = req.body.is_active === false ? false : true;

    if (!title) return res.status(400).json({ error: 'Informe o título.' });
    if (!Number.isFinite(value_cents) || value_cents < 0) return res.status(400).json({ error: 'Valor inválido.' });
    if (starts_at && ends_at && new Date(ends_at) < new Date(starts_at)) {
      return res.status(400).json({ error: 'ends_at não pode ser menor que starts_at.' });
    }

    const row = await db.get(
      `
      UPDATE mimos
      SET title=$1, description=$2, value_cents=$3, starts_at=$4, ends_at=$5, is_active=$6, updated_at=NOW()
      WHERE id=$7
      RETURNING id, title, description, value_cents, starts_at, ends_at, is_active, created_at, updated_at
      `,
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
   FALLBACKS / ERROR HANDLING
========================= */

// 404 em /api sempre JSON (evita admin tentar parsear HTML)
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

// handler de erro final (garante JSON)
app.use((err, req, res, next) => {
  console.error('Erro não tratado:', err);
  if (req.path.startsWith('/api')) {
    return res.status(500).json({ error: 'Erro interno.' });
  }
  res.status(500).send('Erro interno.');
});

/* =========================
   BOOT
========================= */

const PORT = process.env.PORT || 3000;

(async () => {
  try {
    await db.initDb();
    app.listen(PORT, () => console.log('Servidor rodando na porta', PORT));
  } catch (err) {
    console.error('Falha ao iniciar servidor (initDb):', err);
    process.exit(1);
  }
})();
