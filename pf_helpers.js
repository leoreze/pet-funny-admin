/* PATCH: corrige exports globais (remove referência fora do escopo) | 2025-12-23 */
/*
  pf_helpers.js
  Objetivo: centralizar helpers reutilizáveis (string, tempo, formatação, etc).

  Regras:
  - Não alterar comportamento existente do sistema.
  - Expor apenas o necessário em window e/ou window.PF_HELPERS.
*/

(() => {
  'use strict';

  // =========================
  // BASIC HELPERS
  // =========================

  function clampInt(n, min, max) {
    n = Number.parseInt(n, 10);
    if (Number.isNaN(n)) return min;
    return Math.min(Math.max(n, min), max);
  }

  function safeTrim(v) {
    return (v ?? '').toString().trim();
  }

  function onlyDigits(v) {
    return safeTrim(v).replace(/\D+/g, '');
  }

  function toBool(v) {
    if (typeof v === 'boolean') return v;
    const s = safeTrim(v).toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 'sim';
  }

  // =========================
  // MONEY (CENTS / BRL)
  // =========================

  function parseBRLToCents(input) {
    // Aceita "1.234,56" / "1234,56" / "1234.56" / "123456"
    const raw = safeTrim(input);
    if (!raw) return 0;

    // Mantém dígitos e separadores
    const cleaned = raw.replace(/[^\d.,-]/g, '');
    if (!cleaned) return 0;

    // Se tem vírgula e ponto, assume ponto milhar e vírgula decimal
    let normalized = cleaned;
    const hasComma = normalized.includes(',');
    const hasDot = normalized.includes('.');

    if (hasComma && hasDot) {
      // remove pontos de milhar e troca vírgula por ponto
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else if (hasComma && !hasDot) {
      normalized = normalized.replace(',', '.');
    }

    const num = Number.parseFloat(normalized);
    if (Number.isNaN(num)) return 0;
    return Math.round(num * 100);
  }

  function formatCentsToBRL(cents) {
    const n = Number(cents);
    const value = Number.isFinite(n) ? n / 100 : 0;
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  // =========================
  // PHONE (BR)
  // =========================

  function formatTelefone(v) {
    const d = onlyDigits(v);
    if (d.length <= 10) {
      // (11) 9999-9999
      return d.replace(/^(\d{2})(\d{4})(\d{0,4}).*/, '($1) $2-$3').trim().replace(/-$/, '');
    }
    // (11) 99999-9999
    return d.replace(/^(\d{2})(\d{5})(\d{0,4}).*/, '($1) $2-$3').trim().replace(/-$/, '');
  }

  // =========================
  // DATE/TIME (pt-BR)
  // =========================

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function formatDateBr(isoOrDate) {
    const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
    if (Number.isNaN(d.getTime())) return '';
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
  }

  function formatTimeBr(isoOrDate) {
    const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
    if (Number.isNaN(d.getTime())) return '';
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function formatDateTimeBr(isoOrDate) {
    const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
    if (Number.isNaN(d.getTime())) return '';
    return `${formatDateBr(d)} ${formatTimeBr(d)}`;
  }

  // =========================
  // TIME NORMALIZATION (Admin/Cliente)
  // =========================
  // Regra do projeto: minutos aceitos somente 00 ou 30.
  // Retorna "HH:MM" se válido, senão null.
  function normalizeTimeForApi(hhmm) {
    const s = safeTrim(hhmm);
    const m = /^(\d{2}):(\d{2})$/.exec(s);
    if (!m) return null;

    const hh = Number(m[1]);
    const mm = Number(m[2]);

    if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
    if (hh < 0 || hh > 23) return null;
    if (!(mm === 0 || mm === 30)) return null;

    return `${pad2(hh)}:${pad2(mm)}`;
  }

  // =========================
  // PUBLIC EXPORTS
  // =========================

  window.PF_HELPERS = Object.assign({}, window.PF_HELPERS || {}, {
    clampInt,
    safeTrim,
    onlyDigits,
    toBool,
    parseBRLToCents,
    formatCentsToBRL,
    formatTelefone,
    formatDateBr,
    formatTimeBr,
    formatDateTimeBr,
    normalizeTimeForApi,
  });

  // Exposição global (compat com legado e healthcheck)
  // Importante: não usar "||" aqui para não ficar preso em uma versão errada.
  window.normalizeTimeForApi = normalizeTimeForApi;

    // =========================
  // CURRENCY MASK (GLOBAL WRAPPERS)
  // =========================
  // O sistema já tinha applyCurrencyMask/getCentsFromCurrencyInput no scripts.js.
  // Para evitar regressão e passar no healthcheck, expomos wrappers globais aqui.
  // Se o scripts.js já definir, respeitamos o existente.

  function applyCurrencyMask(input) {
    if (!input) return;

    let raw = String(input.value || '').replace(/\D/g, '');

    // Se usuário apagou tudo
    if (raw === '') {
      input.value = '';
      if (input.dataset) input.dataset.cents = '';
      return;
    }

    raw = raw.replace(/^0+/, '');
    if (raw === '') raw = '0';

    if (input.dataset) input.dataset.cents = raw;

    // raw está em centavos
    input.value = formatCentsToBRL(Number(raw));
  }

  function getCentsFromCurrencyInput(input) {
    if (!input) return null;

    // 1) dataset (máscara)
    const ds = String(input.dataset?.cents || '').replace(/\D/g, '');
    if (ds) {
      const cents = parseInt(ds, 10);
      return Number.isFinite(cents) ? cents : null;
    }

    // 2) fallback: parsear texto
    const txt = String(input.value || '').trim();
    if (!txt) return null;

    const cleaned = txt.replace(/\s/g, '').replace(/[R$r$]/g, '');

    // com vírgula: decimal
    if (cleaned.includes(',')) {
      const n = Number(cleaned.replace(/\./g, '').replace(',', '.'));
      if (!Number.isFinite(n)) return null;
      return Math.round(n * 100);
    }

    // sem vírgula: reais inteiros
    const only = cleaned.replace(/\D/g, '');
    if (!only) return null;
    return parseInt(only, 10) * 100;
  }

  window.applyCurrencyMask = window.applyCurrencyMask || applyCurrencyMask;
  window.getCentsFromCurrencyInput = window.getCentsFromCurrencyInput || getCentsFromCurrencyInput;

  // também no namespace PF_HELPERS
  window.PF_HELPERS = Object.assign({}, window.PF_HELPERS || {}, {
    applyCurrencyMask,
    getCentsFromCurrencyInput,
  });


  // Mantém aliases legados se o sistema já usa direto no window (sem quebrar)
  window.formatCentsToBRL = window.formatCentsToBRL || formatCentsToBRL;
  window.parseBRLToCents = window.parseBRLToCents || parseBRLToCents;
  window.formatDateTimeBr = window.formatDateTimeBr || formatDateTimeBr;
  window.formatTelefone = window.formatTelefone || formatTelefone;

})();
