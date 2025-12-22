// backend/server.js (UPDATED)
const path = require('path');
const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();

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
app.post('/api/admin/login', async (req, res) => {
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
    const phone = String(req.body.phone || '').replace(/\D/g, '');
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
    const phone = String(req.body.phone || '').replace(/\D/g, '');
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

// Listar pets (PUBLIC)
app.get('/api/pets', async (req, res) => {
  try {
    const customerId = Number(req.query.customer_id);
    if (!customerId) return res.status(400).json({ error: 'customer_id é obrigatório.' });

    const pets = await db.all('SELECT * FROM pets WHERE customer_id = $1 ORDER BY name', [customerId]);
    res.json({ pets });
  } catch (err) {
    console.error('Erro ao listar pets:', err);
    res.status(500).json({ error: 'Erro interno ao buscar pets.' });
  }
});

// Criar pet (PUBLIC)
app.post('/api/pets', async (req, res) => {
  try {
    const customer_id = Number(req.body.customer_id);
    const name = String(req.body.name || '').trim();
    const breed = String(req.body.breed || '').trim();

    if (!customer_id || !name) return res.status(400).json({ error: 'customer_id e nome do pet são obrigatórios.' });

    const row = await db.get(
      'INSERT INTO pets (customer_id, name, breed) VALUES ($1, $2, $3) RETURNING *',
      [customer_id, name, breed]
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
    const breed = String(req.body.breed || '').trim();

    if (!id || !name) return res.status(400).json({ error: 'ID e nome são obrigatórios.' });

    const row = await db.get(
      'UPDATE pets SET name = $1, breed = $2, updated_at = NOW() WHERE id = $3 RETURNING *',
      [name, breed, id]
    );
    if (!row) return res.status(404).json({ error: 'Pet não encontrado.' });

    res.json({ pet: row });
  } catch (err) {
    console.error('Erro ao atualizar pet:', err);
    res.status(500).json({ error: 'Erro interno ao atualizar pet.' });
  }
});

// Excluir pet (PUBLIC)
app.delete('/api/pets/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    await db.run('DELETE FROM pets WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao excluir pet:', err);
    res.status(500).json({ error: 'Erro interno ao excluir pet.' });
  }
});

/* =========================
   OPENING HOURS
========================= */

function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const hh = Number(m[1]), mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

async function validateBookingSlot(dateStr, timeStr) {
  if (!dateStr || !timeStr) return { ok: false, error: 'Informe data e horário.' };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return { ok: false, error: 'Data inválida.' };
  if (!/^\d{2}:\d{2}$/.test(timeStr)) return { ok: false, error: 'Horário inválido.' };

  const hhmm = timeStr;
  const minutes = toMinutes(hhmm);
  if (minutes == null) return { ok: false, error: 'Horário inválido.' };

  // só slots 00/30
  if (!([0, 30].includes(minutes % 60))) {
    return { ok: false, error: 'Escolha um horário fechado (minutos 00 ou 30).' };
  }

  // Dia da semana no fuso -03:00 (São Paulo)
  const d = new Date(dateStr + 'T00:00:00-03:00');
  if (Number.isNaN(d.getTime())) return { ok: false, error: 'Data inválida.' };
  const dow = d.getUTCDay(); // 0=dom..6=sab (SP)

  // Se não existe config de opening_hours, fallback padrão:
  // seg-sex 07:30-17:30, sab 07:30-13:00, dom fechado.
  const oh = await db.get(
    `SELECT dow, is_closed, open_time, close_time, max_per_half_hour
     FROM opening_hours WHERE dow = $1`,
    [dow]
  );

  if (oh) {
    if (oh.is_closed) return { ok: false, error: 'Dia fechado.' };

    const openMin = toMinutes(oh.open_time);
    const closeMin = toMinutes(oh.close_time);
    if (openMin == null || closeMin == null || closeMin <= openMin) return { ok: false, error: 'Configuração inválida do horário de funcionamento.' };

    if (minutes < openMin || minutes > closeMin) {
      return { ok: false, error: `Horário fora do funcionamento (${oh.open_time}–${oh.close_time}).` };
    }

    const cap = Number(oh.max_per_half_hour || 1);
    if (!Number.isFinite(cap) || cap <= 0) return { ok: false, error: 'Capacidade inválida do dia.' };

    // Checa ocupação do slot (ignora cancelado)
    const usedRow = await db.get(
      `SELECT COUNT(*)::int AS used
       FROM bookings
       WHERE date = $1 AND time = $2 AND LOWER(COALESCE(status,'')) <> 'cancelado'`,
      [dateStr, hhmm]
    );
    const used = Number(usedRow?.used || 0);
    if (used >= cap) return { ok: false, error: 'Horário indisponível (capacidade atingida).' };

    return { ok: true };
  }

  // fallback padrão
  if (dow === 0) return { ok: false, error: 'Dia fechado.' };
  const start = 7 * 60 + 30;
  const end = (dow === 6) ? (13 * 60) : (17 * 60 + 30);
  if (minutes < start || minutes > end) return { ok: false, error: 'Horário fora do funcionamento padrão.' };

  return { ok: true };
}

// GET opening hours (ADMIN)
app.get('/api/opening-hours', requireAdminAuth, async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT dow, is_closed, open_time, close_time, max_per_half_hour
       FROM opening_hours
       ORDER BY dow`
    );
    res.json({ opening_hours: rows });
  } catch (err) {
    console.error('Erro ao listar opening_hours:', err);
    res.status(500).json({ error: 'Erro interno ao buscar horários de funcionamento.' });
  }
});

// PUT opening hours (ADMIN)
app.put('/api/opening-hours', requireAdminAuth, async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.opening_hours) ? req.body.opening_hours : null;
    if (!rows || rows.length !== 7) return res.status(400).json({ error: 'Envie 7 linhas de configuração (segunda a domingo).' });

    for (const r of rows) {
      const dow = Number(r.dow);
      const is_closed = !!r.is_closed;
      const open_time = String(r.open_time || '').trim();
      const close_time = String(r.close_time || '').trim();
      const max_per_half_hour = Number(r.max_per_half_hour);

      if (!Number.isFinite(dow) || dow < 0 || dow > 6) return res.status(400).json({ error: 'DOW inválido.' });

      if (!is_closed) {
        if (toMinutes(open_time) == null || toMinutes(close_time) == null) return res.status(400).json({ error: 'open_time/close_time inválidos.' });
        if (!Number.isFinite(max_per_half_hour) || max_per_half_hour <= 0) return res.status(400).json({ error: 'max_per_half_hour inválido.' });
      }

      await db.run(
        `INSERT INTO opening_hours (dow, is_closed, open_time, close_time, max_per_half_hour)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (dow)
         DO UPDATE SET is_closed = EXCLUDED.is_closed,
                       open_time = EXCLUDED.open_time,
                       close_time = EXCLUDED.close_time,
                       max_per_half_hour = EXCLUDED.max_per_half_hour,
                       updated_at = NOW()`,
        [dow, is_closed, open_time, close_time, is_closed ? 1 : max_per_half_hour]
      );
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao salvar opening_hours:', err);
    res.status(500).json({ error: 'Erro interno ao salvar horários de funcionamento.' });
  }
});

/* =========================
   SERVICES (ADMIN)
========================= */

app.get('/api/services', requireAdminAuth, async (req, res) => {
  try {
    const rows = await db.all(`SELECT * FROM services ORDER BY date DESC, id DESC`);
    res.json({ services: rows });
  } catch (err) {
    console.error('Erro ao listar services:', err);
    res.status(500).json({ error: 'Erro interno ao listar serviços.' });
  }
});

app.post('/api/services', requireAdminAuth, async (req, res) => {
  try {
    const date = String(req.body.date || '').slice(0, 10);
    const title = String(req.body.title || '').trim();
    const value_cents = Number(req.body.value_cents);

    if (!date || !title) return res.status(400).json({ error: 'Data e título são obrigatórios.' });
    if (!Number.isFinite(value_cents) || value_cents < 0) return res.status(400).json({ error: 'value_cents inválido.' });

    const row = await db.get(
      `INSERT INTO services (date, title, value_cents) VALUES ($1, $2, $3) RETURNING *`,
      [date, title, value_cents]
    );
    res.json({ service: row });
  } catch (err) {
    console.error('Erro ao criar service:', err);
    res.status(500).json({ error: 'Erro interno ao criar serviço.' });
  }
});

app.put('/api/services/:id', requireAdminAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const date = String(req.body.date || '').slice(0, 10);
    const title = String(req.body.title || '').trim();
    const value_cents = Number(req.body.value_cents);

    if (!id) return res.status(400).json({ error: 'ID inválido.' });
    if (!date || !title) return res.status(400).json({ error: 'Data e título são obrigatórios.' });
    if (!Number.isFinite(value_cents) || value_cents < 0) return res.status(400).json({ error: 'value_cents inválido.' });

    const row = await db.get(
      `UPDATE services SET date=$1, title=$2, value_cents=$3, updated_at=NOW() WHERE id=$4 RETURNING *`,
      [date, title, value_cents, id]
    );
    if (!row) return res.status(404).json({ error: 'Serviço não encontrado.' });
    res.json({ service: row });
  } catch (err) {
    console.error('Erro ao atualizar service:', err);
    res.status(500).json({ error: 'Erro interno ao atualizar serviço.' });
  }
});

app.delete('/api/services/:id', requireAdminAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });
    await db.run(`DELETE FROM services WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao excluir service:', err);
    res.status(500).json({ error: 'Erro interno ao excluir serviço.' });
  }
});

/* =========================
   BREEDS (ADMIN)
========================= */

app.get('/api/breeds', requireAdminAuth, async (req, res) => {
  try {
    const rows = await db.all(`SELECT * FROM breeds ORDER BY name`);
    res.json({ breeds: rows });
  } catch (err) {
    console.error('Erro ao listar breeds:', err);
    res.status(500).json({ error: 'Erro interno ao listar raças.' });
  }
});

app.post('/api/breeds', requireAdminAuth, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const size = String(req.body.size || '').trim();
    const coat = String(req.body.coat || '').trim();
    const history = String(req.body.history || '').trim();

    if (!name) return res.status(400).json({ error: 'Nome é obrigatório.' });

    const row = await db.get(
      `INSERT INTO breeds (name, size, coat, history) VALUES ($1,$2,$3,$4) RETURNING *`,
      [name, size, coat, history]
    );
    res.json({ breed: row });
  } catch (err) {
    console.error('Erro ao criar breed:', err);
    res.status(500).json({ error: 'Erro interno ao criar raça.' });
  }
});

app.put('/api/breeds/:id', requireAdminAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const name = String(req.body.name || '').trim();
    const size = String(req.body.size || '').trim();
    const coat = String(req.body.coat || '').trim();
    const history = String(req.body.history || '').trim();

    if (!id) return res.status(400).json({ error: 'ID inválido.' });
    if (!name) return res.status(400).json({ error: 'Nome é obrigatório.' });

    const row = await db.get(
      `UPDATE breeds SET name=$1, size=$2, coat=$3, history=$4, updated_at=NOW() WHERE id=$5 RETURNING *`,
      [name, size, coat, history, id]
    );
    if (!row) return res.status(404).json({ error: 'Raça não encontrada.' });
    res.json({ breed: row });
  } catch (err) {
    console.error('Erro ao atualizar breed:', err);
    res.status(500).json({ error: 'Erro interno ao atualizar raça.' });
  }
});

app.delete('/api/breeds/:id', requireAdminAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    await db.run(`DELETE FROM breeds WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao excluir breed:', err);
    res.status(500).json({ error: 'Erro interno ao excluir raça.' });
  }
});

/* =========================
   MIMOS (ADMIN)
========================= */

app.get('/api/mimos', requireAdminAuth, async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT id, title, description, value_cents, starts_at, ends_at, is_active, created_at, updated_at
       FROM mimos
       ORDER BY id DESC`
    );
    res.json({ mimos: rows });
  } catch (err) {
    console.error('Erro ao listar mimos:', err);
    res.status(500).json({ error: 'Erro interno ao listar mimos.' });
  }
});

app.post('/api/mimos', requireAdminAuth, async (req, res) => {
  try {
    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();
    const value_cents = Number(req.body.value_cents || 0);
    const starts_at = req.body.starts_at ? String(req.body.starts_at) : null;
    const ends_at = req.body.ends_at ? String(req.body.ends_at) : null;
    const is_active = req.body.is_active === false ? false : true;

    if (!title) return res.status(400).json({ error: 'Título é obrigatório.' });
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

app.put('/api/mimos/:id', requireAdminAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();
    const value_cents = Number(req.body.value_cents || 0);
    const starts_at = req.body.starts_at ? String(req.body.starts_at) : null;
    const ends_at = req.body.ends_at ? String(req.body.ends_at) : null;
    const is_active = !!req.body.is_active;

    if (!title) return res.status(400).json({ error: 'Título é obrigatório.' });
    if (!Number.isFinite(value_cents) || value_cents < 0) return res.status(400).json({ error: 'value_cents inválido.' });

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

app.delete('/api/mimos/:id', requireAdminAuth, async (req, res) => {
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
   BOOKINGS
========================= */

// Listar bookings (ADMIN)
app.get('/api/bookings', requireAdminAuth, async (req, res) => {
  try {
    // Observação: mantém compatibilidade com filtros existentes no seu front.
    // (Sem refactor nesta entrega.)
    const date = String(req.query.date || '').trim();
    const search = String(req.query.search || '').trim();

    const where = [];
    const params = [];
    let i = 1;

    if (date) { where.push(`b.date = $${i++}`); params.push(date); }
    if (search) {
      where.push(`(
        LOWER(COALESCE(c.name,'')) LIKE $${i} OR
        LOWER(COALESCE(p.name,'')) LIKE $${i} OR
        REPLACE(COALESCE(c.phone,''), '\\\\D', '', 'g') LIKE $${i} OR
        LOWER(COALESCE(b.prize,'')) LIKE $${i}
      )`);
      params.push('%' + search.toLowerCase() + '%');
      i++;
    }

    const sql = `
      SELECT
        b.*,
        c.name AS customer_name,
        c.phone AS phone,
        p.name AS pet_name,
        p.breed AS pet_breed
      FROM bookings b
      LEFT JOIN customers c ON c.id = b.customer_id
      LEFT JOIN pets p ON p.id = b.pet_id
      ${where.length ? ('WHERE ' + where.join(' AND ')) : ''}
      ORDER BY b.date DESC, b.time DESC, b.id DESC
    `;

    const rows = await db.all(sql, params);
    res.json({ bookings: rows });
  } catch (err) {
    console.error('Erro ao listar bookings:', err);
    res.status(500).json({ error: 'Erro interno ao listar agendamentos.' });
  }
});

// Criar booking (PUBLIC)
app.post('/api/bookings', async (req, res) => {
  try {
    const customer_id = Number(req.body.customer_id);
    const pet_id = req.body.pet_id ? Number(req.body.pet_id) : null;
    const service_id = req.body.service_id ? Number(req.body.service_id) : null;
    const services = Array.isArray(req.body.services) ? req.body.services : null;
    const date = String(req.body.date || '').slice(0, 10);
    const time = String(req.body.time || '').trim();
    const prize = String(req.body.prize || '').trim();
    const status = String(req.body.status || 'agendado').trim();
    const notes = String(req.body.notes || '').trim();

    if (!customer_id || !date || !time) return res.status(400).json({ error: 'customer_id, date e time são obrigatórios.' });

    const slot = await validateBookingSlot(date, time);
    if (!slot.ok) return res.status(400).json({ error: slot.error });

    // Insere booking base
    const booking = await db.get(
      `INSERT INTO bookings (customer_id, pet_id, service_id, date, time, prize, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [customer_id, pet_id, service_id, date, time, prize, status, notes]
    );

    // Multi-serviços (opcional)
    if (Array.isArray(services) && services.length) {
      for (const s of services) {
        const sid = Number(s.id || s.service_id);
        if (!sid) continue;
        await db.run(
          `INSERT INTO booking_services (booking_id, service_id) VALUES ($1,$2)
           ON CONFLICT (booking_id, service_id) DO NOTHING`,
          [booking.id, sid]
        );
      }
    }

    res.json({ booking });
  } catch (err) {
    console.error('Erro ao criar booking:', err);
    res.status(500).json({ error: 'Erro interno ao criar agendamento.' });
  }
});

// Atualizar booking (ADMIN)
app.put('/api/bookings/:id', requireAdminAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    const pet_id = req.body.pet_id ? Number(req.body.pet_id) : null;
    const service_id = req.body.service_id ? Number(req.body.service_id) : null;
    const services = Array.isArray(req.body.services) ? req.body.services : null;

    const date = String(req.body.date || '').slice(0, 10);
    const time = String(req.body.time || '').trim();
    const prize = String(req.body.prize || '').trim();
    const status = String(req.body.status || '').trim();
    const notes = String(req.body.notes || '').trim();

    if (!date || !time) return res.status(400).json({ error: 'date e time são obrigatórios.' });

    const slot = await validateBookingSlot(date, time);
    if (!slot.ok) return res.status(400).json({ error: slot.error });

    const booking = await db.get(
      `UPDATE bookings
       SET pet_id=$1, service_id=$2, date=$3, time=$4, prize=$5, status=$6, notes=$7, updated_at=NOW()
       WHERE id=$8
       RETURNING *`,
      [pet_id, service_id, date, time, prize, status, notes, id]
    );
    if (!booking) return res.status(404).json({ error: 'Agendamento não encontrado.' });

    // Atualiza multi-serviços (opcional)
    if (Array.isArray(services)) {
      await db.run(`DELETE FROM booking_services WHERE booking_id=$1`, [id]);
      for (const s of services) {
        const sid = Number(s.id || s.service_id);
        if (!sid) continue;
        await db.run(
          `INSERT INTO booking_services (booking_id, service_id) VALUES ($1,$2)
           ON CONFLICT (booking_id, service_id) DO NOTHING`,
          [id, sid]
        );
      }
    }

    res.json({ booking });
  } catch (err) {
    console.error('Erro ao atualizar booking:', err);
    res.status(500).json({ error: 'Erro interno ao atualizar agendamento.' });
  }
});

// Excluir booking (ADMIN)
app.delete('/api/bookings/:id', requireAdminAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    await db.run('DELETE FROM bookings WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao excluir booking:', err);
    res.status(500).json({ error: 'Erro interno ao excluir agendamento.' });
  }
});

// Health
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Root fallback (mantém index.html)
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port', PORT));
