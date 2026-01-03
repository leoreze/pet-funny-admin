/* =========================================================
   MIMOS (Admin) - CRUD + Emojis + Valor (cents) + Período
   Boot seguro para carregamento dinâmico via /admin/js/bootstrap.js
========================================================= */
(function () {
  'use strict';

  // Evita dupla inicialização (ex.: injeção repetida pelo bootstrap)
  if (window.__PF_MIMOS_INITED) return;
  window.__PF_MIMOS_INITED = true;

  function boot() {
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      const ok = initMimosModule();
      if (ok || tries >= 30) clearInterval(timer); // ~3s máx
    }, 100);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  function initMimosModule() {
    const $ = (id) => document.getElementById(id);

    const els = {
      btnNovo: $('btnNovoMimo'),
      reload: $('btnMimosReload'),
      search: $('mimosSearch'),
      btnClearSearch: $('btnMimosClearSearch') || $('btnLimparBuscaMimos'),
      formWrap: $('mimoFormWrap'),
      btnCloseForm: $('btnFecharMimoForm'),

      title: $('mimoTitle'),
      desc: $('mimoDesc'),
      emojiPanel: $('emojiPanel'),
      value: $('mimoValue'),
      active: $('mimoActive'),
      start: $('mimoStart'),
      end: $('mimoEnd'),

      save: $('btnMimoSave'),
      clear: $('btnMimoClear'),

      tbody: $('tbodyMimos'),
      msg: $('mimoMsg'),
    };

    // Elementos mínimos para funcionar
    if (!els.btnNovo || !els.formWrap || !els.tbody) return false;

    // Não rebinda listeners se init rodar novamente
    if (els.btnNovo.__pfMimosBound) return true;
    els.btnNovo.__pfMimosBound = true;

    // Estado
    let currentEditId = null;
    window.cacheMimos = Array.isArray(window.cacheMimos) ? window.cacheMimos : [];
    let cacheMimos = window.cacheMimos;

    
    // Flag interno de abertura do formulário (não depende de computedStyle)
    let formOpen = (els.formWrap.style.display !== 'none');
// ---------- Helpers ----------
    function setMsg(text, isError) {
      if (!els.msg) return;
      els.msg.textContent = text || '';
      els.msg.style.color = isError ? '#c0392b' : '';
    }

    function pad2(n) { return String(n).padStart(2, '0'); }

    function toDatetimeLocalValue(isoOrTs) {
      if (!isoOrTs) return '';
      const d = new Date(isoOrTs);
      if (isNaN(d.getTime())) return '';
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    }

    function fromDatetimeLocalValue(v) {
      if (!v) return null;
      const d = new Date(v);
      if (isNaN(d.getTime())) return null;
      return d.toISOString();
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

    function formatCentsToBRL(cents) {
      const v = Number(cents || 0) / 100;
      return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function moneyMaskAttach(inputEl) {
      if (!inputEl) return;
      inputEl.addEventListener('blur', () => {
        const cents = parseBRLToCents(inputEl.value);
        inputEl.value = formatCentsToBRL(cents);
      });
    }

    const EMOJI_LIST = [
      '🎁','🎉','✨','⭐','💎','🏆','🥇','🎯','🔥','✅','🧡','💛','💚','💙','💜',
      '🐶','🐾','🛁','✂️','🧴','🧼','🫧','🦴','🍖','💸','🎟️','📣','📅','🔔','🎡','🎲'
    ];

    function insertAtCursor(textarea, text) {
      if (!textarea) return;
      const start = textarea.selectionStart ?? textarea.value.length;
      const end = textarea.selectionEnd ?? textarea.value.length;
      const before = textarea.value.slice(0, start);
      const after = textarea.value.slice(end);
      textarea.value = before + text + after;
      const newPos = start + text.length;
      textarea.selectionStart = textarea.selectionEnd = newPos;
      textarea.focus();
    }

    function buildEmojiPanel() {
      if (!els.emojiPanel || !els.desc) return;
      els.emojiPanel.innerHTML = '';
      EMOJI_LIST.forEach((em) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-small';
        b.textContent = em;
        b.style.padding = '6px 8px';
        b.style.lineHeight = '1';
        b.addEventListener('click', () => insertAtCursor(els.desc, em));
        els.emojiPanel.appendChild(b);
      });
    }

    // ---------- UI state ----------
    function isFormOpen() {
      return formOpen;
    }

    function setNovoButton(open) {
      els.btnNovo.textContent = open ? '✖ FECHAR' : '+ NOVO MIMO';
    }

    function openForm() {
      els.formWrap.style.display = 'block';
      formOpen = true;
      setNovoButton(true);
    }

    function closeForm() {
      els.formWrap.style.display = 'none';
      formOpen = false;
      setNovoButton(false);
      currentEditId = null;
    }

    function clearForm() {
      currentEditId = null;
      if (els.title) els.title.value = '';
      if (els.desc) els.desc.value = '';
      if (els.value) els.value.value = formatCentsToBRL(0);
      if (els.active) els.active.checked = true;
      if (els.start) els.start.value = '';
      if (els.end) els.end.value = '';
      setMsg('', false);
    }

    // ---------- API ----------
    async function apiGetMimos() {
      const r = await fetch('/api/mimos', { method: 'GET' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Erro ao buscar mimos.');
      return data.mimos || [];
    }

    async function apiCreateMimo(payload) {
      const r = await fetch('/api/mimos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Erro ao criar mimo.');
      return data.mimo;
    }

    async function apiUpdateMimo(id, payload) {
      const r = await fetch(`/api/mimos/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Erro ao atualizar mimo.');
      return data.mimo;
    }

    async function apiDeleteMimo(id) {
      const r = await fetch(`/api/mimos/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Erro ao excluir mimo.');
      return true;
    }

    function syncPrizeSelect(mimos) {
      const prizeSelect = document.getElementById('formPrize');
      if (!prizeSelect) return;

      const current = prizeSelect.value;
      prizeSelect.innerHTML = '';

      const opt0 = document.createElement('option');
      opt0.value = '';
      opt0.textContent = '— Sem mimo —';
      prizeSelect.appendChild(opt0);

      (mimos || []).filter(m => m.is_active).forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m.title; // mantém compatibilidade (texto)
        opt.textContent = `${m.title} (R$ ${formatCentsToBRL(m.value_cents || 0)})`;
        prizeSelect.appendChild(opt);
      });

      if (current) prizeSelect.value = current;
    }

    // ---------- Render ----------
    function renderMimosTable(mimos) {
      els.tbody.innerHTML = '';

      const q = (els.search?.value || '').trim().toLowerCase();
      const filtered = !q ? (mimos || []) : (mimos || []).filter(m =>
        String(m.title || '').toLowerCase().includes(q) ||
        String(m.description || '').toLowerCase().includes(q)
      );

      function formatDateTimeBrLocal(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        const dia = String(d.getDate()).padStart(2, '0');
        const mes = String(d.getMonth() + 1).padStart(2, '0');
        const ano = d.getFullYear();
        const hora = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        return `${dia}/${mes}/${ano} ${hora}:${min}`;
      }

      function formatPeriodo(m) {
        const s = formatDateTimeBrLocal(m?.starts_at);
        const e = formatDateTimeBrLocal(m?.ends_at);
        if (s && e) return `${s} → ${e}`;
        if (s && !e) return `A partir de ${s}`;
        if (!s && e) return `Até ${e}`;
        return '-';
      }

      if (!filtered.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 5;
        td.textContent = 'Nenhum mimo cadastrado.';
        td.style.opacity = '0.75';
        tr.appendChild(td);
        els.tbody.appendChild(tr);
        return;
      }

      filtered.forEach((m) => {
        const tr = document.createElement('tr');

        const tdTitle = document.createElement('td');
        tdTitle.textContent = m.title || '';
        tr.appendChild(tdTitle);

        const tdValue = document.createElement('td');
        tdValue.textContent = `R$ ${formatCentsToBRL(m.value_cents || 0)}`;
        tr.appendChild(tdValue);

        const tdPeriod = document.createElement('td');
        tdPeriod.textContent = formatPeriodo(m);
        tr.appendChild(tdPeriod);

        const tdActive = document.createElement('td');
        tdActive.textContent = m.is_active ? 'Sim' : 'Não';
        tr.appendChild(tdActive);

        const tdActions = document.createElement('td');

        const btnEdit = document.createElement('button');
        btnEdit.type = 'button';
        btnEdit.className = 'btn';
        btnEdit.textContent = 'Editar';
        btnEdit.addEventListener('click', () => {
          currentEditId = m.id;
          if (els.title) els.title.value = m.title || '';
          if (els.desc) els.desc.value = m.description || '';
          if (els.value) els.value.value = formatCentsToBRL(m.value_cents || 0);
          if (els.start) els.start.value = toDatetimeLocalValue(m.starts_at);
          if (els.end) els.end.value = toDatetimeLocalValue(m.ends_at);
          if (els.active) els.active.checked = !!m.is_active;
          openForm();
          els.title?.focus();
        });

        const btnDel = document.createElement('button');
        btnDel.type = 'button';
        btnDel.className = 'btn btn-danger';
        btnDel.textContent = 'Excluir';
        btnDel.style.marginLeft = '6px';
        btnDel.addEventListener('click', async () => {
          const ok = confirm(`Excluir o mimo "${m.title}"?`);
          if (!ok) return;
          try {
            setMsg('Excluindo...', false);
            await apiDeleteMimo(m.id);
            await reloadMimos();
            setMsg('Mimo excluído.', false);
          } catch (err) {
            setMsg(err.message || 'Erro ao excluir.', true);
          }
        });

        tdActions.appendChild(btnEdit);
        tdActions.appendChild(btnDel);
        tr.appendChild(tdActions);

        els.tbody.appendChild(tr);
      });
    }

    async function reloadMimos() {
      try {
        setMsg('Carregando...', false);
        const mimos = await apiGetMimos();
        cacheMimos = mimos;
        window.cacheMimos = cacheMimos;
        renderMimosTable(mimos);
        syncPrizeSelect(mimos);
        setMsg('', false);
      } catch (e) {
        renderMimosTable([]);
        setMsg(e.message || 'Erro ao carregar mimos.', true);
      }
    }

    async function handleSave() {
      try {
        setMsg('Salvando...', false);

        const title = (els.title?.value || '').trim();
        const description = (els.desc?.value || '').trim();
        const value_cents = parseBRLToCents(els.value?.value || '0');
        const starts_at = fromDatetimeLocalValue(els.start?.value || '');
        const ends_at = fromDatetimeLocalValue(els.end?.value || '');
        const is_active = !!els.active?.checked;

        if (!title) {
          setMsg('Informe o título.', true);
          els.title?.focus();
          return;
        }
        if (ends_at && starts_at && new Date(ends_at) < new Date(starts_at)) {
          setMsg('A data de término não pode ser menor que a data de início.', true);
          return;
        }

        const payload = { title, description, value_cents, starts_at, ends_at, is_active };

        if (currentEditId) await apiUpdateMimo(currentEditId, payload);
        else await apiCreateMimo(payload);

        await reloadMimos();
        clearForm();
        closeForm();
      } catch (err) {
        setMsg(err.message || 'Erro ao salvar.', true);
      }
    }

    // ---------- Events ----------
    moneyMaskAttach(els.value);
    buildEmojiPanel();
    setNovoButton(formOpen);

    els.btnNovo.addEventListener('click', () => {
      if (formOpen) {
        clearForm();
        closeForm();
        return;
      }
      clearForm();
      openForm();
      els.title?.focus();
    });

    if (els.btnCloseForm) {
      els.btnCloseForm.addEventListener('click', () => {
        clearForm();
        closeForm();
      });
    }

    if (els.save) els.save.addEventListener('click', handleSave);
    if (els.clear) els.clear.addEventListener('click', clearForm);
    if (els.reload) els.reload.addEventListener('click', () => reloadMimos());
    if (els.search) els.search.addEventListener('input', () => renderMimosTable(cacheMimos));

    // Botão "Limpar busca" (opcional): volta ao fluxo padrão (mesma renderização do default)
    if (els.btnClearSearch) {
      els.btnClearSearch.addEventListener('click', () => {
        if (!els.search) return;
        els.search.value = '';
        reloadMimos().catch(() => {});
        els.search.focus();
      });
    }

    // Expor funções (compat, caso scripts.js queira chamar)
    window.PF_MIMOS = window.PF_MIMOS || {};
    window.PF_MIMOS.reload = reloadMimos;

    // Carrega lista inicial
    reloadMimos().catch(() => {});
    return true;
  }
})();
