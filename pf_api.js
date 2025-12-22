/* PATCH: Extrai helpers de API para módulo (PF_API) — 2025-12-22 */

(function () {
  'use strict';

  function getBaseUrl() {
    // Mantém compatibilidade: se existir API_BASE_URL global (string), prefixa.
    // Caso contrário, usa string vazia e segue com paths relativos.
    try {
      if (typeof window.API_BASE_URL === 'string') return window.API_BASE_URL;
    } catch (_) {}
    return '';
  }

  function buildUrl(path, params) {
    const base = getBaseUrl();
    const url = new URL(base + path, window.location.origin);

    if (params && typeof params === 'object') {
      Object.entries(params).forEach(([k, v]) => {
        if (v === undefined || v === null || v === '') return;
        url.searchParams.set(k, String(v));
      });
    }
    return url.toString();
  }

  async function request(method, path, body, params) {
    const url = buildUrl(path, params);

    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (body !== undefined) opts.body = JSON.stringify(body);

    const res = await fetch(url, opts);

    // Tenta ler JSON sempre (mantém comportamento do scripts.js original)
    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      data = null;
    }

    if (!res.ok) {
      const msg =
        (data && (data.error || data.message)) ||
        `Erro HTTP ${res.status} em ${method} ${path}`;
      throw new Error(msg);
    }

    return data;
  }

  async function get(path, params) {
    return request('GET', path, undefined, params);
  }

  async function post(path, body) {
    return request('POST', path, body);
  }

  async function put(path, body) {
    return request('PUT', path, body);
  }

  async function del(path) {
    return request('DELETE', path);
  }

  window.PF_API = { get, post, put, del };
})();
