// /admin/js/bootstrap.js
(function () {
  'use strict';

  function load(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src; // sempre caminho absoluto
      // IMPORTANTE: scripts injetados ignoram o comportamento de "defer" como em <script defer>.
      // Como este arquivo está no final do admin.html, o DOM já existe.
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
    // Módulos extraídos (opcionais). Se algum não existir, o admin não quebra.
    await tryLoad('/admin/js/modules/mimos.js');
    await tryLoad('/admin/js/modules/services.js');

    // Monolito principal (deve carregar sempre)
    await load('/scripts.js');
    console.log('[bootstrap] OK: /scripts.js');
  })().catch(err => console.error('[bootstrap] FALHA:', err));
})();
