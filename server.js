// PATCH: customers address fields in /api/customers - 2025-12-24
// backend/server.js (UPDATED)
const path = require('path');
const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
app.set('trust proxy', 1);
app.use(cors());
// PATCH: aumenta limite do body para permitir foto (DataURL base64) em customers/pets
// - default do Express é ~100kb e pode estourar facilmente
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// =========================
// Mercado Pago (PIX)
// =========================
const MP_API_BASE = 'https://api.mercadopago.com';

const crypto = require('crypto');

function makeMpIdempotencyKey(seed) {
  // Mercado Pago requires a non-null string header value for X-Idempotency-Key.
  // We generate a stable key per booking to avoid duplicate Pix charges on retries.
  const s = String(seed || '');
  if (!s) return crypto.randomUUID();
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 32);
}


function getMpAccessToken() {
  const t = process.env.MERCADOPAGO_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN || '';
  return String(t || '').trim();
}

async function mpFetch(path, options = {}) {
  const token = getMpAccessToken();
  if (!token) {
    const err = new Error('MERCADOPAGO_ACCESS_TOKEN não configurado no servidor.');
    err.statusCode = 500;
    throw err;
  }
  const url = path.startsWith('http') ? path : `${MP_API_BASE}${path}`;
  const fetchFn = (typeof fetch === 'function') ? fetch : (await import('node-fetch')).default;
  const res = await fetchFn(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

  if (!res.ok) {
    // Friendly mapping for common Mercado Pago PIX integration errors
    const mpMessage = (data && (data.message || data.error || data.cause?.[0]?.description)) ? String(data.message || data.error || data.cause?.[0]?.description) : '';
    const mpCode = data && data.cause && data.cause[0] && data.cause[0].code ? Number(data.cause[0].code) : null;

    // 13253: Collector user without key enabled for QR render (Pix key not registered/enabled)
    if (mpCode === 13253 || /Collector user without key enabled for QR render/i.test(mpMessage)) {
      const e = new Error('Sua conta do Mercado Pago ainda não tem uma chave Pix habilitada para gerar QR Code. Abra o app/site do Mercado Pago e cadastre/ative uma chave Pix (CPF/CNPJ, e-mail, celular ou aleatória) e habilite o recebimento via Pix. Depois tente novamente.');
      e.statusCode = res.status;
      e.payload = data;
      e.mp_code = mpCode;
      throw e;
    }

    const e = new Error(mpMessage || `Erro Mercado Pago (${res.status})`);
    e.statusCode = res.status;
    e.payload = data;
    e.mp_code = mpCode;
    throw e;
  }
  return data;
}




function isValidHttpUrl(u) {
  try {
    const x = new URL(String(u || '').trim());
    return x.protocol === 'http:' || x.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function isLocalhostUrl(u) {
  try {
    const x = new URL(String(u || '').trim());
    return ['localhost', '127.0.0.1', '::1'].includes(x.hostname);
  } catch (_) {
    return false;
  }
}


// Static files (admin.html, index.html, assets)
app.use(express.static(__dirname, { index: false }));


// PATCH: serve admin-prefixed static assets (avoid 404 on /admin/* when files live at project root)
app.get('/admin/style.css', (req, res) => res.sendFile(path.join(__dirname, 'style.css')));
app.get('/admin/js/bootstrap.js', (req, res) => res.sendFile(path.join(__dirname, 'bootstrap.js')));
app.get('/admin/js/modules/mimos.js', (req, res) => res.sendFile(path.join(__dirname, 'mimos.js')));
app.get('/admin/js/modules/services.js', (req, res) => res.sendFile(path.join(__dirname, 'services.js')));
// (Opcional) logo no prefixo /admin, caso o HTML esteja com caminhos relativos
app.get('/admin/pet-funny-logo.svg', (req, res) => res.sendFile(path.join(__dirname, 'pet-funny-logo.svg')));


app.get(['/admin', '/admin/'], (req, res) => {
  return res.sendFile(path.join(__dirname, 'admin.html'));
});

// HOME -> Landing
app.get(['/', '/index.html'], (req, res) => {
  return res.sendFile(path.join(__dirname, 'petfunny_landing', 'index.html'));
});

// ROLETA
app.get(['/roleta', '/roleta/'], (req, res) => {
  return res.sendFile(path.join(__dirname, 'index.html'));
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
        (SELECT COUNT(*) FROM pets p WHERE p.customer_id = c.id) AS pets_count,
        (SELECT COUNT(*) FROM bookings b WHERE b.customer_id = c.id) AS bookings_count
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

// Get customer by id (para modal de informações)
app.get('/api/customers/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    const row = await db.get(
      `SELECT c.*,
              (SELECT COUNT(*) FROM pets p WHERE p.customer_id = c.id) AS pets_count,
              (SELECT COUNT(*) FROM bookings b WHERE b.customer_id = c.id) AS bookings_count
         FROM customers c
        WHERE c.id = $1`,
      [id]
    );
    if (!row) return res.status(404).json({ error: 'Cliente não encontrado.' });
    res.json({ customer: row });
  } catch (err) {
    console.error('Erro ao buscar customer por id:', err);
    res.status(500).json({ error: 'Erro interno ao buscar cliente.' });
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

// Get pet by id (para modal de informações)
app.get('/api/pets/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    const row = await db.get(
      `SELECT p.*,
              COALESCE(p.notes,'') AS info,
              c.name AS customer_name,
              c.phone AS customer_phone
         FROM pets p
         LEFT JOIN customers c ON c.id = p.customer_id
        WHERE p.id = $1`,
      [id]
    );
    if (!row) return res.status(404).json({ error: 'Pet não encontrado.' });
    res.json({ pet: row });
  } catch (err) {
    console.error('Erro ao buscar pet por id:', err);
    res.status(500).json({ error: 'Erro interno ao buscar pet.' });
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
   PACKAGES (por porte)
========================= */

function addDaysISO(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

async function getServiceRow(id) {
  if (!id) return null;
  return await db.get('SELECT * FROM services WHERE id = $1', [Number(id)]);
}

async function getServicesByIds(ids) {
  const clean = (ids || []).map(n => Number(n)).filter(n => Number.isFinite(n) && n > 0);
  if (!clean.length) return [];
  const params = clean;
  const placeholders = clean.map((_, i) => `$${i + 1}`).join(',');
  return await db.all(`SELECT * FROM services WHERE id IN (${placeholders})`, params);
}

function cents(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v) : 0;
}

async function computePackagePreview(pkg) {
  const bath = await getServiceRow(pkg.bath_service_id);
  const includes = Array.isArray(pkg.includes_json) ? pkg.includes_json : (pkg.includes_json ? JSON.parse(pkg.includes_json) : []);
  const includeIds = includes.map(x => x && x.service_id != null ? Number(x.service_id) : null).filter(Boolean);
  const incRows = await getServicesByIds(includeIds);

  const bathQty = Number(pkg.bath_qty || 0);
  const disc = Number(pkg.bath_discount_percent || 0) / 100;
  const bathUnit = cents(bath?.value_cents);
  const bathDiscounted = cents(bathUnit * (1 - disc));

  const incReal = incRows.reduce((acc, s) => acc + cents(s.value_cents), 0);

  const totalAvulso = cents(bathQty * bathUnit + incReal);
  const totalPacote = cents(bathQty * bathDiscounted);
  const economia = cents(totalAvulso - totalPacote);

  return {
    porte: pkg.porte,
    bath_unit_cents: bathUnit,
    bath_unit_discounted_cents: bathDiscounted,
    included_real_cents: incReal,
    total_avulso_cents: totalAvulso,
    total_pacote_cents: totalPacote,
    economia_cents: economia
  };
}

app.get('/api/packages', async (req, res) => {
  try {
    const porte = (req.query.porte ? String(req.query.porte).trim() : '');
    const where = [];
    const params = [];
    if (porte) { params.push(porte); where.push(`porte = $${params.length}`); }
    const rows = await db.all(
      `SELECT * FROM service_packages ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC`,
      params
    );
    const out = [];
    for (const r of rows) {
      const preview = await computePackagePreview(r);
      out.push({ ...r, preview });
    }
    res.json({ packages: out });
  } catch (err) {
    console.error('Erro ao listar packages:', err);
    res.status(500).json({ error: 'Erro interno ao buscar pacotes.' });
  }
});

app.get('/api/packages/:id/preview', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });
    const pkg = await db.get('SELECT * FROM service_packages WHERE id = $1', [id]);
    if (!pkg) return res.status(404).json({ error: 'Pacote não encontrado.' });
    const preview = await computePackagePreview(pkg);
    res.json({ preview });
  } catch (err) {
    console.error('Erro ao calcular preview do pacote:', err);
    res.status(500).json({ error: 'Erro interno ao calcular preview.' });
  }
});

app.post('/api/packages', async (req, res) => {
  try {
    const title = String(req.body.title || '').trim();
    const type = String(req.body.type || 'mensal').trim();
    const porte = String(req.body.porte || '').trim();
    const validity_days = Number(req.body.validity_days || 30);
    const bath_qty = Number(req.body.bath_qty || 0);
    const bath_discount_percent = Number(req.body.bath_discount_percent || 0);
    const bath_service_id = Number(req.body.bath_service_id || 0);
    const is_active = (String(req.body.is_active ?? 'true') === 'true');
    const includes_json = Array.isArray(req.body.includes) ? req.body.includes : (Array.isArray(req.body.includes_json) ? req.body.includes_json : []);

    if (!title || !porte || !bath_service_id || !Number.isFinite(bath_qty) || bath_qty <= 0) {
      return res.status(400).json({ error: 'title, porte, bath_service_id e bath_qty são obrigatórios.' });
    }

    const row = await db.get(
      `INSERT INTO service_packages
       (title, type, porte, validity_days, bath_qty, bath_discount_percent, bath_service_id, includes_json, is_active, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
       RETURNING *`,
      [title, type, porte, validity_days, bath_qty, bath_discount_percent, bath_service_id, JSON.stringify(includes_json), is_active]
    );
    const preview = await computePackagePreview(row);
    res.json({ package: { ...row, preview } });
  } catch (err) {
    console.error('Erro ao criar package:', err);
    res.status(500).json({ error: 'Erro interno ao criar pacote.' });
  }
});

app.put('/api/packages/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const title = String(req.body.title || '').trim();
    const type = String(req.body.type || 'mensal').trim();
    const porte = String(req.body.porte || '').trim();
    const validity_days = Number(req.body.validity_days || 30);
    const bath_qty = Number(req.body.bath_qty || 0);
    const bath_discount_percent = Number(req.body.bath_discount_percent || 0);
    const bath_service_id = Number(req.body.bath_service_id || 0);
    const is_active = (String(req.body.is_active ?? 'true') === 'true');
    const includes_json = Array.isArray(req.body.includes) ? req.body.includes : (Array.isArray(req.body.includes_json) ? req.body.includes_json : []);

    if (!id || !title || !porte || !bath_service_id || !Number.isFinite(bath_qty) || bath_qty <= 0) {
      return res.status(400).json({ error: 'id, title, porte, bath_service_id e bath_qty são obrigatórios.' });
    }

    const row = await db.get(
      `UPDATE service_packages
       SET title=$2, type=$3, porte=$4, validity_days=$5, bath_qty=$6, bath_discount_percent=$7,
           bath_service_id=$8, includes_json=$9, is_active=$10, updated_at=NOW()
       WHERE id=$1
       RETURNING *`,
      [id, title, type, porte, validity_days, bath_qty, bath_discount_percent, bath_service_id, JSON.stringify(includes_json), is_active]
    );
    const preview = await computePackagePreview(row);
    res.json({ package: { ...row, preview } });
  } catch (err) {
    console.error('Erro ao atualizar package:', err);
    res.status(500).json({ error: 'Erro interno ao atualizar pacote.' });
  }
});

app.delete('/api/packages/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    // Se houver vendas vinculadas, não pode excluir fisicamente (FK RESTRICT).
    // Para não perder histórico, fazemos "desativação" do pacote.
    const ref = await db.get('SELECT COUNT(1)::int AS cnt FROM package_sales WHERE package_id = $1', [id]);
    const cnt = ref && Number(ref.cnt || 0) ? Number(ref.cnt || 0) : 0;

    if (cnt > 0) {
      await db.run('UPDATE service_packages SET is_active = false WHERE id = $1', [id]);
      return res.json({
        ok: true,
        deleted: false,
        deactivated: true,
        message: 'Pacote possui vendas registradas e foi desativado (não pode ser excluído).'
      });
    }

    await db.run('DELETE FROM service_packages WHERE id = $1', [id]);
    res.json({ ok: true, deleted: true });
  } catch (err) {
    // Fallback: caso haja corrida e o FK dispare no DELETE
    if (err && (err.code === '23001' || err.constraint === 'package_sales_package_id_fkey')) {
      try {
        const id = Number(req.params.id);
        if (id) await db.run('UPDATE service_packages SET is_active = false WHERE id = $1', [id]);
        return res.json({
          ok: true,
          deleted: false,
          deactivated: true,
          message: 'Pacote possui vendas registradas e foi desativado (não pode ser excluído).'
        });
      } catch (_) {}
    }
    console.error('Erro ao deletar package:', err);
    res.status(500).json({ error: 'Erro interno ao excluir pacote.' });
  }
});

/* =========================
   PACKAGE SALES (fechar pacote e gerar agenda)
========================= */

app.post('/api/package-sales', async (req, res) => {
  try {
    const customer_id = Number(req.body.customer_id);
    const pet_id = req.body.pet_id != null ? Number(req.body.pet_id) : null;
    const package_id = Number(req.body.package_id);
    const start_date = String(req.body.start_date || '').slice(0,10);
    const time = String(req.body.time || '').slice(0,5);
    const payment_status = String(req.body.payment_status || 'Pago').trim();
    const payment_method = String(req.body.payment_method || '').trim();

    if (!customer_id || !package_id || !start_date || !time) {
      return res.status(400).json({ error: 'customer_id, package_id, start_date e time são obrigatórios.' });
    }

    const pkg = await db.get('SELECT * FROM service_packages WHERE id = $1', [package_id]);
    if (!pkg) return res.status(404).json({ error: 'Pacote não encontrado.' });
    if (!pkg.is_active) return res.status(409).json({ error: 'Pacote inativo.' });

    const preview = await computePackagePreview(pkg);
    const expires_date = addDaysISO(start_date, Number(pkg.validity_days || 30));

    const intervalDays = (String(pkg.type) === 'quinzenal') ? 15 : 7;
    const totalBaths = Number(pkg.bath_qty || 0);

    const bathSvc = await getServiceRow(pkg.bath_service_id);
    if (!bathSvc) return res.status(409).json({ error: 'Serviço de banho do pacote não existe.' });

    const includes = Array.isArray(pkg.includes_json) ? pkg.includes_json : (pkg.includes_json ? JSON.parse(pkg.includes_json) : []);
    const includeIds = includes.map(x => x && x.service_id != null ? Number(x.service_id) : null).filter(Boolean);
    const includeSvcs = await getServicesByIds(includeIds);

    // prepara payloads de agendamento
    const bathDiscountedCents = preview.bath_unit_discounted_cents;

    // transação
    await db.query('BEGIN');

    const sale = await db.get(
      `INSERT INTO package_sales
       (package_id, customer_id, pet_id, porte, start_date, time, expires_date, status, total_cents, payment_status, payment_method)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'vigente',$8,$9,$10)
       RETURNING *`,
      [package_id, customer_id, pet_id, pkg.porte, start_date, time, expires_date, preview.total_pacote_cents, payment_status, payment_method]
    );

    const createdBookings = [];
    for (let i = 0; i < totalBaths; i++) {
      const date_i = addDaysISO(start_date, i * intervalDays);

      // valida capacidade/funcionamento para cada data
      const v = await validateBookingSlot({ date: date_i, time });
      if (!v.ok) {
        await db.query('ROLLBACK');
        return res.status(409).json({ error: `Não foi possível agendar o Banho ${String(i+1).padStart(2,'0')}/${String(totalBaths).padStart(2,'0')} em ${date_i} ${time}: ${v.error}` });
      }

      const services_list = [];
      // banho (com valor do pacote)
      services_list.push({
        id: bathSvc.id,
        title: bathSvc.title,
        value_cents: bathDiscountedCents,
        duration_min: Number(bathSvc.duration_min || 0)
      });

      // inclusos somente no primeiro banho
      if (i === 0) {
        for (const s of includeSvcs) {
          services_list.push({
            id: s.id,
            title: s.title,
            value_cents: 0,
            duration_min: Number(s.duration_min || 0)
          });
        }
      }

      const totCents = services_list.reduce((acc, s) => acc + (Number.isFinite(s.value_cents) ? s.value_cents : 0), 0);
      const totMin = services_list.reduce((acc, s) => acc + (Number.isFinite(s.duration_min) ? s.duration_min : 0), 0);

      const notes = `Pacote: ${pkg.title} — Banho ${String(i+1).padStart(2,'0')}/${String(totalBaths).padStart(2,'0')}`;

      const row = await db.get(
        `INSERT INTO bookings (
          customer_id, pet_id, service_id, service,
          date, time, prize, notes, status, last_notification_at,
          payment_status, payment_method,
          service_value_cents, service_duration_min,
          services_json,
          package_sale_id, package_seq, package_total
        )
        VALUES ($1,$2,$3,$4,$5,$6,'',$7,'confirmado',NULL,$8,$9,$10,$11,$12,$13,$14,$15)
        RETURNING *`,
        [
          customer_id, pet_id, bathSvc.id, bathSvc.title,
          date_i, time, notes,
          payment_status, payment_method,
          totCents, totMin,
          JSON.stringify(services_list),
          sale.id, i+1, totalBaths
        ]
      );
      createdBookings.push(row);
    }

    await db.query('COMMIT');
    res.json({ sale, bookings: createdBookings, preview });
  } catch (err) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    console.error('Erro ao fechar pacote:', err);
    res.status(500).json({ error: 'Erro interno ao fechar pacote.' });
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
      pet_id,
      limit,
      offset
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

    // Paginação opcional (para não quebrar compatibilidade: se não vier `limit`, retorna tudo)
    // Quando `limit` vem, buscamos `limit + 1` para calcular `has_more`.
    const parsedLimit = (limit != null && String(limit).trim() !== '') ? Number(limit) : null;
    const parsedOffset = (offset != null && String(offset).trim() !== '') ? Number(offset) : 0;

    const usePaging = Number.isFinite(parsedLimit) && parsedLimit > 0;
    const safeLimit = usePaging ? Math.min(500, Math.max(1, parsedLimit)) : null;
    const safeOffset = (Number.isFinite(parsedOffset) && parsedOffset >= 0) ? parsedOffset : 0;

    const sqlBase = `
      SELECT
        b.*,
        c.name AS customer_name,
        c.phone AS customer_phone,
        c.phone AS phone,
        c.photo_data AS customer_photo_data,
        pet.name AS pet_name,
        pet.photo_data AS pet_photo_data,

        ps.package_id AS package_id,
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
      LEFT JOIN package_sales ps ON ps.id = b.package_sale_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY b.date DESC, b.time DESC, b.id DESC
    `;

    let sql = sqlBase;
    if (usePaging) {
      // LIMIT/OFFSET com placeholders preservando params já existentes
      params.push(safeLimit + 1); // busca 1 a mais para saber se há mais
      sql += ` LIMIT $${params.length}`;
      params.push(safeOffset);
      sql += ` OFFSET $${params.length}`;
    }

    let rows = await db.all(sql, params);

    if (usePaging) {
      const has_more = rows.length > safeLimit;
      if (has_more) rows = rows.slice(0, safeLimit);
      return res.json({ bookings: rows, limit: safeLimit, offset: safeOffset, has_more });
    }

    res.json({ bookings: rows });
  } catch (err) {
    console.error('Erro ao listar bookings:', err);
    res.status(500).json({ error: 'Erro interno ao listar agendamentos.' });
  }
});

// Retorna um booking específico (usado para polling do pagamento)
app.get('/api/bookings/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    const { rows } = await db.query('SELECT * FROM bookings WHERE id = $1', [id]);
    const booking = rows[0] || null;
    if (!booking) return res.status(404).json({ error: 'Agendamento não encontrado.' });

    // recuperar nome do cliente/pet para usar na descrição (aparece no extrato)
    let customerName = '';
    let petName = '';
    try {
      const info = await db.query(
        `SELECT c.name AS customer_name, p.name AS pet_name
           FROM bookings b
      LEFT JOIN customers c ON c.id = b.customer_id
      LEFT JOIN pets p ON p.id = b.pet_id
          WHERE b.id = $1
          LIMIT 1`,
        [booking_id]
      );
      if (info.rows && info.rows[0]) {
        customerName = info.rows[0].customer_name || '';
        petName = info.rows[0].pet_name || '';
      }
    } catch (e) {
      // não bloqueia a criação do Pix
    }


    res.json({ booking });
  } catch (err) {
    console.error('Erro ao buscar booking:', err);
    res.status(500).json({ error: 'Erro interno ao buscar agendamento.' });
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

/* =========================
   PAYMENTS (Mercado Pago - PIX)
========================= */

// Cria cobrança Pix no Mercado Pago para um booking
app.post('/api/payments/mercadopago/pix', async (req, res) => {
  try {
    const booking_id = Number(req.body.booking_id);
    if (!booking_id) return res.status(400).json({ error: 'booking_id inválido.' });

    // buscar booking e valor
    const { rows } = await db.query('SELECT * FROM bookings WHERE id = $1', [booking_id]);
    const booking = rows[0];
    if (!booking) return res.status(404).json({ error: 'Agendamento não encontrado.' });

    // recuperar nome do cliente/pet para usar na descrição (aparece no extrato)
    let customerName = '';
    let petName = '';
    try {
      const info = await db.query(
        `SELECT c.name AS customer_name, p.name AS pet_name
           FROM bookings b
      LEFT JOIN customers c ON c.id = b.customer_id
      LEFT JOIN pets p ON p.id = b.pet_id
          WHERE b.id = $1
          LIMIT 1`,
        [booking_id]
      );
      if (info.rows && info.rows[0]) {
        customerName = info.rows[0].customer_name || '';
        petName = info.rows[0].pet_name || '';
      }
    } catch (e) {
      // não bloqueia a criação do Pix
    }


    // valor em centavos: preferir totals já salvos, senão somar services_json
    let valueCents = booking.service_value_cents;
    if (valueCents == null) {
      try {
        const arr = Array.isArray(booking.services_json) ? booking.services_json : (booking.services_json ? JSON.parse(booking.services_json) : []);
        if (Array.isArray(arr) && arr.length) {
          valueCents = arr.reduce((acc, it) => acc + Number(it.value_cents || 0), 0);
        }
      } catch {}
    }
    if (!valueCents || Number(valueCents) <= 0) {
      return res.status(400).json({ error: 'Valor do serviço não definido para este agendamento.' });
    }

    // payer email (Mercado Pago exige)
    const payerEmail = (req.body.payer_email && String(req.body.payer_email).includes('@'))
      ? String(req.body.payer_email).trim()
      // Mercado Pago valida apenas o formato do e-mail. Use um domínio "válido" (com TLD) mesmo que o cliente não informe e-mail.
      : `cliente_${booking.customer_id || 'pf'}@petfunny.com.br`;

    // Webhook callback (notification_url)
    // IMPORTANTE: o Mercado Pago rejeita URLs não públicas (ex.: localhost). Para DEV use um túnel (ngrok)
    // e configure MP_WEBHOOK_URL; se não estiver configurado, omitimos o campo e você pode usar o webhook padrão do painel.
    let notificationUrl = process.env.MP_WEBHOOK_URL ? String(process.env.MP_WEBHOOK_URL).trim() : '';
    if (notificationUrl && (!isValidHttpUrl(notificationUrl) || isLocalhostUrl(notificationUrl))) {
      notificationUrl = '';
    }

    const payload = {
      transaction_amount: Number(valueCents) / 100,
      description: `PetFunny - ${customerName || 'Cliente'}${petName ? ' / ' + petName : ''} - Agendamento #${booking_id}`,
      payment_method_id: 'pix',
      payer: { email: payerEmail },
      external_reference: String(booking_id)
    };
    if (notificationUrl) payload.notification_url = notificationUrl;

    const payment = await mpFetch('/v1/payments', {
      method: 'POST',
      headers: {
        // Idempotency avoids duplicate Pix charges if the user retries.
        'X-Idempotency-Key': makeMpIdempotencyKey(`booking:${booking_id}`)
      },
      body: JSON.stringify(payload)
    });

    const tx = payment && payment.point_of_interaction && payment.point_of_interaction.transaction_data
      ? payment.point_of_interaction.transaction_data
      : {};

    const mp_payment_id = payment.id ? String(payment.id) : null;
    const mp_status = payment.status ? String(payment.status) : null;
    const mp_qr_code = tx.qr_code ? String(tx.qr_code) : null;
    const mp_qr_code_base64 = tx.qr_code_base64 ? String(tx.qr_code_base64) : null;

    await db.query(
      `UPDATE bookings
         SET payment_method = 'pix',
             payment_status = CASE WHEN payment_status = 'Pago' THEN payment_status ELSE 'Aguardando pagamento' END,
             mp_payment_id = $2,
             mp_status = $3,
             mp_qr_code = $4,
             mp_qr_code_base64 = $5
       WHERE id = $1`,
      [booking_id, mp_payment_id, mp_status, mp_qr_code, mp_qr_code_base64]
    );

    res.json({
      booking_id,
      mp_payment_id,
      status: mp_status,
      qr_code: mp_qr_code,
      qr_code_base64: mp_qr_code_base64
    });
  } catch (err) {
    console.error('Erro ao criar Pix Mercado Pago:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erro ao criar Pix.', mp_code: err.mp_code || null });
  }
});


// Sincroniza status do Pix (útil em DEV/local quando webhook não chega)
app.get('/api/payments/mercadopago/bookings/:id/sync', async (req, res) => {
  try {
    const bookingId = Number(req.params.id);
    if (!bookingId) return res.status(400).json({ error: 'id inválido.' });

    const { rows } = await db.query('SELECT * FROM bookings WHERE id = $1', [bookingId]);
    const booking = rows[0];
    if (!booking) return res.status(404).json({ error: 'Agendamento não encontrado.' });

    // se não existe pagamento, apenas retorna booking
    if (!booking.mp_payment_id) return res.json({ booking });

    const payment = await mpFetch(`/v1/payments/${booking.mp_payment_id}`, { method: 'GET' });
    const status = payment && payment.status ? String(payment.status) : '';

    const isApproved = status === 'approved';
    const isPending = status === 'pending' || status === 'in_process';
    const isRejected = status === 'rejected' || status === 'cancelled';

    const payment_status = isApproved ? 'Pago'
      : isRejected ? 'Recusado'
      : isPending ? 'Aguardando pagamento'
      : (status ? status : (booking.payment_status || 'Aguardando pagamento'));

    const booking_status = isApproved ? 'Confirmado' : (booking.status || 'agendado');

    await db.query(
      `UPDATE bookings
         SET mp_status = $2,
               payment_method = COALESCE(NULLIF(payment_method, ''), 'pix'),
             payment_status = $3,
             status = $4,
             mp_paid_at = CASE WHEN $5 THEN NOW() ELSE mp_paid_at END
       WHERE id = $1`,
      [bookingId, status, payment_status, booking_status, isApproved]
    );

    const { rows: rows2 } = await db.query('SELECT * FROM bookings WHERE id = $1', [bookingId]);
    res.json({ booking: rows2[0] });
  } catch (err) {
    console.error('Erro ao sincronizar pagamento Mercado Pago:', err);
    res.status(500).json({ error: 'Erro ao sincronizar pagamento.' });
  }
});

// Webhook Mercado Pago (pagamentos)
app.post('/api/webhooks/mercadopago', async (req, res) => {
  try {
    // Webhook padrão: { data: { id }, type/topic: 'payment'/'payments' }
    // IPN: querystring ?id=...&topic=payment
    const paymentId =
      (req.body && req.body.data && (req.body.data.id || req.body.data.payment_id)) ||
      (req.query && (req.query.id || req.query['data.id']));

    if (!paymentId) {
      return res.status(200).json({ ok: true });
    }

    const payment = await mpFetch(`/v1/payments/${paymentId}`, { method: 'GET' });
    const status = payment && payment.status ? String(payment.status) : '';
    const externalRef = payment && payment.external_reference ? String(payment.external_reference) : null;

    // localizar booking por mp_payment_id (preferível) ou external_reference
    let booking = null;
    let bookingId = null;

    const byMp = await db.query('SELECT * FROM bookings WHERE mp_payment_id = $1 LIMIT 1', [String(paymentId)]);
    booking = byMp.rows[0] || null;

    if (!booking && externalRef && String(externalRef).match(/^\d+$/)) {
      const byExt = await db.query('SELECT * FROM bookings WHERE id = $1 LIMIT 1', [Number(externalRef)]);
      booking = byExt.rows[0] || null;
    }

    if (booking) {
      bookingId = booking.id;

      const isApproved = status === 'approved';
      const isPending = status === 'pending' || status === 'in_process';
      const isRejected = status === 'rejected' || status === 'cancelled';

      const payment_status = isApproved ? 'Pago'
        : isRejected ? 'Recusado'
        : isPending ? 'Aguardando pagamento'
        : (status ? status : 'Aguardando pagamento');

      const booking_status = isApproved ? 'Confirmado'
        : (booking.status || 'agendado');

      await db.query(
        `UPDATE bookings
           SET mp_status = $2,
               payment_method = COALESCE(payment_method, 'pix'),
               payment_status = $3,
               status = $4,
               mp_paid_at = CASE WHEN $5 THEN NOW() ELSE mp_paid_at END
         WHERE id = $1`,
        [bookingId, status, payment_status, booking_status, isApproved]
      );
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Erro no webhook Mercado Pago:', err);
    // Mercado Pago recomenda responder 200 para não ficar repetindo indefinidamente
    res.status(200).json({ ok: true });
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

// =========================
// FINANCEIRO (Admin)
// MVP: consolida recebíveis a partir de Agendamentos (bookings) e Vendas de Pacotes (package_sales)
// Não altera nenhuma regra de negócio existente; apenas leitura.
// =========================

function _normalizePayStatus(s) {
  const v = String(s || '').trim();
  // Mantém compatibilidade com diferentes grafias no banco/UI
  if (!v) return 'Aguardando';
  if (/pago/i.test(v)) return 'Pago';
  if (/n[aã]o\s*pago|não\s*pago|nao\s*pago|não pago/i.test(v)) return 'Não Pago';
  if (/aguardando/i.test(v) || /pendente/i.test(v) || /^\.\.\.$/.test(v)) return 'Aguardando';
  if (/recusado|rejeitado|falhou|cancelado/i.test(v)) return 'Recusado';
  return v;
}

function _financeRangeWhere(alias, from, to, params, col = 'date') {
  // alias: tabela alias que possui a coluna de data (YYYY-MM-DD)
  // col: nome da coluna de data (default: 'date')
  const parts = [];
  if (from) { params.push(from); parts.push(`${alias}.${col} >= $${params.length}`); }
  if (to) { params.push(to); parts.push(`${alias}.${col} <= $${params.length}`); }
  return parts.length ? ('WHERE ' + parts.join(' AND ')) : '';
}

app.get('/api/finance/transactions', async (req, res) => {
  try {
    const from = (req.query.from ? String(req.query.from) : '').trim();
    const to = (req.query.to ? String(req.query.to) : '').trim();

    const params = [];
    const whereBookings = _financeRangeWhere('b', from, to, params, 'date');
    const whereSales = _financeRangeWhere('ps', from, to, params, 'start_date');
    const whereEntries = _financeRangeWhere('fe', from, to, params, 'date');

    const sql = `
      SELECT
        b.date AS date,
        'Agendamento' AS type,
        c.name AS customer_name,
        p.name AS pet_name,
        COALESCE(b.service, '') AS description,
         '' AS category,
        COALESCE(b.payment_method, '') AS payment_method,
        COALESCE(b.payment_status, 'Aguardando') AS payment_status,
        COALESCE(
        b.service_value_cents,
        (SELECT COALESCE(SUM(NULLIF((x->>'value_cents'), '')::int),0) FROM jsonb_array_elements(COALESCE(b.services_json,'[]'::jsonb)) x),
        0
      ) AS amount_cents,
        b.id AS ref_id
      FROM bookings b
      LEFT JOIN customers c ON c.id = b.customer_id
      LEFT JOIN pets p ON p.id = b.pet_id
      ${whereBookings}

      UNION ALL

      SELECT
        ps.start_date AS date,
        'Pacote' AS type,
        c2.name AS customer_name,
        p2.name AS pet_name,
        COALESCE(sp.title, 'Pacote') AS description,
         '' AS category,
        COALESCE(ps.payment_method, '') AS payment_method,
        COALESCE(ps.payment_status, 'Aguardando') AS payment_status,
        COALESCE(ps.total_cents, 0) AS amount_cents,
        ps.id AS ref_id
      FROM package_sales ps
      LEFT JOIN customers c2 ON c2.id = ps.customer_id
      LEFT JOIN pets p2 ON p2.id = ps.pet_id
      LEFT JOIN service_packages sp ON sp.id = ps.package_id
      ${whereSales}

      UNION ALL

      SELECT
        fe.date AS date,
        COALESCE(fe.type, 'Lançamento') AS type,
        c3.name AS customer_name,
        p3.name AS pet_name,
        COALESCE(NULLIF(TRIM(fe.description), ''), NULLIF(TRIM(fe.category), ''), 'Lançamento') AS description,
         COALESCE(fe.category,'') AS category,
        COALESCE(fe.payment_method, '') AS payment_method,
        COALESCE(fe.payment_status, 'Aguardando') AS payment_status,
        COALESCE(fe.amount_cents, 0) AS amount_cents,
        fe.id AS ref_id
      FROM finance_entries fe
      LEFT JOIN customers c3 ON c3.id = fe.customer_id
      LEFT JOIN pets p3 ON p3.id = fe.pet_id
      ${whereEntries}

      ORDER BY date DESC, ref_id DESC
      LIMIT 1000;
    `;

    const r = await db.query(sql, params);
    const rows = (r && r.rows) ? r.rows : [];
    // normaliza status (para bater com UI)
    rows.forEach(row => { row.payment_status = _normalizePayStatus(row.payment_status); });
    res.json(rows);
  } catch (e) {
    console.error('GET /api/finance/transactions error:', e);
    res.status(500).json({ error: 'Erro ao carregar transações do financeiro.' });
  }
});

app.get('/api/finance/summary', async (req, res) => {
  try {
    const from = (req.query.from ? String(req.query.from) : '').trim();
    const to = (req.query.to ? String(req.query.to) : '').trim();

    const params = [];
    const whereBookings = _financeRangeWhere('b', from, to, params, 'date');
    const whereSales = _financeRangeWhere('ps', from, to, params, 'start_date');
    const whereEntries = _financeRangeWhere('fe', from, to, params, 'date');

    const sql = `
      WITH tx AS (
        SELECT
          COALESCE(b.payment_status, 'Aguardando') AS payment_status,
          COALESCE(
        b.service_value_cents,
        (SELECT COALESCE(SUM(NULLIF((x->>'value_cents'), '')::int),0) FROM jsonb_array_elements(COALESCE(b.services_json,'[]'::jsonb)) x),
        0
      ) AS amount_cents
        FROM bookings b
        ${whereBookings}

        UNION ALL

        SELECT
          COALESCE(ps.payment_status, 'Aguardando') AS payment_status,
          COALESCE(ps.total_cents, 0) AS amount_cents
        FROM package_sales ps
        ${whereSales}

        UNION ALL

        SELECT
          COALESCE(fe.payment_status, 'Aguardando') AS payment_status,
          COALESCE(fe.amount_cents, 0) AS amount_cents
        FROM finance_entries fe
        ${whereEntries}
      )
      SELECT
        SUM(CASE WHEN payment_status ILIKE '%Pago%' THEN amount_cents ELSE 0 END) AS paid_cents,
        SUM(CASE WHEN payment_status ILIKE '%Aguardando%' OR payment_status ILIKE '%Pendente%' OR payment_status = '...' THEN amount_cents ELSE 0 END) AS pending_cents,
        SUM(CASE WHEN payment_status ILIKE '%Não Pago%' OR payment_status ILIKE '%Nao Pago%' THEN amount_cents ELSE 0 END) AS unpaid_cents,
        SUM(CASE WHEN payment_status ILIKE '%Recus%' OR payment_status ILIKE '%Rejeit%' OR payment_status ILIKE '%Falh%' THEN amount_cents ELSE 0 END) AS rejected_cents,
        SUM(amount_cents) AS total_cents
      FROM tx;
    `;

    const r = await db.query(sql, params);
    const row = (r && r.rows && r.rows[0]) ? r.rows[0] : {};
    res.json(row);
  } catch (e) {
    console.error('GET /api/finance/summary error:', e);
    res.status(500).json({ error: 'Erro ao carregar resumo do financeiro.' });
  }
});

// =========================
// FINANCEIRO: lançamentos manuais (finance_entries)
// Passo 1 da evolução: criar lançamento via modal no Admin.
// =========================

app.get('/api/finance/entries', async (req, res) => {
  try {
    const from = (req.query.from ? String(req.query.from) : '').trim();
    const to = (req.query.to ? String(req.query.to) : '').trim();
    const params = [];
    const where = _financeRangeWhere('fe', from, to, params, 'date');
    const sql = `
      SELECT
        fe.*,
        c.name AS customer_name,
        p.name AS pet_name
      FROM finance_entries fe
      LEFT JOIN customers c ON c.id = fe.customer_id
      LEFT JOIN pets p ON p.id = fe.pet_id
      ${where}
      ORDER BY fe.date DESC, fe.id DESC
      LIMIT 1000;
    `;
    const r = await db.query(sql, params);
    const rows = (r && r.rows) ? r.rows : [];
    rows.forEach(row => { row.payment_status = _normalizePayStatus(row.payment_status); });
    res.json(rows);
  } catch (e) {
    console.error('GET /api/finance/entries error:', e);
    res.status(500).json({ error: 'Erro ao carregar lançamentos.' });
  }
});

app.post('/api/finance/entries', async (req, res) => {
  try {
    const date = String(req.body.date || '').trim();
    const type = String(req.body.type || 'Lançamento').trim();
    const category = String(req.body.category || '').trim();
    const description = String(req.body.description || '').trim();
    const payment_method = String(req.body.payment_method || '').trim();
    const payment_status = _normalizePayStatus(req.body.payment_status);
    const amount_cents = Number(req.body.amount_cents || 0);
    const customer_id = (req.body.customer_id == null || req.body.customer_id === '') ? null : Number(req.body.customer_id);
    const pet_id = (req.body.pet_id == null || req.body.pet_id === '') ? null : Number(req.body.pet_id);

    if (!date) return res.status(400).json({ error: 'Data é obrigatória.' });
    if (!Number.isFinite(amount_cents) || amount_cents <= 0) return res.status(400).json({ error: 'Valor inválido.' });

    const sql = `
      INSERT INTO finance_entries
        (date, type, category, description, amount_cents, payment_method, payment_status, customer_id, pet_id)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *;
    `;
    const params = [date, type, category, description, Math.round(amount_cents), payment_method, payment_status, customer_id, pet_id];
    const r = await db.query(sql, params);
    res.json({ ok: true, entry: (r && r.rows && r.rows[0]) ? r.rows[0] : null });
  } catch (e) {
    console.error('POST /api/finance/entries error:', e);
    res.status(500).json({ error: 'Erro ao salvar lançamento.' });
  }
});



// Atualizar lançamento manual
app.put('/api/finance/entries/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    const date = String(req.body.date || '').trim();
    const type = String(req.body.type || 'Lançamento').trim();
    const category = String(req.body.category || '').trim();
    const description = String(req.body.description || '').trim();
    const payment_method = String(req.body.payment_method || '').trim();
    const payment_status = _normalizePayStatus(req.body.payment_status);
    const amount_cents = Number(req.body.amount_cents || 0);

    if (!date) return res.status(400).json({ error: 'Data é obrigatória.' });
    if (!Number.isFinite(amount_cents) || amount_cents <= 0) return res.status(400).json({ error: 'Valor inválido.' });

    const sql = `
      UPDATE finance_entries
      SET
        date=$2,
        type=$3,
        category=$4,
        description=$5,
        amount_cents=$6,
        payment_method=$7,
        payment_status=$8
      WHERE id=$1
      RETURNING *;
    `;
    const params = [id, date, type, category, description, Math.round(amount_cents), payment_method, payment_status];
    const r = await db.query(sql, params);
    const row = (r && r.rows && r.rows[0]) ? r.rows[0] : null;
    if (!row) return res.status(404).json({ error: 'Lançamento não encontrado.' });

    res.json({ ok: true, entry: row });
  } catch (e) {
    console.error('PUT /api/finance/entries/:id error:', e);
    res.status(500).json({ error: 'Erro ao atualizar lançamento.' });
  }
});

// Excluir lançamento manual
app.delete('/api/finance/entries/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    const r = await db.query('DELETE FROM finance_entries WHERE id=$1 RETURNING id', [id]);
    const row = (r && r.rows && r.rows[0]) ? r.rows[0] : null;
    if (!row) return res.status(404).json({ error: 'Lançamento não encontrado.' });

    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/finance/entries/:id error:', e);
    res.status(500).json({ error: 'Erro ao excluir lançamento.' });
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
    const q = String(req.query.q || '').trim().toLowerCase();
    const onlyActive = String(req.query.active || '').trim() === '1';
    const at = req.query.at ? String(req.query.at) : null; // ISO opcional (timestamptz)

    // - active=1 => apenas mimos ativos e dentro do período (starts_at/ends_at)
    // - q=...    => filtra por título/descrição (pode ser combinado com active=1)
    const like = q ? `%${q}%` : '';

    const rows = await db.all(
      `SELECT id, title, description, value_cents, starts_at, ends_at, is_active, created_at, updated_at
       FROM mimos
       WHERE
         ($1::text = '' OR LOWER(title) LIKE $2 OR LOWER(description) LIKE $2)
         AND ($3::boolean = FALSE OR (
           is_active = TRUE
           AND (starts_at IS NULL OR starts_at <= COALESCE($4::timestamptz, NOW()))
           AND (ends_at   IS NULL OR ends_at   >= COALESCE($4::timestamptz, NOW()))
         ))
       ORDER BY is_active DESC, COALESCE(starts_at, '1970-01-01') DESC, id DESC`,
      [q, like, onlyActive, at]
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
   AUTOMATION (WhatsApp)
========================= */

app.get('/api/automation/rules', async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT r.*, t.code AS template_code
      FROM automation_rules r
      LEFT JOIN message_templates t ON t.id = r.template_id
      ORDER BY r.id
    `);
    res.json({ rules: rows });
  } catch (err) {
    console.error('Erro ao listar automation_rules:', err);
    res.status(500).json({ error: 'Erro interno ao buscar regras.' });
  }
});

app.put('/api/automation/rules/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    const body = req.body || {};
    const is_enabled = !!body.is_enabled;
    const name = String(body.name || '').trim();
    const trigger = String(body.trigger || '').trim();
    const delay_minutes = Number.isFinite(Number(body.delay_minutes)) ? Number(body.delay_minutes) : 0;
    const cooldown_days = Number.isFinite(Number(body.cooldown_days)) ? Number(body.cooldown_days) : 0;
    const template_id = body.template_id == null ? null : Number(body.template_id);
    const audience_filter = body.audience_filter && typeof body.audience_filter === 'object'
      ? body.audience_filter
      : {};

    const existing = await db.get('SELECT * FROM automation_rules WHERE id=$1', [id]);
    if (!existing) return res.status(404).json({ error: 'Regra não encontrada.' });

    const upd = await db.get(
      `UPDATE automation_rules
       SET is_enabled=$2,
           name=COALESCE(NULLIF($3,''), name),
           trigger=COALESCE(NULLIF($4,''), trigger),
           delay_minutes=$5,
           cooldown_days=$6,
           audience_filter=$7,
           template_id=$8,
           updated_at=NOW()
       WHERE id=$1
       RETURNING *`,
      [id, is_enabled, name, trigger, delay_minutes, cooldown_days, JSON.stringify(audience_filter), template_id]
    );

    res.json({ rule: upd });
  } catch (err) {
    console.error('Erro ao atualizar automation_rules:', err);
    res.status(500).json({ error: 'Erro interno ao salvar regra.' });
  }
});

app.get('/api/automation/templates', async (req, res) => {
  try {
    const rows = await db.all(`SELECT * FROM message_templates ORDER BY id;`);
    res.json({ templates: rows });
  } catch (err) {
    console.error('Erro ao listar message_templates:', err);
    res.status(500).json({ error: 'Erro interno ao buscar templates.' });
  }
});

app.put('/api/automation/templates/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    const body = req.body || {};
    const code = String(body.code || '').trim();
    const channel = String(body.channel || 'whatsapp').trim() || 'whatsapp';
    const templateBody = String(body.body || '').trim();
    if (!templateBody) return res.status(400).json({ error: 'Body é obrigatório.' });

    const existing = await db.get('SELECT * FROM message_templates WHERE id=$1', [id]);
    if (!existing) return res.status(404).json({ error: 'Template não encontrado.' });

    const upd = await db.get(
      `UPDATE message_templates
       SET code = COALESCE(NULLIF($2,''), code),
           channel = COALESCE(NULLIF($3,''), channel),
           body = $4,
           updated_at = NOW()
       WHERE id=$1
       RETURNING *`,
      [id, code, channel, templateBody]
    );

    res.json({ template: upd });
  } catch (err) {
    console.error('Erro ao atualizar message_templates:', err);
    res.status(500).json({ error: 'Erro interno ao salvar template.' });
  }
});



/* =========================
   EVENTS → QUEUE → WHATSAPP (MVP manual link)
   - POST /api/events
   - Gera message_queue automaticamente a partir de automation_rules + message_templates
   - Worker (setInterval) processa fila e gera link wa.me (envio manual no MVP)
   - Opt-out real por resposta "PARAR" (POST /api/whatsapp/inbound)
========================= */

function stripDiacritics(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function normalizeCommand(text) {
  return stripDiacritics(String(text || ''))
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function normalizeWhatsAppPhone(phoneDigits) {
  const d = sanitizePhone(phoneDigits);
  if (!d) return null;
  // Brasil: se vier sem DDI (55), prefixa.
  if (d.length === 11 && !d.startsWith('55')) return '55' + d;
  if (d.length === 10 && !d.startsWith('55')) return '55' + d; // sem 9º dígito (legado)
  // se já vier com 55 (13) ou outro padrão, mantém
  return d;
}

function formatDateBr(isoYmd) {
  const s = String(isoYmd || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function safeJsonArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try {
    const j = typeof v === 'string' ? JSON.parse(v) : v;
    return Array.isArray(j) ? j : [];
  } catch (_) {
    return [];
  }
}

function renderTemplateBody(body, vars) {
  const tpl = String(body || '');
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const v = vars && Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : '';
    return (v == null) ? '' : String(v);
  });
}

async function buildContextForEvent(eventType, payload) {
  // payload pode conter booking_id / customer_id / pet_id etc.
  const ctx = {
    event_type: eventType,
    ref_code: '',
    customer_name: '',
    pet_name: '',
    service_summary: '',
    date_br: '',
    time_br: '',
    days_since_last: '',
  };

  const bookingId = payload?.booking_id != null ? Number(payload.booking_id) : null;
  const customerId = payload?.customer_id != null ? Number(payload.customer_id) : null;

  if (bookingId) {
    const b = await db.get(
      `SELECT b.*, c.id AS customer_id, c.name AS customer_name, c.phone AS customer_phone,
              p.name AS pet_name
         FROM bookings b
         JOIN customers c ON c.id = b.customer_id
         LEFT JOIN pets p ON p.id = b.pet_id
        WHERE b.id = $1`,
      [bookingId]
    );
    if (b) {
      ctx.customer_name = b.customer_name || '';
      ctx.pet_name = b.pet_name || '';
      ctx.date_br = formatDateBr(b.date);
      ctx.time_br = String(b.time || '').slice(0, 5);
      ctx.ref_code = String(b.customer_id || '');

      // service summary (prioridade: services_json -> booking_services -> texto legado)
      let labels = [];
      const sj = safeJsonArray(b.services_json);
      for (const it of sj) {
        const t = (it && (it.title || it.label || it.name)) ? String(it.title || it.label || it.name) : '';
        if (t.trim()) labels.push(t.trim());
      }

      if (labels.length === 0) {
        const rows = await db.all(
          `SELECT s.title
             FROM booking_services bs
             JOIN services s ON s.id = bs.service_id
            WHERE bs.booking_id = $1
            ORDER BY s.title`,
          [bookingId]
        );
        labels = rows.map(r => String(r.title || '').trim()).filter(Boolean);
      }

      if (labels.length === 0 && b.service) labels = [String(b.service).trim()].filter(Boolean);

      ctx.service_summary = labels.join(', ');

      // dias desde último agendamento (best-effort: último concluído/confirmado anterior)
      try {
        const last = await db.get(
          `SELECT b2.date
             FROM bookings b2
            WHERE b2.customer_id = $1
              AND b2.id <> $2
              AND COALESCE(b2.status,'') IN ('concluido','concluído','finalizado','confirmado')
            ORDER BY b2.created_at DESC
            LIMIT 1`,
          [Number(b.customer_id), bookingId]
        );
        if (last?.date && /^\d{4}-\d{2}-\d{2}$/.test(String(last.date))) {
          const d1 = new Date(String(last.date) + 'T00:00:00');
          const d2 = new Date(String(b.date) + 'T00:00:00');
          const diff = Math.round((d2 - d1) / (24 * 3600 * 1000));
          if (Number.isFinite(diff) && diff >= 0) ctx.days_since_last = String(diff);
        }
      } catch (_) {}
    }
  }

  // fallback: customer_id direto
  if (!ctx.customer_name && customerId) {
    const c = await db.get(`SELECT id, name, phone FROM customers WHERE id=$1`, [customerId]);
    if (c) {
      ctx.customer_name = c.name || '';
      ctx.ref_code = String(c.id || '');
    }
  }

  return ctx;
}

async function shouldSkipByCooldown({ customer_id, rule_id, cooldown_days }) {
  const cd = Number(cooldown_days || 0);
  if (!customer_id || !rule_id || !cd) return false;
  const row = await db.get(
    `SELECT 1
       FROM message_delivery_log
      WHERE customer_id = $1
        AND rule_id = $2
        AND sent_at >= (NOW() - ($3::text || ' days')::interval)
      LIMIT 1`,
    [Number(customer_id), Number(rule_id), cd]
  );
  return !!row;
}

async function enqueueForEvent(eventRow) {
  const eventType = String(eventRow.type || '').trim();
  const payload = eventRow.payload || {};

  const rules = await db.all(
    `SELECT r.*, t.body AS template_body, t.channel AS template_channel
       FROM automation_rules r
       JOIN message_templates t ON t.id = r.template_id
      WHERE r.is_enabled = TRUE
        AND r.trigger = $1
      ORDER BY r.id`,
    [eventType]
  );

  if (!rules.length) return { enqueued: 0, skipped: 0 };

  const ctx = await buildContextForEvent(eventType, payload);

  // resolve destinatário
  let customer = null;
  if (payload?.customer_id) {
    customer = await db.get(`SELECT * FROM customers WHERE id=$1`, [Number(payload.customer_id)]);
  } else if (payload?.booking_id) {
    customer = await db.get(
      `SELECT c.*
         FROM bookings b
         JOIN customers c ON c.id = b.customer_id
        WHERE b.id = $1`,
      [Number(payload.booking_id)]
    );
  }

  const toPhoneRaw = customer?.phone || payload?.to_phone || payload?.phone || '';
  const toPhone = normalizeWhatsAppPhone(toPhoneRaw);
  const customerId = customer?.id || null;

  let enqueued = 0;
  let skipped = 0;

  for (const r of rules) {
    // opt-out
    if (customer?.opt_out_whatsapp) { skipped++; continue; }

    // cooldown
    const skip = await shouldSkipByCooldown({ customer_id: customerId, rule_id: r.id, cooldown_days: r.cooldown_days });
    if (skip) { skipped++; continue; }

    if (!toPhone) { skipped++; continue; }

    const scheduledAt = new Date(Date.now() + (Number(r.delay_minutes || 0) * 60 * 1000));

    const body = renderTemplateBody(r.template_body, {
      ...ctx,
      // aliases comuns
      customer: ctx.customer_name,
      pet: ctx.pet_name,
    });

    const waText = encodeURIComponent(body);
    const waLink = `https://wa.me/${toPhone}?text=${waText}`;

    await db.get(
      `INSERT INTO message_queue
         (channel, status, to_phone, customer_id, rule_id, template_id, event_id, scheduled_at, body, wa_link, provider, meta, created_at, updated_at)
       VALUES
         ('whatsapp','queued',$1,$2,$3,$4,$5,$6,$7,$8,'manual_link',$9,NOW(),NOW())
       RETURNING id`,
      [
        toPhone,
        customerId,
        r.id,
        r.template_id,
        eventRow.id,
        scheduledAt.toISOString(),
        body,
        waLink,
        JSON.stringify({ trigger: eventType, rule_code: r.code })
      ]
    );

    enqueued++;
  }

  return { enqueued, skipped };
}

async function processMessageQueueOnce() {
  const maxPerTick = Number(process.env.QUEUE_WORKER_MAX_PER_TICK || 10);
  const rows = await db.all(
    `UPDATE message_queue q
        SET status='sending', updated_at=NOW()
      WHERE q.id IN (
        SELECT id
          FROM message_queue
         WHERE status = 'queued'
           AND scheduled_at <= NOW()
         ORDER BY scheduled_at ASC, id ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING q.id, q.customer_id, q.to_phone, q.rule_id, q.template_id, q.event_id, q.body, q.wa_link`,
    [maxPerTick]
  );

  for (const m of rows) {
    try {
      // MVP: envio manual via link (marca como "sent" para controle de cooldown e auditoria)
      await db.run(
        `UPDATE message_queue
            SET status='sent', sent_at=NOW(), updated_at=NOW()
          WHERE id=$1`,
        [m.id]
      );

      await db.run(
        `INSERT INTO message_delivery_log
          (customer_id, to_phone, rule_id, template_id, event_id, message_queue_id, status, sent_at, meta)
         VALUES ($1,$2,$3,$4,$5,$6,'sent',NOW(),$7::jsonb)`,
        [
          m.customer_id,
          m.to_phone,
          m.rule_id,
          m.template_id,
          m.event_id,
          m.id,
          JSON.stringify({ provider: 'manual_link', wa_link: m.wa_link || null })
        ]
      );
    } catch (e) {
      await db.run(
        `UPDATE message_queue
            SET status='failed', error=$2, updated_at=NOW()
          WHERE id=$1`,
        [m.id, String(e && e.message ? e.message : e)]
      );
      await db.run(
        `INSERT INTO message_delivery_log
          (customer_id, to_phone, rule_id, template_id, event_id, message_queue_id, status, sent_at, meta)
         VALUES ($1,$2,$3,$4,$5,$6,'failed',NOW(),$7::jsonb)`,
        [
          m.customer_id,
          m.to_phone,
          m.rule_id,
          m.template_id,
          m.event_id,
          m.id,
          JSON.stringify({ error: String(e && e.message ? e.message : e) })
        ]
      );
    }
  }

  return rows.length;
}

// POST /api/events: cria evento e enfileira mensagens
app.post('/api/events', async (req, res) => {
  try {
    const body = req.body || {};
    const type = String(body.type || '').trim();
    if (!type) return res.status(400).json({ error: 'type é obrigatório.' });

    const payload = (body.payload && typeof body.payload === 'object') ? body.payload : {};
    const occurred_at = body.occurred_at ? new Date(body.occurred_at) : new Date();
    if (Number.isNaN(occurred_at.getTime())) return res.status(400).json({ error: 'occurred_at inválido.' });

    const ev = await db.get(
      `INSERT INTO automation_events (type, payload, occurred_at)
       VALUES ($1,$2::jsonb,$3)
       RETURNING *`,
      [type, JSON.stringify(payload), occurred_at.toISOString()]
    );

    const result = await enqueueForEvent(ev);

    res.json({ event: ev, queue: result });
  } catch (err) {
    console.error('Erro ao processar /api/events:', err);
    res.status(500).json({ error: 'Erro interno ao registrar evento.' });
  }
});

// Inbox (webhook) – MVP para capturar respostas e aplicar opt-out por "PARAR"
app.post('/api/whatsapp/inbound', async (req, res) => {
  try {
    const from = normalizeWhatsAppPhone(req.body.from || req.body.phone || '');
    const text = String(req.body.text || req.body.body || '').trim();
    if (!from || !text) return res.status(400).json({ error: 'from e text são obrigatórios.' });

    const cmd = normalizeCommand(text);
    let matched = null;

    if (cmd === 'PARAR') {
      matched = 'PARAR';
      // Atualiza opt-out do cliente (se existir)
      const phoneNoDdi = from.startsWith('55') ? from.slice(2) : from;
      await db.run(
        `UPDATE customers
            SET opt_out_whatsapp = TRUE,
                updated_at = NOW()
          WHERE phone = $1`,
        [phoneNoDdi]
      );

      // Cancela pendências na fila
      await db.run(
        `UPDATE message_queue
            SET status='cancelled', updated_at=NOW(), error=COALESCE(error,'Opt-out PARAR')
          WHERE to_phone = $1
            AND status IN ('queued','sending')`,
        [from]
      );
    }

    await db.run(
      `INSERT INTO whatsapp_inbound (from_phone, body, received_at, matched_command)
       VALUES ($1,$2,NOW(),$3)`,
      [from, text, matched]
    );

    res.json({ ok: true, matched_command: matched });
  } catch (err) {
    console.error('Erro em /api/whatsapp/inbound:', err);
    res.status(500).json({ error: 'Erro interno ao processar inbound.' });
  }
});

// (Opcional, debug): listar fila
app.get('/api/message-queue', async (req, res) => {
  try {
    const status = String(req.query.status || '').trim();
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const params = [];
    let where = '';
    if (status) {
      params.push(status);
      where = `WHERE q.status = $${params.length}`;
    }
    params.push(limit);

    const rows = await db.all(
      `SELECT q.*,
              c.name AS customer_name,
              r.code AS rule_code,
              t.code AS template_code
         FROM message_queue q
         LEFT JOIN customers c ON c.id = q.customer_id
         LEFT JOIN automation_rules r ON r.id = q.rule_id
         LEFT JOIN message_templates t ON t.id = q.template_id
         ${where}
        ORDER BY q.id DESC
        LIMIT $${params.length}`,
      params
    );
    res.json({ queue: rows });
  } catch (err) {
    console.error('Erro ao listar message_queue:', err);
    res.status(500).json({ error: 'Erro interno ao buscar fila.' });
  }
});


/* =========================
   START
========================= */
const port = process.env.PORT || 3000;

(async () => {        
  try {
    await db.initDb();
    app.listen(port, () => {
      console.log('PetFunny API rodando na porta', port);

      // Worker da fila (MVP): marca como "sent" e registra link wa.me
      const enabled = String(process.env.QUEUE_WORKER_ENABLED || 'true').toLowerCase() !== 'false';
      const intervalMs = Math.max(5000, Number(process.env.QUEUE_WORKER_INTERVAL_MS || 15000));
      if (enabled) {
        // primeira passada logo após subir
        processMessageQueueOnce().catch(() => {});
        setInterval(() => {
          processMessageQueueOnce().catch(() => {});
        }, intervalMs);
      }
    });
  } catch (e) {
    console.error('Erro fatal ao inicializar banco:', e);
    process.exit(1);
  }
})();