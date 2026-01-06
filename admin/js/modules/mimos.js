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
      // modal (novo padrão)
      modal: $('mimoModal'),
      modalHost: $('mimoModalHost'),
      modalClose: $('mimoModalClose'),

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

    
    // Estado do formulário
    let modalOpen = false;
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
    function ensureFormInModal() {
      if (!els.formWrap) return;
      if (els.modalHost && els.formWrap.parentElement !== els.modalHost) {
        try { els.modalHost.appendChild(els.formWrap); } catch (_) {}
      }
    }

    function showMimoModal(show) {
      if (!els.modal) {
        // fallback: mantém compatibilidade com versões antigas (form inline)
        if (els.formWrap) els.formWrap.style.display = show ? 'block' : 'none';
        modalOpen = !!show;
        return;
      }

      ensureFormInModal();
      els.modal.classList.toggle('hidden', !show);
      els.modal.setAttribute('aria-hidden', show ? 'false' : 'true');

      if (els.formWrap) {
        // Quando dentro do modal, sempre controlamos a visibilidade pelo show/hide
        // para evitar que o formulário fique "aberto" em background.
        els.formWrap.style.display = show ? 'block' : 'none';
      }
      modalOpen = !!show;

      if (show) {
        const first = els.title || els.desc;
        if (first) { try { first.focus(); } catch (_) {} }
      }
    }

    function openForm() { showMimoModal(true); }
    function closeForm() { showMimoModal(false); currentEditId = null; }

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
        // Ações: menu 3 pontinhos (kebab) — mesmo padrão do restante do admin
        const divActions = document.createElement('div');
        divActions.className = 'actions actions-kebab';

        const kebabBtn = document.createElement('button');
        kebabBtn.type = 'button';
        kebabBtn.className = 'kebab-btn';
        kebabBtn.setAttribute('aria-label', 'Ações');
        kebabBtn.textContent = '⋮';

        const kebabMenu = document.createElement('div');
        kebabMenu.className = 'kebab-menu hidden';

        const closeMenu = () => {
          kebabMenu.classList.add('hidden');
          kebabMenu.classList.remove('open');
          kebabMenu.style.display = 'none';
        };

        // fecha os demais
        const closeOtherMenus = () => {
          document.querySelectorAll('.kebab-menu').forEach((mm) => {
            if (mm !== kebabMenu) {
              mm.classList.add('hidden');
              mm.classList.remove('open');
              mm.style.display = 'none';
            }
          });
        };

        kebabBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          closeOtherMenus();
          const willOpen = kebabMenu.classList.contains('hidden');
          if (willOpen) {
            kebabMenu.classList.remove('hidden');
            kebabMenu.classList.add('open');
            kebabMenu.style.display = 'block';
          } else {
            closeMenu();
          }

          if (willOpen) {
            // portal no body p/ não cortar por overflow do wrapper da tabela
            try {
              if (!kebabMenu.dataset.portalAttached) {
                document.body.appendChild(kebabMenu);
                kebabMenu.dataset.portalAttached = '1';
                kebabMenu.classList.add('kebab-menu-portal');
              }
              const rect = kebabBtn.getBoundingClientRect();
              const menuW = 180;
              kebabMenu.style.position = 'fixed';
              kebabMenu.style.minWidth = menuW + 'px';
              kebabMenu.style.zIndex = '999999';
              kebabMenu.style.top = Math.round(rect.bottom + 6) + 'px';
              kebabMenu.style.left = Math.round(Math.max(8, rect.right - menuW)) + 'px';
            } catch (_) {}
          }
        });

        // binder global 1x para fechar menus ao clicar fora
        if (!document.body.dataset.pfKebabGlobalBound) {
          document.body.dataset.pfKebabGlobalBound = '1';
          document.addEventListener('click', () => {
            document.querySelectorAll('.kebab-menu').forEach((mm) => {
              mm.classList.add('hidden');
              mm.classList.remove('open');
              mm.style.display = 'none';
            });
          });
          window.addEventListener('scroll', () => {
            document.querySelectorAll('.kebab-menu').forEach((mm) => {
              mm.classList.add('hidden');
              mm.classList.remove('open');
              mm.style.display = 'none';
            });
          }, true);
        }

        const btnEdit = document.createElement('button');
        btnEdit.textContent = 'Editar';
        btnEdit.className = 'kebab-item';
        btnEdit.type = 'button';
        btnEdit.addEventListener('click', () => {
          closeMenu();
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
        btnDel.textContent = 'Excluir';
        btnDel.className = 'kebab-item kebab-item-danger';
        btnDel.type = 'button';
        btnDel.addEventListener('click', async () => {
          closeMenu();
          const ok = confirm(`Excluir o mimo "${m.title}"?`);
          if (!ok) return;
          try {
            setMsg('Excluindo...', false);
            await apiDeleteMimo(m.id);
            await reloadMimos();
            setMsg('', false);
            if (typeof showHint === 'function') showHint('Mimo excluído com sucesso...', 'success', 'Mimos');
          } catch (err) {
            setMsg(err.message || 'Erro ao excluir.', true);
            if (typeof showHint === 'function') showHint(err.message || 'Erro ao excluir.', 'error', 'Mimos', { time: 3200 });
          }
        });

        kebabMenu.appendChild(btnEdit);
        kebabMenu.appendChild(btnDel);
        divActions.appendChild(kebabBtn);
        divActions.appendChild(kebabMenu);
        tdActions.appendChild(divActions);
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

        const isEdit = !!currentEditId;
        if (isEdit) await apiUpdateMimo(currentEditId, payload);
        else await apiCreateMimo(payload);

        await reloadMimos();
        clearForm();
        closeForm();

        // Mensagem padronizada (pfHint) com timer, após o fechamento do modal.
        const msg = isEdit ? 'Mimo alterado com sucesso!' : 'Novo Mimo criado com sucesso!';
        if (typeof showHint === 'function') {
          setTimeout(() => {
            showHint(msg, 'success', 'Mimos', { time: 2600 });
          }, 50);
        }
      } catch (err) {
        setMsg(err.message || 'Erro ao salvar.', true);
        if (typeof showHint === 'function') showHint(err.message || 'Erro ao salvar.', 'error', 'Mimos', { time: 3200 });
      }
    }

    // ---------- Events ----------
    moneyMaskAttach(els.value);
    buildEmojiPanel();
    // Modal close (overlay click + X)
    if (els.modal && !els.modal.dataset.boundClose) {
      els.modal.dataset.boundClose = '1';
      els.modal.addEventListener('click', (e) => {
        if (e.target === els.modal) {
          clearForm();
          closeForm();
        }
      });
    }
    if (els.modalClose && !els.modalClose.dataset.bound) {
      els.modalClose.dataset.bound = '1';
      els.modalClose.addEventListener('click', () => {
        clearForm();
        closeForm();
      });
    }

    // Botão Novo Mimo: sempre abre modal (sem toggle / sem alterar layout)
    els.btnNovo.addEventListener('click', () => {
      clearForm();
      openForm();
      els.title?.focus();
    });

    // compat: se existir botão antigo de fechar no form (não deve existir mais), mantém
    if (els.btnCloseForm && !els.btnCloseForm.dataset.bound) {
      els.btnCloseForm.dataset.bound = '1';
      els.btnCloseForm.addEventListener('click', () => { clearForm(); closeForm(); });
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
