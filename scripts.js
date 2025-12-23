/* =====================================================================
   PetFunny Admin — scripts.js (COMPLETO)
   PATCH: Valor na listagem + Mimos inline
   DATE: 2025-12-23
===================================================================== */

'use strict';

/* =========================
   ESTADO GLOBAL
========================= */

let currentTab = 'dashboard';
let customersCache = [];
let petsCache = [];
let servicesCache = [];
let mimosCache = [];
let bookingsCache = [];

let lastBookingsFilter = {
  from: null,
  to: null,
  status: '',
  q: '',
};

let currentBookingId = null;

/* =========================
   HELPERS LOCAIS (UI)
========================= */

function qs(sel, root = document) {
  return root.querySelector(sel);
}
function qsa(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDateBR(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function formatTimeBR(time) {
  if (!time) return '';
  return String(time).slice(0, 5);
}

/* =========================
   INIT
========================= */

document.addEventListener('DOMContentLoaded', initApp);

async function initApp() {
  try {
    bindNav();
    bindCommonEvents();

    setLoading(true, 'Carregando dados...');
    await preloadAll();
    setLoading(false);

    goToTab('dashboard');
  } catch (err) {
    console.error(err);
    setLoading(false);
    showToast(err.message || 'Erro ao iniciar', 'error');
  }
}

/* =========================
   LOADING / TOAST
========================= */

function setLoading(show, text) {
  const el = qs('#globalLoading');
  if (!el) return;
  el.classList.toggle('show', show);
  if (text) {
    const t = qs('#globalLoadingText');
    if (t) t.textContent = text;
  }
}

function showToast(msg, type = 'info') {
  alert(msg); // fallback simples (mantém compatibilidade)
}

/* =========================
   PRELOAD
========================= */

async function preloadAll() {
  await Promise.all([
    loadCustomers(),
    loadPets(),
    loadServices(),
    loadMimos(),
    loadBookings({ silent: true }),
  ]);
}

async function loadCustomers() {
  const res = await PF_API.get('/api/customers');
  customersCache = res.customers || [];
}

async function loadPets() {
  const res = await PF_API.get('/api/pets');
  petsCache = res.pets || [];
}

async function loadServices() {
  const res = await PF_API.get('/api/services');
  servicesCache = res.services || [];
}

async function loadMimos() {
  const res = await PF_API.get('/api/mimos');
  mimosCache = res.mimos || [];
}

async function loadBookings({ from, to, status, q, silent } = {}) {
  if (!silent) setLoading(true, 'Carregando agendamentos...');
  lastBookingsFilter = { from, to, status, q };

  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (status) params.set('status', status);
  if (q) params.set('q', q);

  const res = await PF_API.get(`/api/bookings?${params.toString()}`);
  bookingsCache = res.bookings || [];

  if (!silent) setLoading(false);
  refreshBookingsUI();
}

/* =========================
   NAVEGAÇÃO
========================= */

function bindNav() {
  qsa('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      goToTab(btn.dataset.tab);
    });
  });
}

function goToTab(tab) {
  currentTab = tab;
  qsa('.tab').forEach(t => t.classList.remove('active'));
  qs(`#tab-${tab}`)?.classList.add('active');

  if (tab === 'dashboard') loadDashboard();
  if (tab === 'bookings') refreshBookingsUI();
}

/* =========================
   DASHBOARD
========================= */

function loadDashboard() {
  qs('#statBookings').textContent = bookingsCache.length;
  qs('#statCustomers').textContent = customersCache.length;
  qs('#statPets').textContent = petsCache.length;

  let total = 0;
  bookingsCache.forEach(b => {
    total += Number(b.services_total_cents ?? b.value_cents ?? 0);
  });
  qs('#statRevenue').textContent = formatCentsToBRL(total);

  const mimosMap = {};
  bookingsCache.forEach(b => {
    if (b.mimo_id) mimosMap[b.mimo_id] = (mimosMap[b.mimo_id] || 0) + 1;
  });

  const list = Object.entries(mimosMap).map(([id, count]) => {
    const m = mimosCache.find(x => String(x.id) === String(id));
    return `${m ? m.name : 'Mimo'}: ${count}`;
  });

  qs('#statMimosList').textContent =
    (list.length ? list.join(' • ') : '—') + ' — Mimos (ativos no período)';
}

/* =========================
   AGENDAMENTOS (LISTAGEM)
========================= */

function refreshBookingsUI() {
  renderAgendaList();
}

function getBookingValueCents(b) {
  if (b.services_total_cents != null) return Number(b.services_total_cents);
  if (b.value_cents != null) return Number(b.value_cents);

  const svc = servicesCache.find(s => String(s.id) === String(b.service_id));
  return svc ? Number(svc.value_cents) : 0;
}

function renderAgendaList() {
  const tbody = qs('#agendaTbody');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (!bookingsCache.length) {
    tbody.innerHTML = `<tr><td colspan="99">Nenhum agendamento.</td></tr>`;
    return;
  }

  bookingsCache.forEach(b => {
    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td>${formatDateBR(b.date)}</td>
      <td>${formatTimeBR(b.time)}</td>
      <td>${escapeHtml(b.customer_name || '')}</td>
      <td>${escapeHtml(b.pet_name || '')}</td>
      <td>${escapeHtml(b.customer_phone || '')}</td>
      <td>${escapeHtml(getServiceName(b.service_id))}</td>
      <td>${formatCentsToBRL(getBookingValueCents(b))}</td>
      <td>${escapeHtml(getMimoName(b.mimo_id))}</td>
      <td>${escapeHtml(b.status || '')}</td>
      <td>
        <button data-action="edit" data-id="${b.id}">Editar</button>
        <button data-action="del" data-id="${b.id}">Excluir</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function getServiceName(id) {
  const s = servicesCache.find(x => String(x.id) === String(id));
  return s ? s.name : '—';
}

function getMimoName(id) {
  const m = mimosCache.find(x => String(x.id) === String(id));
  return m ? m.name : '—';
}

/* =========================
   EVENTOS
========================= */

function bindCommonEvents() {
  qs('#bookingsFilterBtn')?.addEventListener('click', () => {
    loadBookings({
      from: qs('#bookingsFrom')?.value,
      to: qs('#bookingsTo')?.value,
      status: qs('#bookingsStatus')?.value,
      q: qs('#bookingsQ')?.value,
    });
  });
}
