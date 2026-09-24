import { useSyncExternalStore } from 'react';

const importUi = globalThis.NMDAWorkspaceImportUi;
const iconSvg = globalThis.NMDAWorkspaceView.iconSvg;
const iconNames = { W:'doc', '{}':'code', '¶':'text', '≡':'text', '<>':'code', XML:'code', ZIP:'archive', '▦':'table', '◇':'source' };

export default function SourceInventory() {
  const { inventory } = useSyncExternalStore(importUi.subscribe, importUi.getSnapshot);
  if (!inventory.visible) return null;
  return <div id="nmda-source-inventory" className="nmda-source-inventory">
    <details className="nmda-source-inventory-details">
      <summary><span><strong>导入详情</strong><small>{inventory.summary}</small></span><span className="nmda-source-inventory-open">查看</span></summary>
      {!!inventory.containerNames && <div className="nmda-source-container-note"><span>ZIP</span><div><strong>{inventory.containerNames}</strong><small>已自动展开；资料包只是容器，不参与“邮件 / 总名单 / 附件”用途选择。</small></div></div>}
      <div className="nmda-source-list">{inventory.rows.length ? inventory.rows.map((row, index) => <div className="nmda-source-item" key={`${row.name}:${index}`}>
        <div className="nmda-source-item-icon" dangerouslySetInnerHTML={{__html:iconSvg(iconNames[row.icon] || 'source')}} />
        <div className="nmda-source-item-main"><strong title={row.name}>{row.name}</strong><small>{row.format} · {row.size}{row.decision}</small></div>
        <span className="nmda-source-purpose" data-purpose={row.purpose}>{row.roleText}</span><span className="nmda-source-item-index">{index+1}</span>
      </div>) : <div className="nmda-source-item"><div className="nmda-source-item-icon" dangerouslySetInnerHTML={{__html:iconSvg('source')}} /><div className="nmda-source-item-main"><strong>粘贴内容</strong><small>{inventory.fallbackFormat}</small></div></div>}</div>
      {!!inventory.duplicateCount && <div className="nmda-source-detail-note is-dedupe">检测到 {inventory.duplicateCount} 个内容完全相同的重复来源，已在解析前自动合并，不会进入邮件查重。</div>}
      {!!inventory.embeddedCount && <div className="nmda-source-detail-note">已从资料包中加入 {inventory.embeddedCount} 个附件文件。</div>}
      {!!inventory.warnings.length && <details className="nmda-ingest-warnings"><summary>读取细节（{inventory.warnings.length}）</summary>{inventory.warnings.slice(0,20).map((warning,index) => <div key={index}>{warning}</div>)}{inventory.warnings.length > 20 && <div>另有 {inventory.warnings.length-20} 条未展开。</div>}</details>}
    </details>
  </div>;
}
