import {
  createProject, addItem, moveItem, removeItem, updateItem, splitItem,
  addSource, removeSource, updateSource, appendSourceSelection,
  insertSourceSelection, itemDuration, duration, serializable
} from "./projectModel.js";
import { initShortcuts, registerAction, triggerAction } from "./shortcutService.js";

const invoke = window.__TAURI__?.core?.invoke;
const listen = window.__TAURI__?.event?.listen;
const convertFileSrc = window.__TAURI__?.core?.convertFileSrc;
const el = Object.fromEntries([...document.querySelectorAll("[id]")].map(node => [node.id, node]));

let project = createProject();
let selectedId = null;
let selectedSourceId = null;
let activeContext = "sequence";
let activeWorkspace = "media";
let activeSectionIndex = 0;
let undoStack = [];
let redoStack = [];
let soundCues = localStorage.getItem("ame-sound-cues") === "on";
let loadedPreviewId = null;
let lastNativeTitle = "";
let outPointAnnouncedForId = null;
let auditionState = null;
const cursorPositions = new Map();
const sectionIds = ["media-section", "playback-section", "edit-section", "output-section"];

function announce(message, urgent = false) {
  const region = el[urgent ? "alert-announcer" : "status-announcer"];
  region.textContent = "";
  requestAnimationFrame(() => { region.textContent = message; });
  el["action-status"].textContent = message;
}

function cue(kind) {
  if (!soundCues) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = kind === "save" ? 660 : kind === "remove" ? 220 : 440;
  gain.gain.setValueAtTime(0.035, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.09);
  oscillator.connect(gain); gain.connect(context.destination);
  oscillator.start(); oscillator.stop(context.currentTime + 0.1);
}

function id() {
  return crypto.randomUUID ? crypto.randomUUID() : `item-${Date.now()}-${Math.random()}`;
}

function baseName(path) {
  return path.split(/[\\/]/).pop() || "Unnamed media";
}

function displayName(item) {
  return (item?.label || item?.name || "No media").replace(/\.[^.]+$/, "");
}

function kindFromPath(path) {
  const ext = path.split(".").pop().toLowerCase();
  if (["png","jpg","jpeg","gif","webp","bmp","tif","tiff","heic","heif"].includes(ext)) return "Image";
  if (["mp3","wav","m4a","aac","flac","ogg","opus","wma","aif","aiff"].includes(ext)) return "Audio";
  return "Video";
}

function readableTime(seconds) {
  const total = Math.max(0, Math.round((Number(seconds) || 0) * 1000));
  const hours = Math.floor(total / 3600000);
  const minutes = Math.floor(total / 60000) % 60;
  const wholeSeconds = Math.floor(total / 1000) % 60;
  const milliseconds = total % 1000;
  const parts = [];
  if (hours) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  if (minutes) parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  parts.push(`${wholeSeconds} ${wholeSeconds === 1 ? "second" : "seconds"}`);
  if (milliseconds) parts.push(`${milliseconds} ${milliseconds === 1 ? "millisecond" : "milliseconds"}`);
  return parts.join(", ");
}

function timeParts(seconds) {
  const total=Math.max(0,Math.round((Number(seconds)||0)*1000));
  return {hours:Math.floor(total/3600000),minutes:Math.floor(total/60000)%60,seconds:Math.floor(total/1000)%60,milliseconds:total%1000};
}

function writeTime(prefix, seconds) {
  const parts=timeParts(seconds);
  Object.entries(parts).forEach(([name,value]) => { el[`${prefix}-${name}`].value=String(value); });
}

function readTime(prefix) {
  const values=["hours","minutes","seconds","milliseconds"].map(name=>Number(el[`${prefix}-${name}`].value)||0);
  if(values.some(value=>value<0)||values[1]>59||values[2]>59||values[3]>999) return NaN;
  return values[0]*3600+values[1]*60+values[2]+values[3]/1000;
}

function selectedIndex() {
  return project.items.findIndex(item => item.id === selectedId);
}

function selectedSequenceItem() {
  return project.items.find(item => item.id === selectedId) || null;
}

function selectedSource() {
  return (project.sources || []).find(item => item.id === selectedSourceId) || null;
}

function activeItem() {
  return activeContext === "source" ? selectedSource() : selectedSequenceItem();
}

function activeContextLabel(item = activeItem()) {
  if (!item) return "No media active";
  if (activeContext === "source") return `Source ${item.kind.toLowerCase()} - ${displayName(item)}`;
  if (item.role === "inserted") return `Inserted segment - ${displayName(item)}`;
  return `Primary sequence - ${displayName(item)}`;
}

function itemTarget(item) {
  if (!item) return "none";
  if (item.kind === "Audio") return "audio";
  return item.trackTarget || "both";
}

function targetText(target) {
  return target === "audio" ? "Audio only" : target === "video" ? "Video only" : "Both audio and video";
}

function itemSummary(item, index, source = false) {
  const seconds=itemDuration(item);
  const durationText=Number.isFinite(seconds)&&seconds>0?` Duration ${readableTime(seconds)}.`:" Duration not yet determined.";
  const trimText=["Video","Audio"].includes(item.kind)&&item.duration?` In ${readableTime(Number(item.inPoint)||0)}. Out ${readableTime(item.outPoint==null?Number(item.duration):Number(item.outPoint))}.`:"";
  const role=source?`Source ${index+1}`:item.role==="inserted"?`Inserted segment ${index+1}`:`Primary sequence item ${index+1}`;
  return `${role}. ${item.kind}. ${item.label||item.name}.${durationText}${trimText}`;
}

function migrateProject(value) {
  const next={...value};
  next.items=Array.isArray(next.items)?next.items:[];
  next.sources=Array.isArray(next.sources)?next.sources:[];
  next.version=2;
  if(next.items[0]&&!next.items[0].role) next.items[0].role="primary";
  next.items.slice(1).forEach(item=>{if(!item.role)item.role="sequence";});
  return next;
}

function updateActiveItem(patch) {
  return activeContext === "source"
    ? updateSource(project, selectedSourceId, patch)
    : updateItem(project, selectedId, patch);
}

function setActiveProject(next, message, focusList = false) {
  undoStack.push(project);
  if (undoStack.length > 50) undoStack.shift();
  redoStack=[];
  project=next;
  render({focusList});
  announce(message);
}

function syncPreview(item) {
  const playable=item&&["Video","Audio"].includes(item.kind)&&item.source;
  ["set-in-button","set-out-button","go-to-time-button","split-button","preview-button","audition-button"].forEach(name=>{el[name].disabled=!playable;});
  const isVideo=playable&&item.kind==="Video";
  el["target-both-button"].disabled=!isVideo;
  el["target-video-button"].disabled=!isVideo;
  el["target-audio-button"].disabled=!playable;
  if(!playable){
    el["media-preview"].pause();
    el["media-preview"].removeAttribute("src");
    loadedPreviewId=null;
    return;
  }
  if(loadedPreviewId!==item.id){
    if(auditionState){clearTimeout(auditionState.timer);auditionState=null;}
    el["media-preview"].pause();
    loadedPreviewId=item.id;
    outPointAnnouncedForId=null;
    const point=cursorPositions.get(item.id)??Number(item.inPoint)??0;
    el.playhead.value=String(point);
    el["media-preview"].src=convertFileSrc?convertFileSrc(item.source):item.source;
    el["media-preview"].load();
  }
  el["media-preview"].muted=itemTarget(item)==="video";
}

function render({focusList=false}={}) {
  const priorSequence=selectedId;
  const priorSource=selectedSourceId;
  el["project-items"].replaceChildren();
  if(!project.items.length){
    const option=new Option("No primary media",""); option.disabled=true; el["project-items"].add(option); selectedId=null;
  }else{
    project.items.forEach((item,index)=>el["project-items"].add(new Option(itemSummary(item,index,false),item.id)));
    if(!project.items.some(item=>item.id===selectedId)) selectedId=project.items[0].id;
    el["project-items"].value=selectedId;
  }
  el["source-items"].replaceChildren();
  const sources=project.sources||[];
  if(!sources.length){
    const option=new Option("No source media",""); option.disabled=true; el["source-items"].add(option); selectedSourceId=null;
  }else{
    sources.forEach((item,index)=>el["source-items"].add(new Option(itemSummary(item,index,true),item.id)));
    if(!sources.some(item=>item.id===selectedSourceId)) selectedSourceId=sources[0].id;
    el["source-items"].value=selectedSourceId;
  }
  if(activeContext==="source"&&!selectedSourceId) activeContext="sequence";
  if(activeContext==="sequence"&&!selectedId&&selectedSourceId) activeContext="source";

  const sequenceItem=selectedSequenceItem();
  const source=selectedSource();
  const active=activeItem();
  const index=selectedIndex();
  el["selected-item-summary"].textContent=sequenceItem?itemSummary(sequenceItem,index,false):"No primary media selected.";
  el["selected-source-summary"].textContent=source?itemSummary(source,sources.findIndex(item=>item.id===source.id),true):"No source media selected.";
  el["move-earlier-button"].disabled=!sequenceItem||index===0;
  el["move-later-button"].disabled=!sequenceItem||index===project.items.length-1;
  el["remove-item-button"].disabled=!sequenceItem;
  el["activate-source-button"].disabled=!source;
  el["insert-source-button"].disabled=!source||!sequenceItem||!source.duration;
  el["append-source-button"].disabled=!source||!source.duration;
  el["remove-source-button"].disabled=!source;
  el["properties-button"].disabled=!active;
  syncPreview(active);

  const sourceDuration=Number(active?.duration)||0;
  const remembered=cursorPositions.get(active?.id);
  const current=Math.max(0,Math.min(sourceDuration,remembered??(Number(el.playhead.value)||Number(active?.inPoint)||0)));
  el.playhead.max=String(Math.max(sourceDuration,0));
  el.playhead.value=String(current);
  updatePlayhead(true);

  const contextLabel=activeContextLabel(active);
  const contextStatus=active?`${contextLabel}. ${targetText(itemTarget(active))} targeted.`:"No media active.";
  el["active-context"].textContent=contextStatus;
  el["playback-section-heading"].textContent=`Playback - ${contextLabel}`;
  el["edit-section-heading"].textContent=`Edit - ${contextLabel}`;

  const primary=project.items.find(item=>item.role==="primary")||project.items[0];
  const workingName=project.path?project.name:primary?(primary.name||primary.label):"Accessible Media Editor";
  el["project-heading"].textContent=displayName({name:workingName});
  el["project-summary"].textContent=primary?`${project.items.length} primary sequence ${project.items.length===1?"item":"items"}. ${sources.length} source media ${sources.length===1?"item":"items"}. ${project.path?(project.dirty?"Project has unsaved changes.":"Project saved."):"No project required."}`:"No media open. Press Ctrl+O to begin.";
  el["output-summary"].textContent=primary?`Primary sequence duration ${readableTime(duration(project))}. Source media is excluded until inserted.`:"Open media to begin editing. Project creation is optional.";
  const windowTitle=`${project.dirty?"* ":""}${workingName}${workingName==="Accessible Media Editor"?"":" - Accessible Media Editor"}`;
  document.title=windowTitle;
  if(invoke&&windowTitle!==lastNativeTitle){
    lastNativeTitle=windowTitle;
    invoke("set_window_title",{title:windowTitle}).catch(()=>{});
  }
  if(focusList){
    const list=activeContext==="source"?el["source-items"]:el["project-items"];
    list.focus();
    list.value=activeContext==="source"?(priorSource||selectedSourceId):(priorSequence||selectedId);
  }
}

function focusSection(offset) {
  if(activeWorkspace!=="media") return announce("AudioStudio Pro does not have editor sections yet.");
  activeSectionIndex=(activeSectionIndex+offset+sectionIds.length)%sectionIds.length;
  const section=el[sectionIds[activeSectionIndex]];
  section.focus();
  const heading=section.querySelector("h2")?.textContent||"Editor";
  announce(`${heading} section. ${activeItem()?targetText(itemTarget(activeItem()))+" targeted.":""} Use Tab within this section.`);
}

function activateSection(sectionId) {
  activeSectionIndex=sectionIds.indexOf(sectionId);
  el[sectionId].focus();
  announce(`${el[sectionId].querySelector("h2").textContent} section.`);
}

function switchWorkspace(direction=1, target=null) {
  const next=target||(activeWorkspace==="media"?"audio":"media");
  activeWorkspace=next;
  const media=next==="media";
  el["media-editor-tab"].setAttribute("aria-selected",String(media));
  el["audio-studio-tab"].setAttribute("aria-selected",String(!media));
  el["media-editor-tab"].tabIndex=media?0:-1;
  el["audio-studio-tab"].tabIndex=media?-1:0;
  el["media-editor-workspace"].hidden=!media;
  el["audio-studio-workspace"].hidden=media;
  const panel=media?el["media-editor-workspace"]:el["audio-studio-workspace"];
  panel.focus();
  announce(media?`Media Editor workspace. ${activeContextLabel()} active.`:"AudioStudio Pro workspace. Professional audio tools are not implemented in this build.");
}

async function importMedia() {
  if(!invoke) return announce("The Windows file picker is available in the installed application.",true);
  try{
    const paths=await invoke("pick_media_files");
    if(!paths.length)return;
    const previous=project;
    let next=project;
    let primaryAdded=false;
    const sourceIds=[];
    paths.forEach(path=>{
      const kind=kindFromPath(path);
      const media={id:id(),source:path,name:baseName(path),label:baseName(path),kind,duration:kind==="Image"?5:null,inPoint:0,outPoint:null,trackTarget:kind==="Audio"?"audio":"both"};
      if(!next.items.length&&!primaryAdded){
        media.role="primary";
        next=addItem(next,media,null);
        selectedId=media.id;
        activeContext="sequence";
        primaryAdded=true;
      }else{
        media.role="source";
        next=addSource(next,media);
        selectedSourceId=media.id;
        sourceIds.push(media.id);
      }
    });
    if(!primaryAdded&&sourceIds.length) activeContext="source";
    project=next;
    undoStack.push(previous);
    render({focusList:true});
    announce(primaryAdded?`Primary media opened. ${sourceIds.length} additional source ${sourceIds.length===1?"item":"items"} added.`:`${sourceIds.length} source media ${sourceIds.length===1?"item":"items"} added. Source preview active.`);
    cue("add");
  }catch(error){announce(`Media could not be opened. ${error}`,true);}
}

function newProject() {
  if(project.dirty&&!window.confirm("Discard unsaved changes and start a new editing session?"))return;
  project=createProject(); selectedId=null; selectedSourceId=null; activeContext="sequence";
  cursorPositions.clear(); undoStack=[]; redoStack=[]; render(); el["import-media-button"].focus();
  announce("New editing session. Press Ctrl+O to open primary media.");
}

async function openProject() {
  if(project.dirty&&!window.confirm("Discard unsaved changes and open another project?"))return;
  try{
    const result=await invoke("open_project_dialog"); if(!result)return;
    const parsed=migrateProject(JSON.parse(result.content));
    parsed.path=result.path; parsed.dirty=false; project=parsed;
    selectedId=project.items[0]?.id||null; selectedSourceId=project.sources[0]?.id||null; activeContext="sequence";
    cursorPositions.clear(); undoStack=[]; redoStack=[]; render({focusList:true});
    announce(`${project.name} opened. ${project.items.length} sequence items and ${project.sources.length} source items.`);
  }catch(error){announce(`Project could not be opened. ${error}`,true);}
}

async function saveProject(saveAs=false) {
  try{
    const content=JSON.stringify(serializable(project),null,2);
    const suggested=`${project.name.replace(/[^a-z0-9 -]/gi,"").trim()||"Untitled Project"}.ameproject`;
    const path=saveAs||!project.path?await invoke("save_project_dialog",{suggestedName:suggested,content}):await invoke("write_project",{path:project.path,content});
    if(!path)return;
    project.path=path; project.name=baseName(path).replace(/\.ameproject$/i,""); project.dirty=false;
    render(); announce(`${project.name} saved.`); cue("save");
  }catch(error){announce(`Project could not be saved. ${error}`,true);}
}

function activateSequence() {
  if(!selectedSequenceItem())return announce("No primary sequence item selected.",true);
  activeContext="sequence"; render(); announce(`${activeContextLabel()} active. ${targetText(itemTarget(activeItem()))} targeted.`);
}

function activateSource() {
  if(!selectedSource())return announce("No source media selected.",true);
  activeContext="source"; render(); announce(`${activeContextLabel()} active. ${targetText(itemTarget(activeItem()))} targeted.`);
}

function move(direction) {
  const item=selectedSequenceItem(); if(!item)return announce("No primary sequence item selected.",true);
  const next=moveItem(project,item.id,direction); if(next===project)return announce(direction<0?"The selected item is already first.":"The selected item is already last.");
  setActiveProject(next,`${item.label||item.name} moved ${direction<0?"earlier":"later"}.`,true); cue("move");
}

function removeSelected() {
  const item=selectedSequenceItem(); if(!item)return announce("No primary sequence item selected.",true);
  const index=selectedIndex(); const previous=project;
  project=removeItem(project,item.id); selectedId=project.items[Math.min(index,project.items.length-1)]?.id||null;
  activeContext=selectedId?"sequence":selectedSourceId?"source":"sequence";
  undoStack.push(previous); redoStack=[]; render({focusList:true});
  announce(`${item.label||item.name} removed from the primary sequence.`); cue("remove");
}

function removeSelectedSource() {
  const source=selectedSource(); if(!source)return announce("No source media selected.",true);
  const previous=project; project=removeSource(project,source.id);
  selectedSourceId=project.sources[0]?.id||null;
  if(activeContext==="source"&&!selectedSourceId)activeContext="sequence";
  undoStack.push(previous); redoStack=[]; render({focusList:true});
  announce(`${source.label||source.name} removed from Source Media. The original file was not changed.`); cue("remove");
}

function removeActive() {
  return activeContext === "source" ? removeSelectedSource() : removeSelected();
}

function insertSelectedSource(atEnd=false) {
  const source=selectedSource(); const target=selectedSequenceItem();
  if(!source||!source.duration)return announce("Select and load source media first.",true);
  if(!atEnd&&!target)return announce("Select a primary sequence item first.",true);
  const insertedId=id();
  let next;
  if(atEnd){
    next=appendSourceSelection(project,source,insertedId);
  }else{
    const point=cursorPositions.get(target.id)??(Number(target.inPoint)||0);
    next=insertSourceSelection(project,target.id,point,source,id(),insertedId,id());
    if(next===project)return announce("The source selection could not be inserted at the current primary playhead.",true);
  }
  selectedId=insertedId; activeContext="sequence";
  setActiveProject(next,atEnd?`Source selection added to the end of the primary sequence.`:`Source selection inserted at the primary playhead.`,true);
  cue("add");
}

function showProperties() {
  const item=activeItem(); if(!item)return announce("No media active.",true);
  const media=["Video","Audio"].includes(item.kind);
  el["properties-name"].textContent=`${activeContextLabel(item)}. ${item.kind}: ${item.name}`;
  el["item-label"].value=item.label||item.name;
  el["item-duration"].value=item.duration??"";
  el["item-duration"].readOnly=media;
  el["trim-fields"].hidden=!media;
  writeTime("item-in",Number(item.inPoint)||0);
  writeTime("item-out",item.outPoint==null?Number(item.duration)||0:Number(item.outPoint));
  el["properties-dialog"].showModal(); el["item-label"].focus();
}

function saveProperties() {
  const item=activeItem(); if(!item)return;
  const value=Number(el["item-duration"].value);
  const media=["Video","Audio"].includes(item.kind);
  if(!media&&(!Number.isFinite(value)||value<0.001))return announce("Enter a duration of at least 0.001 second.",true);
  const start=readTime("item-in"); const end=readTime("item-out");
  if(media&&(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>value))return announce("Enter valid time fields. The Out mark must be after the In mark and within the source duration.",true);
  const patch={label:el["item-label"].value.trim()||item.name,duration:Number.isFinite(value)&&value>0?value:null};
  if(media){patch.inPoint=start;patch.outPoint=end;}
  el["properties-dialog"].close();
  setActiveProject(updateActiveItem(patch),"Media properties saved.");
}

function showTextDialog(){el["text-content"].value="";el["text-duration"].value="5";el["text-dialog"].showModal();el["text-content"].focus();}
function saveText(){
  const text=el["text-content"].value.trim();const seconds=Number(el["text-duration"].value);
  if(!text)return announce("Enter the text to add.",true);
  if(!Number.isFinite(seconds)||seconds<0.1)return announce("Enter a duration of at least 0.1 seconds.",true);
  const item={id:id(),source:null,name:text.split(/\s+/).slice(0,6).join(" "),label:text.split(/\s+/).slice(0,6).join(" "),kind:"Text",text,duration:seconds,role:"sequence"};
  selectedId=item.id;activeContext="sequence";el["text-dialog"].close();
  setActiveProject(addItem(project,item,selectedId),"Text item added.",true);cue("add");
}

function addTransition(){
  const item={id:id(),source:null,name:"Crossfade",label:"Crossfade",kind:"Transition",duration:1,role:"sequence"};
  const after=selectedId;selectedId=item.id;activeContext="sequence";
  setActiveProject(addItem(project,item,after),"Crossfade transition added.",true);cue("add");
}

function undo(){
  if(!undoStack.length)return announce("Nothing to undo.");
  redoStack.push(project);project=undoStack.pop();selectedId=project.items[0]?.id||null;selectedSourceId=project.sources?.[0]?.id||null;activeContext=selectedId?"sequence":"source";render({focusList:true});announce("Undo completed.");
}
function redo(){
  if(!redoStack.length)return announce("Nothing to redo.");
  undoStack.push(project);project=redoStack.pop();selectedId=project.items[0]?.id||null;selectedSourceId=project.sources?.[0]?.id||null;activeContext=selectedId?"sequence":"source";render({focusList:true});announce("Redo completed.");
}

function updatePlayhead(expose=true){
  const item=activeItem();const point=Number(el.playhead.value)||0;
  if(item)cursorPositions.set(item.id,point);
  if(expose)el.playhead.setAttribute("aria-valuetext",readableTime(point));
  el["playhead-position"].textContent=`Position ${readableTime(point)}. Active media duration ${readableTime(item?itemDuration(item):0)}. Primary sequence duration ${readableTime(duration(project))}.`;
}

function setExactPlayhead(point, expose=true){
  const item=activeItem();if(!item||!["Video","Audio"].includes(item.kind)||!item.duration)return false;
  const next=Math.max(0,Math.min(Number(item.duration),Number(point)||0));
  el.playhead.value=String(next);el["media-preview"].currentTime=next;cursorPositions.set(item.id,next);outPointAnnouncedForId=null;updatePlayhead(expose);return true;
}

function movePlayhead(amount, label="Playhead"){
  if(!setExactPlayhead((Number(el.playhead.value)||0)+amount,true))return announce("Select loaded video or audio first.",true);
  announce(`${label} ${readableTime(Number(el.playhead.value))}.`);
}

function jumpPlayhead(toEnd=false){
  const item=activeItem();if(!item||!item.duration)return announce("Select loaded video or audio first.",true);
  setExactPlayhead(toEnd?Number(item.duration):0,true);
  announce(`${toEnd?"End":"Beginning"}. ${readableTime(Number(el.playhead.value))}.`);
}

function finishAudition(announceFinish=true){
  if(!auditionState)return;
  const state=auditionState;auditionState=null;
  clearTimeout(state.timer);
  el["media-preview"].pause();
  setExactPlayhead(state.returnPoint,true);
  if(announceFinish)announce(`Audition complete. Playhead returned to ${readableTime(state.returnPoint)}.`);
}

async function audition(before=1,after=1,quietStart=false){
  const item=activeItem();if(!item||!["Video","Audio"].includes(item.kind)||!item.duration)return announce("Select loaded video or audio first.",true);
  if(auditionState)finishAudition(false);
  if(!el["media-preview"].paused)el["media-preview"].pause();
  const point=Number(el.playhead.value)||0;
  const lower=Number(item.inPoint)||0;
  const upper=item.outPoint==null?Number(item.duration):Number(item.outPoint);
  const start=Math.max(lower,point-before);
  const end=Math.min(upper,point+after);
  el["media-preview"].currentTime=start;
  const timer=setTimeout(()=>finishAudition(true),Math.max(300,(end-start)*1000+500));
  auditionState={returnPoint:point,end,timer};
  try{
    await el["media-preview"].play();
    if(!quietStart)announce(`Auditioning around ${readableTime(point)}. The playhead will return to this position.`);
  }catch(error){finishAudition(false);announce(`Audition could not start. ${error}`,true);}
}

function scrub(amount){
  const item=activeItem();if(!item||!item.duration)return announce("Select loaded video or audio first.",true);
  if(auditionState)finishAudition(false);
  const target=Math.max(0,Math.min(Number(item.duration),(Number(el.playhead.value)||0)+amount));
  setExactPlayhead(target,true);
  announce(`Scrubbed to ${readableTime(target)}.`);
  audition(0,0.2,true);
}

async function togglePlayback(){
  const item=activeItem();if(!item||!["Video","Audio"].includes(item.kind))return announce("Select video or audio to play.",true);
  if(auditionState)finishAudition(false);
  if(el["media-preview"].paused){
    const start=Number(el.playhead.value)||Number(item.inPoint)||0;
    const end=item.outPoint==null?Number(item.duration):Number(item.outPoint);
    el["media-preview"].currentTime=start>=end?Number(item.inPoint)||0:start;
    try{await el["media-preview"].play();announce(`Playing ${activeContextLabel(item)} from ${readableTime(el["media-preview"].currentTime)}.`);}catch(error){announce(`Playback could not start. ${error}`,true);}
  }else{
    el["media-preview"].pause();setExactPlayhead(el["media-preview"].currentTime,true);
    announce(`Paused at ${readableTime(Number(el.playhead.value))}.`);
  }
}

function setPoint(which){
  const item=activeItem();if(!item||!["Video","Audio"].includes(item.kind)||!item.duration)return announce("Select loaded video or audio first.",true);
  const point=Number(el.playhead.value);const start=Number(item.inPoint)||0;const end=item.outPoint==null?Number(item.duration):Number(item.outPoint);
  if(which==="in"&&point>=end)return announce("The In mark must be before the Out mark.",true);
  if(which==="out"&&point<=start)return announce("The Out mark must be after the In mark.",true);
  const next=updateActiveItem(which==="in"?{inPoint:point}:{outPoint:point});
  setActiveProject(next,`${which==="in"?"In":"Out"} mark set to ${readableTime(point)}.`);
}

function setTrackTarget(target){
  const item=activeItem();if(!item||!["Video","Audio"].includes(item.kind))return announce("Select video or audio first.",true);
  if(item.kind==="Audio"&&target!=="audio")return announce("Audio-only media always targets audio.");
  const next=updateActiveItem({trackTarget:target});
  setActiveProject(next,`${targetText(target)} targeted for playback and editing.`);
}

function showGoToTime(){
  const item=activeItem();if(!item||!item.duration)return announce("Select loaded video or audio first.",true);
  writeTime("goto",Number(el.playhead.value));el["go-to-time-dialog"].showModal();el["goto-hours"].focus();
}
function confirmGoToTime(){
  const item=activeItem();const point=readTime("goto");
  if(!Number.isFinite(point)||point>Number(item?.duration))return announce("Enter a valid time within the active media.",true);
  el["go-to-time-dialog"].close();setExactPlayhead(point,true);el.playhead.focus();announce(`Playhead moved to ${readableTime(point)}.`);
}

function splitSelected(){
  if(activeContext!=="sequence")return announce("Activate a primary sequence item before splitting.",true);
  const item=selectedSequenceItem();if(!item)return announce("No primary sequence item selected.",true);
  const point=Number(el.playhead.value);const newId=id();const next=splitItem(project,item.id,point,newId);
  if(next===project)return announce("Move the playhead between the item's In and Out marks before splitting.",true);
  selectedId=newId;setActiveProject(next,`${item.label||item.name} split at ${readableTime(point)}. Part 2 active.`,true);cue("add");
}

function cancel(){
  if(el["properties-dialog"].open)el["properties-dialog"].close();
  else if(el["text-dialog"].open)el["text-dialog"].close();
  else if(el["go-to-time-dialog"].open)el["go-to-time-dialog"].close();
  else if(auditionState){finishAudition(false);announce("Audition canceled.");}
  else announce("No temporary operation to cancel.");
}

const actions={
  newProject,openProject,saveProject:()=>saveProject(false),saveProjectAs:()=>saveProject(true),importMedia,
  previousWorkspace:()=>switchWorkspace(-1),nextWorkspace:()=>switchWorkspace(1),showMediaWorkspace:()=>switchWorkspace(1,"media"),showAudioWorkspace:()=>switchWorkspace(1,"audio"),
  previousSection:()=>focusSection(-1),nextSection:()=>focusSection(1),
  openProjectsFolder:async()=>{try{await invoke("open_projects_folder");announce("Projects folder opened.");}catch(error){announce(`Projects folder could not be opened. ${error}`,true);}},
  addText:showTextDialog,addTransition,moveEarlier:()=>move(-1),moveLater:()=>move(1),properties:showProperties,
  removeItem:removeActive,split:splitSelected,undo,redo,preview:togglePlayback,playPause:togglePlayback,audition:()=>audition(),
  setIn:()=>setPoint("in"),setOut:()=>setPoint("out"),goToTime:showGoToTime,
  scrubBack1:()=>scrub(-1),scrubForward1:()=>scrub(1),scrubBack100ms:()=>scrub(-0.1),scrubForward100ms:()=>scrub(0.1),
  scrubBack10ms:()=>scrub(-0.01),scrubForward10ms:()=>scrub(0.01),
  moveBack5:()=>movePlayhead(-5),moveForward5:()=>movePlayhead(5),moveBack30:()=>movePlayhead(-30),moveForward30:()=>movePlayhead(30),
  moveBack300:()=>movePlayhead(-300),moveForward300:()=>movePlayhead(300),nudgeBack:()=>movePlayhead(-0.001),nudgeForward:()=>movePlayhead(0.001),
  jumpBeginning:()=>jumpPlayhead(false),jumpEnd:()=>jumpPlayhead(true),targetBoth:()=>setTrackTarget("both"),targetVideo:()=>setTrackTarget("video"),targetAudio:()=>setTrackTarget("audio"),
  stop:cancel,cancel,focusProjectItems:()=>{el["project-items"].focus();announce("Primary sequence. Use plain Arrow keys to select and activate an item.");},
  focusPlayhead:()=>{updatePlayhead(true);el.playhead.focus();announce(`${activeContextLabel()}. ${el["playhead-position"].textContent}`);},
  showShortcuts:()=>{el["shortcuts-dialog"].showModal();el["shortcuts-dialog"].querySelector("button").focus();},
  showTestingGuide:()=>{el["testing-guide-dialog"].showModal();el["testing-guide-dialog"].querySelector("button").focus();},
  toggleSoundCues:()=>{soundCues=!soundCues;localStorage.setItem("ame-sound-cues",soundCues?"on":"off");announce(`Sound cues ${soundCues?"on":"off"}.`);if(soundCues)cue("add");},
  showAbout:()=>announce("Accessible Media Editor Build 0.4.0. Media Editor and optional AudioStudio Pro workspaces.")
};
Object.entries(actions).forEach(([name,handler])=>registerAction(name,handler));
initShortcuts();

el["project-items"].addEventListener("change",()=>{selectedId=el["project-items"].value||null;activateSequence();});
el["source-items"].addEventListener("change",()=>{selectedSourceId=el["source-items"].value||null;activateSource();});
el["import-media-button"].addEventListener("click",()=>triggerAction("importMedia"));
el["add-text-button"].addEventListener("click",()=>triggerAction("addText"));
el["move-earlier-button"].addEventListener("click",()=>triggerAction("moveEarlier"));
el["move-later-button"].addEventListener("click",()=>triggerAction("moveLater"));
el["remove-item-button"].addEventListener("click",removeSelected);
el["activate-source-button"].addEventListener("click",activateSource);
el["insert-source-button"].addEventListener("click",()=>insertSelectedSource(false));
el["append-source-button"].addEventListener("click",()=>insertSelectedSource(true));
el["remove-source-button"].addEventListener("click",removeSelectedSource);
el["preview-button"].addEventListener("click",()=>triggerAction("playPause"));
el["audition-button"].addEventListener("click",()=>triggerAction("audition"));
el["set-in-button"].addEventListener("click",()=>triggerAction("setIn"));
el["set-out-button"].addEventListener("click",()=>triggerAction("setOut"));
el["go-to-time-button"].addEventListener("click",()=>triggerAction("goToTime"));
el["go-to-time-confirm"].addEventListener("click",confirmGoToTime);
el["go-to-time-cancel"].addEventListener("click",()=>el["go-to-time-dialog"].close());
el["properties-button"].addEventListener("click",()=>triggerAction("properties"));
el["split-button"].addEventListener("click",()=>triggerAction("split"));
el["target-both-button"].addEventListener("click",()=>triggerAction("targetBoth"));
el["target-video-button"].addEventListener("click",()=>triggerAction("targetVideo"));
el["target-audio-button"].addEventListener("click",()=>triggerAction("targetAudio"));
el["save-project-button"].addEventListener("click",()=>triggerAction("saveProjectAs"));
el["media-editor-tab"].addEventListener("click",()=>switchWorkspace(1,"media"));
el["audio-studio-tab"].addEventListener("click",()=>switchWorkspace(1,"audio"));
document.querySelectorAll('[role="tab"]').forEach(tab=>tab.addEventListener("keydown",event=>{
  if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
  event.preventDefault();event.stopPropagation();
  const target=event.key==="ArrowLeft"||event.key==="Home"?"media":"audio";
  switchWorkspace(1,target);
  el[target==="media"?"media-editor-tab":"audio-studio-tab"].focus();
}));
document.querySelectorAll(".section-tab").forEach(button=>button.addEventListener("click",()=>activateSection(button.dataset.section)));
el["save-properties-button"].addEventListener("click",saveProperties);
el["cancel-properties-button"].addEventListener("click",()=>el["properties-dialog"].close());
el["save-text-button"].addEventListener("click",saveText);
el["cancel-text-button"].addEventListener("click",()=>el["text-dialog"].close());
el.playhead.addEventListener("input",()=>{finishAudition(false);setExactPlayhead(Number(el.playhead.value),true);});

el["media-preview"].addEventListener("loadedmetadata",()=>{
  const item=activeItem();
  if(!item||loadedPreviewId!==item.id||!Number.isFinite(el["media-preview"].duration))return;
  if(!item.duration){
    project=activeContext==="source"?updateSource(project,item.id,{duration:el["media-preview"].duration,outPoint:el["media-preview"].duration}):updateItem(project,item.id,{duration:el["media-preview"].duration,outPoint:el["media-preview"].duration});
    render();
    announce(`${activeContextLabel(item)} loaded. Duration ${readableTime(el["media-preview"].duration)}.`);
  }
});

el["media-preview"].addEventListener("timeupdate",()=>{
  const item=activeItem();if(!item)return;
  if(auditionState){
    if(el["media-preview"].currentTime>=auditionState.end){finishAudition(true);return;}
    el.playhead.value=String(el["media-preview"].currentTime);updatePlayhead(false);return;
  }
  const end=item.outPoint==null?Number(item.duration):Number(item.outPoint);
  if(el["media-preview"].currentTime>=end){
    el["media-preview"].pause();el["media-preview"].currentTime=end;el.playhead.value=String(end);updatePlayhead(true);
    if(outPointAnnouncedForId!==item.id){outPointAnnouncedForId=item.id;announce("Out mark reached. Playback paused.");}
  }else{
    outPointAnnouncedForId=null;el.playhead.value=String(el["media-preview"].currentTime);updatePlayhead(false);
  }
});

el["media-preview"].addEventListener("error",()=>announce("This file was opened, but the Windows preview engine could not decode it. Broader codec support is planned for the export engine.",true));
if(listen)listen("menu-action",event=>triggerAction(event.payload));
render();
el["import-media-button"].focus();
