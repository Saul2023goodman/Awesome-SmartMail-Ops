(() => {
  'use strict';

  function recipientText(recipients = []) {
    return (recipients || []).map(item => item?.name ? `${item.name} <${item.email}>` : item?.email).filter(Boolean).join('; ');
  }

  function followUpTaskToDispatch(task, store) {
    if (!task || task.kind !== 'follow_up') return null;
    const parent = store?.outboundRecords?.[task.parentOutboundId] || null;
    const dispatch = task.dispatch || {};
    const confirmed = Number(task.confirmedVersion) === Number(task.contentVersion);
    const reviewed = !!task.reviewedAt && confirmed;
    const blocked = task.state === 'blocked' || !!task.blocker;
    const done = !!task.draftPreparedAt;
    const errors = [];
    if (!reviewed) errors.push('Follow-up 尚未通过邮件审阅规则');
    if (blocked) errors.push(task.blocker?.kind === 'human' ? '收到真人回复' : task.blocker?.type === 'recipient-guard' ? '联系规则阻断' : '回复状态需要处理');
    if ((task.composeMode === 'forward' || task.composeMode === 'reply') && !parent?.providerMessageId) errors.push('原始 Sent 邮件缺少 provider message id');
    const recipients = recipientText(task.recipients || []);
    if (!recipients) errors.push('缺少收件人');
    if (!String(task.body || '').trim()) errors.push('缺少正文');
    if (task.composeMode === 'new' && !String(task.subject || '').trim()) errors.push('缺少主题');
    const status = done ? 'done' : errors.length ? 'error' : 'ready';
    return {
      id: task.id,
      editKey: task.id,
      dispatchKind: 'follow_up',
      kind: 'follow_up',
      rootTaskId: task.rootTaskId,
      parentTaskId: task.parentTaskId,
      parentOutboundId: task.parentOutboundId,
      parentMessageId: parent?.providerMessageId || '',
      parentFid: 3,
      sequence: Number(task.sequence || 0),
      recipients,
      school: String(task.school || parent?.school || ''),
      subject: String(task.subject || parent?.subject || ''),
      body: String(task.body || ''),
      composeMode: task.composeMode || 'forward',
      contentVersion: Number(task.contentVersion || 1),
      confirmedVersion: task.confirmedVersion == null ? null : Number(task.confirmedVersion),
      enabled: dispatch.enabled !== false,
      policyBlocked: blocked,
      policyReasons: blocked ? errors.slice() : [],
      files: [],
      tags: [],
      scheduleAt: String(dispatch.scheduleAt || ''),
      scheduleSource: String(dispatch.scheduleSource || ''),
      scheduleReason: String(dispatch.scheduleReason || ''),
      status,
      runtimeError: String(task.runtimeError || ''),
      note: '',
      errors,
      warnings: [],
      sourceKind: 'follow-up',
      _sourceTaskId: task.id,
      _searchStatic: [recipients, task.subject, task.body, `Follow-up ${task.sequence || ''}`].join(' ').toLocaleLowerCase('zh-CN')
    };
  }

  function buildQueue(initialTasks = [], store = null) {
    const initial = (initialTasks || []).filter(Boolean).map(task => ({ ...task, dispatchKind: 'initial' }));
    const followUps = store && globalThis.NMDAOperations?.queuedDerivedTasks
      ? globalThis.NMDAOperations.queuedDerivedTasks(store).map(task => followUpTaskToDispatch(task, store)).filter(Boolean)
      : [];
    return [...initial, ...followUps];
  }

  function sourceCounts(tasks = []) {
    let initial = 0, followUp = 0;
    for (const task of tasks || []) task?.dispatchKind === 'follow_up' ? followUp++ : initial++;
    return { initial, followUp, total: initial + followUp };
  }

  globalThis.NMDADispatch = { recipientText, followUpTaskToDispatch, buildQueue, sourceCounts };
})();
