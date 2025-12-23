/* PATCH: API layer — PetFunny
   DATE: 2025-12-23 */
(function () {
  'use strict';

  const API_BASE_URL = '';

  async function apiGet(path, params) {
    const url = new URL(API_BASE_URL + path, window.location.origin);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') {
          url.searchParams.append(k, v);
        }
      });
    }
    const res = await fetch(url.toString());
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Erro ao buscar dados');
    return json;
  }

  async function apiPost(path, body) {
    const res = await fetch(API_BASE_URL + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Erro ao salvar');
    return json;
  }

  async function apiPut(path, body) {
    const res = await fetch(API_BASE_URL + path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Erro ao atualizar');
    return json;
  }

  async function apiDelete(path) {
    const res = await fetch(API_BASE_URL + path, { method: 'DELETE' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Erro ao excluir');
    return json;
  }

  // Namespace
  window.PF_API = {
    get: apiGet,
    post: apiPost,
    put: apiPut,
    del: apiDelete,
  };

  // Compatibilidade (scripts.js legado)
  window.apiGet = window.apiGet || apiGet;
  window.apiPost = window.apiPost || apiPost;
  window.apiPut = window.apiPut || apiPut;
  window.apiDelete = window.apiDelete || apiDelete;

})();
