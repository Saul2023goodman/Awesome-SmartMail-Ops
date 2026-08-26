(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  const config = globalThis.NMDA_VM_CONFIG || {};
  const wantedTab = config.tab || params.get('tab') || 'batch';
  const maximize = config.maximize ?? (params.get('max') !== '0');
  const sample = config.sample ?? (params.get('sample') === '1');
  const view = config.view || params.get('view') || 'base';

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
        textarea.value = view === 'duplicate'
          ? `Professor Alice Chen — alice.chen@example.edu
Subject: PhD inquiry — research fit

Dear Professor Chen,
I am writing to inquire about potential doctoral opportunities in your group. My recent work focuses on reliable data analysis and I would be grateful for the opportunity to discuss research fit.

Best regards,
Yohan

Professor Alice Chen — alice.chen@example.edu
Subject: Prospective PhD inquiry

Dear Professor Chen,
I am interested in doctoral opportunities in your group.

Best regards,
Yohan

Professor Bob Li — bob.li@example.edu
Subject: Prospective PhD inquiry

Dear Professor Li,
I am writing to inquire about potential doctoral opportunities in your group.

Best regards,
Yohan`
          : `Professor Alice Chen — alice.chen@example.edu
Subject: Prospective PhD inquiry

Dear Professor Chen,
I am writing to inquire about potential doctoral opportunities in your group.

Best regards,
Yohan

Professor Bob Li — bob.li@example.edu
Subject: Prospective PhD inquiry

Dear Professor Li,
I am writing to inquire about potential doctoral opportunities in your group.

Best regards,
Yohan`;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#nmda-paste-import')?.click();
      }
    }

    if (sample && wantedTab === 'batch' && (view === 'review' || view === 'selection' || view === 'duplicate')) {
      await new Promise(resolve => setTimeout(resolve, 900));
      document.querySelector('#nmda-review-import-issues')?.click();
      await new Promise(resolve => setTimeout(resolve, 250));
      if (view === 'duplicate') {
        const keys = [...document.querySelectorAll('[data-review-key]')].slice(0, 2).map(button => button.dataset.reviewKey).filter(Boolean);
        for (const key of keys) {
          document.querySelector(`[data-review-key="${CSS.escape(key)}"]`)?.click();
          await new Promise(resolve => setTimeout(resolve, 120));
          const recipient = document.querySelector('#nmda-import-edit-recipients');
          if (recipient) {
            recipient.value = 'alice.chen@example.edu';
            recipient.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
        const recipient = document.querySelector('#nmda-import-edit-recipients');
        recipient?.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 500));
        document.querySelector('[data-review-key]')?.click();
        await new Promise(resolve => setTimeout(resolve, 180));
      }
      if (view === 'selection') {
        const candidate = document.querySelector('[data-review-email]');
        candidate?.click();
        const recipient = document.querySelector('#nmda-import-edit-recipients');
        if (recipient) {
          recipient.dispatchEvent(new Event('input', { bubbles: true }));
          recipient.dispatchEvent(new Event('change', { bubbles: true }));
        }
        await new Promise(resolve => setTimeout(resolve, 900));
        document.querySelector('#nmda-preview-card')?.scrollIntoView?.({ block: 'start' });
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
