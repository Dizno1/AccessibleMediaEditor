export function createProject(name = "Untitled Project") { return { format: "Open Door Design Accessible Media Editor Project", version: 2, name, path: null, dirty: false, items: [], sources: [] }; }
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
export function addSource(project, item) { const next = structuredClone(project); next.sources = next.sources || []; next.sources.push(item); next.dirty = true; return next; }
export function removeSource(project, id) { const next = structuredClone(project); next.sources = (next.sources || []).filter(item => item.id !== id); next.dirty = true; return next; }
export function updateSource(project, id, patch) { const next = structuredClone(project); const item = (next.sources || []).find(source => source.id === id); if (!item) return project; Object.assign(item, patch); next.dirty = true; return next; }
export function makeSourcePrimary(project, sourceId) {
  if (!project.items.length) return project;
  const sourceIndex = (project.sources || []).findIndex(item => item.id === sourceId);
  if (sourceIndex < 0) return project;
  const next = structuredClone(project);
  const oldPrimary = { ...next.items[0], role: "source" };
  const newPrimary = { ...next.sources[sourceIndex], role: "primary" };
  next.items[0] = newPrimary;
  next.sources[sourceIndex] = oldPrimary;
  next.dirty = true;
  return next;
}
export function appendSourceSelection(project, source, newId) {
  const next = structuredClone(project); const copy = structuredClone(source);
  copy.id = newId; copy.role = "inserted"; copy.label = `${source.label || source.name} - selection`;
  next.items.push(copy); next.dirty = true; return next;
}
export function insertSourceSelection(project, targetId, point, source, firstId, insertedId, secondId) {
  const next = structuredClone(project); const index = next.items.findIndex(item => item.id === targetId); if (index < 0) return project;
  const target = next.items[index]; const start = Number(target.inPoint) || 0; const end = target.outPoint == null ? Number(target.duration) : Number(target.outPoint);
  if (!["Video", "Audio"].includes(target.kind) || point < start || point > end) return project;
  const inserted = {...structuredClone(source), id: insertedId, role: "inserted", label: `${source.label || source.name} - selection`};
  if (point === start) next.items.splice(index, 0, inserted);
  else if (point === end) next.items.splice(index + 1, 0, inserted);
  else {
    const first = {...structuredClone(target), id: firstId, outPoint: point, label: `${target.label || target.name} - Part 1`};
    const second = {...structuredClone(target), id: secondId, inPoint: point, label: `${target.label || target.name} - Part 2`};
    next.items.splice(index, 1, first, inserted, second);
  }
  next.dirty = true; return next;
}
export function splitItem(project, id, point, newId) {
  const next=structuredClone(project); const index=next.items.findIndex(item=>item.id===id); if(index<0)return project;
  const first=next.items[index]; const start=Number(first.inPoint)||0; const end=first.outPoint==null?Number(first.duration):Number(first.outPoint);
  if(!["Video","Audio"].includes(first.kind)||point<=start||point>=end)return project;
  const second={...structuredClone(first),id:newId,inPoint:point,label:`${first.label||first.name} - Part 2`};
  first.outPoint=point; first.label=`${first.label||first.name} - Part 1`; next.items.splice(index+1,0,second); next.dirty=true; return next;
}
export function normalizedSegments(item) {
  const sourceDuration = Math.max(0, Number(item?.duration) || 0);
  if (!sourceDuration) return [];
  if (Array.isArray(item.editSegments) && item.editSegments.length) {
    return item.editSegments
      .map(segment => ({ start: Math.max(0, Number(segment.start) || 0), end: Math.min(sourceDuration, Number(segment.end) || 0) }))
      .filter(segment => segment.end > segment.start);
  }
  const start = Math.max(0, Number(item.inPoint) || 0);
  const end = item.outPoint == null ? sourceDuration : Math.min(sourceDuration, Number(item.outPoint));
  return end > start ? [{ start, end }] : [];
}
export function logicalDuration(item) {
  return normalizedSegments(item).reduce((sum, segment) => sum + segment.end - segment.start, 0);
}
export function logicalToSourceTime(item, logicalTime) {
  const segments = normalizedSegments(item);
  let remaining = Math.max(0, Math.min(logicalDuration(item), Number(logicalTime) || 0));
  for (const segment of segments) {
    const length = segment.end - segment.start;
    if (remaining <= length) return Math.min(segment.end, segment.start + remaining);
    remaining -= length;
  }
  return segments.at(-1)?.end || 0;
}
export function sourceToLogicalTime(item, sourceTime) {
  const segments = normalizedSegments(item);
  const source = Math.max(0, Number(sourceTime) || 0);
  let logical = 0;
  for (const segment of segments) {
    if (source < segment.start) return logical;
    if (source <= segment.end) return logical + source - segment.start;
    logical += segment.end - segment.start;
  }
  return logical;
}
export function removeLogicalRange(project, id, start, end, sourceCollection = false) {
  const next = structuredClone(project);
  const collection = sourceCollection ? (next.sources || []) : next.items;
  const item = collection.find(value => value.id === id);
  if (!item) return project;
  const total = logicalDuration(item);
  const from = Math.max(0, Math.min(total, Number(start) || 0));
  const to = Math.max(from, Math.min(total, Number(end) || 0));
  if (to <= from || (from === 0 && to === total)) return project;
  const retained = [];
  let logicalStart = 0;
  for (const segment of normalizedSegments(item)) {
    const length = segment.end - segment.start;
    const logicalEnd = logicalStart + length;
    if (from > logicalStart) retained.push({ start: segment.start, end: segment.start + Math.min(length, from - logicalStart) });
    if (to < logicalEnd) retained.push({ start: segment.start + Math.max(0, to - logicalStart), end: segment.end });
    logicalStart = logicalEnd;
  }
  item.editSegments = retained.filter(segment => segment.end > segment.start);
  item.inPoint = 0;
  item.outPoint = logicalDuration(item);
  item.workingSource = null;
  next.dirty = true;
  return next;
}
export function itemDuration(item) {
  const sourceDuration = Number(item.duration) || 0;
  if (!["Video", "Audio"].includes(item.kind)) return sourceDuration;
  if (Array.isArray(item.editSegments) && item.editSegments.length) return logicalDuration(item);
  const start = Math.max(0, Number(item.inPoint) || 0);
  const end = item.outPoint == null ? sourceDuration : Math.min(sourceDuration, Number(item.outPoint));
  return Math.max(0, end - start);
}
export function duration(project) { return project.items.reduce((sum, item) => sum + itemDuration(item), 0); }
export function bracketSelectionRange(totalDuration, leftBracket = null, rightBracket = null) {
  const total = Math.max(0, Number(totalDuration) || 0);
  const left = leftBracket == null ? null : Math.max(0, Math.min(total, Number(leftBracket) || 0));
  const right = rightBracket == null ? null : Math.max(0, Math.min(total, Number(rightBracket) || 0));
  if (left != null && right != null) return { from: Math.min(left, right), to: Math.max(left, right), kind: "between" };
  if (left != null) return { from: left, to: total, kind: "ending" };
  if (right != null) return { from: 0, to: right, kind: "beginning" };
  return null;
}
export function bracketSelectionPlan(totalDuration, leftBracket = null, rightBracket = null) {
  const total = Math.max(0, Number(totalDuration) || 0);
  const left = leftBracket == null ? null : Math.max(0, Math.min(total, Number(leftBracket) || 0));
  const right = rightBracket == null ? null : Math.max(0, Math.min(total, Number(rightBracket) || 0));
  if (left == null && right == null) return null;
  if (left != null && right == null) return { kind: "ending", selectedRanges: [{ from: left, to: total }] };
  if (left == null && right != null) return { kind: "beginning", selectedRanges: [{ from: 0, to: right }] };
  if (left === right) return { kind: "empty", selectedRanges: [] };
  if (left < right) return { kind: "inside", selectedRanges: [{ from: left, to: right }], unselectedRange: null };
  return { kind: "outside", selectedRanges: [{ from: 0, to: right }, { from: left, to: total }], unselectedRange: { from: right, to: left } };
}
export function logicalSegmentsForRanges(item, ranges) {
  const output = [];
  for (const range of ranges) {
    const from = Math.max(0, Number(range.from) || 0);
    const to = Math.max(from, Number(range.to) || 0);
    let logical = 0;
    for (const segment of normalizedSegments(item)) {
      const length = segment.end - segment.start;
      const start = Math.max(from, logical);
      const end = Math.min(to, logical + length);
      if (end > start) output.push({ start: segment.start + start - logical, end: segment.start + end - logical });
      logical += length;
    }
  }
  return output;
}
export function removeLogicalRanges(project, id, ranges, sourceCollection = false) {
  return [...ranges]
    .sort((a, b) => b.from - a.from)
    .reduce((current, range) => removeLogicalRange(current, id, range.from, range.to, sourceCollection), project);
}
export function serializable(project) { const copy = structuredClone(project); delete copy.path; delete copy.dirty; return copy; }
