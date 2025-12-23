/* PATCH: normalizeTimeForApi retorna null quando inválido (minutos != 00/30) | 2025-12-23 */
(function () {
  'use strict';

  function pad2(n) { return String(n).padStart(2, '0'); }

  // Aceita HH:MM ou HH:MM:SS -> retorna "HH:MM" (minutos apenas 00/30)
  // Se inválido: retorna null
  function normalizeHHMM(timeStr) {
    const s = String(timeStr ?? '').trim();
    if (!s) return null;

    const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (!m) return null;

    const hhN = Number(m[1]);
    const mmN = Number(m[2]);

    if (!Number.isFinite(hhN) || !Number.isFinite(mmN)) return null;
    if (hhN < 0 || hhN > 23) return null;

    // regra do projeto: apenas 00 ou 30
    if (!(mmN === 0 || mmN === 30)) return null;

    const hh = pad2(hhN);
    const mm = pad2(mmN);
    return `${hh}:${mm}`;
  }

  function hhmmToMinutes(hhmm) {
    const s = normalizeHHMM(hhmm);
    if (!s) return NaN;
    const [h, m] = s.split(':').map(Number);
    return h * 60 + m;
  }

  function minutesToHHMM(mins) {
    const n = Number(mins);
    if (!Number.isFinite(n) || n < 0) return null;
    const h = Math.floor(n / 60) % 24;
    const m = n % 60;

    // garante 00/30
    const mm = (m < 15) ? 0 : (m < 45) ? 30 : 0;
    return `${pad2(h)}:${pad2(mm)}`;
  }

  // clamp em minutos dentro de uma faixa (open/close em HH:MM)
  function clampToRange(timeStr, openHHMM, closeHHMM) {
    const t = normalizeHHMM(timeStr);
    if (!t) return null;

    const openM = hhmmToMinutes(openHHMM);
    const closeM = hhmmToMinutes(closeHHMM);
    if (!Number.isFinite(openM) || !Number.isFinite(closeM) || closeM < openM) return t;

    let cur = hhmmToMinutes(t);
    if (!Number.isFinite(cur)) return null;

    if (cur < openM) cur = openM;
    if (cur > closeM) cur = closeM;

    return minutesToHHMM(cur);
  }

  function buildRangeForDate(_dateISO, openHHMM, closeHHMM) {
    const openM = hhmmToMinutes(openHHMM);
    const closeM = hhmmToMinutes(closeHHMM);
    if (!Number.isFinite(openM) || !Number.isFinite(closeM) || closeM < openM) return [];
    const res = [];
    for (let t = openM; t <= closeM; t += 30) res.push(minutesToHHMM(t));
    return res.filter(Boolean);
  }

  // Placeholder (se você usa capacidade por dia no admin, pluga aqui)
  function getMaxPerHalfHourForDate(_dateISO) {
    return null;
  }

  // Validação mínima (mantém compat): retorna true/false
  function validarDiaHora(dateISO, timeStr) {
    if (!dateISO) return false;
    const t = normalizeHHMM(timeStr);
    return !!t;
  }

  // Normalização que o backend espera (null quando inválido)
  function normalizeTimeForApi(timeStr) {
    return normalizeHHMM(timeStr); // já devolve null quando inválido
  }

  window.PF_TIME = {
    pad2,
    normalizeHHMM,
    hhmmToMinutes,
    minutesToHHMM,
    clampToRange,
    buildRangeForDate,
    getMaxPerHalfHourForDate,
    validarDiaHora,
    normalizeTimeForApi
  };

  // Aliases globais (o healthcheck usa isso)
  window.validarDiaHora = window.validarDiaHora || validarDiaHora;
  window.normalizeTimeForApi = window.normalizeTimeForApi || normalizeTimeForApi;
  window.buildRangeForDate = window.buildRangeForDate || buildRangeForDate;
})();
