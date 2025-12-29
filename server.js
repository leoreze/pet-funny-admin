// backend/server.js — PetFunny
// VERSÃO SEGURA COM FINANCEIRO (READ ONLY)

const path = require('path');
const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

// =========================
// STATIC FILES
// =========================
app.use(express.static(__dirname));

app.get(['/admin', '/admin/'], (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// =========================
// HELPERS INTERNOS
// =========================
function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function isoMonthStart() {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

function getDowFromISODate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.getDay();
}

function timeToMinutes(hhmm) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm || '');
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

// ===================================================================
// =========================  FINANCEIRO  ==============================
// ===================================================================

// -------------------------------------------------------------------
// RESUMO FINANCEIRO (Dashboard Executivo)
// -------------------------------------------------------------------
app.get('/api/finance/summary', async (req, res) => {
  try {
    const today = isoToday();
    const monthStart = isoMonthStart();

    const todayRow = await db.get(`
      SELECT
        COALESCE(SUM(service_value_cents),0) AS revenue_cents,
        COUNT(*) AS bookings
      FROM bookings
      WHERE date = $1
        AND status IN ('concluído','entregue')
    `, [today]);

    const monthRow = await db.get(`
      SELECT
        COALESCE(SUM(service_value_cents),0) AS revenue_cents,
        COUNT(*) AS bookings
      FROM bookings
      WHERE date >= $1
        AND status IN ('concluído','entregue')
    `, [monthStart]);

    const ticketRow = await db.get(`
      SELECT
        CASE WHEN COUNT(*) > 0
        THEN ROUND(SUM(service_value_cents)::numeric / COUNT(*))
        ELSE 0 END AS ticket_avg
      FROM bookings
      WHERE date >= $1
        AND status IN ('concluído','entregue')
    `, [monthStart]);

    res.json({
      today: {
        revenue_cents: Number(todayRow.revenue_cents),
        bookings: Number(todayRow.bookings)
      },
      month: {
        revenue_cents: Number(monthRow.revenue_cents),
        bookings: Number(monthRow.bookings)
      },
      ticket_avg_cents: Number(ticketRow.ticket_avg)
    });
  } catch (err) {
    console.error('Finance summary error:', err);
    res.status(500).json({ error: 'Erro ao gerar resumo financeiro.' });
  }
});

// -------------------------------------------------------------------
// MOVIMENTO DE CAIXA (automático por agendamento)
// -------------------------------------------------------------------
app.get('/api/finance/cashflow', async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT
        b.id,
        b.date,
        b.time,
        c.name AS customer,
        pet.name AS pet,
        COALESCE(b.services_json, '[]'::jsonb) AS services,
        COALESCE(b.service_value_cents,0) AS total_cents,
        b.payment_method,
        b.status
      FROM bookings b
      JOIN customers c ON c.id = b.customer_id
      LEFT JOIN pets pet ON pet.id = b.pet_id
      WHERE b.status <> 'cancelado'
      ORDER BY b.date DESC, b.time DESC
    `);

    res.json({ cashflow: rows });
  } catch (err) {
    console.error('Finance cashflow error:', err);
    res.status(500).json({ error: 'Erro ao carregar caixa.' });
  }
});

// -------------------------------------------------------------------
// PRODUÇÃO DIÁRIA (base para comissão)
// -------------------------------------------------------------------
app.get('/api/finance/production', async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT
        date,
        COUNT(*) AS bookings,
        COALESCE(SUM(service_value_cents),0) AS revenue_cents
      FROM bookings
      WHERE status IN ('concluído','entregue')
      GROUP BY date
      ORDER BY date DESC
    `);

    res.json({ production: rows });
  } catch (err) {
    console.error('Finance production error:', err);
    res.status(500).json({ error: 'Erro ao carregar produção.' });
  }
});

// -------------------------------------------------------------------
// TAXA DE OCUPAÇÃO DA AGENDA
// -------------------------------------------------------------------
app.get('/api/finance/occupancy', async (req, res) => {
  try {
    const date = req.query.date || isoToday();
    const dow = getDowFromISODate(date);

    if (dow === null) {
      return res.status(400).json({ error: 'Data inválida.' });
    }

    const oh = await db.get(`
      SELECT open_time, close_time, max_per_half_hour, is_closed
      FROM opening_hours
      WHERE dow = $1
    `, [dow]);

    if (!oh || oh.is_closed) {
      return res.json({
        date,
        slots_total: 0,
        slots_used: 0,
        occupancy_rate: 0
      });
    }

    const openMin = timeToMinutes(oh.open_time);
    const closeMin = timeToMinutes(oh.close_time);
    const slotsTotal = ((closeMin - openMin) / 30) * oh.max_per_half_hour;

    const usedRow = await db.get(`
      SELECT COUNT(*) AS used
      FROM bookings
      WHERE date = $1
        AND status NOT IN ('cancelado','cancelada')
    `, [date]);

    const used = Number(usedRow.used || 0);
    const rate = slotsTotal > 0 ? Math.round((used / slotsTotal) * 100) : 0;

    res.json({
      date,
      slots_total: slotsTotal,
      slots_used: used,
      occupancy_rate: rate
    });
  } catch (err) {
    console.error('Finance occupancy error:', err);
    res.status(500).json({ error: 'Erro ao calcular ocupação.' });
  }
});

// -------------------------------------------------------------------
// RELATÓRIOS ESTRATÉGICOS (base)
// -------------------------------------------------------------------
app.get('/api/finance/reports/services', async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT
        (s->>'title') AS service,
        COUNT(*) AS qty,
        SUM((s->>'value_cents')::int) AS revenue_cents
      FROM bookings b,
           jsonb_array_elements(b.services_json) s
      WHERE b.status IN ('concluído','entregue')
      GROUP BY service
      ORDER BY qty DESC
    `);

    res.json({ services: rows });
  } catch (err) {
    console.error('Finance services report error:', err);
    res.status(500).json({ error: 'Erro ao gerar relatório.' });
  }
});

// -------------------------------------------------------------------
// EXPORTAÇÃO CSV (contador)
// -------------------------------------------------------------------
app.get('/api/finance/export', async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT
        date,
        service_value_cents,
        payment_method,
        status
      FROM bookings
      WHERE status IN ('concluído','entregue')
      ORDER BY date DESC
    `);

    let csv = 'Data,Valor,Pagamento,Status\n';
    rows.forEach(r => {
      csv += `${r.date},${(r.service_value_cents/100).toFixed(2)},${r.payment_method},${r.status}\n`;
    });

    res.header('Content-Type', 'text/csv');
    res.attachment('financeiro.csv');
    res.send(csv);
  } catch (err) {
    console.error('Finance export error:', err);
    res.status(500).json({ error: 'Erro ao exportar CSV.' });
  }
});

// ===================================================================
// =========================  PORTA  ==================================
// ===================================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('✅ PetFunny server rodando na porta', PORT);
});
