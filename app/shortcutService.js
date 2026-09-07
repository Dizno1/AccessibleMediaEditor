const handlers = new Map();
const shortcuts = [
  ["newProject", {ctrl:true,key:"n"}], ["openProject", {ctrl:true,key:"o"}], ["saveProject", {ctrl:true,key:"s"}],
  ["saveProjectAs", {ctrl:true,shift:true,key:"s"}], ["importMedia", {ctrl:true,key:"i"}],
  ["moveEarlier", {ctrl:true,key:"arrowup"}], ["moveLater", {ctrl:true,key:"arrowdown"}],
  ["properties", {alt:true,key:"enter"}], ["removeItem", {key:"delete"}], ["preview", {ctrl:true,key:"p"}], ["stop", {key:"escape"}]
];
export function registerAction(name, handler) { handlers.set(name, handler); }
export function triggerAction(name) { const handler = handlers.get(name); return handler ? handler() : undefined; }
function editable(target) { const tag = target?.tagName?.toLowerCase(); return tag === "textarea" || (tag === "input" && target.type !== "range") || target?.isContentEditable; }
export function initShortcuts() {
  window.addEventListener("keydown", event => {
    if (editable(event.target) && event.key !== "Escape") return;
    const key = event.key.toLowerCase();
    const match = shortcuts.find(([, c]) => key === c.key && !!event.ctrlKey === !!c.ctrl && !!event.altKey === !!c.alt && !!event.shiftKey === !!c.shift);
    if (!match) return; event.preventDefault(); triggerAction(match[0]);
  }, true);
}
