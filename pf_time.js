// PATCH: normalizeTimeForApi aceita apenas minutos 00/30 - 2025-12-23
(function () {
  'use strict';

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function normalizeHHMM(input) {
    if (input === null || input === undefined) return null;
    const s = String(input).trim();

    // aceita "7:30", "07:30", "7h30", "07h30"
    const m = s.match(/^([0-1]?\d|2[0-3])[:h]?([0-5]\d)$/i);
    if (!m) return null;

    const hh = pad2(m[1]);
    const mm = pad2(m[2]);
    return `${hh}:${mm}`;
  }

  function normalizeTimeForApi(input) {
    // Regra do projeto: apenas minutos 00 ou 30. Qualquer outro valor retorna null.
    const hhmm = normalizeHHMM(input);
    if (!hhmm) return null;
    const mm = Number(hhmm.split(':')[1]);
    if (mm !== 0 && mm !== 30) return null;
    return hhmm;
  }

  function isSameDayISO(aISO, bISO) {
    if (!aISO || !bISO) return false;
    return String(aISO).slice(0, 10) === String(bISO).slice(0, 10);
  }

  function toISODate(date) {
    const d = (date instanceof Date) ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return null;
    const yyyy = d.getFullYear();
    const mm = pad2(d.getMonth() + 1);
    const dd = pad2(d.getDate());
    return `${yyyy}-${mm}-${dd}`;
  }

  window.PF_TIME = Object.freeze({
    normalizeHHMM,
    normalizeTimeForApi,
    isSameDayISO,
    toISODate
  });
})();
