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

  
// PATCH: helpers compat export + escapeHtml/centsToBRL - 2025-12-22
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function centsToBRL(cents) {
  return formatCentsToBRL(cents);
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

  // Compat globals (legacy code expects these)
  window.formatCentsToBRL = formatCentsToBRL;
  window.centsToBRL = centsToBRL;
  window.escapeHtml = escapeHtml;


  // Expor também como globais "de compatibilidade" (não sobrescreve se já existir)
  window.normStr = window.normStr || normStr;
  window.normalizeHHMM = window.normalizeHHMM || normalizeHHMM;
  window.hhmmToMinutes = window.hhmmToMinutes || hhmmToMinutes;
  window.minutesToHHMM = window.minutesToHHMM || minutesToHHMM;
  window.normalizeTimeForApi = window.normalizeTimeForApi || normalizeTimeForApi;
  window.toISODateOnly = window.toISODateOnly || toISODateOnly;
  window.formatDataBr = window.formatDataBr || formatDataBr;
  window.formatDateTimeBr = window.formatDateTimeBr || formatDateTimeBr;
  window.sanitizePhone = window.sanitizePhone || sanitizePhone;
  window.formatTelefone = window.formatTelefone || formatTelefone;

})();

// ===============================
// PATCH: Exposição global helpers
// DATE: 2025-12-23
// ===============================

window.formatCentsToBRL = window.formatCentsToBRL || formatCentsToBRL;
window.parseBRLToCents  = window.parseBRLToCents  || parseBRLToCents;

// Se já existirem no helpers, só expor (não redefinir)
window.formatTelefone  = window.formatTelefone  || formatTelefone;
window.formatDataBr    = window.formatDataBr    || formatDataBr;
window.formatDateTimeBr = window.formatDateTimeBr || formatDateTimeBr;
