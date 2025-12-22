// backend/server.js
const path = require('path');
const express = require('express');
const cors = require('cors');
const db = require('./db'); // PostgreSQL helpers + initDb

const app = express();
app.use(cors());
app.use(express.json());

// Static files (admin.html, index.html, assets)
app.use(express.static(__dirname));

/* =========================================================
   HELPERS
========================================================= */
function toInt(val, fallback = null) {
  const n = Number(val);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}
function sanitizeTimeHHMM(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  // Accept "HH:MM" only (24h)
  if (!/^\d{2}:\d{2}$/.test(s)) return null;
  const [hh, mm] = s.split(':').map(Number);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
}
function sanitizeDateYYYYMMDD(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}
function parseServicesPayload(payload) {
  // Accept:
  // - { service_id } legacy
  // - { service_ids: [1,2] }
  // - { services: [{service_id, qty}] }
  if (!payload || typeof payload !== 'object') return [];
  const out = [];
  if (Array.isArray(payload.services)) {
    for (const it of payload.services) {
      const sid = toInt(it?.service_id, null);
      if (!sid) continue;
      const qty = Math.max(1, toInt(it?.qty, 1) || 1);
      out.push({ service_id: sid, qty });
    }
  } else if (Array.isArray(payload.service_ids)) {
    for (const sidRaw of payload.service_ids) {
      const sid = toInt(sidRaw, null);
      if (sid) out.push({ service_id: sid, qty: 1 });
    }
  } else if (payload.service_id) {
    const sid = toInt(payload.service_id, null);
    if (sid) out.push({ service_id: sid, qty: 1 });
  }
  // de-dup by summing qty
  const map = new Map();
  for (const it of out) {
    map.set(it.service_id, (map.get(it.service_id) || 0) + it.qty);
  }
  return [...map.entries()].map(([service_id, qty]) => ({ service_id, qty }));
}

/* =========================================================
   CUSTOMERS
========================================================= */
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

app.post('/api/customers/lookup', async (req, res) => {
  try {
    const phone = (req.body?.phone || '').toString().trim();
    if (!phone) return res.status(400).json({ error: 'Telefone obrigatório.' });

    const customer = await db.get(`SELECT * FROM customers WHERE phone = $1`, [phone]);
    if (!customer) return res.json({ found: false });

    const pets = await db.all(`SELECT * FROM pets WHERE customer_id = $1 ORDER BY name`, [customer.id]);
    res.json({ found: true, customer, pets });
  } catch (err) {
    console.error('Erro em lookup customers:', err);
    res.status(500).json({ error: 'Erro interno ao buscar cliente.' });
  }
});

app.post('/api/customers', async (req, res) => {
  try {
    const name = (req.body?.name || '').toString().trim();
    const phone = (req.body?.phone || '').toString().trim();
    if (!name) return res.status(400).json({ error: 'Nome obrigatório.' });
    if (!phone) return res.status(400).json({ error: 'Telefone obrigatório.' });

    const row = await db.get(
      `INSERT INTO customers (name, phone) VALUES ($1,$2) RETURNING *`,
      [name, phone]
    );
    res.json({ customer: row });
  } catch (err) {
    console.error('Erro ao criar customer:', err);
    res.status(500).json({ error: 'Erro interno ao criar cliente.' });
  }
});

app.put('/api/customers/:id', async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    const name = (req.body?.name || '').toString().trim();
    const phone = (req.body?.phone || '').toString().trim();
    if (!name) return res.status(400).json({ error: 'Nome obrigatório.' });
    if (!phone) return res.status(400).json({ error: 'Telefone obrigatório.' });

    const row = await db.get(
      `UPDATE customers SET name=$1, phone=$2 WHERE id=$3 RETURNING *`,
      [name, phone, id]
    );
    res.json({ customer: row });
  } catch (err) {
    console.error('Erro ao atualizar customer:', err);
    res.status(500).json({ error: 'Erro interno ao atualizar cliente.' });
  }
});

app.delete('/api/customers/:id', async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });
    await db.run(`DELETE FROM customers WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao deletar customer:', err);
    res.status(500).json({ error: 'Erro interno ao deletar cliente.' });
  }
});

/* =========================================================
   PETS
========================================================= */
app.post('/api/pets', async (req, res) => {
  try {
    const customer_id = toInt(req.body?.customer_id, null);
    const name = (req.body?.name || '').toString().trim();
    const breed = (req.body?.breed || '').toString().trim();
    const size = (req.body?.size || '').toString().trim();

    if (!customer_id) return res.status(400).json({ error: 'Cliente obrigatório.' });
    if (!name) return res.status(400).json({ error: 'Nome do pet obrigatório.' });

    const pet = await db.get(
      `INSERT INTO pets (customer_id, name, breed, size)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [customer_id, name, breed, size]
    );
    res.json({ pet });
  } catch (err) {
    console.error('Erro ao criar pet:', err);
    res.status(500).json({ error: 'Erro interno ao criar pet.' });
  }
});

app.put('/api/pets/:id', async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    const name = (req.body?.name || '').toString().trim();
    const breed = (req.body?.breed || '').toString().trim();
    const size = (req.body?.size || '').toString().trim();
    if (!name) return res.status(400).json({ error: 'Nome do pet obrigatório.' });

    const pet = await db.get(
      `UPDATE pets SET name=$1, breed=$2, size=$3 WHERE id=$4 RETURNING *`,
      [name, breed, size, id]
    );
    res.json({ pet });
  } catch (err) {
    console.error('Erro ao atualizar pet:', err);
    res.status(500).json({ error: 'Erro interno ao atualizar pet.' });
  }
});

app.delete('/api/pets/:id', async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });
    await db.run(`DELETE FROM pets WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao deletar pet:', err);
    res.status(500).json({ error: 'Erro interno ao deletar pet.' });
  }
});

/* =========================================================
   BREEDS
========================================================= */
app.get('/api/breeds', async (req, res) => {
  try {
    const rows = await db.all(`SELECT * FROM breeds ORDER BY name`);
    res.json({ breeds: rows });
  } catch (err) {
    console.error('Erro ao listar raças:', err);
    res.status(500).json({ error: 'Erro interno ao buscar raças.' });
  }
});

app.post('/api/breeds', async (req, res) => {
  try {
    const name = (req.body?.name || '').toString().trim();
    if (!name) return res.status(400).json({ error: 'Nome obrigatório.' });
    const row = await db.get(`INSERT INTO breeds (name) VALUES ($1) RETURNING *`, [name]);
    res.json({ breed: row });
  } catch (err) {
    console.error('Erro ao criar raça:', err);
    res.status(500).json({ error: 'Erro interno ao criar raça.' });
  }
});

app.delete('/api/breeds/:id', async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });
    await db.run(`DELETE FROM breeds WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao deletar raça:', err);
    res.status(500).json({ error: 'Erro interno ao deletar raça.' });
  }
});

/* =========================================================
   SERVICES
========================================================= */
app.get('/api/services', async (req, res) => {
  try {
    const rows = await db.all(`SELECT * FROM services ORDER BY title`);
    res.json({ services: rows });
  } catch (err) {
    console.error('Erro ao listar services:', err);
    res.status(500).json({ error: 'Erro interno ao buscar serviços.' });
  }
});

app.post('/api/services', async (req, res) => {
  try {
    const title = (req.body?.title || '').toString().trim();
    const value_cents = toInt(req.body?.value_cents, null);
    if (!title) return res.status(400).json({ error: 'Título obrigatório.' });
    if (value_cents === null || value_cents < 0) return res.status(400).json({ error: 'Valor inválido.' });

    const row = await db.get(
      `INSERT INTO services (title, value_cents) VALUES ($1,$2) RETURNING *`,
      [title, value_cents]
    );
    res.json({ service: row });
  } catch (err) {
    console.error('Erro ao criar service:', err);
    res.status(500).json({ error: 'Erro interno ao criar serviço.' });
  }
});

app.put('/api/services/:id', async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    const title = (req.body?.title || '').toString().trim();
    const value_cents = toInt(req.body?.value_cents, null);
    if (!title) return res.status(400).json({ error: 'Título obrigatório.' });
    if (value_cents === null || value_cents < 0) return res.status(400).json({ error: 'Valor inválido.' });

    const row = await db.get(
      `UPDATE services SET title=$1, value_cents=$2 WHERE id=$3 RETURNING *`,
      [title, value_cents, id]
    );
    res.json({ service: row });
  } catch (err) {
    console.error('Erro ao atualizar service:', err);
    res.status(500).json({ error: 'Erro interno ao atualizar serviço.' });
  }
});

app.delete('/api/services/:id', async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });
    await db.run(`DELETE FROM services WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao deletar service:', err);
    res.status(500).json({ error: 'Erro interno ao deletar serviço.' });
  }
});

/* =========================================================
   MIMOS
========================================================= */
app.get('/api/mimos', async (req, res) => {
  try {
    const rows = await db.all(`SELECT * FROM mimos ORDER BY id DESC`);
    res.json({ mimos: rows });
  } catch (err) {
    console.error('Erro ao listar mimos:', err);
    res.status(500).json({ error: 'Erro interno ao buscar mimos.' });
  }
});

app.post('/api/mimos', async (req, res) => {
  try {
    const title = (req.body?.title || '').toString().trim();
    const start_date = sanitizeDateYYYYMMDD(req.body?.start_date || '');
    const end_date = sanitizeDateYYYYMMDD(req.body?.end_date || '');
    if (!title) return res.status(400).json({ error: 'Título obrigatório.' });

    const row = await db.get(
      `INSERT INTO mimos (title, start_date, end_date) VALUES ($1,$2,$3) RETURNING *`,
      [title, start_date, end_date]
    );
    res.json({ mimo: row });
  } catch (err) {
    console.error('Erro ao criar mimo:', err);
    res.status(500).json({ error: 'Erro interno ao criar mimo.' });
  }
});

app.put('/api/mimos/:id', async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    const title = (req.body?.title || '').toString().trim();
    const start_date = sanitizeDateYYYYMMDD(req.body?.start_date || '');
    const end_date = sanitizeDateYYYYMMDD(req.body?.end_date || '');
    if (!title) return res.status(400).json({ error: 'Título obrigatório.' });

    const row = await db.get(
      `UPDATE mimos SET title=$1, start_date=$2, end_date=$3 WHERE id=$4 RETURNING *`,
      [title, start_date, end_date, id]
    );
    res.json({ mimo: row });
  } catch (err) {
    console.error('Erro ao atualizar mimo:', err);
    res.status(500).json({ error: 'Erro interno ao atualizar mimo.' });
  }
});

app.delete('/api/mimos/:id', async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });
    await db.run(`DELETE FROM mimos WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao deletar mimo:', err);
    res.status(500).json({ error: 'Erro interno ao deletar mimo.' });
  }
});

/* =========================================================
   OPENING HOURS
   weekday: 0=Sunday .. 6=Saturday
========================================================= */
app.get('/api/opening-hours', async (req, res) => {
  try {
    const rows = await db.all(`SELECT * FROM opening_hours ORDER BY weekday`);
    res.json({ opening_hours: rows });
  } catch (err) {
    console.error('Erro ao listar horários:', err);
    res.status(500).json({ error: 'Erro interno ao buscar horários.' });
  }
});

app.post('/api/opening-hours', async (req, res) => {
  try {
    const items = Array.isArray(req.body?.opening_hours) ? req.body.opening_hours : [];
    for (const it of items) {
      const weekday = toInt(it.weekday, null);
      if (weekday === null || weekday < 0 || weekday > 6) continue;
      const closed = !!it.closed;
      const open_time = sanitizeTimeHHMM(it.open_time || '');
      const close_time = sanitizeTimeHHMM(it.close_time || '');
      const max_per_slot = Math.max(0, toInt(it.max_per_slot, 0) || 0);

      await db.run(
        `INSERT INTO opening_hours (weekday, open_time, close_time, closed, max_per_slot)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (weekday)
         DO UPDATE SET open_time=EXCLUDED.open_time,
                       close_time=EXCLUDED.close_time,
                       closed=EXCLUDED.closed,
                       max_per_slot=EXCLUDED.max_per_slot`,
        [weekday, open_time, close_time, closed, max_per_slot]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao salvar horários:', err);
    res.status(500).json({ error: 'Erro interno ao salvar horários de funcionamento.' });
  }
});

/* =========================================================
   BOOKINGS (multi-services + mimo period)
========================================================= */
async function getCapacityFor(dateStr) {
  // dateStr: YYYY-MM-DD (local calendar date)
  // weekday in Postgres: EXTRACT(DOW) returns 0=Sun..6=Sat
  const r = await db.get(
    `SELECT weekday, closed, open_time, close_time, COALESCE(max_per_slot,0) AS max_per_slot
     FROM opening_hours
     WHERE weekday = EXTRACT(DOW FROM ($1::date))::int`,
    [dateStr]
  );
  return r; // may be null
}

app.get('/api/bookings', async (req, res) => {
  try {
    const { date, from, to, q } = req.query;
    const params = [];
    const where = [];

    if (date) {
      const d = sanitizeDateYYYYMMDD(date);
      if (d) { params.push(d); where.push(`b.date = $${params.length}`); }
    }
    if (from) {
      const d = sanitizeDateYYYYMMDD(from);
      if (d) { params.push(d); where.push(`b.date >= $${params.length}`); }
    }
    if (to) {
      const d = sanitizeDateYYYYMMDD(to);
      if (d) { params.push(d); where.push(`b.date <= $${params.length}`); }
    }
    if (q) {
      const term = `%${q.toString().trim().toLowerCase()}%`;
      params.push(term);
      where.push(`(LOWER(c.name) LIKE $${params.length} OR LOWER(p.name) LIKE $${params.length} OR b.phone LIKE $${params.length})`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const sql = `
      SELECT
        b.id, b.date, b.time, b.phone, b.notes, b.prize, b.customer_id, b.pet_id, b.mimo_id, b.created_at,
        c.name AS customer_name,
        p.name AS pet_name,
        m.title AS mimo_title,
        COALESCE(
          json_agg(
            json_build_object(
              'service_id', s.id,
              'title', s.title,
              'value_cents', s.value_cents,
              'qty', COALESCE(bs.qty,1)
            )
          ) FILTER (WHERE s.id IS NOT NULL),
          '[]'::json
        ) AS services,
        COALESCE(SUM(s.value_cents * COALESCE(bs.qty,1)), 0)::int AS total_services_value_cents,
        MIN(s.id) AS legacy_service_id
      FROM bookings b
      LEFT JOIN customers c ON c.id = b.customer_id
      LEFT JOIN pets p ON p.id = b.pet_id
      LEFT JOIN mimos m ON m.id = b.mimo_id
      LEFT JOIN booking_services bs ON bs.booking_id = b.id
      LEFT JOIN services s ON s.id = bs.service_id
      ${whereSql}
      GROUP BY b.id, c.name, p.name, m.title
      ORDER BY b.date DESC, b.time DESC, b.id DESC
    `;

    const rows = await db.all(sql, params);
    // keep backward compatibility keys
    const bookings = rows.map(r => ({
      ...r,
      service_id: r.legacy_service_id || null
    }));
    res.json({ bookings });
  } catch (err) {
    console.error('Erro ao listar agendamentos:', err);
    res.status(500).json({ error: 'Erro interno ao listar agendamentos.' });
  }
});

app.post('/api/bookings', async (req, res) => {
  try {
    const date = sanitizeDateYYYYMMDD(req.body?.date || '');
    const time = sanitizeTimeHHMM(req.body?.time || '');
    const phone = (req.body?.phone || '').toString().trim();
    const notes = (req.body?.notes || '').toString().trim();
    const prize = (req.body?.prize || '').toString().trim() || null;

    const customer_id = toInt(req.body?.customer_id, null);
    const pet_id = toInt(req.body?.pet_id, null);

    // mimo_id can be null / "sem mimo"
    const mimo_id_raw = req.body?.mimo_id;
    const mimo_id = (mimo_id_raw === null || mimo_id_raw === '' || mimo_id_raw === 'null' || mimo_id_raw === '0')
      ? null
      : toInt(mimo_id_raw, null);

    if (!date) return res.status(400).json({ error: 'Data inválida.' });
    if (!time) return res.status(400).json({ error: 'Horário inválido.' });

    const cap = await getCapacityFor(date);
    if (!cap || cap.closed) {
      return res.status(400).json({ error: 'Dia fechado.' });
    }

    // capacity per slot (0 => unlimited)
    const maxPerSlot = Number(cap.max_per_slot || 0);
    if (maxPerSlot > 0) {
      const existing = await db.get(
        `SELECT COUNT(*)::int AS cnt FROM bookings WHERE date=$1 AND time=$2`,
        [date, time]
      );
      if ((existing?.cnt || 0) >= maxPerSlot) {
        return res.status(400).json({ error: 'Capacidade máxima atingida para este horário.' });
      }
    }

    // Validate mimo period (if mimo selected)
    if (mimo_id) {
      const m = await db.get(`SELECT * FROM mimos WHERE id=$1`, [mimo_id]);
      if (!m) return res.status(400).json({ error: 'Mimo inválido.' });
      const okStart = !m.start_date || (date >= m.start_date);
      const okEnd = !m.end_date || (date <= m.end_date);
      if (!okStart || !okEnd) {
        return res.status(400).json({ error: 'Mimo fora do período permitido.' });
      }
    }

    const services = parseServicesPayload(req.body);
    if (!services.length) {
      return res.status(400).json({ error: 'Selecione ao menos 1 serviço.' });
    }

    const booking = await db.get(
      `INSERT INTO bookings (date, time, phone, notes, prize, customer_id, pet_id, mimo_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [date, time, phone, notes, prize, customer_id, pet_id, mimo_id]
    );

    for (const s of services) {
      await db.run(
        `INSERT INTO booking_services (booking_id, service_id, qty)
         VALUES ($1,$2,$3)`,
        [booking.id, s.service_id, s.qty]
      );
    }

    res.json({ booking_id: booking.id });
  } catch (err) {
    console.error('Erro ao criar agendamento:', err);
    res.status(500).json({ error: 'Erro interno ao criar agendamento.' });
  }
});

app.put('/api/bookings/:id', async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    const date = sanitizeDateYYYYMMDD(req.body?.date || '');
    const time = sanitizeTimeHHMM(req.body?.time || '');
    const phone = (req.body?.phone || '').toString().trim();
    const notes = (req.body?.notes || '').toString().trim();
    const prize = (req.body?.prize || '').toString().trim() || null;

    const customer_id = toInt(req.body?.customer_id, null);
    const pet_id = toInt(req.body?.pet_id, null);

    const mimo_id_raw = req.body?.mimo_id;
    const mimo_id = (mimo_id_raw === null || mimo_id_raw === '' || mimo_id_raw === 'null' || mimo_id_raw === '0')
      ? null
      : toInt(mimo_id_raw, null);

    if (!date) return res.status(400).json({ error: 'Data inválida.' });
    if (!time) return res.status(400).json({ error: 'Horário inválido.' });

    const cap = await getCapacityFor(date);
    if (!cap || cap.closed) {
      return res.status(400).json({ error: 'Dia fechado.' });
    }

    const maxPerSlot = Number(cap.max_per_slot || 0);
    if (maxPerSlot > 0) {
      const existing = await db.get(
        `SELECT COUNT(*)::int AS cnt FROM bookings WHERE date=$1 AND time=$2 AND id <> $3`,
        [date, time, id]
      );
      if ((existing?.cnt || 0) >= maxPerSlot) {
        return res.status(400).json({ error: 'Capacidade máxima atingida para este horário.' });
      }
    }

    if (mimo_id) {
      const m = await db.get(`SELECT * FROM mimos WHERE id=$1`, [mimo_id]);
      if (!m) return res.status(400).json({ error: 'Mimo inválido.' });
      const okStart = !m.start_date || (date >= m.start_date);
      const okEnd = !m.end_date || (date <= m.end_date);
      if (!okStart || !okEnd) {
        return res.status(400).json({ error: 'Mimo fora do período permitido.' });
      }
    }

    await db.run(
      `UPDATE bookings
       SET date=$1, time=$2, phone=$3, notes=$4, prize=$5, customer_id=$6, pet_id=$7, mimo_id=$8
       WHERE id=$9`,
      [date, time, phone, notes, prize, customer_id, pet_id, mimo_id, id]
    );

    const services = parseServicesPayload(req.body);
    if (services.length) {
      await db.run(`DELETE FROM booking_services WHERE booking_id=$1`, [id]);
      for (const s of services) {
        await db.run(
          `INSERT INTO booking_services (booking_id, service_id, qty)
           VALUES ($1,$2,$3)`,
          [id, s.service_id, s.qty]
        );
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao atualizar agendamento:', err);
    res.status(500).json({ error: 'Erro interno ao atualizar agendamento.' });
  }
});

app.delete('/api/bookings/:id', async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });
    await db.run(`DELETE FROM bookings WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao deletar agendamento:', err);
    res.status(500).json({ error: 'Erro interno ao deletar agendamento.' });
  }
});

/* =========================================================
   BOOT
========================================================= */
const PORT = process.env.PORT || 3000;

(async () => {
  try {
    await db.initDb();
    app.listen(PORT, () => console.log('Server running on port', PORT));
  } catch (err) {
    console.error('Erro fatal ao inicializar banco:', err);
    process.exit(1);
  }
})();
