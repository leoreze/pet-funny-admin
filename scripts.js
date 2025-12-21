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
   Requisitos:
   - HTML ids: tab-mimos, tbodyMimos, mimosEmpty,
              mimoTitle, mimoDesc, emojiPanel,
              mimoValue, mimoStart, mimoEnd, mimoActive,
              btnMimoSave, btnMimoClear, btnMimosReload, mimoMsg
   - API no server:
     GET    /api/mimos
     POST   /api/mimos
     PUT    /api/mimos/:id
     DELETE /api/mimos/:id
   - Opcional: select existente #formPrize (para roleta/prêmio no agendamento)
========================================================= */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const elTab = $('tab-mimos');
  if (!elTab) return;

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

    // novos do layout
    search: $('mimosSearch'),
    btnNovo: $('btnNovoMimo'),
    formWrap: $('mimoFormWrap'),
    btnCloseForm: $('btnFecharMimoForm'),
  };

  let currentEditId = null;
  let cacheMimos = [];

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
    if (!els.prizeSelect) return;

    const now = new Date();
    const isInPeriod = (m) => {
      if (!m.is_active) return false;
      const s = m.starts_at ? new Date(m.starts_at) : null;
      const e = m.ends_at ? new Date(m.ends_at) : null;
      if (s && !isNaN(s.getTime()) && now < s) return false;
      if (e && !isNaN(e.getTime()) && now > e) return false;
      return true;
    };

    const active = (mimos || []).filter(isInPeriod);
    const current = els.prizeSelect.value;

    els.prizeSelect.innerHTML = '';
    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = '— Sem mimo —';
    els.prizeSelect.appendChild(opt0);

    active.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.title; // compat: booking.prize é texto
      opt.textContent = `${m.title} (R$ ${formatCentsToBRL(m.value_cents)})`;
      opt.setAttribute('data-mimo-id', String(m.id));
      els.prizeSelect.appendChild(opt);
    });

    if (current) els.prizeSelect.value = current;
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
  let sessionTimerId = null;
  let appInitialized = false;

  function setSession() {
    const expiresAt = Date.now() + SESSION_DURATION_MS;
    const session = { user: 'adminpetfunny', expiresAt };
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
    adminApp.style.display = 'none';
    loginScreen.classList.remove('hidden');
    alert('Sua sessão expirou. Faça login novamente.');
  }

  function startSessionTimer() {
    if (sessionTimerId) clearInterval(sessionTimerId);
    sessionTimerId = setInterval(() => {
      const s = getSession();
      if (!s) handleSessionExpired();
    }, 30000);
  }

  async function initApp() {
    if (appInitialized) {
      try { await loadServices(); await renderTabela(); await loadDashboard(); } catch (_) {}
      return;
    }
    appInitialized = true;
    try {
      await loadServices();      // garante servicesCache e dropdown de serviços
      await renderTabela();
      await loadClientes();
      await loadBreeds();
      await loadOpeningHours();
      await loadDashboard();
      initAgendaViewToggle();    // NOVO: inicia toggle (lista/cards)
    } catch (e) { console.error(e); }
  }

  function enterAdminMode() {
    loginError.classList.add('hidden');
    loginScreen.classList.add('hidden');
    adminApp.style.display = 'block';
    setSession();
    startSessionTimer();
    initApp();
  }

  function doLogout() {
    clearSession();
    if (sessionTimerId) { clearInterval(sessionTimerId); sessionTimerId = null; }
    limparForm();
    limparClienteForm();
    clearServiceForm();
    adminApp.style.display = 'none';
    loginScreen.classList.remove('hidden');
  }

  function tryAutoLogin() {
    const s = getSession();
    if (s) {
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

  btnLogin.addEventListener('click', () => {
    const u = loginUser.value.trim();
    const p = loginPass.value.trim();
    if (u === 'adminpetfunny' && p === 'admin2605') enterAdminMode();
    else loginError.classList.remove('hidden');
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
    const resp = await fetch(url.toString());
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || 'Erro ao buscar dados.');
    return data;
  }

  async function apiPost(path, body) {
    const resp = await fetch(API_BASE_URL + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || 'Erro ao salvar.');
    return data;
  }

  async function apiPut(path, body) {
    const resp = await fetch(API_BASE_URL + path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || 'Erro ao atualizar.');
    return data;
  }

  async function apiDelete(path) {
    const resp = await fetch(API_BASE_URL + path, { method: 'DELETE' });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || 'Erro ao apagar.');
    return data;
  }

  function sanitizePhone(phone) { return (phone || '').replace(/\D/g, ''); }

  function formatTelefone(phone) {
    const digits = (phone || '').replace(/\D/g, '');
    if (digits.length === 11) return digits.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
    if (digits.length === 10) return digits.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
    return phone || '-';
  }

  function applyPhoneMask(input) {
    if (!input) return;
    let value = input.value.replace(/\D/g, '');
    if (value.length > 11) value = value.slice(0, 11);
    let formatted = value;
    if (value.length > 0) formatted = `(${value.slice(0, 2)}`;
    if (value.length >= 3) formatted = `(${value.slice(0, 2)}) ${value.slice(2, 3)}`;
    if (value.length >= 4) formatted = `(${value.slice(0, 2)}) ${value.slice(2, 3)} ${value.slice(3, 7)}`;
    if (value.length >= 8) formatted = `(${value.slice(0, 2)}) ${value.slice(2, 3)} ${value.slice(3, 7)}-${value.slice(7, 11)}`;
    input.value = formatted;
  }

  function formatDataBr(dataIso) {
    const parts = (dataIso || '').split('-');
    if (parts.length === 3) return parts[2] + '/' + parts[1] + '/' + parts[0];
    return dataIso || '-';
  }

  function formatDateTimeBr(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '-';
    const dia = String(d.getDate()).padStart(2, '0');
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const ano = d.getFullYear();
    const hora = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dia}/${mes}/${ano} ${hora}:${min}`;
  }

  function toISODateOnly(date) {
    const ano = date.getFullYear();
    const mes = String(date.getMonth() + 1).padStart(2, '0');
    const dia = String(date.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
  }

  function getPeriodRange(periodValue) {
    const hoje = new Date();
    let start = null, end = null;

    if (periodValue === 'today') {
      start = toISODateOnly(hoje);
      end = toISODateOnly(hoje);
    } else if (periodValue === '7') {
      const d = new Date(); d.setDate(d.getDate() - 6);
      start = toISODateOnly(d); end = toISODateOnly(hoje);
    } else if (periodValue === '30') {
      const d = new Date(); d.setDate(d.getDate() - 29);
      start = toISODateOnly(d); end = toISODateOnly(hoje);
    } else if (periodValue === 'month') {
      const dStart = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
      start = toISODateOnly(dStart); end = toISODateOnly(hoje);
    }
    return { start, end };
  }

  
  /* ===== Validação de Data/Horário (mesmas regras do index.html) ===== */
  const todayISO = new Date().toISOString().split('T')[0];

  function validarDiaHora(dateStr, timeStr) {
    if (!dateStr || !timeStr) return 'Informe a data e o horário.';

    const date = new Date(dateStr + 'T' + timeStr + ':00');
    if (Number.isNaN(date.getTime())) return 'Data ou horário inválidos.';

    const diaSemana = date.getDay();
    const parts = String(timeStr).split(':');
    const hh = parseInt(parts[0], 10);
    const mm = parseInt(parts[1] || '0', 10);

    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return 'Horário inválido.';

    // Admin também deve seguir a regra do cliente: somente 00 ou 30
    if (!(mm === 0 || mm === 30)) return 'Escolha um horário fechado (minutos 00 ou 30).';

    const minutos = hh * 60 + mm;
    const inicio = 7 * 60 + 30;

    if (diaSemana === 0) return 'Atendemos apenas de segunda a sábado.';
    if (diaSemana >= 1 && diaSemana <= 5) {
      const fim = 17 * 60 + 30;
      if (minutos < inicio || minutos > fim) return 'Segunda a sexta: horários entre 07:30 e 17:30.';
    }
    if (diaSemana === 6) {
      const fim = 13 * 60;
      if (minutos < inicio || minutos > fim) return 'Sábado: horários entre 07:30 e 13:00.';
    }

    // Não permite agendar no passado (comparando data/hora local)
    const now = new Date();
    if (date.getTime() < now.getTime() - (60 * 1000)) return 'Não é possível agendar no passado.';

    return null;
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function buildRangeForDate(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return null;
    const day = d.getDay();
    if (day === 0) return { closed: true };
    const startMin = 7 * 60 + 30;
    const endMin = (day === 6) ? (13 * 60) : (17 * 60 + 30);
    return { closed: false, startMin, endMin };
  }

  function normalizeHHMM(t) {
    const s = String(t || '').trim();
    const m = s.match(/^(\d{1,2}):(\d{1,2})/);
    if (!m) return null;
    const hh = pad2(parseInt(m[1], 10));
    const mm = pad2(parseInt(m[2], 10));
    return `${hh}:${mm}`;
  }

  function isActiveBookingStatus(status) {
    const s = normStr(status);
    // status "cancelado" não ocupa slot
    return s !== 'cancelado';
  }

  async function loadOccupiedTimesForDate(dateStr, excludeBookingId) {
    const data = await apiGet('/api/bookings', { date: dateStr });
    const list = data.bookings || [];
    const set = new Set();

    list.forEach(b => {
      if (excludeBookingId != null && String(b.id) === String(excludeBookingId)) return;
      if (!isActiveBookingStatus(b.status)) return;
      const t = normalizeHHMM(b.time);
      if (t) set.add(t);
    });

    return set;
  }

  function minutesToHHMM(totalMin) {
    const hh = Math.floor(totalMin / 60);
    const mm = totalMin % 60;
    return `${pad2(hh)}:${pad2(mm)}`;
  }

  function clampToRange(timeStr, range) {
    const t = normalizeHHMM(timeStr);
    if (!t || !range || range.closed) return null;
    const [hh, mm] = t.split(':').map(n => parseInt(n, 10));
    let total = hh * 60 + mm;

    // arredonda para o slot mais próximo (00/30)
    total = Math.round(total / 30) * 30;

    if (total < range.startMin) total = range.startMin;
    if (total > range.endMin) total = range.endMin;

    // garante que não sai do padrão 00/30 depois do clamp
    total = Math.round(total / 30) * 30;

    return minutesToHHMM(total);
  }


  function classStatus(status) {
    const s = normStr(status);
    if (s === 'agendado') return 'status-agendado';
    if (s === 'confirmado') return 'status-confirmado';
    if (s === 'recebido') return 'status-recebido';
    if (s === 'em servico' || s === 'em serviço') return 'status-em-servico';
    if (s === 'concluido' || s === 'concluído') return 'status-concluido';
    if (s === 'entregue') return 'status-entregue';
    if (s === 'cancelado') return 'status-cancelado';
    return 'status-agendado';
  }

  function buildStatusMessage(status, nome, petLabel, service, dataBR, time, prize) {
    const s = normStr(status);
    const cabecalho = `Oi ${nome}! Aqui é do Pet Funny!\n\n`;
    let corpo = '';

    switch (s) {
      case 'agendado':
        corpo = `Acabamos de registrar o agendamento de *${petLabel}* para *${service}* em *${dataBR} às ${time}*.\n\nMimo da campanha Roleta de Mimos: *${prize}*.\n\nQuando estiver próximo do dia, te avisamos por aqui.`;
        break;
      case 'confirmado':
        corpo = `Seu agendamento de *${petLabel}* para *${service}* em *${dataBR} às ${time}* foi *CONFIRMADO* \n\nMimo garantido: *${prize}*.\n\nQualquer alteração é só avisar a gente aqui no WhatsApp.`;
        break;
      case 'recebido':
        corpo = `*${petLabel}* já está aqui com a gente para *${service}* \n\nEstamos cuidando com muito carinho.\n\nMimo da vez: *${prize}*.\n\nAssim que estiver tudo pronto, te avisamos por aqui.`;
        break;
      case 'em servico':
        corpo = `Estamos cuidando de *${petLabel}* agora mesmo no *${service}* \n\nMimo aplicado: *${prize}*.\n\nDaqui a pouco estará pronto(a) para ser buscado(a).`;
        break;
      case 'concluido':
        corpo = `O serviço de *${petLabel}* (*${service}*) foi *CONCLUÍDO* \n\nMimo aplicado: *${prize}*.\n\nQuando quiser, já pode vir buscar.`;
        break;
      case 'entregue':
        corpo = `Tudo entregue, e esperamos que você tenha gostado do resultado! \n\nReferência: *${petLabel}*\nServiço: *${service}*\nMimo da Roleta: *${prize}*.\n\nObrigada por confiar no Pet Funny!`;
        break;
      case 'cancelado':
        corpo = `Seu agendamento de *${petLabel}* para *${service}* em *${dataBR} às ${time}* foi *CANCELADO* \n\nSe quiser remarcar, é só mandar mensagem por aqui que encontramos um novo horário.`;
        break;
      default:
        corpo = `O status do agendamento de *${petLabel}* para *${service}* em *${dataBR} às ${time}* foi atualizado para: *${String(status || '').toUpperCase()}*.\n\nMimo da campanha Roleta de Mimos: *${prize}*.\n\nQualquer dúvida, é só chamar aqui no WhatsApp!`;
    }
    return cabecalho + corpo;
  }

  /* ===== MOEDA: máscara e conversões (value_cents) ===== */
  function formatCentsToBRL(cents) {
    const n = Number(cents || 0) / 100;
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function applyCurrencyMask(input) {
    if (!input) return;
    let raw = String(input.value || '').replace(/\D/g, '');

    // se usuário apagou tudo, ok
    if (raw === '') {
      input.value = '';
      input.dataset.cents = '';
      return;
    }

    // permite zero
    raw = raw.replace(/^0+/, '');
    if (raw === '') raw = '0';

    input.dataset.cents = raw;
    input.value = formatCentsToBRL(raw);
  }

  function getCentsFromCurrencyInput(input) {
    if (!input) return null;

    // 1) tenta via dataset (máscara)
    let raw = String(input.dataset?.cents || '').replace(/\D/g, '');
    if (raw) {
      const cents = parseInt(raw, 10);
      return Number.isFinite(cents) ? cents : null;
    }

    // 2) fallback: tenta parsear pelo texto digitado/colado (ex: "85,00" ou "R$ 85,00" ou "85")
    const txt = String(input.value || '').trim();
    if (!txt) return null;

    const digits = txt.replace(/\s/g, '').replace(/[R$r$]/g, '');
    // se tiver vírgula, assume centavos; se não tiver, assume reais inteiros
    if (digits.includes(',')) {
      const cleaned = digits.replace(/\./g, '').replace(',', '.');
      const n = Number(cleaned);
      if (!Number.isFinite(n)) return null;
      return Math.round(n * 100);
    } else {
      const onlyDigits = digits.replace(/\D/g, '');
      if (!onlyDigits) return null;
      return parseInt(onlyDigits, 10) * 100;
    }
  }

  /* ===== TABS ===== */
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabViews = document.querySelectorAll('.tab-view');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const tabId = btn.getAttribute('data-tab');
      tabViews.forEach(view => view.classList.toggle('active', view.id === tabId));

      if (tabId === 'tab-servicos') loadServices().catch(console.error);
      if (tabId === 'tab-racas') loadBreeds().catch(console.error);

      if (tabId === 'tab-horarios') loadOpeningHours().catch(console.error);

      if (tabId === 'tab-dashboard') {
        loadDashboard().finally(() => {
          setTimeout(() => {
            try { if (statusChart) statusChart.resize(); } catch (_) {}
            try { if (prizeChart) prizeChart.resize(); } catch (_) {}
          }, 60);
        });
      }

      // NOVO: quando voltar para agenda, renderiza conforme view atual
      if (tabId === 'tab-agenda') {
        try { renderAgendaByView(ultimaLista || []); } catch (_) {}
      }
    });
  });

  // ===== CAMPOS AGENDA =====
  const filtroData = document.getElementById('filtroData');
  const filtroBusca = document.getElementById('filtroBusca');
  const btnHoje = document.getElementById('btnHoje');
  const btnLimparFiltro = document.getElementById('btnLimparFiltro');
  const btnExportarCSV = document.getElementById('btnExportarCSV');
  const btnNovoAgendamento = document.getElementById('btnNovoAgendamento');

  const tbodyAgenda = document.getElementById('tbodyAgenda');
  const estadoVazio = document.getElementById('estadoVazio');

  // NOVO: cards
  const agendaListWrapper = document.getElementById('agendaListWrapper');
  const agendaCardsWrapper = document.getElementById('agendaCardsWrapper');
  const agendaCards = document.getElementById('agendaCards');
  const estadoVazioCards = document.getElementById('estadoVazioCards');
  const btnViewList = document.getElementById('btnViewList');
  const btnViewCards = document.getElementById('btnViewCards');

  const statTotal = document.getElementById('statTotal');
  const statTosa = document.getElementById('statTosa');
  const statHidratacao = document.getElementById('statHidratacao');
  const statFotoVideo = document.getElementById('statFotoVideo');
  const statPatinhas = document.getElementById('statPatinhas');

  const formPanel = document.getElementById('formPanel');

  const bookingId = document.getElementById('bookingId');
  const bookingOriginalStatus = document.getElementById('bookingOriginalStatus');
  const formPhone = document.getElementById('formPhone');
  const formNome = document.getElementById('formNome');
  const formPetSelect = document.getElementById('formPetSelect');
  const formPrize = document.getElementById('formPrize');
  const formService = document.getElementById('formService');
  const formDate = document.getElementById('formDate');
  const formTime = document.getElementById('formTime');

  // Regras padrão (mesmas do cliente)
  if (formDate) formDate.min = todayISO;
  if (formTime) formTime.step = 1800; // 30 minutos


  // Revalida e aplica limites quando a data/horário mudam
  if (formDate) {
    const onDateChanged = async () => {
      const excludeId = bookingId && bookingId.value ? Number(bookingId.value) : null;
      await refreshBookingDateTimeState(excludeId);

      // Hardening: se a data é válida e o dia não é "fechado", o campo de horário deve estar habilitado.
      // Isso evita casos em que o evento "change" não chega a disparar como esperado.
      try {
        const dateStr = formDate.value;
        const range = buildRangeForDate(dateStr);
        if (dateStr && range && !range.closed && formTime) {
          formTime.disabled = false;
        }
      } catch (_) {}
    };

    formDate.addEventListener('change', onDateChanged);
    formDate.addEventListener('input', onDateChanged);
  }

  if (formTime) {
    // arredonda para 00/30 e aplica faixa do dia
    formTime.addEventListener('blur', () => {
      const range = buildRangeForDate(formDate ? formDate.value : '');
      const clamped = clampToRange(formTime.value, range);
      if (clamped) formTime.value = clamped;
    });
  }
  const formStatus = document.getElementById('formStatus');
  const formNotes = document.getElementById('formNotes');
  const formError = document.getElementById('formError');
  const btnSalvar = document.getElementById('btnSalvar');
  const btnCancelarEdicao = document.getElementById('btnCancelarEdicao');

  // ===== DASHBOARD =====
  const dashPeriod = document.getElementById('dashPeriod');
  const dashCustomRange = document.getElementById('dashCustomRange');
  const dashStart = document.getElementById('dashStart');
  const dashEnd = document.getElementById('dashEnd');
  const dashApply = document.getElementById('dashApply');

  const dashTotalBookings = document.getElementById('dashTotalBookings');
  const dashUniqueCustomers = document.getElementById('dashUniqueCustomers');
  const dashTotalCustomers = document.getElementById('dashTotalCustomers');

  const dashStatusAgendado = document.getElementById('dashStatusAgendado');
  const dashStatusConfirmado = document.getElementById('dashStatusConfirmado');
  const dashStatusRecebido = document.getElementById('dashStatusRecebido');
  const dashStatusEmServico = document.getElementById('dashStatusEmServico');
  const dashStatusConcluido = document.getElementById('dashStatusConcluido');
  const dashStatusEntregue = document.getElementById('dashStatusEntregue');
  const dashStatusCancelado = document.getElementById('dashStatusCancelado');

  const dashPrizeTosa = document.getElementById('dashPrizeTosa');
  const dashPrizeHidratacao = document.getElementById('dashPrizeHidratacao');
  const dashPrizeFotoVideo = document.getElementById('dashPrizeFotoVideo');
  const dashPrizePatinhas = document.getElementById('dashPrizePatinhas');

  const tbodyDashServices = document.getElementById('tbodyDashServices');
  const dashServicesEmpty = document.getElementById('dashServicesEmpty');
  const dashRevenue = document.getElementById('dashRevenue');
  const dashAvgTicket = document.getElementById('dashAvgTicket');

  let ultimaLista = [];
  let clientesCache = [];
  let clienteSelecionadoId = null;
  let petsCache = [];
  let petEditIdLocal = null;

  function setEditMode(isEdit) {
    // Em edição: mantém Tutor/Telefone travados, mas permite editar Pet e Mimo
    formPhone.disabled = isEdit;
    formNome.disabled = isEdit;
    formPetSelect.disabled = false;
    formPrize.disabled = false;
  }

  /* ===== Estado de disponibilidade (Admin) ===== */
  let occupiedTimesSet = new Set();

  async function refreshBookingDateTimeState(excludeBookingId) {
    if (!formDate || !formTime) return;

    const dateStr = formDate.value;
    if (!dateStr) return;

    const range = buildRangeForDate(dateStr);
    if (!range || range.closed) {
      formTime.disabled = true;
      formTime.value = '';
      occupiedTimesSet = new Set();
      return;
    }

    formTime.disabled = false;
    formTime.step = 1800; // 30 min

    formTime.min = minutesToHHMM(range.startMin);
    formTime.max = minutesToHHMM(range.endMin);

    // carrega horários ocupados do dia (exclui o próprio agendamento em edição)
    try {
      occupiedTimesSet = await loadOccupiedTimesForDate(dateStr, excludeBookingId);
    } catch (e) {
      console.warn('Falha ao carregar horários ocupados:', e);
      occupiedTimesSet = new Set();
    }

    // ajusta (clamp) se estiver fora da faixa / minutos diferentes de 00/30
    if (formTime.value) {
      const clamped = clampToRange(formTime.value, range);
      if (clamped) formTime.value = clamped;
    }
  }

  function isTimeOccupied(timeStr) {
    const t = normalizeHHMM(timeStr);
    return !!t && occupiedTimesSet.has(t);
  }

  function mostrarFormAgenda() { formPanel.classList.remove('hidden'); }
  function esconderFormAgenda() { formPanel.classList.add('hidden'); }

  async function fetchBookings() {
    const params = {};
    if (filtroData.value) params.date = filtroData.value;
    if (filtroBusca.value.trim()) params.search = filtroBusca.value.trim();
    const data = await apiGet('/api/bookings', params);
    return data.bookings || [];
  }

  function atualizaEstatisticas(lista) {
    const total = lista.length;
    let tosa = 0, hidratacao = 0, fotoVideo = 0, patinhas = 0;

    lista.forEach(a => {
      switch (a.prize) {
        case 'Tosa Higiênica': tosa++; break;
        case 'Hidratação': hidratacao++; break;
        case 'Foto e Vídeo Profissional': fotoVideo++; break;
        case 'Patinhas impecáveis': patinhas++; break;
      }
    });

    statTotal.textContent = total;
    statTosa.textContent = tosa;
    statHidratacao.textContent = hidratacao;
    statFotoVideo.textContent = fotoVideo;
    statPatinhas.textContent = patinhas;
  }

  // ===== GRÁFICOS =====
  let statusChart = null;
  let prizeChart = null;

  function renderCharts(bookings) {
    const statusCounts = { agendado:0, confirmado:0, recebido:0, em_servico:0, concluido:0, entregue:0, cancelado:0 };
    const prizeCounts = { 'Tosa Higiênica':0, 'Hidratação':0, 'Foto e Vídeo Profissional':0, 'Patinhas impecáveis':0 };

    bookings.forEach(b => {
      const s = normStr(b.status);
      if (s === 'agendado') statusCounts.agendado++;
      else if (s === 'confirmado') statusCounts.confirmado++;
      else if (s === 'recebido') statusCounts.recebido++;
      else if (s === 'em servico') statusCounts.em_servico++;
      else if (s === 'concluido') statusCounts.concluido++;
      else if (s === 'entregue') statusCounts.entregue++;
      else if (s === 'cancelado') statusCounts.cancelado++;

      const p = b.prize || '';
      if (prizeCounts.hasOwnProperty(p)) prizeCounts[p]++;
    });

    const ctxStatusEl = document.getElementById('chartStatus');
    const ctxPrizesEl = document.getElementById('chartPrizes');
    if (!ctxStatusEl || !ctxPrizesEl) return;

    const ctxStatus = ctxStatusEl.getContext('2d');
    const ctxPrizes = ctxPrizesEl.getContext('2d');

    if (statusChart) statusChart.destroy();
    if (prizeChart) prizeChart.destroy();

    statusChart = new Chart(ctxStatus, {
      type: 'bar',
      data: {
        labels: ['Agendado','Confirmado','Recebido','Em serviço','Concluído','Entregue','Cancelado'],
        datasets: [{
          label: 'Agendamentos',
          data: [
            statusCounts.agendado,
            statusCounts.confirmado,
            statusCounts.recebido,
            statusCounts.em_servico,
            statusCounts.concluido,
            statusCounts.entregue,
            statusCounts.cancelado
          ]
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { font: { size: 10 } } },
          y: { beginAtZero: true, precision: 0 }
        }
      }
    });

    prizeChart = new Chart(ctxPrizes, {
      type: 'doughnut',
      data: {
        labels: Object.keys(prizeCounts),
        datasets: [{ data: Object.values(prizeCounts) }]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom' } }
      }
    });
  }

  /* ===== PETS no SELECT (Agenda) ===== */
  async function loadPetsForCustomer(customerId) {
    const data = await apiGet('/api/pets', { customer_id: customerId });
    const pets = (data.pets || []);
    formPetSelect.innerHTML = '<option value="">(Sem pet informado)</option>';
    pets.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.breed ? `${p.name} (${p.breed})` : p.name;
      formPetSelect.appendChild(opt);
    });
    return pets;
  }

  function preencherFormEdicao(booking) {
    bookingId.value = booking.id;
    bookingOriginalStatus.value = booking.status || 'agendado';

    formPhone.value = booking.phone || '';
    formNome.value = booking.customer_name || '';
    formPrize.value = booking.prize || 'Tosa Higiênica';

    // serviço (preferência: service_id)
    const sid = booking.service_id ?? booking.serviceId ?? '';
    if (sid && String(sid) !== 'null') formService.value = String(sid);
    else {
      // fallback: tenta casar pelo texto
      const txt = booking.service || booking.service_title || '';
      const match = servicesCache.find(s => normStr(s.title) === normStr(txt));
      formService.value = match ? String(match.id) : '';
      
    // Atualiza limites e disponibilidade para a data (exclui o próprio agendamento)
    refreshBookingDateTimeState(booking.id);
  }

    formDate.value = booking.date || '';
    formTime.value = booking.time || '';
    formStatus.value = booking.status || 'agendado';
    formNotes.value = booking.notes || '';
    formError.style.display = 'none';

    setEditMode(true);

    const customerId = booking.customer_id || booking.customerId;
    const bookingPetId = booking.pet_id ?? booking.petId;
    const bookingPetName = booking.pet_name || booking.petName;

    formPetSelect.innerHTML = '<option value="">(Sem pet informado)</option>';

    if (customerId) {
      loadPetsForCustomer(customerId)
        .then(() => {
          if (bookingPetId != null) formPetSelect.value = String(bookingPetId);
          else formPetSelect.value = '';
          if (bookingPetId == null && bookingPetName) {
            // mantém sem pet selecionado; mensagem WhatsApp usa fallback "seu pet"
          }
        })
        .catch(() => {});
    }

    mostrarFormAgenda();
    refreshBookingDateTimeState(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ===== Serviços (cache, dropdown e CRUD) ===== */
  const btnNovoServico = document.getElementById('btnNovoServico');
  const serviceFormPanel = document.getElementById('serviceFormPanel');
  const serviceId = document.getElementById('serviceId');
  const serviceDate = document.getElementById('serviceDate');
  const serviceTitle = document.getElementById('serviceTitle');
  const servicePrice = document.getElementById('servicePrice');
  const serviceError = document.getElementById('serviceError');
  const btnServiceCancel = document.getElementById('btnServiceCancel');
  const btnServiceSave = document.getElementById('btnServiceSave');
  const tbodyServices = document.getElementById('tbodyServices');
  const servicesEmpty = document.getElementById('servicesEmpty');

  // Filtro de busca (Serviços)
  const filtroServicos = document.getElementById('filtroServicos');
  const btnLimparServicos = document.getElementById('btnLimparServicos');
  let filtroServicosTxt = '';


  let servicesCache = []; // [{id,title,value_cents,...}]

  function showServiceForm() { serviceFormPanel.classList.remove('hidden'); }
  function hideServiceForm() { serviceFormPanel.classList.add('hidden'); }

  function clearServiceForm() {
    serviceId.value = '';
    serviceDate.value = toISODateOnly(new Date());
    serviceTitle.value = '';
    servicePrice.value = '';
    servicePrice.dataset.cents = '';
    serviceError.style.display = 'none';
    serviceError.textContent = '';
  }

  function fillServiceForm(svc) {
    serviceId.value = svc.id;
    serviceDate.value = (svc.date || '').slice(0, 10);
    serviceTitle.value = svc.title || '';
    servicePrice.dataset.cents = String(svc.value_cents ?? '');
    servicePrice.value = svc.value_cents != null ? formatCentsToBRL(svc.value_cents) : '';
    serviceError.style.display = 'none';
    serviceError.textContent = '';
  }

  function renderServices() {
    tbodyServices.innerHTML = '';

    const list = (servicesCache || []).filter(s => {
      if (!filtroServicosTxt) return true;
      const hay = normStr((s.title || ''));
      return hay.includes(filtroServicosTxt);
    });

    servicesEmpty.style.display = list.length ? 'none' : 'block';

    list.forEach(svc => {
      const tr = document.createElement('tr');

      const tdId = document.createElement('td'); tdId.textContent = svc.id;
      const tdDate = document.createElement('td'); tdDate.textContent = formatDataBr((svc.date || '').slice(0,10));
      const tdTitle = document.createElement('td'); tdTitle.textContent = svc.title || '-';
      const tdPrice = document.createElement('td'); tdPrice.textContent = formatCentsToBRL(svc.value_cents || 0);

      const tdCreated = document.createElement('td'); tdCreated.textContent = svc.created_at ? formatDateTimeBr(svc.created_at) : '-';
      const tdUpdated = document.createElement('td'); tdUpdated.textContent = svc.updated_at ? formatDateTimeBr(svc.updated_at) : '-';

      const tdAcoes = document.createElement('td');
      const divActions = document.createElement('div'); divActions.className = 'actions';

      const btnEdit = document.createElement('button');
      btnEdit.textContent = 'Editar';
      btnEdit.className = 'btn btn-small btn-secondary';
      btnEdit.type = 'button';
      btnEdit.addEventListener('click', () => {
        fillServiceForm(svc);
        showServiceForm();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });

      const btnDel = document.createElement('button');
      btnDel.textContent = 'Excluir';
      btnDel.className = 'btn btn-small btn-danger';
      btnDel.type = 'button';
      btnDel.addEventListener('click', async () => {
        if (!confirm('Deseja realmente excluir este serviço?')) return;
        try {
          await apiDelete('/api/services/' + svc.id);
          await loadServices();
          await loadDashboard();
        } catch (e) { alert(e.message); }
      });

      divActions.appendChild(btnEdit);
      divActions.appendChild(btnDel);
      tdAcoes.appendChild(divActions);

      tr.appendChild(tdId);
      tr.appendChild(tdDate);
      tr.appendChild(tdTitle);
      tr.appendChild(tdPrice);
      tr.appendChild(tdCreated);
      tr.appendChild(tdUpdated);
      tr.appendChild(tdAcoes);

      tbodyServices.appendChild(tr);
    });
  }

  function refreshServiceOptionsInAgenda() {
    // mantém seleção atual se possível
    const current = formService.value || '';
    formService.innerHTML = '<option value="">Selecione...</option>';
    servicesCache.forEach(s => {
      const opt = document.createElement('option');
      opt.value = String(s.id);
      opt.textContent = s.title;
      formService.appendChild(opt);
    });
    if (current) formService.value = current;
  }

  async function loadServices() {
    try {
      const data = await apiGet('/api/services');
      servicesCache = data.services || [];
      renderServices();
      refreshServiceOptionsInAgenda();
    } catch (e) {
      servicesCache = [];
      renderServices();
      refreshServiceOptionsInAgenda();
      servicesEmpty.style.display = 'block';
      servicesEmpty.textContent = 'Erro ao carregar serviços: ' + e.message;
    }
  }

  async function saveService() {
    serviceError.style.display = 'none';
    serviceError.textContent = '';

    const id = serviceId.value ? parseInt(serviceId.value, 10) : null;
    const date = serviceDate.value;
    const title = serviceTitle.value.trim();

    // garante dataset.cents sempre atualizado antes de validar
    applyCurrencyMask(servicePrice);
    const value_cents = getCentsFromCurrencyInput(servicePrice);

    if (!date || !title) {
      serviceError.textContent = 'Preencha data e título do serviço.';
      serviceError.style.display = 'block';
      return;
    }
    if (value_cents == null || value_cents < 0) {
      serviceError.textContent = 'Valor inválido. Digite no formato moeda (ex: 85,00).';
      serviceError.style.display = 'block';
      return;
    }

    try {
      const body = { date, title, value_cents };
      if (!id) await apiPost('/api/services', body);
      else await apiPut('/api/services/' + id, body);

      clearServiceForm();
      hideServiceForm();
      await loadServices();
      await loadDashboard();
    } catch (e) {
      serviceError.textContent = e.message;
      serviceError.style.display = 'block';
    }
  }

  if (btnNovoServico) {
    btnNovoServico.addEventListener('click', () => {
      clearServiceForm();
      showServiceForm();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
  if (btnServiceCancel) btnServiceCancel.addEventListener('click', () => { clearServiceForm(); hideServiceForm(); });
  if (btnServiceSave) btnServiceSave.addEventListener('click', saveService);

  // Máscara do valor de serviço
  if (servicePrice) {
    servicePrice.addEventListener('input', () => applyCurrencyMask(servicePrice));
  }


  if (filtroServicos) {
    filtroServicos.addEventListener('input', () => {
      filtroServicosTxt = normStr(filtroServicos.value);
      renderServices();
    });
  }
  if (btnLimparServicos) {
    btnLimparServicos.addEventListener('click', () => {
      if (filtroServicos) filtroServicos.value = '';
      filtroServicosTxt = '';
      renderServices();
    });
  }


  /* ===== Raças de Cães (CRUD) ===== */
  const btnNovoBreed = document.getElementById('btnNovoBreed');
  const breedSearch = document.getElementById('breedSearch');
  const breedFormPanel = document.getElementById('breedFormPanel');
  const breedId = document.getElementById('breedId');
  const breedName = document.getElementById('breedName');
  const breedSize = document.getElementById('breedSize');
  const breedCoat = document.getElementById('breedCoat');
  const breedHistory = document.getElementById('breedHistory');
  const breedError = document.getElementById('breedError');
  const btnBreedCancel = document.getElementById('btnBreedCancel');
  const btnBreedSave = document.getElementById('btnBreedSave');
  const tbodyBreeds = document.getElementById('tbodyBreeds');
  const breedsEmpty = document.getElementById('breedsEmpty');

  let breedsCache = []; // [{id,name,size,coat,history,created_at,updated_at}]

  function showBreedForm() { breedFormPanel.classList.remove('hidden'); }
  function hideBreedForm() { breedFormPanel.classList.add('hidden'); }

  function clearBreedForm() {
    breedId.value = '';
    breedName.value = '';
    breedSize.value = 'pequeno';
    breedCoat.value = 'curta';
    breedHistory.value = '';
    if (breedError) { breedError.style.display = 'none'; breedError.textContent = ''; }
  }

  function fillBreedForm(b) {
    breedId.value = b.id;
    breedName.value = b.name || '';
    breedSize.value = (b.size || 'pequeno');
    breedCoat.value = (b.coat || 'curta');
    breedHistory.value = b.history || '';
    if (breedError) { breedError.style.display = 'none'; breedError.textContent = ''; }
  }

  function humanSize(v) {
    const s = normStr(v);
    if (s === 'pequeno') return 'Pequeno';
    if (s === 'medio' || s === 'médio') return 'Médio';
    if (s === 'grande') return 'Grande';
    return v || '-';
  }

  function humanCoat(v) {
    const s = normStr(v);
    if (s === 'curta') return 'Curta';
    if (s === 'media' || s === 'média') return 'Média';
    if (s === 'longa') return 'Longa';
    return v || '-';
  }

  function renderBreeds() {
    if (!tbodyBreeds) return;
    tbodyBreeds.innerHTML = '';

    const q = normStr(breedSearch?.value || '');
    const list = !q ? breedsCache : breedsCache.filter(b =>
      normStr(b.name).includes(q) ||
      normStr(b.size).includes(q) ||
      normStr(b.coat).includes(q) ||
      normStr(b.history).includes(q)
    );

    if (breedsEmpty) breedsEmpty.style.display = list.length ? 'none' : 'block';

    list.forEach(b => {
      const tr = document.createElement('tr');

      const tdId = document.createElement('td'); tdId.textContent = b.id;
      const tdName = document.createElement('td'); tdName.textContent = b.name || '-';
      const tdSize = document.createElement('td'); tdSize.textContent = humanSize(b.size);
      const tdCoat = document.createElement('td'); tdCoat.textContent = humanCoat(b.coat);

      const tdHist = document.createElement('td');
      const full = (b.history || '').trim();
      tdHist.textContent = full.length > 140 ? (full.slice(0, 140) + '…') : (full || '-');
      tdHist.className = 'td-obs';
      tdHist.title = full;

      const tdCreated = document.createElement('td'); tdCreated.textContent = b.created_at ? formatDateTimeBr(b.created_at) : '-';
      const tdUpdated = document.createElement('td'); tdUpdated.textContent = b.updated_at ? formatDateTimeBr(b.updated_at) : '-';

      const tdAcoes = document.createElement('td');
      const divActions = document.createElement('div'); divActions.className = 'actions';

      const btnEdit = document.createElement('button');
      btnEdit.textContent = 'Editar';
      btnEdit.className = 'btn btn-small btn-secondary';
      btnEdit.type = 'button';
      btnEdit.addEventListener('click', () => {
        fillBreedForm(b);
        showBreedForm();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });

      const btnDel = document.createElement('button');
      btnDel.textContent = 'Excluir';
      btnDel.className = 'btn btn-small btn-danger';
      btnDel.type = 'button';
      btnDel.addEventListener('click', async () => {
        if (!confirm('Deseja realmente excluir esta raça?')) return;
        try {
          await apiDelete('/api/breeds/' + b.id);
          await loadBreeds();
        } catch (e) { alert(e.message); }
      });

      divActions.appendChild(btnEdit);
      divActions.appendChild(btnDel);
      tdAcoes.appendChild(divActions);

      tr.appendChild(tdId);
      tr.appendChild(tdName);
      tr.appendChild(tdSize);
      tr.appendChild(tdCoat);
      tr.appendChild(tdHist);
      tr.appendChild(tdCreated);
      tr.appendChild(tdUpdated);
      tr.appendChild(tdAcoes);

      tbodyBreeds.appendChild(tr);
    });
  }

  async function loadBreeds() {
    try {
      const data = await apiGet('/api/breeds');
      breedsCache = data.breeds || [];
      renderBreeds();
    } catch (e) {
      breedsCache = [];
      renderBreeds();
      if (breedsEmpty) {
        breedsEmpty.style.display = 'block';
        breedsEmpty.textContent = 'Erro ao carregar raças: ' + e.message;
      }
    }
  }

  async function saveBreed() {
    if (breedError) { breedError.style.display = 'none'; breedError.textContent = ''; }

    const id = breedId.value ? parseInt(breedId.value, 10) : null;
    const name = (breedName.value || '').trim();
    const size = breedSize.value;
    const coat = breedCoat.value;
    const history = (breedHistory.value || '').trim();

    if (!name) {
      if (breedError) { breedError.textContent = 'Informe o nome da raça.'; breedError.style.display = 'block'; }
      return;
    }
    if (!size || !coat) {
      if (breedError) { breedError.textContent = 'Informe porte e pelagem.'; breedError.style.display = 'block'; }
      return;
    }

    try {
      const body = { name, size, coat, history };
      if (!id) await apiPost('/api/breeds', body);
      else await apiPut('/api/breeds/' + id, body);

      clearBreedForm();
      hideBreedForm();
      await loadBreeds();
    } catch (e) {
      if (breedError) { breedError.textContent = e.message; breedError.style.display = 'block'; }
    }
  }

  if (btnNovoBreed) {
    btnNovoBreed.addEventListener('click', () => {
      clearBreedForm();
      showBreedForm();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
  if (btnBreedCancel) btnBreedCancel.addEventListener('click', () => { clearBreedForm(); hideBreedForm(); });
  if (btnBreedSave) btnBreedSave.addEventListener('click', saveBreed);

  if (breedSearch) {
    breedSearch.addEventListener('input', () => {
      clearTimeout(window.__breedTimer);
      window.__breedTimer = setTimeout(() => renderBreeds(), 120);
    });
  }


  /* ===== NOVO: Agenda - Toggle Lista/Cards ===== */
  const AGENDA_VIEW_KEY = 'pf_admin_agenda_view';
  let agendaView = 'list';

  function initAgendaViewToggle() {
    try {
      const saved = localStorage.getItem(AGENDA_VIEW_KEY);
      if (saved === 'cards' || saved === 'list') agendaView = saved;
    } catch (_) {}

    applyAgendaViewUI(agendaView);

    if (btnViewList) btnViewList.addEventListener('click', () => setAgendaView('list'));
    if (btnViewCards) btnViewCards.addEventListener('click', () => setAgendaView('cards'));
  }

  function setAgendaView(view) {
    agendaView = (view === 'cards') ? 'cards' : 'list';
    try { localStorage.setItem(AGENDA_VIEW_KEY, agendaView); } catch (_) {}
    applyAgendaViewUI(agendaView);
    renderAgendaByView(ultimaLista || []);
  }

  function applyAgendaViewUI(view) {
    if (!agendaListWrapper || !agendaCardsWrapper) return;

    const isCards = (view === 'cards');

    agendaListWrapper.classList.toggle('hidden', isCards);
    agendaCardsWrapper.classList.toggle('hidden', !isCards);

    if (btnViewList) btnViewList.classList.toggle('active', !isCards);
    if (btnViewCards) btnViewCards.classList.toggle('active', isCards);
  }

  function getServiceLabelFromBooking(a) {
    let serviceLabel = a.service || a.service_title || '-';
    const sid = a.service_id ?? a.serviceId ?? null;

    if (sid != null) {
      const svc = servicesCache.find(s => String(s.id) === String(sid));
      if (svc) serviceLabel = svc.title;
    } else {
      const match = servicesCache.find(s => normStr(s.title) === normStr(serviceLabel));
      if (match) serviceLabel = match.title;
    }
    return serviceLabel;
  }

  function renderAgendaByView(lista) {
    // vazio: atualiza ambos estados para evitar inconsistências
    const isEmpty = !lista || !lista.length;

    if (agendaView === 'cards') {
      renderAgendaCards(lista || []);
      if (estadoVazio) estadoVazio.style.display = 'none';
      if (estadoVazioCards) estadoVazioCards.classList.toggle('hidden', !isEmpty);
    } else {
      renderAgendaList(lista || []);
      if (estadoVazioCards) estadoVazioCards.classList.add('hidden');
      if (estadoVazio) estadoVazio.style.display = isEmpty ? 'block' : 'none';
    }
  }

  function renderAgendaList(lista) {
    tbodyAgenda.innerHTML = '';
    estadoVazio.style.display = lista.length ? 'none' : 'block';

    lista.forEach(a => {
      const tr = document.createElement('tr');

      const tdData = document.createElement('td'); tdData.textContent = formatDataBr(a.date);
      const tdHora = document.createElement('td'); tdHora.textContent = a.time || '-';
      const tdTutor = document.createElement('td'); tdTutor.textContent = a.customer_name || '-';
      const tdPet = document.createElement('td'); tdPet.textContent = a.pet_name || '-';
      const tdTel = document.createElement('td'); tdTel.textContent = formatTelefone(a.phone);

      const tdServ = document.createElement('td'); tdServ.textContent = getServiceLabelFromBooking(a);

      const tdMimo = document.createElement('td');
      tdMimo.textContent = a.prize || '-';
      tdMimo.className = 'td-mimo';

      const tdStatus = document.createElement('td');
      const spanStatus = document.createElement('span');
      const labelStatus = (a.status || 'agendado');
      spanStatus.textContent = labelStatus;
      spanStatus.className = 'td-status ' + classStatus(labelStatus);
      tdStatus.appendChild(spanStatus);

      const tdNotif = document.createElement('td');
      tdNotif.textContent = a.last_notification_at ? formatDateTimeBr(a.last_notification_at) : '-';

      const tdObs = document.createElement('td');
      tdObs.textContent = a.notes || '';
      tdObs.className = 'td-obs';

      const tdAcoes = document.createElement('td');
      const divActions = document.createElement('div');
      divActions.className = 'actions';

      const btnEditar = document.createElement('button');
      btnEditar.textContent = 'Editar';
      btnEditar.className = 'btn btn-small btn-secondary';
      btnEditar.type = 'button';
      btnEditar.addEventListener('click', () => preencherFormEdicao(a));

      const btnExcluir = document.createElement('button');
      btnExcluir.textContent = 'Excluir';
      btnExcluir.className = 'btn btn-small btn-danger';
      btnExcluir.type = 'button';
      btnExcluir.addEventListener('click', async () => {
        if (!confirm('Deseja realmente excluir este agendamento?')) return;
        try {
          await apiDelete('/api/bookings/' + a.id);
          await renderTabela();
          await loadDashboard();
        } catch (e) { alert(e.message); }
      });

      divActions.appendChild(btnEditar);
      divActions.appendChild(btnExcluir);
      tdAcoes.appendChild(divActions);

      tr.appendChild(tdData);
      tr.appendChild(tdHora);
      tr.appendChild(tdTutor);
      tr.appendChild(tdPet);
      tr.appendChild(tdTel);
      tr.appendChild(tdServ);
      tr.appendChild(tdMimo);
      tr.appendChild(tdStatus);
      tr.appendChild(tdNotif);
      tr.appendChild(tdObs);
      tr.appendChild(tdAcoes);

      tbodyAgenda.appendChild(tr);
    });
  }

  function renderAgendaCards(lista) {
    if (!agendaCards) return;

    agendaCards.innerHTML = '';
    const isEmpty = !lista.length;
    if (estadoVazioCards) estadoVazioCards.classList.toggle('hidden', !isEmpty);

    lista.forEach(a => {
      const card = document.createElement('div');
      card.className = 'agenda-card';

      const top = document.createElement('div');
      top.className = 'agenda-card-top';

      const left = document.createElement('div');
      const timeWrap = document.createElement('div');
      timeWrap.className = 'agenda-card-time';
      timeWrap.textContent = `⏰ ${a.time || '-'}`;

      const dateWrap = document.createElement('div');
      dateWrap.className = 'agenda-card-date';
      dateWrap.textContent = `📅 ${formatDataBr(a.date)}`;

      left.appendChild(timeWrap);
      left.appendChild(dateWrap);

      const statusWrap = document.createElement('div');
      const spanStatus = document.createElement('span');
      const labelStatus = (a.status || 'agendado');
      spanStatus.textContent = labelStatus;
      spanStatus.className = 'td-status ' + classStatus(labelStatus);
      statusWrap.appendChild(spanStatus);

      top.appendChild(left);
      top.appendChild(statusWrap);

      const main = document.createElement('div');
      main.className = 'agenda-card-main';

      const serviceLabel = getServiceLabelFromBooking(a);

      const l1 = document.createElement('div');
      l1.className = 'agenda-line';
      l1.innerHTML = `<span class="agenda-key">Tutor:</span> <span class="agenda-val">${(a.customer_name || '-')}</span>`;

      const l2 = document.createElement('div');
      l2.className = 'agenda-line';
      l2.innerHTML = `<span class="agenda-key">Pet:</span> <span class="agenda-muted">${(a.pet_name || '-')}</span>`;

      const l3 = document.createElement('div');
      l3.className = 'agenda-line';
      l3.innerHTML = `<span class="agenda-key">Tel:</span> <span class="agenda-muted">${formatTelefone(a.phone)}</span>`;

      const l4 = document.createElement('div');
      l4.className = 'agenda-line';
      l4.innerHTML = `<span class="agenda-key">Serviço:</span> <span class="agenda-val">${serviceLabel}</span>`;

      const l5 = document.createElement('div');
      l5.className = 'agenda-line';
      l5.innerHTML = `<span class="agenda-key">Mimo:</span> <span class="agenda-val" style="color:var(--turquesa)">${(a.prize || '-')}</span>`;

      const l6 = document.createElement('div');
      l6.className = 'agenda-line';
      l6.innerHTML = `<span class="agenda-key">Notif:</span> <span class="agenda-muted">${a.last_notification_at ? formatDateTimeBr(a.last_notification_at) : '-'}</span>`;

      main.appendChild(l1);
      main.appendChild(l2);
      main.appendChild(l3);
      main.appendChild(l4);
      main.appendChild(l5);
      main.appendChild(l6);

      const notes = document.createElement('div');
      notes.className = 'agenda-card-notes';
      notes.textContent = (a.notes || '').trim() ? a.notes : 'Sem observações.';

      const bottom = document.createElement('div');
      bottom.className = 'agenda-card-bottom';

      const actions = document.createElement('div');
      actions.className = 'actions';

      const btnEditar = document.createElement('button');
      btnEditar.textContent = 'Editar';
      btnEditar.className = 'btn btn-small btn-secondary';
      btnEditar.type = 'button';
      btnEditar.addEventListener('click', () => preencherFormEdicao(a));

      const btnExcluir = document.createElement('button');
      btnExcluir.textContent = 'Excluir';
      btnExcluir.className = 'btn btn-small btn-danger';
      btnExcluir.type = 'button';
      btnExcluir.addEventListener('click', async () => {
        if (!confirm('Deseja realmente excluir este agendamento?')) return;
        try {
          await apiDelete('/api/bookings/' + a.id);
          await renderTabela();
          await loadDashboard();
        } catch (e) { alert(e.message); }
      });

      actions.appendChild(btnEditar);
      actions.appendChild(btnExcluir);

      bottom.appendChild(actions);

      card.appendChild(top);
      card.appendChild(main);
      card.appendChild(notes);
      card.appendChild(bottom);

      agendaCards.appendChild(card);
    });
  }

  /* ===== Agenda: render e salvar ===== */
  async function renderTabela() {
    try {
      const lista = await fetchBookings();
      ultimaLista = lista;

      // renderiza conforme view selecionada
      renderAgendaByView(lista);
      atualizaEstatisticas(lista);
    } catch (e) {
      // zera listagem e cards
      ultimaLista = [];
      tbodyAgenda.innerHTML = '';
      if (agendaCards) agendaCards.innerHTML = '';

      if (estadoVazio) {
        estadoVazio.style.display = 'block';
        estadoVazio.textContent = 'Erro ao carregar agendamentos: ' + e.message;
      }
      if (estadoVazioCards) {
        estadoVazioCards.classList.remove('hidden');
        estadoVazioCards.textContent = 'Erro ao carregar agendamentos: ' + e.message;
      }

      statTotal.textContent = '0';
      statTosa.textContent = '0';
      statHidratacao.textContent = '0';
      statFotoVideo.textContent = '0';
      statPatinhas.textContent = '0';
    }
  }

  function limparForm() {
    bookingId.value = '';
    bookingOriginalStatus.value = 'agendado';
    formPhone.value = '';
    formNome.value = '';
    formPetSelect.innerHTML = '<option value="">(Sem pet informado)</option>';
    formPrize.value = '';
    formService.value = '';
    formDate.value = '';
    formTime.value = '';
    formStatus.value = 'agendado';
    formNotes.value = '';
    formError.style.display = 'none';
    formError.textContent = '';
    setEditMode(false);
  }

  async function salvarAgendamento() {
    formError.style.display = 'none';
    formError.textContent = '';

    const id = bookingId.value || null;
    const originalStatus = bookingOriginalStatus.value || 'agendado';

    const rawPhone = formPhone.value.trim();
    const phone = sanitizePhone(rawPhone);
    const nome = formNome.value.trim();

    const petIdRaw = formPetSelect.value;
    const petIdNum = petIdRaw ? parseInt(petIdRaw, 10) : null;

    const prize = formPrize.value;

    // serviço selecionado do banco (id)
    const serviceIdSelected = formService.value ? parseInt(formService.value, 10) : null;
    const serviceObj = serviceIdSelected ? servicesCache.find(s => String(s.id) === String(serviceIdSelected)) : null;
    const serviceTitleSelected = serviceObj ? serviceObj.title : '';

    const date = formDate.value;
    const time = formTime.value;

    // Validação de data/horário (mesmas regras do cliente)
    const dtMsg = validarDiaHora(date, time);
    if (dtMsg) {
      formError.textContent = dtMsg;
      formError.style.display = 'block';
      return;
    }

    // Carrega horários ocupados do dia e bloqueia conflito
    await refreshBookingDateTimeState(id);
    if (isTimeOccupied(time)) {
      formError.textContent = 'Horário indisponível para esta data. Selecione outro horário.';
      formError.style.display = 'block';
      return;
    }

    const status = formStatus.value;
    const notes = formNotes.value.trim();

    if (!date || !time || !serviceIdSelected) {
      formError.textContent = 'Data, horário e serviço são obrigatórios.';
      formError.style.display = 'block';
      return;
    }
    if (!prize) {
      formError.textContent = 'Selecione um mimo (Roleta).';
      formError.style.display = 'block';
      return;
    }
    // Novo agendamento: Pet obrigatório
    if (!id && !petIdNum) {
      formError.textContent = 'Para NOVO agendamento, selecione um pet.';
      formError.style.display = 'block';
      return;
    }
    if (!phone || phone.length < 10 || !nome) {
      formError.textContent = 'Preencha telefone (com DDD) e nome do tutor.';
      formError.style.display = 'block';
      return;
    }

    try {
      let customer = null;
      try {
        const lookup = await apiPost('/api/customers/lookup', { phone });
        if (lookup.exists && lookup.customer) customer = lookup.customer;
      } catch (_) {}

      if (!customer) {
        formError.textContent = 'Cliente não cadastrado. Cadastre o tutor e os pets na aba "Clientes & Pets" antes de criar o agendamento.';
        formError.style.display = 'block';
        return;
      }

      const body = {
        customer_id: customer.id,
        pet_id: petIdNum,
        date, time,
        // envia os dois: id (correto) + título (compatibilidade)
        service_id: serviceIdSelected,
        service: serviceTitleSelected,
        prize, notes, status
      };

      let precisaWhats = false;
      let urlWhats = null;

      if (id && normStr(status) !== normStr(originalStatus)) {
        const dataBR = formatDataBr(date);
        const petLabel = petIdNum
          ? (formPetSelect.options[formPetSelect.selectedIndex]?.textContent || 'seu pet')
          : 'seu pet';

        const msg = buildStatusMessage(status, nome, petLabel, serviceTitleSelected, dataBR, time, prize);

        let fullPhone = phone;
        if (!(fullPhone.startsWith('55') && fullPhone.length > 11)) fullPhone = '55' + fullPhone;

        urlWhats = `https://wa.me/${fullPhone}?text=${encodeURIComponent(msg)}`;
        precisaWhats = true;

        body.last_notification_at = new Date().toISOString();
      }

      if (!id) await apiPost('/api/bookings', body);
      else await apiPut('/api/bookings/' + id, body);

      if (precisaWhats && urlWhats) window.open(urlWhats, '_blank');

      limparForm();
      esconderFormAgenda();
      await renderTabela();
      await loadDashboard();
    } catch (e) {
      formError.textContent = e.message;
      formError.style.display = 'block';
    }
  }

  function exportarCSV() {
    if (!ultimaLista.length) {
      alert('Não há agendamentos para exportar no filtro atual.');
      return;
    }

    const linhas = [];
    linhas.push(['ID','Data','Hora','Tutor','Pet','Telefone','Serviço','Mimo','Status','Última Notificação','Observações'].join(';'));

    ultimaLista.forEach(a => {
      const serviceLabel = getServiceLabelFromBooking(a);

      const cols = [
        a.id,
        formatDataBr(a.date),
        a.time || '',
        (a.customer_name || '').replace(/;/g, ','),
        (a.pet_name || '').replace(/;/g, ','),
        formatTelefone(a.phone),
        (serviceLabel || '').replace(/;/g, ','),
        (a.prize || '').replace(/;/g, ','),
        (a.status || 'agendado'),
        a.last_notification_at ? formatDateTimeBr(a.last_notification_at) : '',
        (a.notes || '').replace(/[\r\n]+/g, ' ').replace(/;/g, ',')
      ];
      linhas.push(cols.join(';'));
    });

    const csv = linhas.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;

    const hoje = new Date();
    const ano = hoje.getFullYear();
    const mes = String(hoje.getMonth() + 1).padStart(2, '0');
    const dia = String(hoje.getDate()).padStart(2, '0');
    a.download = `agenda_petfunny_${ano}-${mes}-${dia}.csv`;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  filtroData.addEventListener('change', async () => { await renderTabela(); await loadDashboard(); });

  filtroBusca.addEventListener('input', () => {
    clearTimeout(window.__filtroTimer);
    window.__filtroTimer = setTimeout(async () => {
      await renderTabela();
      await loadDashboard();
    }, 150);
  });

  btnHoje.addEventListener('click', async () => {
    filtroData.value = toISODateOnly(new Date());
    await renderTabela();
    await loadDashboard();
  });

  btnLimparFiltro.addEventListener('click', async () => {
    filtroData.value = '';
    filtroBusca.value = '';
    await renderTabela();
    await loadDashboard();
  });

  btnExportarCSV.addEventListener('click', exportarCSV);
  btnSalvar.addEventListener('click', salvarAgendamento);
  btnCancelarEdicao.addEventListener('click', () => { limparForm(); esconderFormAgenda(); });

  if (dashPeriod) {
    dashPeriod.addEventListener('change', () => {
      const val = dashPeriod.value;
      if (val === 'custom') dashCustomRange.classList.remove('hidden');
      else { dashCustomRange.classList.add('hidden'); loadDashboard(); }
    });
  }
  if (dashApply) dashApply.addEventListener('click', (e) => { e.preventDefault(); loadDashboard(); });

  btnNovoAgendamento.addEventListener('click', () => {
    limparForm();
    formDate.value = toISODateOnly(new Date());
    // Para novo agendamento, o pet é obrigatório e só pode ser escolhido após carregar os pets do cliente
    formPetSelect.disabled = true;
    formPetSelect.innerHTML = '<option value="">(Digite o telefone para carregar os pets)</option>';
    mostrarFormAgenda();
    // Garante que o estado do horário seja recalculado após o form ficar visível.
    // (Alguns browsers podem não aplicar corretamente enable/disable quando o elemento ainda está oculto.)
    setTimeout(() => {
      refreshBookingDateTimeState(null);
      // Caso a data esteja preenchida e não seja dia fechado, não deixe o campo de horário travado.
      try {
        const range = buildRangeForDate(formDate.value);
        if (range && !range.closed) formTime.disabled = false;
      } catch (_) {}
    }, 0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  formPhone.addEventListener('input', () => applyPhoneMask(formPhone));

  formPhone.addEventListener('blur', async () => {
    const phoneDigits = sanitizePhone(formPhone.value.trim());
    if (!phoneDigits) return;

    try {
      const lookup = await apiPost('/api/customers/lookup', { phone: phoneDigits });

      if (lookup.exists && lookup.customer) {
        // Cliente existe: preenche nome e carrega pets para seleção
        formNome.value = lookup.customer.name || '';
        formPetSelect.disabled = false;
        await loadPetsForCustomer(lookup.customer.id);

        // Se o cliente não tem pets, força cadastro antes de agendar
        if (formPetSelect.options.length <= 1) {
          formPetSelect.disabled = true;
          formPetSelect.innerHTML = '<option value="">(Cadastre ao menos 1 pet para este cliente)</option>';
          formError.textContent = 'Cliente encontrado, mas sem pets cadastrados. Cadastre os pets na aba "Clientes & Pets" antes de agendar.';
          formError.style.display = 'block';
        } else {
          formError.style.display = 'none';
          formError.textContent = '';
        }
      } else {
        // Cliente não existe: avisa e orienta cadastro
        formNome.value = '';
        formPetSelect.disabled = true;
        formPetSelect.innerHTML = '<option value="">(Cadastre o cliente e os pets primeiro)</option>';

        formError.textContent = 'Cliente não cadastrado. Vá na aba "Clientes & Pets" para cadastrar o tutor e os pets antes de criar o agendamento.';
        formError.style.display = 'block';
      }
    } catch (e) {
      // Em caso de erro na API, mantém o fluxo mas informa
      formPetSelect.disabled = true;
      formPetSelect.innerHTML = '<option value="">(Erro ao buscar cliente)</option>';
      formError.textContent = 'Erro ao buscar cliente pelo telefone. Tente novamente. Detalhe: ' + (e.message || e);
      formError.style.display = 'block';
    }
  });

  // ===== CLIENTES & PETS =====
  const cliPhone = document.getElementById('cliPhone');
  const cliName = document.getElementById('cliName');
  const cliError = document.getElementById('cliError');
  const btnCliLimpar = document.getElementById('btnCliLimpar');
  const btnCliSalvar = document.getElementById('btnCliSalvar');
  const tbodyClientes = document.getElementById('tbodyClientes');

  // Filtro de busca (Clientes & Pets)
  const filtroClientes = document.getElementById('filtroClientes');
  const btnLimparClientes = document.getElementById('btnLimparClientes');
  let filtroClientesTxt = '';


  const clienteFormBlock = document.getElementById('clienteFormBlock');
  const btnNovoCliente = document.getElementById('btnNovoCliente');

  const petName = document.getElementById('petName');
  const petBreed = document.getElementById('petBreed');
  const petInfo = document.getElementById('petInfo');
  const petError = document.getElementById('petError');
  const btnPetLimpar = document.getElementById('btnPetLimpar');
  const btnPetSalvar = document.getElementById('btnPetSalvar');
  const btnNovoPet = document.getElementById('btnNovoPet');
  const tbodyPets = document.getElementById('tbodyPets');
  const badgeClienteSelecionado = document.getElementById('badgeClienteSelecionado');
  const petsCard = document.getElementById('petsCard');

  const racas = [
    'SRD (Sem Raça Definida)','Poodle','Shih Tzu','Lhasa Apso','Labrador Retriever','Golden Retriever',
    'Yorkshire Terrier','Bulldog Francês','Bulldog Inglês','Spitz Alemão (Lulu da Pomerânia)','Beagle',
    'Border Collie','Boxer','Dachshund (Salsicha)','Maltês','Pinscher','Pastor Alemão','Rottweiler',
    'Pitbull','Pug','Cocker Spaniel','Schnauzer','Husky Siberiano','Akita','Chihuahua','Outro (informar nas observações)'
  ];

  cliPhone.addEventListener('input', () => applyPhoneMask(cliPhone));

  if (filtroClientes) {
    filtroClientes.addEventListener('input', () => {
      filtroClientesTxt = normStr(filtroClientes.value);
      renderClientes();
    });
  }
  if (btnLimparClientes) {
    btnLimparClientes.addEventListener('click', () => {
      if (filtroClientes) filtroClientes.value = '';
      filtroClientesTxt = '';
      renderClientes();
    });
  }

  racas.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r;
    opt.textContent = r;
    petBreed.appendChild(opt);
  });

  async function loadClientes() {
    const data = await apiGet('/api/customers');
    clientesCache = data.customers || [];
    renderClientes();
  }

  function renderClientes() {
    tbodyClientes.innerHTML = '';

    const list = (clientesCache || []).filter(c => {
      if (!filtroClientesTxt) return true;
      const hay = normStr((c.name || '') + ' ' + (c.phone || ''));
      return hay.includes(filtroClientesTxt);
    });

    list.forEach(c => {
      const tr = document.createElement('tr');

      const tdId = document.createElement('td'); tdId.textContent = c.id;
      const tdNome = document.createElement('td'); tdNome.textContent = c.name || '-';
      const tdTel = document.createElement('td'); tdTel.textContent = formatTelefone(c.phone);
      const tdPetsCount = document.createElement('td');
      tdPetsCount.innerHTML = c.pets_count ? `<span class="badge-mini">${c.pets_count} pet(s)</span>` : '-';

      const tdAcoes = document.createElement('td');
      const divActions = document.createElement('div'); divActions.className = 'actions';

      const btnSel = document.createElement('button');
      btnSel.textContent = 'Selecionar';
      btnSel.className = 'btn btn-small btn-secondary';
      btnSel.type = 'button';
      btnSel.addEventListener('click', async () => {
        clienteSelecionadoId = c.id;

        badgeClienteSelecionado.classList.remove('hidden');
        clienteFormBlock.classList.remove('hidden');
        petsCard.classList.remove('hidden');

        cliPhone.value = formatTelefone(c.phone);
        cliName.value = c.name || '';

        limparPetsForm();
        await loadPetsForClienteTab(c.id);
      });

      const btnDel = document.createElement('button');
      btnDel.textContent = 'Excluir';
      btnDel.className = 'btn btn-small btn-danger';
      btnDel.type = 'button';
      btnDel.addEventListener('click', async () => {
        if (!confirm('Excluir este cliente? (Os pets relacionados também poderão ser afetados)')) return;
        try {
          await apiDelete('/api/customers/' + c.id);
          if (clienteSelecionadoId === c.id) {
            clienteSelecionadoId = null;
            badgeClienteSelecionado.classList.add('hidden');
            petsCard.classList.add('hidden');
            limparClienteForm();
            limparPetsForm();
            tbodyPets.innerHTML = '';
          }
          await loadClientes();
          await loadDashboard();
          await renderTabela();
        } catch (e) { alert(e.message); }
      });

      divActions.appendChild(btnSel);
      divActions.appendChild(btnDel);
      tdAcoes.appendChild(divActions);

      tr.appendChild(tdId);
      tr.appendChild(tdNome);
      tr.appendChild(tdTel);
      tr.appendChild(tdPetsCount);
      tr.appendChild(tdAcoes);

      tbodyClientes.appendChild(tr);
    });
  }

  function limparClienteForm() {
    cliPhone.value = '';
    cliName.value = '';
    cliError.style.display = 'none';

    clienteSelecionadoId = null;
    badgeClienteSelecionado.classList.add('hidden');

    clienteFormBlock.classList.add('hidden');
    petsCard.classList.add('hidden');

    tbodyPets.innerHTML = '';
    limparPetsForm();
  }

  async function salvarCliente() {
    cliError.style.display = 'none';
    const phoneDigits = sanitizePhone(cliPhone.value.trim());
    const name = cliName.value.trim();

    if (!phoneDigits || phoneDigits.length < 10 || !name) {
      cliError.textContent = 'Preencha telefone (com DDD) e nome do tutor.';
      cliError.style.display = 'block';
      return;
    }

    try {
      const data = await apiPost('/api/customers', { phone: phoneDigits, name });
      clienteSelecionadoId = data.customer.id;
      badgeClienteSelecionado.classList.remove('hidden');
      petsCard.classList.remove('hidden');
      await loadClientes();
      await loadPetsForClienteTab(clienteSelecionadoId);
      await loadDashboard();
      await renderTabela();

    } catch (e) {
      cliError.textContent = e.message;
      cliError.style.display = 'block';
    }
  }

  async function loadPetsForClienteTab(customerId) {
    const data = await apiGet('/api/pets', { customer_id: customerId });
    petsCache = data.pets || [];
    renderPets();
  }

  function renderPets() {
    tbodyPets.innerHTML = '';
    petsCache.forEach(p => {
      const tr = document.createElement('tr');

      const tdId = document.createElement('td'); tdId.textContent = p.id;
      const tdNome = document.createElement('td'); tdNome.textContent = p.name;
      const tdRaca = document.createElement('td'); tdRaca.textContent = p.breed || '-';
      const tdInfo = document.createElement('td'); tdInfo.textContent = p.info || '-';

      const tdAcoes = document.createElement('td');
      const divActions = document.createElement('div'); divActions.className = 'actions';

      const btnEdit = document.createElement('button');
      btnEdit.textContent = 'Editar';
      btnEdit.className = 'btn btn-small btn-secondary';
      btnEdit.type = 'button';
      btnEdit.addEventListener('click', () => {
        petEditIdLocal = p.id;
        petName.value = p.name;
        petBreed.value = p.breed || 'SRD (Sem Raça Definida)';
        petInfo.value = p.info || '';
      });

      const btnDel = document.createElement('button');
      btnDel.textContent = 'Excluir';
      btnDel.className = 'btn btn-small btn-danger';
      btnDel.type = 'button';
      btnDel.addEventListener('click', async () => {
        if (!confirm('Excluir este pet?')) return;
        try {
          await apiDelete('/api/pets/' + p.id);
          await loadPetsForClienteTab(clienteSelecionadoId);
          await loadClientes();
          await loadDashboard();
          await renderTabela();
        } catch (e) { alert(e.message); }
      });

      divActions.appendChild(btnEdit);
      divActions.appendChild(btnDel);
      tdAcoes.appendChild(divActions);

      tr.appendChild(tdId);
      tr.appendChild(tdNome);
      tr.appendChild(tdRaca);
      tr.appendChild(tdInfo);
      tr.appendChild(tdAcoes);

      tbodyPets.appendChild(tr);
    });
  }

  function limparPetsForm() {
    petEditIdLocal = null;
    petName.value = '';
    petBreed.value = 'SRD (Sem Raça Definida)';
    petInfo.value = '';
    petError.style.display = 'none';
  }

  async function salvarPet() {
    petError.style.display = 'none';
    if (!clienteSelecionadoId) {
      petError.textContent = 'Selecione um cliente na lista ao lado antes de cadastrar o pet.';
      petError.style.display = 'block';
      return;
    }

    const name = petName.value.trim();
    const breed = petBreed.value;
    const info = petInfo.value.trim();

    if (!name || !breed) {
      petError.textContent = 'Informe nome e raça do pet.';
      petError.style.display = 'block';
      return;
    }

    try {
      if (!petEditIdLocal) {
        await apiPost('/api/pets', { customer_id: clienteSelecionadoId, name, breed, info });
      } else {
        await apiPut('/api/pets/' + petEditIdLocal, { name, breed, info });
      }
      limparPetsForm();
      await loadPetsForClienteTab(clienteSelecionadoId);
      await loadClientes();
      await loadBreeds();
      await loadDashboard();
      await renderTabela();
    } catch (e) {
      petError.textContent = e.message;
      petError.style.display = 'block';
    }
  }

  btnCliLimpar.addEventListener('click', limparClienteForm);
  btnCliSalvar.addEventListener('click', salvarCliente);

  btnPetLimpar.addEventListener('click', limparPetsForm);
  btnPetSalvar.addEventListener('click', salvarPet);

  btnNovoPet.addEventListener('click', () => limparPetsForm);

  btnNovoCliente.addEventListener('click', () => {
    clienteSelecionadoId = null;
    badgeClienteSelecionado.classList.add('hidden');

    cliPhone.value = '';
    cliName.value = '';
    cliError.style.display = 'none';
    clienteFormBlock.classList.remove('hidden');

    petsCard.classList.add('hidden');
    tbodyPets.innerHTML = '';
    limparPetsForm();
  });

  if (dashPeriod && dashPeriod.value === 'custom') dashCustomRange.classList.remove('hidden');

  /* ===== DASHBOARD: inclui financeiro por serviço ===== */
  async function loadDashboard() {
    let period = dashPeriod ? dashPeriod.value : 'today';
    let { start, end } = getPeriodRange(period);

    if (period === 'custom') {
      start = dashStart.value || null;
      end = dashEnd.value || null;
      if (!start || !end) return;
    }

    let bookings = [];
    let totalCustomers = 0;

    try {
      const data = await apiGet('/api/bookings');
      bookings = data.bookings || [];
    } catch (e) {
      console.error('Erro ao carregar bookings para dashboard:', e);
      bookings = [];
    }

    // aplica range por date (YYYY-MM-DD)
    if (start || end) {
      bookings = bookings.filter(b => {
        const d = b.date;
        if (!d) return false;
        if (start && d < start) return false;
        if (end && d > end) return false;
        return true;
      });
    }

    try {
      const cData = await apiGet('/api/customers');
      totalCustomers = (cData.customers || []).length;
    } catch (e) {
      console.error('Erro ao carregar customers para dashboard:', e);
      totalCustomers = 0;
    }

    const uniqueCustomersSet = new Set();
    bookings.forEach(b => {
      const cid = b.customer_id || b.customerId;
      if (cid != null) uniqueCustomersSet.add(cid);
    });

    dashTotalBookings.textContent = bookings.length;
    dashUniqueCustomers.textContent = uniqueCustomersSet.size;
    dashTotalCustomers.textContent = totalCustomers;

    const statusCounts = { agendado:0, confirmado:0, recebido:0, em_servico:0, concluido:0, entregue:0, cancelado:0 };
    const prizeCounts = { 'Tosa Higiênica':0, 'Hidratação':0, 'Foto e Vídeo Profissional':0, 'Patinhas impecáveis':0 };

    bookings.forEach(b => {
      const s = normStr(b.status);
      if (s === 'agendado') statusCounts.agendado++;
      else if (s === 'confirmado') statusCounts.confirmado++;
      else if (s === 'recebido') statusCounts.recebido++;
      else if (s === 'em servico') statusCounts.em_servico++;
      else if (s === 'concluido') statusCounts.concluido++;
      else if (s === 'entregue') statusCounts.entregue++;
      else if (s === 'cancelado') statusCounts.cancelado++;

      const p = b.prize || '';
      if (prizeCounts.hasOwnProperty(p)) prizeCounts[p]++;
    });

    dashStatusAgendado.textContent = statusCounts.agendado;
    dashStatusConfirmado.textContent = statusCounts.confirmado;
    dashStatusRecebido.textContent = statusCounts.recebido;
    dashStatusEmServico.textContent = statusCounts.em_servico;
    dashStatusConcluido.textContent = statusCounts.concluido;
    dashStatusEntregue.textContent = statusCounts.entregue;
    dashStatusCancelado.textContent = statusCounts.cancelado;

    dashPrizeTosa.textContent = prizeCounts['Tosa Higiênica'];
    dashPrizeHidratacao.textContent = prizeCounts['Hidratação'];
    dashPrizeFotoVideo.textContent = prizeCounts['Foto e Vídeo Profissional'];
    dashPrizePatinhas.textContent = prizeCounts['Patinhas impecáveis'];

    // financeiro por serviço
    const usage = new Map(); // serviceId -> {title, qty, value_cents}
    let revenueCents = 0;

    bookings.forEach(b => {
      // determinar serviceId
      let sid = b.service_id ?? b.serviceId ?? null;
      if (sid == null) {
        const txt = b.service || b.service_title || '';
        const match = servicesCache.find(s => normStr(s.title) === normStr(txt));
        sid = match ? match.id : null;
      }

      if (sid == null) return;

      const svc = servicesCache.find(s => String(s.id) === String(sid));
      if (!svc) return;

      const key = String(svc.id);
      if (!usage.has(key)) usage.set(key, { title: svc.title, qty: 0, value_cents: Number(svc.value_cents || 0) });
      const row = usage.get(key);
      row.qty += 1;
      const add = row.value_cents;
      revenueCents += add;
    });

    dashRevenue.textContent = formatCentsToBRL(revenueCents);
    const avg = bookings.length ? Math.round(revenueCents / bookings.length) : 0;
    dashAvgTicket.textContent = formatCentsToBRL(avg);

    tbodyDashServices.innerHTML = '';
    const rows = Array.from(usage.values())
      .map(r => ({...r, total_cents: r.qty * r.value_cents}))
      .sort((a,b) => b.total_cents - a.total_cents);

    dashServicesEmpty.style.display = rows.length ? 'none' : 'block';

    rows.forEach(r => {
      const tr = document.createElement('tr');
      const tdTitle = document.createElement('td'); tdTitle.textContent = r.title;
      const tdQty = document.createElement('td'); tdQty.textContent = String(r.qty);
      const tdPrice = document.createElement('td'); tdPrice.textContent = formatCentsToBRL(r.value_cents);
      const tdTotal = document.createElement('td'); tdTotal.textContent = formatCentsToBRL(r.total_cents);
      tr.appendChild(tdTitle);
      tr.appendChild(tdQty);
      tr.appendChild(tdPrice);
      tr.appendChild(tdTotal);
      tbodyDashServices.appendChild(tr);
    });

    renderCharts(bookings);
  }

  
  /* =========================
     HORÁRIO DE FUNCIONAMENTO (Admin)
  ========================= */
  const tbodyHours = document.getElementById('tbodyHours');
  const hoursEmpty = document.getElementById('hoursEmpty');
  const btnHoursSave = document.getElementById('btnHoursSave');
  const btnHoursReload = document.getElementById('btnHoursReload');
  const btnHoursResetDefault = document.getElementById('btnHoursResetDefault');
  const hoursMsg = document.getElementById('hoursMsg');

  const DOW_LABEL = {
    0: 'Domingo',
    1: 'Segunda',
    2: 'Terça',
    3: 'Quarta',
    4: 'Quinta',
    5: 'Sexta',
    6: 'Sábado'
  };

  let openingHoursCache = []; // [{dow,is_closed,open_time,close_time,max_per_half_hour,updated_at}]

  function normalizeHHMM(v, fallback) {
    const s = String(v || '').trim();
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) return s;
    return fallback;
  }

  function getDefaultOpeningHours() {
    return [
      { dow: 1, is_closed: false, open_time: '07:30', close_time: '17:30', max_per_half_hour: 1 },
      { dow: 2, is_closed: false, open_time: '07:30', close_time: '17:30', max_per_half_hour: 1 },
      { dow: 3, is_closed: false, open_time: '07:30', close_time: '17:30', max_per_half_hour: 1 },
      { dow: 4, is_closed: false, open_time: '07:30', close_time: '17:30', max_per_half_hour: 1 },
      { dow: 5, is_closed: false, open_time: '07:30', close_time: '17:30', max_per_half_hour: 1 },
      { dow: 6, is_closed: false, open_time: '07:30', close_time: '13:00', max_per_half_hour: 1 },
      { dow: 0, is_closed: true,  open_time: null,   close_time: null,   max_per_half_hour: 0 },
    ];
  }

  function renderOpeningHoursTable() {
    if (!tbodyHours) return;

    tbodyHours.innerHTML = '';
    const rowsByDow = new Map((openingHoursCache || []).map(r => [Number(r.dow), r]));

    for (const dow of [1,2,3,4,5,6,0]) {
      const r = rowsByDow.get(dow) || { dow, is_closed: true, open_time: null, close_time: null, max_per_half_hour: 0, updated_at: null };

      const tr = document.createElement('tr');

      const tdDay = document.createElement('td');
      tdDay.textContent = DOW_LABEL[dow] || String(dow);

      const tdClosed = document.createElement('td');
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = !!r.is_closed;
      chk.dataset.dow = String(dow);
      chk.addEventListener('change', () => {
        const openEl = document.getElementById('oh_open_' + dow);
        const closeEl = document.getElementById('oh_close_' + dow);
        const capEl = document.getElementById('oh_cap_' + dow);
        const isClosed = chk.checked;
        if (openEl) openEl.disabled = isClosed;
        if (closeEl) closeEl.disabled = isClosed;
        if (capEl) capEl.disabled = isClosed;
        if (isClosed) {
          if (capEl) capEl.value = '0';
        } else {
          if (capEl && (Number(capEl.value || 0) === 0)) capEl.value = '1';
        }
      });
      tdClosed.appendChild(chk);

      const tdOpen = document.createElement('td');
      const open = document.createElement('input');
      open.type = 'time';
      open.id = 'oh_open_' + dow;
      open.value = r.open_time ? String(r.open_time).slice(0,5) : '07:30';
      open.disabled = !!r.is_closed;
      tdOpen.appendChild(open);

      const tdClose = document.createElement('td');
      const close = document.createElement('input');
      close.type = 'time';
      close.id = 'oh_close_' + dow;
      close.value = r.close_time ? String(r.close_time).slice(0,5) : '17:30';
      close.disabled = !!r.is_closed;
      tdClose.appendChild(close);

      const tdCap = document.createElement('td');
      const cap = document.createElement('input');
      cap.type = 'number';
      cap.min = '0';
      cap.step = '1';
      cap.id = 'oh_cap_' + dow;
      cap.value = String(r.max_per_half_hour != null ? r.max_per_half_hour : (r.is_closed ? 0 : 1));
      cap.disabled = !!r.is_closed;
      cap.style.maxWidth = '110px';
      tdCap.appendChild(cap);

      const tdUpd = document.createElement('td');
      tdUpd.textContent = r.updated_at ? formatDateTimeBr(r.updated_at) : '-';

      tr.appendChild(tdDay);
      tr.appendChild(tdClosed);
      tr.appendChild(tdOpen);
      tr.appendChild(tdClose);
      tr.appendChild(tdCap);
      tr.appendChild(tdUpd);

      tbodyHours.appendChild(tr);
    }

    if (hoursEmpty) hoursEmpty.style.display = 'none';
  }

  async function loadOpeningHours() {
    if (!tbodyHours) return;
    if (hoursMsg) hoursMsg.textContent = '';

    try {
      const data = await apiGet('/api/opening-hours');
      openingHoursCache = data.opening_hours || [];
      renderOpeningHoursTable();
    } catch (e) {
      console.error(e);
      openingHoursCache = [];
      tbodyHours.innerHTML = '';
      if (hoursEmpty) {
        hoursEmpty.style.display = 'block';
        hoursEmpty.textContent = 'Erro ao carregar: ' + e.message;
      }
    }
  }

  function collectOpeningHoursFromUI() {
    const out = [];
    for (const dow of [0,1,2,3,4,5,6]) {
      const chk = document.querySelector(`input[type="checkbox"][data-dow="${dow}"]`);
      const is_closed = !!chk?.checked;

      const openEl = document.getElementById('oh_open_' + dow);
      const closeEl = document.getElementById('oh_close_' + dow);
      const capEl = document.getElementById('oh_cap_' + dow);

      let open_time = openEl ? normalizeHHMM(openEl.value, '07:30') : '07:30';
      let close_time = closeEl ? normalizeHHMM(closeEl.value, '17:30') : '17:30';
      let max_per_half_hour = capEl ? Number(capEl.value) : 1;

      if (!Number.isFinite(max_per_half_hour) || max_per_half_hour < 0) max_per_half_hour = 0;

      if (is_closed) {
        open_time = null;
        close_time = null;
        max_per_half_hour = 0;
      } else {
        if (max_per_half_hour === 0) max_per_half_hour = 1;
      }

      out.push({ dow, is_closed, open_time, close_time, max_per_half_hour });
    }
    return out;
  }

  async function saveOpeningHours(rows) {
    if (hoursMsg) hoursMsg.textContent = '';
    try {
      const payload = { opening_hours: rows };
      const data = await apiPut('/api/opening-hours', payload);
      openingHoursCache = data.opening_hours || [];
      renderOpeningHoursTable();
      if (hoursMsg) hoursMsg.textContent = 'Horários salvos com sucesso.';
    } catch (e) {
      alert(e.message);
      if (hoursMsg) hoursMsg.textContent = 'Erro ao salvar: ' + e.message;
    }
  }

  if (btnHoursReload) btnHoursReload.addEventListener('click', loadOpeningHours);
  if (btnHoursSave) btnHoursSave.addEventListener('click', () => saveOpeningHours(collectOpeningHoursFromUI()));
  if (btnHoursResetDefault) btnHoursResetDefault.addEventListener('click', () => {
    openingHoursCache = getDefaultOpeningHours().map(r => ({...r, updated_at: null}));
    renderOpeningHoursTable();
    if (hoursMsg) hoursMsg.textContent = 'Padrão carregado (clique em Salvar para gravar).';
  });

// ===== Início =====
  tryAutoLogin();

  /* =========================
   SIDEBAR (MENU HAMBURGUER)
========================= */
(function initSidebarMenu(){
  const btnMenu = document.getElementById('btnMenu');
  const btnMenuClose = document.getElementById('btnMenuClose');
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');

  if (!btnMenu || !sidebar || !backdrop) return;

  function openMenu(){
    backdrop.classList.remove('hidden');
    sidebar.classList.remove('hidden');
    requestAnimationFrame(() => sidebar.classList.add('open'));
    btnMenu.setAttribute('aria-expanded', 'true');
  }

  function closeMenu(){
    sidebar.classList.remove('open');
    btnMenu.setAttribute('aria-expanded', 'false');
    setTimeout(() => {
      sidebar.classList.add('hidden');
      backdrop.classList.add('hidden');
    }, 180);
  }

  btnMenu.addEventListener('click', () => {
    const isOpen = sidebar.classList.contains('open');
    if (isOpen) closeMenu();
    else openMenu();
  });

  if (btnMenuClose) btnMenuClose.addEventListener('click', closeMenu);
  backdrop.addEventListener('click', closeMenu);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar.classList.contains('open')) closeMenu();
  });

  // Fecha o menu ao clicar em qualquer item do menu (tab-btn)
  sidebar.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (btn) closeMenu();
  });
})();
