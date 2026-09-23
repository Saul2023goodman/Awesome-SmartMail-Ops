(() => {
  'use strict';

  const Operations = globalThis.NMDAOperations;
  const Persistence = globalThis.NMDAWorkspacePersistence;

  async function readDedupeHistory(store) {
    const historyMonths = Persistence.readHistoryMonths();
    const result = await chrome.runtime.sendMessage({ type:'NMDA_READ_DEDUPE_HISTORY', historyMonths });
    if (!result?.ok) throw new Error(`${result?.phase ? `${result.phase}：` : ''}${result?.reason || '邮箱历史读取失败'}`);
    if (!result.complete || !result.sent?.complete || !result.drafts?.complete) {
      throw new Error('已发送或草稿箱未完整读取，拒绝将不完整结果用于导入查重。');
    }
    return Operations.ingestMailboxDedupeSnapshot(store, result.sent.messages || [], result.drafts.messages || [], {
      complete:true,
      historyMonths:Number(result.historyMonths ?? historyMonths) || 0,
      historyCutoffAt:String(result.cutoffAt || ''),
      sentCoverage:result.coverage?.sent || { read:result.sent.messages?.length || 0, total:result.sent.total || 0, complete:true, pages:result.sent.pages || 0 },
      draftCoverage:result.coverage?.drafts || { read:result.drafts.messages?.length || 0, total:result.drafts.total || 0, complete:true, pages:result.drafts.pages || 0 }
    });
  }

  async function readOperations(store, mode = 'quick') {
    const full = mode === 'full';
    const historyMonths = Persistence.readHistoryMonths();
    const result = await chrome.runtime.sendMessage({ type:'NMDA_READ_MAILBOX_STATE', mode:full ? 'full' : 'quick', historyMonths });
    if (!result?.ok) throw new Error(`${result?.phase ? `${result.phase}：` : ''}${result?.reason || '邮箱读取失败'}`);
    const sent = result.sent || {}, drafts = result.drafts || {}, inbox = result.inbox || {};
    if (full && (!sent.complete || !drafts.complete || !inbox.complete)) {
      throw new Error('完整邮箱快照未完成，拒绝覆盖 operation store。');
    }
    return Operations.ingestMailboxSnapshot(store, sent.messages || [], drafts.messages || [], inbox.messages || [], {
      mode:full ? 'full' : 'quick', complete:full,
      historyMonths:Number(result.historyMonths ?? historyMonths) || 0,
      historyCutoffAt:String(result.cutoffAt || ''),
      sentCoverage:result.coverage?.sent || { read:sent.messages?.length || 0, total:sent.total || 0, complete:!!sent.complete, pages:sent.pages || 0 },
      draftCoverage:result.coverage?.drafts || { read:drafts.messages?.length || 0, total:drafts.total || 0, complete:!!drafts.complete, pages:drafts.pages || 0 },
      inboxCoverage:result.coverage?.inbox || { read:inbox.messages?.length || 0, total:inbox.total || 0, complete:!!inbox.complete, pages:inbox.pages || 0 }
    });
  }

  globalThis.NMDAMailboxOperations = Object.freeze({ readDedupeHistory, readOperations });
})();
