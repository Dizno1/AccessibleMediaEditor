import { createProject, addItem, moveItem, removeItem, updateItem, splitItem, itemDuration, duration, serializable } from "./projectModel.js";
import { initShortcuts, registerAction, triggerAction } from "./shortcutService.js";

const invoke = window.__TAURI__?.core?.invoke;
const listen = window.__TAURI__?.event?.listen;
const convertFileSrc = window.__TAURI__?.core?.convertFileSrc;
const el = Object.fromEntries([...document.querySelectorAll("[id]")].map(node => [node.id, node]));
let project = createProject();
let selectedId = null;
let undoStack = [];
let redoStack = [];
let soundCues = localStorage.getItem("ame-sound-cues") === "on";
let loadedPreviewId = null;

function announce(message, urgent = false) {
  el[urgent ? "alert-announcer" : "status-announcer"].textContent = "";
  requestAnimationFrame(() => { el[urgent ? "alert-announcer" : "status-announcer"].textContent = message; });
  el["action-status"].textContent = message;
}

function cue(kind) {
  if (!soundCues) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const context = new AudioContext(); const oscillator = context.createOscillator(); const gain = context.createGain();
  oscillator.frequency.value = kind === "save" ? 660 : kind === "remove" ? 220 : 440;
  gain.gain.setValueAtTime(0.035, context.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.09);
  oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.1);
}

function selectedIndex() { return project.items.findIndex(item => item.id === selectedId); }
function selectedItem() { return project.items.find(item => item.id === selectedId) || null; }
function itemSummary(item, index) {
  const seconds = itemDuration(item); const durationText = Number.isFinite(seconds) && seconds > 0 ? ` Duration ${seconds.toFixed(3)} seconds.` : " Duration not yet determined.";
  const trimText = ["Video","Audio"].includes(item.kind) && item.duration ? ` In ${(Number(item.inPoint)||0).toFixed(3)}. Out ${(item.outPoint == null ? Number(item.duration) : Number(item.outPoint)).toFixed(3)}.` : "";
  return `Item ${index + 1}. ${item.kind}. ${item.label || item.name}.${durationText}${trimText}`;
}

function syncPreview(item) {
  const playable = item && ["Video","Audio"].includes(item.kind) && item.source;
  el["set-in-button"].disabled = !playable;
  el["set-out-button"].disabled = !playable;
  el["go-to-time-button"].disabled = !playable;
  el["split-button"].disabled = !playable;
  el["stop-button"].disabled = !playable;
  if (!playable) { el["media-preview"].pause(); el["media-preview"].removeAttribute("src"); loadedPreviewId=null; return; }
  if (loadedPreviewId !== item.id) {
    loadedPreviewId=item.id; el["media-preview"].src=convertFileSrc ? convertFileSrc(item.source) : item.source;
    el["media-preview"].load();
  }
}

function render({focusList = false} = {}) {
  const previous = selectedId;
  el["project-items"].replaceChildren();
  if (!project.items.length) {
    const option = new Option("No project items", ""); option.disabled = true; el["project-items"].add(option); selectedId = null;
  } else {
    project.items.forEach((item, index) => el["project-items"].add(new Option(itemSummary(item, index), item.id)));
    if (!project.items.some(item => item.id === selectedId)) selectedId = project.items[0].id;
    el["project-items"].value = selectedId;
  }
  const item = selectedItem(); const index = selectedIndex();
  el["selected-item-summary"].textContent = item ? itemSummary(item, index) : "No project item selected.";
  el["move-earlier-button"].disabled = !item || index === 0;
  el["move-later-button"].disabled = !item || index === project.items.length - 1;
  el["properties-button"].disabled = !item;
  el["remove-item-button"].disabled = !item;
  el["preview-button"].disabled = !item || !["Video","Audio"].includes(item.kind);
  syncPreview(item);
  const sourceDuration = Number(item?.duration)||0; const total = duration(project); el.playhead.max = String(Math.max(sourceDuration, 0)); el.playhead.value = String(Math.min(Number(el.playhead.value) || Number(item?.inPoint)||0, sourceDuration));
  el.playhead.setAttribute("aria-valuetext", `${Number(el.playhead.value).toFixed(3)} seconds`);
  el["playhead-position"].textContent = `Position ${Number(el.playhead.value).toFixed(3)} seconds. Selected item duration ${item ? itemDuration(item).toFixed(3) : "0.000"} seconds. Project duration ${total.toFixed(3)} seconds.`;
  el["project-heading"].textContent = project.name;
  el["project-summary"].textContent = `${project.items.length} project ${project.items.length === 1 ? "item" : "items"}. ${project.dirty || !project.path ? "Not saved." : "Saved."}`;
  document.title = `${project.dirty ? "* " : ""}${project.name} - Accessible Media Editor`;
  if (focusList && project.items.length) { el["project-items"].focus(); el["project-items"].value = previous || selectedId; }
}

function change(next, message, focusList = true) { undoStack.push(project); if (undoStack.length > 50) undoStack.shift(); redoStack = []; project = next; render({focusList}); announce(message); }
function id() { return crypto.randomUUID ? crypto.randomUUID() : `item-${Date.now()}-${Math.random()}`; }
function kindFromPath(path) { const ext = path.split(".").pop().toLowerCase(); if (["png","jpg","jpeg","gif","webp","bmp","tif","tiff","heic","heif"].includes(ext)) return "Image"; if (["mp3","wav","m4a","aac","flac","ogg","opus","wma","aif","aiff"].includes(ext)) return "Audio"; return "Video"; }
function baseName(path) { return path.split(/[\\/]/).pop() || "Unnamed media"; }
function timeParts(seconds) {
  const totalMilliseconds=Math.max(0,Math.round((Number(seconds)||0)*1000));
  return {hours:Math.floor(totalMilliseconds/3600000),minutes:Math.floor(totalMilliseconds/60000)%60,seconds:Math.floor(totalMilliseconds/1000)%60,milliseconds:totalMilliseconds%1000};
}
function writeTime(prefix,seconds){const parts=timeParts(seconds);Object.entries(parts).forEach(([name,value])=>{el[`${prefix}-${name}`].value=String(value);});}
function readTime(prefix){const values=["hours","minutes","seconds","milliseconds"].map(name=>Number(el[`${prefix}-${name}`].value)||0);if(values.some(value=>value<0)||values[1]>59||values[2]>59||values[3]>999)return NaN;return values[0]*3600+values[1]*60+values[2]+values[3]/1000;}

async function importMedia() {
  if (!invoke) return announce("The Windows file picker is available in the installed application.", true);
  try {
    const paths = await invoke("pick_media_files"); if (!paths.length) return;
    let next = project; let after = selectedId;
    paths.forEach(path => { const kind = kindFromPath(path); const item = {id:id(), source:path, name:baseName(path), label:baseName(path), kind, duration:kind === "Image" ? 5 : null, inPoint:0, outPoint:null}; next = addItem(next, item, after); after = item.id; selectedId = item.id; });
    const selectedNumber=next.items.findIndex(item=>item.id===selectedId)+1;
    change(next, `${paths.length} media ${paths.length === 1 ? "item" : "items"} added. Item ${selectedNumber} selected.`); cue("add");
  } catch (error) { announce(`Media could not be imported. ${error}`, true); }
}

function newProject() {
  if (project.dirty && !window.confirm("Discard unsaved changes and create a new project?")) return;
  project = createProject(); selectedId = null; undoStack = []; redoStack = []; render(); el["project-items"].focus(); announce("New untitled project created.");
}

async function openProject() {
  if (project.dirty && !window.confirm("Discard unsaved changes and open another project?")) return;
  try {
    const result = await invoke("open_project_dialog"); if (!result) return;
    const parsed = JSON.parse(result.content); parsed.path = result.path; parsed.dirty = false; project = parsed; selectedId = project.items[0]?.id || null; undoStack=[]; redoStack=[]; render({focusList:true}); announce(`${project.name} opened. ${project.items.length} project items.`);
  } catch (error) { announce(`Project could not be opened. ${error}`, true); }
}

async function saveProject(saveAs = false) {
  try {
    const content = JSON.stringify(serializable(project), null, 2);
    const path = saveAs || !project.path ? await invoke("save_project_dialog", {suggestedName:`${project.name.replace(/[^a-z0-9 -]/gi, "").trim() || "Untitled Project"}.ameproject`, content}) : await invoke("write_project", {path:project.path, content});
    if (!path) return; project.path = path; project.name = baseName(path).replace(/\.ameproject$/i, ""); project.dirty = false; render(); announce(`${project.name} saved.`); cue("save");
  } catch (error) { announce(`Project could not be saved. ${error}`, true); }
}

function move(direction) { const item=selectedItem(); if (!item) return announce("No project item selected.",true); const next=moveItem(project,item.id,direction); if (next===project) return announce(direction<0?"The selected item is already first.":"The selected item is already last."); change(next,`${item.label || item.name} moved ${direction<0?"earlier":"later"} to item ${selectedIndex()+1+direction}.`); cue("move"); }
function removeSelected() { const item=selectedItem(); if (!item) return announce("No project item selected.",true); const index=selectedIndex(); const previous=project; project = removeItem(project,item.id); selectedId=project.items[Math.min(index,project.items.length-1)]?.id || null; undoStack.push(previous); redoStack=[]; render({focusList:true}); announce(`${item.label || item.name} removed. ${project.items.length} project items remain.`); cue("remove"); }

function showProperties() { const item=selectedItem(); if (!item) return announce("No project item selected.",true); const media=["Video","Audio"].includes(item.kind); el["properties-name"].textContent=`${item.kind}: ${item.name}`; el["item-label"].value=item.label || item.name; el["item-duration"].value=item.duration ?? ""; el["item-duration"].readOnly=media; el["trim-fields"].hidden=!media; writeTime("item-in",Number(item.inPoint)||0); writeTime("item-out",item.outPoint == null ? Number(item.duration)||0 : Number(item.outPoint)); el["properties-dialog"].showModal(); el["item-label"].focus(); }
function saveProperties() { const item=selectedItem(); if (!item) return; const value=Number(el["item-duration"].value); const media=["Video","Audio"].includes(item.kind); if (!media && (!Number.isFinite(value)||value<0.001)) return announce("Enter a duration of at least 0.001 second.",true); const start=readTime("item-in"); const end=readTime("item-out"); if(media && (!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>value)) return announce("Enter valid time fields. The Out point must be after the In point and within the source duration.",true); const patch={label:el["item-label"].value.trim()||item.name,duration:Number.isFinite(value)&&value>0?value:null}; if(media){patch.inPoint=start;patch.outPoint=end;} const next=updateItem(project,item.id,patch); el["properties-dialog"].close(); change(next,"Item properties saved."); }
function showTextDialog() { el["text-content"].value=""; el["text-duration"].value="5"; el["text-dialog"].showModal(); el["text-content"].focus(); }
function saveText() { const text=el["text-content"].value.trim(); const seconds=Number(el["text-duration"].value); if(!text) return announce("Enter the text to add.",true); if(!Number.isFinite(seconds)||seconds<0.1) return announce("Enter a duration of at least 0.1 seconds.",true); const after=selectedId; const item={id:id(),source:null,name:text.split(/\s+/).slice(0,6).join(" "),label:text.split(/\s+/).slice(0,6).join(" "),kind:"Text",text,duration:seconds}; selectedId=item.id; el["text-dialog"].close(); change(addItem(project,item,after),"Text item added."); cue("add"); }
function addTransition() { const after=selectedId; const item={id:id(),source:null,name:"Crossfade",label:"Crossfade",kind:"Transition",duration:1}; selectedId=item.id; change(addItem(project,item,after),"Crossfade transition added."); cue("add"); }
function undo() { if(!undoStack.length) return announce("Nothing to undo."); redoStack.push(project); project=undoStack.pop(); selectedId=project.items[0]?.id||null; render({focusList:true}); announce("Undo completed."); }
function redo() { if(!redoStack.length) return announce("Nothing to redo."); undoStack.push(project); project=redoStack.pop(); selectedId=project.items[0]?.id||null; render({focusList:true}); announce("Redo completed."); }

function setPoint(which){const item=selectedItem();if(!item||!["Video","Audio"].includes(item.kind)||!item.duration)return announce("Select a loaded video or audio item first.",true);const point=Number(el.playhead.value);const start=Number(item.inPoint)||0;const end=item.outPoint==null?Number(item.duration):Number(item.outPoint);if(which==="in"&&point>=end)return announce("The In point must be before the Out point.",true);if(which==="out"&&point<=start)return announce("The Out point must be after the In point.",true);change(updateItem(project,item.id,which==="in"?{inPoint:point}:{outPoint:point}),`${which==="in"?"In":"Out"} point set to ${point.toFixed(3)} seconds.`,false);}
function nudge(amount){const item=selectedItem();const max=Number(item?.duration)||0;el.playhead.value=String(Math.max(0,Math.min(max,Number(el.playhead.value)+amount)));el["media-preview"].currentTime=Number(el.playhead.value);updatePlayhead();announce(`Playhead ${Number(el.playhead.value).toFixed(3)} seconds.`);}
function showGoToTime(){const item=selectedItem();if(!item||!["Video","Audio"].includes(item.kind)||!item.duration)return announce("Select a loaded video or audio item first.",true);writeTime("goto",Number(el.playhead.value));el["go-to-time-dialog"].showModal();el["goto-hours"].focus();}
function confirmGoToTime(){const item=selectedItem();const point=readTime("goto");if(!Number.isFinite(point)||point>Number(item?.duration))return announce("Enter a valid time within the selected media item.",true);el["go-to-time-dialog"].close();el.playhead.value=String(point);el["media-preview"].currentTime=point;updatePlayhead();el.playhead.focus();announce(`Playhead moved to ${point.toFixed(3)} seconds.`);}
function splitSelected(){const item=selectedItem();if(!item)return announce("No project item selected.",true);const point=Number(el.playhead.value);const next=splitItem(project,item.id,point,id());if(next===project)return announce("Move the playhead between the selected item's In and Out points before splitting.",true);const second=next.items[selectedIndex()+1];selectedId=second.id;change(next,`${item.label||item.name} split at ${point.toFixed(3)} seconds. Part 2 selected.`);cue("add");}
function updatePlayhead(){const item=selectedItem();el.playhead.setAttribute("aria-valuetext",`${Number(el.playhead.value).toFixed(3)} seconds`);el["playhead-position"].textContent=`Position ${Number(el.playhead.value).toFixed(3)} seconds. Selected item duration ${item?itemDuration(item).toFixed(3):"0.000"} seconds. Project duration ${duration(project).toFixed(3)} seconds.`;}
async function preview(){const item=selectedItem();if(!item||!["Video","Audio"].includes(item.kind))return announce("Select a video or audio item to preview.",true);const start=Math.max(Number(item.inPoint)||0,Number(el.playhead.value)||0);const end=item.outPoint==null?Number(item.duration):Number(item.outPoint);el["media-preview"].currentTime=start>=end?Number(item.inPoint)||0:start;try{await el["media-preview"].play();announce(`Previewing ${item.label||item.name} from ${el["media-preview"].currentTime.toFixed(3)} seconds.`);}catch(error){announce(`This media format could not be previewed by the Windows media engine. ${error}`,true);}}
const actions={newProject,openProject,saveProject:()=>saveProject(false),saveProjectAs:()=>saveProject(true),importMedia,openProjectsFolder:async()=>{try{await invoke("open_projects_folder");announce("Projects folder opened.");}catch(error){announce(`Projects folder could not be opened. ${error}`,true);}},addText:showTextDialog,addTransition,moveEarlier:()=>move(-1),moveLater:()=>move(1),properties:showProperties,removeItem:removeSelected,split:splitSelected,undo,redo,preview,setIn:()=>setPoint("in"),setOut:()=>setPoint("out"),goToTime:showGoToTime,nudgeBack:()=>nudge(-0.001),nudgeForward:()=>nudge(0.001),stop:()=>{if(el["properties-dialog"].open)el["properties-dialog"].close();else if(el["text-dialog"].open)el["text-dialog"].close();else if(el["go-to-time-dialog"].open)el["go-to-time-dialog"].close();else{el["media-preview"].pause();announce("Playback is stopped.");}},focusProjectItems:()=>{el["project-items"].focus();announce("Project Items.");},focusPlayhead:()=>{el.playhead.focus();announce(el["playhead-position"].textContent);},showShortcuts:()=>{el["shortcuts-dialog"].showModal();el["shortcuts-dialog"].querySelector("button").focus();},toggleSoundCues:()=>{soundCues=!soundCues;localStorage.setItem("ame-sound-cues",soundCues?"on":"off");announce(`Sound cues ${soundCues?"on":"off"}.`);if(soundCues)cue("add");},showAbout:()=>announce("Accessible Media Editor Build 0.2.1. Open Door Design. Screen-reader-first multimedia authoring.")};
Object.entries(actions).forEach(([name,handler])=>registerAction(name,handler)); initShortcuts();

el["project-items"].addEventListener("change",()=>{selectedId=el["project-items"].value||null;render();});
el["import-media-button"].addEventListener("click",()=>triggerAction("importMedia")); el["add-text-button"].addEventListener("click",()=>triggerAction("addText"));
el["move-earlier-button"].addEventListener("click",()=>triggerAction("moveEarlier")); el["move-later-button"].addEventListener("click",()=>triggerAction("moveLater"));
el["properties-button"].addEventListener("click",()=>triggerAction("properties")); el["remove-item-button"].addEventListener("click",()=>triggerAction("removeItem"));
el["preview-button"].addEventListener("click",()=>triggerAction("preview")); el["stop-button"].addEventListener("click",()=>triggerAction("stop"));
el["set-in-button"].addEventListener("click",()=>triggerAction("setIn")); el["set-out-button"].addEventListener("click",()=>triggerAction("setOut"));
el["go-to-time-button"].addEventListener("click",()=>triggerAction("goToTime")); el["go-to-time-confirm"].addEventListener("click",confirmGoToTime); el["go-to-time-cancel"].addEventListener("click",()=>el["go-to-time-dialog"].close());
el["split-button"].addEventListener("click",()=>triggerAction("split"));
el["save-properties-button"].addEventListener("click",saveProperties); el["cancel-properties-button"].addEventListener("click",()=>el["properties-dialog"].close());
el["save-text-button"].addEventListener("click",saveText); el["cancel-text-button"].addEventListener("click",()=>el["text-dialog"].close());
el.playhead.addEventListener("input",()=>{el["media-preview"].currentTime=Number(el.playhead.value);updatePlayhead();});
el["media-preview"].addEventListener("loadedmetadata",()=>{const item=selectedItem();if(!item||loadedPreviewId!==item.id||!Number.isFinite(el["media-preview"].duration))return;if(!item.duration){project=updateItem(project,item.id,{duration:el["media-preview"].duration,outPoint:el["media-preview"].duration});render();announce(`${item.name} loaded. Duration ${el["media-preview"].duration.toFixed(3)} seconds.`);}});
el["media-preview"].addEventListener("timeupdate",()=>{const item=selectedItem();if(!item)return;const end=item.outPoint==null?Number(item.duration):Number(item.outPoint);if(el["media-preview"].currentTime>=end){el["media-preview"].pause();el["media-preview"].currentTime=end;announce("Out point reached. Playback stopped.");}el.playhead.value=String(el["media-preview"].currentTime);updatePlayhead();});
el["media-preview"].addEventListener("error",()=>announce("This file was imported, but the Windows preview engine could not decode it. FFmpeg compatibility is planned for the export engine.",true));

if(listen) listen("menu-action",event=>triggerAction(event.payload));
render(); el["project-items"].focus();
