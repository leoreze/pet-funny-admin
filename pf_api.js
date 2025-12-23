/* PATCH: extrai camada de API (fetch helpers) - 2025-12-22
   PetFunny Admin - pf_api.js
*/
(function () {
  'use strict';

  function getApiBase() {
    const v = (typeof window !== 'undefined' && window.API_BASE_URL != null) ? String(window.API_BASE_URL) : '';
    return v;
  }

  async function apiGet(path, params) {
    const url = new URL(getApiBase() + path, window.location.origin);
    if (params) {
      Object.keys(params).forEach(k => {
        const v = params[k];
        if (v !== undefined && v !== null && v !== '') url.searchParams.append(k, v);
      });
    }
    const resp = await fetch(url.toString());
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || 'Erro ao buscar dados.');
    return data;
  }

  async function apiPost(path, body) {
    const resp = await fetch(getApiBase() + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || 'Erro ao salvar.');
    return data;
  }

  async function apiPut(path, body) {
    const resp = await fetch(getApiBase() + path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || 'Erro ao atualizar.');
    return data;
  }

  async function apiDelete(path) {
    const resp = await fetch(getApiBase() + path, { method: 'DELETE' });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || 'Erro ao apagar.');
    return data;
  }

  window.PF_API = window.PF_API || {};
  window.PF_API.apiGet = apiGet;
  window.PF_API.apiPost = apiPost;
  window.PF_API.apiPut = apiPut;
  window.PF_API.apiDelete = apiDelete;

  // Compat globals
  window.apiGet = apiGet;
  window.apiPost = apiPost;
  window.apiPut = apiPut;
  window.apiDelete = apiDelete;
})();
