/* services.js — Extração segura do módulo SERVIÇOS (sem regressão / sem top-level await)
   - Não usa "await" fora de async.
   - Não exige <script type="module">.
   - Exporta no window: loadServices, refreshServiceOptionsInAgenda, getServiceById, servicesCache.
*/
(function () {
  'use strict';

  // =========================
  // Dependências (API)
  // =========================
  function requireFn(name) {
    const fn = window[name];
    if (typeof fn !== 'function') {
      // Mantém o sistema em pé e gera erro claro quando o módulo for usado
      return async function () {
        throw new Error(`[services.js] Função obrigatória não encontrada: ${name} (verifique pf_api.js / scripts carregados antes)`);
      };
    }
    return fn;
  }

  const apiGet = requireFn('apiGet');
  const apiPost = requireFn('apiPost');
  const apiPut = requireFn('apiPut');
  const apiDelete = requireFn('apiDelete');

  // =========================
  // Helpers (fallbacks seguros)
  // =========================
  function normStr(s) {
    return String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function formatCentsToBRL(cents) {
    const v = Number(cents || 0) / 100;
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function parseBRLToCents(brlText) {
    const s = String(brlText || '').replace(/\s/g, '');
    if (!s) return null;
    // Remove R$, pontos de milhar, troca vírgula por ponto
    const cleaned = s.replace(/[R$\u00A0]/g, '').replace(/\./g, '').replace(',', '.');
    const num = Number(cleaned);
    if (!Number.isFinite(num)) return null;
    return Math.round(num * 100);
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // =========================
  // Estado do módulo
  // =========================
  let servicesCache = Array.isArray(window.servicesCache) ? window.servicesCache : [];
  let selectedServiceIds = Array.isArray(window.selectedServiceIds) ? window.selectedServiceIds : [];

  // Filtros (tabela de serviços)
  let filtroServicosTxt = '';
  let filtroCategoriaServicosVal = '';

  // =========================
  // Referências de DOM (setadas no init)
  // =========================
  let serviceIdInput, serviceTitle, serviceCategory, servicePorte, serviceTempo, servicePrice;
  let serviceError, btnServiceCancel, btnServiceSave;
  let tbodyServices, servicesEmpty;
  let filtroServicos, filtroCategoriaServicos, btnLimparServicos;
  let btnNovoServico;

  // Painel/form (se existir)
  let serviceFormPanel;

  // Agenda (select do serviço e UI de múltiplos serviços — se existir)
  let formService;
  let selectedServicesList, selectedServicesWrap, servicesTotalEl;

  // =========================
  // Utils de lookup
  // =========================
  function getServiceById(id) {
    if (id == null) return null;
    return (servicesCache || []).find(s => String(s.id) === String(id)) || null;
  }

  // =========================
  // UI: abrir/fechar/limpar form
  // =========================
  function showServiceForm() {
    if (serviceFormPanel) serviceFormPanel.style.display = '';
  }
  function hideServiceForm() {
    if (serviceFormPanel) serviceFormPanel.style.display = 'none';
  }

  function clearServiceForm() {
    if (serviceIdInput) serviceIdInput.value = '';
    if (serviceTitle) serviceTitle.value = '';
    if (serviceCategory) serviceCategory.value = '';
    if (servicePorte) servicePorte.value = '';
    if (serviceTempo) serviceTempo.value = '';
    if (servicePrice) {
      servicePrice.value = '';
      servicePrice.dataset.cents = '';
    }
    if (serviceError) {
      serviceError.style.display = 'none';
      serviceError.textContent = '';
    }
  }

  function fillServiceForm(svc) {
    if (!svc) return;
    if (serviceIdInput) serviceIdInput.value = svc.id != null ? String(svc.id) : '';
    if (serviceTitle) serviceTitle.value = svc.title || '';
    if (serviceCategory) serviceCategory.value = svc.category || '';
    if (servicePorte) servicePorte.value = svc.porte || '';
    if (serviceTempo) serviceTempo.value = svc.duration_min != null ? String(svc.duration_min) : '';
    if (servicePrice) {
      servicePrice.dataset.cents = String(svc.value_cents ?? '');
      servicePrice.value = svc.value_cents != null ? formatCentsToBRL(svc.value_cents) : '';
    }
    if (serviceError) {
      serviceError.style.display = 'none';
      serviceError.textContent = '';
    }
  }

  // =========================
  // Render: tabela de serviços (admin)
  // =========================
  function renderServices() {
    if (!tbodyServices) return;

    tbodyServices.innerHTML = '';

    const list = (servicesCache || []).filter(s => {
      // filtro por texto (título)
      if (filtroServicosTxt) {
        const hay = normStr(s.title || '');
        if (!hay.includes(filtroServicosTxt)) return false;
      }
      // filtro por categoria
      if (filtroCategoriaServicosVal) {
        const cat = normStr(s.category || '');
        if (cat !== filtroCategoriaServicosVal) return false;
      }
      return true;
    });

    if (servicesEmpty) {
      servicesEmpty.style.display = list.length ? 'none' : 'block';
      if (!list.length) servicesEmpty.textContent = 'Nenhum serviço encontrado.';
    }

    list.forEach(svc => {
      const tr = document.createElement('tr');

      const tdId = document.createElement('td');
      tdId.textContent = svc.id != null ? String(svc.id) : '-';

      const tdTitle = document.createElement('td');
      tdTitle.textContent = svc.title || '';

      const tdCat = document.createElement('td');
      tdCat.textContent = svc.category || '';

      const tdPorte = document.createElement('td');
      tdPorte.textContent = svc.porte || '';

      const tdTempo = document.createElement('td');
      tdTempo.textContent = (svc.duration_min != null ? String(svc.duration_min) + ' min' : '');

      const tdValor = document.createElement('td');
      tdValor.textContent = (svc.value_cents != null ? formatCentsToBRL(svc.value_cents) : '');

      const tdUpdated = document.createElement('td');
      tdUpdated.textContent = svc.updated_at ? String(svc.updated_at).replace('T', ' ').slice(0, 19) : '';

      const tdAcoes = document.createElement('td');
      const divActions = document.createElement('div');
      divActions.className = 'actions';

      const btnEdit = document.createElement('button');
      btnEdit.type = 'button';
      btnEdit.className = 'btn btn-small';
      btnEdit.textContent = 'Editar';
      btnEdit.addEventListener('click', () => {
        clearServiceForm();
        fillServiceForm(svc);
        showServiceForm();
      });

      const btnDel = document.createElement('button');
      btnDel.type = 'button';
      btnDel.className = 'btn btn-small btn-danger';
      btnDel.textContent = 'Excluir';
      btnDel.addEventListener('click', async () => {
        if (!confirm('Deseja realmente excluir este serviço?')) return;
        try {
          await apiDelete('/api/services/' + svc.id);
          await window.loadServices();
          if (typeof window.loadDashboard === 'function') await window.loadDashboard();
        } catch (e) {
          alert(e.message || String(e));
        }
      });

      divActions.appendChild(btnEdit);
      divActions.appendChild(btnDel);
      tdAcoes.appendChild(divActions);

      tr.appendChild(tdId);
      tr.appendChild(tdTitle);
      tr.appendChild(tdCat);
      tr.appendChild(tdPorte);
      tr.appendChild(tdTempo);
      tr.appendChild(tdValor);
      tr.appendChild(tdUpdated);
      tr.appendChild(tdAcoes);

      tbodyServices.appendChild(tr);
    });
  }

  // =========================
  // Agenda: opções de serviço (select)
  // =========================
  function refreshServiceOptionsInAgenda() {
    if (!formService) return;

    const current = formService.value || '';
    formService.innerHTML = '<option value="">Selecione...</option>';

    // Porte do pet (se o seu scripts.js já seta um global, respeitamos)
    const sizeFilter =
      (typeof window.currentPetSize === 'string')
        ? window.currentPetSize.trim().toLowerCase()
        : '';

    // Filtra por porte (regra atual)
    const filtered = (servicesCache || []).filter(svc => {
      if (!sizeFilter) return true;
      if (!svc.porte) return true;
      return String(svc.porte).toLowerCase() === sizeFilter;
    });

    // Agrupa por categoria
    const grouped = {};
    filtered.forEach(svc => {
      const cat = svc.category || 'Outros';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(svc);
    });

    Object.keys(grouped).sort().forEach(category => {
      const optgroup = document.createElement('optgroup');
      optgroup.label = category;

      grouped[category]
        .slice()
        .sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'pt-BR'))
        .forEach(svc => {
          const opt = document.createElement('option');
          opt.value = String(svc.id);
          const tempo = svc.duration_min != null ? ` • ${svc.duration_min} min` : '';
          const valor = svc.value_cents != null ? ` • ${formatCentsToBRL(svc.value_cents)}` : '';
          opt.textContent = `${svc.title || 'Serviço'}${tempo}${valor}`;
          optgroup.appendChild(opt);
        });

      formService.appendChild(optgroup);
    });

    // restaura seleção
    if (current) formService.value = current;
  }

  // =========================
  // (Opcional) UI múltiplos serviços (se seu admin usa)
  // =========================
  function refreshSelectedServicesUI() {
    if (!selectedServicesList || !selectedServicesWrap || !servicesTotalEl) return;

    selectedServicesList.innerHTML = '';
    let total = 0;
    let totalMin = 0;

    // mantém únicos
    const unique = Array.from(new Set(selectedServiceIds.map(String)));
    selectedServiceIds = unique;

    unique.forEach((sid) => {
      const svc = getServiceById(sid);
      if (!svc) return;

      total += Number(svc.value_cents || 0);
      totalMin += Number(svc.duration_min || 0);

      const li = document.createElement('li');
      li.className = 'selected-service-item';
      li.innerHTML = `
        <span class="svc-title">${escapeHtml(svc.title || '')}</span>
        <span class="svc-meta">${svc.duration_min != null ? `${svc.duration_min} min` : ''}${svc.value_cents != null ? ` • ${escapeHtml(formatCentsToBRL(svc.value_cents))}` : ''}</span>
        <button type="button" class="btn btn-small" data-remove-sid="${escapeHtml(String(sid))}">Remover</button>
      `;
      selectedServicesList.appendChild(li);
    });

    servicesTotalEl.textContent =
      `${formatCentsToBRL(total)} | ${totalMin} min`;

    selectedServicesWrap.style.display = unique.length ? '' : 'none';

    // expõe o array para o resto do sistema (mantendo compat)
    window.selectedServiceIds = selectedServiceIds;
  }

  // =========================
  // CRUD: salvar serviço
  // =========================
  async function saveService() {
    if (!serviceTitle || !serviceCategory || !serviceTempo || !servicePrice) return;

    if (serviceError) {
      serviceError.style.display = 'none';
      serviceError.textContent = '';
    }

    const id = serviceIdInput && serviceIdInput.value ? String(serviceIdInput.value) : '';
    const title = String(serviceTitle.value || '').trim();
    const category = String(serviceCategory.value || '').trim();
    const porte = servicePorte ? String(servicePorte.value || '').trim() : '';
    const duration_min = Number(serviceTempo.value || 0);

    const cents =
      (servicePrice.dataset && servicePrice.dataset.cents)
        ? parseInt(servicePrice.dataset.cents, 10)
        : parseBRLToCents(servicePrice.value);

    if (!title) {
      if (serviceError) {
        serviceError.textContent = 'Preencha o título do serviço.';
        serviceError.style.display = 'block';
      }
      serviceTitle.focus();
      return;
    }

    if (!category) {
      if (serviceError) {
        serviceError.textContent = 'Selecione a categoria do serviço.';
        serviceError.style.display = 'block';
      }
      serviceCategory.focus();
      return;
    }

    if (!Number.isFinite(duration_min) || duration_min <= 0) {
      if (serviceError) {
        serviceError.textContent = 'Informe um tempo (minutos) válido.';
        serviceError.style.display = 'block';
      }
      serviceTempo.focus();
      return;
    }

    if (cents == null || !Number.isFinite(cents) || cents < 0) {
      if (serviceError) {
        serviceError.textContent = 'Informe um valor válido.';
        serviceError.style.display = 'block';
      }
      servicePrice.focus();
      return;
    }

    const body = {
      title,
      category,
      porte: porte || null,
      duration_min,
      value_cents: cents
    };

    try {
      if (!id) await apiPost('/api/services', body);
      else await apiPut('/api/services/' + id, body);

      clearServiceForm();
      hideServiceForm();
      await window.loadServices();
      if (typeof window.loadDashboard === 'function') await window.loadDashboard();
    } catch (e) {
      if (serviceError) {
        serviceError.textContent = e.message || String(e);
        serviceError.style.display = 'block';
      }
    }
  }

  // Máscara simples do campo valor (mantém dataset.cents)
  function bindPriceInput() {
    if (!servicePrice) return;

    servicePrice.addEventListener('input', () => {
      const cents = parseBRLToCents(servicePrice.value);
      servicePrice.dataset.cents = cents != null ? String(cents) : '';
    });

    servicePrice.addEventListener('blur', () => {
      const cents = parseBRLToCents(servicePrice.value);
      if (cents != null) {
        servicePrice.dataset.cents = String(cents);
        servicePrice.value = formatCentsToBRL(cents);
      }
    });
  }

  // =========================
  // Carregamento: /api/services
  // =========================
  async function loadServices() {
    try {
      const data = await apiGet('/api/services');
      servicesCache = data.services || [];
      window.servicesCache = servicesCache; // compat
      renderServices();
      refreshServiceOptionsInAgenda();
      refreshSelectedServicesUI();
    } catch (e) {
      servicesCache = [];
      window.servicesCache = servicesCache;
      renderServices();
      refreshServiceOptionsInAgenda();
      refreshSelectedServicesUI();
      if (servicesEmpty) {
        servicesEmpty.style.display = 'block';
        servicesEmpty.textContent = 'Erro ao carregar serviços: ' + (e.message || String(e));
      }
    }
  }

  // =========================
  // Init do módulo (sem impacto)
  // =========================
  function initServicesModule() {
    // Admin: elementos do CRUD
    serviceIdInput = document.getElementById('serviceId');
    serviceTitle = document.getElementById('serviceTitle');
    serviceCategory = document.getElementById('serviceCategory');
    servicePorte = document.getElementById('servicePorte');
    serviceTempo = document.getElementById('serviceTempo');
    servicePrice = document.getElementById('servicePrice');
    serviceError = document.getElementById('serviceError');
    btnServiceCancel = document.getElementById('btnServiceCancel');
    btnServiceSave = document.getElementById('btnServiceSave');
    tbodyServices = document.getElementById('tbodyServices');
    servicesEmpty = document.getElementById('servicesEmpty');

    filtroServicos = document.getElementById('filtroServicos');
    filtroCategoriaServicos = document.getElementById('filtroCategoriaServicos');
    btnLimparServicos = document.getElementById('btnLimparServicos');
    btnNovoServico = document.getElementById('btnNovoServico');

    serviceFormPanel = document.getElementById('serviceFormPanel') || document.getElementById('serviceForm') || null;

    // Agenda: select e lista de selecionados (se existirem)
    formService = document.getElementById('formService') || document.getElementById('serviceSelect') || null;
    selectedServicesList = document.getElementById('selectedServicesList') || null;
    selectedServicesWrap = document.getElementById('selectedServicesWrap') || null;
    servicesTotalEl = document.getElementById('servicesTotal') || null;

    // Eventos do CRUD
    if (btnNovoServico) {
      btnNovoServico.addEventListener('click', () => {
        // toggle
        if (serviceFormPanel && serviceFormPanel.style.display === 'none') showServiceForm();
        else if (serviceFormPanel && serviceFormPanel.style.display === '') hideServiceForm();
        else showServiceForm();
        clearServiceForm();
      });
    }

    if (btnServiceCancel) {
      btnServiceCancel.addEventListener('click', () => {
        clearServiceForm();
        hideServiceForm();
      });
    }

    if (btnServiceSave) {
      btnServiceSave.addEventListener('click', async () => {
        await saveService();
      });
    }

    // Filtros
    if (filtroServicos) {
      filtroServicos.addEventListener('input', () => {
        filtroServicosTxt = normStr(filtroServicos.value || '');
        renderServices();
      });
    }

    if (filtroCategoriaServicos) {
      filtroCategoriaServicos.addEventListener('change', () => {
        filtroCategoriaServicosVal = normStr(filtroCategoriaServicos.value || '');
        renderServices();
      });
    }

    if (btnLimparServicos) {
      btnLimparServicos.addEventListener('click', () => {
        filtroServicosTxt = '';
        filtroCategoriaServicosVal = '';
        if (filtroServicos) filtroServicos.value = '';
        if (filtroCategoriaServicos) filtroCategoriaServicos.value = '';
        renderServices();
      });
    }

    // UI múltiplos serviços (remover)
    if (selectedServicesList) {
      selectedServicesList.addEventListener('click', (ev) => {
        const btn = ev.target && ev.target.closest ? ev.target.closest('[data-remove-sid]') : null;
        if (!btn) return;
        const sid = btn.getAttribute('data-remove-sid');
        selectedServiceIds = selectedServiceIds.filter(x => String(x) !== String(sid));
        window.selectedServiceIds = selectedServiceIds;
        refreshSelectedServicesUI();
      });
    }

    bindPriceInput();
  }

  // =========================
  // Exports (compat com scripts.js antigo)
  // =========================
  window.servicesCache = servicesCache;
  window.getServiceById = getServiceById;
  window.renderServices = renderServices;
  window.refreshServiceOptionsInAgenda = refreshServiceOptionsInAgenda;
  window.refreshSelectedServicesUI = refreshSelectedServicesUI;
  window.loadServices = loadServices;
  window.initServicesModule = initServicesModule;

  // Init automático (seguro)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initServicesModule);
  } else {
    initServicesModule();
  }
})();
