/* PATCH: FASE 3 — Time/Date helpers (módulo) — 2025-12-22
   Objetivo: centralizar helpers de horário/data sem alterar comportamento do sistema.
*/
(function(){
  'use strict';

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  // Normaliza para "HH:MM" (mantém apenas 00/30 quando aplicável)
  function normalizeHHMM(t) {
    if (!t) return '';
    const raw = String(t).trim();
    const m = raw.match(/^(\d{1,2}):?(\d{2})$/);
    if (!m) return raw;
    let hh = Math.max(0, Math.min(23, parseInt(m[1], 10)));
    let mm = Math.max(0, Math.min(59, parseInt(m[2], 10)));
    // Regra do projeto: somente 00 ou 30
    if (mm !== 0 && mm !== 30) mm = (mm < 30) ? 0 : 30;
    return `${pad2(hh)}:${pad2(mm)}`;
  }

  function hhmmToMinutes(hhmm) {
    const norm = normalizeHHMM(hhmm);
    const m = norm.match(/^(\d{2}):(\d{2})$/);
    if (!m) return 0;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  function minutesToHHMM(m) {
    const mm = Math.max(0, Math.min(24 * 60 - 1, Number(m) || 0));
    const hh = Math.floor(mm / 60);
    const min = mm % 60;
    return `${pad2(hh)}:${pad2(min)}`;
  }

  function clampToRange(timeStr, range) {
    const t = hhmmToMinutes(timeStr);
    const min = hhmmToMinutes(range?.min ?? '07:30');
    const max = hhmmToMinutes(range?.max ?? '17:30');
    if (t < min) return minutesToHHMM(min);
    if (t > max) return minutesToHHMM(max);
    return normalizeHHMM(timeStr);
  }

  // Retorna faixa de horário por data, considerando cache de horário de funcionamento.
  // cache esperado: { [dateStr]: { open:'HH:MM', close:'HH:MM', closed:boolean, max_per_slot:number } } OU
  //                 { byWeekday: { 0..6: { open, close, closed, max_per_slot } } }
  function buildRangeForDate(dateStr, openingHoursCache) {
    const fallback = { min: '07:30', max: '17:30', closed: false };

    try {
      if (!openingHoursCache) return fallback;

      // 1) cache por data (prioritário)
      const perDate = openingHoursCache?.[dateStr];
      if (perDate) {
        const closed = !!perDate.closed;
        const min = normalizeHHMM(perDate.open || perDate.opening || fallback.min);
        const max = normalizeHHMM(perDate.close || perDate.closing || fallback.max);
        return { min, max, closed };
      }

      // 2) cache por weekday (0=domingo..6=sábado)
      const d = new Date(dateStr + 'T00:00:00');
      const wd = d.getDay();
      const byWd = openingHoursCache?.byWeekday?.[wd];
      if (byWd) {
        const closed = !!byWd.closed;
        const min = normalizeHHMM(byWd.open || byWd.opening || fallback.min);
        const max = normalizeHHMM(byWd.close || byWd.closing || fallback.max);
        return { min, max, closed };
      }

      return fallback;
    } catch (_e) {
      return fallback;
    }
  }

  function getMaxPerHalfHourForDate(dateStr, openingHoursCache) {
    try {
      if (!openingHoursCache) return 0;

      const perDate = openingHoursCache?.[dateStr];
      if (perDate && perDate.max_per_slot != null) return Number(perDate.max_per_slot) || 0;

      const d = new Date(dateStr + 'T00:00:00');
      const wd = d.getDay();
      const byWd = openingHoursCache?.byWeekday?.[wd];
      if (byWd && byWd.max_per_slot != null) return Number(byWd.max_per_slot) || 0;

      return 0;
    } catch (_e) {
      return 0;
    }
  }

  // Mantém a lógica atual de validação (fallback): 07:30–17:30, e somente 00/30
  function validarDiaHora(_dateStr, timeStr) {
    try {
      const t = normalizeHHMM(timeStr);
      if (!t) return false;

      const m = t.match(/^(\d{2}):(\d{2})$/);
      if (!m) return false;
      const hh = parseInt(m[1], 10);
      const mm = parseInt(m[2], 10);

      if (!(mm === 0 || mm === 30)) return false;

      const total = hh * 60 + mm;
      const min = 7 * 60 + 30;
      const max = 17 * 60 + 30;
      if (total < min || total > max) return false;

      return true;
    } catch (_e) {
      return false;
    }
  }

  // Normaliza para API: HH:MM (sem segundos) e com minutos somente 00/30
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
})();
