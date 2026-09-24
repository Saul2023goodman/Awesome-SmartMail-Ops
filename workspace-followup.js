(() => {
  'use strict';

  const Operations = globalThis.NMDAOperations;
  const Runtime = globalThis.NMDAWorkspaceRuntime;
  const State = globalThis.NMDAWorkspaceState;
  const Persistence = globalThis.NMDAWorkspacePersistence;
  const MailboxSync = globalThis.NMDAWorkspaceMailboxSync;

  function validateTemplateBody(value) {
    const body = String(value || '').replace(/\r\n?/g, '\n').trim();
    if (!body) return { valid:true, empty:true, body:'', reason:'' };
    const lines = body.split('\n').map(line => line.trim()).filter(Boolean);
    const first = lines[0] || '', last = lines.at(-1) || '';
    if (/^(?:dear\b|hi\b|hello\b|prof(?:essor)?\.?\b|dr\.?\b|尊敬的|您好)/i.test(first)) {
      return { valid:false, empty:false, body, reason:'称呼会从初始邮件自动带入；模板只填写中间正文。' };
    }
    if (/^(?:best(?:\s+regards)?|kind\s+regards|warm\s+regards|regards|sincerely|yours\s+sincerely|best\s+wishes|many\s+thanks|thank\s+you|谢谢|此致|祝好)[,!，！。]?$/i.test(last)) {
      return { valid:false, empty:false, body, reason:'署名会从初始邮件自动带入；模板只填写中间正文。' };
    }
    return { valid:true, empty:false, body, reason:'' };
  }

  function templateManagedPending(store = State.operations.store) {
    return Object.values(store?.derivedTasks || {}).filter(task => task?.kind === 'follow_up' &&
      !['sent','cancelled','blocked','scheduled'].includes(task.state) &&
      (task.templateManaged === true || (task.templateManaged === undefined && Number(task.contentVersion || 1) === 1)));
  }

  function templateState(value, sync = true) {
    const store = State.operations.store;
    const policy = store.followUpPolicies?.default || Operations.DEFAULT_FOLLOWUP_POLICY;
    const saved = String(policy.templateBody || '').replace(/\r\n?/g, '\n').trim();
    const body = String(value ?? saved).replace(/\r\n?/g, '\n').trim();
    const all = Object.values(store.derivedTasks || {}).filter(task => task?.kind === 'follow_up');
    const protectedCount = all.filter(task => !['sent','cancelled','blocked','scheduled'].includes(task.state) &&
      !(task.templateManaged === true || (task.templateManaged === undefined && Number(task.contentVersion || 1) === 1))).length;
    const lockedCount = all.filter(task => task.state === 'scheduled' &&
      (task.templateManaged === true || (task.templateManaged === undefined && Number(task.contentVersion || 1) === 1))).length;
    const syncable = templateManagedPending(store);
    return { policy, saved, value:body, validation:validateTemplateBody(body), changed:body !== saved,
      syncable, protectedCount, lockedCount, syncEnabled:sync && body !== saved && !!body && syncable.length > 0 };
  }

  async function saveTemplate(value, sync = true) {
    await State.ensureOperations();
    const before = templateState(value, sync);
    if (!before.changed) return { changed:false, refreshedCount:0, protectedCount:0 };
    if (!before.validation.valid) throw new Error(before.validation.reason);
    const result = Operations.setFollowUpPolicy(State.operations.store, '', { templateBody:before.value });
    let store = result.store, refreshedCount = 0, protectedCount = 0;
    if (before.syncEnabled) {
      const refreshed = Operations.refreshTemplateManagedFollowUps(store);
      store = refreshed.store;
      refreshedCount = refreshed.refreshed?.length || 0;
      protectedCount = (refreshed.skipped || []).filter(item => item.reason === 'manually-edited').length;
    }
    State.setStore(store);
    Persistence.writeFollowUpPrefs(Operations.policyForRoot(store, ''));
    return { changed:true, value:before.value, refreshedCount, protectedCount };
  }

  async function savePolicy(values) {
    await State.ensureOperations();
    const result = Operations.setFollowUpPolicy(State.operations.store, '', values);
    State.setStore(result.store);
    Persistence.writeFollowUpPrefs(result.policy);
    return result.policy;
  }

  function templateReason(reason, detail = '') {
    const code = String(reason || '');
    const labels = {
      'template-missing':'未配置跟进邮件模板',
      'initial-outbound-missing':'找不到对应的初始邮件发送记录',
      'initial-provider-id-missing':'无法定位对应的初始邮件',
      'sent-read-unavailable':'当前 163 页面无法调用邮件读取接口',
      'sent-read-failed':'读取初始邮件正文失败',
      'sent-read-empty':'未读取到初始邮件内容',
      'sent-readhtml-url-unavailable':'暂时无法读取初始邮件正文',
      'sent-readhtml-failed':'读取初始邮件正文失败',
      'sent-readhtml-parse-failed':'已打开初始邮件，但未能识别正文',
      'initial-body-missing':'尚未读取到初始邮件正文',
      'salutation-and-signature-missing':'初始邮件中未识别到称呼和署名',
      'salutation-missing':'初始邮件中未识别到称呼',
      'signature-missing':'初始邮件中未识别到署名'
    };
    const base = labels[code] || code || '无法生成跟进邮件';
    return detail ? `${base}：${detail}` : base;
  }

  async function hydrateInitialContent(rootTaskIds = []) {
    await State.ensureOperations();
    const roots = [...new Set(rootTaskIds.map(value => String(value || '').trim()).filter(Boolean))];
    const remote = [];
    for (const rootTaskId of roots) {
      let initial = Operations.initialOutboundForRoot(State.operations.store, rootTaskId);
      if (!initial || String(initial.body || '').trim()) continue;
      const local = State.batch.tasks.find(task => String(task.editKey || task.id || '') === rootTaskId && String(task.body || '').trim());
      if (local) {
        const updated = Operations.setOutboundContentSnapshot(State.operations.store, initial.id, {
          body:local.body || '', bodyHtml:local.bodyHtml || '', bodyIsHtml:!!local.bodyIsHtml, source:'initial-task'
        });
        State.setStore(updated.store);
        initial = updated.record;
      }
      if (String(initial?.body || '').trim()) continue;
      if (!String(initial?.providerMessageId || '').trim()) {
        State.setStore(Operations.setOutboundContentReadFailure(State.operations.store, initial.id,
          'initial-provider-id-missing', '无法定位 163 已发送邮件详情').store);
        continue;
      }
      remote.push({ rootTaskId, outboundId:initial.id, providerMessageId:String(initial.providerMessageId) });
    }
    if (remote.length) {
      const response = await Runtime.readSentDetails(remote.map(item => item.providerMessageId));
      if (!response?.ok) throw new Error(response?.reason || '读取初始邮件正文失败。');
      const byId = new Map((response.details || []).map(item => [String(item?.id || ''), item]));
      for (const item of remote) {
        const detail = byId.get(item.providerMessageId);
        if (!detail) State.setStore(Operations.setOutboundContentReadFailure(State.operations.store, item.outboundId,
          'sent-read-failed', '未找到对应的已发送邮件').store);
        else if (!detail.ok) State.setStore(Operations.setOutboundContentReadFailure(State.operations.store, item.outboundId,
          String(detail.reasonCode || 'sent-read-failed'), detail.reason || '').store);
        else State.setStore(Operations.setOutboundContentSnapshot(State.operations.store, item.outboundId, {
          body:detail.body, bodyHtml:detail.bodyHtml || '', isHtml:detail.isHtml === true,
          source:`sent-message-detail:${detail.bodySource}`
        }).store);
      }
    }
    return roots.map(rootTaskId => {
      const rendered = Operations.renderFollowUpTemplate(State.operations.store, rootTaskId);
      return { rootTaskId, rendered, reasonText:rendered?.ok ? '' : templateReason(rendered?.reason, rendered?.reasonDetail) };
    });
  }

  async function createFollowUp(rootTaskId, manual = false) {
    await State.ensureOperations();
    const policy = Operations.policyForRoot(State.operations.store, rootTaskId);
    if (!String(policy.templateBody || '').trim()) throw new Error('请先设置跟进邮件正文模板。');
    const hydrated = await hydrateInitialContent([rootTaskId]);
    const ready = hydrated[0];
    if (!ready?.rendered?.ok) throw new Error(`无法模板生成：${ready?.reasonText || templateReason(ready?.rendered?.reason, ready?.rendered?.reasonDetail)}`);
    const created = Operations.createFollowUpTask(State.operations.store, rootTaskId, { manual });
    State.setStore(created.store);
    return created.task;
  }

  async function createFollowUps(rootTaskIds) {
    await State.ensureOperations();
    const policy = State.operations.store.followUpPolicies?.default || Operations.DEFAULT_FOLLOWUP_POLICY;
    if (!String(policy.templateBody || '').trim()) throw new Error('请先设置跟进邮件正文模板，再批量准备联系人跟进。');
    const hydrated = await hydrateInitialContent(rootTaskIds);
    const readyRoots = hydrated.filter(item => item.rendered?.ok).map(item => item.rootTaskId);
    const skipped = hydrated.filter(item => !item.rendered?.ok).map(item => ({
      rootTaskId:item.rootTaskId, reason:item.rendered?.reason || 'initial-body-missing', reasonText:item.reasonText
    }));
    const result = Operations.createFollowUpTasks(State.operations.store, readyRoots);
    State.setStore(result.store);
    return { created:result.created, skipped:[...skipped, ...(result.skipped || []).map(item => ({ ...item, reasonText:templateReason(item.reason) }))] };
  }

  async function cancelFollowUp(taskId) {
    await State.ensureOperations();
    const task = State.operations.store.derivedTasks?.[taskId];
    if (!task) return null;
    State.setStore(Operations.setDerivedTaskState(State.operations.store, taskId, 'cancelled').store);
    return task;
  }

  async function setReplyDisposition(replyId, disposition) {
    await State.ensureOperations();
    State.setStore(Operations.setReplyObservationDisposition(State.operations.store, replyId, disposition).store);
  }

  async function syncMailbox(mode = 'quick') {
    await MailboxSync.request(mode === 'full' ? 'full' : 'quick', { source:'monitor-manual', force:true });
    const Domain = globalThis.NMDAMonitorDomain;
    return Domain.monitorSummary(Operations.monitoringRoots(State.operations.store).map(group => ({ ...group, viewState:Domain.monitorGroupState(group) })));
  }

  globalThis.NMDAWorkspaceFollowUp = Object.freeze({
    validateTemplateBody, templateManagedPending, templateState, saveTemplate, savePolicy,
    templateReason, hydrateInitialContent, createFollowUp, createFollowUps, cancelFollowUp,
    setReplyDisposition, syncMailbox
  });
})();
