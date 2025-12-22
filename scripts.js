/* scripts.js (ADMIN) */
const API_BASE_URL = '';

/* ===== Helpers de normalização (corrige acentos/variações) ===== */
function normStr(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/* =========================================================
 MIMOS (Admin) - CRUD + Emojis + Valor (cents) + Período
========================================================= */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const elTab = $('tab-mimos');

  const els = {
    title: $('mimoTitle'),
    desc: $('mimoDesc'),
    emojiPanel: $('emojiPanel'),
    value: $('mimoValue'),
    start: $('mimoStart'),
    end: $('mimoEnd'),
    active: $('mimoActive'),
    save: $('btnMimoSave'),
    clear: $('btnMimoClear'),
    reload: $('btnMimosReload'),
    msg: $('mimoMsg'),
    tbody: $('tbodyMimos'),
    empty: $('mimosEmpty'),
    prizeSelect: document.getElementById('formPrize') || null,

    search: $('mimosSearch'),
    btnNovo: $('btnNovoMimo'),
    formWrap: $('mimoFormWrap'),
    btnCloseForm: $('btnFecharMimoForm'),
  };

  let currentEditId = null;
  let cacheMimos = [];

  async function ensureMimosLoaded(force = false) {
    if (!force && Array.isArray(cacheMimos) && cacheMimos.length > 0) {
      syncPrizeSelect();
      return;
    }
    await reloadMimos();
  }

  window.PF_MIMOS = window.PF_MIMOS || {};
  window.PF_MIMOS.ensureLoaded = ensureMimosLoaded;
  window.PF_MIMOS.reload = reloadMimos;
  window.PF_MIMOS.syncSelect = syncPrizeSelect;

  function setMsg(text, isError) {
    if (!els.msg) return;
    els.msg.textContent = text || '';
    els.msg.style.color = isError ? '#c0392b' : '';
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function toDatetimeLocalValue(isoOrTs) {
    if (!isoOrTs) return '';
    const d = new Date(isoOrTs);
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function fromDatetimeLocalValue(v) {
    if (!v) return null;
    const d = new Date(v);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  function parseBRLToCents(input) {
    if (input == null) return 0;
    const s = String(input).replace(/[^\d,.-]/g, '').trim();
    if (!s) return 0;
    const normalized = s.replace(/\./g, '').replace(',', '.');
    const n = Number(normalized);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.round(n * 100));
  }

  function formatCentsToBRL(cents) {
    const v = Number(cents || 0) / 100;
    return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function moneyMaskAttach(inputEl) {
    if (!inputEl) return;
    inputEl.addEventListener('blur', () => {
      const cents = parseBRLToCents(inputEl.value);
      inputEl.value = formatCentsToBRL(cents);
    });
  }

  const EMOJI_LIST = [
    '🎁','🎉','✨','⭐','💎','🏆','🥇','🎯','🔥','✅','🧡','💛','💚','💙','💜',
    '🐶','🐾','🛁','✂️','🧴','🧼','🫧','🦴','🍖','💸','🎟️','📣','📅','🔔','🎡','🎲'
  ];

  function insertAtCursor(textarea, text) {
    if (!textarea) return;
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    textarea.value = before + text + after;
    const newPos = start + text.length;
    textarea.selectionStart = textarea.selectionEnd = newPos;
  }

  function buildEmojiPanel() {
    if (!els.emojiPanel || !els.desc) return;
    els.emojiPanel.innerHTML = '';
    EMOJI_LIST.forEach((e) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = e;
      b.className = 'btn btn-small';
      b.style.padding = '6px 8px';
      b.style.lineHeight = '1';
      b.addEventListener('click', () => {
        insertAtCursor(els.desc, e);
        els.desc.focus();
      });
      els.emojiPanel.appendChild(b);
    });
  }

  function openForm() {
    if (els.formWrap) els.formWrap.style.display = '';
  }
  function closeForm() {
    if (els.formWrap) els.formWrap.style.display = 'none';
  }

  function clearForm() {
    currentEditId = null;
    if (els.title) els.title.value = '';
    if (els.desc) els.desc.value = '';
    if (els.value) els.value.value = formatCentsToBRL(0);
    if (els.start) els.start.value = '';
    if (els.end) els.end.value = '';
    if (els.active) els.active.checked = true;
    setMsg('', false);
  }

  /* ---------- API ---------- */
  async function apiGetMimos() {
    const r = await fetch('/api/mimos', { method: 'GET' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Erro ao buscar mimos.');
    return data.mimos || [];
  }

  async function apiCreateMimo(payload) {
    const r = await fetch('/api/mimos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Erro ao criar mimo.');
    return data.mimo;
  }

  async function apiUpdateMimo(id, payload) {
    const r = await fetch(`/api/mimos/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Erro ao atualizar mimo.');
    return data.mimo;
  }

  async function apiDeleteMimo(id) {
    const r = await fetch(`/api/mimos/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Erro ao excluir mimo.');
    return true;
  }

  /* ---------- Render ---------- */
  function syncPrizeSelect(mimos) {
    const prizeSelect = document.getElementById('formPrize');
    if (!prizeSelect) return;

    const ref = (() => {
      try {
        const fd = document.getElementById('formDate');
        const v = (fd && fd.value) ? String(fd.value).trim() : '';
        if (v) {
          const d = new Date(v + 'T12:00:00');
          if (!isNaN(d.getTime())) return d;
        }
      } catch (_) {}
      return new Date();
    })();

    const isInPeriod = (m) => {
      if (!m.is_active) return false;
      const s = m.starts_at ? new Date(m.starts_at) : null;
      const e = m.ends_at ? new Date(m.ends_at) : null;
      if (s && !isNaN(s.getTime()) && ref < s) return false;
      if (e && !isNaN(e.getTime()) && ref > e) return false;
      return true;
    };

    const active = (mimos || []).filter(isInPeriod);
    const current = prizeSelect.value;

    prizeSelect.innerHTML = '';
    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = '— Sem mimo —';
    prizeSelect.appendChild(opt0);

    active.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.title; // compat: booking.prize é texto
      opt.textContent = `${m.title} (R$ ${formatCentsToBRL(m.value_cents)})`;
      opt.setAttribute('data-mimo-id', String(m.id));
      prizeSelect.appendChild(opt);
    });

    if (current) prizeSelect.value = current;
  }

  function renderMimosTable(mimos) {
    if (!els.tbody) return;
    els.tbody.innerHTML = '';

    const q = (els.search?.value || '').trim().toLowerCase();
    const filtered = !q ? (mimos || []) : (mimos || []).filter(m =>
      String(m.title || '').toLowerCase().includes(q) ||
      String(m.description || '').toLowerCase().includes(q)
    );

    if (!filtered || filtered.length === 0) {
      if (els.empty) els.empty.style.display = '';
      return;
    }
    if (els.empty) els.empty.style.display = 'none';

    const fmt = (d) => {
      if (!d || isNaN(d.getTime())) return '—';
      return d.toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
    };

    filtered.forEach((m) => {
      const tr = document.createElement('tr');

      const tdTitle = document.createElement('td');
      tdTitle.textContent = m.title || '';
      tr.appendChild(tdTitle);

      const tdValue = document.createElement('td');
      tdValue.textContent = `R$ ${formatCentsToBRL(m.value_cents)}`;
      tr.appendChild(tdValue);

      const tdPeriod = document.createElement('td');
      const s = m.starts_at ? new Date(m.starts_at) : null;
      const e = m.ends_at ? new Date(m.ends_at) : null;
      tdPeriod.textContent = `${fmt(s)} → ${fmt(e)}`;
      tr.appendChild(tdPeriod);

      const tdActive = document.createElement('td');
      tdActive.textContent = m.is_active ? 'Sim' : 'Não';
      tr.appendChild(tdActive);

      const tdActions = document.createElement('td');
      tdActions.style.whiteSpace = 'nowrap';

      const btnEdit = document.createElement('button');
      btnEdit.type = 'button';
      btnEdit.className = 'btn btn-small';
      btnEdit.textContent = 'Editar';
      btnEdit.addEventListener('click', () => {
        currentEditId = m.id;
        if (els.title) els.title.value = m.title || '';
        if (els.desc) els.desc.value = m.description || '';
        if (els.value) els.value.value = formatCentsToBRL(m.value_cents);
        if (els.start) els.start.value = toDatetimeLocalValue(m.starts_at);
        if (els.end) els.end.value = toDatetimeLocalValue(m.ends_at);
        if (els.active) els.active.checked = !!m.is_active;
        setMsg(`Editando ID ${m.id}`, false);
        openForm();
      });

      const btnDel = document.createElement('button');
      btnDel.type = 'button';
      btnDel.className = 'btn btn-small btn-danger';
      btnDel.textContent = 'Excluir';
      btnDel.style.marginLeft = '6px';
      btnDel.addEventListener('click', async () => {
        const ok = confirm(`Excluir o mimo "${m.title}"?`);
        if (!ok) return;
        try {
          setMsg('Excluindo...', false);
          await apiDeleteMimo(m.id);
          await reloadMimos();
          setMsg('Mimo excluído.', false);
        } catch (err) {
          setMsg(err.message || 'Erro ao excluir.', true);
        }
      });

      tdActions.appendChild(btnEdit);
      tdActions.appendChild(btnDel);
      tr.appendChild(tdActions);

      els.tbody.appendChild(tr);
    });
  }

  async function reloadMimos() {
    setMsg('Carregando...', false);
    const mimos = await apiGetMimos();
    cacheMimos = mimos;
    renderMimosTable(mimos);
    syncPrizeSelect(mimos);
    setMsg('', false);
  }

  async function handleSave() {
    try {
      setMsg('Salvando...', false);

      const title = (els.title?.value || '').trim();
      const description = (els.desc?.value || '').trim();
      const value_cents = parseBRLToCents(els.value?.value || '0');
      const starts_at = fromDatetimeLocalValue(els.start?.value || '');
      const ends_at = fromDatetimeLocalValue(els.end?.value || '');
      const is_active = !!els.active?.checked;

      if (!title) {
        setMsg('Informe o título.', true);
        els.title?.focus();
        return;
      }

      if (ends_at && starts_at && new Date(ends_at) < new Date(starts_at)) {
        setMsg('A data de término não pode ser menor que a data de início.', true);
        return;
      }

      const payload = { title, description, value_cents, starts_at, ends_at, is_active };

      if (currentEditId) {
        await apiUpdateMimo(currentEditId, payload);
        setMsg('Mimo atualizado.', false);
      } else {
        await apiCreateMimo(payload);
        setMsg('Mimo criado.', false);
      }

      await reloadMimos();
      clearForm();
      closeForm();
    } catch (err) {
      setMsg(err.message || 'Erro ao salvar.', true);
    }
  }

  function attachEvents() {
    moneyMaskAttach(els.value);

    if (els.save) els.save.addEventListener('click', handleSave);
    if (els.clear) els.clear.addEventListener('click', clearForm);
    if (els.reload) els.reload.addEventListener('click', () => reloadMimos().catch(e => setMsg(e.message || 'Erro.', true)));

    if (els.btnNovo) els.btnNovo.addEventListener('click', () => {
      clearForm();
      openForm();
      els.title?.focus();
    });

    if (els.btnCloseForm) els.btnCloseForm.addEventListener('click', () => {
      closeForm();
      setMsg('', false);
    });

    if (els.search) els.search.addEventListener('input', () => {
      renderMimosTable(cacheMimos);
    });

    document.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('.tab-btn[data-tab="tab-mimos"]');
      if (!btn) return;
      reloadMimos().catch(err => setMsg(err.message || 'Erro ao carregar mimos.', true));
    });
  }

  buildEmojiPanel();
  attachEvents();
})();

/* ========= CONTROLE DE SESSÃO (30 MIN) ========= */
const SESSION_KEY = 'pf_admin_session';
const SESSION_DURATION_MS = 30 * 60 * 1000;
const AUTH_KEY = 'pf_admin_auth'; // { token, expiresAt }

function setAuth(token, expiresAt) {
  try { localStorage.setItem(AUTH_KEY, JSON.stringify({ token, expiresAt })); } catch (_) {}
}
function clearAuth() { try { localStorage.removeItem(AUTH_KEY); } catch (_) {} }
function getAuth() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data.token || !data.expiresAt) return null;
    if (Date.now() > Number(data.expiresAt)) { clearAuth(); return null; }
    return data;
  } catch (_) { clearAuth(); return null; }
}
function getAuthToken() {
  const a = getAuth();
  return a && a.token ? String(a.token) : '';
}

let sessionTimerId = null;
let appInitialized = false;

function setSession(user, expiresAt) {
  const session = { user: String(user || 'admin'), expiresAt: Number(expiresAt || (Date.now() + SESSION_DURATION_MS)) };
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (_) {}
}
function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch (_) {} }
function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data.expiresAt || Date.now() > data.expiresAt) { clearSession(); return null; }
    return data;
  } catch (_) { clearSession(); return null; }
}

function handleSessionExpired() {
  if (sessionTimerId) { clearInterval(sessionTimerId); sessionTimerId = null; }
  clearSession();
  clearAuth();
  adminApp.style.display = 'none';
  loginScreen.classList.remove('hidden');
  alert('Sua sessão expirou. Faça login novamente.');
}

function startSessionTimer() {
  if (sessionTimerId) clearInterval(sessionTimerId);
  sessionTimerId = setInterval(() => {
    const s = getSession();
    const a = getAuth();
    if (!s || !a || !a.token) handleSessionExpired();
  }, 30000);
}

async function initApp() {
  if (appInitialized) {
    try { await loadServices(); await renderTabela(); await loadDashboard(); } catch (_) {}
    return;
  }
  appInitialized = true;
  try {
    await loadServices();
    await renderTabela();
    await loadClientes();
    await loadBreeds();
    await loadOpeningHours();

    if (window.PF_MIMOS && typeof window.PF_MIMOS.ensureLoaded === 'function') {
      await window.PF_MIMOS.ensureLoaded(true);
    }

    await loadDashboard();
    initAgendaViewToggle();
  } catch (e) { console.error(e); }
}

function enterAdminMode(token, expiresAt, user) {
  loginError.classList.add('hidden');
  loginScreen.classList.add('hidden');
  adminApp.style.display = 'block';
  if (token && expiresAt) setAuth(token, expiresAt);
  setSession(user, expiresAt);
  startSessionTimer();
  initApp();
}

function doLogout() {
  clearSession();
  clearAuth();
  if (sessionTimerId) { clearInterval(sessionTimerId); sessionTimerId = null; }
  limparForm();
  limparClienteForm();
  clearServiceForm();
  adminApp.style.display = 'none';
  loginScreen.classList.remove('hidden');
}

function tryAutoLogin() {
  const s = getSession();
  const a = getAuth();
  if (s && a && a.token) {
    adminApp.style.display = 'block';
    loginScreen.classList.add('hidden');
    startSessionTimer();
    initApp();
  } else {
    loginScreen.classList.remove('hidden');
    adminApp.style.display = 'none';
  }
}

// ===== LOGIN =====
const loginScreen = document.getElementById('loginScreen');
const adminApp = document.getElementById('adminApp');
const loginUser = document.getElementById('loginUser');
const loginPass = document.getElementById('loginPass');
const btnLogin = document.getElementById('btnLogin');
const loginError = document.getElementById('loginError');
const btnLogout = document.getElementById('btnLogout');

btnLogin.addEventListener('click', async () => {
  const u = loginUser.value.trim();
  const p = loginPass.value.trim();
  loginError.classList.add('hidden');

  try {
    const resp = await apiPost('/api/admin/login', { username: u, password: p });
    if (!resp || !resp.token || !resp.expires_at) throw new Error('Resposta inválida do servidor.');
    enterAdminMode(resp.token, resp.expires_at, u);
  } catch (e) {
    console.error(e);
    loginError.classList.remove('hidden');
  }
});

[loginUser, loginPass].forEach(el => {
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') btnLogin.click(); });
});

btnLogout.addEventListener('click', () => {
  if (confirm('Deseja sair do painel?')) doLogout();
});

// ===== API HELPERS =====
async function apiGet(path, params) {
  const url = new URL(API_BASE_URL + path, window.location.origin);
  if (params) {
    Object.keys(params).forEach(k => {
      const v = params[k];
      if (v !== undefined && v !== null && v !== '') url.searchParams.append(k, v);
    });
  }
  const token = getAuthToken();
  const resp = await fetch(url.toString(), {
    headers: token ? { 'Authorization': 'Bearer ' + token } : undefined
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || 'Erro ao buscar dados.');
  return data;
}

async function apiPost(path, body) {
  const token = getAuthToken();
  const resp = await fetch(API_BASE_URL + path, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { 'Authorization': 'Bearer ' + token } : {}),
    body: JSON.stringify(body)
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || 'Erro ao salvar.');
  return data;
}

async function apiPut(path, body) {
  const token = getAuthToken();
  const resp = await fetch(API_BASE_URL + path, {
    method: 'PUT',
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { 'Authorization': 'Bearer ' + token } : {}),
    body: JSON.stringify(body)
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || 'Erro ao atualizar.');
  return data;
}

async function apiDelete(path) {
  const token = getAuthToken();
  const resp = await fetch(API_BASE_URL + path, { method: 'DELETE', headers: token ? { 'Authorization': 'Bearer ' + token } : undefined });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || 'Erro ao apagar.');
  return data;
}

/* (restante do seu scripts.js permanece como estava) */

/* ===== INICIALIZA ===== */
tryAutoLogin();
