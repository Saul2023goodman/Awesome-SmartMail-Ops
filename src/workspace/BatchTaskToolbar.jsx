import { useSyncExternalStore } from 'react';

const Filter = globalThis.NMDAWorkspaceBatchFilterUi;
const send = (action, detail = {}) => window.dispatchEvent(new CustomEvent('nmda:batch-filter-action',{detail:{action,...detail}}));

export default function BatchTaskToolbar() {
  const {query,locked} = useSyncExternalStore(Filter.subscribe,Filter.getSnapshot);
  return <>
    <label className="nmda-search-field"><input id="nmda-batch-search" type="search" value={query} onChange={event => send('search',{value:event.target.value})} placeholder="搜索收件人 / 学校 / 邮箱" /></label>
    <button className="nmda-btn nmda-btn-small" id="nmda-bulk-enable" type="button" disabled={locked} onClick={() => send('enable-filtered')}>纳入筛选结果</button>
    <button className="nmda-btn nmda-btn-small nmda-btn-quiet" id="nmda-clear-selection" type="button" disabled={locked} onClick={() => send('clear-selection')}>排除全部</button>
  </>;
}
