(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  const config = globalThis.NMDA_VM_CONFIG || {};
  const wantedTab = config.tab || params.get('tab') || 'batch';
  const maximize = config.maximize ?? (params.get('max') !== '0');
  const sample = config.sample ?? (params.get('sample') === '1');

  async function waitFor(selector, timeout = 8000) {
    const start = performance.now();
    while (performance.now() - start < timeout) {
      const el = document.querySelector(selector);
      if (el) return el;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`VM preview timeout: ${selector}`);
  }

  async function boot() {
    const launcher = await waitFor('#nmda-launcher');
    const panel = await waitFor('#nmda-panel');
    if (panel.hidden) launcher.click();

    const tab = document.querySelector(`.nmda-tab[data-tab="${CSS.escape(wantedTab)}"]`);
    tab?.click();

    if (maximize && !panel.classList.contains('is-maximized')) {
      document.querySelector('#nmda-expand')?.click();
    }

    if (sample && wantedTab === 'batch') {
      const pasteButton = document.querySelector('#nmda-show-paste');
      pasteButton?.click();
      const textarea = document.querySelector('#nmda-paste-source');
      if (textarea) {
        textarea.value = `Professor Alice Chen — alice.chen@example.edu\nSubject: Prospective PhD inquiry\n\nDear Professor Chen,\nI am writing to inquire about potential doctoral opportunities in your group.\n\nBest regards,\nYohan\n\nProfessor Bob Li — bob.li@example.edu\nSubject: Prospective PhD inquiry\n\nDear Professor Li,\nI am writing to inquire about potential doctoral opportunities in your group.\n\nBest regards,\nYohan`;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#nmda-paste-import')?.click();
      }
    }

    document.documentElement.dataset.nmdaVmReady = 'true';
    window.dispatchEvent(new CustomEvent('nmda-vm-ready'));
  }

  boot().catch(error => {
    console.error('[NMDA VM Preview]', error);
    document.documentElement.dataset.nmdaVmError = error.message || String(error);
  });
})();
