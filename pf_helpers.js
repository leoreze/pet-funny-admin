/* PATCH: Fase 1 (Helpers compartilhados) - 2025-12-22
   Objetivo: centralizar helpers reutilizáveis (string, tempo, telefone, datas, moeda),
   sem alterar comportamento do sistema.
*/
(function () {
  'use strict';

  if (window.PF_HELPERS) return;

  function normStr(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function normalizeHHMM(t) {
    const s = String(t || '').trim();
    const m = s.match(/^(\d{1,2}):(\d{1,2})/);
    if (!m) return null;
    const hh = pad2(parseInt(m[1], 10));
    const mm = pad2(parseInt(m[2], 10));
    if (!Number.isFinite(Number(hh)) || !Number.isFinite(Number(mm))) return null;
    return `${hh}:${mm}`;
  }

  function hhmmToMinutes(hhmm) {
    const m = String(hhmm || '').match(/^(\d{2}):(\d{2})$/);
    if (!m) return NaN;
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (!Number.isFinite(h) || !Number.isFinite(min)) return NaN;
    if (h < 0 || h > 23 || min < 0 || min > 59) return NaN;
    return h * 60 + min;
  }

  function minutesToHHMM(totalMin) {
    const hh = Math.floor(totalMin / 60);
    const mm = totalMin % 60;
    return `${pad2(hh)}:${pad2(mm)}`;
  }

  // Backend aceita somente minutos 00 ou 30
  function normalizeTimeForApi(timeStr) {
    if (!timeStr) return null;

    const m = String(timeStr).match(/^(\d{1,2}):(\d{1,2})/);
    if (!m) return null;

    const hh = pad2(parseInt(m[1], 10));
    const mm = pad2(parseInt(m[2], 10));

    if (mm !== '00' && mm !== '30') return null;

    return `${hh}:${mm}`;
  }

  function toISODateOnly(date) {
    const ano = date.getFullYear();
    const mes = pad2(date.getMonth() + 1);
    const dia = pad2(date.getDate());
    return `${ano}-${mes}-${dia}`;
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
    const dia = pad2(d.getDate());
    const mes = pad2(d.getMonth() + 1);
    const ano = d.getFullYear();
    const hora = pad2(d.getHours());
    const min = pad2(d.getMinutes());
    return `${dia}/${mes}/${ano} ${hora}:${min}`;
  }

  function sanitizePhone(phone) { return (phone || '').replace(/\D/g, ''); }

  function formatTelefone(phone) {
    const digits = (phone || '').replace(/\D/g, '');
    if (digits.length === 11) return digits.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
    if (digits.length === 10) return digits.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
    return phone || '-';
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

  function formatCentsToBRL(cents, withSymbol = true) {
    const v = Number(cents || 0) / 100;
    if (withSymbol) return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  window.PF_HELPERS = {
    normStr,
    pad2,
    normalizeHHMM,
    hhmmToMinutes,
    minutesToHHMM,
    normalizeTimeForApi,
    toISODateOnly,
    formatDataBr,
    formatDateTimeBr,
    sanitizePhone,
    formatTelefone,
    parseBRLToCents,
    formatCentsToBRL,
  };

  // Expor também como globais "de compatibilidade" (não sobrescreve se já existir)
  window.normStr = window.normStr || normStr;
  window.normalizeHHMM = window.normalizeHHMM || normalizeHHMM;
  window.hhmmToMinutes = window.hhmmToMinutes || hhmmToMinutes;
  window.minutesToHHMM = window.minutesToHHMM || minutesToHHMM;
  window.toISODateOnly = window.toISODateOnly || toISODateOnly;
  window.formatDataBr = window.formatDataBr || formatDataBr;
  window.formatDateTimeBr = window.formatDateTimeBr || formatDateTimeBr;
  window.sanitizePhone = window.sanitizePhone || sanitizePhone;
  window.formatTelefone = window.formatTelefone || formatTelefone;

})();

// =========================================================
// PATCH: PF Hint Modal/Toast + AutoFocus
// Date: 2025-12-28
// =========================================================
(function () {
  if (window.pfHint) return; // evita duplicar

  let overlayEl = null;
  let hideTimer = null;
  let barTimer = null;

  function ensureUI() {
    if (overlayEl) return;

    overlayEl = document.createElement('div');
    overlayEl.className = 'pf-hint-overlay';
    overlayEl.innerHTML = `
      <div class="pf-hint-modal pf-type-info" role="dialog" aria-live="polite" aria-modal="true">
        <div class="pf-hint-head">
          <div class="pf-hint-left">
            <div class="pf-hint-ic" aria-hidden="true">ℹ️</div>
            <div>
              <div class="pf-hint-title">Aviso</div>
              <p class="pf-hint-msg"></p>
            </div>
          </div>
          <button class="pf-hint-x" type="button" aria-label="Fechar">×</button>
        </div>
        <div class="pf-hint-bar"><i></i></div>
      </div>
    `;

    document.body.appendChild(overlayEl);

    // Fechar ao clicar fora
    overlayEl.addEventListener('click', (e) => {
      if (e.target === overlayEl) hide();
    });

    // Fechar no X
    overlayEl.querySelector('.pf-hint-x').addEventListener('click', hide);

    // Esc fecha
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlayEl.style.display === 'flex') hide();
    });
  }

  function setType(modal, type) {
    modal.classList.remove('pf-type-success', 'pf-type-error', 'pf-type-warn', 'pf-type-info');
    modal.classList.add(`pf-type-${type || 'info'}`);

    const ic = modal.querySelector('.pf-hint-ic');
    const title = modal.querySelector('.pf-hint-title');

    if (type === 'success') { ic.textContent = '✅'; title.textContent = 'Sucesso'; }
    else if (type === 'error') { ic.textContent = '⚠️'; title.textContent = 'Atenção'; }
    else if (type === 'warn') { ic.textContent = '⚠️'; title.textContent = 'Atenção'; }
    else { ic.textContent = 'ℹ️'; title.textContent = 'Informação'; }
  }

  function focusField(el, { shake = true, highlightMs = 1200 } = {}) {
    if (!el) return;
    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (_) {}

    // focus após um pequeno delay para garantir que o modal já apareceu
    setTimeout(() => {
      try { el.focus({ preventScroll: true }); } catch (_) { try { el.focus(); } catch (__) {} }

      // highlight + shake
      el.classList.add('pf-focus-ring');
      if (shake) el.classList.add('pf-shake');

      setTimeout(() => {
        el.classList.remove('pf-focus-ring');
        el.classList.remove('pf-shake');
      }, highlightMs);
    }, 120);
  }

  function show({ message, type = 'info', durationMs = 1600, focusEl = null, focusOpts = {} } = {}) {
    ensureUI();

    const modal = overlayEl.querySelector('.pf-hint-modal');
    const msgEl = overlayEl.querySelector('.pf-hint-msg');
    const bar = overlayEl.querySelector('.pf-hint-bar > i');

    setType(modal, type);
    msgEl.textContent = message || '';

    // reset timers
    if (hideTimer) clearTimeout(hideTimer);
    if (barTimer) clearInterval(barTimer);

    // show
    overlayEl.style.display = 'flex';
    requestAnimationFrame(() => overlayEl.classList.add('pf-show'));

    // progress bar anim (JS simples para compatibilidade)
    let start = Date.now();
    bar.style.transform = 'scaleX(1)';

    barTimer = setInterval(() => {
      const t = Date.now() - start;
      const p = Math.max(0, 1 - (t / durationMs));
      bar.style.transform = `scaleX(${p})`;
      if (p <= 0) {
        clearInterval(barTimer);
        barTimer = null;
      }
    }, 30);

    // focus if requested
    if (focusEl) focusField(focusEl, focusOpts);

    // auto hide
    hideTimer = setTimeout(hide, durationMs);
  }

  function hide() {
    if (!overlayEl) return;
    overlayEl.classList.remove('pf-show');
    // pequena transição
    setTimeout(() => {
      overlayEl.style.display = 'none';
    }, 120);

    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (barTimer) { clearInterval(barTimer); barTimer = null; }
  }

  // API global
  window.pfHint = { show, hide };
})();
