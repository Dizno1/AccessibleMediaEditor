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
export function duration(project) { return project.items.reduce((sum, item) => sum + (Number(item.duration) || 0), 0); }
export function serializable(project) { const copy = structuredClone(project); delete copy.path; delete copy.dirty; return copy; }
