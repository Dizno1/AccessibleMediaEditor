export function clearEditorMarks(state) {
  if (!state) return false;
  const changed=state.markIn!=null||state.markOut!=null||Boolean(state.markHistory?.length);
  state.markIn=null;
  state.markOut=null;
  state.markHistory=[];
  return changed;
}
