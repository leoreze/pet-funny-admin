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



// Converte YYYY-MM-DD para weekday local (evita bug de timezone do Date('YYYY-MM-DD') que é interpretado como UTC)
function weekdayFromISO(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return null;
  const [y, m, d] = parts;
  const dt = new Date(y, m - 1, d); // local time
  return dt.getDay();
}
/* =========================
   HELPERS
========================= */
function sanitizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function timeToMinutes(hhmm) {
  // Aceita HH:MM e HH:MM:SS (Postgres TIME costuma vir como HH:MM:SS)
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d+)?)?$/.exec(String(hhmm || '').trim());
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
  SELECT
    b.*,
    c.name AS customer_name,
    c.phone AS phone,
    p.name AS pet_name,
    COALESCE(bs.services_json,
      CASE WHEN s1.id IS NOT NULL
        THEN json_build_array(json_build_object('id', s1.id, 'name', s1.name, 'value_cents', s1.value_cents))
        ELSE NULL
      END
    ) AS services_json,
    COALESCE(bs.total_value_cents, s1.value_cents, 0)::int AS total_value_cents,
    COALESCE(bs.services_label, b.service, s1.name, '') AS services_label
  FROM bookings b
  JOIN customers c ON c.id = b.customer_id
  LEFT JOIN pets p ON p.id = b.pet_id
  LEFT JOIN services s1 ON s1.id = b.service_id
  LEFT JOIN LATERAL (
    SELECT
      json_agg(
        json_build_object('id', s.id, 'name', s.name, 'value_cents', s.value_cents)
        ORDER BY s.name
      ) AS services_json,
      COALESCE(SUM(s.value_cents), 0)::int AS total_value_cents,
      string_agg(s.name, ' + ' ORDER BY s.name) AS services_label
    FROM booking_services bsv
    JOIN services s ON s.id = bsv.service_id
    WHERE bsv.booking_id = b.id
  ) bs ON TRUE
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
    const customer_id = parseInt(req.body.customer_id, 10);
    const pet_id = req.body.pet_id ? parseInt(req.body.pet_id, 10) : null;

    const date = String(req.body.date || '').trim();   // YYYY-MM-DD
    const time = String(req.body.time || '').trim();   // HH:MM

    // prize pode ser nulo (Sem mimo)
    let prize = typeof req.body.prize === 'string' ? req.body.prize.trim() : '';
    if (!prize || prize.toLowerCase() === 'sem mimo') prize = null;

    // Multi-serviços: aceita service_ids[]; mantém compatibilidade com service_id
    let serviceIds = Array.isArray(req.body.service_ids)
      ? req.body.service_ids.map((v) => parseInt(v, 10)).filter(Boolean)
      : [];
    if (!serviceIds.length && req.body.service_id) {
      const sid = parseInt(req.body.service_id, 10);
      if (sid) serviceIds = [sid];
    }

    if (!customer_id || !date || !time || !serviceIds.length) {
      return res.status(400).json({ error: 'Campos obrigatórios: cliente, data, horário e pelo menos 1 serviço.' });
    }

    // Respeita capacidade por slot (conforme Horário de Funcionamento)
    const slotOk = await validateBookingSlot(date, time, null);
    if (!slotOk.ok) return res.status(400).json({ error: slotOk.error });

    // Busca nomes/valores dos serviços para compor label e total
    const svcRows = await db.all(
      `SELECT id, name, value_cents
       FROM services
       WHERE id = ANY($1::int[])
       ORDER BY name`,
      [serviceIds]
    );

    if (!svcRows.length) {
      return res.status(400).json({ error: 'Serviço(s) inválido(s).' });
    }

    const services_label = svcRows.map((s) => s.name).join(' + ');
    const first_service_id = svcRows[0].id;

    const row = await db.get(
      `INSERT INTO bookings (customer_id, pet_id, service_id, service, date, time, prize, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'scheduled', NOW())
       RETURNING *`,
      [customer_id, pet_id, first_service_id, services_label, date, time, prize]
    );

    // vincula serviços
    for (const s of svcRows) {
      await db.run(
        `INSERT INTO booking_services (booking_id, service_id)
         VALUES ($1,$2)
         ON CONFLICT DO NOTHING`,
        [row.id, s.id]
      );
    }

    res.json({ booking: row });
  } catch (err) {
    console.error('Erro ao criar booking:', err);
    res.status(500).json({ error: 'Erro interno ao salvar agendamento.' });
  }
});
app.put('/api/bookings/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const customer_id = parseInt(req.body.customer_id, 10);
    const pet_id = req.body.pet_id ? parseInt(req.body.pet_id, 10) : null;

    const date = String(req.body.date || '').trim();
    const time = String(req.body.time || '').trim();

    let prize = typeof req.body.prize === 'string' ? req.body.prize.trim() : '';
    if (!prize || prize.toLowerCase() === 'sem mimo') prize = null;

    let serviceIds = Array.isArray(req.body.service_ids)
      ? req.body.service_ids.map((v) => parseInt(v, 10)).filter(Boolean)
      : [];
    if (!serviceIds.length && req.body.service_id) {
      const sid = parseInt(req.body.service_id, 10);
      if (sid) serviceIds = [sid];
    }

    if (!id || !customer_id || !date || !time || !serviceIds.length) {
      return res.status(400).json({ error: 'Campos obrigatórios: cliente, data, horário e pelo menos 1 serviço.' });
    }

    // capacidade por slot (ignora o próprio agendamento ao validar)
    const slotOk = await validateBookingSlot(date, time, id);
    if (!slotOk.ok) return res.status(400).json({ error: slotOk.error });

    const svcRows = await db.all(
      `SELECT id, name, value_cents
       FROM services
       WHERE id = ANY($1::int[])
       ORDER BY name`,
      [serviceIds]
    );

    if (!svcRows.length) {
      return res.status(400).json({ error: 'Serviço(s) inválido(s).' });
    }

    const services_label = svcRows.map((s) => s.name).join(' + ');
    const first_service_id = svcRows[0].id;

    const row = await db.get(
      `UPDATE bookings
       SET customer_id=$1, pet_id=$2, service_id=$3, service=$4, date=$5, time=$6, prize=$7
       WHERE id=$8
       RETURNING *`,
      [customer_id, pet_id, first_service_id, services_label, date, time, prize, id]
    );

    // atualiza vínculo de serviços
    await db.run(`DELETE FROM booking_services WHERE booking_id=$1`, [id]);
    for (const s of svcRows) {
      await db.run(
        `INSERT INTO booking_services (booking_id, service_id)
         VALUES ($1,$2)
         ON CONFLICT DO NOTHING`,
        [id, s.id]
      );
    }

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
