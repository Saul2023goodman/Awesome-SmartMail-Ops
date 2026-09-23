import { useLayoutEffect, useSyncExternalStore } from 'react';

const Navigation = globalThis.NMDAWorkspaceNavigation;
const View = globalThis.NMDAWorkspaceView;
const FLOW = [
  ['batch','准备邮件','资料 · 查重 · 附件','batch'],
  ['review','审阅邮件','初始 · 跟进 · 就绪','review'],
  ['dispatch','安排发送','范围 · 时间 · 创建','dispatch']
];
const OPERATIONS = [
  ['dashboard','成效','触达 · 争取 · 往来','source'],
  ['utilities','工具','监测 · 附件','batch']
];
const HEADS = {
  batch:['准备邮件','加入资料，完成查重与附件准备。'],
  review:['审阅邮件','检查收件人、主题、正文与附件，确认可以发送。'],
  dispatch:['安排发送','选择本次邮件，安排发送时间并创建草稿。'],
  dashboard:['成效','按联系人查看触达、持续争取与真实沟通。'],
  utilities:['工具','处理联系人跟进与草稿维护。']
};

export function useWorkspaceNavigation() {
  return useSyncExternalStore(Navigation.subscribe, Navigation.getSnapshot);
}

function Tab({ item, active, reviewCount }) {
  const [tab, title, detail, icon] = item;
  return <button className={`nmda-tab${active ? ' is-active' : ''}`} data-tab={tab} type="button" title={title}
    onClick={() => window.dispatchEvent(new CustomEvent('nmda:tab-click', { detail:tab }))}>
    <span className="nmda-tab-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html:View.iconSvg(icon) }}></span>
    <span><strong>{title}</strong><small>{detail}</small></span>
    {tab === 'review' && reviewCount > 0 && <b className="nmda-tab-count">{reviewCount}</b>}
  </button>;
}

export function WorkspaceTabs() {
  const { tab, reviewCount } = useWorkspaceNavigation();
  useLayoutEffect(() => {
    document.querySelectorAll('.nmda-tabpane').forEach(pane => { pane.hidden = pane.dataset.pane !== tab; });
  }, [tab]);
  return <nav className="nmda-tabs" aria-label="SmartMail 导航">
    <div className="nmda-nav-group" role="group" aria-label="邮件流程"><span className="nmda-nav-section-label">流程</span>{FLOW.map(item => <Tab item={item} active={tab === item[0]} reviewCount={reviewCount} key={item[0]} />)}</div>
    <div className="nmda-nav-group is-secondary" role="group" aria-label="运营与工具"><span className="nmda-nav-section-label">运营</span>{OPERATIONS.map(item => <Tab item={item} active={tab === item[0]} key={item[0]} />)}</div>
  </nav>;
}

export function WorkspacePageHeads() {
  const { tab } = useWorkspaceNavigation();
  return Object.entries(HEADS).map(([name, [title, detail]]) => <div className="nmda-page-head" data-page-head={name} hidden={name !== tab} key={name}><div><h2>{title}</h2><p>{detail}</p></div></div>);
}
