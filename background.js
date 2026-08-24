'use strict';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'NMDA_OPEN_COMPOSE') return;

  const tabId = sender.tab?.id;
  if (!tabId) {
    sendResponse({ ok: false, reason: 'missing-tab-id' });
    return;
  }

  chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      try {
        if (window.Interface && typeof window.Interface.compose === 'function') {
          // 网易 p0 bundle 自己公开给页面模块使用的写信入口。无参数调用等价于“新建写信”。
          window.Interface.compose();
          return { ok: true, method: 'window.Interface.compose' };
        }
        return { ok: false, reason: 'window.Interface.compose unavailable' };
      } catch (error) {
        return { ok: false, reason: error?.message || String(error) };
      }
    }
  }).then(results => {
    sendResponse(results?.[0]?.result || { ok: false, reason: 'no-execution-result' });
  }).catch(error => {
    sendResponse({ ok: false, reason: error?.message || String(error) });
  });

  return true;
});
