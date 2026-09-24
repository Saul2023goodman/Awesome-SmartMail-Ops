import { useEffect, useSyncExternalStore } from 'react';

const Schedule = globalThis.NMDAWorkspaceScheduleUi;

export default function ScheduleAppliedToast() {
  const {toast} = useSyncExternalStore(Schedule.subscribe,Schedule.getSnapshot);
  useEffect(() => {
    if(!toast)return undefined;
    const id=toast.id;
    const timer=window.setTimeout(() => {
      if(Schedule.getSnapshot().toast?.id===id)Schedule.publishPatch({toast:null});
    },1800);
    return () => window.clearTimeout(timer);
  },[toast]);
  if(!toast)return null;
  return <div className="nmda-plan-motion-toast"><span className="nmda-plan-motion-check" aria-hidden="true">✓</span><span><strong>Plan applied</strong><small>{toast.summary}</small></span></div>;
}
