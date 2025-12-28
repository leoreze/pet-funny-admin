
// server.js (FIXED) — duplicate const declarations removed safely
const path = require('path');
const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

app.use(express.static(__dirname));
app.get(['/admin', '/admin/'], (req, res) => {
  return res.sendFile(path.join(__dirname, 'admin.html'));
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

    const category = String(req.body.category || '').trim();
    const porte = String(req.body.porte || '').trim();
    const duration_min = req.body.duration_min == null ? null : Number(req.body.duration_min);

    if (!date || !title || !category || !porte ||
        !Number.isFinite(value_cents) ||
        (duration_min == null || !Number.isFinite(duration_min) || duration_min <= 0)) {
      return res.status(400).json({
        error: 'date, category, title, porte, duration_min e value_cents são obrigatórios.'
      });
    }

    const row = await db.get(
      `INSERT INTO services (date, category, title, porte, duration_min, value_cents, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       RETURNING *`,
      [date, category, title, porte, duration_min, value_cents]
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

    const category = String(req.body.category || '').trim();
    const porte = String(req.body.porte || '').trim();
    const duration_min = req.body.duration_min == null ? null : Number(req.body.duration_min);

    if (!id || !date || !title || !category || !porte ||
        !Number.isFinite(value_cents) ||
        (duration_min == null || !Number.isFinite(duration_min) || duration_min <= 0)) {
      return res.status(400).json({
        error: 'id, date, category, title, porte, duration_min e value_cents são obrigatórios.'
      });
    }

    const row = await db.get(
      `UPDATE services
         SET date=$2, category=$3, title=$4, porte=$5, duration_min=$6, value_cents=$7, updated_at=NOW()
       WHERE id=$1
       RETURNING *`,
      [id, date, category, title, porte, duration_min, value_cents]
    );
    res.json({ service: row });
  } catch (err) {
    console.error('Erro ao atualizar service:', err);
    res.status(500).json({ error: 'Erro interno ao atualizar serviço.' });
  }
});

module.exports = app;
