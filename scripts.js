// PATCH: customer address fields + select-fill defaults - 2025-12-24
/* PATCH: Fix global cacheMimos reference (admin bookings) — 2025-12-24 */
const API_BASE_URL = '';
  /* ===== Helpers de normalização (corrige acentos/variações) ===== */
  function normStr(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }
  // Escapa texto para uso seguro em innerHTML (evita XSS e corrige ReferenceError em refreshSelectedServicesUI)
  function escapeHtml(input) {
    const s = String(input ?? '');
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

/* =========================
   HINT / TOAST (fallback)
   - Compat: alguns fluxos antigos chamam showHint(msg, type)
   - Se existir pfHint (modal toast do sistema), usa ele.
========================= */
function showHint(msg, type = 'info', title = '') {
  try {
    const t = String(type || 'info').toLowerCase();
    const mapped = (t === 'error' || t === 'danger') ? 'error'
      : (t === 'success') ? 'success'
      : (t === 'warning' || t === 'warn') ? 'warning'
      : 'info';

    if (typeof window.pfHint === 'function') {
      window.pfHint({
        type: mapped,
        title: title || (mapped === 'error' ? 'Erro' : 'OK'),
        msg: String(msg || ''),
        time: mapped === 'error' ? 3800 : 2200
      });
      return;
    }
  } catch (_) {}
  // fallback absoluto
  try { alert(String(msg || '')); } catch (_) {}
}

/* =========================
   UX LISTAGEM AGENDAMENTOS (Admin)
   - Dia da semana abaixo da data
   - Link WhatsApp no telefone
   - Destaque por antecedência: <=10h verde, <=4h amarelo, <=1h vermelho
   - Pagamento: pago verde / não pago vermelho
   - Forma: ícone + texto (cabeçalho vira "Forma")
========================= */
function getWeekdayPt(dateISO) {
  try {
    if (!dateISO) return '';
    const d = new Date(String(dateISO).slice(0,10) + 'T00:00:00-03:00');
    return d.toLocaleDateString('pt-BR', { weekday: 'long' }).replace(/^./, c => c.toUpperCase());
  } catch (_) { return ''; }
}
function buildWhatsUrl(phone, msg) {
  try {
    const digits = String(phone || '').replace(/\D+/g,'');
    if (!digits) return '';
    // Brasil: garante DDI 55
    const full = digits.startsWith('55') ? digits : ('55' + digits);
    const base = 'https://api.whatsapp.com/send?phone=' + full;
    if (msg) return base + '&text=' + encodeURIComponent(String(msg));
    return base;
  } catch (_) { return ''; }
}
function setRowTimeHighlight(tr, dateISO, timeHHMM) {
  try {
    if (!tr || !dateISO || !timeHHMM) return;
    const dt = new Date(String(dateISO).slice(0,10) + 'T' + String(timeHHMM).slice(0,5) + ':00-03:00');
    const now = new Date();
    const diffH = (dt.getTime() - now.getTime()) / 3600000;
    tr.classList.remove('row-soon-green','row-soon-yellow','row-soon-red');
    if (diffH > 0 && diffH <= 1) tr.classList.add('row-soon-red');
    else if (diffH > 1 && diffH <= 4) tr.classList.add('row-soon-yellow');
    else if (diffH > 4 && diffH <= 10) tr.classList.add('row-soon-green');
  } catch (_) {}
}
function classPayment(ps) {
  const s = normStr(ps || '');
  if (!s) return 'pay-unknown';

  // IMPORTANTE: checar "não pago" antes de "pago" (porque "nao pago" contém "pago")
  if (
    s.includes('nao pago') || s.includes('não pago') ||
    s.includes('nao') || s.includes('não') ||
    s.includes('pendente') || s.includes('aberto') || s.includes('unpaid')
  ) return 'pay-unpaid';

  if (
    s === 'pago' || s === 'paga' ||
    s.includes(' pago') || s.includes('paid') || s === 'sim'
  ) return 'pay-paid';

  return 'pay-unknown';
}

function iconForMethod(method) {
  const m = normStr(method || '');
  if (!m) return '';
  if (m.includes('dinheiro')) return '💵';
  if (m.includes('pix')) return '❖';
  if (m.includes('credito') || m.includes('crédito')) return '💳';
  if (m.includes('debito') || m.includes('débito')) return '💳';
  if (m.includes('cartao') || m.includes('cartão')) return '💳';
  if (m.includes('transfer')) return '🏦';
  return '-';
}


  /* =========================================================
   MIMOS (Admin)
   - Extraído para /admin/js/modules/mimos.js
   - scripts.js mantém apenas integrações via window.PF_MIMOS (ex.: no fluxo de agendamentos)
========================================================= */

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
      await loadServices();      // garante servicesCache
      try { await loadPackages(); } catch (_) {}
      // garante servicesCache e dropdown de serviços
      // Garante que o select de mimos no agendamento esteja preenchido,
      // e que o dashboard possa calcular os totais por mimo.
      if (window.PF_MIMOS && typeof window.PF_MIMOS.ensureLoaded === 'function') {
        await window.PF_MIMOS.ensureLoaded(true);
      }
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

/* =========================
   WhatsApp – Ficha completa do Pacote (Admin)
========================= */
function normalizeWhatsPhone(phoneRaw){
  let p = String(phoneRaw || '').replace(/\D/g,'');
  if (!p) return '';
  // Se veio sem código do país (11 dígitos BR), adiciona 55
  if (p.length === 10 || p.length === 11) p = '55' + p;
  // Remove zeros à esquerda (caso exista)
  p = p.replace(/^0+/, '');
  return p;
}

function formatDateBrOnly(dateISO){
  try{
    if(!dateISO) return '';
    const d = new Date(String(dateISO).slice(0,10) + 'T00:00:00-03:00');
    const dd = String(d.getDate()).padStart(2,'0');
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const yy = d.getFullYear();
    return `${dd}/${mm}/${yy}`;
  }catch(e){ return String(dateISO||''); }
}

function showPackageDispatchOverlay(subText){
  const ov = document.getElementById('packageDispatchOverlay');
  const sub = document.getElementById('packageDispatchSub');
  if (sub) sub.textContent = String(subText || 'Preparando mensagem do pacote.');
  if (ov){
    ov.style.display = 'flex';
    ov.setAttribute('aria-hidden','false');
  }
}
function hidePackageDispatchOverlay(){
  const ov = document.getElementById('packageDispatchOverlay');
  if (ov){
    ov.style.display = 'none';
    ov.setAttribute('aria-hidden','true');
  }
}

function buildPackageWhatsText({ customerName, petName, sale, bookings, preview }) {
  const nome = String(customerName || '').trim() || '[NOME_DO_CLIENTE]';
  const pet = String(petName || '').trim() || '[NOME_DO_PET]';
  const payStatus = (sale && sale.payment_status != null) ? String(sale.payment_status).trim() : '[STATUS DO PAGAMENTO]';
  const payMethod = (sale && sale.payment_method != null) ? String(sale.payment_method).trim() : '[FORMA DE PAGAMENTO]';

  // Ordena agendamentos por data/hora
  const arr = Array.isArray(bookings) ? bookings.slice() : [];
  arr.sort((a, b) => {
    const da = String(a.date || a.start_date || '');
    const db = String(b.date || b.start_date || '');
    if (da !== db) return da.localeCompare(db);
    return String(a.time || '').localeCompare(String(b.time || ''));
  });

  // Serviços inclusos: por regra do backend, os "inclusos" vêm com value_cents = 0 no 1º banho.
  const includedMap = new Map();
  try {
    const first = arr[0] || null;
    const raw = first ? (first.services_json || first.servicesJson) : null;
    let list = null;
    if (typeof raw === 'string' && raw.trim()) {
      try { list = JSON.parse(raw); } catch (_) {}
    } else if (Array.isArray(raw)) {
      list = raw;
    }
    if (Array.isArray(list)) {
      list.forEach((s) => {
        const title = s && (s.title || s.name) ? String(s.title || s.name).trim() : '';
        const v = (s && s.value_cents != null) ? Number(s.value_cents) : null;
        if (!title) return;
        if (v === 0) includedMap.set(title, (includedMap.get(title) || 0) + 1);
      });
    }
  } catch (_) {}

  const includedLines = [];
  if (includedMap.size) {
    for (const [title, qty] of includedMap.entries()) {
      includedLines.push(`  → ${qty} ${title}.`);
    }
  }

  const lines = [];
  lines.push(`Olá, ${nome}!`);
  lines.push(`Aqui é do *PetFunny – Banho & Tosa*.`);
  lines.push('');
  lines.push(`Primeiramente, queremos agradecer de coração pela confiança em nossa equipe para cuidar do(a) *${pet}*. É um prazer ter você com a gente!`);
  lines.push('');
  lines.push(`Preparamos tudo com muito carinho e, abaixo, você confere a **ficha completa do pacote que acabou de adquirir**, com todas as informações importantes:`);
  lines.push('');
  lines.push(`**Agendamentos do pacote**  `);
  lines.push(`→ Datas e horários de cada banho:`);
  arr.forEach((b, idx) => {
    const dateISO = b.date || b.start_date || '';
    const dd = formatDateBrOnly(dateISO);
    const wkRaw = (typeof getWeekdayPt === 'function') ? String(getWeekdayPt(dateISO) || '') : '';
    const wk = wkRaw ? (wkRaw.charAt(0).toUpperCase() + wkRaw.slice(1)) : '';
    const time = String(b.time || '').slice(0, 5);
    const bathNo = (b.package_seq != null) ? Number(b.package_seq) : ((b.bath_no != null) ? Number(b.bath_no) : (idx + 1));
    const bathTag = String(bathNo).padStart(2, '0');
    const st = (b.status != null) ? String(b.status).trim() : 'confirmado';
    const stNorm = st ? st.toLowerCase() : 'confirmado';
    lines.push(`  → Banho ${bathTag}: ${dd}${wk ? ` (${wk})` : ''} às ${time} — ${stNorm}.`);
  });
  lines.push('');
  lines.push(`→ Serviços incluídos no pacote: `);
  if (includedLines.length) includedLines.forEach(l => lines.push(l));
  lines.push('');
  lines.push(`**Pagamento**  `);
  lines.push(`→ Status do pagamento: ${payStatus}.`);
  lines.push(`→ Forma de pagamento escolhida: ${payMethod}.`);
  lines.push('');
  lines.push(`**Resumo da sua economia**  `);
  lines.push(`→ Comparativo entre valor avulso x valor do pacote.`);
  lines.push(`→ Economia total obtida com o pacote.  `);
  lines.push('');
  lines.push(`Qualquer dúvida, alteração ou se precisar de ajuda, é só responder por aqui.  `);
  lines.push('');
  lines.push(`Estamos à disposição e ansiosos para cuidar do(a) *${pet}* com todo o carinho que ele(a) merece.`);
  lines.push('');
  lines.push(`Até breve!  `);
  lines.push(`*Equipe PetFunny – Banho & Tosa*`);
  return lines.join('\n');
}


function openWhatsAppWithText(phoneRaw, text){
  const phone = normalizeWhatsPhone(phoneRaw);
  if (!phone) return;
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(String(text||''))}`;
  window.open(url, '_blank');
}


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

    // Determina o dia da semana em São Paulo (evita bug de fuso em alguns browsers)
    const dDow = new Date(dateStr + 'T00:00:00-03:00');
    if (Number.isNaN(dDow.getTime())) return 'Data inválida.';
    const dow = dDow.getUTCDay(); // 0=Dom..6=Sáb (São Paulo)

    // Lê horário de funcionamento configurado (menu "Horário de Funcionamento")
    const oh = Array.isArray(openingHoursCache)
      ? openingHoursCache.find(x => Number(x.dow) === Number(dow))
      : null;

    const isClosed = oh ? (
      oh.is_closed === true ||
      oh.is_closed === 1 ||
      oh.is_closed === '1' ||
      oh.is_closed === 't' ||
      oh.is_closed === 'true'
    ) : null;

    // Fallback (se ainda não carregou/foi configurado)
    const openStr = (oh && !isClosed) ? String(oh.open_time || '07:30') : '07:30';
    const closeStr = (oh && !isClosed) ? String(oh.close_time || (dow === 6 ? '13:00' : '17:30')) : (dow === 6 ? '13:00' : '17:30');

    if (isClosed === true || (oh && isClosed) || (!oh && dow === 0)) {
      // Mantém mensagens alinhadas ao comportamento do cliente
      if (dow === 0) return 'Atendemos apenas de segunda a sábado.';
      return 'Dia fechado para agendamentos.';
    }

    const m = /^([01]\d|2[0-3]):[0-5]\d$/.exec(String(timeStr || '').trim());
    if (!m) return 'Horário inválido.';

    const t = parseInt(timeStr.slice(0, 2), 10) * 60 + parseInt(timeStr.slice(3, 5), 10);
    const open = hhmmToMinutes(normalizeHHMM(openStr));
    const close = hhmmToMinutes(normalizeHHMM(closeStr));

    if (!Number.isFinite(open) || !Number.isFinite(close) || close <= open) return 'Horário de funcionamento inválido.';
    if (t < open || t >= close) {
      // Mantém o padrão antigo de texto, mas com horários dinâmicos
      if (dow >= 1 && dow <= 5) return `Segunda a sexta: horários entre ${minutesToHHMM(open)} e ${minutesToHHMM(close)}.`;
      if (dow === 6) return `Sábado: horários entre ${minutesToHHMM(open)} e ${minutesToHHMM(close)}.`;
      return `Horários entre ${minutesToHHMM(open)} e ${minutesToHHMM(close)}.`;
    }

    // Admin também deve seguir a regra do cliente: somente 00 ou 30
    if ((t - open) % 30 !== 0) return 'Escolha um horário fechado (minutos 00 ou 30).';

    // Não permite agendar no passado (comparando data/hora local)
    // EXCEÇÃO (ADMIN): em agendamento AVULSO, permitir registrar datas/horários passados (retroativo).
    const date = new Date(dateStr + 'T' + timeStr + ':00');
    if (Number.isNaN(date.getTime())) return 'Data ou horário inválidos.';

    const kindEl = document.getElementById('formBookingKind');
    const kind = kindEl ? String(kindEl.value || '') : '';
    const allowPast = (kind === 'avulso');
    if (!allowPast) {
      const now = new Date();
      if (date.getTime() < now.getTime() - (60 * 1000)) return 'Não é possível agendar no passado.';
    }

    return null;
  }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function buildRangeForDate(dateStr) {
    if (!dateStr) return null;
    // IMPORTANT: interpret the selected date in America/Sao_Paulo regardless of server/browser timezone.
    // Using an explicit -03:00 offset avoids the common "weekday shifted" bug.
    const d = new Date(dateStr + 'T00:00:00-03:00');
    if (Number.isNaN(d.getTime())) return null;
    const dow = d.getUTCDay(); // 0=Sun..6=Sat (São Paulo)
    // Prefer configured Opening Hours (admin menu "Horário de Funcionamento")
    const oh = Array.isArray(openingHoursCache)
      ? openingHoursCache.find(x => Number(x.dow) === Number(dow))
      : null;
    if (oh) {
      if (oh.is_closed) return { closed: true };
      const openMin = hhmmToMinutes(normalizeHHMM(String(oh.open_time || '')));
      const closeMin = hhmmToMinutes(normalizeHHMM(String(oh.close_time || '')));
      if (!Number.isFinite(openMin) || !Number.isFinite(closeMin) || closeMin <= openMin) return { closed: true };
      return { closed: false, startMin: openMin, endMin: closeMin };
    }
    // Fallback (if Opening Hours were not loaded)
    if (dow === 0) return { closed: true };
    const startMin = 7 * 60 + 30;
    const endMin = (dow === 6) ? (12 * 60) : (17 * 60 + 30);
    return { closed: false, startMin, endMin };
  }
  function getMaxPerHalfHourForDate(dateStr) {
    if (!dateStr) return 1;
    const d = new Date(dateStr + 'T00:00:00-03:00');
    if (Number.isNaN(d.getTime())) return 1;
    const dow = d.getUTCDay();
    const oh = Array.isArray(openingHoursCache)
      ? openingHoursCache.find(x => Number(x.dow) === Number(dow))
      : null;
    if (!oh) return 1;
    if (oh.is_closed) return 0;
    const cap = parseInt(oh.max_per_half_hour, 10);
    return Number.isFinite(cap) && cap > 0 ? cap : 1;
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
    const map = new Map();
    list.forEach(b => {
      if (excludeBookingId != null && String(b.id) === String(excludeBookingId)) return;
      if (!isActiveBookingStatus(b.status)) return;
      const t = normalizeHHMM(b.time);
      if (!t) return;
      map.set(t, (map.get(t) || 0) + 1);
    });
    return map;
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

  function showTab(tabId) {
    // força esconder todas as abas (evita "vazamento" de layout quando algum HTML/CSS externo sobrescreve display)
    tabViews.forEach(view => {
      view.classList.remove('active');
      view.style.display = 'none';
    });

    const target = document.getElementById(tabId);
    if (target) {
      target.classList.add('active');
      target.style.display = 'block';
    }

    // destaca o botão ativo
    tabButtons.forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === tabId));

    // carregamentos sob demanda (mantém comportamento atual)
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
    if (tabId === 'tab-agenda') {
      try { renderAgendaByView(ultimaLista || []); } catch (_) {}
    }
  }

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      if (!tabId) return;
      showTab(tabId);
    });
  });

  // garante estado inicial consistente (evita múltiplas abas visíveis)
  try { showTab(document.querySelector('.tab-btn.active')?.getAttribute('data-tab') || 'tab-agenda'); } catch (_) {}
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
  const statAvulsos = document.getElementById('statAvulsos');
  const statPacotes = document.getElementById('statPacotes');
  const formPanel = document.getElementById('formPanel');
  const bookingId = document.getElementById('bookingId');
  const bookingOriginalStatus = document.getElementById('bookingOriginalStatus');
  
  const bookingIdInput = document.getElementById('bookingId');
const formPhone = document.getElementById('formPhone');
  const formNome = document.getElementById('formNome');
  // PATCH: CEP mask + auto-lookup customer by WhatsApp phone on "Novo cliente" - 2025-12-24
let modoNovoCliente = false;
let _lookupPhoneTimer = null;
function maskCepValue(raw) {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 5) return digits;
  return digits.slice(0, 5) + '-' + digits.slice(5);
}
function attachCepMaskIfPresent() {
  const el =
    document.getElementById('formCep') ||
    document.querySelector('input[name="cep"]') ||
    document.querySelector('input[placeholder*="CEP" i]');
  if (!el) return;
  el.addEventListener('input', () => {
    const masked = maskCepValue(el.value);
    if (el.value !== masked) el.value = masked;
  });
  el.value = maskCepValue(el.value);
}
function setCustomerFormFromLookup(customer) {
  if (formPhone) formPhone.value = customer?.phone || formPhone.value || '';
  if (formNome) formNome.value = customer?.name || '';
  // Endereço (se existir no HTML atual)
  const map = [
    ['formCep', 'cep'],
    ['formStreet', 'street'],
    ['formEndereco', 'street'],
    ['formNumber', 'number'],
    ['formNumero', 'number'],
    ['formComplement', 'complement'],
    ['formComplemento', 'complement'],
    ['formNeighborhood', 'neighborhood'],
    ['formBairro', 'neighborhood'],
    ['formCity', 'city'],
    ['formCidade', 'city'],
    ['formState', 'state'],
    ['formEstado', 'state'],
    ['formUf', 'state'],
    ['formUF', 'state'],
  ];
  for (const [id, key] of map) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.value = (customer && customer[key] != null) ? String(customer[key]) : '';
  }
}
async function tryAutofillCustomerByPhone() {
  if (!modoNovoCliente) return;
  if (!formPhone) return;
  const digits = String(formPhone.value || '').replace(/\D/g, '');
  if (digits.length < 10) return;
  try {
    const data = await apiPost('/api/customers/lookup', { phone: digits });
    const customer = data?.customer;
    if (customer?.id) {
      clienteSelecionadoId = customer.id;
      setCustomerFormFromLookup(customer);
      if (typeof toast === 'function') {
        toast('Cliente já cadastrado. Dados carregados automaticamente.');
      } else {
        console.info('[PetFunny] Cliente já cadastrado. Autofill aplicado.');
      }
    }
  } catch (e) {
    console.warn('[PetFunny] Falha no lookup do cliente por telefone:', e);
  }
}
// Bindings
if (formPhone) {
  formPhone.addEventListener('blur', () => {
    clearTimeout(_lookupPhoneTimer);
    _lookupPhoneTimer = setTimeout(tryAutofillCustomerByPhone, 180);
  });
  formPhone.addEventListener('input', () => {
    clearTimeout(_lookupPhoneTimer);
    _lookupPhoneTimer = setTimeout(tryAutofillCustomerByPhone, 320);
  });
}
attachCepMaskIfPresent();
  const formPetSelect = document.getElementById('formPetSelect');
  const formPrize = document.getElementById('formPrize');
  const formService = document.getElementById('formService');
  const formServiceValue = document.getElementById('formServiceValue');
  const formServiceDuration = document.getElementById('formServiceDuration');
  const btnAddService = document.getElementById('btnAddService');
  const selectedServicesWrap = document.getElementById('selectedServicesWrap');
  const selectedServicesList = document.getElementById('selectedServicesList');
  const servicesTotalEl = document.getElementById('servicesTotal');
  let selectedServiceIds = [];
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
  
  // Atualiza porte atual ao trocar o pet e refaz o select de serviços filtrando por porte
  if (formPetSelect) {
    formPetSelect.addEventListener('change', () => {
      const pid = String(formPetSelect.value || '');
      const pet = bookingPetsCache.find(x => String(x.id) === pid);
      currentPetSize = (pet && pet.size) ? String(pet.size) : '';
      refreshServiceOptionsInAgenda();
    });
  }
const formStatus = document.getElementById('formStatus');
  const formPaymentStatus = document.getElementById('formPaymentStatus');
  const formPaymentMethod = document.getElementById('formPaymentMethod');
  // cache de pets carregados para o agendamento atual (para descobrir o porte)
  let bookingPetsCache = [];
  let currentPetSize = '';
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
/* =========================
   SERVICES (Admin) — módulo interno (restaura loadServices)
   Objetivo: manter compatibilidade com agendamentos/pacotes sem alterar layout.
========================= */



function parseBRLToCents(input) {
  const s = String(input ?? '').trim();
  if (!s) return 0;
  // remove currency symbols/spaces
  const cleaned = s.replace(/[Rr]\$\s/g, '').replace(/\./g, '').replace(/,/g, '.').replace(/[^0-9.\-]/g, '');
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function formatBRLInput(value) {
  // value: cents or number
  const cents = Number(value) || 0;
  return formatBRLFromCents(cents);
}

function getServicesFilters() {
  const t = document.getElementById('filtroServicosTitle');
  const c = document.getElementById('filtroServicosTipo');
  const p = document.getElementById('filtroPorteServicos');
  return {
    title: t ? normStr(t.value) : '',
    category: c ? normStr(c.value) : '',
    porte: p ? normStr(p.value) : '',
  };
}

function applyServicesFilters(list) {
  const f = getServicesFilters();
  return (Array.isArray(list) ? list : []).filter(s => {
    const okTitle = !f.title || normStr(s.title).includes(f.title);
    const okCat = !f.category || normStr(s.category).includes(f.category);
    const okPorte = !f.porte || normStr(s.porte).includes(f.porte);
    return okTitle && okCat && okPorte;
  });
}

function showServicePanel(show) {
  const panel = document.getElementById('serviceFormPanel');
  if (!panel) return;
  panel.classList.toggle('hidden', !show);
  if (show) {
    // foco amigável
    const first = document.getElementById('serviceCategory') || document.getElementById('serviceTitle');
    if (first) first.focus();
  }
}

function setServiceError(msg) {
  const box = document.getElementById('serviceError');
  if (!box) return;
  if (!msg) { box.style.display = 'none'; box.textContent = ''; return; }
  box.textContent = msg;
  box.style.display = 'block';
}

function clearServiceForm() {
  const id = document.getElementById('serviceId');
  const date = document.getElementById('serviceDate');
  const cat = document.getElementById('serviceCategory');
  const title = document.getElementById('serviceTitle');
  const porte = document.getElementById('servicePorte');
  const price = document.getElementById('servicePrice');
  const tempo = document.getElementById('serviceTempo');

  if (id) id.value = '';
  if (date) date.value = '';
  if (cat) cat.value = '';
  if (title) title.value = '';
  if (porte) porte.value = '';
  if (price) price.value = '';
  if (tempo) tempo.value = '';
  setServiceError('');
}

function fillServiceForm(service) {
  const id = document.getElementById('serviceId');
  const date = document.getElementById('serviceDate');
  const cat = document.getElementById('serviceCategory');
  const title = document.getElementById('serviceTitle');
  const porte = document.getElementById('servicePorte');
  const price = document.getElementById('servicePrice');
  const tempo = document.getElementById('serviceTempo');

  if (id) id.value = service?.id != null ? String(service.id) : '';
  if (date) date.value = service?.date != null ? String(service.date) : '';
  if (cat) cat.value = service?.category != null ? String(service.category) : '';
  if (title) title.value = service?.title != null ? String(service.title) : '';
  if (porte) porte.value = service?.porte != null ? String(service.porte) : '';
  if (price) price.value = formatBRLInput(service?.value_cents || 0);
  if (tempo) tempo.value = service?.duration_min != null ? String(service.duration_min) : '';
  setServiceError('');
}

function renderServicesTable() {
  const tbody = document.getElementById('tbodyServices');
  const empty = document.getElementById('servicesEmpty');
  if (!tbody) return;

  const filtered = applyServicesFilters(servicesCache);

  tbody.innerHTML = '';
  if (!filtered.length) {
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  for (const s of filtered) {
    const tr = document.createElement('tr');

    const created = s.created_at || s.createdAt || '';
    const updated = s.updated_at || s.updatedAt || '';

    tr.innerHTML = `
      <td>${escapeHtml(s.date ?? '')}</td>
      <td>${escapeHtml(s.category ?? '')}</td>
      <td>${escapeHtml(s.title ?? '')}</td>
      <td>${escapeHtml(s.porte ?? '')}</td>
      <td>${escapeHtml(String(s.duration_min ?? ''))}</td>
      <td>${escapeHtml(formatBRLFromCents(s.value_cents ?? 0))}</td>
      <td>${escapeHtml(String(created))}</td>
      <td>${escapeHtml(String(updated))}</td>
      <td class="actions-cell">
        <button type="button" class="btn btn-light btn-sm" data-action="edit" data-id="${escapeHtml(s.id)}">Editar</button>
        <button type="button" class="btn btn-light btn-sm" data-action="del" data-id="${escapeHtml(s.id)}">Excluir</button>
      </td>
    `;

    tbody.appendChild(tr);
  }
}

function populateServiceSelects() {
  // Select do agendamento (multi-service)
  const sel = document.getElementById('formService');
  if (sel) {
    const prev = sel.value;
    sel.innerHTML = '<option value="">Selecione...</option>';
    for (const s of servicesCache) {
      const opt = document.createElement('option');
      opt.value = String(s.id);
      opt.textContent = s.title || `Serviço #${s.id}`;
      opt.dataset.value_cents = String(s.value_cents ?? 0);
      opt.dataset.duration_min = String(s.duration_min ?? 0);
      opt.dataset.porte = String(s.porte ?? '');
      opt.dataset.category = String(s.category ?? '');
      sel.appendChild(opt);
    }
    // tenta manter seleção
    if (prev) sel.value = prev;
  }

  // Select do banho base em Pacotes (somente categoria Banho)
  const bathSel = document.getElementById('pkgBathService');
  if (bathSel) {
    const prev = bathSel.value;
    bathSel.innerHTML = '<option value="">Selecione...</option>';
    const baths = (servicesCache || []).filter(s => normStr(s.category) === 'banho');
    for (const s of baths) {
      const opt = document.createElement('option');
      opt.value = String(s.id);
      opt.textContent = s.title || `Banho #${s.id}`;
      bathSel.appendChild(opt);
    }
    if (prev) bathSel.value = prev;
  }
}

async function loadServices() {
  try {
    const resp = await apiGet('/api/services');
    servicesCache = (resp && resp.services) ? resp.services : [];
  } catch (e) {
    console.error('Erro ao carregar serviços:', e);
    servicesCache = [];
  }
  populateServiceSelects();
  renderServicesTable();
  try { if (typeof refreshSelectedServicesUI === 'function') refreshSelectedServicesUI(); } catch (_) {}
  return servicesCache;
}

async function saveServiceFromForm() {
  const idEl = document.getElementById('serviceId');
  const catEl = document.getElementById('serviceCategory');
  const titleEl = document.getElementById('serviceTitle');
  const porteEl = document.getElementById('servicePorte');
  const priceEl = document.getElementById('servicePrice');
  const tempoEl = document.getElementById('serviceTempo');

  const id = idEl && idEl.value ? Number(idEl.value) : null;
  const category = catEl ? String(catEl.value || '') : '';
  const title = titleEl ? String(titleEl.value || '') : '';
  const porte = porteEl ? String(porteEl.value || '') : '';
  const value_cents = parseBRLToCents(priceEl ? priceEl.value : '');
  const duration_min = tempoEl ? Number(tempoEl.value || 0) : 0;

  if (!category) return setServiceError('Selecione a categoria do serviço.');
  if (!title.trim()) return setServiceError('Informe o título do serviço.');
  if (!porte) return setServiceError('Selecione o porte.');
  if (!Number.isFinite(value_cents) || value_cents <= 0) return setServiceError('Informe um preço válido.');
  if (!Number.isFinite(duration_min) || duration_min <= 0) return setServiceError('Informe o tempo (min) do serviço.');

  setServiceError('');

  const payload = { category, title: title.trim(), porte, value_cents, duration_min };

  try {
    if (id) {
      await apiPut(`/api/services/${id}`, payload);
    } else {
      await apiPost('/api/services', payload);
    }
    clearServiceForm();
    showServicePanel(false);
    await loadServices();
  } catch (e) {
    console.error('Erro ao salvar serviço:', e);
    setServiceError((e && e.message) ? e.message : 'Erro ao salvar serviço.');
  }
}

async function deleteServiceById(id) {
  if (!id) return;
  const ok = confirm('Tem certeza que deseja excluir este serviço?');
  if (!ok) return;
  try {
    await apiDelete(`/api/services/${id}`);
    await loadServices();
  } catch (e) {
    console.error('Erro ao excluir serviço:', e);
    alert((e && e.message) ? e.message : 'Erro ao excluir serviço.');
  }
}

function bindServicesEventsOnce() {
  const btnNovo = document.getElementById('btnNovoServico');
  const btnCancel = document.getElementById('btnServiceCancel');
  const btnSave = document.getElementById('btnServiceSave');
  const tbody = document.getElementById('tbodyServices');
  const btnLimpar = document.getElementById('btnLimparServicos');

  const t = document.getElementById('filtroServicosTitle');
  const c = document.getElementById('filtroServicosTipo');
  const p = document.getElementById('filtroPorteServicos');

  if (btnNovo && !btnNovo.dataset.bound) {
    btnNovo.dataset.bound = '1';
    btnNovo.addEventListener('click', () => {
      clearServiceForm();
      showServicePanel(true);
    });
  }

  if (btnCancel && !btnCancel.dataset.bound) {
    btnCancel.dataset.bound = '1';
    btnCancel.addEventListener('click', () => {
      clearServiceForm();
      showServicePanel(false);
    });
  }

  if (btnSave && !btnSave.dataset.bound) {
    btnSave.dataset.bound = '1';
    btnSave.addEventListener('click', () => saveServiceFromForm());
  }

  if (btnLimpar && !btnLimpar.dataset.bound) {
    btnLimpar.dataset.bound = '1';
    btnLimpar.addEventListener('click', () => {
      if (t) t.value = '';
      if (c) c.value = '';
      if (p) p.value = '';
      renderServicesTable();
    });
  }

  [t, c, p].forEach(el => {
    if (!el || el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('input', () => renderServicesTable());
    el.addEventListener('change', () => renderServicesTable());
  });

  if (tbody && !tbody.dataset.bound) {
    tbody.dataset.bound = '1';
    tbody.addEventListener('click', (ev) => {
      const btn = ev.target && ev.target.closest ? ev.target.closest('button[data-action]') : null;
      if (!btn) return;
      const action = btn.getAttribute('data-action');
      const id = Number(btn.getAttribute('data-id') || 0);
      const svc = (servicesCache || []).find(s => Number(s.id) === id);
      if (action === 'edit' && svc) {
        fillServiceForm(svc);
        showServicePanel(true);
      }
      if (action === 'del') deleteServiceById(id);
    });
  }

  // máscara simples de BRL no input de preço
  const price = document.getElementById('servicePrice');
  if (price && !price.dataset.bound) {
    price.dataset.bound = '1';
    price.addEventListener('blur', () => {
      const cents = parseBRLToCents(price.value);
      price.value = cents ? formatBRLFromCents(cents) : '';
    });
  }
}

// garante binding mesmo que initApp retorne cedo
try { bindServicesEventsOnce(); } catch (_) {}
  let petEditIdLocal = null;
  function setEditMode(isEdit) {
    // Em edição: mantém Tutor/Telefone travados, mas permite editar Pet e Mimo
    formPhone.disabled = isEdit;
    formNome.disabled = isEdit;
    formPetSelect.disabled = false;
    formPrize.disabled = false;
  }
  /* ===== Estado de disponibilidade (Admin) ===== */
  let occupiedTimesMap = new Map();
  async function refreshBookingDateTimeState(excludeBookingId) {
    if (!formDate || !formTime) return;
    const dateStr = formDate.value;
    if (!dateStr) return;
    const range = buildRangeForDate(dateStr);
    if (!range || range.closed) {
      formTime.disabled = true;
      formTime.value = '';
      occupiedTimesMap = new Map();
      return;
    }
    formTime.disabled = false;
    formTime.step = 1800; // 30 min
    formTime.min = minutesToHHMM(range.startMin);
    formTime.max = minutesToHHMM(range.endMin);
    // carrega horários ocupados do dia (exclui o próprio agendamento em edição)
    try {
      occupiedTimesMap = await loadOccupiedTimesForDate(dateStr, excludeBookingId);
    } catch (e) {
      console.warn('Falha ao carregar horários ocupados:', e);
      occupiedTimesMap = new Map();
    }
    // ajusta (clamp) se estiver fora da faixa / minutos diferentes de 00/30
    if (formTime.value) {
      const clamped = clampToRange(formTime.value, range);
      if (clamped) formTime.value = clamped;
    }
  }
  function getCapacityForDate(dateStr) {
    const cache = (window.__pf_openingHoursCache || []);
    if (!dateStr) return 1;
    const d = new Date(dateStr + "T12:00:00");
    if (Number.isNaN(d.getTime())) return 1;
    const dow = d.getDay();
    const row = cache.find(r => Number(r.dow) === Number(dow));
    if (!row) return 1;
    if (row.is_closed) return 0;
    const cap = Number(row.max_per_half_hour);
    return Number.isFinite(cap) ? cap : 1;
  }
  function isTimeOccupied(timeStr) {
    const t = normalizeHHMM(timeStr);
    if (!t) return false;
    const cap = getCapacityForDate(formDate ? formDate.value : "");
    if (cap <= 0) return true;
    const used = occupiedTimesMap.get(t) || 0;
    return used >= cap;
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
    const total = Array.isArray(lista) ? lista.length : 0;
    // Avulso x Pacote: consideramos "pacote" quando existe package_sale_id (cada banho do pacote vira uma linha)
    const totalPacotes = (Array.isArray(lista) ? lista : []).filter(a => a && a.package_sale_id != null).length;
    const totalAvulsos = total - totalPacotes;

    if (statTotal) statTotal.textContent = String(total);
    if (statAvulsos) statAvulsos.textContent = String(totalAvulsos);
    if (statPacotes) statPacotes.textContent = String(totalPacotes);
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
    bookingPetsCache = pets;
    formPetSelect.innerHTML = '<option value="">(Sem pet informado)</option>';
    pets.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.breed ? `${p.name} (${p.breed})` : p.name;
      formPetSelect.appendChild(opt);
    });
    // tenta manter porte atual (caso esteja editando e o pet já esteja selecionado)
    const currentPetId = formPetSelect ? String(formPetSelect.value || '') : '';
    if (currentPetId) {
      const pet = bookingPetsCache.find(x => String(x.id) === currentPetId);
      currentPetSize = (pet && pet.size) ? String(pet.size) : '';
    } else {
      currentPetSize = '';
    }
    refreshServiceOptionsInAgenda(); // refaz o select respeitando porte
    return pets;
  }
  function preencherFormEdicao(booking) {
  // ID do agendamento em edição
  const id = booking && booking.id ? String(booking.id) : '';
  // Compat: em alguns patches antigos, o ID era referenciado como bookingIdInput
  const _bookingIdEl = (typeof bookingIdInput !== 'undefined' && bookingIdInput) ? bookingIdInput : (typeof bookingId !== 'undefined' ? bookingId : document.getElementById('bookingId'));
  if (_bookingIdEl) _bookingIdEl.value = id;
  // Cliente/Telefone
  formPhone.value = booking && booking.phone ? booking.phone : '';
  applyPhoneMask(formPhone); // garante máscara também ao carregar
  // Tipo (avulso | pacote) em edição
  const bk = document.getElementById('formBookingKind');
  const pkgSel = document.getElementById('formPackageId');
  const isPkg = !!(booking && booking.package_sale_id);
  const kind = isPkg ? 'pacote' : 'avulso';
  if (bk) bk.value = kind;
  if (typeof updateBookingKindUI === 'function') updateBookingKindUI(kind);
  if (formNome) formNome.value = booking && (booking.customer_name || booking.name) ? (booking.customer_name || booking.name) : (formNome.value || '');
  // Carrega pets do cliente para permitir selecionar/validar porte
  const custId = booking && (booking.customer_id || booking.customerId) ? (booking.customer_id || booking.customerId) : null;
  if (custId) {
    loadPetsForCustomer(custId).then(() => {
      if (booking && booking.pet_id) formPetSelect.value = String(booking.pet_id);
      const pid = String(formPetSelect.value || '');
      const pet = bookingPetsCache.find(x => String(x.id) === pid);
      currentPetSize = (pet && pet.size) ? String(pet.size) : '';
      refreshServiceOptionsInAgenda();
      // Se for edição de pacote, após carregar o pet (porte), carrega e seleciona o pacote do registro.
      if (isPkg && typeof refreshPackageSelectForBooking === 'function') {
        Promise.resolve(refreshPackageSelectForBooking())
          .then(() => {
            if (pkgSel && booking && booking.package_id != null) pkgSel.value = String(booking.package_id);
            if (pkgSel) pkgSel.disabled = true;
          })
          .catch(() => {});
      }
    }).catch(()=>{});
  } else {
    bookingPetsCache = [];
    currentPetSize = '';
    refreshServiceOptionsInAgenda();
  }
  // Data / Horário
  formDate.value = booking && booking.date ? booking.date : '';
  formTime.value = booking && booking.time ? booking.time : '';
  // Status + pagamento
  formStatus.value = booking && booking.status ? booking.status : 'agendado';
  bookingOriginalStatus.value = booking && booking.status ? booking.status : 'agendado';
  if (formPaymentStatus) formPaymentStatus.value = booking && booking.payment_status ? booking.payment_status : 'Não Pago';
  if (formPaymentMethod) formPaymentMethod.value = booking && booking.payment_method ? booking.payment_method : '';
  if (formNotes) formNotes.value = booking && booking.notes ? booking.notes : '';
  // Serviço(s)
  clearSelectedServices();
  let servicesJson = booking && booking.services_json ? booking.services_json : null;
  if (typeof servicesJson === 'string') {
    try { servicesJson = JSON.parse(servicesJson); } catch (_) { servicesJson = null; }
  }
  if (Array.isArray(servicesJson) && servicesJson.length) {
    selectedServiceIds = servicesJson.map(s => String(s.id)).filter(Boolean);
  } else if (booking && booking.service_id) {
    selectedServiceIds = [String(booking.service_id)];
  }
  // Ajusta select para o 1º serviço (para facilitar adicionar/alterar)
  formService.value = selectedServiceIds[0] || '';
  refreshSelectedServicesUI();
  // Mimo (pode ser nulo)
  const prizeVal = booking && booking.prize ? booking.prize : 'Sem mimo';
  formPrize.value = prizeVal;
  // Ajustes de UI/locks por tipo em edição (Pacote vs Avulso)
  if (isPkg) {
    // Garante que o select de pacotes esteja carregado e selecione o pacote do registro
    if (typeof refreshPackageSelectForBooking === 'function') {
      Promise.resolve(refreshPackageSelectForBooking())
        .then(() => {
          if (pkgSel && booking && booking.package_id != null) pkgSel.value = String(booking.package_id);
          if (pkgSel) pkgSel.disabled = true;
        })
        .catch(() => {});
    } else {
      if (pkgSel && booking && booking.package_id != null) pkgSel.value = String(booking.package_id);
      if (pkgSel) pkgSel.disabled = true;
    }

    // Travas: tudo travado exceto Data, Horário e Status
    if (bk) bk.disabled = true;
    if (formPetSelect) formPetSelect.disabled = true;
    if (formPrize) formPrize.disabled = true;
    if (formPaymentStatus) formPaymentStatus.disabled = true;
    if (formPaymentMethod) formPaymentMethod.disabled = true;
    if (formNotes) formNotes.disabled = false;

    // Serviços não editáveis (e normalmente ocultos no modo pacote)
    if (formService) formService.disabled = true;
    if (btnAddService) btnAddService.disabled = true;
    if (selectedServicesList) selectedServicesList.style.pointerEvents = 'none';

    // Campos liberados
    if (formDate) formDate.disabled = false;
    if (formTime) formTime.disabled = false;
    if (formStatus) formStatus.disabled = false;
  } else {
    // Avulso em edição: mantém fluxo padrão, mas não permite trocar o tipo
    if (bk) bk.disabled = true;
    if (pkgSel) { pkgSel.value = ''; pkgSel.disabled = true; }
    if (formPaymentStatus) formPaymentStatus.disabled = false;
    if (formPaymentMethod) formPaymentMethod.disabled = false;
    if (formNotes) formNotes.disabled = false;
    if (formService) formService.disabled = false;
    if (btnAddService) btnAddService.disabled = false;
    if (selectedServicesList) selectedServicesList.style.pointerEvents = '';
    if (formDate) formDate.disabled = false;
    if (formTime) formTime.disabled = false;
    if (formStatus) formStatus.disabled = false;
  }

  // Após preencher data, recalcula estado do horário (habilita/valida capacidade)
  refreshBookingDateTimeState(id ? Number(id) : null);
}
  /* ===== Serviços (cache, dropdown e CRUD) ===== */
  const btnNovoServico = document.getElementById('btnNovoServico');
  const serviceFormPanel = document.getElementById('serviceFormPanel');
  const serviceId = document.getElementById('serviceId');
  const serviceDate = document.getElementById('serviceDate');
  const serviceTitle = document.getElementById('serviceTitle');
  const serviceCategory = document.getElementById('serviceCategory');
  const servicePorte = document.getElementById('servicePorte');
  const serviceTempo = document.getElementById('serviceTempo');
  const servicePrice = document.getElementById('servicePrice');
  const serviceError = document.getElementById('serviceError');
  const btnServiceCancel = document.getElementById('btnServiceCancel');
  const btnServiceSave = document.getElementById('btnServiceSave');
  const tbodyServices = document.getElementById('tbodyServices'); 
  const servicesEmpty = document.getElementById('servicesEmpty');
  // Filtro de busca (Serviços)
  const filtroServicos = document.getElementById('filtroServicos');
  
  const filtroCategoriaServicos = document.getElementById('filtroCategoriaServicos');const btnLimparServicos = document.getElementById('btnLimparServicos');
  let filtroServicosTxt = '';
  let filtroCategoriaServicosVal = '';

  let packagesCache = [];

function getServiceById(id){
  return servicesCache.find(s => String(s.id) === String(id));
}
function centsToBRL(cents){
  const v = Number(cents || 0) / 100;
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function refreshSelectedServicesUI(){
  if (!selectedServicesList || !selectedServicesWrap || !servicesTotalEl) return;
  selectedServicesList.innerHTML = '';
  let total = 0;
  let totalMin = 0;
  const unique = Array.from(new Set(selectedServiceIds.map(String)));
  selectedServiceIds = unique;
  unique.forEach((sid) => {
    const svc = getServiceById(sid);
    const name = svc ? svc.title : `Serviço #${sid}`;
    const value_cents = svc ? Number(svc.value_cents || 0) : 0;
    const dur = svc ? Number(svc.duration_min || 0) : 0;
    total += value_cents;
    totalMin += dur;
    const li = document.createElement('li');
    li.innerHTML = `
      <span>${escapeHtml(name)} <small style="opacity:.75;">(${centsToBRL(value_cents)} • ${escapeHtml(String(dur))} min)</small></span>
      <button type="button" class="btn btn-danger btn-xs" data-remove-sid="${escapeHtml(String(sid))}">Remover</button>
    `;
    selectedServicesList.appendChild(li);
  });
  servicesTotalEl.textContent = centsToBRL(total);
  selectedServicesWrap.style.display = unique.length ? 'block' : 'none';
  // preenche campos (somatório) - não editáveis
  if (formServiceValue) formServiceValue.value = unique.length ? centsToBRL(total) : '';
  if (formServiceDuration) formServiceDuration.value = unique.length ? String(totalMin) : '';
}
function clearSelectedServices(){
  selectedServiceIds = [];
  refreshSelectedServicesUI();
}
 // [{id,title,value_cents,...}]
  function showServiceForm() { serviceFormPanel.classList.remove('hidden'); }
  function hideServiceForm() { serviceFormPanel.classList.add('hidden'); }
  function clearServiceForm() {
    serviceId.value = '';
    serviceDate.value = toISODateOnly(new Date());
    serviceTitle.value = '';
    if (serviceCategory) serviceCategory.value = '';
    if (servicePorte) servicePorte.value = '';
    if (serviceTempo) serviceTempo.value = '';
    servicePrice.value = '';
    servicePrice.dataset.cents = '';
    serviceError.style.display = 'none';
    serviceError.textContent = '';
  }
  function fillServiceForm(svc) {
    serviceId.value = svc.id;
    serviceDate.value = (svc.date || '').slice(0, 10);
    serviceTitle.value = svc.title || '';
    if (serviceCategory) serviceCategory.value = svc.category || '';
    if (servicePorte) servicePorte.value = svc.porte || '';
    if (serviceTempo) serviceTempo.value = (svc.duration_min != null ? String(svc.duration_min) : '');
    servicePrice.dataset.cents = String(svc.value_cents ?? '');
    servicePrice.value = svc.value_cents != null ? formatCentsToBRL(svc.value_cents) : '';
    serviceError.style.display = 'none';
    serviceError.textContent = '';
  }
  function renderServices() {
    tbodyServices.innerHTML = '';
    const list = (servicesCache || []).filter(s => {
      // filtro por texto (título)
      if (filtroServicosTxt) {
        const hay = normStr((s.title || ''));
        if (!hay.includes(filtroServicosTxt)) return false;
      }
      // filtro por categoria
      if (filtroCategoriaServicosVal) {
        if (String(s.category || '') !== String(filtroCategoriaServicosVal)) return false;
      }
      return true;
    });
    servicesEmpty.style.display = list.length ? 'none' : 'block';
    list.forEach(svc => {
      const tr = document.createElement('tr');
      const tdId = document.createElement('td'); tdId.textContent = svc.id;
      const tdDate = document.createElement('td'); tdDate.textContent = formatDataBr((svc.date || '').slice(0,10));
      const tdCat = document.createElement('td'); tdCat.textContent = svc.category || '-';
      const tdTitle = document.createElement('td'); tdTitle.textContent = svc.title || '-';
      const tdPorte = document.createElement('td'); tdPorte.textContent = svc.porte || '-';
      const tdTempo = document.createElement('td'); tdTempo.textContent = (svc.duration_min != null ? String(svc.duration_min) + ' min' : '-');
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
      tr.appendChild(tdCat);
      tr.appendChild(tdTitle);
      tr.appendChild(tdPorte);
      tr.appendChild(tdTempo);
      tr.appendChild(tdPrice);
      tr.appendChild(tdCreated);
      tr.appendChild(tdUpdated);
      tr.appendChild(tdAcoes);
      tbodyServices.appendChild(tr);
    });
  }
 function refreshServiceOptionsInAgenda() {
  const current = formService.value || '';
  formService.innerHTML = '<option value="">Selecione...</option>';

  const sizeFilter = (typeof currentPetSize === 'string') ? currentPetSize.trim().toLowerCase() : '';

  // 1️⃣ Filtra serviços por porte (regra atual)
  const filtered = (servicesCache || []).filter(svc => {
    if (!sizeFilter) return true;
    if (!svc.porte) return true;
    return String(svc.porte).toLowerCase() === sizeFilter;
  });

  // 2️⃣ Agrupa por categoria
  const grouped = {};
  filtered.forEach(svc => {
    const cat = svc.category || 'Outros';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(svc);
  });

  // 3️⃣ Renderiza por categoria (optgroup)
  Object.keys(grouped).sort().forEach(category => {
    const optgroup = document.createElement('optgroup');
    optgroup.label = category;

    grouped[category].forEach(svc => {
      const opt = document.createElement('option');
      opt.value = svc.id;
      opt.textContent = `${svc.title} (${formatCentsToBRL(svc.value_cents)} • ${svc.duration_min || 0} min)`;
      optgroup.appendChild(opt);
    });

    formService.appendChild(optgroup);
  });

  // 4️⃣ Mantém seleção se existir
  if (current) {
    formService.value = current;
  }
}

if (formService) {
  formService.addEventListener('change', () => {
    const sid = formService.value;
    // Apenas atualiza os campos de apoio (valor/tempo) do serviço atualmente selecionado.
    // A lista multi-serviços é controlada pelo botão "Adicionar".
    const svc = sid ? getServiceById(sid) : null;
    if (formServiceValue) formServiceValue.value = svc ? centsToBRL(Number(svc.value_cents || 0)) : '';
    if (formServiceDuration) formServiceDuration.value = svc ? String(Number(svc.duration_min || 0)) : '';
    // Se ainda não houver nenhum serviço selecionado, mantém compatibilidade: define o primeiro.
    if ((!Array.isArray(selectedServiceIds) || !selectedServiceIds.length) && sid) {
      selectedServiceIds = [String(sid)];
      refreshSelectedServicesUI();
    }
  });
}
// Multi-serviços - adicionar/remover
if (btnAddService) {
    // Multi-serviços desativado: botão oculto no HTML. Mantemos o handler por compatibilidade, mas forçamos 1 serviço.
    btnAddService.addEventListener('click', () => {
    const sid = formService.value;
    if (!sid) return;
    selectedServiceIds.push(String(sid));
    refreshSelectedServicesUI();
  
    });
  }
if (selectedServicesList) {
  selectedServicesList.addEventListener('click', (ev) => {
    const btn = ev.target && ev.target.closest ? ev.target.closest('[data-remove-sid]') : null;
    if (!btn) return;
    const sid = btn.getAttribute('data-remove-sid');
    selectedServiceIds = selectedServiceIds.filter(x => String(x) !== String(sid));
    refreshSelectedServicesUI();
  });
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
    
    const category = serviceCategory ? String(serviceCategory.value || '').trim() : '';
    const porte = servicePorte ? String(servicePorte.value || '').trim() : '';
    const duration_min = serviceTempo ? Number(serviceTempo.value) : null;
// garante dataset.cents sempre atualizado antes de validar
    applyCurrencyMask(servicePrice);
    const value_cents = getCentsFromCurrencyInput(servicePrice);
    if (!date || !title || !category || !porte || !Number.isFinite(duration_min) || duration_min <= 0) {
      serviceError.textContent = 'Preencha: data, categoria, título, porte e tempo (min).';
      serviceError.style.display = 'block';
      return;
    }
    if (value_cents == null || value_cents < 0) {
      serviceError.textContent = 'Valor inválido. Digite no formato moeda (ex: 85,00).';
      serviceError.style.display = 'block';
      return;
    }
    try {
      const body = { date, category, title, porte, duration_min, value_cents };
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
      // Toggle: clica para abrir, clica de novo para fechar
      try {
        if (serviceFormPanel && !serviceFormPanel.classList.contains('hidden')) {
          clearServiceForm();
          hideServiceForm();
          return;
        }
      } catch (_) {}
      clearServiceForm();
      showServiceForm();window.scrollTo({ top: 0, behavior: 'smooth' });
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
  if (filtroCategoriaServicos) {
    filtroCategoriaServicos.addEventListener('change', () => {
      filtroCategoriaServicosVal = String(filtroCategoriaServicos.value || '').trim();
      renderServices();
    });
  }
  if (btnLimparServicos) {
    btnLimparServicos.addEventListener('click', () => {
      if (filtroServicos) filtroServicos.value = '';
      filtroServicosTxt = '';
      if (filtroCategoriaServicos) filtroCategoriaServicos.value = '';
      filtroCategoriaServicosVal = '';
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
      // Toggle: clica para abrir, clica de novo para fechar
      try {
        if (breedFormPanel && !breedFormPanel.classList.contains('hidden')) {
          clearBreedForm();
          hideBreedForm();
          return;
        }
      } catch (_) {}
      clearBreedForm();
      showBreedForm();window.scrollTo({ top: 0, behavior: 'smooth' });
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
  function getServicesInfoFromBooking(a) {
    // Prefer lista vinda do backend (bookings.services_json -> alias services)
    let list = Array.isArray(a && a.services) ? a.services : [];
    // Se vier como string JSON do backend, tenta parsear
    if (!list.length && a && typeof a.services === 'string') {
      try {
        const parsed = JSON.parse(a.services);
        if (Array.isArray(parsed)) list = parsed;
      } catch (_) {}
    }
    // Compat: alguns backends podem retornar 'services_json'
    if (!list.length && a && typeof a.services_json === 'string') {
      try {
        const parsed = JSON.parse(a.services_json);
        if (Array.isArray(parsed)) list = parsed;
      } catch (_) {}
    }
    let titles = [];
    let values = [];
    let times = [];
    let totalCents = null;
    let totalMin = null;
    if (list.length) {
      list.forEach((it) => {
        const t = it && it.title ? String(it.title) : (it && it.id != null ? `Serviço #${it.id}` : '-');
        const vc = (it && it.value_cents != null) ? Number(it.value_cents) : 0;
        const dm = (it && it.duration_min != null) ? Number(it.duration_min) : 0;
        titles.push(t);
        values.push(centsToBRL(Number.isFinite(vc) ? vc : 0));
        times.push(String(Number.isFinite(dm) ? dm : 0) + ' min');
      });
      totalCents = (a && a.services_total_cents != null) ? Number(a.services_total_cents) : null;
      totalMin = (a && a.services_total_min != null) ? Number(a.services_total_min) : null;
      if (!Number.isFinite(totalCents)) {
        totalCents = list.reduce((acc, it) => acc + (Number.isFinite(Number(it.value_cents)) ? Number(it.value_cents) : 0), 0);
      }
      if (!Number.isFinite(totalMin)) {
        totalMin = list.reduce((acc, it) => acc + (Number.isFinite(Number(it.duration_min)) ? Number(it.duration_min) : 0), 0);
      }
      return {
        labels: titles.join(' + '),
        values: values.join(' + '),
        times: times.join(' + '),
        totalCents: totalCents,
        totalMin: totalMin
      };
    }
    // Fallback: modo antigo (um serviço)
    let serviceLabel = (a && (a.service || a.service_title)) ? (a.service || a.service_title) : '-';
    const sid = a && (a.service_id ?? a.serviceId ?? null);
    if (sid != null) {
      const svc = servicesCache.find(s => String(s.id) === String(sid));
      if (svc) {
        serviceLabel = svc.title;
        totalCents = Number(svc.value_cents || 0);
        totalMin = Number(svc.duration_min || 0);
        return {
          labels: serviceLabel,
          values: centsToBRL(totalCents),
          times: String(totalMin) + ' min',
          totalCents,
          totalMin
        };
      }
    } else {
      const match = servicesCache.find(s => normStr(s.title) === normStr(serviceLabel));
      if (match) {
        totalCents = Number(match.value_cents || 0);
        totalMin = Number(match.duration_min || 0);
        return {
          labels: match.title,
          values: centsToBRL(totalCents),
          times: String(totalMin) + ' min',
          totalCents,
          totalMin
        };
      }
    }
    // Último fallback: tentar usar snapshot do booking
    totalCents = (a && a.services_total_cents != null) ? Number(a.services_total_cents) : (a && a.service_value_cents != null ? Number(a.service_value_cents) : 0);
    totalMin = (a && a.services_total_min != null) ? Number(a.services_total_min) : (a && a.service_duration_min != null ? Number(a.service_duration_min) : 0);
    return {
      labels: String(serviceLabel),
      values: centsToBRL(Number.isFinite(totalCents) ? totalCents : 0),
      times: String(Number.isFinite(totalMin) ? totalMin : 0) + ' min',
      totalCents: Number.isFinite(totalCents) ? totalCents : 0,
      totalMin: Number.isFinite(totalMin) ? totalMin : 0
    };
  }
  function getServiceLabelFromBooking(a) {
    return getServicesInfoFromBooking(a).labels;
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
      setRowTimeHighlight(tr, a.date, a.time);

      const tdData = document.createElement('td');
      tdData.innerHTML = `<div>${formatDataBr(a.date)}</div><div class="td-sub">${getWeekdayPt(a.date)}</div>`;

      const tdHora = document.createElement('td'); tdHora.textContent = a.time || '-';
      const tdTutor = document.createElement('td'); tdTutor.textContent = a.customer_name || '-';
      const tdPet = document.createElement('td'); tdPet.textContent = a.pet_name || '-';

      const tdTel = document.createElement('td');
      const waUrl = buildWhatsUrl(a.phone);
      const telLabel = formatTelefone(a.phone);
      tdTel.innerHTML = waUrl ? `<a class="wa-link" href="${waUrl}" target="_blank" rel="noopener">${telLabel}</a>` : telLabel;

      const svcInfo = getServicesInfoFromBooking(a);
      const tdServ = document.createElement('td'); tdServ.textContent = svcInfo.labels;

      const tdValTempo = document.createElement('td');
      const totalV = centsToBRL(Number(svcInfo.totalCents || 0));
      const totalT = String(Number(svcInfo.totalMin || 0)) + ' min';
      const vPart = svcInfo.values ? (svcInfo.values + ' (<strong class="totals">Total: ' + totalV + '</strong>)') : ('<strong class="totals">Total: ' + totalV + '</strong>');
      const tPart = svcInfo.times ? (svcInfo.times + ' (<strong class="totals">Total: ' + totalT + '</strong>)') : ('<strong class="totals">Total: ' + totalT + '</strong>');
      tdValTempo.innerHTML = vPart + ' | ' + tPart;

      const tdMimo = document.createElement('td');
      tdMimo.textContent = a.prize || '-';
      tdMimo.className = 'td-mimo';

      const tdPayStatus = document.createElement('td');
      const psLabel = (a.payment_status || a.paymentStatus || a.pagamento || a.payment || '-');
      const psClass = classPayment(psLabel);
      const psIcon = (psClass === 'pay-paid') ? '✔' : (psClass === 'pay-unpaid' ? '✖' : '•');
      tdPayStatus.innerHTML = `<span class="pay-badge ${psClass}">${psIcon} ${psLabel}</span>`;

      const tdPayMethod = document.createElement('td');
      const pmLabel = (a.payment_method || a.paymentMethod || a.forma_pagamento || a.payment_method || '-');
      const pmIcon = iconForMethod(pmLabel);
      tdPayMethod.innerHTML = pmIcon ? `<span class="pay-method"><span class="pay-icon">${pmIcon}</span><span>${pmLabel}</span></span>` : pmLabel;

      const tdObs = document.createElement('td');
      tdObs.textContent = a.notes || '';
      tdObs.className = 'td-obs';

      const tdStatus = document.createElement('td');
      const spanStatus = document.createElement('span');
      const labelStatus = (a.status || 'agendado');
      spanStatus.textContent = labelStatus;
      spanStatus.className = 'td-status ' + classStatus(labelStatus);
      tdStatus.appendChild(spanStatus);

      const tdAcoes = document.createElement('td');
      const divActions = document.createElement('div');
      divActions.className = 'actions actions-kebab';

      const kebabBtn = document.createElement('button');
      kebabBtn.type = 'button';
      kebabBtn.className = 'kebab-btn';
      kebabBtn.setAttribute('aria-label', 'Ações');
      kebabBtn.textContent = '⋮';

      const kebabMenu = document.createElement('div');
      kebabMenu.className = 'kebab-menu hidden';

      const closeMenu = () => {
        kebabMenu.classList.add('hidden');
        kebabMenu.classList.remove('open');
        kebabMenu.style.display = 'none';
      };

      kebabBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        document.querySelectorAll('.kebab-menu').forEach(m => {
          if (m !== kebabMenu) {
            m.classList.add('hidden');
            m.classList.remove('open');
            m.style.display = 'none';
          }
        });

        const willOpen = kebabMenu.classList.contains('hidden');
        if (willOpen) {
          kebabMenu.classList.remove('hidden');
          kebabMenu.classList.add('open');
          kebabMenu.style.display = 'block';
        } else {
          kebabMenu.classList.add('hidden');
          kebabMenu.classList.remove('open');
          kebabMenu.style.display = 'none';
        }

        if (willOpen) {
          // portal no body p/ não cortar por overflow
          try {
            if (!kebabMenu.dataset.portalAttached) {
              document.body.appendChild(kebabMenu);
              kebabMenu.dataset.portalAttached = '1';
              kebabMenu.classList.add('kebab-menu-portal');
            }
            const rect = kebabBtn.getBoundingClientRect();
            const menuW = 180;
            kebabMenu.style.position = 'fixed';
            kebabMenu.style.minWidth = menuW + 'px';
            kebabMenu.style.zIndex = '999999';
            kebabMenu.style.top = Math.round(rect.bottom + 6) + 'px';
            kebabMenu.style.left = Math.round(Math.max(8, rect.right - menuW)) + 'px';
          } catch (_) {}
        }
      });

      document.addEventListener('click', closeMenu);

      const btnEditar = document.createElement('button');
      btnEditar.textContent = 'Editar';
      btnEditar.className = 'kebab-item';
      btnEditar.type = 'button';
      btnEditar.addEventListener('click', async () => {
        try { await loadOpeningHours(); } catch (e) {}
        try { if (window.PF_MIMOS && window.PF_MIMOS.ensureLoaded) await window.PF_MIMOS.ensureLoaded(); } catch (e) {}
        mostrarFormAgenda();
        setEditMode(true);
        preencherFormEdicao(a);
        closeMenu();
      });

      // WhatsApp somente no último banho do pacote
      try {
        const isPkg = (a && a.package_sale_id != null);
        const seq = Number(a && a.package_seq);
        const tot = Number(a && a.package_total);
        const isLastBath = isPkg && Number.isFinite(seq) && Number.isFinite(tot) && seq === tot;
        if (isLastBath) {
          const btnWhatsLast = document.createElement('button');
          btnWhatsLast.textContent = 'WhatsApp (último banho)';
          btnWhatsLast.className = 'kebab-item';
          btnWhatsLast.type = 'button';
          btnWhatsLast.addEventListener('click', () => {
            const nome = (a.customer_name || '').trim() || 'tudo bem?';
            const pet = (a.pet_name || '').trim() || 'seu pet';
            const msg = `Olá, ${nome}! Passando para confirmar o último banho do pacote do ${pet}. Qualquer dúvida, estou à disposição.`;
            const url = buildWhatsUrl(a.phone, msg);
            if (url) window.open(url, '_blank');
            closeMenu();
          });
          kebabMenu.appendChild(btnWhatsLast);
        }
      } catch (_) {}

      const btnExcluir = document.createElement('button');
      btnExcluir.textContent = 'Excluir';
      btnExcluir.className = 'kebab-item kebab-item-danger';
      btnExcluir.type = 'button';
      btnExcluir.addEventListener('click', async () => {
        if (!confirm('Deseja realmente excluir este agendamento?')) return;
        try {
          await apiDelete('/api/bookings/' + a.id);
          await renderTabela();
          await loadDashboard();
        } catch (e) { alert(e.message); }
        closeMenu();
      });

      kebabMenu.appendChild(btnEditar);
      kebabMenu.appendChild(btnExcluir);

      divActions.appendChild(kebabBtn);
      divActions.appendChild(kebabMenu);
      tdAcoes.appendChild(divActions);

      tr.appendChild(tdData);
      tr.appendChild(tdHora);
      tr.appendChild(tdTutor);
      tr.appendChild(tdPet);
      tr.appendChild(tdTel);
      tr.appendChild(tdServ);
      tr.appendChild(tdValTempo);
      tr.appendChild(tdMimo);
      tr.appendChild(tdPayStatus);
      tr.appendChild(tdPayMethod);
      tr.appendChild(tdObs);
      tr.appendChild(tdStatus);
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
      const _dow = getWeekdayPt(a.date);
      dateWrap.innerHTML = `📅 ${formatDataBr(a.date)}${_dow ? `<div style="font-size:12px;opacity:.8;margin-top:2px;">${_dow}</div>` : ''}`;
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
      const svcInfo = getServicesInfoFromBooking(a);
      const serviceLabel = svcInfo.labels;
      const l1 = document.createElement('div');
      l1.className = 'agenda-line';
      l1.innerHTML = `<span class="agenda-key">Tutor:</span> <span class="agenda-val">${(a.customer_name || '-')}</span>`;
      const l2 = document.createElement('div');
      l2.className = 'agenda-line';
      l2.innerHTML = `<span class="agenda-key">Pet:</span> <span class="agenda-muted">${(a.pet_name || '-')}</span>`;
      const l3 = document.createElement('div');
      l3.className = 'agenda-line';
      const waUrl = buildWhatsUrl(a.phone);
      const telLabel = formatTelefone(a.phone);
      l3.innerHTML = `<span class="agenda-key">Tel:</span> ${waUrl ? `<a class="agenda-muted" href="${waUrl}" target="_blank" rel="noopener">${telLabel}</a>` : `<span class="agenda-muted">${telLabel}</span>`}`;
      const l4 = document.createElement('div');
      l4.className = 'agenda-line';
      l4.innerHTML = `<span class="agenda-key">Serviço(s):</span> <span class="agenda-val">${serviceLabel}</span>`;
      const l4b = document.createElement('div');
      l4b.className = 'agenda-line';
      l4b.innerHTML = `<span class="agenda-key">Valores:</span> <span class="agenda-val">${escapeHtml(svcInfo.values)}</span> <span class="agenda-muted">(Total: ${centsToBRL(Number(svcInfo.totalCents || 0))})</span>`;
      const l4c = document.createElement('div');
      l4c.className = 'agenda-line';
      l4c.innerHTML = `<span class="agenda-key">Tempo(s):</span> <span class="agenda-val">${escapeHtml(svcInfo.times)}</span> <span class="agenda-muted">(Total: ${escapeHtml(String(Number(svcInfo.totalMin || 0)))} min)</span>`;
      const l5 = document.createElement('div');
      l5.className = 'agenda-line';
      l5.innerHTML = `<span class="agenda-key">Mimo:</span> <span class="agenda-val" style="color:var(--turquesa)">${(a.prize || '-')}</span>`;
      main.appendChild(l1);
      main.appendChild(l2);
      main.appendChild(l3);
      main.appendChild(l4);
      main.appendChild(l4b);
      main.appendChild(l4c);
      main.appendChild(l5);

      // Pagamento + Forma (mesmo conteúdo da lista)
      const lPay = document.createElement('div');
      lPay.className = 'agenda-line';
      const psLabel = String(a.payment_status || '').trim() || '—';
      const psClass = classPayment(psLabel);
      const psIcon = (psClass === 'pay-paid') ? '✔' : (psClass === 'pay-unpaid' ? '✖' : '•');
      lPay.innerHTML = `<span class="agenda-key">Pagamento:</span> <span class="pay-badge ${psClass}">${psIcon} ${escapeHtml(psLabel)}</span>`;

      const lForma = document.createElement('div');
      lForma.className = 'agenda-line';
      const pm = String(a.payment_method || '').trim();
      const pmIcon = iconForMethod(pm);
      lForma.innerHTML = `<span class="agenda-key">Forma:</span> <span class="agenda-muted">${pmIcon ? pmIcon + ' ' : ''}${escapeHtml(pm || '—')}</span>`;

      main.appendChild(lPay);
      main.appendChild(lForma);

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
      btnEditar.addEventListener('click', async () => {
        // Em edição, garantir caches carregados antes de preencher (evita precisar clicar em 'Novo Agendamento')
        try { await loadOpeningHours(); } catch (e) {}
        try { if (window.PF_MIMOS && window.PF_MIMOS.ensureLoaded) await window.PF_MIMOS.ensureLoaded(); } catch (e) {}
        mostrarFormAgenda();
        setEditMode(true);
        preencherFormEdicao(a);
      });
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
      if (statTotal) statTotal.textContent = '0';
      if (statAvulsos) statAvulsos.textContent = '0';
      if (statPacotes) statPacotes.textContent = '0';
    }
  }
  function limparForm() {
  bookingId.value = '';
  bookingOriginalStatus.value = 'agendado';
  formPhone.value = '';
  applyPhoneMask(formPhone);
  formNome.value = '';
  formPetSelect.innerHTML = '<option value="">(Sem pet informado)</option>';
  // Mimo default
  formPrize.value = 'Sem mimo';
  // Tipo (avulso/pacote)
  const bk = document.getElementById('formBookingKind');
  const pkgSel = document.getElementById('formPackageId');
  if (bk) bk.value = '';
  if (pkgSel) { pkgSel.value = ''; pkgSel.disabled = true; pkgSel.innerHTML = '<option value="">Selecione um pacote...</option>'; }
  if (typeof updateBookingKindUI === 'function') updateBookingKindUI('');
  // Multi-serviços
  formService.value = '';
  clearSelectedServices();
  if (formServiceValue) formServiceValue.value = '';
  if (formServiceDuration) formServiceDuration.value = '';
  formDate.value = '';
  formTime.value = '';
  formStatus.value = 'agendado';
  if (formPaymentStatus) formPaymentStatus.value = 'Não Pago';
  if (formPaymentMethod) formPaymentMethod.value = '';
  formNotes.value = '';
  formError.style.display = 'none';
  formError.textContent = '';
  setEditMode(false);
}
  // Fecha o formulário de agendamento (compat: usado no fluxo de Pacotes)
  function closeForm() {
    try { limparForm(); } catch (e) {}
    try { esconderFormAgenda(); } catch (e) {}
  }


async function salvarAgendamento() {
    formError.style.display = 'none';
    formError.textContent = '';
    const id = bookingId.value || null;

    // Helpers locais para manter os fluxos "avulso" e "pacote" isolados e evitar variáveis fora de escopo.
    async function resolveCustomerByPhone(phone) {
      if (!phone) return null;
      try {
        const lookup = await apiPost('/api/customers/lookup', { phone });
        if (lookup && lookup.exists && lookup.customer) return lookup.customer;
      } catch (_) {}
      return null;
    }

    async function salvarAgendamentoPacote(pkgId) {
      // Para fechar pacote precisamos: cliente (via telefone), pet, data e hora
      const rawPhone = formPhone.value.trim();
      const phone = sanitizePhone(rawPhone);

      if (!phone) {
        showHint('Preencha telefone (com DDD) para fechar o pacote.', 'error');
        formPhone && formPhone.focus();
        return;
      }

      const customer = await resolveCustomerByPhone(phone);
      if (!customer || !customer.id) {
        showHint('Cliente não cadastrado. Cadastre o cliente (e pets) em "Clientes & Pets" antes de fechar o pacote.', 'error');
        return;
      }

      const customer_id = Number(customer.id);
      const pet_id = formPetSelect && formPetSelect.value ? Number(formPetSelect.value) : null;
      const start_date = String(formDate.value || '').slice(0, 10);
      const time = String(formTime.value || '').slice(0, 5);

      if (!customer_id || !start_date || !time) {
        showHint('Preencha Cliente, Data e Hora para fechar o pacote.', 'error');
        return;
      }

      try {
        const payload = {
          package_id: Number(pkgId),
          customer_id,
          pet_id,
          start_date,
          time: time,
          // também mantém dados do pagamento/obs para o 1º agendamento (se você quiser usar no backend)
          payment_status: formPaymentStatus ? String(formPaymentStatus.value || '').trim() : '',
          payment_method: formPaymentMethod ? String(formPaymentMethod.value || '').trim() : '',
          notes: formNotes ? String(formNotes.value || '') : ''
        };

        const resp = await apiPost('/api/package-sales', payload);

        // Modal de loading + mensagem estruturada (WhatsApp) — apenas 1 modal (redirecionamento)
        try {
          const petName = (formPetSelect && formPetSelect.selectedIndex >= 0 && formPetSelect.options[formPetSelect.selectedIndex])
            ? String(formPetSelect.options[formPetSelect.selectedIndex].text || '').split(' (')[0].trim()
            : '';
          const customerName = (customer && customer.name) ? String(customer.name) : (formNome ? String(formNome.value || '').trim() : '');
          const sale = resp && resp.sale ? resp.sale : null;
          const bookings = resp && Array.isArray(resp.bookings) ? resp.bookings : [];
          const preview = resp && resp.preview ? resp.preview : null;
          const msg = buildPackageWhatsText({ customerName, petName, sale, bookings, preview });

          showPackageDispatchOverlay('Encaminhando Detalhes do Pacote.....');
          // pequena pausa para renderizar o overlay antes de abrir o WhatsApp
          setTimeout(async () => {
            try { openWhatsAppWithText(phone, msg); } catch (e) {}
            setTimeout(() => hidePackageDispatchOverlay(), 1200);
            try { closeForm(); } catch (_) {}
            try { await renderTabela(); } catch (_) {}
            try { await loadDashboard(); } catch (_) {}
          }, 150);
        } catch (e) {
          // se falhar a construção do texto, mantém o fluxo sem bloquear
          try { closeForm(); } catch (_) {}
          await renderTabela();
          await loadDashboard();
        }
      } catch (e) {
        showHint(e && e.message ? e.message : 'Erro ao fechar pacote.', 'error');
      }
    }
    // Se for "Pacote" (fechar pacote e gerar agenda automática), só permite criação (sem editar)
    const bookingKindEl = document.getElementById('formBookingKind');
    const packageGroupEl = document.getElementById('packagePickerGroup');
    const packageIdEl = document.getElementById('formPackageId');

    
    // Obrigatório selecionar Tipo em novo agendamento (para mostrar os campos corretos)
    if (!id && bookingKindEl && !String(bookingKindEl.value || '').trim()) {
      showHint('Selecione o tipo (Avulso ou Pacote) para continuar.', 'error');
      bookingKindEl.focus();
      return;
    }
const bookingKind = bookingKindEl ? String(bookingKindEl.value || 'avulso') : 'avulso';
    if (bookingKind === 'pacote' && !id) {
      const pkgId = packageIdEl ? Number(packageIdEl.value) : 0;
      if (!pkgId) {
        showHint('Selecione um pacote para fechar.', 'error');
        if (packageIdEl) packageIdEl.focus();
        return;
      }
      await salvarAgendamentoPacote(pkgId);
      return;
    }
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
    const servicesLabel = serviceObj ? serviceObj.title : '';
    // Normaliza seleção (mantém compatibilidade com modo multi-serviços)
    let selectedServices = [];
    if (Array.isArray(selectedServiceIds) && selectedServiceIds.length) {
      selectedServices = selectedServiceIds
        .map((sid) => getServiceById(sid))
        .filter(Boolean);
    } else if (serviceObj) {
      selectedServices = [serviceObj];
      selectedServiceIds = [String(serviceObj.id)];
      refreshSelectedServicesUI();
    }
    const firstServiceId = selectedServices.length ? Number(selectedServices[0].id) : (serviceIdSelected || null);
    const servicesLabelAgg = selectedServices.length ? selectedServices.map(s => s.title).join(' + ') : servicesLabel;
    const totalServicesCents = selectedServices.reduce((acc, s) => acc + Number(s.value_cents || 0), 0);
    const totalServicesMin = selectedServices.reduce((acc, s) => acc + Number(s.duration_min || 0), 0);
    const date = formDate.value;
    const time = normalizeHHMM(formTime.value);
    if (time) formTime.value = time;
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
        // Pagamento
        payment_status: formPaymentStatus ? String(formPaymentStatus.value || '').trim() : '',
        payment_method: formPaymentMethod ? String(formPaymentMethod.value || '').trim() : '',
        // Serviços (compatível com modo multi-serviços)
        services: selectedServices.map(s => ({ id: s.id, title: s.title, value_cents: s.value_cents, duration_min: s.duration_min })),
        service_ids: selectedServices.map(s => s.id),
        service_id: firstServiceId,
        service: servicesLabelAgg,
        // Snapshot do total (valor/tempo) no próprio agendamento
        service_value_cents: totalServicesCents,
        service_duration_min: totalServicesMin,
        prize, notes, status
      };
      let precisaWhats = false;
      let urlWhats = null;
      if (id && normStr(status) !== normStr(originalStatus)) {
        const dataBR = formatDataBr(date);
        const petLabel = petIdNum
          ? (formPetSelect.options[formPetSelect.selectedIndex]?.textContent || 'seu pet')
          : 'seu pet';
                const prizeLabel = prize ? prize : 'Sem mimo';
        const msg = buildStatusMessage(status, nome, petLabel, servicesLabel, dataBR, time, prizeLabel);
        let fullPhone = phone;
        if (!(fullPhone.startsWith('55') && fullPhone.length > 11)) fullPhone = '55' + fullPhone;
        urlWhats = `https://api.whatsapp.com/send?phone=${fullPhone}&text=${encodeURIComponent(msg)}`;
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
      const svcInfo = getServicesInfoFromBooking(a);
      const serviceLabel = svcInfo.labels;
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
  btnNovoAgendamento.addEventListener('click', async () => {
    // Toggle: se o formulário já estiver aberto, fecha no mesmo botão.
    try {
      if (formPanel && !formPanel.classList.contains('hidden')) {
        limparForm();
        try { setEditMode(false); } catch (_) {}
        esconderFormAgenda();
        return;
      }
    } catch (_) {}

    limparForm();
    // Garantir caches carregados (horários e mimos) para o NOVO agendamento
    try { await loadOpeningHours(); } catch (e) {}
    try { if (window.PF_MIMOS && window.PF_MIMOS.ensureLoaded) await window.PF_MIMOS.ensureLoaded(); } catch (e) {}
    formDate.value = toISODateOnly(new Date());
    if (formPaymentStatus) formPaymentStatus.value = 'Não Pago';
    if (formPaymentMethod) formPaymentMethod.value = '';
    // dispara change porque set programtico no dispara evento
    try { formDate.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
    // Para novo agendamento, o pet é obrigatório e só pode ser escolhido após carregar os pets do cliente
    formPetSelect.disabled = true;
    formPetSelect.innerHTML = '<option value="">(Digite o telefone para carregar os pets)</option>';
    // Carrega mimos antes de abrir o formulário (evita select vazio no primeiro uso).
    try {
      if (window.PF_MIMOS && typeof window.PF_MIMOS.ensureLoaded === 'function') {
        await window.PF_MIMOS.ensureLoaded(true);
      }
    } catch (e) {
      console.warn('Falha ao carregar mimos:', e);
    }
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
  // PATCH: auto-lookup no CRUD de Clientes ao digitar Telefone (WhatsApp) em "Novo cliente" - 2025-12-24
let modoNovoClienteCRUD = false;
let _lookupCrudTimer = null;
function setCrudCustomerFormFromLookup(customer) {
  if (cliPhone) cliPhone.value = customer?.phone || cliPhone.value || '';
  if (cliName) cliName.value = customer?.name || '';
  // Endereço (se existir no HTML atual)
  const map = [
    ['cliCep', 'cep'],
    ['cliStreet', 'street'],
    ['cliEndereco', 'street'],
    ['cliNumber', 'number'],
    ['cliNumero', 'number'],
    ['cliComplement', 'complement'],
    ['cliComplemento', 'complement'],
    ['cliNeighborhood', 'neighborhood'],
    ['cliBairro', 'neighborhood'],
    ['cliCity', 'city'],
    ['cliCidade', 'city'],
    ['cliState', 'state'],
    ['cliEstado', 'state'],
    ['cliUf', 'state'],
    ['cliUF', 'state'],
  ];
  for (const [id, key] of map) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.value = (customer && customer[key] != null) ? String(customer[key]) : '';
  }
}
async function tryAutofillCrudCustomerByPhone() {
  if (!modoNovoClienteCRUD) return;
  if (!cliPhone) return;
  const digits = String(cliPhone.value || '').replace(/\D/g, '');
  if (digits.length < 10) return;
  try {
    const data = await apiPost('/api/customers/lookup', { phone: digits });
    const customer = data?.customer;
    if (customer?.id) {
      clienteSelecionadoId = customer.id;
      setCrudCustomerFormFromLookup(customer);
      if (typeof toast === 'function') {
        toast('Cliente já cadastrado. Dados carregados automaticamente.');
      } else {
        console.info('[PetFunny] CRUD: cliente já cadastrado. Autofill aplicado.');
      }
    }
  } catch (e) {
    console.warn('[PetFunny] CRUD: falha no lookup por telefone:', e);
  }
}
function attachCepMaskToCrudIfPresent() {
  const el =
    document.getElementById('cliCep') ||
    document.querySelector('#tabClientes input[name="cep"]') ||
    document.querySelector('#tabClientes input[placeholder*="CEP" i]');
  if (!el) return;
  el.addEventListener('input', () => {
    const masked = maskCepValue(el.value);
    if (el.value !== masked) el.value = masked;
  });
  el.value = maskCepValue(el.value);
}
function initCepAutofillToCrudIfPresent() {
  const cepInput = document.getElementById('cliCep');
  if (!cepInput) return;
  // evita múltiplos listeners duplicados
  if (cepInput.dataset.cepBound === '1') return;
  cepInput.dataset.cepBound = '1';
  cepInput.addEventListener('blur', async () => {
    const raw = (cepInput.value || '').replace(/\D/g, '');
    if (raw.length !== 8) return;
    try {
      const resp = await fetch(`https://viacep.com.br/ws/${raw}/json/`);
      const data = await resp.json();
      if (data.erro) return;
      const street = document.getElementById('cliStreet');
      const neighborhood = document.getElementById('cliNeighborhood');
      const city = document.getElementById('cliCity');
      const state = document.getElementById('cliState');
      const complement = document.getElementById('cliComplement');
      if (street && !street.value) street.value = data.logradouro || '';
      if (neighborhood && !neighborhood.value) neighborhood.value = data.bairro || '';
      if (city && !city.value) city.value = data.localidade || '';
      if (state && !state.value) state.value = data.uf || '';
      if (complement && !complement.value) complement.value = data.complemento || '';
    } catch (e) {
      console.warn('Falha ao consultar CEP:', e);
    }
  });
}
if (cliPhone) {
  cliPhone.addEventListener('blur', () => {
    clearTimeout(_lookupCrudTimer);
    _lookupCrudTimer = setTimeout(tryAutofillCrudCustomerByPhone, 180);
  });
  cliPhone.addEventListener('input', () => {
    clearTimeout(_lookupCrudTimer);
    _lookupCrudTimer = setTimeout(tryAutofillCrudCustomerByPhone, 320);
  });
}
attachCepMaskToCrudIfPresent();
initCepAutofillToCrudIfPresent();
// PATCH: select customer fills address fields when present; defaults to empty when missing - 2025-12-24
const cliCep = document.getElementById('cliCep') || document.getElementById('customerCep') || document.getElementById('cep') || null;
const cliStreet = document.getElementById('cliStreet') || document.getElementById('customerStreet') || document.getElementById('street') || null;
const cliNumber = document.getElementById('cliNumber') || document.getElementById('customerNumber') || document.getElementById('number') || null;
const cliComplement = document.getElementById('cliComplement') || document.getElementById('customerComplement') || document.getElementById('complement') || null;
const cliNeighborhood = document.getElementById('cliNeighborhood') || document.getElementById('customerNeighborhood') || document.getElementById('neighborhood') || null;
const cliCity = document.getElementById('cliCity') || document.getElementById('customerCity') || document.getElementById('city') || null;
const cliState = document.getElementById('cliState') || document.getElementById('customerState') || document.getElementById('state') || null;
  const cliError = document.getElementById('cliError');
  const btnCliLimpar = document.getElementById('btnCliLimpar');
  const btnCliSalvar = document.getElementById('btnCliSalvar');
  // Filtro de busca (Clientes & Pets)
  const filtroClientes = document.getElementById('filtroClientes');
  const btnLimparClientes = document.getElementById('btnLimparClientes');
  let filtroClientesTxt = '';
  const clienteFormBlock = document.getElementById('clienteFormBlock');
  const btnNovoCliente = document.getElementById('btnNovoCliente');
  const petName = document.getElementById('petName');
  const petBreed = document.getElementById('petBreed');
  const petSize = document.getElementById('petSize');
  const petCoat = document.getElementById('petCoat');
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

  // Modal: histórico de agendamentos por cliente
  const custHistOverlay = document.getElementById('custHistOverlay');
  const custHistClose = document.getElementById('custHistClose');
  const custHistTitle = document.getElementById('custHistTitle');
  const custHistSub = document.getElementById('custHistSub');
  const custHistTbody = document.getElementById('custHistTbody');

  function closeCustHistModal() {
    if (!custHistOverlay) return;
    custHistOverlay.classList.remove('pf-show');
    custHistOverlay.style.display = 'none';
    custHistOverlay.setAttribute('aria-hidden', 'true');
    if (custHistTbody) custHistTbody.innerHTML = '';
  }

  async function openCustHistModal(customer) {
    if (!custHistOverlay) return;
    if (custHistTitle) custHistTitle.textContent = 'Histórico de agendamentos';
    if (custHistSub) custHistSub.textContent = `${customer?.name || 'Cliente'} • ${formatTelefone(customer?.phone)} • ${Number(customer?.bookings_count || 0)} agendamento(s)`;
    if (custHistTbody) custHistTbody.innerHTML = '<tr><td colspan="6" style="padding:10px;">Carregando...</td></tr>';

    custHistOverlay.style.display = 'flex';
    custHistOverlay.setAttribute('aria-hidden', 'false');
    // animação
    requestAnimationFrame(() => custHistOverlay.classList.add('pf-show'));

    try {
      const data = await apiGet('/api/bookings?customer_id=' + encodeURIComponent(customer.id));
      const rows = data.bookings || [];
      if (!custHistTbody) return;

      if (!rows.length) {
        custHistTbody.innerHTML = '<tr><td colspan="6" style="padding:10px;">Nenhum agendamento encontrado para este cliente.</td></tr>';
        return;
      }

      custHistTbody.innerHTML = '';
      rows.forEach(b => {
        const tr = document.createElement('tr');
        const tdDate = document.createElement('td');
        tdDate.style.padding = '10px';
        tdDate.style.borderBottom = '1px solid rgba(255,255,255,.06)';
        tdDate.textContent = (window.PF_HELPERS?.formatDataBr ? PF_HELPERS.formatDataBr(b.date) : (b.date || '-'));

        const tdTime = document.createElement('td');
        tdTime.style.padding = '10px';
        tdTime.style.borderBottom = '1px solid rgba(255,255,255,.06)';
        tdTime.textContent = b.time || '-';

        const tdPet = document.createElement('td');
        tdPet.style.padding = '10px';
        tdPet.style.borderBottom = '1px solid rgba(255,255,255,.06)';
        tdPet.textContent = b.pet_name || '-';

        const tdServices = document.createElement('td');
        tdServices.style.padding = '10px';
        tdServices.style.borderBottom = '1px solid rgba(255,255,255,.06)';
        // b.services vem como jsonb (array); fallback para service_title
        const svcArr = Array.isArray(b.services) ? b.services : [];
        const svcTxt = svcArr.length
          ? svcArr.map(s => s && (s.title || s.name)).filter(Boolean).join(' + ')
          : (b.service_title || b.service || '-');
        tdServices.textContent = svcTxt;

        const tdStatus = document.createElement('td');
        tdStatus.style.padding = '10px';
        tdStatus.style.borderBottom = '1px solid rgba(255,255,255,.06)';
        tdStatus.textContent = b.status || '-';

        const tdPay = document.createElement('td');
        tdPay.style.padding = '10px';
        tdPay.style.borderBottom = '1px solid rgba(255,255,255,.06)';
        const payStatus = b.payment_status || '-';
        const payMethod = b.payment_method || '';
        tdPay.textContent = payMethod ? `${payStatus} • ${payMethod}` : payStatus;

        tr.appendChild(tdDate);
        tr.appendChild(tdTime);
        tr.appendChild(tdPet);
        tr.appendChild(tdServices);
        tr.appendChild(tdStatus);
        tr.appendChild(tdPay);
        custHistTbody.appendChild(tr);
      });
    } catch (e) {
      if (custHistTbody) custHistTbody.innerHTML = `<tr><td colspan="6" style="padding:10px;">Erro ao carregar histórico: ${String(e.message || e)}</td></tr>`;
    }
  }

  if (custHistClose) custHistClose.addEventListener('click', closeCustHistModal);
  if (custHistOverlay) {
    custHistOverlay.addEventListener('click', (ev) => {
      if (ev.target === custHistOverlay) closeCustHistModal();
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && custHistOverlay.style.display !== 'none') closeCustHistModal();
    });
  }
  function renderClientes() {
    const tbodyClientesEl = document.getElementById('tbodyClientes');
    if (!tbodyClientesEl) return;
    tbodyClientesEl.innerHTML = '';
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

      const tdBookingsCount = document.createElement('td');
      tdBookingsCount.innerHTML = (c.bookings_count != null)
        ? `<span class="badge-mini">${Number(c.bookings_count) || 0} ag.</span>`
        : '-';

         const tdAcoes = document.createElement('td');

      const divActions = document.createElement('div');
      divActions.className = 'actions actions-kebab';

      const kebabBtn = document.createElement('button');
      kebabBtn.type = 'button';
      kebabBtn.className = 'kebab-btn';
      kebabBtn.setAttribute('aria-label', 'Ações');
      kebabBtn.textContent = '⋮';

      const kebabMenu = document.createElement('div');
      kebabMenu.className = 'kebab-menu hidden';

      const closeMenu = () => {
        kebabMenu.classList.add('hidden');
        kebabMenu.classList.remove('open');
        kebabMenu.style.display = 'none';
      };

      kebabBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        document.querySelectorAll('.kebab-menu').forEach(m => {
          if (m !== kebabMenu) {
            m.classList.add('hidden');
            m.classList.remove('open');
            m.style.display = 'none';
          }
        });

        const willOpen = kebabMenu.classList.contains('hidden');
        if (willOpen) {
          kebabMenu.classList.remove('hidden');
          kebabMenu.classList.add('open');
          kebabMenu.style.display = 'block';
        } else {
          closeMenu();
        }

        if (willOpen) {
          try {
            if (!kebabMenu.dataset.portalAttached) {
              document.body.appendChild(kebabMenu);
              kebabMenu.dataset.portalAttached = '1';
              kebabMenu.classList.add('kebab-menu-portal');
            }
            const rect = kebabBtn.getBoundingClientRect();
            const menuW = 200;
            kebabMenu.style.position = 'fixed';
            kebabMenu.style.minWidth = menuW + 'px';
            kebabMenu.style.zIndex = '999999';
            kebabMenu.style.top = Math.round(rect.bottom + 6) + 'px';
            kebabMenu.style.left = Math.round(Math.max(8, rect.right - menuW)) + 'px';
          } catch (_) {}
        }
      });

      document.addEventListener('click', closeMenu);

      const btnSel = document.createElement('button');
      btnSel.textContent = 'Selecionar';
      btnSel.className = 'kebab-item';
      btnSel.type = 'button';
      btnSel.addEventListener('click', async () => {
        clienteSelecionadoId = c.id;
initCepAutofillToCrudIfPresent();
        badgeClienteSelecionado.classList.remove('hidden');
        clienteFormBlock.classList.remove('hidden');
        petsCard.classList.remove('hidden');
        cliPhone.value = formatTelefone(c.phone);
        cliName.value = c.name || '';

        // Endereço: se não existir no cadastro, deve vir vazio (não "undefined"/"null")
   if (cliCep) cliCep.value = c.cep || '';
if (cliStreet) cliStreet.value = c.street || '';
if (cliNumber) cliNumber.value = c.number || '';
if (cliComplement) cliComplement.value = c.complement || '';
if (cliNeighborhood) cliNeighborhood.value = c.neighborhood || '';
if (cliCity) cliCity.value = c.city || '';
if (cliState) cliState.value = c.state || '';
limparPetsForm();
        await loadPetsForClienteTab(c.id);
        closeMenu();
      });

      const btnHist = document.createElement('button');
      btnHist.textContent = 'Histórico';
      btnHist.className = 'kebab-item';
      btnHist.type = 'button';
      btnHist.addEventListener('click', async () => {
        await openCustHistModal(c);
        closeMenu();
      });

      const btnDel = document.createElement('button');
      btnDel.textContent = 'Excluir';
      btnDel.className = 'kebab-item kebab-item-danger';
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
        closeMenu();
      });

      kebabMenu.appendChild(btnSel);
      kebabMenu.appendChild(btnHist);
      kebabMenu.appendChild(btnDel);

      divActions.appendChild(kebabBtn);
      divActions.appendChild(kebabMenu);
      tdAcoes.appendChild(divActions);
      tr.appendChild(tdId);
      tr.appendChild(tdNome);
      tr.appendChild(tdTel);
      tr.appendChild(tdPetsCount);
      tr.appendChild(tdBookingsCount);
      tr.appendChild(tdAcoes);
      tbodyClientesEl.appendChild(tr);
    });
  }
  function limparClienteForm() {
    cliPhone.value = '';
    cliName.value = '';
    if (typeof cliCep !== 'undefined' && cliCep) cliCep.value = '';
    if (typeof cliStreet !== 'undefined' && cliStreet) cliStreet.value = '';
    if (typeof cliNumber !== 'undefined' && cliNumber) cliNumber.value = '';
    if (typeof cliComplement !== 'undefined' && cliComplement) cliComplement.value = '';
    if (typeof cliNeighborhood !== 'undefined' && cliNeighborhood) cliNeighborhood.value = '';
    if (typeof cliCity !== 'undefined' && cliCity) cliCity.value = '';
    if (typeof cliState !== 'undefined' && cliState) cliState.value = '';
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
    // Endereço (inputs podem existir ou não, então lemos de forma defensiva)
    const getVal = (id) => {
      const el = document.getElementById(id);
      return el ? String(el.value || '').trim() : '';
    };
    const payload = {
      phone: phoneDigits,
      name,
      cep: getVal('cliCep'),
      street: getVal('cliStreet'),
      number: getVal('cliNumber'),
      complement: getVal('cliComplement'),
      neighborhood: getVal('cliNeighborhood'),
      city: getVal('cliCity'),
      state: getVal('cliState'),
    };
    if (!payload.phone || payload.phone.length < 10 || !payload.name) {
      cliError.textContent = 'Preencha telefone (com DDD) e nome do tutor.';
      cliError.style.display = 'block';
      return;
    }
    try {
      let data;
      // Se já existe cliente selecionado, tentamos atualizar.
      if (clienteSelecionadoId) {
        try {
          data = await apiPut('/api/customers/' + clienteSelecionadoId, payload);
        } catch (err) {
          // Fallback compatível: alguns backends não expõem PUT e aceitam update via POST com id.
          data = await apiPost('/api/customers', { id: clienteSelecionadoId, ...payload });
        }
      } else {
        // Novo cliente
        data = await apiPost('/api/customers', payload);
        if (data?.customer?.id) clienteSelecionadoId = data.customer.id;
      }
      // Backend pode responder como {customer:{...}} ou {...}
      const customer = data?.customer || data;
      if (customer?.id) clienteSelecionadoId = customer.id;
      badgeClienteSelecionado.classList.remove('hidden');
      petsCard.classList.remove('hidden');
      await loadClientes();
      if (clienteSelecionadoId) await loadPetsForClienteTab(clienteSelecionadoId);
      // feedback visual (modal se existir)
      if (typeof window.pfHint === 'function') {
        window.pfHint({ type: 'success', title: 'Cliente salvo', msg: 'Cadastro atualizado com sucesso.', time: 2200 });
      }
      await loadDashboard();
      await renderTabela();
    } catch (e) {
      const msg = (e && e.message) ? e.message : 'Erro ao salvar cliente.';
      cliError.textContent = msg;
      cliError.style.display = 'block';
      if (typeof window.pfHint === 'function') {
        window.pfHint({ type: 'error', title: 'Erro ao salvar', msg, time: 3200 });
      }
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
      const tdPorte = document.createElement('td'); tdPorte.textContent = p.size || '-';
      const tdPelagem = document.createElement('td'); tdPelagem.textContent = p.coat || '-';
      const tdInfo = document.createElement('td'); tdInfo.textContent = (p.notes || p.info) || '-';
      const tdAcoes = document.createElement('td');

      const divActions = document.createElement('div');
      divActions.className = 'actions actions-kebab';

      const kebabBtn = document.createElement('button');
      kebabBtn.type = 'button';
      kebabBtn.className = 'kebab-btn';
      kebabBtn.setAttribute('aria-label', 'Ações');
      kebabBtn.textContent = '⋮';

      const kebabMenu = document.createElement('div');
      kebabMenu.className = 'kebab-menu hidden';

      const closeMenu = () => {
        kebabMenu.classList.add('hidden');
        kebabMenu.classList.remove('open');
        kebabMenu.style.display = 'none';
      };

      kebabBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        document.querySelectorAll('.kebab-menu').forEach(m => {
          if (m !== kebabMenu) {
            m.classList.add('hidden');
            m.classList.remove('open');
            m.style.display = 'none';
          }
        });

        const willOpen = kebabMenu.classList.contains('hidden');
        if (willOpen) {
          kebabMenu.classList.remove('hidden');
          kebabMenu.classList.add('open');
          kebabMenu.style.display = 'block';
        } else {
          closeMenu();
        }

        if (willOpen) {
          try {
            if (!kebabMenu.dataset.portalAttached) {
              document.body.appendChild(kebabMenu);
              kebabMenu.dataset.portalAttached = '1';
              kebabMenu.classList.add('kebab-menu-portal');
            }
            const rect = kebabBtn.getBoundingClientRect();
            const menuW = 180;
            kebabMenu.style.position = 'fixed';
            kebabMenu.style.minWidth = menuW + 'px';
            kebabMenu.style.zIndex = '999999';
            kebabMenu.style.top = Math.round(rect.bottom + 6) + 'px';
            kebabMenu.style.left = Math.round(Math.max(8, rect.right - menuW)) + 'px';
          } catch (_) {}
        }
      });

      document.addEventListener('click', closeMenu);

      const btnEdit = document.createElement('button');
      btnEdit.textContent = 'Editar';
      btnEdit.className = 'kebab-item';
      btnEdit.type = 'button';
      btnEdit.addEventListener('click', () => {
        petEditIdLocal = p.id;
        petName.value = p.name;
        petBreed.value = p.breed || 'SRD (Sem Raça Definida)';
        if (petSize) petSize.value = p.size || '';
        if (petCoat) petCoat.value = p.coat || '';
        petInfo.value = (p.notes || p.info) || '';
        closeMenu();
      });

      const btnDel = document.createElement('button');
      btnDel.textContent = 'Excluir';
      btnDel.className = 'kebab-item kebab-item-danger';
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
        closeMenu();
      });

      kebabMenu.appendChild(btnEdit);
      kebabMenu.appendChild(btnDel);

      divActions.appendChild(kebabBtn);
      divActions.appendChild(kebabMenu);
      tdAcoes.appendChild(divActions);
      tr.appendChild(tdId);
      tr.appendChild(tdNome);
      tr.appendChild(tdRaca);
      tr.appendChild(tdPorte);
      tr.appendChild(tdPelagem);
      tr.appendChild(tdInfo);
      tr.appendChild(tdAcoes);
      tbodyPets.appendChild(tr);
    });
  }
  function limparPetsForm() {
    petEditIdLocal = null;
    petName.value = '';
    petBreed.value = 'SRD (Sem Raça Definida)';
    if (petSize) petSize.value = '';
    if (petCoat) petCoat.value = '';
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
    const size = petSize ? petSize.value : '';
    const coat = petCoat ? petCoat.value : '';
    const notes = petInfo.value.trim();
if (!name || !breed) {
      petError.textContent = 'Informe nome e raça do pet.';
      petError.style.display = 'block';
      return;
    }
    try {
      if (!petEditIdLocal) {
        await apiPost('/api/pets', { customer_id: clienteSelecionadoId, name, breed, size, coat, notes });
      } else {
        await apiPut('/api/pets/' + petEditIdLocal, { name, breed, size, coat, notes });
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
  btnNovoPet.addEventListener('click', () => {
    // Toggle: clica para abrir, clica de novo para fechar
    try {
      if (petsCard && !petsCard.classList.contains('hidden')) {
        limparPetsForm();
        petsCard.classList.add('hidden');
        return;
      }
    } catch(e) {}
    // garante que o painel de pets está visível e prepara formulário para novo cadastro
    petsCard.classList.remove('hidden');
    limparPetsForm();
    try { petName.focus(); } catch(e) {}
    try { petsCard.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch(e) {}
  });
  btnNovoCliente.addEventListener('click', () => {
    // Toggle: clica para abrir, clica de novo para fechar
    try {
      if (clienteFormBlock && !clienteFormBlock.classList.contains('hidden')) {
        clienteSelecionadoId = null;
        badgeClienteSelecionado.classList.add('hidden');
        cliError.style.display = 'none';
        clienteFormBlock.classList.add('hidden');
        petsCard.classList.add('hidden');
        tbodyPets.innerHTML = '';
        limparPetsForm();
        return;
      }
    } catch(e) {}
    initCepAutofillToCrudIfPresent();modoNovoCliente = true;
modoNovoClienteCRUD = true;
attachCepMaskIfPresent();
attachCepMaskToCrudIfPresent();
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
  function normalizeHHMM_OH(v, fallback) {
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
      window.__pf_openingHoursCache = openingHoursCache;
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
      let open_time = openEl ? normalizeHHMM_OH(openEl.value, '07:30') : '07:30';
      let close_time = closeEl ? normalizeHHMM_OH(closeEl.value, '17:30') : '17:30';
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
      window.__pf_openingHoursCache = openingHoursCache;
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
})();function hhmmToMinutes(hhmm) {
    const m = String(hhmm || '').match(/^(\d{2}):(\d{2})$/);
    if (!m) return NaN;
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (!Number.isFinite(h) || !Number.isFinite(min)) return NaN;
    if (h < 0 || h > 23 || min < 0 || min > 59) return NaN;
    return h * 60 + min;
  }
  function buildRangeForDate(dateStr) {
    if (!dateStr) return null;
    // IMPORTANT: interpret the selected date in America/Sao_Paulo regardless of server/browser timezone.
    // Using an explicit -03:00 offset avoids the common "weekday shifted" bug.
    const d = new Date(dateStr + 'T00:00:00-03:00');
    if (Number.isNaN(d.getTime())) return null;
    const dow = d.getUTCDay(); // 0=Sun..6=Sat (São Paulo)
    // Prefer configured Opening Hours (admin menu "Horário de Funcionamento")
    const oh = Array.isArray(openingHoursCache)
      ? openingHoursCache.find(x => Number(x.dow) === Number(dow))
      : null;
    if (oh) {
      if (oh.is_closed) return { closed: true };
      const openMin = hhmmToMinutes(normalizeHHMM(String(oh.open_time || '')));
      const closeMin = hhmmToMinutes(normalizeHHMM(String(oh.close_time || '')));
      if (!Number.isFinite(openMin) || !Number.isFinite(closeMin) || closeMin <= openMin) return { closed: true };
      return { closed: false, startMin: openMin, endMin: closeMin };
    }
    // Fallback (if Opening Hours were not loaded)
    if (dow === 0) return { closed: true };
    const startMin = 7 * 60 + 30;
    const endMin = (dow === 6) ? (12 * 60) : (17 * 60 + 30);
    return { closed: false, startMin, endMin };
  }
  function getMaxPerHalfHourForDate(dateStr) {
    if (!dateStr) return 1;
    const d = new Date(dateStr + 'T00:00:00-03:00');
    if (Number.isNaN(d.getTime())) return 1;
    const dow = d.getUTCDay();
    const oh = Array.isArray(openingHoursCache)
      ? openingHoursCache.find(x => Number(x.dow) === Number(dow))
      : null;
    if (!oh) return 1;
    if (oh.is_closed) return 0;
    const cap = parseInt(oh.max_per_half_hour, 10);
    return Number.isFinite(cap) && cap > 0 ? cap : 1;
  }

/* =========================
   PACOTES (Admin) - por porte
========================= */

function formatBRLFromCents(c){
  const v = (Number(c)||0)/100;
  return v.toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
}

function safeJson(v, fallback){
  try {
    if (Array.isArray(v)) return v;
    if (!v) return fallback;
    if (typeof v === 'object') return v;
    return JSON.parse(v);
  } catch (_) {
    return fallback;
  }
}

function getSelectedPetPorte(){
  // Para filtrar pacotes no agendamento, usamos o porte do pet selecionado.
  // O select correto no admin é #formPetSelect (agendamento).
  const sel = document.getElementById('formPetSelect');
  const petId = (sel && sel.value) ? Number(sel.value) : null;
  if (!petId) return '';

  // No agendamento, a lista correta é bookingPetsCache; mantém fallback em petsCache por segurança.
  const listA = Array.isArray(bookingPetsCache) ? bookingPetsCache : [];
  const listB = Array.isArray(petsCache) ? petsCache : [];
  const pet = listA.find(p => Number(p.id) === petId) || listB.find(p => Number(p.id) === petId);
  if (!pet) return '';

  // No DB, "size" é o porte (Pequeno/Médio/Grande). Mantém compatibilidade com "porte".
  const raw = pet.size || pet.porte || '';
  return raw ? String(raw) : '';
}
async function loadPackages(){
  // carrega e renderiza tabela de pacotes
  try {
    const resp = await apiGet('/api/packages');
    packagesCache = (resp && resp.packages) ? resp.packages : [];
  } catch (_) {
    packagesCache = [];
  }
  renderPackagesTable();
  // se estiver no modo pacote, atualiza select
  try { await refreshPackageSelectForBooking(); } catch (_) {}
}

function renderPackagesTable(){
  const tbody = document.getElementById('tbodyPackages');
  const empty = document.getElementById('packagesEmpty');
  if (!tbody) return;

  tbody.innerHTML = '';
  const rows = (packagesCache || []);
  if (!rows.length) {
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  for (const p of rows) {
    const pr = p.preview || {};
    const tr = document.createElement('tr');

    const statusTxt = (String(p.is_active) === 'true' || p.is_active === true) ? 'Ativo' : 'Inativo';

    tr.innerHTML = `
      <td>${escapeHtml(p.title || '')}</td>
      <td>${escapeHtml(p.type || '')}</td>
      <td>${escapeHtml(p.porte || '')}</td>
      <td>${Number(p.validity_days || 0)}</td>
      <td>${Number(p.bath_qty || 0)}</td>
      <td>${Number(p.bath_discount_percent || 0)}%</td>
      <td>${formatBRLFromCents(pr.total_pacote_cents || 0)}</td>
      <td>${formatBRLFromCents(pr.total_avulso_cents || 0)}</td>
      <td><strong>${formatBRLFromCents(pr.economia_cents || 0)}</strong></td>
      <td>${statusTxt}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-secondary btn-sm" data-act="edit" data-id="${p.id}">Editar</button>
        <button class="btn btn-danger btn-sm" data-act="del" data-id="${p.id}">Excluir</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll('button[data-act]').forEach(btn => {
    btn.addEventListener('click', async (ev) => {
      const id = Number(ev.currentTarget.getAttribute('data-id'));
      const act = ev.currentTarget.getAttribute('data-act');
      if (act === 'edit') openPackageForm(id);
      if (act === 'del') deletePackage(id);
    });
  });
}

function openPackageForm(id=null){
  const card = document.getElementById('packageFormCard');
  if (!card) return;
  card.style.display = 'block';

  const pkg = id ? (packagesCache||[]).find(p => Number(p.id) === Number(id)) : null;

  document.getElementById('pkgId').value = pkg ? pkg.id : '';
  document.getElementById('pkgTitle').value = pkg ? (pkg.title || '') : '';
  document.getElementById('pkgType').value = pkg ? (pkg.type || 'mensal') : 'mensal';
  document.getElementById('pkgPorte').value = pkg ? (pkg.porte || '') : '';
  document.getElementById('pkgIsActive').value = (pkg ? String(pkg.is_active) : 'true');

  // só abre campos adicionais depois de selecionar porte
  const more = document.getElementById('pkgMoreFields');
  const porteVal = document.getElementById('pkgPorte').value;
  if (more) more.style.display = porteVal ? 'block' : 'none';

  document.getElementById('pkgValidityDays').value = pkg ? Number(pkg.validity_days || 30) : 30;
  document.getElementById('pkgBathQty').value = pkg ? Number(pkg.bath_qty || 4) : 4;
  document.getElementById('pkgBathDiscount').value = pkg ? Number(pkg.bath_discount_percent || 0) : 20;

  // popular listas filtradas
  refreshPackageFormFilters();

  // selecionar banho + inclusos se edição
  if (pkg) {
    const bathSel = document.getElementById('pkgBathService');
    if (bathSel) bathSel.value = String(pkg.bath_service_id || '');

    const inc = safeJson(pkg.includes_json, []);
    const incIds = inc.map(x => x && x.service_id != null ? Number(x.service_id) : null).filter(Boolean);
    document.querySelectorAll('#pkgIncludedList input[type="checkbox"]').forEach(chk => {
      chk.checked = incIds.includes(Number(chk.value));
    });
  }

  recalcPackagePreview();
}

function closePackageForm(){
  const card = document.getElementById('packageFormCard');
  if (card) card.style.display = 'none';
}

function refreshPackageFormFilters(){
  const porte = String(document.getElementById('pkgPorte').value || '');
  const more = document.getElementById('pkgMoreFields');
  if (more) more.style.display = porte ? 'block' : 'none';

  // banhos do porte
  const bathSel = document.getElementById('pkgBathService');
  if (bathSel) {
    bathSel.innerHTML = '';
    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = porte ? 'Selecione o serviço de banho...' : 'Selecione o porte primeiro...';
    bathSel.appendChild(opt0);

    if (porte) {
      const baths = (servicesCache || []).filter(s =>
        String(s.category || '').toLowerCase() === 'banho' &&
        String(s.porte || '') === porte &&
        (s.is_active === true || String(s.is_active) === 'true')
      );
      for (const s of baths) {
        const o = document.createElement('option');
        o.value = String(s.id);
        o.textContent = `${s.title} — ${formatBRLFromCents(s.value_cents)} | ${Number(s.duration_min||0)} min`;
        bathSel.appendChild(o);
      }
    }
  }

  // inclusos do porte (não banho)
  const incWrap = document.getElementById('pkgIncludedList');
  if (incWrap) {
    incWrap.innerHTML = '';
    if (porte) {
      const inc = (servicesCache || []).filter(s =>
        String(s.porte || '') === porte &&
        String(s.category || '').toLowerCase() !== 'banho' &&
        (s.is_active === true || String(s.is_active) === 'true')
      );
      for (const s of inc) {
        const id = `pkgInc_${s.id}`;
        const lbl = document.createElement('label');
        lbl.setAttribute('for', id);
        lbl.innerHTML = `<input type="checkbox" id="${id}" value="${s.id}"> ${escapeHtml(s.title)} <span style="opacity:.65;">(${formatBRLFromCents(s.value_cents)})</span>`;
        incWrap.appendChild(lbl);
      }
    } else {
      incWrap.innerHTML = '<div style="opacity:.7; font-size:13px;">Selecione o porte para listar os serviços inclusos.</div>';
    }
  }
}

function getPackageFormPayload(){
  const title = String(document.getElementById('pkgTitle').value || '').trim();
  const type = String(document.getElementById('pkgType').value || 'mensal');
  const porte = String(document.getElementById('pkgPorte').value || '').trim();
  const is_active = String(document.getElementById('pkgIsActive').value || 'true') === 'true';

  const validity_days = Number(document.getElementById('pkgValidityDays').value || 30);
  const bath_qty = Number(document.getElementById('pkgBathQty').value || 0);
  const bath_discount_percent = Number(document.getElementById('pkgBathDiscount').value || 0);
  const bath_service_id = Number(document.getElementById('pkgBathService').value || 0);

  const includes = [];
  document.querySelectorAll('#pkgIncludedList input[type="checkbox"]').forEach(chk => {
    if (chk.checked) includes.push({ service_id: Number(chk.value) });
  });

  return { title, type, porte, validity_days, bath_qty, bath_discount_percent, bath_service_id, includes, is_active };
}

function recalcPackagePreview(){
  const box = document.getElementById('pkgEconomyPreview');
  if (!box) return;

  const porte = String(document.getElementById('pkgPorte').value || '').trim();
  const bathId = Number(document.getElementById('pkgBathService').value || 0);
  const bathQty = Number(document.getElementById('pkgBathQty').value || 0);
  const discPct = Number(document.getElementById('pkgBathDiscount').value || 0);

  if (!porte || !bathId || !bathQty) {
    box.textContent = 'Selecione o porte e o serviço de banho para ver o resumo.';
    return;
  }

  const bath = (servicesCache||[]).find(s => Number(s.id) === bathId);
  const bathUnit = Number(bath?.value_cents || 0);
  const bathDiscounted = Math.round(bathUnit * (1 - (discPct/100)));

  let incReal = 0;
  const incTitles = [];
  document.querySelectorAll('#pkgIncludedList input[type="checkbox"]').forEach(chk => {
    if (!chk.checked) return;
    const s = (servicesCache||[]).find(x => Number(x.id) === Number(chk.value));
    if (!s) return;
    incReal += Number(s.value_cents || 0);
    incTitles.push(s.title);
  });

  const totalAvulso = (bathQty * bathUnit) + incReal;
  const totalPacote = (bathQty * bathDiscounted);
  const econ = totalAvulso - totalPacote;

  const incText = incTitles.length ? incTitles.map(t=>escapeHtml(t)).join(', ') : 'Nenhum';
  box.innerHTML = `
    <div><strong>${escapeHtml(porte)}</strong></div>
    <div style="margin-top:6px; opacity:.85;">Inclui: ${incText}</div>
    <div class="kpi">
      <span class="pill">Pacote: ${formatBRLFromCents(totalPacote)}</span>
      <span class="pill">Avulso real: ${formatBRLFromCents(totalAvulso)}</span>
      <span class="pill">Economia: ${formatBRLFromCents(econ)}</span>
    </div>
    <div style="margin-top:8px; font-size:12px; opacity:.75;">
      Banho avulso: ${formatBRLFromCents(bathUnit)} | Banho no pacote: ${formatBRLFromCents(bathDiscounted)} | Banhos: ${bathQty}
    </div>
  `;
}

async function savePackage(){
  const id = document.getElementById('pkgId').value ? Number(document.getElementById('pkgId').value) : null;
  const payload = getPackageFormPayload();

  if (!payload.title) return showHint('Informe o nome do pacote.', 'error');
  if (!payload.porte) return showHint('Selecione o porte.', 'error');
  if (!payload.bath_service_id) return showHint('Selecione o serviço de banho.', 'error');

  try {
    if (!id) {
      await apiPost('/api/packages', payload);
      showHint('Pacote criado com sucesso!', 'success');
    } else {
      await apiPut(`/api/packages/${id}`, payload);
      showHint('Pacote atualizado com sucesso!', 'success');
    }
    closePackageForm();
    await loadPackages();
  } catch (e) {
    showHint(e && e.message ? e.message : 'Erro ao salvar pacote.', 'error');
  }
}

async function deletePackage(id){
  if (!id) return;
  if (!confirm('Excluir este pacote?')) return;
  try {
    await apiDelete(`/api/packages/${id}`);
    showHint('Pacote excluído.', 'success');
    await loadPackages();
  } catch (e) {
    showHint(e && e.message ? e.message : 'Erro ao excluir pacote.', 'error');
  }
}


function updateBookingKindUI(kind){
  // Gate (tudo abaixo de "Tipo")
  const gate = document.getElementById('bookingKindDependentFields') || document.getElementById('bookingKindGate');

  // Pacotes
  const grpPkg = document.getElementById('packagePickerGroup');
  const pkgSel = document.getElementById('formPackageId');

  // Avulso: seleção de serviços
  const avulsoOnly = document.getElementById('bookingAvulsoOnly');
  const servicePicker = document.getElementById('service-picker') || document.getElementById('servicePicker') || document.querySelector('.service-picker');
  const selectedWrap = document.getElementById('selectedServicesWrap');
  const metaValue = document.getElementById('formServiceValue');
  const metaDur = document.getElementById('formServiceDuration');

  const k = String(kind || '');

  // ADMIN: em Avulso, permitir selecionar datas passadas (retroativo). Em Pacote, mantém bloqueio no passado.
  const _dateEl = document.getElementById('formDate');
  if (_dateEl) _dateEl.min = (k === 'avulso') ? '' : todayISO;

  // Se não selecionou tipo, esconde tudo abaixo (gate) e reseta áreas específicas
  const showGate = (k === 'avulso' || k === 'pacote');
  if (gate) gate.style.display = showGate ? 'block' : 'none';

  // Default: esconde blocos condicionais
  if (grpPkg) grpPkg.style.display = 'none';
  if (avulsoOnly) avulsoOnly.style.display = 'none';
  if (servicePicker) servicePicker.style.display = 'none';
  if (selectedWrap) selectedWrap.style.display = 'none';

  // Reseta metas (sempre que muda o tipo)
  if (metaValue) metaValue.value = '';
  if (metaDur) metaDur.value = '';

  if (!showGate) {
    if (pkgSel) { pkgSel.disabled = true; }
    return;
  }

  if (k === 'avulso') {
    // Avulso: mostra serviços, esconde pacotes
    if (avulsoOnly) avulsoOnly.style.display = 'block';
    if (servicePicker) servicePicker.style.display = 'block';
    if (pkgSel) { pkgSel.value = ''; pkgSel.disabled = true; }

  } else if (k === 'pacote') {
    // Pacote: mostra pacotes, esconde serviços avulsos
    if (grpPkg) grpPkg.style.display = 'block';

    // Em pacote, serviços vêm do pacote. Limpa qualquer seleção avulsa.
    try {
      if (typeof selectedServiceIds !== 'undefined') {
        selectedServiceIds = [];
        if (typeof refreshSelectedServicesUI === 'function') refreshSelectedServicesUI();
      }
    } catch (e) {}

    // Status: em novo agendamento de pacote começa em "confirmado"; em edição não sobrescreve
    const st = document.getElementById('formStatus');
    const bid = document.getElementById('bookingId');
    const isEditing = !!(bid && String(bid.value || '').trim());
    if (st && !isEditing) st.value = 'confirmado';
  }
}

async function refreshPackageSelectForBooking(){
  const kindEl = document.getElementById('formBookingKind');
  const pkgSel = document.getElementById('formPackageId');
  const grp = document.getElementById('packagePickerGroup');
  if (!kindEl || !pkgSel || !grp) return;

  const kind = String(kindEl.value || '');
  if (typeof updateBookingKindUI === 'function') updateBookingKindUI(kind);
  grp.style.display = (kind === 'pacote') ? 'block' : 'none';

  if (!kind) {
    // nada selecionado ainda: não carrega pacotes
        pkgSel.innerHTML = '<option value="">Selecione o tipo primeiro.</option>';
    return;
  }

  if (kind !== 'pacote') return;

  const porte = getSelectedPetPorte();
  if (!porte) {
        pkgSel.innerHTML = '<option value="">Selecione um pet (com porte) para listar pacotes.</option>';
    return;
  }

  const resp = await apiGet(`/api/packages?porte=${encodeURIComponent(porte)}`);
  const pkgs = (resp && resp.packages) ? resp.packages : [];

  pkgSel.innerHTML = '<option value="">Selecione um pacote...</option>';
  pkgs.forEach(p => {
    const pr = p.preview || {};
    const o = document.createElement('option');
    o.value = String(p.id);
    o.textContent = `${p.title} (${p.type}) — ${formatBRLFromCents(pr.total_pacote_cents || 0)} | economia ${formatBRLFromCents(pr.economia_cents || 0)}`;
    pkgSel.appendChild(o);
  });

  if (!pkgs.length) {
        pkgSel.innerHTML = '<option value="">Nenhum pacote encontrado para este porte.</option>';
  } else {
    pkgSel.disabled = false;
  }
}

/* bindings */
(function bindPackagesUI(){
  const btnNew = document.getElementById('btnNewPackage');
  const btnCancel = document.getElementById('btnCancelPackage');
  const btnSave = document.getElementById('btnSavePackage');
  const porteSel = document.getElementById('pkgPorte');
  const typeSel = document.getElementById('pkgType');

  if (btnNew) btnNew.addEventListener('click', () => openPackageForm(null));
  if (btnCancel) btnCancel.addEventListener('click', closePackageForm);
  if (btnSave) btnSave.addEventListener('click', savePackage);

  if (porteSel) porteSel.addEventListener('change', () => { refreshPackageFormFilters(); recalcPackagePreview(); });

  if (typeSel) typeSel.addEventListener('change', () => {
    // defaults por tipo
    const t = String(typeSel.value || 'mensal');
    const bathQty = document.getElementById('pkgBathQty');
    const disc = document.getElementById('pkgBathDiscount');
    const vig = document.getElementById('pkgValidityDays');
    if (t === 'mensal') { if (bathQty) bathQty.value = 4; if (disc) disc.value = 20; if (vig) vig.value = 30; }
    if (t === 'quinzenal') { if (bathQty) bathQty.value = 2; if (disc) disc.value = 15; if (vig) vig.value = 30; }
    recalcPackagePreview();
  });

  ['pkgBathQty','pkgBathDiscount','pkgBathService'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', recalcPackagePreview);
    if (el) el.addEventListener('change', recalcPackagePreview);
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t && t.closest && t.closest('#pkgIncludedList')) recalcPackagePreview();
  });

  // booking kind
  const bookingKindEl = document.getElementById('formBookingKind');
  if (bookingKindEl) bookingKindEl.addEventListener('change', refreshPackageSelectForBooking);
    const formPetSelect = document.getElementById('formPetSelect');
  if (formPetSelect) formPetSelect.addEventListener('change', refreshPackageSelectForBooking);
})();