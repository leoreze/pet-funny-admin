/* PATCH: Helpers extracted to pf_helpers.js — 2025-12-22
   PetFunny Admin — shared helper functions
*/
(function () {
  'use strict';

  function normStr(s) {
    return String(s || '').trim().toLowerCase();
  }

  function sanitizePhoneBr(s) {
    return String(s || '').replace(/\D+/g, '').slice(0, 11);
  }

  function formatBRL(n) {
    try {
      return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    } catch {
      return 'R$ 0,00';
    }
  }

  function parseBRLToCents(v) {
    const s = String(v || '')
      .replace(/\s/g, '')
      .replace('R$', '')
      .replace(/\./g, '')
      .replace(',', '.');
    const num = Number(s);
    if (!isFinite(num)) return 0;
    return Math.round(num * 100);
  }

  function formatCentsToNumber(cents) {
    const n = Number(cents || 0) / 100;
    return isFinite(n) ? n : 0;
  }

  function formatCentsToBRL(cents) {
    return formatBRL(formatCentsToNumber(cents));
  }

  function parseDateInputToISO(dateStr) {
    // Expect "YYYY-MM-DD" (input[type=date])
    const s = String(dateStr || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    return s;
  }

  function isHalfHourSlot(hhmm) {
    // Accept only mm 00 or 30
    const m = String(hhmm || '').match(/^(\d{2}):(\d{2})$/);
    if (!m) return false;
    const mm = Number(m[2]);
    return mm === 0 || mm === 30;
  }

  function clampInt(n, min, max) {
    const x = parseInt(n, 10);
    if (!isFinite(x)) return min;
    return Math.max(min, Math.min(max, x));
  }

  function el(id) {
    return document.getElementById(id);
  }

  function show(elm) {
    if (!elm) return;
    elm.style.display = '';
  }

  function hide(elm) {
    if (!elm) return;
    elm.style.display = 'none';
  }

  function setText(elm, txt) {
    if (!elm) return;
    elm.textContent = txt == null ? '' : String(txt);
  }

  function setHTML(elm, html) {
    if (!elm) return;
    elm.innerHTML = html == null ? '' : String(html);
  }

  function safeJsonParse(s, fallback) {
    try {
      return JSON.parse(s);
    } catch {
      return fallback;
    }
  }

  // Namespace export
  window.PF_HELPERS = window.PF_HELPERS || {
    normStr,
    sanitizePhoneBr,
    formatBRL,
    parseBRLToCents,
    formatCentsToNumber,
    formatCentsToBRL,
    parseDateInputToISO,
    isHalfHourSlot,
    clampInt,
    el,
    show,
    hide,
    setText,
    setHTML,
    safeJsonParse
  };

  // Compat exports (used by scripts.js)
  window.formatCentsToBRL = window.formatCentsToBRL || formatCentsToBRL;
  window.parseBRLToCents = window.parseBRLToCents || parseBRLToCents;
  window.formatCentsToNumber = window.formatCentsToNumber || formatCentsToNumber;

})();
