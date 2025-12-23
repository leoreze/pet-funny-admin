/* PATCH: Extract API layer to pf_api.js — 2025-12-22
   PetFunny — API helper layer (fetch wrappers)
*/
(function () {
  'use strict';

  // Keep empty by default (same-origin). If you later want to point to another host, set it here.
  const API_BASE_URL = '';

  async function apiGet(path, params) {
    const url = new URL(API_BASE_URL + path, window.location.origin);
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
    const resp = await fetch(API_BASE_URL + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || 'Erro ao salvar.');
    return data;
  }

  async function apiPut(path, body) {
    const resp = await fetch(API_BASE_URL + path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || 'Erro ao atualizar.');
    return data;
  }

  async function apiDelete(path) {
    const resp = await fetch(API_BASE_URL + path, { method: 'DELETE' });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || 'Erro ao apagar.');
    return data;
  }

  // Namespaced export + legacy aliases (minimize regressions)
  window.PF_API = window.PF_API || {};
  window.PF_API.API_BASE_URL = API_BASE_URL;
  window.PF_API.apiGet = apiGet;
  window.PF_API.apiPost = apiPost;
  window.PF_API.apiPut = apiPut;
  window.PF_API.apiDelete = apiDelete;

  // Legacy globals (scripts.js already calls these)
  window.apiGet = window.apiGet || apiGet;
  window.apiPost = window.apiPost || apiPost;
  window.apiPut = window.apiPut || apiPut;
  window.apiDelete = window.apiDelete || apiDelete;

})();
