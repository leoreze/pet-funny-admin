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
    if (!phone || !name) return res.status(400).json({ error: 'Telefone e nome são obrigatórios.' });

    const existing = await db.get('SELECT * FROM customers WHERE phone = $1', [phone]);

    if (!existing) {
      const ins = await db.get(
        'INSERT INTO customers (phone, name) VALUES ($1,$2) RETURNING *',
        [phone, name]
      );
      return res.json({ customer: ins });
    }

    const upd = await db.get(
      'UPDATE customers SET name = $2 WHERE phone = $1 RETURNING *',
      [phone, name]
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
      'SELECT * FROM pets WHERE customer_id = $1 ORDER BY id DESC',
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
    const info = req.body.info ? String(req.body.info).trim() : null;

    if (!customerId || !name) return res.status(400).json({ error: 'customer_id e name são obrigatórios.' });

    const row = await db.get(
      'INSERT INTO pets (customer_id, name, breed, info) VALUES ($1,$2,$3,$4) RETURNING *',
      [customerId, name, breed, info]
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
    const breed = req.body.breed ? String(req.body.breed).trim() : null;
    const info = req.body.info ? String(req.body.info).trim() : null;

    if (!id || !name) return res.status(400).json({ error: 'ID e name são obrigatórios.' });

    const row = await db.get(
      'UPDATE pets SET name=$2, breed=$3, info=$4 WHERE id=$1 RETURNING *',
      [id, name, breed, info]
    );
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
    const date = String(req.body.date || '').slice(0, 10);
    const title = String(req.body.title || '').trim();
    const value_cents = Number(req.body.value_cents);

    if (!date || !title || !Number.isFinite(value_cents)) {
      return res.status(400).json({ error: 'date, title e value_cents são obrigatórios.' });
    }

    const row = await db.get(
      `
      INSERT INTO services (date, title, value_cents, updated_at)
      VALUES ($1,$2,$3,NOW())
      RETURNING *
      `,
      [date, title, value_cents]
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
    const {
      date,
      date_from,
      date_to,
      customer_id,
      pet_id,
      status,
      q
    } = req.query;

    const where = [];
    const params = [];

    // Datas (um dia específico ou intervalo)
    if (date) {
      params.push(date);
      where.push(`b.date = $${params.length}`);
    } else {
      if (date_from) {
        params.push(date_from);
        where.push(`b.date >= $${params.length}`);
      }
      if (date_to) {
        params.push(date_to);
        where.push(`b.date <= $${params.length}`);
      }
    }

    if (customer_id) {
      params.push(Number(customer_id));
      where.push(`b.customer_id = $${params.length}`);
    }

    if (pet_id) {
      params.push(Number(pet_id));
      where.push(`b.pet_id = $${params.length}`);
    }

    if (status) {
      params.push(status);
      where.push(`b.status = $${params.length}`);
    }

    if (q) {
      // Busca livre (cliente, pet, telefone)
      params.push(`%${q}%`);
      const p = `$${params.length}`;
      where.push(`(
        c.name ILIKE ${p}
        OR c.phone ILIKE ${p}
        OR p.name ILIKE ${p}
      )`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const sql = `
      SELECT
        b.*,
        c.name AS customer_name,
        c.phone AS customer_phone,
        p.name AS pet_name,

        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'service_id', s.id,
              'name', s.name,
              'value_cents', s.value_cents,
              'qty', bs.qty
            )
          ) FILTER (WHERE s.id IS NOT NULL),
          '[]'::json
        ) AS services,

        COALESCE(
          SUM( (COALESCE(s.value_cents, 0) * COALESCE(bs.qty, 1)) ) FILTER (WHERE s.id IS NOT NULL),
          0
        ) AS services_total_cents

      FROM bookings b
      LEFT JOIN customers c ON c.id = b.customer_id
      LEFT JOIN pets p ON p.id = b.pet_id

      LEFT JOIN booking_services bs ON bs.booking_id = b.id
      LEFT JOIN services s ON s.id = bs.service_id

      ${whereSql}
      GROUP BY b.id, c.id, p.id
      ORDER BY b.date DESC, b.time DESC, b.id DESC
    `;

    const rows = await db.all(sql, params);

    // compat: se algum agendamento ainda não migrou para booking_services, tentamos expor "service" legado como services[0]
    const normalized = rows.map(r => {
      const services = Array.isArray(r.services) ? r.services : [];
      let total = Number(r.services_total_cents || 0);

      if (services.length === 0 && r.service_id) {
        services.push({ service_id: r.service_id, name: r.service || null, value_cents: null, qty: 1 });
      }

      // Se não veio total, tenta valor legado (value_cents na própria booking, se existir)
      if (!total && r.value_cents) total = Number(r.value_cents);

      return {
        ...r,
        services,
        services_total_cents: total
      };
    });

    res.json({ bookings: normalized });
  } catch (err) {
    console.error('Erro ao listar bookings:', err);
    res.status(500).json({ error: 'Erro interno ao listar agendamentos.' });
  }
});

app.post('/api/bookings', async (req, res) => {
  try {
    // Compatibilidade:
    // - antigo: service_id (único)
    // - novo: service_ids[] (múltiplos)
    const {
      date,
      time,
      customer_id,
      pet_id,
      status = 'scheduled',
      notes = null,
      mimo_id = null
    } = req.body;

    const rawServiceIds =
      req.body.service_ids ??
      req.body.serviceIds ??
      req.body.services ??
      (req.body.service_id ? [req.body.service_id] : []);

    const serviceIds = Array.isArray(rawServiceIds)
      ? rawServiceIds.map(v => Number(v)).filter(v => Number.isFinite(v))
      : [];

    if (!date || !time) {
      return res.status(400).json({ error: 'Data e horário são obrigatórios.' });
    }

    if (!customer_id || !pet_id) {
      return res.status(400).json({ error: 'Cliente e pet são obrigatórios.' });
    }

    // Regra de capacidade: pega o max por dia (opening_hours.max_per_slot)
    // Se não houver cadastro, assume 1 para evitar overbooking.
    const weekday = (() => {
      // date no formato YYYY-MM-DD
      const [y, m, d] = String(date).split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      return dt.getUTCDay(); // 0=domingo ... 6=sábado
    })();

    const oh = await db.get(
      `SELECT is_closed, max_per_slot
       FROM opening_hours
       WHERE weekday = $1`,
      [weekday]
    );

    if (oh && oh.is_closed) {
      return res.status(400).json({ error: 'Dia fechado.' });
    }

    const maxPerSlot = oh?.max_per_slot ? Number(oh.max_per_slot) : 1;

    const occupied = await db.get(
      `SELECT COUNT(*)::int AS cnt
       FROM bookings
       WHERE date = $1 AND time = $2 AND status <> 'cancelled'`,
      [date, time]
    );

    if (occupied && occupied.cnt >= maxPerSlot) {
      return res.status(400).json({ error: 'Horário lotado.' });
    }

    // Compat legado: salvamos service_id/service com o 1º item, mas a fonte de verdade é booking_services.
    const legacyServiceId = serviceIds[0] ?? null;

    const insertBookingSql = `
      INSERT INTO bookings (date, time, customer_id, pet_id, service_id, status, notes, mimo_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
    `;

    const booking = await db.get(insertBookingSql, [
      date,
      time,
      Number(customer_id),
      Number(pet_id),
      legacyServiceId,
      status,
      notes,
      mimo_id || null
    ]);

    // Vincula serviços (se nenhum foi enviado, mantém vazio — o admin pode salvar "sem serviço" se quiser)
    for (const sid of serviceIds) {
      await db.run(
        `INSERT INTO booking_services (booking_id, service_id, qty)
         VALUES ($1,$2,1)
         ON CONFLICT (booking_id, service_id) DO UPDATE SET qty = booking_services.qty + 1`,
        [booking.id, sid]
      );
    }

    res.json({ booking });
  } catch (err) {
    console.error('Erro ao criar booking:', err);
    // Mantém mensagem antiga em alguns fluxos do admin
    if (String(err?.message || '').toLowerCase().includes('horário')) {
      return res.status(400).json({ error: 'Horário inválido.' });
    }
    res.status(500).json({ error: 'Erro interno ao criar agendamento.' });
  }
});

app.put('/api/bookings/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'ID inválido.' });
    }

    const {
      date,
      time,
      customer_id,
      pet_id,
      status,
      notes,
      mimo_id
    } = req.body;

    const rawServiceIds =
      req.body.service_ids ??
      req.body.serviceIds ??
      req.body.services ??
      (req.body.service_id ? [req.body.service_id] : null);

    const serviceIds = Array.isArray(rawServiceIds)
      ? rawServiceIds.map(v => Number(v)).filter(v => Number.isFinite(v))
      : null;

    const current = await db.get(`SELECT * FROM bookings WHERE id = $1`, [id]);
    if (!current) return res.status(404).json({ error: 'Agendamento não encontrado.' });

    const newDate = date ?? current.date;
    const newTime = time ?? current.time;

    // Se mudar data/horário, revalida capacidade
    if (newDate !== current.date || newTime !== current.time) {
      const weekday = (() => {
        const [y, m, d] = String(newDate).split('-').map(Number);
        const dt = new Date(Date.UTC(y, m - 1, d));
        return dt.getUTCDay();
      })();

      const oh = await db.get(
        `SELECT is_closed, max_per_slot
         FROM opening_hours
         WHERE weekday = $1`,
        [weekday]
      );

      if (oh && oh.is_closed) {
        return res.status(400).json({ error: 'Dia fechado.' });
      }

      const maxPerSlot = oh?.max_per_slot ? Number(oh.max_per_slot) : 1;

      const occupied = await db.get(
        `SELECT COUNT(*)::int AS cnt
         FROM bookings
         WHERE date = $1 AND time = $2 AND status <> 'cancelled' AND id <> $3`,
        [newDate, newTime, id]
      );

      if (occupied && occupied.cnt >= maxPerSlot) {
        return res.status(400).json({ error: 'Horário lotado.' });
      }
    }

    const legacyServiceId =
      serviceIds && serviceIds.length ? serviceIds[0] : (req.body.service_id ?? current.service_id);

    const upd = await db.get(
      `UPDATE bookings
       SET date = $1,
           time = $2,
           customer_id = $3,
           pet_id = $4,
           service_id = $5,
           status = $6,
           notes = $7,
           mimo_id = $8
       WHERE id = $9
       RETURNING *`,
      [
        newDate,
        newTime,
        Number(customer_id ?? current.customer_id),
        Number(pet_id ?? current.pet_id),
        legacyServiceId ?? null,
        status ?? current.status,
        notes ?? current.notes,
        (mimo_id === 0 ? null : (mimo_id ?? current.mimo_id)),
        id
      ]
    );

    // Se veio array de serviços, substitui os vínculos
    if (serviceIds) {
      await db.run(`DELETE FROM booking_services WHERE booking_id = $1`, [id]);
      for (const sid of serviceIds) {
        await db.run(
          `INSERT INTO booking_services (booking_id, service_id, qty)
           VALUES ($1,$2,1)
           ON CONFLICT (booking_id, service_id) DO UPDATE SET qty = booking_services.qty + 1`,
          [id, sid]
        );
      }
    }

    res.json({ booking: upd });
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
