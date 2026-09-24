import { useSyncExternalStore } from 'react';

const Planning = globalThis.NMDAWorkspacePlanningUi;

export default function DispatchEmpty() {
  const {dispatchEmpty:model} = useSyncExternalStore(Planning.subscribe,Planning.getSnapshot);
  return <div className="nmda-batch-empty" id="nmda-batch-empty" hidden={!model.visible}>
    <div className="nmda-card-kicker">{model.kicker}</div>
    <div className="nmda-card-title">{model.title}</div>
    <div className="nmda-card-desc">{model.description}</div>
  </div>;
}
