'use strict';

function runMain(tabId, func, args = []) {
  return chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func,
    args
  }).then(results => results?.[0]?.result || { ok: false, reason: 'no-execution-result' });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (!tabId) {
    sendResponse({ ok: false, reason: 'missing-tab-id' });
    return;
  }

  if (message?.type === 'NMDA_OPEN_COMPOSE') {
    runMain(tabId, () => {
      try {
        if (window.Interface && typeof window.Interface.compose === 'function') {
          window.Interface.compose();
          return { ok: true, method: 'window.Interface.compose' };
        }
        return { ok: false, reason: 'window.Interface.compose unavailable' };
      } catch (error) {
        return { ok: false, reason: error?.message || String(error) };
      }
    }).then(sendResponse).catch(error => sendResponse({ ok: false, reason: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'NMDA_ACCOUNT_INFO') {
    runMain(tabId, () => {
      try {
        const uid = typeof window.$S === 'function' ? (window.$S('uid') || '') : '';
        return { ok: true, uid: String(uid || '') };
      } catch (error) {
        return { ok: false, reason: error?.message || String(error) };
      }
    }).then(sendResponse).catch(error => sendResponse({ ok: false, reason: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'NMDA_OPEN_SENT') {
    runMain(tabId, () => {
      try {
        if (window.$?.Nav?.entry) {
          window.$.Nav.entry('MboxInterface', { fid: 3 });
          return { ok: true, method: '$.Nav.entry', fid: 3 };
        }
        return { ok: false, reason: '$.Nav.entry unavailable' };
      } catch (error) {
        return { ok: false, reason: error?.message || String(error) };
      }
    }).then(sendResponse).catch(error => sendResponse({ ok: false, reason: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'NMDA_READ_SENT') {
    const requested = Number(message.limit || 200);
    const limit = Math.max(1, Math.min(200, Number.isFinite(requested) ? requested : 200));
    runMain(tabId, (limitArg) => new Promise(resolve => {
      try {
        if (!window.$?.DataAction) return resolve({ ok: false, reason: '$.DataAction unavailable' });
        const uid = typeof window.$S === 'function' ? String(window.$S('uid') || '') : '';
        const dataAction = new window.$.DataAction();
        dataAction.wmsvr({
          func: 'mbox:listMessages',
          body: {
            order: 'date',
            desc: true,
            fid: 3,
            summaryWindowSize: 0,
            limit: limitArg,
            skipLockedFolders: true
          },
          call(response) {
            try {
              const items = Array.isArray(response?.var) ? response.var : [];
              const messages = items.map(item => {
                const recipients = [];
                try {
                  const parsed = window.$.Uri?.getEmails?.(String(item?.to || ''));
                  for (const match of parsed?.match || []) {
                    const email = String(match?.address || '').trim().toLowerCase();
                    if (!email) continue;
                    recipients.push({ email, name: String(match?.name || '').trim() });
                  }
                } catch (_) {}

                let sndStatus = item?.sndStatus;
                const flags = item?.flags || {};
                if (typeof sndStatus !== 'number') {
                  const queued = !!flags.rcptQueued, succeeded = !!flags.rcptSucceed, failed = !!flags.rcptFailed;
                  if (queued || succeeded || failed) sndStatus = succeeded ? (failed ? 5 : 1) : (failed ? 4 : 1);
                } else if (sndStatus === 3 && flags.rcptFailed) sndStatus = 4;

                return {
                  id: String(item?.id || item?.mid || ''),
                  subject: String(item?.subject || ''),
                  toRaw: String(item?.to || ''),
                  recipients,
                  sentAt: item?.sentDate ?? item?.date ?? item?.receivedDate ?? '',
                  sndStatus: typeof sndStatus === 'number' ? sndStatus : null,
                  failed: typeof sndStatus === 'number' ? sndStatus > 3 : false
                };
              });
              resolve({ ok: true, uid, total: Number(response?.total || items.length || 0), messages });
            } catch (error) {
              resolve({ ok: false, reason: error?.message || String(error) });
            }
          },
          error(error) {
            resolve({ ok: false, reason: error?.message || error?.code || 'mbox:listMessages failed' });
          },
          ignoreError: true
        });
      } catch (error) {
        resolve({ ok: false, reason: error?.message || String(error) });
      }
    }), [limit]).then(sendResponse).catch(error => sendResponse({ ok: false, reason: error?.message || String(error) }));
    return true;
  }
});
