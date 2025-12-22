/* PATCH: Módulo de tempo/horários (PF_TIME) — 2025-12-22 */

(function () {
  'use strict';

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function normalizeHHMM(value) {
    if (value === undefined || value === null) return '';
    const s = String(value).trim();
    const m = s.match(/^([01]?\d|2[0-3]):?([0-5]\d)$/);
    if (!m) return '';
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    return `${pad2(hh)}:${pad2(mm)}`;
  }

  function hhmmToMinutes(hhmm) {
    const n = normalizeHHMM(hhmm);
    if (!n) return NaN;
    const [h, m] = n.split(':').map(Number);
    return (h * 60) + m;
  }

  function minutesToHHMM(totalMinutes) {
    if (!Number.isFinite(totalMinutes)) return '';
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    if (h < 0 || h > 23) return '';
    if (m < 0 || m > 59) return '';
    return `${pad2(h)}:${pad2(m)}`;
  }

  function isHalfHour(hhmm) {
    const n = normalizeHHMM(hhmm);
    if (!n) return false;
    const mm = Number(n.split(':')[1]);
    return mm === 0 || mm === 30;
  }

  function clampToRange(hhmm, openHHMM, closeHHMM) {
    const t = hhmmToMinutes(hhmm);
    const o = hhmmToMinutes(openHHMM);
    const c = hhmmToMinutes(closeHHMM);
    if (![t, o, c].every(Number.isFinite)) return '';
    const clamped = Math.min(Math.max(t, o), c);
    return minutesToHHMM(clamped);
  }

  window.PF_TIME = {
    normalizeHHMM,
    hhmmToMinutes,
    minutesToHHMM,
    isHalfHour,
    clampToRange
  };
})();
