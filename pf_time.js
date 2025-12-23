/* PATCH: Expõe validarDiaHora/normalizeTimeForApi como globais para pf_healthcheck | 2025-12-23 */
(function () {
  'use strict';

  function pad2(n) { return String(n).padStart(2, '0'); }

  // Aceita HH:MM ou HH:MM:SS -> retorna HH:MM (minutos apenas 00/30)
  function normalizeHHMM(timeStr) {
    const s = String(timeStr ?? '').trim();
    if (!s) return '';
    const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (!m) return '';
    let hh = Number(m[1]);
    let mm = Number(m[2]);
    if (!isFinite(hh) || !isFinite(mm)) return '';
    if (hh < 0 || hh > 23) return '';
    // regra do projeto
    if (mm !== 0 && mm !== 30) return '';
    return `${pad2(hh)}:${pad2(mm)}`;
  }

  function hhmmToMinutes(hhmm) {
    const s = normalizeHHMM(hhmm);
    if (!s) return NaN;
    const [h, m] = s.split(':').map(Number);
    return h * 60 + m;
  }

  function minutesToHHMM(mins) {
    const n = Number(mins);
    if (!isFinite(n) || n < 0) return '';
    const h = Math.floor(n / 60) % 24;
    const m = n % 60;
    return `${pad2(h)}:${pad2(m)}`;
  }

  function clampToRange(mins, openHHMM, closeHHMM) {
    const openM = hhmmToMinutes(openHHMM);
    const closeM = hhmmToMinutes(closeHHMM);
    if (!isFinite(openM) || !isFinite(closeM)) return mins;
    return Math.max(openM, Math.min(closeM, mins));
  }

  function buildRangeForDate(dateISO, openHHMM, closeHHMM) {
    const openM = hhmmToMinutes(openHHMM);
    const closeM = hhmmToMinutes(closeHHMM);
    if (!isFinite(openM) || !isFinite(closeM)) return [];
    const res = [];
    for (let t = openM; t <= closeM; t += 30) res.push(minutesToHHMM(t));
    return res;
  }

  // Placeholder se você já tem regra por dia no admin; mantém compatibilidade
  function getMaxPerHalfHourForDate(_dateISO) {
    // se você já carrega “working hours” do backend, pluga aqui
    return null;
  }

  function validarDiaHora(dateISO, hhmm) {
    // regra mínima: hh:mm válido e minutos 00/30
    const h = normalizeHHMM(hhmm);
    if (!h) return false;
    if (!dateISO) return false;
    return true;
  }

  function normalizeTimeForApi(timeStr) {
    return normalizeHHMM(timeStr);
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
