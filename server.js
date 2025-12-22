// backend/server.js (UPDATED)
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const db = require('./db');

const app = express();

// Render / proxies (necessário para req.ip e rate limit funcionarem corretamente)
app.set('trust proxy', 1);

// Security headers (mantém compatibilidade com HTML/JS inline existente)
app.use(helmet({ contentSecurityPolicy: false }));

// Rate limit (por IP) aplicado às rotas /api
const apiLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
  max: Number(process.env.RATE_LIMIT_MAX || 240),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Muitas requisições. Tente novamente em instantes.' }),
});
app.use('/api', apiLimiter);

// Rate limit mais restrito para tentativas de login admin
const adminLoginLimiter = rateLimit({
  windowMs: Number(process.env.ADMIN_LOGIN_RATE_WINDOW_MS || 10 * 60_000),
  max: Number(process.env.ADMIN_LOGIN_RATE_MAX || 20),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Muitas tentativas. Tente novamente mais tarde.' }),
});

const ALLOWED_ORIGINS = String(process.env.CORS_ORIGINS || 'https://agendapetfunny.com.br')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: function (origin, cb) {
    // allow non-browser tools (no Origin)
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  }
}));

app.use(express.json());

// Static files (admin.html, index.html, assets)
app.use(express.static(__dirname));

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

  // Quantos agendamentos já existem nesse date+time
  const params = [date, time];
  let whereExtra = '';
  if (excludeBookingId != null) {
    params.push(Number(excludeBookingId));
    whereExtra = ` AND id <> $${params.length}`;
  }

  const row = await db.get(
    `SELECT COUNT(*)::int AS count
     FROM bookings
     WHERE date = $1 AND time = $2${whereExtra}`,
    params
  );

  const count = Number(row?.count || 0);
  if (count >= cap) return { ok: false, error: 'Capacidade máxima atingida para este horário.' };

  return { ok: true };
}

/* =========================
   ADMIN AUTH (stateless HMAC token)
   - Credenciais via ENV (ADMIN_USER/ADMIN_PASS)
   - Segredo via ENV (ADMIN_JWT_SECRET) — recomendado em produção
   - Token expira em 30 minutos
========================= */
const crypto = require('crypto');

const ADMIN_USER = process.env.ADMIN_USER || 'adminpetfunny';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin2605';
const ADMIN_TOKEN_TTL_MIN = Number(process.env.ADMIN_TOKEN_TTL_MIN || 30);

const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || crypto.randomBytes(32).toString('hex');

if (!process.env.ADMIN_JWT_SECRET) {
  console.warn('[WARN] ADMIN_JWT_SECRET não definido. Tokens serão invalidados a cada restart. Defina em produção.');
}
if (!process.env.ADMIN_USER || !process.env.ADMIN_PASS) {
  console.warn('[WARN] ADMIN_USER/ADMIN_PASS não definidos. Usando defaults. Defina em produção.');
}

function b64urlEncode(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}
function b64urlDecode(str) {
  const s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  return Buffer.from(s + pad, 'base64').toString('utf8');
}
function signToken(payloadObj) {
  const payloadJson = JSON.stringify(payloadObj);
  const payloadB64 = b64urlEncode(payloadJson);
  const sig = crypto.createHmac('sha256', ADMIN_JWT_SECRET).update(payloadB64).digest();
  const sigB64 = b64urlEncode(sig);
  return `${payloadB64}.${sigB64}`;
}
function verifyToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return { ok: false, error: 'Token inválido.' };
  const [payloadB64, sigB64] = parts;

  const sig = crypto.createHmac('sha256', ADMIN_JWT_SECRET).update(payloadB64).digest();
  const expected = b64urlEncode(sig);
  if (expected !== sigB64) return { ok: false, error: 'Token inválido.' };

  let payload;
  try { payload = JSON.parse(b64urlDecode(payloadB64)); } catch (_) { return { ok: false, error: 'Token inválido.' }; }

  const exp = Number(payload.exp || 0);
  if (!exp || Date.now() > exp) return { ok: false, error: 'Sessão expirada.' };
  return { ok: true, payload };
}

function requireAdminAuth(req, res, next) {
  try {
    const h = String(req.headers.authorization || '');
    const m = /^Bearer\s+(.+)$/i.exec(h);
    const token = m ? m[1] : '';
    const v = verifyToken(token);
    if (!v.ok) return res.status(401).json({ error: v.error || 'Não autorizado.' });
    req.admin = v.payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }
}

// Login (gera token)
app.post('/api/admin/login', adminLoginLimiter, async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '').trim();

    if (!username || !password) return res.status(400).json({ error: 'Informe usuário e senha.' });
    if (username !== ADMIN_USER || password !== ADMIN_PASS) return res.status(401).json({ error: 'Credenciais inválidas.' });

    const expiresAt = Date.now() + (ADMIN_TOKEN_TTL_MIN * 60 * 1000);
    const token = signToken({ sub: 'admin', user: username, exp: expiresAt });

    res.json({ token, expires_at: expiresAt });
  } catch (err) {
    console.error('Erro no login admin:', err);
    res.status(500).json({ error: 'Erro interno ao autenticar.' });
  }
});

/* =========================
   CLIENTES
========================= */

// Listar clientes (ADMIN)
app.get('/api/customers', requireAdminAuth, async (req, res) => {
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

// Lookup por telefone (PUBLIC)
app.post('/api/customers/lookup', async (req, res) => {
  try {
    const phone = sanitizePhone(req.body.phone);
    if (!phone) return res.status(400).json({ error: 'Telefone é obrigatório.' });

    const customer = await db.get('SELECT * FROM customers WHERE phone = $1', [phone]);
    if (!customer) return res.status(404).json({ error: 'Cliente não encontrado.' });

    res.json({ customer });
  } catch (err) {
    console.error('Erro em lookup customers:', err);
    res.status(500).json({ error: 'Erro interno ao buscar cliente.' });
  }
});

// Criar customer (PUBLIC)
app.post('/api/customers', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const phone = sanitizePhone(req.body.phone);

    if (!name || !phone) return res.status(400).json({ error: 'Nome e telefone são obrigatórios.' });

    const existing = await db.get('SELECT id FROM customers WHERE phone = $1', [phone]);
    if (existing) return res.status(409).json({ error: 'Já existe um cliente com este telefone.' });

    const row = await db.get(
      'INSERT INTO customers (name, phone) VALUES ($1, $2) RETURNING *',
      [name, phone]
    );
    res.json({ customer: row });
  } catch (err) {
    console.error('Erro ao criar customer:', err);
    res.status(500).json({ error: 'Erro interno ao criar cliente.' });
  }
});

// Excluir customer (ADMIN)
app.delete('/api/customers/:id', requireAdminAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    await db.run('DELETE FROM customers WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao excluir customer:', err);
    res.status(500).json({ error: 'Erro interno ao excluir cliente.' });
  }
});

/* =========================
   PETS
========================= */

// Listar pets por customer (PUBLIC)
app.get('/api/pets', async (req, res) => {
  try {
    const customer_id = Number(req.query.customer_id);
    if (!customer_id) return res.status(400).json({ error: 'customer_id é obrigatório.' });

    const rows = await db.all(
      'SELECT * FROM pets WHERE customer_id = $1 ORDER BY name',
      [customer_id]
    );
    res.json({ pets: rows });
  } catch (err) {
    console.error('Erro ao listar pets:', err);
    res.status(500).json({ error: 'Erro interno ao listar pets.' });
  }
});

// Criar pet (PUBLIC)
app.post('/api/pets', async (req, res) => {
  try {
    const customer_id = Number(req.body.customer_id);
    const name = String(req.body.name || '').trim();
    const species = String(req.body.species || 'dog').trim();
    const breed = req.body.breed ? String(req.body.breed).trim() : null;
    const size = req.body.size ? String(req.body.size).trim() : null;
    const coat = req.body.coat ? String(req.body.coat).trim() : null;
    const notes = req.body.notes ? String(req.body.notes).trim() : null;

    if (!customer_id || !name) return res.status(400).json({ error: 'customer_id e name são obrigatórios.' });

    const row = await db.get(
      `INSERT INTO pets (customer_id, name, species, breed, size, coat, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [customer_id, name, species, breed, size, coat, notes]
    );
    res.json({ pet: row });
  } catch (err) {
    console.error('Erro ao criar pet:', err);
    res.status(500).json({ error: 'Erro interno ao criar pet.' });
  }
});

// Atualizar pet (PUBLIC)
app.put('/api/pets/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const name = String(req.body.name || '').trim();
    const species = String(req.body.species || 'dog').trim();
    const breed = req.body.breed ? String(req.body.breed).trim() : null;
    const size = req.body.size ? String(req.body.size).trim() : null;
    const coat = req.body.coat ? String(req.body.coat).trim() : null;
    const notes = req.body.notes ? String(req.body.notes).trim() : null;

    if (!id || !name) return res.status(400).json({ error: 'id e name são obrigatórios.' });

    const row = await db.get(
      `UPDATE pets
       SET name=$2, species=$3, breed=$4, size=$5, coat=$6, notes=$7, updated_at=NOW()
       WHERE id=$1
       RETURNING *`,
      [id, name, species, breed, size, coat, notes]
    );
    res.json({ pet: row });
  } catch (err) {
    console.error('Erro ao atualizar pet:', err);
    res.status(500).json({ error: 'Erro interno ao atualizar pet.' });
  }
});

// Deletar pet (PUBLIC)
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
    const rows = await db.all(
      `SELECT * FROM services ORDER BY id DESC`
    );
    res.json({ services: rows });
  } catch (err) {
    console.error('Erro ao listar services:', err);
    res.status(500).json({ error: 'Erro interno ao listar serviços.' });
  }
});

app.post('/api/services', async (req, res) => {
  try {
    const date = req.body.date ? String(req.body.date).trim() : null;
    const title = String(req.body.title || '').trim();
    const value_cents = Number(req.body.value_cents ?? 0);

    if (!title) return res.status(400).json({ error: 'title é obrigatório.' });
    if (!Number.isFinite(value_cents) || value_cents < 0) return res.status(400).json({ error: 'value_cents inválido.' });

    const row = await db.get(
      `INSERT INTO services (date, title, value_cents)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [date, title, value_cents]
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
    const date = req.body.date ? String(req.body.date).trim() : null;
    const title = String(req.body.title || '').trim();
    const value_cents = Number(req.body.value_cents ?? 0);

    if (!id || !title) return res.status(400).json({ error: 'id e title são obrigatórios.' });
    if (!Number.isFinite(value_cents) || value_cents < 0) return res.status(400).json({ error: 'value_cents inválido.' });

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
      q,
      status,
      date_from,
      date_to,
      customer_id,
      pet_id
    } = req.query;

    const where = [];
    const params = [];

    if (q && String(q).trim()) {
      const like = `%${String(q).trim().toLowerCase()}%`;
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

    if (date_from && String(date_from).trim()) {
      params.push(String(date_from).trim().slice(0, 10));
      where.push(`b.date >= $${params.length}`);
    }

    if (date_to && String(date_to).trim()) {
      params.push(String(date_to).trim().slice(0, 10));
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
        pet.name AS pet_name,

        -- fallback legado (um serviço)
        s.title AS service_title,
        s.value_cents AS service_value_cents,

        -- nova lógica (múltiplos serviços)
        COALESCE(bs.services, '[]'::json) AS services,
        COALESCE(bs.total_cents, 0) AS services_total_cents

      FROM bookings b
      LEFT JOIN customers c ON c.id = b.customer_id
      LEFT JOIN pets pet ON pet.id = b.pet_id
      LEFT JOIN services s ON s.id = b.service_id

      LEFT JOIN LATERAL (
        SELECT
          json_agg(json_build_object(
            'service_id', si.service_id,
            'title', sv.title,
            'value_cents', sv.value_cents
          ) ORDER BY si.service_id) AS services,
          COALESCE(SUM(sv.value_cents), 0)::int AS total_cents
        FROM booking_services si
        JOIN services sv ON sv.id = si.service_id
        WHERE si.booking_id = b.id
      ) bs ON TRUE

      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
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

    if (!customer_id || !date || !time) {
      return res.status(400).json({ error: 'customer_id, date e time são obrigatórios.' });
    }

    // Validação: slot x funcionamento/capacidade
    const v = await validateBookingSlot({ date, time });
    if (!v.ok) return res.status(409).json({ error: v.error });

    const row = await db.get(
      `INSERT INTO bookings (customer_id, pet_id, service_id, service, date, time, prize, notes, status, last_notification_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [customer_id, pet_id, service_id, service, date, time, prize, notes, status, last_notification_at]
    );

    // Se veio lista de serviços (nova lógica), grava em booking_services
    const service_ids = Array.isArray(req.body.service_ids) ? req.body.service_ids : null;
    if (service_ids && service_ids.length && row?.id) {
      // limpa e reinsere (idempotente para este POST)
      await db.run('DELETE FROM booking_services WHERE booking_id = $1', [row.id]);
      for (const sid of service_ids) {
        const sIdNum = Number(sid);
        if (!sIdNum) continue;
        await db.run(
          'INSERT INTO booking_services (booking_id, service_id) VALUES ($1, $2)',
          [row.id, sIdNum]
        );
      }
    }

    res.json({ booking: row });
  } catch (err) {
    console.error('Erro ao criar booking:', err);
    res.status(500).json({ error: 'Erro interno ao criar agendamento.' });
  }
});

app.put('/api/bookings/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);

    const customer_id = req.body.customer_id != null ? Number(req.body.customer_id) : null;
    const pet_id = req.body.pet_id != null ? Number(req.body.pet_id) : null;
    const service_id = req.body.service_id != null ? Number(req.body.service_id) : null;

    const service = req.body.service ? String(req.body.service).trim() : null;
    const date = String(req.body.date || '').slice(0, 10);
    const time = String(req.body.time || '').slice(0, 5);
    const prize = String(req.body.prize || '').trim();
    const notes = req.body.notes ? String(req.body.notes).trim() : null;
    const status = req.body.status ? String(req.body.status).trim() : 'agendado';
    const last_notification_at = req.body.last_notification_at ? String(req.body.last_notification_at) : null;

    if (!id || !customer_id || !date || !time || !prize) {
      return res.status(400).json({ error: 'id, customer_id, date, time e prize são obrigatórios.' });
    }

    // Horário de funcionamento + capacidade por meia hora (exclui o próprio agendamento)
    const v = await validateBookingSlot({ date, time, excludeBookingId: id });
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

    // Se veio lista de serviços (nova lógica), grava em booking_services
    const service_ids = Array.isArray(req.body.service_ids) ? req.body.service_ids : null;
    if (service_ids && service_ids.length && row?.id) {
      await db.run('DELETE FROM booking_services WHERE booking_id = $1', [row.id]);
      for (const sid of service_ids) {
        const sIdNum = Number(sid);
        if (!sIdNum) continue;
        await db.run(
          'INSERT INTO booking_services (booking_id, service_id) VALUES ($1, $2)',
          [row.id, sIdNum]
        );
      }
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

    const params = [];
    const where = [];

    if (q) {
      params.push(`%${q.toLowerCase()}%`);
      where.push(`LOWER(name) LIKE $${params.length}`);
    }
    if (active === '1') {
      where.push(`is_active = TRUE`);
    }

    const sql = `
      SELECT * FROM dog_breeds
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY name
    `;

    const rows = await db.all(sql, params);
    res.json({ breeds: rows });
  } catch (err) {
    console.error('Erro ao listar breeds:', err);
    res.status(500).json({ error: 'Erro interno ao listar raças.' });
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
      INSERT INTO dog_breeds (name, history, size, coat, characteristics, is_active)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING *
      `,
      [name, history, size, coat, characteristics, is_active]
    );

    res.json({ breed: row });
  } catch (err) {
    console.error('Erro ao criar breed:', err);
    res.status(500).json({ error: 'Erro interno ao criar raça.' });
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
    if (!Number.isFinite(value_cents) || value_cents < 0) return res.status(400).json({ error: 'value_cents inválido.' });

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
    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();
    const value_cents = Number(req.body.value_cents ?? 0);
    const starts_at = req.body.starts_at ? String(req.body.starts_at) : null;
    const ends_at = req.body.ends_at ? String(req.body.ends_at) : null;
    const is_active = req.body.is_active === false ? false : true;

    if (!id || !title) return res.status(400).json({ error: 'id e title são obrigatórios.' });
    if (!Number.isFinite(value_cents) || value_cents < 0) return res.status(400).json({ error: 'value_cents inválido.' });

    const row = await db.get(
      `UPDATE mimos
       SET title=$2, description=$3, value_cents=$4, starts_at=$5, ends_at=$6, is_active=$7, updated_at=NOW()
       WHERE id=$1
       RETURNING *`,
      [id, title, description, value_cents, starts_at, ends_at, is_active]
    );

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

    await db.run('DELETE FROM mimos WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao deletar mimo:', err);
    res.status(500).json({ error: 'Erro interno ao excluir mimo.' });
  }
});

/* =========================
   OPENING HOURS (Admin)
========================= */

// Listar horários (ADMIN)
app.get('/api/opening-hours', requireAdminAuth, async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT dow, is_closed, open_time, close_time, max_per_half_hour, updated_at
       FROM opening_hours
       ORDER BY dow`
    );
    res.json({ opening_hours: rows });
  } catch (err) {
    console.error('Erro ao listar opening-hours:', err);
    res.status(500).json({ error: 'Erro interno ao listar horários de funcionamento.' });
  }
});

// Salvar horários (ADMIN)
app.put('/api/opening-hours', requireAdminAuth, async (req, res) => {
  try {
    const items = Array.isArray(req.body.opening_hours) ? req.body.opening_hours : null;
    if (!items) return res.status(400).json({ error: 'opening_hours deve ser uma lista.' });

    for (const it of items) {
      const dow = Number(it.dow);
      const is_closed = !!it.is_closed;
      const open_time = it.open_time != null ? String(it.open_time).slice(0, 5) : null;
      const close_time = it.close_time != null ? String(it.close_time).slice(0, 5) : null;
      const max_per_half_hour = Number(it.max_per_half_hour);

      if (!Number.isFinite(dow) || dow < 0 || dow > 6) {
        return res.status(400).json({ error: 'dow inválido (0..6).' });
      }
      if (!is_closed) {
        if (!open_time || !close_time) {
          return res.status(400).json({ error: 'open_time e close_time são obrigatórios quando o dia está aberto.' });
        }
        const open = timeToMinutes(open_time);
        const close = timeToMinutes(close_time);
        if (!Number.isFinite(open) || !Number.isFinite(close) || open >= close) {
          return res.status(400).json({ error: 'open_time/close_time inválidos.' });
        }
        if (!Number.isFinite(max_per_half_hour) || max_per_half_hour <= 0) {
          return res.status(400).json({ error: 'max_per_half_hour deve ser >= 1 quando o dia está aberto.' });
        }
      }

      // upsert simples (delete+insert)
      await db.run('DELETE FROM opening_hours WHERE dow = $1', [dow]);
      await db.run(
        `INSERT INTO opening_hours (dow, is_closed, open_time, close_time, max_per_half_hour, updated_at)
         VALUES ($1,$2,$3,$4,$5,NOW())`,
        [dow, is_closed, open_time, close_time, is_closed ? 0 : max_per_half_hour]
      );
    }

    const rows = await db.all(
      `SELECT dow, is_closed, open_time, close_time, max_per_half_hour, updated_at
       FROM opening_hours
       ORDER BY dow`
    );

    res.json({ ok: true, opening_hours: rows });
  } catch (err) {
    console.error('Erro ao salvar opening-hours:', err);
    res.status(500).json({ error: 'Erro interno ao salvar horários de funcionamento.' });
  }
});

app.get(['/admin', '/admin/'], (req, res) => {
  return res.sendFile(path.join(__dirname, 'admin.html'));
});

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  try {
    if (typeof db.initDb === 'function') {
      await db.initDb();
    }
    console.log(`✅ PetFunny server on :${PORT}`);
  } catch (err) {
    console.error('Erro fatal ao inicializar banco:', err);
  }
});
