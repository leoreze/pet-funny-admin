// /admin/js/bootstrap.js
(function () {
  'use strict';

  if (window.__pfBootstrapLoaded) return;
  window.__pfBootstrapLoaded = true;

  function load(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error('Falha ao carregar: ' + src));
      document.head.appendChild(el);
    });
  }

  async function tryLoad(src) {
    try {
      await load(src);
      console.log('[bootstrap] OK:', src);
      return true;
    } catch (err) {
      console.warn('[bootstrap] IGNORADO:', src, err.message || err);
      return false;
    }
  }

  (async () => {
    await tryLoad('/admin/js/modules/mimos.js');
    await tryLoad('/admin/js/modules/services.js');
    await load('/scripts.js');
    console.log('[bootstrap] OK: /scripts.js');
  })().catch(err => console.error('[bootstrap] FALHA:', err));
})();
