import {
  createProject, addItem, moveItem, removeItem, updateItem, splitItem,
  addSource, removeSource, updateSource, appendSourceSelection,
  insertSourceSelection, itemDuration, duration, serializable, normalizedSegments,
  logicalDuration, logicalToSourceTime, sourceToLogicalTime, removeLogicalRange,
  bracketSelectionRange
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
const PROGRAM_ID="primary-production";
let mediaClipboard=null;
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
function locateItem(idValue){if(idValue===PROGRAM_ID)return project.items.length?{item:project.items[0],type:"program"}:null;const sequence=sequenceItem(idValue);if(sequence)return{item:sequence,type:"sequence"};const source=sourceItem(idValue);return source?{item:source,type:"source"}:null;}
function activeLocation(){return locateItem(activeMediaId);}
function activeItem(){return activeLocation()?.item||null;}
function activeState(){return activeMediaId?editorStates.get(activeMediaId)||null:null;}
function editorBounds(item,type){
  const durationValue=Number(item?.duration)||0;
  if(type==="program")return{start:0,end:duration(project)};
  if(type==="sequence"&&Array.isArray(item.editSegments)&&item.editSegments.length)return{start:0,end:logicalDuration(item)};
  if(type!=="sequence")return{start:0,end:durationValue};
  return{start:0,end:itemDuration(item)};
}
function itemTarget(item){return item?.kind==="Audio"?"audio":item?.trackTarget||"both";}
function targetText(target){return target==="audio"?"Audio only":target==="video"?"Video only":"Both audio and video";}
function mediaRoleLabel(item,type,index=0){
  if(type==="source")return`Source ${item.kind} ${index+1}`;
  if(item.role==="inserted")return`Inserted ${item.kind} segment ${index+1}`;
  return`Primary ${item.kind}`;
}
function editorTitle(item,type){
  if(type==="program")return"Primary Production";
  const index=type==="source"?(project.sources||[]).findIndex(value=>value.id===item.id):project.items.findIndex(value=>value.id===item.id);
  return`${mediaRoleLabel(item,type,index)} - ${displayName(item)}`;
}
function itemSummary(item,index,source=false){
  const seconds=itemDuration(item),durationText=seconds>0?(source?` Selection duration ${readableTime(seconds)}. Full media duration ${readableTime(item.duration)}.`:` Duration ${readableTime(seconds)}.`):" Duration not yet determined.";
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
function sequencePoint(globalTime){
  const total=duration(project),point=Math.max(0,Math.min(total,Number(globalTime)||0));let offset=0;
  for(let index=0;index<project.items.length;index++){
    const item=project.items[index],length=itemDuration(item),end=offset+length;
    if(point<end||(point===end&&index===project.items.length-1))return{item,index,offset,local:Math.max(0,Math.min(length,point-offset))};
    offset=end;
  }
  const index=Math.max(0,project.items.length-1),item=project.items[index];return item?{item,index,offset:Math.max(0,total-itemDuration(item)),local:itemDuration(item)}:null;
}
function sourceForItem(item){return convertFileSrc?convertFileSrc(item.source):item.source;}
function setProgramMedia(state,point,autoplay=false){
  const target=sequencePoint(point);if(!target)return false;const source=sourceForItem(target.item),sourceTime=logicalToSourceTime(target.item,target.local);
  state.currentItemId=target.item.id;state.currentItemOffset=target.offset;state.pendingSourceTime=sourceTime;state.video.muted=itemTarget(target.item)==="video";
  if(state.video.dataset.sourcePath!==target.item.source){state.video.dataset.sourcePath=target.item.source;state.pendingAutoplay=autoplay;state.video.src=source;state.video.load();}
  else{state.video.currentTime=sourceTime;if(autoplay)state.video.play().catch(()=>{});}
  return true;
}
function setEditorPosition(state,point,expose=true){
  const location=locateItem(state.id);if(!location||!location.item.duration)return false;
  const bounds=editorBounds(location.item,location.type),next=Math.max(bounds.start,Math.min(bounds.end,Number(point)||0));
  state.cursor=next;state.slider.value=String(next);
  if(next<bounds.end-0.0005)state.endReached=false;
  if(location.type==="program")setProgramMedia(state,next,false);else state.video.currentTime=location.type==="sequence"?logicalToSourceTime(location.item,next):next;
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
  const edited=type==="sequence"&&Array.isArray(item.editSegments)&&item.editSegments.length,markText=`Left bracket ${state.markIn==null?"not set":readableTime(state.markIn)}. Right bracket ${state.markOut==null?"not set":readableTime(state.markOut)}.`;
  state.context.textContent=type==="program"?`${project.items.length} production ${project.items.length===1?"item":"items"}. Total duration ${readableTime(duration(project))}. ${markText}`:edited?`${targetText(itemTarget(item))} targeted. Edited duration ${readableTime(itemDuration(item))}. ${item.editSegments.length} retained ${item.editSegments.length===1?"segment":"segments"}. ${markText}`:`${targetText(itemTarget(item))} targeted. ${markText}`;
  state.inButton.textContent="Set Left Bracket";
  state.outButton.textContent="Set Right Bracket";
  state.video.muted=itemTarget(item)==="video";
  const source=type==="source",program=type==="program";
  state.insertSelection.hidden=!source&&!program;state.appendSelection.hidden=!source;state.commitButton.hidden=!program;
  state.insertSelection.textContent=source?"Copy Selection (Ctrl+C)":"Paste at Playhead (Ctrl+V)";
  state.appendSelection.textContent="Remove Source from Project";
  const unavailable=state.loading||state.unsupported;
  state.insertSelection.disabled=unavailable||(source?!item.duration:!mediaClipboard);state.appendSelection.disabled=!source;
  state.play.disabled=unavailable;state.auditionButton.disabled=unavailable;state.slider.disabled=unavailable;
  state.commitButton.disabled=!program||unavailable||state.rendering;
  state.split.hidden=true;state.properties.hidden=program;
  state.both.disabled=item.kind!=="Video";state.videoOnly.disabled=item.kind!=="Video";state.audioOnly.disabled=!["Video","Audio"].includes(item.kind);
}
function createEditor(item,type){
  const stateId=type==="program"?PROGRAM_ID:item.id;
  const section=document.createElement("section");section.className="editor-section media-item-editor";section.tabIndex=-1;section.dataset.mediaId=stateId;
  const heading=document.createElement("h2");section.append(heading);
  const video=document.createElement("video");video.className="media-preview";video.preload="metadata";video.controls=false;video.tabIndex=-1;video.setAttribute("aria-hidden","true");section.append(video);
  const sliderLabel=document.createElement("label");const slider=document.createElement("input");const sliderId=`media-playhead-${++editorCounter}`;
  sliderLabel.htmlFor=sliderId;slider.id=sliderId;slider.type="range";slider.min="0";slider.max="0";slider.step="0.001";slider.value="0";section.append(sliderLabel,slider);
  const position=document.createElement("p"),context=document.createElement("p");section.append(position,context);
  const transport=document.createElement("div");transport.className="button-row";
  const play=document.createElement("button"),audition=document.createElement("button");
  play.type=audition.type="button";play.textContent="Play or Pause (X)";audition.textContent="Audition Around Playhead (Space)";transport.append(play,audition);section.append(transport);
  const edit=document.createElement("div");edit.className="button-row";
  const inButton=document.createElement("button"),outButton=document.createElement("button"),commitButton=document.createElement("button"),goto=document.createElement("button"),properties=document.createElement("button"),split=document.createElement("button");
  [inButton,outButton,commitButton,goto,properties,split].forEach(button=>button.type="button");
  inButton.textContent="Set In Mark (Left Bracket)";outButton.textContent="Set Out Mark (Right Bracket)";commitButton.textContent="Apply Marked Edit (Ctrl+Delete)";goto.textContent="Go to Time (Ctrl+G)";properties.textContent="Properties (Alt+Enter)";split.textContent="Split at Playhead (Ctrl+K)";
  edit.append(inButton,outButton,commitButton,goto,properties,split);section.append(edit);
  const workflow=document.createElement("div");workflow.className="button-row";
  const insertSelection=document.createElement("button"),appendSelection=document.createElement("button");
  [insertSelection,appendSelection].forEach(button=>button.type="button");
  insertSelection.textContent="Copy Selection (Ctrl+C)";appendSelection.textContent="Remove Source from Project";
  workflow.append(insertSelection,appendSelection);section.append(workflow);
  const fieldset=document.createElement("fieldset"),legend=document.createElement("legend"),targets=document.createElement("div");legend.textContent="Track target";targets.className="button-row";
  const both=document.createElement("button"),videoOnly=document.createElement("button"),audioOnly=document.createElement("button");
  [both,videoOnly,audioOnly].forEach(button=>button.type="button");both.textContent="Both Audio and Video (B)";videoOnly.textContent="Video Only (V)";audioOnly.textContent="Audio Only (A)";
  targets.append(both,videoOnly,audioOnly);fieldset.append(legend,targets);section.append(fieldset);
  el["media-editor-sections"].append(section);
  const state={id:stateId,type,section,heading,video,slider,sliderLabel,position,context,play,auditionButton:audition,inButton,outButton,commitButton,goto,properties,split,insertSelection,appendSelection,both,videoOnly,audioOnly,cursor:0,markIn:null,markOut:null,markHistory:[],audition:null,unsupported:false,loading:!item.duration,rendering:false,monitoring:false,endReached:false,currentItemId:type==="program"?item.id:null,currentItemOffset:0,pendingSourceTime:0,pendingAutoplay:false};
  editorStates.set(stateId,state);editorNodes.set(stateId,section);
  if(state.loading)position.textContent="Loading media. Please wait.";
  video.dataset.sourcePath=item.source;video.src=sourceForItem(item);
  video.addEventListener("loadedmetadata",()=>{if(type==="program"){
    const current=project.items.find(value=>value.id===state.currentItemId);if(current&&!current.duration&&Number.isFinite(video.duration)){project=updateItem(project,current.id,{duration:video.duration,inPoint:0,outPoint:video.duration,editSegments:[{start:0,end:video.duration}]});state.loading=false;render();announce(`Primary Production loaded. Duration ${readableTime(duration(project))}.`);}
    video.currentTime=state.pendingSourceTime||0;if(state.pendingAutoplay){state.pendingAutoplay=false;video.play().catch(()=>{});}
  }else handleMetadata(stateId,video.duration);});
  video.addEventListener("timeupdate",()=>handleTimeUpdate(stateId));
  video.addEventListener("ended",()=>{if(type!=="program")return;const current=project.items.find(value=>value.id===state.currentItemId),index=project.items.findIndex(value=>value.id===state.currentItemId);if(current&&index<project.items.length-1){const nextPoint=(state.currentItemOffset||0)+itemDuration(current);state.cursor=nextPoint;state.endReached=false;setProgramMedia(state,nextPoint,true);}else finishAtEnd(state,duration(project));});
  video.addEventListener("play",()=>{state.endReached=false;monitorPlayback(stateId);});
  video.addEventListener("error",()=>handlePreviewError(stateId));
  section.addEventListener("focus",()=>{activateMedia(stateId,false);activeSectionIndex=sectionElements().indexOf(section);});
  slider.addEventListener("focus",()=>activateMedia(stateId,false));
  slider.addEventListener("input",()=>{activateMedia(stateId,false);cancelAudition(state,false);setEditorPosition(state,Number(slider.value),true);});
  play.addEventListener("click",()=>{activateMedia(stateId,false);togglePlayback();});
  audition.addEventListener("click",()=>{activateMedia(stateId,false);auditionAround();});
  inButton.addEventListener("click",()=>{activateMedia(stateId,false);setPoint("in");});
  outButton.addEventListener("click",()=>{activateMedia(stateId,false);setPoint("out");});
  commitButton.addEventListener("click",()=>{activateMedia(stateId,false);commitPrimaryEdit();});
  goto.addEventListener("click",()=>{activateMedia(stateId,false);showGoToTime();});
  properties.addEventListener("click",()=>{activateMedia(stateId,false);showProperties();});
  split.addEventListener("click",()=>{activateMedia(stateId,false);splitSelected();});
  insertSelection.addEventListener("click",()=>{activateMedia(stateId,false);type==="source"?copySourceSelection():pasteMediaClipboard();});
  appendSelection.addEventListener("click",()=>{activateMedia(stateId,false);removeSelectedSource();});
  both.addEventListener("click",()=>{activateMedia(stateId,false);setTrackTarget("both");});
  videoOnly.addEventListener("click",()=>{activateMedia(stateId,false);setTrackTarget("video");});
  audioOnly.addEventListener("click",()=>{activateMedia(stateId,false);setTrackTarget("audio");});
  return state;
}
function monitorPlayback(idValue){
  const state=editorStates.get(idValue);if(!state||state.monitoring)return;state.monitoring=true;
  const tick=()=>{const current=editorStates.get(idValue);if(!current||current.video.paused){if(current)current.monitoring=false;return;}handleTimeUpdate(idValue);requestAnimationFrame(tick);};
  requestAnimationFrame(tick);
}
function finishAtEnd(state,total){
  state.video.pause();state.cursor=total;state.slider.value=String(total);state.slider.setAttribute("aria-valuetext",readableTime(total));
  state.position.textContent=`Position ${readableTime(total)}. Media duration ${readableTime(total)}.`;
  if(!state.endReached){state.endReached=true;announce("End reached.");}
}
function handleMetadata(idValue,mediaDuration){
  if(!Number.isFinite(mediaDuration))return;
  const location=locateItem(idValue);if(!location||location.item.duration)return;
  project=location.type==="source"?updateSource(project,idValue,{duration:mediaDuration,outPoint:mediaDuration}):updateItem(project,idValue,{duration:mediaDuration,inPoint:0,outPoint:mediaDuration,editSegments:[{start:0,end:mediaDuration}]});
  const state=editorStates.get(idValue);state.loading=false;state.slider.max=String(mediaDuration);setEditorPosition(state,state.cursor,true);render();
  const loaded=locateItem(idValue).item,index=location.type==="source"?(project.sources||[]).findIndex(value=>value.id===idValue):project.items.findIndex(value=>value.id===idValue);
  announce(`${mediaRoleLabel(loaded,location.type,index)} loaded. Duration ${readableTime(mediaDuration)}.`);
}
function handlePreviewError(idValue){
  const state=editorStates.get(idValue),location=locateItem(idValue);if(!state||!location||state.unsupported)return;
  state.loading=false;state.unsupported=true;const extension=(location.item.source.split(".").pop()||"this format").toUpperCase();
  state.position.textContent=`${extension} preview is not supported by the current Windows media engine. Conversion is required.`;
  updateEditorLabels(state,location.item,location.type);
  announce(`${extension} preview is not supported yet. Conversion is required.`,true);
}
function handleTimeUpdate(idValue){
  const state=editorStates.get(idValue),location=locateItem(idValue);if(!state||!location)return;
  const currentProgramItem=location.type==="program"?project.items.find(item=>item.id===state.currentItemId):null;
  const logicalNow=location.type==="program"?(state.currentItemOffset||0)+(currentProgramItem?sourceToLogicalTime(currentProgramItem,state.video.currentTime):0):location.type==="sequence"?sourceToLogicalTime(location.item,state.video.currentTime):state.video.currentTime;
  if(state.audition){
    if(logicalNow>=state.audition.end){
      const point=state.audition.returnPoint,quiet=state.audition.quiet;cancelAudition(state,false);setEditorPosition(state,point,true);if(!quiet)announce(`Returned to ${readableTime(point)}.`);return;
    }
  }else if(location.type==="program"&&currentProgramItem){
    const segments=normalizedSegments(currentProgramItem),sourceTime=state.video.currentTime,currentSegment=segments.findIndex(segment=>sourceTime>=segment.start-0.02&&sourceTime<segment.end-0.01);
    if(currentSegment<0&&!state.video.paused){
      const nextSegment=segments.find(segment=>sourceTime<segment.start);
      if(nextSegment){state.video.currentTime=nextSegment.start;return;}
      const currentIndex=project.items.findIndex(item=>item.id===currentProgramItem.id);
      if(currentIndex<project.items.length-1){const nextPoint=(state.currentItemOffset||0)+itemDuration(currentProgramItem);state.cursor=nextPoint;setProgramMedia(state,nextPoint,true);return;}
      finishAtEnd(state,duration(project));return;
    }
  }else if(location.type==="sequence"&&Array.isArray(location.item.editSegments)&&location.item.editSegments.length){
    const segments=normalizedSegments(location.item),sourceTime=state.video.currentTime;
    const currentIndex=segments.findIndex(segment=>sourceTime>=segment.start-0.02&&sourceTime<segment.end-0.01);
    if(currentIndex<0&&!state.video.paused){
      const nextIndex=segments.findIndex(segment=>sourceTime<segment.start);
      if(nextIndex>=0){state.video.currentTime=segments[nextIndex].start;state.cursor=sourceToLogicalTime(location.item,segments[nextIndex].start);return;}
      finishAtEnd(state,logicalDuration(location.item));return;
    }
  }else{
    const end=location.item.outPoint==null?Number(location.item.duration):Number(location.item.outPoint);
    if(state.video.currentTime>=end&&!state.video.paused){finishAtEnd(state,end);return;}
  }
  state.cursor=logicalNow;state.slider.value=String(state.cursor);state.position.textContent=`Position ${readableTime(state.cursor)}. Media duration ${readableTime(location.type==="program"?duration(project):itemDuration(location.item))}.`;
}
function renderEditors(){
  const primary=project.items[0];const playable=[...(primary?[{item:primary,type:"program",stateId:PROGRAM_ID}]:[]),...(project.sources||[]).map(item=>({item,type:"source",stateId:item.id}))].filter(({item})=>["Video","Audio"].includes(item.kind)&&item.source);
  const wanted=new Set(playable.map(value=>value.stateId));
  for(const [idValue,node]of editorNodes){if(!wanted.has(idValue)){node.remove();editorNodes.delete(idValue);editorStates.delete(idValue);}}
  playable.forEach(({item,type,stateId})=>{
    let state=editorStates.get(stateId);if(!state)state=createEditor(item,type);
    const bounds=editorBounds(item,type);state.type=type;updateEditorLabels(state,item,type);state.slider.min=String(bounds.start);state.slider.max=String(bounds.end);setEditorPosition(state,state.cursor,true);
    el["media-editor-sections"].append(state.section);
  });
  if(activeMediaId&&!wanted.has(activeMediaId))activeMediaId=playable[0]?.stateId||null;
  if(!activeMediaId&&playable.length)activeMediaId=playable[0].stateId;
  updateActiveAppearance();
  renderEditorNavigation(playable);
}
function renderEditorNavigation(playable){
  el["media-editor-navigation"].replaceChildren();
  playable.forEach(({item,type,stateId})=>{
    const button=document.createElement("button");button.type="button";button.className="section-tab";button.textContent=editorTitle(item,type);
    button.addEventListener("click",()=>activateMedia(stateId,true));el["media-editor-navigation"].append(button);
  });
}
function updateActiveAppearance(){
  for(const [idValue,state]of editorStates)state.section.setAttribute("aria-current",String(idValue===activeMediaId));
}
function activateMedia(idValue,focus=true){
  const location=locateItem(idValue),state=editorStates.get(idValue);if(!location||!state)return;
  if(activeMediaId&&activeMediaId!==idValue){const old=editorStates.get(activeMediaId);if(old&&!old.video.paused)old.video.pause();}
  activeMediaId=idValue;if(location.type==="source")selectedSourceId=idValue;else if(location.type!=="program")selectedId=idValue;updateActiveAppearance();
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
  el["export-button"].disabled=!primary?.workingSource;
  const title=`${project.dirty?"* ":""}${workingName}${workingName==="Accessible Media Editor"?"":" - Accessible Media Editor"}`;document.title=title;
  if(invoke&&title!==lastNativeTitle){lastNativeTitle=title;invoke("set_window_title",{title}).catch(()=>{});}
  if(focus)(locateItem(activeMediaId)?.type==="source"?el["source-items"]:el["project-items"]).focus();
}

function sectionElements(){return[[...el["media-editor-sections"].querySelectorAll(".media-item-editor")],el["media-section"],el["output-section"]].flat();}
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
  const previous=project,previousSelectedId=selectedId,previousSourceId=selectedSourceId,previousActiveId=activeMediaId;
  try{
    const paths=await invoke("pick_media_files");if(!paths.length)return;announce("Preparing selected media. Please wait.");let next=project,primaryAdded=false,sourceCount=0,mediaIndex=0;
    for(const path of paths){mediaIndex++;const kind=kindFromPath(path),itemId=id();let workingPath=path;
      if(kind!=="Image"){announce(`Converting media ${mediaIndex} of ${paths.length}. Please wait.`);workingPath=await invoke("normalize_media",{source:path,mediaKind:kind,itemId});}
      const media={id:itemId,source:workingPath,workingSource:kind==="Image"?null:workingPath,originalSource:path,name:baseName(path),label:baseName(path),kind,duration:kind==="Image"?5:null,inPoint:0,outPoint:null,trackTarget:kind==="Audio"?"audio":"both"};
      if(!next.items.length&&!primaryAdded){media.role="primary";next=addItem(next,media,null);selectedId=media.id;activeMediaId=PROGRAM_ID;primaryAdded=true;}
      else{media.role="source";next=addSource(next,media);selectedSourceId=media.id;sourceCount++;}
    }
    project=next;render();if(primaryAdded)editorStates.get(PROGRAM_ID)?.section.focus();undoStack.push(previous);announce(primaryAdded?`Primary media added. Loading preview.`:`${sourceCount} source media ${sourceCount===1?"item":"items"} added. Loading preview.`);cue("add");
  }catch(error){project=previous;selectedId=previousSelectedId;selectedSourceId=previousSourceId;activeMediaId=previousActiveId;editorStates.clear();editorNodes.clear();el["media-editor-sections"].replaceChildren();render();announce(`Media import failed and was rolled back. ${error}`,true);}
}
function newProject(){if(project.dirty&&!window.confirm("Discard unsaved changes and start a new editing session?"))return;project=createProject();selectedId=selectedSourceId=activeMediaId=null;mediaClipboard=null;editorStates.clear();editorNodes.clear();el["media-editor-sections"].replaceChildren();undoStack=[];redoStack=[];render();el["import-media-button"].focus();announce("New editing session. Press Ctrl+O to open primary media.");}
async function openProject(){
  if(project.dirty&&!window.confirm("Discard unsaved changes and open another project?"))return;
  try{const result=await invoke("open_project_dialog");if(!result)return;project=migrateProject(JSON.parse(result.content));project.path=result.path;project.dirty=false;selectedId=project.items[0]?.id||null;selectedSourceId=project.sources[0]?.id||null;activeMediaId=project.items.length?PROGRAM_ID:selectedSourceId;mediaClipboard=null;editorStates.clear();editorNodes.clear();el["media-editor-sections"].replaceChildren();undoStack=[];redoStack=[];render({focus:true});announce(`${project.name} opened.`);}catch(error){announce(`Project could not be opened. ${error}`,true);}
}
async function saveProject(saveAs=false){
  try{const content=JSON.stringify(serializable(project),null,2),suggested=`${project.name.replace(/[^a-z0-9 -]/gi,"").trim()||"Untitled Project"}.ameproject`;const path=saveAs||!project.path?await invoke("save_project_dialog",{suggestedName:suggested,content}):await invoke("write_project",{path:project.path,content});if(!path)return;project.path=path;project.name=baseName(path).replace(/\.ameproject$/i,"");project.dirty=false;render();announce(`${project.name} saved.`);cue("save");}catch(error){announce(`Project could not be saved. ${error}`,true);}
}
function exportMedia(){
  const primary=project.items.find(item=>item.role==="primary")||project.items[0];
  if(!primary?.workingSource)return announce("Apply an edit and wait for the working file before saving edited media.",true);
  el["export-format"].value=primary.kind==="Audio"?"m4a":"mp4";el["export-dialog"].showModal();el["export-format"].focus();
}
async function confirmExport(){
  const primary=project.items.find(item=>item.role==="primary")||project.items[0];if(!primary?.workingSource)return;
  const format=el["export-format"].value,stem=baseName(primary.name||"Edited Media").replace(/\.[^.]+$/,"");el["export-dialog"].close();announce("Preparing the selected export format. Please wait.");
  try{const path=await invoke("export_edited_media",{source:primary.workingSource,suggestedName:`${stem} Edited.${format}`,format});if(path){announce("Edited media saved.");cue("save");}else announce("Save canceled.");}catch(error){announce(`Edited media could not be saved. ${error}`,true);}
}
function move(direction){const item=sequenceItem();if(!item)return announce("No sequence item selected.",true);const next=moveItem(project,item.id,direction);if(next===project)return announce(direction<0?"Already first.":"Already last.");rememberChange(next,`${item.label||item.name} moved ${direction<0?"earlier":"later"}.`,true);}
function removeSelected(){const item=sequenceItem();if(!item)return;const index=project.items.findIndex(value=>value.id===item.id),next=removeItem(project,item.id);selectedId=next.items[Math.min(index,next.items.length-1)]?.id||null;activeMediaId=next.items.length?PROGRAM_ID:selectedSourceId;rememberChange(next,`${item.label||item.name} removed from Primary Production.`);cue("remove");}
function removeSelectedSource(){const item=activeLocation()?.type==="source"?activeLocation().item:sourceItem();if(!item)return;const currentIndex=(project.sources||[]).findIndex(value=>value.id===item.id),next=removeSource(project,item.id);selectedSourceId=next.sources[Math.min(currentIndex,next.sources.length-1)]?.id||null;if(activeMediaId===item.id)activeMediaId=selectedSourceId||PROGRAM_ID;rememberChange(next,"Source removed. Original file unchanged.");editorStates.get(activeMediaId)?.section.focus();cue("remove");}
function removeActive(){return activeLocation()?.type==="source"?removeSelectedSource():removeSelected();}
function insertSelectedSource(atEnd=false){
  const source=sourceItem(),target=sequenceItem();if(!source||!source.duration)return announce("Select and load Source Media first.",true);if(!atEnd&&!target)return announce("Select a Primary Sequence item first.",true);
  const sourceState=editorStates.get(source.id),selectedSource={...source,inPoint:sourceState?.markIn??0,outPoint:sourceState?.markOut??Number(source.duration)};
  if(selectedSource.outPoint<=selectedSource.inPoint)return announce("Selection end must follow selection start.",true);
  const inserted=id();let next;
  if(atEnd)next=appendSourceSelection(project,selectedSource,inserted);
  else{const targetState=editorStates.get(target.id),point=targetState?.cursor??0;next=insertSourceSelection(project,target.id,point,selectedSource,id(),inserted,id());if(next===project)return announce("Selection could not be inserted.",true);}
  selectedId=inserted;activeMediaId=inserted;rememberChange(next,atEnd?"Source selection added to end.":"Source selection inserted at Primary playhead.",true);cue("add");
}
function sliceEditSegments(item,from,to){
  const output=[];let logical=0;
  for(const segment of normalizedSegments(item)){
    const length=segment.end-segment.start,start=Math.max(from,logical),end=Math.min(to,logical+length);
    if(end>start)output.push({start:segment.start+(start-logical),end:segment.start+(end-logical)});
    logical+=length;
  }
  return output;
}
function copySourceSelection(){
  const location=activeLocation(),state=activeState();if(!location||location.type!=="source"||!state)return announce("Activate a Source editor first.",true);
  const total=Number(location.item.duration)||0,range=bracketSelectionRange(total,state.markIn,state.markOut);if(!range)return announce("Set a Left or Right Bracket before copying.",true);const {from,to}=range;if(to<=from)return announce("The bracketed selection has no duration.",true);
  mediaClipboard={...structuredClone(location.item),id:null,role:"inserted",inPoint:0,outPoint:to-from,editSegments:[{start:from,end:to}],workingSource:location.item.workingSource||location.item.source};
  state.markIn=state.markOut=null;state.markHistory=[];updateEditorLabels(state,location.item,location.type);
  const programState=editorStates.get(PROGRAM_ID);if(programState&&project.items[0])updateEditorLabels(programState,project.items[0],"program");announce(`Copied ${readableTime(to-from)} from ${displayName(location.item)}. Brackets cleared.`);cue("add");
}
function pasteMediaClipboard(){
  const state=activeState(),location=activeLocation();if(!mediaClipboard)return announce("Copy a Source selection first.",true);if(!state||location?.type!=="program")return announce("Move to Primary Production before pasting.",true);
  const next=structuredClone(project),point=Math.max(0,Math.min(duration(next),state.cursor)),target=sequencePoint(point),clip={...structuredClone(mediaClipboard),id:id(),label:`${mediaClipboard.label||mediaClipboard.name} - pasted selection`};
  if(!target||point>=duration(next)-0.0005)next.items.push(clip);
  else if(target.local<=0.0005)next.items.splice(target.index,0,clip);
  else if(target.local>=itemDuration(target.item)-0.0005)next.items.splice(target.index+1,0,clip);
  else{
    const original=next.items[target.index],left={...structuredClone(original),editSegments:sliceEditSegments(original,0,target.local),outPoint:target.local},right={...structuredClone(original),id:id(),label:`${original.label||original.name} - continuation`,editSegments:sliceEditSegments(original,target.local,itemDuration(original)),inPoint:0,outPoint:itemDuration(original)-target.local};
    next.items.splice(target.index,1,left,clip,right);
  }
  next.dirty=true;if(next.items[0])next.items[0].workingSource=null;activeMediaId=PROGRAM_ID;rememberChange(next,`Pasted ${readableTime(itemDuration(clip))} at ${readableTime(point)}.`);const program=editorStates.get(PROGRAM_ID);if(program){setEditorPosition(program,point,true);program.section.focus();}
}
function showProperties(){const location=activeLocation(),item=location?.item;if(!item)return announce("No media editor active.",true);el["properties-name"].textContent=editorTitle(item,location.type);el["item-label"].value=item.label||item.name;el["item-duration"].value=item.duration??"";const media=["Video","Audio"].includes(item.kind),edited=location.type==="sequence"&&Array.isArray(item.editSegments);el["item-duration"].readOnly=media;el["trim-fields"].hidden=!media||edited;writeTime("item-in",Number(item.inPoint)||0);writeTime("item-out",item.outPoint==null?Number(item.duration)||0:Number(item.outPoint));el["properties-dialog"].showModal();el["item-label"].focus();}
function saveProperties(){const location=activeLocation(),item=location?.item;if(!item)return;const value=Number(el["item-duration"].value),media=["Video","Audio"].includes(item.kind),edited=location.type==="sequence"&&Array.isArray(item.editSegments),start=readTime("item-in"),end=readTime("item-out");if(!media&&(!Number.isFinite(value)||value<0.001))return announce("Enter a valid duration.",true);if(media&&!edited&&(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end>value))return announce("Enter valid In and Out times.",true);const patch={label:el["item-label"].value.trim()||item.name,duration:value};if(media&&!edited){patch.inPoint=start;patch.outPoint=end;}el["properties-dialog"].close();rememberChange(updateLocated(item.id,patch),"Media properties saved.");}
function showTextDialog(){el["text-content"].value="";el["text-duration"].value="5";el["text-dialog"].showModal();el["text-content"].focus();}
function saveText(){const text=el["text-content"].value.trim(),seconds=Number(el["text-duration"].value);if(!text||!Number.isFinite(seconds)||seconds<0.1)return announce("Enter text and a valid duration.",true);const after=selectedId,item={id:id(),source:null,name:text.slice(0,40),label:text.slice(0,40),kind:"Text",text,duration:seconds,role:"sequence"};selectedId=item.id;el["text-dialog"].close();rememberChange(addItem(project,item,after),"Text item added.",true);}
function addTransition(){const after=selectedId,item={id:id(),source:null,name:"Crossfade",label:"Crossfade",kind:"Transition",duration:1,role:"sequence"};selectedId=item.id;rememberChange(addItem(project,item,after),"Crossfade added.",true);}
function undo(){
  const state=activeState();
  if(state?.markHistory?.length){const change=state.markHistory.pop();if(change.which==="in")state.markIn=change.previous;else state.markOut=change.previous;const location=activeLocation();if(location)updateEditorLabels(state,location.item,location.type);return announce(`${change.which==="in"?"Left":"Right"} bracket removed.`);}
  if(!undoStack.length)return announce("Nothing to undo.");redoStack.push(project);project=undoStack.pop();selectedId=project.items[0]?.id||null;selectedSourceId=project.sources?.[0]?.id||null;activeMediaId=project.items.length?PROGRAM_ID:selectedSourceId;render();editorStates.get(activeMediaId)?.section.focus();announce("Undo completed.");
}
function redo(){if(!redoStack.length)return announce("Nothing to redo.");undoStack.push(project);project=redoStack.pop();selectedId=project.items[0]?.id||null;selectedSourceId=project.sources?.[0]?.id||null;activeMediaId=project.items.length?PROGRAM_ID:selectedSourceId;render();editorStates.get(activeMediaId)?.section.focus();announce("Redo completed.");}

async function togglePlayback(){
  const location=activeLocation(),state=activeState();if(!location||!state)return announce("Activate a media editor first.",true);if(state.unsupported)return announce("This format requires conversion before preview.",true);cancelAudition(state,true);
  if(state.video.paused){const bounds=editorBounds(location.item,location.type);if(state.cursor<bounds.start||state.cursor>=bounds.end)setEditorPosition(state,bounds.start,true);else setEditorPosition(state,state.cursor,true);try{await state.video.play();announce("Playing.");}catch(error){announce(`Playback failed. ${error}`,true);}}
  else{state.video.pause();setEditorPosition(state,state.video.currentTime,true);announce(`Paused at ${readableTime(state.cursor)}.`);}
}
async function auditionAround(before=1,after=1,quiet=false){
  const location=activeLocation(),state=activeState();if(!location||!state)return announce("Activate a media editor first.",true);if(state.unsupported)return quiet?undefined:announce("This format requires conversion before preview.",true);cancelAudition(state,true);if(!state.video.paused)state.video.pause();
  const point=state.cursor,bounds=editorBounds(location.item,location.type),start=Math.max(bounds.start,point-before),end=Math.min(bounds.end,point+after);
  setEditorPosition(state,start,false);const audition={returnPoint:point,end,timer:null,quiet};
  audition.timer=setTimeout(()=>{if(state.audition===audition){cancelAudition(state,true);if(!quiet)announce(`Returned to ${readableTime(point)}.`);}},Math.max(300,(end-start)*1000+500));state.audition=audition;
  try{await state.video.play();if(!quiet&&state.audition===audition)announce(`Auditioning at ${readableTime(point)}.`);}catch(error){if(state.audition===audition)cancelAudition(state,true);if(error?.name!=="AbortError"&&!quiet)announce(`Audition failed. ${error}`,true);}
}
function movePlayhead(amount,label="Playhead"){const state=activeState();if(!state)return announce("Activate a media editor first.",true);if(state.unsupported)return announce("This format requires conversion before editing.",true);cancelAudition(state,false);setEditorPosition(state,state.cursor+amount,true);announce(`${label} ${readableTime(state.cursor)}.`);}
function scrub(amount){const state=activeState();if(!state)return announce("Activate a media editor first.",true);cancelAudition(state,false);setEditorPosition(state,state.cursor+amount,true);auditionAround(0,0.2,true);}
function jumpPlayhead(end=false){const location=activeLocation(),state=activeState();if(!location||!state)return announce("Activate a media editor first.",true);const bounds=editorBounds(location.item,location.type);setEditorPosition(state,end?bounds.end:bounds.start,true);announce(`${end?"End":"Beginning"} ${readableTime(state.cursor)}.`);}
function setPoint(which){
  const location=activeLocation(),state=activeState();if(!location||!state)return announce("Activate a media editor first.",true);if(state.unsupported)return announce("This format requires conversion before editing.",true);
  const point=state.cursor,other=which==="in"?state.markOut:state.markIn;
  if(which==="in"&&other!=null&&point>=other)return announce("Left Bracket must precede Right Bracket.",true);
  if(which==="out"&&other!=null&&point<=other)return announce("Right Bracket must follow Left Bracket.",true);
  const previous=which==="in"?state.markIn:state.markOut;if(previous===point)return announce(`${which==="in"?"Left":"Right"} Bracket is already set there.`);
  state.markHistory.push({which,previous});if(which==="in")state.markIn=point;else state.markOut=point;updateEditorLabels(state,location.item,location.type);
  const range=bracketSelectionRange(location.type==="program"?duration(project):itemDuration(location.item),state.markIn,state.markOut);
  const effect=range.kind==="ending"?`End selected from ${readableTime(range.from)}.`:range.kind==="beginning"?`Beginning selected through ${readableTime(range.to)}.`:`Content selected from ${readableTime(range.from)} through ${readableTime(range.to)}.`;
  announce(`${which==="in"?"Left":"Right"} Bracket set. ${effect}${location.type==="source"?"":" Press Ctrl+Delete to delete it."}`);
}
async function commitPrimaryEdit(){
  const location=activeLocation(),state=activeState();
  if(!location||!['sequence','program'].includes(location.type)||!state)return announce("Activate Primary Production first.",true);
  const total=location.type==="program"?duration(project):itemDuration(location.item),range=bracketSelectionRange(total,state.markIn,state.markOut);
  if(!range)return announce("Set a Left or Right Bracket before applying an edit.",true);
  const {from,to}=range;
  let next;
  if(location.type==="program"){
    next=structuredClone(project);const kept=[];let offset=0;
    for(const item of next.items){const length=itemDuration(item),itemEnd=offset+length;
      if(to<=offset||from>=itemEnd)kept.push(item);
      else{
        if(from>offset)kept.push({...structuredClone(item),editSegments:sliceEditSegments(item,0,from-offset),outPoint:from-offset});
        if(to<itemEnd)kept.push({...structuredClone(item),id:id(),label:`${item.label||item.name} - continuation`,editSegments:sliceEditSegments(item,to-offset,length),inPoint:0,outPoint:itemEnd-to});
      }
      offset=itemEnd;
    }
    if(!kept.length)next=project;else{next.items=kept;next.items[0].workingSource=null;next.dirty=true;}
  }else next=removeLogicalRange(project,location.item.id,from,to,false);
  if(next===project)return announce("That edit would remove the entire file or no media. Nothing changed.",true);
  const itemId=location.item.id,deleted=range.kind==="ending"?"End deleted.":range.kind==="beginning"?"Beginning deleted.":"Bracketed selection deleted.";state.markIn=state.markOut=null;state.markHistory=[];rememberChange(next,`${deleted} Duration ${readableTime(location.type==="program"?duration(next):itemDuration(next.items.find(item=>item.id===itemId)))}.`);
  const edited=sequenceItem(itemId)||next.items[0],currentState=editorStates.get(location.type==="program"?PROGRAM_ID:itemId);if(currentState)setEditorPosition(currentState,Math.min(from,location.type==="program"?duration(next):itemDuration(edited)),true);
  if(location.type==="program"&&next.items.length>1){updateStatus("Production edit is ready for immediate playback. Multi-item export rendering is not included in this build.");return;}
  if(!invoke)return;
  if(currentState)currentState.rendering=true;updateStatus("Creating the edited working file. Playback already uses the edited timeline.");
  try{
    const path=await invoke("render_working_edit",{source:edited.source,segments:normalizedSegments(edited),mediaKind:edited.kind,itemId});
    project=updateItem(project,itemId,{workingSource:path});if(currentState)currentState.rendering=false;render();announce("Edited working file ready.");
  }catch(error){if(currentState)currentState.rendering=false;announce(`The edit remains available for preview, but the working file could not be created. ${error}`,true);}
}
function setTrackTarget(target){const location=activeLocation();if(!location)return announce("Activate a media editor first.",true);if(location.item.kind==="Audio"&&target!=="audio")return announce("Audio media always targets audio.");rememberChange(updateLocated(location.item.id,{trackTarget:target}),`${targetText(target)} targeted.`);}
function showGoToTime(){const state=activeState();if(!state)return announce("Activate a media editor first.",true);writeTime("goto",state.cursor);el["go-to-time-dialog"].showModal();el["goto-hours"].focus();}
function confirmGoToTime(){const state=activeState(),location=activeLocation(),point=readTime("goto");if(!state||!location||!Number.isFinite(point)||point>Number(location.item.duration))return announce("Enter a valid time.",true);el["go-to-time-dialog"].close();setEditorPosition(state,point,true);state.slider.focus();announce(`Playhead moved to ${readableTime(point)}.`);}
function splitSelected(){const location=activeLocation(),state=activeState();if(!location||location.type!=="sequence")return announce("Activate a Primary Sequence editor before splitting.",true);const newId=id(),next=splitItem(project,location.item.id,state.cursor,newId);if(next===project)return announce("Move between In and Out before splitting.",true);selectedId=newId;activeMediaId=newId;rememberChange(next,`Split at ${readableTime(state.cursor)}. Part 2 active.`,true);}
function cancel(){const state=activeState();if(el["properties-dialog"].open)el["properties-dialog"].close();else if(el["text-dialog"].open)el["text-dialog"].close();else if(el["go-to-time-dialog"].open)el["go-to-time-dialog"].close();else if(el["export-dialog"].open)el["export-dialog"].close();else if(state?.audition){cancelAudition(state,true);announce("Audition canceled.");}else if(state&&(state.markIn!=null||state.markOut!=null)){state.markIn=state.markOut=null;state.markHistory=[];const location=activeLocation();if(location)updateEditorLabels(state,location.item,location.type);announce("Uncommitted marks canceled.");}else announce("No temporary operation to cancel.");}

const actions={
  newProject,openProject,saveProject:()=>saveProject(false),saveProjectAs:()=>saveProject(true),importMedia,exportMedia,
  previousWorkspace:()=>switchWorkspace(-1),nextWorkspace:()=>switchWorkspace(1),showMediaWorkspace:()=>switchWorkspace(1,"media"),showAudioWorkspace:()=>switchWorkspace(1,"audio"),
  previousSection:()=>focusSection(-1),nextSection:()=>focusSection(1),openProjectsFolder:async()=>{try{await invoke("open_projects_folder");announce("Projects folder opened.");}catch(error){announce(String(error),true);}},
  addText:showTextDialog,addTransition,moveEarlier:()=>move(-1),moveLater:()=>move(1),properties:showProperties,removeItem:removeActive,split:splitSelected,undo,redo,
  preview:togglePlayback,playPause:togglePlayback,audition:()=>auditionAround(),setIn:()=>setPoint("in"),setOut:()=>setPoint("out"),goToTime:showGoToTime,
  copyMedia:copySourceSelection,pasteMedia:pasteMediaClipboard,insertSource:copySourceSelection,appendSource:pasteMediaClipboard,trimPrimary:commitPrimaryEdit,
  scrubBack1:()=>scrub(-1),scrubForward1:()=>scrub(1),scrubBack100ms:()=>scrub(-0.1),scrubForward100ms:()=>scrub(0.1),scrubBack10ms:()=>scrub(-0.01),scrubForward10ms:()=>scrub(0.01),
  moveBack5:()=>movePlayhead(-5),moveForward5:()=>movePlayhead(5),moveBack30:()=>movePlayhead(-30),moveForward30:()=>movePlayhead(30),moveBack300:()=>movePlayhead(-300),moveForward300:()=>movePlayhead(300),nudgeBack:()=>movePlayhead(-0.001),nudgeForward:()=>movePlayhead(0.001),
  jumpBeginning:()=>jumpPlayhead(false),jumpEnd:()=>jumpPlayhead(true),targetBoth:()=>setTrackTarget("both"),targetVideo:()=>setTrackTarget("video"),targetAudio:()=>setTrackTarget("audio"),cancel,stop:cancel,
  focusProjectItems:()=>{el["project-items"].focus();announce("Primary Sequence. Press Enter to open the selected media editor.");},
  focusPlayhead:()=>{const state=activeState();if(!state)return announce("No media editor active.");state.slider.focus();updateStatus(`Playhead ${readableTime(state.cursor)}.`);},
  showShortcuts:()=>{el["shortcuts-dialog"].showModal();el["shortcuts-dialog"].querySelector("button").focus();},showTestingGuide:()=>{el["testing-guide-dialog"].showModal();el["testing-guide-dialog"].querySelector("button").focus();},
  toggleSoundCues:()=>{soundCues=!soundCues;localStorage.setItem("ame-sound-cues",soundCues?"on":"off");announce(`Sound cues ${soundCues?"on":"off"}.`);},showAbout:()=>announce("Accessible Media Editor Build 0.7.1. Logical bracket deletion, automatic Source bracket clearing, and concise end announcements.")
};
Object.entries(actions).forEach(([name,handler])=>registerAction(name,handler));initShortcuts();

el["project-items"].addEventListener("change",()=>{selectedId=el["project-items"].value||null;});
el["project-items"].addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();activateMedia(PROGRAM_ID,true);}});
el["source-items"].addEventListener("change",()=>{selectedSourceId=el["source-items"].value||null;if(selectedSourceId)activateMedia(selectedSourceId,false);});
el["source-items"].addEventListener("focus",()=>{if(selectedSourceId)activateMedia(selectedSourceId,false);});
el["source-items"].addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();activateMedia(selectedSourceId,true);}});
el["import-media-button"].addEventListener("click",importMedia);el["edit-primary-button"].addEventListener("click",()=>activateMedia(PROGRAM_ID,true));el["activate-source-button"].addEventListener("click",()=>activateMedia(selectedSourceId,true));
el["add-text-button"].addEventListener("click",showTextDialog);el["move-earlier-button"].addEventListener("click",()=>move(-1));el["move-later-button"].addEventListener("click",()=>move(1));el["remove-item-button"].addEventListener("click",removeSelected);
el["insert-source-button"].addEventListener("click",()=>insertSelectedSource(false));el["append-source-button"].addEventListener("click",()=>insertSelectedSource(true));el["remove-source-button"].addEventListener("click",removeSelectedSource);
el["save-project-button"].addEventListener("click",()=>saveProject(true));el["media-editor-tab"].addEventListener("click",()=>switchWorkspace(1,"media"));el["audio-studio-tab"].addEventListener("click",()=>switchWorkspace(1,"audio"));
el["export-button"].addEventListener("click",exportMedia);
el["export-confirm"].addEventListener("click",confirmExport);el["export-cancel"].addEventListener("click",()=>el["export-dialog"].close());
el["media-section-tab"].addEventListener("click",()=>activateSection("media-section"));el["output-section-tab"].addEventListener("click",()=>activateSection("output-section"));
document.querySelectorAll('[role="tab"]').forEach(tab=>tab.addEventListener("keydown",event=>{if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;event.preventDefault();event.stopPropagation();const target=event.key==="ArrowLeft"||event.key==="Home"?"media":"audio";switchWorkspace(1,target);el[target==="media"?"media-editor-tab":"audio-studio-tab"].focus();}));
el["save-properties-button"].addEventListener("click",saveProperties);el["cancel-properties-button"].addEventListener("click",()=>el["properties-dialog"].close());el["save-text-button"].addEventListener("click",saveText);el["cancel-text-button"].addEventListener("click",()=>el["text-dialog"].close());
el["go-to-time-confirm"].addEventListener("click",confirmGoToTime);el["go-to-time-cancel"].addEventListener("click",()=>el["go-to-time-dialog"].close());
if(listen)listen("menu-action",event=>triggerAction(event.payload));
render();el["import-media-button"].focus();
