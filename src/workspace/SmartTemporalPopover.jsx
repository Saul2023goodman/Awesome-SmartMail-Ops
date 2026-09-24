import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';

const Temporal = globalThis.NMDAWorkspaceSmartTemporalUi;
const send = (action, detail = {}) => window.dispatchEvent(new CustomEvent('nmda:smart-temporal-action',{detail:{action,...detail}}));

export default function SmartTemporalPopover() {
  const model = useSyncExternalStore(Temporal.subscribe,Temporal.getSnapshot);
  const popoverRef = useRef(null);
  useLayoutEffect(() => {
    if(model.visible)send('measure',{height:popoverRef.current?.offsetHeight||180});
  },[model.visible,model.presets]);
  return <div id="nmda-smart-temporal-popover" className="nmda-smart-temporal-popover" hidden={!model.visible} style={model.position} ref={popoverRef}>
    <div className="nmda-smart-temporal-pophead"><div><small>快捷时间</small><strong data-smart-temporal-title>{model.title}</strong></div><button type="button" data-smart-temporal-close aria-label="关闭" onClick={() => send('close')}>×</button></div>
    <div className="nmda-smart-temporal-presets" data-smart-temporal-presets>{model.presets.map((preset,index)=><button className={`${preset.accent?'is-accent ':''}${preset.clear?'is-clear':''}`.trim()} type="button" data-smart-temporal-value={preset.value} key={`${preset.label}-${index}`} onClick={() => send('preset',{value:preset.value})}>{preset.label}</button>)}</div>
    <div className="nmda-smart-temporal-popfoot"><span>可直接输入，也可打开日期时间选择器</span><button type="button" data-smart-temporal-native hidden={!model.showNative} onClick={() => send('native')}>打开选择器</button></div>
  </div>;
}
