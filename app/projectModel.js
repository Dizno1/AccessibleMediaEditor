export function createProject(name = "Untitled Project") { return { format: "Open Door Design Accessible Media Editor Project", version: 1, name, path: null, dirty: false, items: [] }; }
export function addItem(project, item, afterId = null) {
  const next = structuredClone(project); const index = afterId ? next.items.findIndex(i => i.id === afterId) : -1;
  if (index >= 0) next.items.splice(index + 1, 0, item); else next.items.push(item);
  next.dirty = true; return next;
}
export function moveItem(project, id, direction) {
  const next = structuredClone(project); const index = next.items.findIndex(i => i.id === id); const target = index + direction;
  if (index < 0 || target < 0 || target >= next.items.length) return project;
  const [item] = next.items.splice(index, 1); next.items.splice(target, 0, item); next.dirty = true; return next;
}
export function removeItem(project, id) { const next = structuredClone(project); const before = next.items.length; next.items = next.items.filter(i => i.id !== id); if (next.items.length !== before) next.dirty = true; return next; }
export function updateItem(project, id, patch) { const next = structuredClone(project); const item = next.items.find(i => i.id === id); if (!item) return project; Object.assign(item, patch); next.dirty = true; return next; }
export function splitItem(project, id, point, newId) {
  const next=structuredClone(project); const index=next.items.findIndex(item=>item.id===id); if(index<0)return project;
  const first=next.items[index]; const start=Number(first.inPoint)||0; const end=first.outPoint==null?Number(first.duration):Number(first.outPoint);
  if(!["Video","Audio"].includes(first.kind)||point<=start||point>=end)return project;
  const second={...structuredClone(first),id:newId,inPoint:point,label:`${first.label||first.name} - Part 2`};
  first.outPoint=point; first.label=`${first.label||first.name} - Part 1`; next.items.splice(index+1,0,second); next.dirty=true; return next;
}
export function itemDuration(item) {
  const sourceDuration = Number(item.duration) || 0;
  if (!["Video", "Audio"].includes(item.kind)) return sourceDuration;
  const start = Math.max(0, Number(item.inPoint) || 0);
  const end = item.outPoint == null ? sourceDuration : Math.min(sourceDuration, Number(item.outPoint));
  return Math.max(0, end - start);
}
export function duration(project) { return project.items.reduce((sum, item) => sum + itemDuration(item), 0); }
export function serializable(project) { const copy = structuredClone(project); delete copy.path; delete copy.dirty; return copy; }
