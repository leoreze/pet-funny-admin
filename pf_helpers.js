/* PATCH: Corrige export duplicado fora do escopo (formatCentsToBRL) + expõe parseBRLToCents global | 2025-12-23 */
(function () {
  'use strict';

  function $(sel, root = document) { return root.querySelector(sel); }
  function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  // Normaliza strings (busca/filtro)
  function normStr(s) {
    return String(s ?? '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().trim();
  }

  // Currency helpers (BRL)
  function parseBRLToCents(str) {
    const s = String(str ?? '')
      .replace(/[^\d,.-]/g, '')
      .replace(/\./g, '')
      .replace(',', '.');
    const n = Number(s);
    if (!isFinite(n)) return 0;
    return Math.round(n * 100);
  }

  function formatCentsToBRL(cents) {
    const v = Number(cents ?? 0) / 100;
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function applyCurrencyMask(inputEl) {
    if (!inputEl) return;
    inputEl.addEventListener('input', () => {
      const cents = parseBRLToCents(inputEl.value);
      inputEl.value = (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    });
  }

  // Phone
  function formatPhoneBR(value) {
    const digits = String(value ?? '').replace(/\D/g, '').slice(0, 11);
    if (digits.length <= 10) {
      // (99) 9999-9999
      return digits
        .replace(/^(\d{2})(\d)/, '($1) $2')
        .replace(/(\d{4})(\d)/, '$1-$2');
    }
    // (99) 99999-9999
    return digits
      .replace(/^(\d{2})(\d)/, '($1) $2')
      .replace(/(\d{5})(\d)/, '$1-$2');
  }

  function attachPhoneMask(inputEl) {
    if (!inputEl) return;
    inputEl.addEventListener('input', () => {
      inputEl.value = formatPhoneBR(inputEl.value);
    });
  }

  // Small UI helpers
  function toast(msg, type = 'info') {
    // fallback simples: usa alert se não tiver seu sistema de toast
    try {
      if (window.showToast) return window.showToast(msg, type);
    } catch {}
    console.log(`[${type}] ${msg}`);
  }

  // Export “namespaced” + compat global (sem duplicar fora do escopo)
  window.PF_HELPERS = {
    $, $all,
    normStr,
    parseBRLToCents,
    formatCentsToBRL,
    applyCurrencyMask,
    formatPhoneBR,
    attachPhoneMask,
    toast
  };

  // Compatibilidade com o legado (scripts.js chamando funções globais)
  window.normStr = window.normStr || normStr;
  window.parseBRLToCents = window.parseBRLToCents || parseBRLToCents;
  window.formatCentsToBRL = window.formatCentsToBRL || formatCentsToBRL;
})();
