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
  /* =========================
     PF Hint Modal (auto-close + focus)
     - Não altera comportamento existente: apenas adiciona helpers globais.
  ========================= */

  function _pfEnsureHintDom() {
    let overlay = document.getElementById('pfHintOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'pfHintOverlay';
      overlay.className = 'pf-hint-overlay';
      overlay.setAttribute('aria-hidden', 'true');
      overlay.innerHTML = `
        <div class="pf-hint-modal" role="dialog" aria-modal="true" aria-label="Notificação">
          <div class="pf-hint-head">
            <div class="pf-hint-left">
              <div class="pf-hint-ic" aria-hidden="true">i</div>
              <div>
                <p class="pf-hint-title" id="pfHintTitle">Aviso</p>
                <p class="pf-hint-msg" id="pfHintMsg"></p>
              </div>
            </div>
            <button class="pf-hint-x" id="pfHintClose" type="button" aria-label="Fechar">×</button>
          </div>
          <div class="pf-hint-bar" aria-hidden="true"><i id="pfHintBar"></i></div>
        </div>
      `;
      document.body.appendChild(overlay);
    }
    return overlay;
  }

  function _pfGetHintEls() {
    const overlay = _pfEnsureHintDom();
    return {
      overlay,
      modal: overlay.querySelector('.pf-hint-modal'),
      ic: overlay.querySelector('.pf-hint-ic'),
      title: overlay.querySelector('#pfHintTitle'),
      msg: overlay.querySelector('#pfHintMsg'),
      close: overlay.querySelector('#pfHintClose'),
      bar: overlay.querySelector('#pfHintBar')
    };
  }

  function _pfSetFocusFx(el) {
    try {
      if (!el) return;
      if (typeof el.focus !== 'function') return;

      // garante que pode receber foco (ex: div)
      if (!/^(input|select|textarea|button|a)$/i.test(el.tagName || '') && !el.hasAttribute('tabindex')) {
        el.setAttribute('tabindex', '-1');
      }

      el.classList.add('pf-focus-ring');
      el.classList.add('pf-shake');
      el.focus({ preventScroll: false });

      setTimeout(() => el.classList.remove('pf-shake'), 520);
      setTimeout(() => el.classList.remove('pf-focus-ring'), 1600);
    } catch (_) {}
  }

  let __pfHintTimer = null;

  function pfHint(opts) {
    const o = opts || {};
    const type = (o.type || 'info').toLowerCase(); // success | error | warn | info
    const title = String(o.title || (type === 'success' ? 'Sucesso' : type === 'error' ? 'Erro' : type === 'warn' ? 'Atenção' : 'Aviso'));
    const message = String(o.message || '');
    const timeout = Number.isFinite(o.timeout) ? o.timeout : 2400;

    const els = _pfGetHintEls();
    if (!els.overlay) return;

    // reset
    if (__pfHintTimer) { clearTimeout(__pfHintTimer); __pfHintTimer = null; }
    els.overlay.style.display = 'flex';
    els.overlay.setAttribute('aria-hidden', 'false');
    els.overlay.classList.remove('pf-type-success','pf-type-error','pf-type-warn','pf-type-info','pf-show');
    els.overlay.classList.add(`pf-type-${type}`);

    // ícone simples
    els.ic.textContent = type === 'success' ? '✓' : type === 'error' ? '!' : type === 'warn' ? '⚠' : 'i';

    els.title.textContent = title;
    els.msg.textContent = message;

    // progress bar
    if (els.bar) {
      els.bar.style.transition = 'none';
      els.bar.style.transform = 'scaleX(1)';
      // anima na próxima frame
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          els.bar.style.transition = `transform ${timeout}ms linear`;
          els.bar.style.transform = 'scaleX(0)';
        });
      });
    }

    // show animation
    requestAnimationFrame(() => els.overlay.classList.add('pf-show'));

    function closeNow() {
      if (__pfHintTimer) { clearTimeout(__pfHintTimer); __pfHintTimer = null; }
      els.overlay.classList.remove('pf-show');
      els.overlay.setAttribute('aria-hidden', 'true');
      setTimeout(() => {
        els.overlay.style.display = 'none';
        // focus no campo após fechar
        if (o.focusEl) _pfSetFocusFx(o.focusEl);
      }, 120);
    }

    // handlers
    const onClose = (ev) => { ev && ev.preventDefault && ev.preventDefault(); closeNow(); };
    if (els.close) {
      els.close.onclick = onClose;
    }
    // click fora fecha
    els.overlay.onclick = (ev) => {
      if (ev && ev.target === els.overlay) closeNow();
    };
    // ESC fecha
    document.onkeydown = (ev) => {
      if (ev && ev.key === 'Escape' && els.overlay.style.display === 'flex') closeNow();
    };

    __pfHintTimer = setTimeout(closeNow, Math.max(800, timeout));

    return { close: closeNow };
  }

  // Aliases simples (compatibilidade com patches anteriores)
  function toast(msg) { return pfHint({ type: 'info', title: 'Info', message: msg, timeout: 2200 }); }
  function toastSuccess(msg) { return pfHint({ type: 'success', title: 'Sucesso', message: msg, timeout: 2200 }); }
  function toastError(msg, focusEl) { return pfHint({ type: 'error', title: 'Erro', message: msg, timeout: 3200, focusEl }); }
  function toastWarn(msg, focusEl) { return pfHint({ type: 'warn', title: 'Atenção', message: msg, timeout: 2800, focusEl }); }

  window.pfHint = window.pfHint || pfHint;
  window.toast = window.toast || toast;
  window.toastSuccess = window.toastSuccess || toastSuccess;
  window.toastError = window.toastError || toastError;
  window.toastWarn = window.toastWarn || toastWarn;

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

