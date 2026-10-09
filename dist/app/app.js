import {
  createProject, addItem, moveItem, removeItem, updateItem, splitItem,
  addSource, removeSource, updateSource, appendSourceSelection,
  insertSourceSelection, itemDuration, duration, serializable
} from "./projectModel.js";
import { initShortcuts, registerAction, triggerAction } from "./shortcutService.js";

const invoke=window.__TAURI__?.core?.invoke;
const listen=window.__TAURI__?.event?.listen;
const convertFileSrc=window.__TAURI__?.core?.convertFileSrc;
const el=Object.fromEntries([...document.querySelectorAll("[id]")].map(node=>[node.id,node]));

let project=createProject();
let selectedId=null;
let selectedSourceId=null;
let activeMediaId=null;
let activeWorkspace="media";
let activeSectionIndex=0;
let undoStack=[];
let redoStack=[];
let soundCues=localStorage.getItem("ame-sound-cues")==="on";
let lastNativeTitle="";
const editorStates=new Map();
const editorNodes=new Map();
let editorCounter=0;

function announce(message,urgent=false){
  const region=el[urgent?"alert-announcer":"status-announcer"];
  region.textContent="";
  requestAnimationFrame(()=>{region.textContent=message;});
  el["action-status"].textContent=message;
}
function updateStatus(message){el["action-status"].textContent=message;}

function cue(kind){
  if(!soundCues)return;
  const AudioContext=window.AudioContext||window.webkitAudioContext;if(!AudioContext)return;
  const context=new AudioContext(),oscillator=context.createOscillator(),gain=context.createGain();
  oscillator.frequency.value=kind==="save"?660:kind==="remove"?220:440;
  gain.gain.setValueAtTime(0.035,context.currentTime);gain.gain.exponentialRampToValueAtTime(0.001,context.currentTime+0.09);
  oscillator.connect(gain);gain.connect(context.destination);oscillator.start();oscillator.stop(context.currentTime+0.1);
}

function id(){return crypto.randomUUID?crypto.randomUUID():`item-${Date.now()}-${Math.random()}`;}
function baseName(path){return path.split(/[\\/]/).pop()||"Unnamed media";}
function displayName(item){return(item?.label||item?.name||"No media").replace(/\.[^.]+$/,"");}
function kindFromPath(path){
  const ext=path.split(".").pop().toLowerCase();
  if(["png","jpg","jpeg","gif","webp","bmp","tif","tiff","heic","heif"].includes(ext))return"Image";
  if(["mp3","wav","m4a","aac","flac","ogg","opus","wma","aif","aiff"].includes(ext))return"Audio";
  return"Video";
}
function readableTime(seconds){
  const total=Math.max(0,Math.round((Number(seconds)||0)*1000));
  const hours=Math.floor(total/3600000),minutes=Math.floor(total/60000)%60,whole=Math.floor(total/1000)%60,milliseconds=total%1000;
  const parts=[];if(hours)parts.push(`${hours} ${hours===1?"hour":"hours"}`);if(minutes)parts.push(`${minutes} ${minutes===1?"minute":"minutes"}`);
  parts.push(`${whole} ${whole===1?"second":"seconds"}`);if(milliseconds)parts.push(`${milliseconds} ${milliseconds===1?"millisecond":"milliseconds"}`);
  return parts.join(", ");
}
function timeParts(seconds){const total=Math.max(0,Math.round((Number(seconds)||0)*1000));return{hours:Math.floor(total/3600000),minutes:Math.floor(total/60000)%60,seconds:Math.floor(total/1000)%60,milliseconds:total%1000};}
function writeTime(prefix,seconds){Object.entries(timeParts(seconds)).forEach(([name,value])=>{el[`${prefix}-${name}`].value=String(value);});}
function readTime(prefix){const values=["hours","minutes","seconds","milliseconds"].map(name=>Number(el[`${prefix}-${name}`].value)||0);if(values.some(value=>value<0)||values[1]>59||values[2]>59||values[3]>999)return NaN;return values[0]*3600+values[1]*60+values[2]+values[3]/1000;}

function sequenceItem(idValue=selectedId){return project.items.find(item=>item.id===idValue)||null;}
function sourceItem(idValue=selectedSourceId){return(project.sources||[]).find(item=>item.id===idValue)||null;}
function locateItem(idValue){const sequence=sequenceItem(idValue);if(sequence)return{item:sequence,type:"sequence"};const source=sourceItem(idValue);return source?{item:source,type:"source"}:null;}
function activeLocation(){return locateItem(activeMediaId);}
function activeItem(){return activeLocation()?.item||null;}
function activeState(){return activeMediaId?editorStates.get(activeMediaId)||null:null;}
function itemTarget(item){return item?.kind==="Audio"?"audio":item?.trackTarget||"both";}
function targetText(target){return target==="audio"?"Audio only":target==="video"?"Video only":"Both audio and video";}
function mediaRoleLabel(item,type,index=0){
  if(type==="source")return`Source ${item.kind} ${index+1}`;
  if(item.role==="inserted")return`Inserted ${item.kind} segment ${index+1}`;
  return`Primary ${item.kind}`;
}
function editorTitle(item,type){
  const index=type==="source"?(project.sources||[]).findIndex(value=>value.id===item.id):project.items.findIndex(value=>value.id===item.id);
  return`${mediaRoleLabel(item,type,index)} - ${displayName(item)}`;
}
function itemSummary(item,index,source=false){
  const seconds=itemDuration(item),durationText=seconds>0?` Duration ${readableTime(seconds)}.`:" Duration not yet determined.";
  const trim=["Video","Audio"].includes(item.kind)&&item.duration?` In ${readableTime(Number(item.inPoint)||0)}. Out ${readableTime(item.outPoint==null?Number(item.duration):Number(item.outPoint))}.`:"";
  return`${source?`Source ${index+1}`:item.role==="inserted"?`Inserted segment ${index+1}`:`Primary sequence item ${index+1}`}. ${item.kind}. ${item.label||item.name}.${durationText}${trim}`;
}
function itemListLabel(item,index,source=false){
  const role=source?`Source ${index+1}`:item.role==="inserted"?`Inserted ${index+1}`:`Primary ${index+1}`;
  return`${role}. ${item.kind}. ${item.label||item.name}`;
}
function migrateProject(value){
  const next={...value,items:Array.isArray(value.items)?value.items:[],sources:Array.isArray(value.sources)?value.sources:[],version:2};
  if(next.items[0]&&!next.items[0].role)next.items[0].role="primary";
  next.items.slice(1).forEach(item=>{if(!item.role)item.role="sequence";});
  return next;
}
function updateLocated(idValue,patch){
  const location=locateItem(idValue);if(!location)return project;
  return location.type==="source"?updateSource(project,idValue,patch):updateItem(project,idValue,patch);
}
function rememberChange(next,message,focus=false){
  undoStack.push(project);if(undoStack.length>50)undoStack.shift();redoStack=[];project=next;render({focus});announce(message);
}

function getState(item){
  if(!editorStates.has(item.id))editorStates.set(item.id,{cursor:Number(item.inPoint)||0,audition:null});
  return editorStates.get(item.id);
}
function cancelAudition(state,reset=false){
  if(!state?.audition)return;
  clearTimeout(state.audition.timer);state.video.pause();
  const point=state.audition.returnPoint;state.audition=null;
  if(reset)setEditorPosition(state,point,true);
}
function setEditorPosition(state,point,expose=true){
  const location=locateItem(state.id);if(!location||!location.item.duration)return false;
  const next=Math.max(0,Math.min(Number(location.item.duration),Number(point)||0));
  state.cursor=next;state.slider.value=String(next);state.video.currentTime=next;
  if(expose)state.slider.setAttribute("aria-valuetext",readableTime(next));
  state.position.textContent=`Position ${readableTime(next)}. Media duration ${readableTime(itemDuration(location.item))}.`;
  return true;
}
function updateEditorLabels(state,item,type){
  const title=editorTitle(item,type);
  state.section.setAttribute("aria-label",title);
  state.heading.textContent=title;
  state.video.setAttribute("aria-label",`${title} preview`);
  state.sliderLabel.textContent=`${title} playhead`;
  state.context.textContent=`${targetText(itemTarget(item))} targeted. In ${readableTime(Number(item.inPoint)||0)}. Out ${readableTime(item.outPoint==null?Number(item.duration):Number(item.outPoint))}.`;
  state.video.muted=itemTarget(item)==="video";
  state.both.disabled=item.kind!=="Video";state.videoOnly.disabled=item.kind!=="Video";state.audioOnly.disabled=!["Video","Audio"].includes(item.kind);
}
function createEditor(item,type){
  const section=document.createElement("section");section.className="editor-section media-item-editor";section.tabIndex=-1;section.dataset.mediaId=item.id;
  const heading=document.createElement("h2");section.append(heading);
  const video=document.createElement("video");video.className="media-preview";video.preload="metadata";video.controls=true;section.append(video);
  const sliderLabel=document.createElement("label");const slider=document.createElement("input");const sliderId=`media-playhead-${++editorCounter}`;
  sliderLabel.htmlFor=sliderId;slider.id=sliderId;slider.type="range";slider.min="0";slider.max="0";slider.step="0.001";slider.value="0";section.append(sliderLabel,slider);
  const position=document.createElement("p"),context=document.createElement("p");section.append(position,context);
  const transport=document.createElement("div");transport.className="button-row";
  const play=document.createElement("button"),audition=document.createElement("button");
  play.type=audition.type="button";play.textContent="Play or Pause (X)";audition.textContent="Audition Around Playhead (Space)";transport.append(play,audition);section.append(transport);
  const edit=document.createElement("div");edit.className="button-row";
  const inButton=document.createElement("button"),outButton=document.createElement("button"),goto=document.createElement("button"),properties=document.createElement("button"),split=document.createElement("button");
  [inButton,outButton,goto,properties,split].forEach(button=>button.type="button");
  inButton.textContent="Set In Mark (Left Bracket)";outButton.textContent="Set Out Mark (Right Bracket)";goto.textContent="Go to Time (Ctrl+G)";properties.textContent="Properties (Alt+Enter)";split.textContent="Split at Playhead (Ctrl+K)";
  edit.append(inButton,outButton,goto,properties,split);section.append(edit);
  const fieldset=document.createElement("fieldset"),legend=document.createElement("legend"),targets=document.createElement("div");legend.textContent="Track target";targets.className="button-row";
  const both=document.createElement("button"),videoOnly=document.createElement("button"),audioOnly=document.createElement("button");
  [both,videoOnly,audioOnly].forEach(button=>button.type="button");both.textContent="Both Audio and Video (B)";videoOnly.textContent="Video Only (V)";audioOnly.textContent="Audio Only (A)";
  targets.append(both,videoOnly,audioOnly);fieldset.append(legend,targets);section.append(fieldset);
  el["media-editor-sections"].append(section);
  const state={id:item.id,type,section,heading,video,slider,sliderLabel,position,context,play,audition,inButton,outButton,goto,properties,split,both,videoOnly,audioOnly,cursor:Number(item.inPoint)||0,audition:null};
  editorStates.set(item.id,state);editorNodes.set(item.id,section);
  video.src=convertFileSrc?convertFileSrc(item.source):item.source;
  video.addEventListener("loadedmetadata",()=>handleMetadata(item.id,video.duration));
  video.addEventListener("timeupdate",()=>handleTimeUpdate(item.id));
  video.addEventListener("error",()=>announce(`${editorTitle(item,type)} could not be decoded by the Windows preview engine.`,true));
  section.addEventListener("focus",()=>activateMedia(item.id,false));
  slider.addEventListener("focus",()=>activateMedia(item.id,false));
  slider.addEventListener("input",()=>{activateMedia(item.id,false);cancelAudition(state,false);setEditorPosition(state,Number(slider.value),true);});
  play.addEventListener("click",()=>{activateMedia(item.id,false);togglePlayback();});
  audition.addEventListener("click",()=>{activateMedia(item.id,false);auditionAround();});
  inButton.addEventListener("click",()=>{activateMedia(item.id,false);setPoint("in");});
  outButton.addEventListener("click",()=>{activateMedia(item.id,false);setPoint("out");});
  goto.addEventListener("click",()=>{activateMedia(item.id,false);showGoToTime();});
  properties.addEventListener("click",()=>{activateMedia(item.id,false);showProperties();});
  split.addEventListener("click",()=>{activateMedia(item.id,false);splitSelected();});
  both.addEventListener("click",()=>{activateMedia(item.id,false);setTrackTarget("both");});
  videoOnly.addEventListener("click",()=>{activateMedia(item.id,false);setTrackTarget("video");});
  audioOnly.addEventListener("click",()=>{activateMedia(item.id,false);setTrackTarget("audio");});
  return state;
}
function handleMetadata(idValue,mediaDuration){
  if(!Number.isFinite(mediaDuration))return;
  const location=locateItem(idValue);if(!location||location.item.duration)return;
  project=location.type==="source"?updateSource(project,idValue,{duration:mediaDuration,outPoint:mediaDuration}):updateItem(project,idValue,{duration:mediaDuration,outPoint:mediaDuration});
  const state=editorStates.get(idValue);state.slider.max=String(mediaDuration);setEditorPosition(state,state.cursor,true);render();
  announce(`${editorTitle(locateItem(idValue).item,location.type)} loaded. Duration ${readableTime(mediaDuration)}.`);
}
function handleTimeUpdate(idValue){
  const state=editorStates.get(idValue),location=locateItem(idValue);if(!state||!location)return;
  if(state.audition){
    if(state.video.currentTime>=state.audition.end){
      const point=state.audition.returnPoint,quiet=state.audition.quiet;cancelAudition(state,false);setEditorPosition(state,point,true);if(!quiet)announce(`Audition complete. ${editorTitle(location.item,location.type)} playhead returned to ${readableTime(point)}.`);return;
    }
  }else{
    const end=location.item.outPoint==null?Number(location.item.duration):Number(location.item.outPoint);
    if(state.video.currentTime>=end&&!state.video.paused){state.video.pause();setEditorPosition(state,end,true);announce("Out mark reached. Paused.");return;}
  }
  state.cursor=state.video.currentTime;state.slider.value=String(state.cursor);state.position.textContent=`Position ${readableTime(state.cursor)}. Media duration ${readableTime(itemDuration(location.item))}.`;
}
function renderEditors(){
  const playable=[...project.items.map(item=>({item,type:"sequence"})),...(project.sources||[]).map(item=>({item,type:"source"}))].filter(({item})=>["Video","Audio"].includes(item.kind)&&item.source);
  const wanted=new Set(playable.map(({item})=>item.id));
  for(const [idValue,node]of editorNodes){if(!wanted.has(idValue)){node.remove();editorNodes.delete(idValue);editorStates.delete(idValue);}}
  playable.forEach(({item,type})=>{
    let state=editorStates.get(item.id);if(!state)state=createEditor(item,type);
    state.type=type;updateEditorLabels(state,item,type);state.slider.max=String(Number(item.duration)||0);setEditorPosition(state,state.cursor,true);
    el["media-editor-sections"].append(state.section);
  });
  if(activeMediaId&&!wanted.has(activeMediaId))activeMediaId=playable[0]?.item.id||null;
  if(!activeMediaId&&playable.length)activeMediaId=playable[0].item.id;
  updateActiveAppearance();
  renderEditorNavigation(playable);
}
function renderEditorNavigation(playable){
  el["media-editor-navigation"].replaceChildren();
  playable.forEach(({item,type})=>{
    const button=document.createElement("button");button.type="button";button.className="section-tab";button.textContent=editorTitle(item,type);
    button.addEventListener("click",()=>activateMedia(item.id,true));el["media-editor-navigation"].append(button);
  });
}
function updateActiveAppearance(){
  for(const [idValue,state]of editorStates)state.section.setAttribute("aria-current",String(idValue===activeMediaId));
}
function activateMedia(idValue,focus=true){
  const location=locateItem(idValue),state=editorStates.get(idValue);if(!location||!state)return;
  if(activeMediaId&&activeMediaId!==idValue){const old=editorStates.get(activeMediaId);if(old&&!old.video.paused)old.video.pause();}
  activeMediaId=idValue;if(location.type==="source")selectedSourceId=idValue;else selectedId=idValue;updateActiveAppearance();
  if(focus)state.section.focus();
  updateStatus(`${editorTitle(location.item,location.type)} active.`);
}

function render({focus=false}={}){
  el["project-items"].replaceChildren();
  if(!project.items.length){const option=new Option("No primary media","");option.disabled=true;el["project-items"].add(option);selectedId=null;}
  else{project.items.forEach((item,index)=>el["project-items"].add(new Option(itemListLabel(item,index,false),item.id)));if(!sequenceItem())selectedId=project.items[0].id;el["project-items"].value=selectedId;}
  const sources=project.sources||[];el["source-items"].replaceChildren();
  if(!sources.length){const option=new Option("No source media","");option.disabled=true;el["source-items"].add(option);selectedSourceId=null;}
  else{sources.forEach((item,index)=>el["source-items"].add(new Option(itemListLabel(item,index,true),item.id)));if(!sourceItem())selectedSourceId=sources[0].id;el["source-items"].value=selectedSourceId;}
  const selected=sequenceItem(),source=sourceItem(),index=project.items.findIndex(item=>item.id===selectedId);
  el["selected-item-summary"].textContent=selected?itemSummary(selected,index,false):"No primary media selected.";
  el["selected-source-summary"].textContent=source?itemSummary(source,sources.findIndex(item=>item.id===selectedSourceId),true):"No source media selected.";
  el["edit-primary-button"].disabled=!selected;el["move-earlier-button"].disabled=!selected||index===0;el["move-later-button"].disabled=!selected||index===project.items.length-1;el["remove-item-button"].disabled=!selected;
  el["activate-source-button"].disabled=!source;el["insert-source-button"].disabled=!source||!selected||!source.duration;el["append-source-button"].disabled=!source||!source.duration;el["remove-source-button"].disabled=!source;
  renderEditors();
  const primary=project.items.find(item=>item.role==="primary")||project.items[0];const workingName=project.path?project.name:primary?(primary.name||primary.label):"Accessible Media Editor";
  el["project-heading"].textContent=displayName({name:workingName});
  el["project-summary"].textContent=primary?`${project.items.length} primary sequence ${project.items.length===1?"item":"items"}. ${sources.length} source media ${sources.length===1?"item":"items"}. ${project.path?(project.dirty?"Project has unsaved changes.":"Project saved."):"No project required."}`:"No media open. Press Ctrl+O to begin.";
  el["output-summary"].textContent=primary?`Primary sequence duration ${readableTime(duration(project))}. Source media is excluded until inserted.`:"Open media to begin editing. Project creation is optional.";
  const title=`${project.dirty?"* ":""}${workingName}${workingName==="Accessible Media Editor"?"":" - Accessible Media Editor"}`;document.title=title;
  if(invoke&&title!==lastNativeTitle){lastNativeTitle=title;invoke("set_window_title",{title}).catch(()=>{});}
  if(focus)(locateItem(activeMediaId)?.type==="source"?el["source-items"]:el["project-items"]).focus();
}

function sectionElements(){return[el["media-section"],...[...el["media-editor-sections"].querySelectorAll(".media-item-editor")],el["output-section"]];}
function focusSection(offset){
  if(activeWorkspace!=="media")return announce("AudioStudio Pro does not have editor sections yet.");
  const sections=sectionElements();activeSectionIndex=(activeSectionIndex+offset+sections.length)%sections.length;const section=sections[activeSectionIndex];
  if(section.dataset.mediaId)activateMedia(section.dataset.mediaId,false);section.focus();
  updateStatus(`${section.querySelector("h2")?.textContent||"Media Library"} section.`);
}
function activateSection(sectionId){const section=el[sectionId];activeSectionIndex=sectionElements().indexOf(section);section.focus();updateStatus(`${section.querySelector("h2").textContent} section.`);}
function switchWorkspace(direction=1,target=null){
  const next=target||(activeWorkspace==="media"?"audio":"media");activeWorkspace=next;const media=next==="media";
  el["media-editor-tab"].setAttribute("aria-selected",String(media));el["audio-studio-tab"].setAttribute("aria-selected",String(!media));el["media-editor-tab"].tabIndex=media?0:-1;el["audio-studio-tab"].tabIndex=media?-1:0;
  el["media-editor-workspace"].hidden=!media;el["audio-studio-workspace"].hidden=media;(media?el["media-editor-workspace"]:el["audio-studio-workspace"]).focus();
  announce(media?"Media Editor workspace.":"AudioStudio Pro workspace. Professional tools are not implemented in this build.");
}

async function importMedia(){
  if(!invoke)return announce("The Windows file picker is available in the installed application.",true);
  try{
    const paths=await invoke("pick_media_files");if(!paths.length)return;const previous=project;let next=project,primaryAdded=false,sourceCount=0;
    paths.forEach(path=>{const kind=kindFromPath(path),media={id:id(),source:path,name:baseName(path),label:baseName(path),kind,duration:kind==="Image"?5:null,inPoint:0,outPoint:null,trackTarget:kind==="Audio"?"audio":"both"};
      if(!next.items.length&&!primaryAdded){media.role="primary";next=addItem(next,media,null);selectedId=media.id;activeMediaId=media.id;primaryAdded=true;}
      else{media.role="source";next=addSource(next,media);selectedSourceId=media.id;sourceCount++;}
    });
    project=next;undoStack.push(previous);render({focus:true});announce(primaryAdded?`Primary media opened. ${sourceCount} additional source ${sourceCount===1?"item":"items"} added. Primary remains active.`:`${sourceCount} source media ${sourceCount===1?"item":"items"} added. ${editorTitle(activeItem(),activeLocation().type)} remains active.`);cue("add");
  }catch(error){announce(`Media could not be opened. ${error}`,true);}
}
function newProject(){if(project.dirty&&!window.confirm("Discard unsaved changes and start a new editing session?"))return;project=createProject();selectedId=selectedSourceId=activeMediaId=null;editorStates.clear();editorNodes.clear();el["media-editor-sections"].replaceChildren();undoStack=[];redoStack=[];render();el["import-media-button"].focus();announce("New editing session. Press Ctrl+O to open primary media.");}
async function openProject(){
  if(project.dirty&&!window.confirm("Discard unsaved changes and open another project?"))return;
  try{const result=await invoke("open_project_dialog");if(!result)return;project=migrateProject(JSON.parse(result.content));project.path=result.path;project.dirty=false;selectedId=project.items[0]?.id||null;selectedSourceId=project.sources[0]?.id||null;activeMediaId=selectedId||selectedSourceId;editorStates.clear();editorNodes.clear();el["media-editor-sections"].replaceChildren();undoStack=[];redoStack=[];render({focus:true});announce(`${project.name} opened.`);}catch(error){announce(`Project could not be opened. ${error}`,true);}
}
async function saveProject(saveAs=false){
  try{const content=JSON.stringify(serializable(project),null,2),suggested=`${project.name.replace(/[^a-z0-9 -]/gi,"").trim()||"Untitled Project"}.ameproject`;const path=saveAs||!project.path?await invoke("save_project_dialog",{suggestedName:suggested,content}):await invoke("write_project",{path:project.path,content});if(!path)return;project.path=path;project.name=baseName(path).replace(/\.ameproject$/i,"");project.dirty=false;render();announce(`${project.name} saved.`);cue("save");}catch(error){announce(`Project could not be saved. ${error}`,true);}
}
function move(direction){const item=sequenceItem();if(!item)return announce("No sequence item selected.",true);const next=moveItem(project,item.id,direction);if(next===project)return announce(direction<0?"Already first.":"Already last.");rememberChange(next,`${item.label||item.name} moved ${direction<0?"earlier":"later"}.`,true);}
function removeSelected(){const item=sequenceItem();if(!item)return;const index=project.items.findIndex(value=>value.id===item.id),next=removeItem(project,item.id);selectedId=next.items[Math.min(index,next.items.length-1)]?.id||null;if(activeMediaId===item.id)activeMediaId=selectedId||selectedSourceId;rememberChange(next,`${item.label||item.name} removed from Primary Sequence.`,true);cue("remove");}
function removeSelectedSource(){const item=sourceItem();if(!item)return;const next=removeSource(project,item.id);selectedSourceId=next.sources[0]?.id||null;if(activeMediaId===item.id)activeMediaId=selectedId||selectedSourceId;rememberChange(next,`${item.label||item.name} removed from Source Media. Original file unchanged.`,true);cue("remove");}
function removeActive(){return activeLocation()?.type==="source"?removeSelectedSource():removeSelected();}
function insertSelectedSource(atEnd=false){
  const source=sourceItem(),target=sequenceItem();if(!source||!source.duration)return announce("Select and load Source Media first.",true);if(!atEnd&&!target)return announce("Select a Primary Sequence item first.",true);
  const inserted=id();let next;
  if(atEnd)next=appendSourceSelection(project,source,inserted);
  else{const targetState=editorStates.get(target.id),point=targetState?.cursor??(Number(target.inPoint)||0);next=insertSourceSelection(project,target.id,point,source,id(),inserted,id());if(next===project)return announce("Selection could not be inserted.",true);}
  selectedId=inserted;activeMediaId=inserted;rememberChange(next,atEnd?"Source selection added to end.":"Source selection inserted at Primary playhead.",true);cue("add");
}
function showProperties(){const location=activeLocation(),item=location?.item;if(!item)return announce("No media editor active.",true);el["properties-name"].textContent=editorTitle(item,location.type);el["item-label"].value=item.label||item.name;el["item-duration"].value=item.duration??"";const media=["Video","Audio"].includes(item.kind);el["item-duration"].readOnly=media;el["trim-fields"].hidden=!media;writeTime("item-in",Number(item.inPoint)||0);writeTime("item-out",item.outPoint==null?Number(item.duration)||0:Number(item.outPoint));el["properties-dialog"].showModal();el["item-label"].focus();}
function saveProperties(){const location=activeLocation(),item=location?.item;if(!item)return;const value=Number(el["item-duration"].value),media=["Video","Audio"].includes(item.kind),start=readTime("item-in"),end=readTime("item-out");if(!media&&(!Number.isFinite(value)||value<0.001))return announce("Enter a valid duration.",true);if(media&&(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end>value))return announce("Enter valid In and Out times.",true);const patch={label:el["item-label"].value.trim()||item.name,duration:value};if(media){patch.inPoint=start;patch.outPoint=end;}el["properties-dialog"].close();rememberChange(updateLocated(item.id,patch),"Media properties saved.");}
function showTextDialog(){el["text-content"].value="";el["text-duration"].value="5";el["text-dialog"].showModal();el["text-content"].focus();}
function saveText(){const text=el["text-content"].value.trim(),seconds=Number(el["text-duration"].value);if(!text||!Number.isFinite(seconds)||seconds<0.1)return announce("Enter text and a valid duration.",true);const after=selectedId,item={id:id(),source:null,name:text.slice(0,40),label:text.slice(0,40),kind:"Text",text,duration:seconds,role:"sequence"};selectedId=item.id;el["text-dialog"].close();rememberChange(addItem(project,item,after),"Text item added.",true);}
function addTransition(){const after=selectedId,item={id:id(),source:null,name:"Crossfade",label:"Crossfade",kind:"Transition",duration:1,role:"sequence"};selectedId=item.id;rememberChange(addItem(project,item,after),"Crossfade added.",true);}
function undo(){if(!undoStack.length)return announce("Nothing to undo.");redoStack.push(project);project=undoStack.pop();selectedId=project.items[0]?.id||null;selectedSourceId=project.sources?.[0]?.id||null;activeMediaId=selectedId||selectedSourceId;render({focus:true});announce("Undo completed.");}
function redo(){if(!redoStack.length)return announce("Nothing to redo.");undoStack.push(project);project=redoStack.pop();selectedId=project.items[0]?.id||null;selectedSourceId=project.sources?.[0]?.id||null;activeMediaId=selectedId||selectedSourceId;render({focus:true});announce("Redo completed.");}

async function togglePlayback(){
  const location=activeLocation(),state=activeState();if(!location||!state)return announce("Activate a media editor first.",true);cancelAudition(state,true);
  if(state.video.paused){const end=location.item.outPoint==null?Number(location.item.duration):Number(location.item.outPoint);if(state.cursor>=end)setEditorPosition(state,Number(location.item.inPoint)||0,true);try{await state.video.play();announce("Playing.");}catch(error){announce(`Playback failed. ${error}`,true);}}
  else{state.video.pause();setEditorPosition(state,state.video.currentTime,true);announce(`Paused at ${readableTime(state.cursor)}.`);}
}
async function auditionAround(before=1,after=1,quiet=false){
  const location=activeLocation(),state=activeState();if(!location||!state)return announce("Activate a media editor first.",true);cancelAudition(state,true);if(!state.video.paused)state.video.pause();
  const point=state.cursor,lower=Number(location.item.inPoint)||0,upper=location.item.outPoint==null?Number(location.item.duration):Number(location.item.outPoint),start=Math.max(lower,point-before),end=Math.min(upper,point+after);
  state.video.currentTime=start;const timer=setTimeout(()=>{if(state.audition){cancelAudition(state,true);if(!quiet)announce(`Audition complete. ${editorTitle(location.item,location.type)} returned to ${readableTime(point)}.`);}},Math.max(300,(end-start)*1000+500));state.audition={returnPoint:point,end,timer,quiet};
  try{await state.video.play();if(!quiet)announce(`Auditioning ${editorTitle(location.item,location.type)} around ${readableTime(point)}.`);}catch(error){cancelAudition(state,true);announce(`Audition failed. ${error}`,true);}
}
function movePlayhead(amount,label="Playhead"){const location=activeLocation(),state=activeState();if(!location||!state)return announce("Activate a media editor first.",true);cancelAudition(state,false);setEditorPosition(state,state.cursor+amount,true);announce(`${editorTitle(location.item,location.type)}. ${label} ${readableTime(state.cursor)}.`);}
function scrub(amount){const state=activeState();if(!state)return announce("Activate a media editor first.",true);cancelAudition(state,false);setEditorPosition(state,state.cursor+amount,true);auditionAround(0,0.2,true);}
function jumpPlayhead(end=false){const location=activeLocation(),state=activeState();if(!location||!state)return announce("Activate a media editor first.",true);setEditorPosition(state,end?Number(location.item.duration):0,true);announce(`${editorTitle(location.item,location.type)}. ${end?"End":"Beginning"} ${readableTime(state.cursor)}.`);}
function setPoint(which){const location=activeLocation(),state=activeState();if(!location||!state)return announce("Activate a media editor first.",true);const item=location.item,point=state.cursor,start=Number(item.inPoint)||0,end=item.outPoint==null?Number(item.duration):Number(item.outPoint);if(which==="in"&&point>=end)return announce("In must precede Out.",true);if(which==="out"&&point<=start)return announce("Out must follow In.",true);rememberChange(updateLocated(item.id,which==="in"?{inPoint:point}:{outPoint:point}),`${which==="in"?"In":"Out"} mark set to ${readableTime(point)}.`);}
function setTrackTarget(target){const location=activeLocation();if(!location)return announce("Activate a media editor first.",true);if(location.item.kind==="Audio"&&target!=="audio")return announce("Audio media always targets audio.");rememberChange(updateLocated(location.item.id,{trackTarget:target}),`${targetText(target)} targeted.`);}
function showGoToTime(){const state=activeState();if(!state)return announce("Activate a media editor first.",true);writeTime("goto",state.cursor);el["go-to-time-dialog"].showModal();el["goto-hours"].focus();}
function confirmGoToTime(){const state=activeState(),location=activeLocation(),point=readTime("goto");if(!state||!location||!Number.isFinite(point)||point>Number(location.item.duration))return announce("Enter a valid time.",true);el["go-to-time-dialog"].close();setEditorPosition(state,point,true);state.slider.focus();announce(`Playhead moved to ${readableTime(point)}.`);}
function splitSelected(){const location=activeLocation(),state=activeState();if(!location||location.type!=="sequence")return announce("Activate a Primary Sequence editor before splitting.",true);const newId=id(),next=splitItem(project,location.item.id,state.cursor,newId);if(next===project)return announce("Move between In and Out before splitting.",true);selectedId=newId;activeMediaId=newId;rememberChange(next,`Split at ${readableTime(state.cursor)}. Part 2 active.`,true);}
function cancel(){const state=activeState();if(el["properties-dialog"].open)el["properties-dialog"].close();else if(el["text-dialog"].open)el["text-dialog"].close();else if(el["go-to-time-dialog"].open)el["go-to-time-dialog"].close();else if(state?.audition){cancelAudition(state,true);announce("Audition canceled.");}else announce("No temporary operation to cancel.");}

const actions={
  newProject,openProject,saveProject:()=>saveProject(false),saveProjectAs:()=>saveProject(true),importMedia,
  previousWorkspace:()=>switchWorkspace(-1),nextWorkspace:()=>switchWorkspace(1),showMediaWorkspace:()=>switchWorkspace(1,"media"),showAudioWorkspace:()=>switchWorkspace(1,"audio"),
  previousSection:()=>focusSection(-1),nextSection:()=>focusSection(1),openProjectsFolder:async()=>{try{await invoke("open_projects_folder");announce("Projects folder opened.");}catch(error){announce(String(error),true);}},
  addText:showTextDialog,addTransition,moveEarlier:()=>move(-1),moveLater:()=>move(1),properties:showProperties,removeItem:removeActive,split:splitSelected,undo,redo,
  preview:togglePlayback,playPause:togglePlayback,audition:()=>auditionAround(),setIn:()=>setPoint("in"),setOut:()=>setPoint("out"),goToTime:showGoToTime,
  scrubBack1:()=>scrub(-1),scrubForward1:()=>scrub(1),scrubBack100ms:()=>scrub(-0.1),scrubForward100ms:()=>scrub(0.1),scrubBack10ms:()=>scrub(-0.01),scrubForward10ms:()=>scrub(0.01),
  moveBack5:()=>movePlayhead(-5),moveForward5:()=>movePlayhead(5),moveBack30:()=>movePlayhead(-30),moveForward30:()=>movePlayhead(30),moveBack300:()=>movePlayhead(-300),moveForward300:()=>movePlayhead(300),nudgeBack:()=>movePlayhead(-0.001),nudgeForward:()=>movePlayhead(0.001),
  jumpBeginning:()=>jumpPlayhead(false),jumpEnd:()=>jumpPlayhead(true),targetBoth:()=>setTrackTarget("both"),targetVideo:()=>setTrackTarget("video"),targetAudio:()=>setTrackTarget("audio"),cancel,stop:cancel,
  focusProjectItems:()=>{el["project-items"].focus();announce("Primary Sequence. Press Enter to open the selected media editor.");},
  focusPlayhead:()=>{const state=activeState();if(!state)return announce("No media editor active.");state.slider.focus();updateStatus(`Playhead ${readableTime(state.cursor)}.`);},
  showShortcuts:()=>{el["shortcuts-dialog"].showModal();el["shortcuts-dialog"].querySelector("button").focus();},showTestingGuide:()=>{el["testing-guide-dialog"].showModal();el["testing-guide-dialog"].querySelector("button").focus();},
  toggleSoundCues:()=>{soundCues=!soundCues;localStorage.setItem("ame-sound-cues",soundCues?"on":"off");announce(`Sound cues ${soundCues?"on":"off"}.`);},showAbout:()=>announce("Accessible Media Editor Build 0.4.3. Quiet interaction mode and a dedicated editor for every media item.")
};
Object.entries(actions).forEach(([name,handler])=>registerAction(name,handler));initShortcuts();

el["project-items"].addEventListener("change",()=>{selectedId=el["project-items"].value||null;if(selectedId)activateMedia(selectedId,false);});
el["project-items"].addEventListener("focus",()=>{if(selectedId)activateMedia(selectedId,false);});
el["project-items"].addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();activateMedia(selectedId,true);}});
el["source-items"].addEventListener("change",()=>{selectedSourceId=el["source-items"].value||null;if(selectedSourceId)activateMedia(selectedSourceId,false);});
el["source-items"].addEventListener("focus",()=>{if(selectedSourceId)activateMedia(selectedSourceId,false);});
el["source-items"].addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();activateMedia(selectedSourceId,true);}});
el["import-media-button"].addEventListener("click",importMedia);el["edit-primary-button"].addEventListener("click",()=>activateMedia(selectedId,true));el["activate-source-button"].addEventListener("click",()=>activateMedia(selectedSourceId,true));
el["add-text-button"].addEventListener("click",showTextDialog);el["move-earlier-button"].addEventListener("click",()=>move(-1));el["move-later-button"].addEventListener("click",()=>move(1));el["remove-item-button"].addEventListener("click",removeSelected);
el["insert-source-button"].addEventListener("click",()=>insertSelectedSource(false));el["append-source-button"].addEventListener("click",()=>insertSelectedSource(true));el["remove-source-button"].addEventListener("click",removeSelectedSource);
el["save-project-button"].addEventListener("click",()=>saveProject(true));el["media-editor-tab"].addEventListener("click",()=>switchWorkspace(1,"media"));el["audio-studio-tab"].addEventListener("click",()=>switchWorkspace(1,"audio"));
el["media-section-tab"].addEventListener("click",()=>activateSection("media-section"));el["output-section-tab"].addEventListener("click",()=>activateSection("output-section"));
document.querySelectorAll('[role="tab"]').forEach(tab=>tab.addEventListener("keydown",event=>{if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;event.preventDefault();event.stopPropagation();const target=event.key==="ArrowLeft"||event.key==="Home"?"media":"audio";switchWorkspace(1,target);el[target==="media"?"media-editor-tab":"audio-studio-tab"].focus();}));
el["save-properties-button"].addEventListener("click",saveProperties);el["cancel-properties-button"].addEventListener("click",()=>el["properties-dialog"].close());el["save-text-button"].addEventListener("click",saveText);el["cancel-text-button"].addEventListener("click",()=>el["text-dialog"].close());
el["go-to-time-confirm"].addEventListener("click",confirmGoToTime);el["go-to-time-cancel"].addEventListener("click",()=>el["go-to-time-dialog"].close());
if(listen)listen("menu-action",event=>triggerAction(event.payload));
render();el["import-media-button"].focus();
