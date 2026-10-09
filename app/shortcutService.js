const handlers = new Map();
const shortcuts = [
  ["newProject", {ctrl:true,key:"n"}], ["openProject", {ctrl:true,shift:true,key:"o"}], ["saveProject", {ctrl:true,key:"s"}],
  ["saveProjectAs", {ctrl:true,shift:true,key:"s"}], ["importMedia", {ctrl:true,key:"o"}],
  ["moveEarlier", {ctrl:true,key:"arrowup"}], ["moveLater", {ctrl:true,key:"arrowdown"}],
  ["properties", {alt:true,key:"enter"}], ["removeItem", {key:"delete"}], ["preview", {ctrl:true,key:"p"}], ["cancel", {key:"escape"}],
  ["playPause", {key:"x"}], ["audition", {key:" "}],
  ["targetBoth", {key:"b"}], ["targetVideo", {key:"v"}], ["targetAudio", {key:"a"}],
  ["setIn", {key:"["}], ["setOut", {key:"]"}],
  ["scrubBack1", {key:"u"}], ["scrubForward1", {key:"i"}],
  ["scrubBack100ms", {shift:true,key:"u"}], ["scrubForward100ms", {shift:true,key:"i"}],
  ["scrubBack10ms", {ctrl:true,shift:true,key:"u"}], ["scrubForward10ms", {ctrl:true,shift:true,key:"i"}],
  ["moveBack5", {key:"arrowleft"}], ["moveForward5", {key:"arrowright"}],
  ["moveBack30", {shift:true,key:"arrowleft"}], ["moveForward30", {shift:true,key:"arrowright"}],
  ["moveBack300", {key:"j"}], ["moveForward300", {key:"l"}],
  ["nudgeBack", {alt:true,key:"arrowleft"}], ["nudgeForward", {alt:true,key:"arrowright"}],
  ["jumpBeginning", {key:"home"}], ["jumpEnd", {key:"end"}],
  ["goToTime", {ctrl:true,key:"g"}], ["split", {ctrl:true,key:"k"}],
  ["previousSection", {ctrl:true,key:"pageup"}], ["nextSection", {ctrl:true,key:"pagedown"}],
  ["previousWorkspace", {ctrl:true,shift:true,key:"tab"}], ["nextWorkspace", {ctrl:true,key:"tab"}]
];
export function registerAction(name, handler) { handlers.set(name, handler); }
export function triggerAction(name) { const handler = handlers.get(name); return handler ? handler() : undefined; }
function editable(target) { const tag = target?.tagName?.toLowerCase(); return tag === "textarea" || (tag === "input" && target.type !== "range") || target?.isContentEditable; }
function spaceActivatesControl(target) { return ["button","select","option"].includes(target?.tagName?.toLowerCase()); }
export function initShortcuts() {
  window.addEventListener("keydown", event => {
    if (editable(event.target) && event.key !== "Escape") return;
    const key = event.key.toLowerCase();
    if (key === " " && spaceActivatesControl(event.target)) return;
    if (event.target?.getAttribute?.("role") === "tab" && ["arrowleft","arrowright","home","end"].includes(key)) return;
    const match = shortcuts.find(([, c]) => key === c.key && !!event.ctrlKey === !!c.ctrl && !!event.altKey === !!c.alt && !!event.shiftKey === !!c.shift);
    if (!match) return; event.preventDefault(); triggerAction(match[0]);
  }, true);
}
