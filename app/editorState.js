export function clearEditorMarks(state) {
  if (!state) return false;
  const changed=state.markIn!=null||state.markOut!=null||Boolean(state.markHistory?.length);
  state.markIn=null;
  state.markOut=null;
  state.markHistory=[];
  return changed;
}

export function preserveMarksWhileChangingTarget(state, target) {
  if (!state || !["audio", "video", "both"].includes(target)) return false;
  state.trackTarget=target;
  return true;
}

export function replacementDurationIssue(copiedDuration, destinationDuration) {
  const copied=Math.max(0,Number(copiedDuration)||0);
  if (destinationDuration == null) return null;
  const destination=Math.max(0,Number(destinationDuration)||0);
  const excess=copied-destination;
  return excess>0.0005 ? {copied,destination,excess} : null;
}

export function primaryPasteOperation(selectionPlan) {
  if (!selectionPlan || selectionPlan.kind === "empty") return "insert";
  return selectionPlan.selectedRanges?.length === 1 ? "replace" : "reject";
}
