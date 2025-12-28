/* API layer — PetFunny (frontend)
   Provides: apiGet, apiPost, apiPut, apiDelete, apiViaCep
   NOTE: API_BASE_URL = '' keeps same-origin behavior (Render / Nginx)
*/
(function () {
  'use strict';

  const API_BASE_URL = '';

  async function parseJsonSafe(resp) {
    try { return await resp.json(); } catch { return {}; }
  }

  async function apiGet(path, params) {
    const url = new URL(API_BASE_URL + path, window.location.origin);
    if (params && typeof params === 'object') {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') url.searchParams.append(k, v);
      });
    }
    const resp = await fetch(url.toString(), { method: 'GET' });
    const data = await parseJsonSafe(resp);
    if (!resp.ok) throw new Error(data.error || 'Erro ao buscar dados.');
    return data;
  }

  async function apiPost(path, body) {
    const resp = await fetch(API_BASE_URL + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const data = await parseJsonSafe(resp);
    if (!resp.ok) throw new Error(data.error || 'Erro ao salvar.');
    return data;
  }

  async function apiPut(path, body) {
    const resp = await fetch(API_BASE_URL + path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const data = await parseJsonSafe(resp);
    if (!resp.ok) throw new Error(data.error || 'Erro ao atualizar.');
    return data;
  }

  async function apiDelete(path) {
    const resp = await fetch(API_BASE_URL + path, { method: 'DELETE' });
    const data = await parseJsonSafe(resp);
    if (!resp.ok) throw new Error(data.error || 'Erro ao excluir.');
    return data;
  }

  // ViaCEP lookup (admin/customer address autofill)
  async function apiViaCep(cep) {
    const clean = String(cep || '').replace(/\D+/g, '');
    if (clean.length !== 8) return null;
    const url = `https://viacep.com.br/ws/${clean}/json/`;
    const resp = await fetch(url, { method: 'GET' });
    if (!resp.ok) return null;
    const data = await resp.json().catch(() => null);
    if (!data || data.erro) return null;
    return data;
  }

  // Export to window (backward compatible)
  window.apiGet = apiGet;
  window.apiPost = apiPost;
  window.apiPut = apiPut;
  window.apiDelete = apiDelete;
  window.apiViaCep = apiViaCep;
})();
