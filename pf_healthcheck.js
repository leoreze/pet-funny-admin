/* PATCH: Anti-regressão (smoke tests + ping API) — 2025-12-23 */
(function () {
  'use strict';

  // Evita colisão
  if (window.PF_HEALTHCHECK) return;

  const $ = (id) => document.getElementById(id);

  function ok(name, detail) {
    return { name, pass: true, detail: detail || '' };
  }
  function fail(name, detail) {
    return { name, pass: false, detail: detail || '' };
  }

  function existsGlobal(path) {
    // path tipo "PF_API.get" ou "formatCentsToBRL"
    const parts = String(path).split('.');
    let cur = window;
    for (const p of parts) {
      if (!cur || !(p in cur)) return false;
      cur = cur[p];
    }
    return true;
  }

  function safeGetGlobal(path) {
    const parts = String(path).split('.');
    let cur = window;
    for (const p of parts) {
      if (!cur || !(p in cur)) return undefined;
      cur = cur[p];
    }
    return cur;
  }

  function requiredDomIds() {
    // Liste APENAS o essencial (para não dar falso alarme se uma aba não estiver no layout)
    return [
      'loginScreen',
      'adminApp',
      'btnLogin',
      'btnLogout',

      // Agenda (mínimo)
      'tab-agenda',
      'tbodyAgenda',
      'estadoVazio',
      'btnNovoAgendamento',
      'formPanel',
      'formPhone',
      'formNome',
      'formDate',
      'formTime',
      'formService',
      'formStatus',
      'btnSalvar',
    ];
  }

  function requiredGlobals() {
    // O que mais costuma quebrar quando modulariza:
    return [
      // Helpers básicos
      'normStr',
      'formatTelefone',
      'formatDataBr',
      'formatDateTimeBr',

      // Dinheiro / cents
      'formatCentsToBRL',
      'applyCurrencyMask',
      'getCentsFromCurrencyInput',

      // Horário
      'normalizeTimeForApi',
      'validarDiaHora',

      // API layer (fase 4)
      'PF_API.get',
      'PF_API.post',
      'PF_API.put',
      'PF_API.del',
    ];
  }

  function smokeTest() {
    const results = [];

    // 1) DOM mínimo
    for (const id of requiredDomIds()) {
      if ($(id)) results.push(ok(`DOM: #${id}`));
      else results.push(fail(`DOM: #${id}`, 'Elemento não encontrado (id removido ou mudou).'));
    }

    // 2) Globais mínimos
    for (const g of requiredGlobals()) {
      if (existsGlobal(g)) results.push(ok(`GLOBAL: ${g}`));
      else results.push(fail(`GLOBAL: ${g}`, 'Não definido (ordem de scripts, rename, ou export não feito).'));
    }

    // 3) Teste rápido de execução de helpers (pega erros “existe mas quebra”)
    try {
      const f = safeGetGlobal('formatCentsToBRL');
      if (typeof f === 'function') {
        const v = f(12345);
        results.push(ok('EXEC: formatCentsToBRL(12345)', String(v)));
      } else {
        results.push(fail('EXEC: formatCentsToBRL(12345)', 'Não é função.'));
      }
    } catch (e) {
      results.push(fail('EXEC: formatCentsToBRL(12345)', e && e.message ? e.message : String(e)));
    }

    try {
      const nt = safeGetGlobal('normalizeTimeForApi');
      if (typeof nt === 'function') {
        const a = nt('7:30');
        const b = nt('07:31');
        results.push(ok('EXEC: normalizeTimeForApi("7:30")', `=> ${a}`));
        if (b === null) results.push(ok('EXEC: normalizeTimeForApi("07:31")', '=> null (ok)'));
        else results.push(fail('EXEC: normalizeTimeForApi("07:31")', `Esperado null; veio ${b}`));
      } else {
        results.push(fail('EXEC: normalizeTimeForApi', 'Não é função.'));
      }
    } catch (e) {
      results.push(fail('EXEC: normalizeTimeForApi', e && e.message ? e.message : String(e)));
    }

    return results;
  }

  async function apiPing() {
    const results = [];
    const api = safeGetGlobal('PF_API');

    if (!api || typeof api.get !== 'function') {
      return [fail('API: PF_API.get', 'PF_API não disponível; não dá pra pingar.')];
    }

    // Endpoints leves (ajuste conforme seu server atual)
    const endpoints = [
      ['/api/services', 'services'],
      ['/api/customers', 'customers'],
      ['/api/bookings', 'bookings'],
      ['/api/opening-hours', 'opening_hours'],
    ];

    for (const [path, key] of endpoints) {
      try {
        const data = await api.get(path);
        const size = data && data[key] && Array.isArray(data[key]) ? data[key].length : 'ok';
        results.push(ok(`API GET ${path}`, `retorno: ${key}=${size}`));
      } catch (e) {
        results.push(fail(`API GET ${path}`, (e && e.message) ? e.message : String(e)));
      }
    }

    return results;
  }

  function renderPanel(rows, container) {
    const total = rows.length;
    const fails = rows.filter(r => !r.pass).length;
    const passes = total - fails;

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';
    header.style.gap = '12px';
    header.style.padding = '10px 12px';
    header.style.border = '1px solid rgba(255,255,255,.08)';
    header.style.borderRadius = '12px';
    header.style.marginBottom = '10px';

    const title = document.createElement('div');
    title.innerHTML = `<strong>Anti-Regressão</strong><div style="opacity:.8;font-size:12px;margin-top:2px;">PASS: ${passes} | FAIL: ${fails} | TOTAL: ${total}</div>`;

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '8px';

    const btnCopy = document.createElement('button');
    btnCopy.type = 'button';
    btnCopy.className = 'btn btn-small btn-secondary';
    btnCopy.textContent = 'Copiar relatório';
    btnCopy.addEventListener('click', async () => {
      const text = rows.map(r => `${r.pass ? 'PASS' : 'FAIL'} - ${r.name}${r.detail ? ' | ' + r.detail : ''}`).join('\n');
      try {
        await navigator.clipboard.writeText(text);
        btnCopy.textContent = 'Copiado';
        setTimeout(() => (btnCopy.textContent = 'Copiar relatório'), 900);
      } catch (_) {
        alert('Não foi possível copiar. Veja o console.');
        console.log(text);
      }
    });

    actions.appendChild(btnCopy);
    header.appendChild(title);
    header.appendChild(actions);

    const list = document.createElement('div');
    list.style.display = 'grid';
    list.style.gap = '6px';

    rows.forEach(r => {
      const item = document.createElement('div');
      item.style.padding = '8px 10px';
      item.style.borderRadius = '10px';
      item.style.border = '1px solid rgba(255,255,255,.08)';
      item.style.background = r.pass ? 'rgba(46,204,113,.08)' : 'rgba(231,76,60,.10)';
      item.style.fontSize = '13px';
      item.innerHTML = `<strong>${r.pass ? 'PASS' : 'FAIL'}</strong> — ${escapeHtml(r.name)}${r.detail ? `<div style="opacity:.85;margin-top:2px;">${escapeHtml(r.detail)}</div>` : ''}`;
      list.appendChild(item);
    });

    container.innerHTML = '';
    container.appendChild(header);
    container.appendChild(list);
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function ensureUI() {
    // Painel discreto no topo do adminApp (não mexe no layout principal)
    const app = $('adminApp');
    if (!app) return null;

    let wrap = $('pfHealthWrap');
    if (wrap) return wrap;

    wrap = document.createElement('div');
    wrap.id = 'pfHealthWrap';
    wrap.style.margin = '12px 0';
    wrap.style.padding = '0 12px';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-small btn-secondary';
    btn.textContent = 'Rodar testes (anti-regressão)';
    btn.style.marginBottom = '10px';

    const panel = document.createElement('div');
    panel.id = 'pfHealthPanel';

    wrap.appendChild(btn);
    wrap.appendChild(panel);

    // Inserir no topo do app (primeiro filho)
    app.insertBefore(wrap, app.firstChild);

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Rodando...';
      try {
        const rows1 = smokeTest();
        const rows2 = await apiPing();
        const all = rows1.concat(rows2);
        renderPanel(all, panel);

        // Também loga no console (útil no Render)
        console.group('PF Anti-Regressão');
        all.forEach(r => console[r.pass ? 'log' : 'error'](`${r.pass ? 'PASS' : 'FAIL'} - ${r.name}`, r.detail || ''));
        console.groupEnd();
      } finally {
        btn.disabled = false;
        btn.textContent = 'Rodar testes (anti-regressão)';
      }
    });

    return wrap;
  }

  // Expor
  window.PF_HEALTHCHECK = {
    smokeTest,
    apiPing,
    ensureUI,
  };

  // Inicializa UI quando o DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureUI);
  } else {
    ensureUI();
  }
})();
