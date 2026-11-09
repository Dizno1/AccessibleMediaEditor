import {
  createProject, addItem, moveItem, removeItem, updateItem, splitItem,
  addSource, removeSource, updateSource, moveSource, appendImageSlideshow, createInterleavedPresentation, makeSourcePrimary, appendSourceSelection,
  insertSourceSelection, itemDuration, duration, serializable, normalizedSegments,
  logicalDuration, logicalToSourceTime, sourceToLogicalTime,
  bracketSelectionPlan, logicalSegmentsForRanges, removeLogicalRanges, productionRenderItems,
  addTrackReplacement, removeTrackReplacement, productionRenderReplacements, productionRenderBackgroundMusic, presentationDuckRanges,presentationTimelineDuration,presentationTransitionDuration
} from "./projectModel.js";
import { initShortcuts, registerAction, triggerAction } from "./shortcutService.js";
import { clearEditorMarks, preserveMarksWhileChangingTarget, replacementDurationIssue, primaryPasteOperation } from "./editorState.js";

const invoke=window.__TAURI__?.core?.invoke;
const listen=window.__TAURI__?.event?.listen;
const convertFileSrc=window.__TAURI__?.core?.convertFileSrc;
const el=Object.fromEntries([...document.querySelectorAll("[id]")].map(node=>[node.id,node]));

let project=createProject();
// The reusable media library is independent of the current project and survives upgrades.
let libraryItems=[];
let libraryReady=false;
let libraryWrite=Promise.resolve();
let libraryBlocked=false;
function saveLibrary(){
  if(!invoke||!libraryReady||libraryBlocked)return;
  const content=JSON.stringify({schema:1,items:libraryItems});
  libraryWrite=libraryWrite.catch(()=>{}).then(()=>invoke("write_media_library",{content})).catch(error=>{
    libraryBlocked=true;
    console.error("Library write failed",error);
    announce("Media library could not be saved. Existing library data was not deliberately deleted.",true);
  });
}
function collectLibraryItems(){
  if(!libraryReady)return;
  let changed=false;
  for(const item of [...(project.sources||[]),...(project.items||[])]){
    if(!["Video","Audio","Image"].includes(item.kind)||!item.source)continue;
    if(libraryItems.some(entry=>entry.id===item.id))continue;
    libraryItems.push(structuredClone({...item,role:"source"}));changed=true;
  }
  if(changed){renderLibrary();saveLibrary();}
}
function renderLibrary(){
  const list=el["persistent-library-items"];
  if(!list)return;
  const previous=list.value;
  list.replaceChildren();
  for(const item of libraryItems)list.add(new Option(`${item.kind}. ${item.label||item.name}${item.savedClip?". Saved clip":""}`,item.id));
  if(!libraryItems.length){const option=new Option("Library is empty","");option.disabled=true;list.add(option);}
  if(libraryItems.some(item=>item.id===previous))list.value=previous;
  el["persistent-library-status"].textContent=`${libraryItems.length} reusable library ${libraryItems.length===1?"item":"items"}. Current project opens separately.`;
  el["persistent-library-add"].disabled=!libraryItems.length;
  el["persistent-library-remove"].disabled=!libraryItems.length;
}
function addLibrarySelection(){
  const item=libraryItems.find(entry=>entry.id===el["persistent-library-items"].value);
  if(!item)return;
  const copy=structuredClone(item);
  copy.id=id();copy.role="source";
  const next=addSource(project,copy);
  rememberChange(next,`${copy.label||copy.name} added to the current workspace from the persistent library.`);
}
function removeLibrarySelection(){
  const item=libraryItems.find(entry=>entry.id===el["persistent-library-items"].value);
  if(!item||!window.confirm(`Remove ${item.label||item.name} from the reusable library? Existing projects and original files will not be deleted.`))return;
  libraryItems=libraryItems.filter(entry=>entry.id!==item.id);
  renderLibrary();saveLibrary();announce("Item removed from the reusable library. Original media was not deleted.");
}
async function loadLibrary(){
  try{
    const content=invoke?await invoke("read_media_library"):null;
    if(content){
      const parsed=JSON.parse(content);
      if(parsed.schema!==1||!Array.isArray(parsed.items))throw new Error("Unsupported library format");
      libraryItems=parsed.items;
    }else if(invoke){
      // One-time migration from the previous session format. Do not restore its workspace.
      const legacy=await invoke("read_recovery_session");
      if(legacy){
        const parsed=JSON.parse(legacy);
        if(parsed.schema===1&&parsed.project){
          const old=parsed.project;
          libraryItems=[...(Array.isArray(old.sources)?old.sources:[]),...(Array.isArray(old.items)?old.items:[])]
            .filter(item=>["Video","Audio","Image"].includes(item.kind)&&item.source)
            .filter((item,index,array)=>array.findIndex(other=>other.id===item.id)===index)
            .map(item=>({...item,role:"source"}));
        }
      }
    }
    libraryReady=true;renderLibrary();
    if(!content&&libraryItems.length)saveLibrary();
    announce(`Clean workspace ready. ${libraryItems.length} saved library items available. Open Project to resume a saved project.`);
  }catch(error){
    console.error("Library load failed",error);
    libraryBlocked=true;renderLibrary();
    announce("Saved library could not be loaded. Its existing data was left unchanged. The empty workspace remains usable.",true);
  }
}

let selectedId=null;
let selectedSourceId=null;
let selectedImageId=null;
let selectedReplacementId=null;
let activeMediaId=null;
let activeWorkspace="media";
let activeSectionIndex=0;
let undoStack=[];
let redoStack=[];
let soundCues=localStorage.getItem("ame-sound-cues")==="on";
let lastNativeTitle="Accessible Media Editor";
const PROGRAM_ID="primary-production";
let mediaClipboard=null;
let presentationClipboard=[];
let pendingImage=null;
let imagePlacementResolve=null;

let savedClipCounter=0;
let pendingShortReplacement=null;
let removedLibraryItemUndo=null;
let lastExportPath=null;
let exportConversionStartedAt=null;
let exportHeartbeatTimer=null;
let exportConversionLabel="export";
let exportPhase="idle";
let exportNarrationChain=Promise.resolve();
let exportNarratedMessages=new Set();
const editorStates=new Map();
const editorNodes=new Map();
let editorCounter=0;

function announce(message,urgent=false){
  if(["format-selection","rendering","choosing-destination","converting"].includes(exportPhase))return;
  const region=el[urgent?"alert-announcer":"status-announcer"];
  region.textContent="";
  requestAnimationFrame(()=>{region.textContent=message;});
  el["action-status"].textContent=message;
}
function updateStatus(message){el["action-status"].textContent=message;}
function clearAnnouncements(){
  el["status-announcer"].textContent="";
  el["alert-announcer"].textContent="";
  el["action-status"].textContent="";
}
function setExportProgress(message){
  el["export-progress-message"].textContent=message;
}
function resetExportNarration(){
  exportNarrationChain=Promise.resolve();
  exportNarratedMessages=new Set();
  el["export-progress-announcer"].textContent="";
}
function queueExportAnnouncement(message,hold=2000){
  if(exportNarratedMessages.has(message))return exportNarrationChain;
  exportNarratedMessages.add(message);
  exportNarrationChain=exportNarrationChain.then(()=>new Promise(resolve=>{
    if(!el["export-progress-dialog"].open){resolve();return;}
    setExportProgress(message);
    const region=el["export-progress-announcer"];
    region.textContent="";
    requestAnimationFrame(()=>{
      region.textContent=message;
      setTimeout(resolve,hold);
    });
  }));
  return exportNarrationChain;
}
function stopExportHeartbeat(){
  if(exportHeartbeatTimer)clearInterval(exportHeartbeatTimer);
  exportHeartbeatTimer=null;exportConversionStartedAt=null;
}
function startExportHeartbeat(label="export"){
  stopExportHeartbeat();exportConversionStartedAt=Date.now();
  exportConversionLabel=label;
  exportHeartbeatTimer=setInterval(()=>{
    const minutes=Math.max(1,Math.floor((Date.now()-exportConversionStartedAt)/60000));
    const message=`${exportConversionLabel} conversion still in progress. ${minutes} ${minutes===1?"minute":"minutes"} elapsed. Please continue to wait for Export Complete.`;
    queueExportAnnouncement(message);
  },60000);
}
function showExportProgress(message){
  clearAnnouncements();resetExportNarration();setExportProgress(message);
  if(!el["export-progress-dialog"].open)el["export-progress-dialog"].showModal();
  el["export-progress-heading"].focus();
  setTimeout(()=>queueExportAnnouncement(message),100);
}
function closeExportProgress(){
  stopExportHeartbeat();
  if(el["export-progress-dialog"].open)el["export-progress-dialog"].close();
  el["export-progress-announcer"].textContent="";
}
function handleExportProgress(message){
  if(!el["export-progress-dialog"].open)return;
  const rendering=/^(Rendering production item|Joining rendered production items|Rendering track replacement|Applying audio and video track replacements|Applying continuous background music)/.test(message);
  const match=message.match(/^Export destination selected\. Converting complete production to ([A-Z0-9]+)\./);
  if(rendering&&exportPhase!=="rendering")return;
  if(match&&!['choosing-destination','converting'].includes(exportPhase))return;
  if(!rendering&&!match)return;
  queueExportAnnouncement(message);
  if(match){exportPhase="converting";startExportHeartbeat(match[1]);}
}

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
function supportedMediaPath(path){
  const ext=path.includes(".")?path.split(".").pop().toLowerCase():"";
  return["png","jpg","jpeg","gif","webp","bmp","tif","tiff","heic","heif","mp3","wav","m4a","aac","flac","ogg","opus","wma","aif","aiff","mp4","mov","webm","wmv","mkv","avi","m4v","mpeg","mpg","ts","mts","m2ts","3gp","ogv"].includes(ext);
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
  if(["sequence","source"].includes(type)&&Array.isArray(item.editSegments)&&item.editSegments.length)return{start:0,end:logicalDuration(item)};
  if(!["sequence","source"].includes(type))return{start:0,end:durationValue};
  return{start:0,end:itemDuration(item)};
}
function itemTarget(item){return item?.kind==="Audio"?"audio":item?.trackTarget||"both";}
function programTarget(){return project.editTarget||"both";}
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
  const trim=["Video","Audio"].includes(item.kind)&&item.duration?` Left boundary ${readableTime(Number(item.inPoint)||0)}. Right boundary ${readableTime(item.outPoint==null?Number(item.duration):Number(item.outPoint))}.`:"";
  return`${source?`Source ${index+1}`:item.role==="inserted"?`Inserted segment ${index+1}`:`Primary sequence item ${index+1}`}. ${item.kind}. ${item.label||item.name}.${durationText}${trim}`;
}
function itemListLabel(item,index,source=false){
  const role=source?`Source ${index+1}`:item.role==="inserted"?`Inserted ${index+1}`:`Primary ${index+1}`;
  return`${role}. ${item.kind}. ${item.label||item.name}`;
}
function migrateProject(value){
  const next={...value,items:Array.isArray(value.items)?value.items:[],sources:Array.isArray(value.sources)?value.sources:[],trackReplacements:Array.isArray(value.trackReplacements)?value.trackReplacements:[],backgroundMusic:value.backgroundMusic||null,editTarget:["audio","video","both"].includes(value.editTarget)?value.editTarget:"both",version:6,presentation:{items:Array.isArray(value.presentation?.items)?value.presentation.items:[],backgroundMusic:value.presentation?.backgroundMusic||null}};
  if(next.items[0]&&!next.items[0].role)next.items[0].role="primary";
  next.items.slice(1).forEach(item=>{if(!item.role)item.role="sequence";});
  next.presentation.items.forEach(item=>{if(item.audioVolume==null)item.audioVolume=1;if(!item.transition)item.transition={type:"none",duration:0};});
  return next;
}
function updateLocated(idValue,patch){
  const location=locateItem(idValue);if(!location)return project;
  return location.type==="source"?updateSource(project,idValue,patch):updateItem(project,location.item.id,patch);
}
function rememberChange(next,message,focus=false,undoLibraryItem=null){
  undoStack.push(project);if(undoStack.length>50)undoStack.shift();redoStack=[];removedLibraryItemUndo=undoLibraryItem;project=next;render({focus});announce(message);
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
function waitForMediaReady(video){
  if(!video.seeking&&video.readyState>=2)return Promise.resolve();
  return new Promise(resolve=>{
    let finished=false;
    const done=()=>{if(finished)return;finished=true;clearTimeout(timer);video.removeEventListener("seeked",done);video.removeEventListener("canplay",done);video.removeEventListener("loadedmetadata",done);resolve();};
    const timer=setTimeout(done,500);
    video.addEventListener("seeked",done);video.addEventListener("canplay",done);video.addEventListener("loadedmetadata",done);
  });
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
  state.currentItemId=target.item.id;state.currentItemOffset=target.offset;state.pendingSourceTime=sourceTime;state.video.muted=false;
  if(target.item.kind==="Image"){
    state.video.pause();state.video.hidden=true;state.sequenceImage.hidden=false;if(state.sequenceImage.dataset.sourcePath!==target.item.source){state.sequenceImage.dataset.sourcePath=target.item.source;state.sequenceImage.src=source;}state.cursor=point;syncBackgroundMusic(state,point,autoplay);if(autoplay)startProgramImagePlayback(state,target);return true;
  }
  state.imagePlaying=false;if(state.imageTimer)cancelAnimationFrame(state.imageTimer);state.sequenceImage.hidden=true;state.video.hidden=false;
  if(state.video.dataset.sourcePath!==target.item.source){state.video.dataset.sourcePath=target.item.source;state.pendingAutoplay=autoplay;state.video.src=source;state.video.load();}
  else{state.video.currentTime=sourceTime;if(autoplay)state.video.play().catch(()=>{});}
  syncBackgroundMusic(state,point,autoplay);
  syncTrackPreview(state,point,autoplay);
  return true;
}
function syncBackgroundMusic(state,point,playing){if(state.type!=="program")return;const music=project.backgroundMusic;if(!music){state.backgroundAudio.pause();return;}const source=sourceForItem({source:music.source});if(state.backgroundAudio.dataset.sourcePath!==music.source){state.backgroundAudio.dataset.sourcePath=music.source;state.backgroundAudio.src=source;state.backgroundAudio.loop=true;}const duck=(music.duckRanges||[]).some(range=>point>=range.start&&point<range.end);state.backgroundAudio.volume=Math.max(0,Math.min(1,(music.volume??.35)*(duck?(music.duckFactor??.25):1)));if(Number.isFinite(state.backgroundAudio.duration)&&state.backgroundAudio.duration>0&&Math.abs(state.backgroundAudio.currentTime-(point%state.backgroundAudio.duration))>.3)state.backgroundAudio.currentTime=point%state.backgroundAudio.duration;if(playing)state.backgroundAudio.play().catch(()=>{});else state.backgroundAudio.pause();}
function startProgramImagePlayback(state,target){state.imagePlaying=true;state.imageStarted=performance.now()-target.local*1000;const tick=now=>{if(!state.imagePlaying)return;const local=(now-state.imageStarted)/1000,point=target.offset+local;if(local>=itemDuration(target.item)){state.imagePlaying=false;state.cursor=target.offset+itemDuration(target.item);if(target.index<project.items.length-1)setProgramMedia(state,state.cursor,true);else finishAtEnd(state,duration(project));return;}state.cursor=point;state.slider.value=String(point);state.position.textContent=`Position ${readableTime(point)}. Media duration ${readableTime(duration(project))}.`;syncBackgroundMusic(state,point,true);state.imageTimer=requestAnimationFrame(tick);};state.imageTimer=requestAnimationFrame(tick);}
function activeReplacement(point,target){return[...(project.trackReplacements||[])].reverse().find(edit=>(edit.target===target||edit.target==="both")&&point>=edit.timelineStart-0.0005&&point<edit.timelineEnd-0.0005)||null;}
function replacementSourceTime(edit,point){const pseudo={duration:(edit.segments||[]).reduce((sum,segment)=>Math.max(sum,Number(segment.end)||0),0),editSegments:edit.segments||[]};return logicalToSourceTime(pseudo,Math.max(0,point-edit.timelineStart));}
function syncTrackPreview(state,point,autoplay=!state.video.paused){
  if(state.type!=="program")return;
  const audioEdit=activeReplacement(point,"audio"),videoEdit=activeReplacement(point,"video"),bothEdit=[audioEdit,videoEdit].find(edit=>edit?.target==="both")||null;
  const visualEdit=bothEdit||videoEdit,audibleEdit=bothEdit||audioEdit;
  state.video.hidden=!!visualEdit;state.video.muted=!!audibleEdit;
  if(visualEdit){
    const isImage=visualEdit.mediaKind==="Image",source=sourceForItem({source:visualEdit.source});
    state.replacementImage.hidden=!isImage;
    if(isImage){state.replacementVideo.pause();state.replacementVideo.hidden=true;if(state.replacementImage.dataset.sourcePath!==visualEdit.source){state.replacementImage.dataset.sourcePath=visualEdit.source;state.replacementImage.src=source;}}
    const media=state.replacementVideo;if(isImage)return syncAudioReplacement(state,audibleEdit,point,autoplay);
    if(media.dataset.sourcePath!==visualEdit.source){media.dataset.sourcePath=visualEdit.source;media.src=source;media.load();}
    const wanted=replacementSourceTime(visualEdit,point);if(Math.abs((media.currentTime||0)-wanted)>0.12)media.currentTime=wanted;
    media.hidden=false;media.muted=visualEdit.target==="video";if(autoplay)media.play().catch(()=>{});else media.pause();
  }else{state.replacementVideo.pause();state.replacementVideo.hidden=true;state.replacementImage.hidden=true;}
  syncAudioReplacement(state,audibleEdit,point,autoplay);
}
function syncAudioReplacement(state,audibleEdit,point,autoplay){
  if(audibleEdit&&audibleEdit.target==="audio"){
    const media=state.replacementAudio,source=sourceForItem({source:audibleEdit.source});
    if(media.dataset.sourcePath!==audibleEdit.source){media.dataset.sourcePath=audibleEdit.source;media.src=source;media.load();}
    const wanted=replacementSourceTime(audibleEdit,point);if(Math.abs((media.currentTime||0)-wanted)>0.12)media.currentTime=wanted;
    if(autoplay)media.play().catch(()=>{});else media.pause();
  }else state.replacementAudio.pause();
}
function storeCursor(state,location,point,expose=true){
  const bounds=editorBounds(location.item,location.type),next=Math.max(bounds.start,Math.min(bounds.end,Number(point)||0));
  state.cursor=next;state.slider.value=String(next);
  if(next<bounds.end-0.0005)state.endReached=false;
  if(expose)state.slider.setAttribute("aria-valuetext",readableTime(next));
  state.position.textContent=`Position ${readableTime(next)}. Media duration ${readableTime(location.type==="program"?duration(project):itemDuration(location.item))}.`;
  return next;
}
function setEditorPosition(state,point,expose=true){
  const location=locateItem(state.id);if(!location||!location.item.duration)return false;
  const next=storeCursor(state,location,point,expose);
  if(location.type==="program")setProgramMedia(state,next,false);else state.video.currentTime=["sequence","source"].includes(location.type)?logicalToSourceTime(location.item,next):next;
  return true;
}
function updateEditorLabels(state,item,type){
  const title=editorTitle(item,type);
  state.section.setAttribute("aria-label",title);
  state.heading.textContent=title;
  state.video.setAttribute("aria-label",`${title} preview`);
  state.sliderLabel.textContent=`${title} playhead`;
  const edited=["sequence","source"].includes(type)&&Array.isArray(item.editSegments)&&item.editSegments.length,markText=`Left bracket ${state.markIn==null?"not set":readableTime(state.markIn)}. Right bracket ${state.markOut==null?"not set":readableTime(state.markOut)}.`;
  state.context.textContent=type==="program"?`${project.items.length} production ${project.items.length===1?"item":"items"}. Total duration ${readableTime(duration(project))}. ${targetText(programTarget())} targeted for a selected-range replacement. ${markText}`:edited?`Source selection editor. Edited duration ${readableTime(itemDuration(item))}. ${item.editSegments.length} retained ${item.editSegments.length===1?"segment":"segments"}. ${markText}`:`Source selection editor. ${markText}`;
  state.inButton.textContent="Set Left Bracket";
  state.outButton.textContent="Set Right Bracket";
  if(type!=="program")state.video.muted=false;
  const source=type==="source",program=type==="program";
  state.insertSelection.hidden=!source&&!program;state.appendSelection.hidden=!source;state.saveClip.hidden=!(source||(program&&project.items.length===1))||item.kind!=="Video";state.commitButton.hidden=!program&&!source;
  state.insertSelection.textContent=source?"Copy Selection (Ctrl+C)":"Paste Selection (Ctrl+V)";
  state.appendSelection.textContent="Remove Source from Project";
  const unavailable=state.loading||state.unsupported;
  state.insertSelection.disabled=unavailable||(source?!item.duration:!mediaClipboard);state.appendSelection.disabled=!source;
  state.play.disabled=unavailable;state.auditionButton.disabled=unavailable;state.slider.disabled=unavailable;
  state.commitButton.disabled=(!program&&!source)||unavailable||state.rendering;
  state.split.hidden=true;state.properties.hidden=program;
  state.both.disabled=item.kind!=="Video";state.videoOnly.disabled=item.kind!=="Video";state.audioOnly.disabled=!["Video","Audio"].includes(item.kind);
  const target=type==="program"?programTarget():itemTarget(item);state.both.setAttribute("aria-pressed",String(target==="both"));state.videoOnly.setAttribute("aria-pressed",String(target==="video"));state.audioOnly.setAttribute("aria-pressed",String(target==="audio"));
  state.targetFieldset.hidden=type!=="program";
}
function createEditor(item,type){
  const stateId=type==="program"?PROGRAM_ID:item.id;
  const section=document.createElement("section");section.className="editor-section media-item-editor";section.tabIndex=-1;section.dataset.mediaId=stateId;
  const heading=document.createElement("h2");section.append(heading);
  const video=document.createElement("video");video.className="media-preview";video.preload="metadata";video.controls=false;video.tabIndex=-1;video.setAttribute("aria-hidden","true");section.append(video);
  const sequenceImage=document.createElement("img");sequenceImage.className="media-preview";sequenceImage.hidden=true;sequenceImage.alt="";sequenceImage.setAttribute("aria-hidden","true");section.append(sequenceImage);
  const replacementVideo=document.createElement("video");replacementVideo.className="media-preview replacement-preview";replacementVideo.preload="auto";replacementVideo.controls=false;replacementVideo.tabIndex=-1;replacementVideo.hidden=true;replacementVideo.setAttribute("aria-hidden","true");section.append(replacementVideo);
  const replacementImage=document.createElement("img");replacementImage.className="media-preview replacement-preview";replacementImage.hidden=true;replacementImage.alt="";replacementImage.setAttribute("aria-hidden","true");section.append(replacementImage);
  const replacementAudio=new Audio();replacementAudio.preload="auto";
  const sliderLabel=document.createElement("label");const slider=document.createElement("input");const sliderId=`media-playhead-${++editorCounter}`;
  sliderLabel.htmlFor=sliderId;slider.id=sliderId;slider.type="range";slider.min="0";slider.max="0";slider.step="0.001";slider.value="0";section.append(sliderLabel,slider);
  const position=document.createElement("p"),context=document.createElement("p");section.append(position,context);
  const transport=document.createElement("div");transport.className="button-row";
  const play=document.createElement("button"),audition=document.createElement("button");
  play.type=audition.type="button";play.textContent="Play or Pause (X)";audition.textContent="Audition Selection or From Playhead (Space)";transport.append(play,audition);section.append(transport);
  const edit=document.createElement("div");edit.className="button-row";
  const inButton=document.createElement("button"),outButton=document.createElement("button"),commitButton=document.createElement("button"),goto=document.createElement("button"),properties=document.createElement("button"),split=document.createElement("button");
  [inButton,outButton,commitButton,goto,properties,split].forEach(button=>button.type="button");
  inButton.textContent="Set Left Bracket";outButton.textContent="Set Right Bracket";commitButton.textContent="Apply Bracketed Edit (Ctrl+Delete)";goto.textContent="Go to Time (Ctrl+G)";properties.textContent="Properties (Alt+Enter)";split.textContent="Split at Playhead (Ctrl+K)";
  edit.append(inButton,outButton,commitButton,goto,properties,split);section.append(edit);
  const workflow=document.createElement("div");workflow.className="button-row";
  const insertSelection=document.createElement("button"),appendSelection=document.createElement("button"),saveClip=document.createElement("button");
  [insertSelection,appendSelection].forEach(button=>button.type="button");
  insertSelection.textContent="Copy Selection (Ctrl+C)";appendSelection.textContent="Remove Source from Project";
  saveClip.type="button";saveClip.textContent="Save Selection as Source Clip";workflow.append(insertSelection,saveClip,appendSelection);section.append(workflow);
  const fieldset=document.createElement("fieldset"),legend=document.createElement("legend"),targets=document.createElement("div");legend.textContent="Track target";targets.className="button-row";
  const both=document.createElement("button"),videoOnly=document.createElement("button"),audioOnly=document.createElement("button");
  [both,videoOnly,audioOnly].forEach(button=>button.type="button");both.textContent="Both Audio and Video (B)";videoOnly.textContent="Video Only (V)";audioOnly.textContent="Audio Only (A)";
  targets.append(both,videoOnly,audioOnly);fieldset.append(legend,targets);section.append(fieldset);
  el["media-editor-sections"].append(section);
  const state={id:stateId,type,section,heading,video,sequenceImage,replacementVideo,replacementImage,replacementAudio,backgroundAudio:new Audio(),slider,sliderLabel,position,context,play,auditionButton:audition,inButton,outButton,commitButton,goto,properties,split,insertSelection,appendSelection,saveClip,targetFieldset:fieldset,both,videoOnly,audioOnly,cursor:0,markIn:null,markOut:null,markHistory:[],audition:null,unsupported:false,loading:!item.duration,rendering:false,monitoring:false,endReached:false,currentItemId:type==="program"?item.id:null,currentItemOffset:0,pendingSourceTime:0,pendingAutoplay:false,imagePlaying:false,imageTimer:null};
  editorStates.set(stateId,state);editorNodes.set(stateId,section);
  if(state.loading)position.textContent="Loading media. Please wait.";
  if(item.kind!=="Image"){video.dataset.sourcePath=item.source;video.src=sourceForItem(item);}else{state.loading=false;setProgramMedia(state,0,false);}
  video.addEventListener("loadedmetadata",()=>{if(type==="program"){
    const current=project.items.find(value=>value.id===state.currentItemId);if(current&&!current.duration&&Number.isFinite(video.duration)){project=updateItem(project,current.id,{duration:video.duration,inPoint:0,outPoint:video.duration,editSegments:[{start:0,end:video.duration}]});state.loading=false;render();announce(`Primary Production loaded. Duration ${readableTime(duration(project))}.`);}
    video.currentTime=state.pendingSourceTime||0;if(state.pendingAutoplay){state.pendingAutoplay=false;video.play().catch(()=>{});}
  }else handleMetadata(stateId,video.duration);});
  video.addEventListener("timeupdate",()=>handleTimeUpdate(stateId));
  video.addEventListener("ended",()=>{if(type!=="program")return;const current=project.items.find(value=>value.id===state.currentItemId),index=project.items.findIndex(value=>value.id===state.currentItemId);if(current&&index<project.items.length-1){const nextPoint=(state.currentItemOffset||0)+itemDuration(current);state.cursor=nextPoint;state.endReached=false;setProgramMedia(state,nextPoint,true);}else finishAtEnd(state,duration(project));});
  video.addEventListener("play",()=>{state.endReached=false;if(type==="program")syncTrackPreview(state,state.cursor,true);monitorPlayback(stateId);});
  video.addEventListener("pause",()=>{replacementVideo.pause();replacementAudio.pause();if(!state.imagePlaying)state.backgroundAudio.pause();});
  video.addEventListener("error",()=>handlePreviewError(stateId));
  section.addEventListener("focus",()=>{activateMedia(stateId,false);activeSectionIndex=sectionElements().indexOf(section);});
  slider.addEventListener("focus",()=>activateMedia(stateId,false));
  slider.addEventListener("input",()=>{activateMedia(stateId,false);cancelAudition(state,false);setEditorPosition(state,Number(slider.value),true);});
  play.addEventListener("click",()=>{activateMedia(stateId,false);togglePlayback();});
  audition.addEventListener("click",()=>{activateMedia(stateId,false);auditionSelection();});
  inButton.addEventListener("click",()=>{activateMedia(stateId,false);setPoint("in");});
  outButton.addEventListener("click",()=>{activateMedia(stateId,false);setPoint("out");});
  commitButton.addEventListener("click",()=>{activateMedia(stateId,false);commitPrimaryEdit();});
  goto.addEventListener("click",()=>{activateMedia(stateId,false);showGoToTime();});
  properties.addEventListener("click",()=>{activateMedia(stateId,false);showProperties();});
  split.addEventListener("click",()=>{activateMedia(stateId,false);splitSelected();});
  insertSelection.addEventListener("click",()=>{activateMedia(stateId,false);type==="source"?copySourceSelection():pasteMedia();});
  appendSelection.addEventListener("click",()=>{activateMedia(stateId,false);removeSelectedSource();});
  saveClip.addEventListener("click",()=>{activateMedia(stateId,false);saveSourceClip();});
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
  const updated=locateItem(state.id);updateEditorLabels(state,updated?.item||location.item,location.type);
  announce(`${extension} preview is not supported yet. Conversion is required.`,true);
}
function handleTimeUpdate(idValue){
  const state=editorStates.get(idValue),location=locateItem(idValue);if(!state||!location)return;
  const currentProgramItem=location.type==="program"?project.items.find(item=>item.id===state.currentItemId):null;
  const logicalNow=location.type==="program"?(state.currentItemOffset||0)+(currentProgramItem?sourceToLogicalTime(currentProgramItem,state.video.currentTime):0):["sequence","source"].includes(location.type)?sourceToLogicalTime(location.item,state.video.currentTime):state.video.currentTime;
  if(location.type==="program")syncTrackPreview(state,logicalNow,!state.video.paused);
  if(state.audition){
    if(logicalNow>=state.audition.end){
      const audition=state.audition;
      if(audition.ranges&&audition.rangeIndex<audition.ranges.length-1){audition.rangeIndex++;playAuditionRange(state,audition);return;}
      const point=audition.returnPoint,quiet=audition.quiet;cancelAudition(state,false);setEditorPosition(state,point,true);if(!quiet)updateStatus(`Playhead ${readableTime(point)}.`);return;
    }
    return;
  }
  if(state.video.paused)return;
  if(location.type==="program"&&currentProgramItem){
    const segments=normalizedSegments(currentProgramItem),sourceTime=state.video.currentTime,currentSegment=segments.findIndex(segment=>sourceTime>=segment.start-0.02&&sourceTime<segment.end-0.01);
    if(currentSegment<0&&!state.video.paused){
      const nextSegment=segments.find(segment=>sourceTime<segment.start);
      if(nextSegment){state.video.currentTime=nextSegment.start;return;}
      const currentIndex=project.items.findIndex(item=>item.id===currentProgramItem.id);
      if(currentIndex<project.items.length-1){const nextPoint=(state.currentItemOffset||0)+itemDuration(currentProgramItem);state.cursor=nextPoint;setProgramMedia(state,nextPoint,true);return;}
      finishAtEnd(state,duration(project));return;
    }
  }else if(["sequence","source"].includes(location.type)&&Array.isArray(location.item.editSegments)&&location.item.editSegments.length){
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
  const primary=project.items[0];const playable=[...(primary?[{item:primary,type:"program",stateId:PROGRAM_ID}]:[]),...(project.sources||[]).filter(item=>item.kind!=="Image").map(item=>({item,type:"source",stateId:item.id}))].filter(({item,type})=>(type==="program"?["Video","Audio","Image"]:["Video","Audio"]).includes(item.kind)&&item.source);
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
function selectedImage(){return(project.sources||[]).find(item=>item.id===selectedImageId&&item.kind==="Image")||null;}
function reviewSelectedImage(){const image=selectedImage();if(!image)return announce("No project image selected.",true);announce(`${image.label||image.name}. Reusable project image. Place it in Primary Production when ready.`);}
function moveSelectedImage(direction){
  const images=(project.sources||[]).filter(item=>item.kind==="Image"),index=images.findIndex(item=>item.id===selectedImageId),target=index+direction;
  if(index<0||target<0||target>=images.length)return announce(direction<0?"Image is already first.":"Image is already last.");
  const previous=project;project=moveSource(project,images[index].id,direction<0?-1:1);undoStack.push(previous);redoStack=[];render();el["image-items"].focus();announce(`${images[index].label||images[index].name} moved ${direction<0?"earlier":"later"}.`);
}
function renderEditorNavigation(playable){
  el["media-editor-navigation"].replaceChildren();
  playable.forEach(({item,type,stateId})=>{
    const button=document.createElement("button");button.type="button";button.className="section-tab";button.textContent=editorTitle(item,type);
    button.addEventListener("click",()=>activateMedia(stateId,true));el["media-editor-navigation"].append(button);
  });
}
function updateActiveAppearance(){
  for(const [idValue,state]of editorStates)state.section.classList.toggle("active-editor",idValue===activeMediaId);
}
function activateMedia(idValue,focus=true){
  const location=locateItem(idValue),state=editorStates.get(idValue);if(!location||!state)return;
  if(activeMediaId&&activeMediaId!==idValue){const old=editorStates.get(activeMediaId);if(old?.video&&!old.video.paused)old.video.pause();}
  activeMediaId=idValue;if(location.type==="source"){if(location.item.kind==="Image")selectedImageId=idValue;else selectedSourceId=idValue;}else if(location.type!=="program")selectedId=idValue;updateActiveAppearance();
  if(focus)state.section.focus();
  updateStatus(`${editorTitle(location.item,location.type)} active.`);
}

function render({focus=false}={}){
  el["project-items"].replaceChildren();
  if(!project.items.length){const option=new Option("No primary media","");option.disabled=true;el["project-items"].add(option);selectedId=null;}
  else{project.items.forEach((item,index)=>el["project-items"].add(new Option(itemListLabel(item,index,false),item.id)));if(!sequenceItem())selectedId=project.items[0].id;el["project-items"].value=selectedId;}
  const sources=project.sources||[],mediaSources=sources.filter(item=>item.kind!=="Image"),imageSources=sources.filter(item=>item.kind==="Image");el["source-items"].replaceChildren();
  if(!mediaSources.length){const option=new Option("No source video or audio","");option.disabled=true;el["source-items"].add(option);selectedSourceId=null;}
  else{mediaSources.forEach(item=>el["source-items"].add(new Option(itemListLabel(item,sources.indexOf(item),true),item.id)));if(!mediaSources.some(item=>item.id===selectedSourceId))selectedSourceId=mediaSources[0].id;el["source-items"].value=selectedSourceId;}
  el["image-items"].replaceChildren();if(!imageSources.length){const option=new Option("No project images","");option.disabled=true;el["image-items"].add(option);selectedImageId=null;}else{imageSources.forEach((item,index)=>el["image-items"].add(new Option(`Image ${index+1}. ${item.label||item.name}`,item.id)));if(!imageSources.some(item=>item.id===selectedImageId))selectedImageId=imageSources[0].id;el["image-items"].value=selectedImageId;}
  const replacements=project.trackReplacements||[];el["replacement-items"].replaceChildren();
  if(!replacements.length){const option=new Option("No track replacements","");option.disabled=true;el["replacement-items"].add(option);selectedReplacementId=null;}
  else{replacements.forEach(edit=>el["replacement-items"].add(new Option(`${targetText(edit.target)}. ${edit.label}. ${readableTime(edit.timelineStart)} through ${readableTime(edit.timelineEnd)}.`,edit.id)));if(!replacements.some(edit=>edit.id===selectedReplacementId))selectedReplacementId=replacements.at(-1).id;el["replacement-items"].value=selectedReplacementId;}
  const selected=sequenceItem(),source=sourceItem(),imageSource=imageSources.find(item=>item.id===selectedImageId)||null,index=project.items.findIndex(item=>item.id===selectedId);
  el["selected-item-summary"].textContent=selected?itemSummary(selected,index,false):"No primary media selected.";
  el["selected-source-summary"].textContent=source?itemSummary(source,sources.findIndex(item=>item.id===selectedSourceId),true):"No source media selected.";
  el["selected-image-summary"].textContent=imageSource?`Reusable project image. ${imageSource.label||imageSource.name}. Importing it did not change Primary Production.`:"No project image selected.";
  el["image-library-summary"].textContent=imageSources.length?`${imageSources.length} reusable project ${imageSources.length===1?"image":"images"}. Images are excluded from Primary Production until deliberately placed.`:"No project images. Open Media to add images without changing Primary Production.";
  const selectedReplacement=replacements.find(edit=>edit.id===selectedReplacementId);el["selected-replacement-summary"].textContent=selectedReplacement?`${targetText(selectedReplacement.target)} replacement. ${selectedReplacement.label}. From ${readableTime(selectedReplacement.timelineStart)} through ${readableTime(selectedReplacement.timelineEnd)}.`:"No track replacement selected.";el["remove-replacement-button"].disabled=!selectedReplacement;
  el["edit-primary-button"].disabled=!selected;el["move-earlier-button"].disabled=!selected||index===0;el["move-later-button"].disabled=!selected||index===project.items.length-1;el["remove-item-button"].disabled=!selected;
  el["activate-source-button"].disabled=!source;el["make-source-primary-button"].disabled=!source||!project.items.length;el["insert-source-button"].disabled=!source||!selected||!source.duration;el["append-source-button"].disabled=!source||!source.duration;el["remove-source-button"].disabled=!source;
  el["activate-image-button"].disabled=!imageSource;el["place-image-button"].disabled=!imageSource;el["move-image-earlier-button"].disabled=!imageSource||imageSources.indexOf(imageSource)===0;el["move-image-later-button"].disabled=!imageSource||imageSources.indexOf(imageSource)===imageSources.length-1;el["remove-image-button"].disabled=!imageSource;
  renderEditors();
  const primary=project.items.find(item=>item.role==="primary")||project.items[0];const workingName=project.path?project.name:primary?(primary.name||primary.label):"Accessible Media Editor";
  el["project-heading"].textContent=displayName({name:workingName});
  el["project-summary"].textContent=primary?`${project.items.length} primary sequence ${project.items.length===1?"item":"items"}. ${mediaSources.length} source video or audio ${mediaSources.length===1?"item":"items"}. ${imageSources.length} project ${imageSources.length===1?"image":"images"}. ${project.path?(project.dirty?"Project has unsaved changes.":"Project saved."):"No project required."}`:imageSources.length?`No Primary Production. ${imageSources.length} project ${imageSources.length===1?"image":"images"} available in the Project Image Library.`:"No media open. Press Ctrl+O to begin.";
  const replacementCount=(project.trackReplacements||[]).length;
  el["output-summary"].textContent=primary?`Primary Production duration ${readableTime(duration(project))}. ${replacementCount} track ${replacementCount===1?"replacement":"replacements"}. Source media is excluded until inserted or used as a replacement.`:"Open media to begin editing. Project creation is optional.";
  el["export-button"].disabled=!primary;
  const title=`${project.dirty?"* ":""}${workingName}${workingName==="Accessible Media Editor"?"":" - Accessible Media Editor"}`;document.title=title;
  if(invoke&&title!==lastNativeTitle){lastNativeTitle=title;invoke("set_window_title",{title}).catch(()=>{});}
  if(activeWorkspace==="presentation")renderPresentation();
  collectLibraryItems();
  if(focus){const active=locateItem(activeMediaId);(active?.type==="source"?el["source-items"]:project.items.length?el["project-items"]:selectedImageId?el["image-items"]:el["project-items"]).focus();}
}

function saveSourceClip(){
  const location=activeLocation(),state=activeState();
  if(!location||!["source","program"].includes(location.type)||location.item.kind!=="Video"||!state)return announce("Activate a Source Video or single-video Primary Production before saving a clip.",true);
  if(location.type==="program"&&(project.items.length!==1||project.trackReplacements?.length))return announce("For multi-item productions, select the original video in Source Media before saving a clip.",true);
  const plan=bracketSelectionPlan(location.type==="program"?duration(project):itemDuration(location.item),state.markIn,state.markOut);
  if(!plan||plan.selectedRanges.length!==1)return announce("Set outward Left and Right Brackets around one continuous video clip before saving.",true);
  const range=plan.selectedRanges[0],length=range.to-range.from;
  if(length<0.001)return announce("Select a nonempty video clip.",true);
  const source=location.item,number=(project.sources||[]).filter(item=>item.savedClip).length+1;
  const clip={...structuredClone(source),id:id(),role:"source",savedClip:true,label:`Clip ${number} - ${source.label||source.name} - ${readableTime(range.from)} to ${readableTime(range.to)}`,inPoint:0,outPoint:null,editSegments:logicalSegmentsForRanges(source,[range]),workingSource:source.workingSource||source.source};
  const next=addSource(project,clip);
  const end=range.to;
  clearEditorMarks(state);
  setEditorPosition(state,end,true);
  if(location.type==="source")selectedSourceId=source.id;activeMediaId=state.id;
  rememberChange(next,`Clip ${number} saved. Start ${readableTime(range.from)}. End ${readableTime(end)}. Duration ${readableTime(length)}. Playhead at ${readableTime(end)}. Ready for next selection.`);
  const updated=editorStates.get(state.id);
  if(updated){
    setEditorPosition(updated,end,true);
    // Saving a clip must not move keyboard focus away from its command.
    // The editor section remains mounted when the source library is updated.
    updated.saveClip.focus();
  }
}

function sectionElements(){return[[...el["media-editor-sections"].querySelectorAll(".media-item-editor")],el["media-section"],el["image-library-section"],el["output-section"]].flat();}
const workspaceOrder=["media","presentation","audio"];
const workspaceTabs={media:"media-editor-tab",presentation:"presentation-tab",audio:"audio-studio-tab"};
const workspacePanels={media:"media-editor-workspace",presentation:"presentation-workspace",audio:"audio-studio-workspace"};
const presentationSections=["presentation-builder-section","presentation-music-section","presentation-accessibility-section"];
let presentationSectionIndex=0;
function focusSection(offset){
  if(activeWorkspace==="audio")return announce("AudioStudio Pro does not have editor sections yet.");
  if(activeWorkspace==="presentation"){
    presentationSectionIndex=(presentationSectionIndex+offset+presentationSections.length)%presentationSections.length;
    const section=el[presentationSections[presentationSectionIndex]];section.focus();updateStatus(`${section.querySelector("h2").textContent} section.`);return;
  }
  const sections=sectionElements();activeSectionIndex=(activeSectionIndex+offset+sections.length)%sections.length;const section=sections[activeSectionIndex];
  if(section.dataset.mediaId)activateMedia(section.dataset.mediaId,false);section.focus();
  updateStatus(`${section.querySelector("h2")?.textContent||"Media Library"} section.`);
}
function activateSection(sectionId){const section=el[sectionId];activeSectionIndex=sectionElements().indexOf(section);section.focus();updateStatus(`${section.querySelector("h2").textContent} section.`);}
function presentationItems(){return project.presentation?.items||[];}
function presentationDuration(){return presentationTimelineDuration(presentationItems());}
function sharedPresentationSources(){
  const seen=new Set();return [...(project.sources||[]),...project.items].filter(item=>{if(seen.has(item.id))return false;seen.add(item.id);return true;});
}
function renderPresentation(){
  const items=presentationItems(),sources=sharedPresentationSources();
  const oldSelection=new Set([...el["presentation-items"].selectedOptions].map(option=>option.value)),oldSource=el["presentation-sources"].value;
  el["presentation-items"].replaceChildren(...items.map((item,index)=>{const transition=index&&item.transition?.type==="crossfade"?` Crossfade ${readableTime(presentationTransitionDuration(item,items[index-1]))}.`:"";const audio=["Video","Audio"].includes(item.kind)?` Foreground audio ${item.audioMuted?"muted":`${Math.round((item.audioVolume??1)*100)} percent`}.`:"";return new Option(`${item.kind}. ${item.label||item.name}. ${readableTime(itemDuration(item))}.${transition}${audio}`,item.id);}));
  el["presentation-sources"].replaceChildren(...sources.map(item=>new Option(`${item.kind}. ${item.label||item.name}. ${readableTime(itemDuration(item))}.`,item.id)));
  for(const option of el["presentation-items"].options)option.selected=oldSelection.has(option.value);
  const musicSources=[...libraryItems,...sources].filter((item,index,array)=>item.kind==="Audio"&&array.findIndex(other=>other.source===item.source)===index);
  el["presentation-music-source"].replaceChildren(new Option("No background music",""),...musicSources.map(item=>new Option(item.label||item.name,item.source)));
  el["presentation-music-source"].value=project.presentation?.backgroundMusic?.source||"";
  el["presentation-music-volume"].value=Math.round((project.presentation?.backgroundMusic?.volume??0.35)*100);
  el["presentation-music-duck"].value=Math.round((project.presentation?.backgroundMusic?.duckFactor??0.25)*100);
  el["presentation-music-status"].textContent=project.presentation?.backgroundMusic?`Background music: ${musicSources.find(item=>item.source===project.presentation.backgroundMusic.source)?.name||"Selected audio"}. Normal volume ${el["presentation-music-volume"].value} percent. During video or audio ${el["presentation-music-duck"].value} percent of normal.`:"No background music selected.";
  el["presentation-project-status"].textContent=project.path?`Presentation project: ${project.name}. ${project.dirty?"Unsaved changes.":"Saved."}`:`Presentation project has not been saved.${project.dirty?" Unsaved changes are present.":""}`;
  if(sources.some(item=>item.id===oldSource))el["presentation-sources"].value=oldSource;
  el["presentation-sequence-summary"].textContent=`${items.length} presentation items. Total duration ${readableTime(presentationDuration())}. Media Editor Primary Production is independent.`;
  loadPresentationDescriptions();
}
function loadPresentationDescriptions(){
  const item=presentationItems().find(item=>item.id===el["presentation-items"].value);
  el["presentation-alt"].value=item?.alternativeText||"";
  el["presentation-dialogue"].value=item?.dialogueDraft||"";
  el["presentation-alt-ad"].checked=Boolean(item?.useAlternativeTextForAd);el["presentation-dialogue-ad"].checked=Boolean(item?.useDialogueForAd);
  el["presentation-save-accessibility"].disabled=!item;
}
function modifyPresentation(next,selected,description){
  if(next===project)return announce("No change to presentation sequence.");
  undoStack.push(project);redoStack=[];project=next;render();
  if(selected&&presentationItems().some(item=>item.id===selected))el["presentation-items"].value=selected;
  loadPresentationDescriptions();announce(description);
}
function newPresentation(){
  if(presentationItems().length&&!window.confirm("Clear the current presentation sequence? Shared media and Media Editor edits will be kept."))return;
  const next=structuredClone(project);next.presentation={items:[]};next.dirty=true;
  modifyPresentation(next,null,"New empty presentation. Presentation Timeline ready. Shared media remains available.");el["presentation-items"].focus();
}
function createSlideshow(){
  const images=sharedPresentationSources().filter(item=>item.kind==="Image");
  if(!images.length)return announce("No images in the shared source library. Import images first.",true);
  const seconds=Number(el["presentation-slide-duration"].value);
  if(!Number.isFinite(seconds)||seconds<0.1||seconds>3600)return announce("Enter a slide duration between 0.1 and 3600 seconds.",true);
  const next=structuredClone(project);next.presentation||={items:[]};
  const newSlides=images.map(source=>({...structuredClone(source),id:id(),role:"presentation",duration:seconds,inPoint:0,outPoint:seconds,editSegments:[{start:0,end:seconds}]}));
  next.presentation.items.push(...newSlides);next.dirty=true;
  modifyPresentation(next,newSlides[0].id,`${newSlides.length} images added to the presentation at ${readableTime(seconds)} each. ${next.presentation.items.length} total items. Existing items preserved.`);
  el["presentation-items"].focus();
}
function addPresentationSource(position){
  const source=sharedPresentationSources().find(item=>item.id===el["presentation-sources"].value);
  if(!source)return announce("Choose a source from the shared library first.",true);
  const items=presentationItems(),target=el["presentation-items"].value,targetIndex=items.findIndex(item=>item.id===target);
  const next=structuredClone(project);next.presentation||={items:[]};
  const copy={...structuredClone(source),id:id(),role:"presentation"};
  const index=position==="end"?next.presentation.items.length:targetIndex<0?next.presentation.items.length:targetIndex+(position==="after"?1:0);
  next.presentation.items.splice(index,0,copy);next.dirty=true;
  modifyPresentation(next,copy.id,`${copy.label||copy.name} inserted at presentation position ${index+1} of ${next.presentation.items.length}.`);
  el["presentation-items"].focus();
}
function movePresentation(direction){
  const selected=el["presentation-items"].value,items=presentationItems(),index=items.findIndex(item=>item.id===selected);
  if(index<0)return announce("Select a presentation item first.",true);
  const target=index+direction;if(target<0||target>=items.length)return announce(direction<0?"Already first.":"Already last.");
  const next=structuredClone(project),[item]=next.presentation.items.splice(index,1);
  next.presentation.items.splice(target,0,item);next.dirty=true;
  modifyPresentation(next,selected,`${item.label||item.name} moved to presentation position ${target+1}.`);
}
function addPresentationCrossfade(){const selected=el["presentation-items"].value,items=presentationItems(),index=items.findIndex(item=>item.id===selected);if(index<0)return announce("Choose an item in the Presentation Timeline first.",true);if(index===0)return announce("The first presentation item cannot have an incoming transition. Choose the second item or a later item.",true);const next=structuredClone(project),item=next.presentation.items[index];item.transition={type:"crossfade",duration:1};next.dirty=true;modifyPresentation(next,selected,`Crossfade 1 second added into ${item.label||item.name}, presentation item ${index+1} of ${items.length}.`);el["presentation-items"].focus();}
function applyPresentationTransition(remove=false){const selected=selectedPresentationItems();if(!selected.length)return announce("Choose one or more Presentation Timeline items first.",true);const selectedIds=new Set(selected.map(item=>item.id)),seconds=Number(el["presentation-bulk-transition-duration"].value);if(!remove&&(!Number.isFinite(seconds)||seconds<.1||seconds>10))return announce("Transition duration must be between 0.1 and 10 seconds.",true);const next=structuredClone(project),changed=[];next.presentation.items.forEach((item,index)=>{if(!selectedIds.has(item.id)||index===0)return;item.transition=remove?{type:"none",duration:0}:{type:el["presentation-bulk-transition-type"].value,duration:seconds};changed.push(item.id);});if(!changed.length)return announce("The first presentation item cannot have an incoming transition. Choose the second item or a later item.",true);next.dirty=true;undoStack.push(project);redoStack=[];project=next;renderPresentation();for(const option of el["presentation-items"].options)option.selected=changed.includes(option.value);el["presentation-items"].focus();announce(remove?`${changed.length} presentation ${changed.length===1?"transition":"transitions"} removed.`:`Crossfade ${readableTime(seconds)} applied to ${changed.length} presentation ${changed.length===1?"item":"items"}.`);}
function removePresentation(){
  const selected=new Set([...el["presentation-items"].selectedOptions].map(option=>option.value));
  if(!selected.size&&el["presentation-items"].value)selected.add(el["presentation-items"].value);
  if(!selected.size)return announce("Select one or more presentation items first.",true);
  const next=structuredClone(project),before=next.presentation.items.length;
  next.presentation.items=next.presentation.items.filter(item=>!selected.has(item.id));
  next.dirty=true;
  modifyPresentation(next,null,`${before-next.presentation.items.length} items removed from presentation. Shared library media was not deleted.`);
  el["presentation-items"].focus();
}
function selectedPresentationItems(){
  const selected=new Set([...el["presentation-items"].selectedOptions].map(option=>option.value));
  if(!selected.size&&el["presentation-items"].value)selected.add(el["presentation-items"].value);
  return presentationItems().filter(item=>selected.has(item.id));
}
function copyPresentation(cut=false){
  const selected=selectedPresentationItems();if(!selected.length)return announce("Move to the Presentation Timeline and choose an item first. Press Alt+P to go there.",true);
  presentationClipboard=structuredClone(selected);
  if(!cut){announce(`${selected.length} presentation ${selected.length===1?"item":"items"} copied.`);return;}
  const selectedIds=new Set(selected.map(item=>item.id)),items=presentationItems(),firstIndex=items.findIndex(item=>selectedIds.has(item.id));
  const next=structuredClone(project);next.presentation.items=next.presentation.items.filter(item=>!selectedIds.has(item.id));next.dirty=true;
  const nextSelected=next.presentation.items[Math.min(firstIndex,next.presentation.items.length-1)]?.id||null;
  modifyPresentation(next,nextSelected,`${selected.length} presentation ${selected.length===1?"item":"items"} cut to the presentation clipboard.`);el["presentation-items"].focus();
}
function pastePresentation(){
  if(!presentationClipboard.length)return announce("Cut or copy one or more Presentation Timeline items first.",true);
  const next=structuredClone(project);next.presentation||={items:[]};
  const target=el["presentation-items"].value,targetIndex=next.presentation.items.findIndex(item=>item.id===target),index=targetIndex<0?next.presentation.items.length:targetIndex;
  const copies=presentationClipboard.map(item=>({...structuredClone(item),id:id()}));next.presentation.items.splice(index,0,...copies);next.dirty=true;
  modifyPresentation(next,copies[0].id,`${copies.length} presentation ${copies.length===1?"item":"items"} pasted before position ${index+1}.`);el["presentation-items"].focus();
}
function copyMediaAction(){if(activeWorkspace==="presentation")return copyPresentation(false);return copySourceSelection();}
function cutMediaAction(){if(activeWorkspace==="presentation")return copyPresentation(true);announce("Cut is available in the Presentation Production Sequence. Use Ctrl+Delete to remove a marked media range.");}
function pasteMediaAction(){if(activeWorkspace==="presentation")return pastePresentation();return pasteMedia();}
function focusPresentationTimeline(){
  if(activeWorkspace!=="presentation")return announce("The Presentation Timeline is available in the Presentation workspace.",true);
  el["presentation-items"].focus();announce(`${presentationItems().length} items in the Presentation Timeline. Use Arrow keys to choose an item.`);
}
function focusPresentationSources(){
  if(activeWorkspace!=="presentation")return announce("The Source Media Library is available in the Presentation workspace.",true);
  el["presentation-sources"].focus();announce(`${sharedPresentationSources().length} items in the Source Media Library. Adding a source does not remove it from the library.`);
}
function setPresentationMusic(remove=false){
  const source=remove?"":el["presentation-music-source"].value;
  if(!remove&&!source)return announce("Choose an audio file from the music source list first.",true);
  const volume=Number(el["presentation-music-volume"].value);
  if(!Number.isFinite(volume)||volume<0||volume>100)return announce("Music volume must be between 0 and 100 percent.",true);
  const duck=Number(el["presentation-music-duck"].value);
  if(!Number.isFinite(duck)||duck<0||duck>100)return announce("The music level during video or audio must be between 0 and 100 percent.",true);
  const next=structuredClone(project);next.presentation||={items:[]};
  next.presentation.backgroundMusic=source?{source,volume:volume/100,duckFactor:duck/100,duckRanges:[]}:null;
  next.dirty=true;modifyPresentation(next,null,source?`Background music set at ${volume} percent. It will lower to ${duck} percent of that level during video or audio.`:"Background music removed from presentation.");
  el["presentation-music-apply"].focus();
}
function presentationBackgroundMusic(){
  const music=project.presentation?.backgroundMusic;
  return music?{...structuredClone(music),duckRanges:presentationDuckRanges(presentationItems())}:null;
}
async function renderCompletePresentation(purpose){
  if(!invoke)throw new Error(`Presentation ${purpose} requires the installed Windows application.`);
  if(!presentationItems().length)throw new Error("Add items to the presentation first.");
  if(presentationItems().some(item=>!["Video","Image","Audio"].includes(item.kind)))throw new Error("This presentation contains an unsupported item type.");
  const renderProject={items:presentationItems(),trackReplacements:[],backgroundMusic:presentationBackgroundMusic()};
  return invoke("render_production",{items:productionRenderItems(renderProject),replacements:[],backgroundMusic:productionRenderBackgroundMusic(renderProject),projectId:`${project.name||"Presentation"}-presentation`});
}
async function previewPresentation(){
  exportPhase="rendering";
  showExportProgress("Rendering presentation preview. Please wait.");
  try{
    const source=await renderCompletePresentation("preview");await exportNarrationChain;closeExportProgress();exportPhase="idle";
    const media=el["presentation-preview-media"];media.src=convertFileSrc?convertFileSrc(source):source;media.currentTime=0;media.load();await waitForMediaReady(media);el["presentation-preview-dialog"].showModal();media.focus();
  }catch(error){closeExportProgress();exportPhase="idle";announce(`Presentation preview failed. ${error}`,true);}
}
function closePresentationPreview(){
  const media=el["presentation-preview-media"];media.pause();media.removeAttribute("src");media.load();
  if(el["presentation-preview-dialog"].open)el["presentation-preview-dialog"].close();el["presentation-preview"].focus();
}
async function exportPresentation(){
  if(!invoke)return announce("Presentation export requires the installed Windows application.",true);
  if(!presentationItems().length)return announce("Add items to the presentation before exporting.",true);
  const unsupported=presentationItems().find(item=>!["Video","Image","Audio"].includes(item.kind));
  if(unsupported)return announce("This presentation contains an unsupported item type.",true);
  exportPhase="rendering";showExportProgress("Rendering presentation and background music. Please wait.");
  try{
    const source=await renderCompletePresentation("export");await exportNarrationChain;
    closeExportProgress();exportPhase="choosing-destination";
    const path=await invoke("export_edited_media",{source,suggestedName:`${project.name||"Presentation"}.mp4`,format:"mp4"});
    exportPhase="idle";if(path){lastExportPath=path;el["export-success-path"].textContent=`Presentation saved to ${path}.`;el["export-success-dialog"].showModal();el["export-success-show-file"].focus();announce("Presentation export completed.");}
    else announce("Presentation export save canceled.");
  }catch(error){closeExportProgress();exportPhase="idle";announce(`Presentation export failed. ${error}`,true);}
}
function savePresentationDescriptions(){
  const selected=el["presentation-items"].value;if(!selected)return announce("Select a presentation item first.",true);
  const next=structuredClone(project),item=next.presentation.items.find(item=>item.id===selected);
  item.alternativeText=el["presentation-alt"].value;item.dialogueDraft=el["presentation-dialogue"].value;item.useAlternativeTextForAd=el["presentation-alt-ad"].checked;item.useDialogueForAd=el["presentation-dialogue-ad"].checked;next.dirty=true;
  modifyPresentation(next,selected,"Presentation item descriptions saved in project metadata.");
}
function closePresentationItemProperties(){if(el["presentation-item-properties-dialog"].open)el["presentation-item-properties-dialog"].close();el["presentation-items"].focus();}
function showPresentationItemProperties(){const items=presentationItems(),index=items.findIndex(item=>item.id===el["presentation-items"].value);if(index<0)return announce("Choose an item in the Presentation Timeline first.",true);const item=items[index],media=["Video","Audio"].includes(item.kind),image=item.kind==="Image",segments=normalizedSegments(item),singleSegment=segments.length===1;el["presentation-item-properties-name"].textContent=`Item ${index+1} of ${items.length}. ${item.kind}. ${item.label||item.name}.`;el["presentation-item-label"].value=item.label||item.name;el["presentation-image-duration-fields"].hidden=!image;el["presentation-item-duration"].value=itemDuration(item);el["presentation-media-boundary-fields"].hidden=!media||!singleSegment;writeTime("presentation-start",singleSegment?segments[0].start:0);writeTime("presentation-end",singleSegment?segments[0].end:0);el["presentation-item-audio-fields"].hidden=!media;el["presentation-item-audio-volume"].value=Math.round((item.audioVolume??1)*100);el["presentation-item-audio-muted"].checked=Boolean(item.audioMuted);el["presentation-transition-type"].value=index?item.transition?.type||"none":"none";el["presentation-transition-duration"].value=index?Number(item.transition?.duration)||1:1;el["presentation-transition-type"].disabled=index===0;el["presentation-transition-duration"].disabled=index===0;el["presentation-transition-help"].textContent=index===0?"The first timeline item cannot have an incoming transition.":"The transition overlaps the end of the previous item and the beginning of this item.";el["presentation-item-properties-dialog"].showModal();el["presentation-item-label"].focus();}
function savePresentationItemProperties(){const selected=el["presentation-items"].value,next=structuredClone(project),items=next.presentation.items,index=items.findIndex(item=>item.id===selected);if(index<0)return closePresentationItemProperties();const item=items[index],media=["Video","Audio"].includes(item.kind),image=item.kind==="Image";item.label=el["presentation-item-label"].value.trim()||item.name;if(image){const value=Number(el["presentation-item-duration"].value);if(!Number.isFinite(value)||value<.001||value>3600)return announce("Enter an image duration between 0.001 and 3600 seconds.",true);item.duration=value;item.inPoint=0;item.outPoint=value;item.editSegments=[{start:0,end:value}];}if(media&&!(item.editSegments?.length>1)){const start=readTime("presentation-start"),end=readTime("presentation-end"),limit=Number(item.duration)||0;if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>limit)return announce("Enter valid start and end times within the source duration.",true);item.inPoint=start;item.outPoint=end;item.editSegments=[{start,end}];}if(media){const volume=Number(el["presentation-item-audio-volume"].value);if(!Number.isFinite(volume)||volume<0||volume>100)return announce("Foreground audio volume must be between 0 and 100 percent.",true);item.audioVolume=volume/100;item.audioMuted=el["presentation-item-audio-muted"].checked;}const type=index?el["presentation-transition-type"].value:"none",seconds=type==="crossfade"?Number(el["presentation-transition-duration"].value):0;if(type==="crossfade"&&(!Number.isFinite(seconds)||seconds<.1||seconds>10))return announce("Crossfade duration must be between 0.1 and 10 seconds.",true);item.transition={type,duration:seconds};if(index&&type==="crossfade"&&presentationTransitionDuration(item,items[index-1])<seconds-.0005)return announce("The crossfade is too long for one of the neighboring items. Shorten the transition or lengthen the item.",true);next.dirty=true;undoStack.push(project);redoStack=[];project=next;closePresentationItemProperties();renderPresentation();el["presentation-items"].value=selected;el["presentation-items"].focus();announce(`${item.label||item.name} properties saved. ${type==="crossfade"?`Crossfade ${readableTime(seconds)}.`:"No incoming transition."}`);}
function switchWorkspace(direction=1,target=null){
  const next=target||workspaceOrder[(workspaceOrder.indexOf(activeWorkspace)+direction+workspaceOrder.length)%workspaceOrder.length];
  if(!workspaceTabs[next]||!workspacePanels[next])return;
  // The selected tab is the single accessible announcement source. Focusing the
  // entire tab panel made JAWS repeatedly announce the document/window title.
  // Do not also announce the workspace through a live region.
  if(next===activeWorkspace)return;
  activeWorkspace=next;
  for(const name of workspaceOrder){
    const selected=name===next;
    el[workspaceTabs[name]].setAttribute("aria-selected",String(selected));
    el[workspaceTabs[name]].tabIndex=selected?0:-1;
    el[workspacePanels[name]].hidden=!selected;
  }
  if(next==="presentation")renderPresentation();
  const destination=next==="presentation"?el["presentation-items"]:next==="media"?(editorStates.get(activeMediaId)?.slider||(project.items.length?el["project-items"]:el["import-media-button"])):el["audio-studio-heading"];destination?.focus();
}

async function importMedia(){
  if(!invoke)return announce("The Windows file picker is available in the installed application.",true);
  const previous=project,previousSelectedId=selectedId,previousSourceId=selectedSourceId,previousImageId=selectedImageId,previousActiveId=activeMediaId;
  try{
    updateStatus("Opening Windows file picker...");
    const paths=await invoke("pick_media_files");
    updateStatus(paths.length ? `Selected ${paths.length} media file(s). Preparing import.` : "Open Media canceled. No files selected.");
    if(!paths.length){updateStatus("Open Media canceled. No files selected.");return;}
    const projectPaths=paths.filter(path=>/\.ameproject$/i.test(path));
    if(projectPaths.length){
      if(paths.length!==1)return announce("A project file cannot be opened together with media. Open the AMEPROJECT separately with Ctrl+Shift+O.",true);
      if(project.dirty&&!window.confirm("Discard unsaved changes and open the selected project?"))return;
      updateStatus("Opening Accessible Media Editor project...");
      const result=await invoke("open_project_path",{path:projectPaths[0]});applyOpenedProject(result);announce(`${project.name} opened as an editable project.`);return;
    }
    announce("Preparing selected media. Please wait.");let next=project,primaryAdded=false,sourceCount=0,imageCount=0,importedCount=0;const skipped=[];
    for(let mediaIndex=0;mediaIndex<paths.length;mediaIndex++){
      const path=paths[mediaIndex],name=baseName(path);
      if(!supportedMediaPath(path)){skipped.push({name,reason:"unsupported file type"});updateStatus(`Skipped ${name}. Processing file ${mediaIndex+1} of ${paths.length}.`);continue;}
      const kind=kindFromPath(path),itemId=id();let workingPath=path;
      try{
        announce(`${kind==="Image"?"Adding":"Converting"} media ${mediaIndex+1} of ${paths.length}. Please wait.`);
        const media={id:itemId,source:workingPath,workingSource:kind==="Image"?workingPath:null,originalSource:path,name,label:name,kind,duration:kind==="Image"?5:null,inPoint:0,outPoint:null,trackTarget:kind==="Audio"?"audio":kind==="Image"?"video":"both"};
        if(kind==="Image"){media.role="source";next=addSource(next,media);selectedImageId=media.id;sourceCount++;imageCount++;importedCount++;continue;}
        workingPath=await invoke("normalize_media",{source:path,mediaKind:kind,itemId});media.source=media.workingSource=workingPath;
        if(!next.items.length&&!primaryAdded){media.role="primary";next=addItem(next,media,null);selectedId=media.id;activeMediaId=PROGRAM_ID;primaryAdded=true;}
        else{media.role="source";next=addSource(next,media);selectedSourceId=media.id;sourceCount++;}
        importedCount++;
      }catch(error){skipped.push({name,reason:String(error)});updateStatus(`${name} could not be imported. Continuing with file ${mediaIndex+2} of ${paths.length}.`);}
    }
    project=next;render();if(primaryAdded)editorStates.get(PROGRAM_ID)?.section.focus();else if(imageCount)el["image-library-section"].focus();if(next!==previous)undoStack.push(previous);
    const skippedText=skipped.length?` ${skipped.length} ${skipped.length===1?"file was":"files were"} skipped without canceling the import${skipped.length===1?`: ${skipped[0].name}.`:"."}`:"";
    if(!importedCount)return announce(`No media was imported.${skippedText}`,true);
    if(imageCount&&sourceCount===imageCount&&!primaryAdded)announce(`${imageCount} ${imageCount===1?"image":"images"} added to the Project Image Library. Primary Production was not changed.${skippedText}`);
    else if(primaryAdded)announce(`Import complete. Primary media added with ${sourceCount} source media ${sourceCount===1?"item":"items"}. ${imageCount?`${imageCount} added to the Project Image Library. `:""}${skippedText}`);
    else announce(`Import complete. ${sourceCount} source media ${sourceCount===1?"item":"items"} added. ${imageCount?`${imageCount} added to the Project Image Library. `:""}Primary Production was not changed.${skippedText}`);cue("add");
  }catch(error){project=previous;selectedId=previousSelectedId;selectedSourceId=previousSourceId;selectedImageId=previousImageId;activeMediaId=previousActiveId;editorStates.clear();editorNodes.clear();el["media-editor-sections"].replaceChildren();render();announce(`Media import failed and was rolled back. ${error}`,true);}
}

function retainedPrimaryRange(){
  const state=editorStates.get(PROGRAM_ID);if(!state||!project.items.length)return null;
  const plan=bracketSelectionPlan(duration(project),state.markIn,state.markOut);
  return plan?.selectedRanges?.length===1&&plan.kind!=="empty"?plan.selectedRanges[0]:null;
}
function requestImagePlacement(image){
  const range=retainedPrimaryRange();pendingImage={image,range};el["image-placement-name"].textContent=image.name;
  el["image-use-range"].disabled=!range;el["image-range-summary"].textContent=range?`Retained range: ${readableTime(range.from)} through ${readableTime(range.to)}. Duration ${readableTime(range.to-range.from)}.`:"No retained Primary Production range is available.";
  el[range?"image-use-range":"image-use-exact"].checked=true;writeTime("image-duration",Number(localStorage.getItem("ame-image-duration"))||5);
  const program=editorStates.get(PROGRAM_ID),point=program?.cursor||0;el["image-placement-instructions"].textContent=range?`The retained Primary range is ready. Existing audio will continue while this image is displayed.`:`No retained range is available. The image will begin at the Primary playhead, ${readableTime(point)}. Existing audio will continue.`;
  el["image-placement-dialog"].showModal();el["image-placement-heading"].focus();
  return new Promise(resolve=>{imagePlacementResolve=resolve;});
}
function finishImagePlacement(result){if(el["image-placement-dialog"].open)el["image-placement-dialog"].close();const resolve=imagePlacementResolve;imagePlacementResolve=null;pendingImage=null;resolve?.(result);}
function confirmImagePlacement(){
  if(!pendingImage)return;const useRange=el["image-use-range"].checked&&!el["image-use-range"].disabled;
  if(useRange)return finishImagePlacement({mode:"range",range:pendingImage.range});
  const seconds=readTime("image-duration");if(!Number.isFinite(seconds)||seconds<0.001)return announce("Enter a valid image duration.",true);
  localStorage.setItem("ame-image-duration",String(seconds));finishImagePlacement({mode:"exact",duration:seconds});
}
async function placeImageSource(sourceImage){
  const image=structuredClone(sourceImage);
  const choice=await requestImagePlacement(image);if(!choice){announce("Image insertion canceled.");return;}
  if(choice.mode==="range"){
    const length=choice.range.to-choice.range.from,clip={...image,duration:length,editSegments:[{start:0,end:length}]},next=addTrackReplacement(project,clip,"video",choice.range.from,choice.range.to,id());
    if(next===project)return announce("The image could not be placed in the retained range.",true);
    const previous=project;project=next;selectedReplacementId=next.trackReplacements.at(-1).id;undoStack.push(previous);redoStack=[];clearProgramMarks();render();activeMediaId=PROGRAM_ID;editorStates.get(PROGRAM_ID)?.section.focus();announce(`Image added over the retained range for ${readableTime(length)}. Brackets cleared.`);cue("add");return;
  }
  image.duration=choice.duration;image.editSegments=[{start:0,end:choice.duration}];
  if(!project.items.length){const previous=project;image.role="primary";project=addItem(project,image);selectedId=image.id;activeMediaId=PROGRAM_ID;undoStack.push(previous);redoStack=[];render();announce(`Image added as Primary Production for ${readableTime(choice.duration)}.`);return;}
  const state=editorStates.get(PROGRAM_ID),start=Math.max(0,Math.min(duration(project),state?.cursor||0)),end=Math.min(duration(project),start+choice.duration);
  if(end<=start)return announce("Move the Primary playhead before the end to place this image.",true);
  const clip={...image,duration:end-start,editSegments:[{start:0,end:end-start}]},previous=project,next=addTrackReplacement(project,clip,"video",start,end,id());
  project=next;selectedReplacementId=next.trackReplacements.at(-1).id;undoStack.push(previous);redoStack=[];render();activeMediaId=PROGRAM_ID;editorStates.get(PROGRAM_ID)?.section.focus();announce(`Image displayed from ${readableTime(start)} through ${readableTime(end)}. Duration ${readableTime(end-start)}.`);cue("add");
}
function newProject(){if(project.dirty&&!window.confirm("Discard unsaved changes and start a new editing session?"))return;project=createProject();selectedId=selectedSourceId=selectedImageId=selectedReplacementId=activeMediaId=null;mediaClipboard=null;presentationClipboard=[];editorStates.clear();editorNodes.clear();el["media-editor-sections"].replaceChildren();undoStack=[];redoStack=[];render();el["import-media-button"].focus();announce("New editing session. Press Ctrl+O to open primary media.");}
function applyOpenedProject(result){
  project=migrateProject(JSON.parse(result.content));project.path=result.path;project.name=baseName(result.path).replace(/\.ameproject$/i,"");project.dirty=false;selectedId=project.items[0]?.id||null;selectedSourceId=project.sources.find(item=>item.kind!=="Image")?.id||null;selectedImageId=project.sources.find(item=>item.kind==="Image")?.id||null;selectedReplacementId=project.trackReplacements.at(-1)?.id||null;activeMediaId=project.items.length?PROGRAM_ID:(selectedSourceId||selectedImageId);mediaClipboard=null;presentationClipboard=[];editorStates.clear();editorNodes.clear();el["media-editor-sections"].replaceChildren();undoStack=[];redoStack=[];
  const presentationProject=presentationItems().length>0;
  render();
  if(presentationProject){
    if(activeWorkspace!=="presentation")switchWorkspace(1,"presentation");
    el["presentation-items"].focus();
  }else{
    if(activeWorkspace!=="media")switchWorkspace(1,"media");
    const destination=editorStates.get(activeMediaId)?.slider||(project.items.length?el["project-items"]:el["import-media-button"]);destination.focus();
  }
}
async function openProject(){
  if(project.dirty&&!window.confirm("Discard unsaved changes and open another project?"))return;
  try{const result=await invoke("open_project_dialog");if(!result)return;applyOpenedProject(result);announce(`${project.name} opened.`);}catch(error){announce(`Project could not be opened. ${error}`,true);}
}
async function saveProject(saveAs=false){
  try{const content=JSON.stringify(serializable(project),null,2),suggested=`${project.name.replace(/[^a-z0-9 -]/gi,"").trim()||"Untitled Project"}.ameproject`;const path=saveAs||!project.path?await invoke("save_project_dialog",{suggestedName:suggested,content}):await invoke("write_project",{path:project.path,content});if(!path)return;project.path=path;project.name=baseName(path).replace(/\.ameproject$/i,"");project.dirty=false;render();announce(`${project.name} saved.`);cue("save");}catch(error){announce(`Project could not be saved. ${error}`,true);}
}
function exportMedia(){
  const primary=project.items.find(item=>item.role==="primary")||project.items[0];
  if(!primary)return announce("Open media before exporting.",true);
  if(project.items.some(item=>!["Video","Audio","Image"].includes(item.kind)))return announce("This build can render video, audio, and still-image sequence items. Remove text or transition items before exporting.",true);
  const remembered=localStorage.getItem("ame-export-format");
  const available=[...el["export-format"].options].some(option=>option.value===remembered);
  el["export-format"].value=available?remembered:(primary.kind==="Audio"?"m4a":"mp4");
  exportPhase="format-selection";clearAnnouncements();el["export-dialog"].showModal();el["export-format"].focus();
}
async function confirmExport(){
  const primary=project.items.find(item=>item.role==="primary")||project.items[0];if(!primary)return;
  const format=el["export-format"].value,stem=baseName(primary.name||"Edited Media").replace(/\.[^.]+$/,"");
  localStorage.setItem("ame-export-format",format);
  exportPhase="rendering";clearAnnouncements();el["export-dialog"].close();showExportProgress("Rendering complete Primary Production. Please wait.");
  try{
    let source=primary.workingSource||primary.source;
    if(project.items.length>1||(project.trackReplacements||[]).length||project.backgroundMusic){source=await invoke("render_production",{items:productionRenderItems(project),replacements:productionRenderReplacements(project),backgroundMusic:productionRenderBackgroundMusic(project),projectId:project.name||primary.id});await exportNarrationChain;}
    exportPhase="choosing-destination";
    const destinationMessage="Primary Production rendered. Choose where to save it.";
    await queueExportAnnouncement(destinationMessage,2500);
    const path=await invoke("export_edited_media",{source,suggestedName:`${stem} Edited.${format}`,format});
    if(path){
      const message=`Complete production saved to ${path}.`;
      exportPhase="complete";closeExportProgress();clearAnnouncements();lastExportPath=path;
      el["export-success-path"].textContent=message;
      el["export-success-dialog"].showModal();
      el["export-success-show-file"].focus();
      updateStatus(message);cue("save");
    }else{exportPhase="idle";closeExportProgress();announce("Save canceled.");}
  }catch(error){exportPhase="idle";closeExportProgress();announce(`Production could not be saved. ${error}`,true);}
}
function clearAllEditorMarks(){for(const state of editorStates.values())clearEditorMarks(state);}
function clearProgramMarks(){clearEditorMarks(editorStates.get(PROGRAM_ID));}
function move(direction){const item=sequenceItem();if(!item)return announce("No sequence item selected.",true);const next=moveItem(project,item.id,direction);if(next===project)return announce(direction<0?"Already first.":"Already last.");clearProgramMarks();rememberChange(next,`${item.label||item.name} moved ${direction<0?"earlier":"later"}.`,true);}
function removeSelected(){const item=sequenceItem();if(!item)return;const index=project.items.findIndex(value=>value.id===item.id),next=removeItem(project,item.id);selectedId=next.items[Math.min(index,next.items.length-1)]?.id||null;activeMediaId=next.items.length?PROGRAM_ID:selectedSourceId;clearProgramMarks();rememberChange(next,`${item.label||item.name} removed from Primary Production.`);cue("remove");}
function removeLibraryItem(collection){
  const images=(project.sources||[]).filter(item=>item.kind==="Image"),media=(project.sources||[]).filter(item=>item.kind!=="Image");
  const items=collection==="image"?images:media,idValue=collection==="image"?selectedImageId:selectedSourceId,item=items.find(value=>value.id===idValue);
  if(!item)return announce(collection==="image"?"No project image selected.":"No source video or audio selected.",true);
  clearAllEditorMarks();
  const currentIndex=items.findIndex(value=>value.id===item.id),next=removeSource(project,item.id),remaining=(next.sources||[]).filter(value=>collection==="image"?value.kind==="Image":value.kind!=="Image");
  const nextId=remaining[Math.min(currentIndex,remaining.length-1)]?.id||null;
  if(collection==="image")selectedImageId=nextId;else selectedSourceId=nextId;
  if(activeMediaId===item.id)activeMediaId=project.items.length?PROGRAM_ID:(selectedSourceId||selectedImageId);
  const noun=collection==="image"?"Project Image Library":"Source media",countLabel=collection==="image"?`${remaining.length} ${remaining.length===1?"image remains":"images remain"}`:`${remaining.length} source ${remaining.length===1?"item remains":"items remain"}`;
  rememberChange(next,`${item.label||item.name} removed from ${noun}. ${countLabel}. Press Ctrl+Z to restore it. Original file unchanged.`,false,{id:item.id,collection,label:item.label||item.name});
  el[collection==="image"?"image-items":"source-items"].focus();cue("remove");
}
function removeSelectedSource(){removeLibraryItem("source");}
function removeSelectedImage(){removeLibraryItem("image");}
function removeSelectedReplacement(){const edit=(project.trackReplacements||[]).find(value=>value.id===selectedReplacementId);if(!edit)return;const next=removeTrackReplacement(project,edit.id);selectedReplacementId=next.trackReplacements.at(-1)?.id||null;rememberChange(next,"Track replacement removed. Original media restored for that range.");cue("remove");}
function promoteSelectedSource(){
  const source=activeLocation()?.type==="source"?activeLocation().item:sourceItem(),oldPrimary=project.items[0];
  if(!source||!oldPrimary)return announce("Select a Source before making it Primary.",true);
  for(const state of editorStates.values()){clearEditorMarks(state);if(!state.video.paused)state.video.pause();}
  const next=makeSourcePrimary(project,source.id);if(next===project)return announce("The selected Source could not become Primary.",true);
  const programState=editorStates.get(PROGRAM_ID);if(programState){programState.cursor=0;programState.currentItemId=source.id;programState.currentItemOffset=0;programState.endReached=false;}
  selectedId=source.id;selectedSourceId=oldPrimary.id;activeMediaId=PROGRAM_ID;mediaClipboard=null;
  rememberChange(next,`${displayName(source)} is now Primary Production. ${displayName(oldPrimary)} moved to Source Media.`);
  editorStates.get(PROGRAM_ID)?.section.focus();
}
function removeActive(){if(document.activeElement===el["replacement-items"])return removeSelectedReplacement();return activeLocation()?.type==="source"?removeSelectedSource():removeSelected();}
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
  const total=itemDuration(location.item),plan=bracketSelectionPlan(total,state.markIn,state.markOut);if(!plan)return announce("Set a Left or Right Bracket before copying.",true);if(!plan.selectedRanges.length)return announce("The bracketed selection has no duration.",true);
  const selectedDuration=plan.selectedRanges.reduce((sum,range)=>sum+range.to-range.from,0);
  mediaClipboard={...structuredClone(location.item),id:null,role:"inserted",inPoint:0,outPoint:selectedDuration,editSegments:logicalSegmentsForRanges(location.item,plan.selectedRanges),workingSource:location.item.workingSource||location.item.source};
  clearEditorMarks(state);updateEditorLabels(state,location.item,location.type);
  const programState=editorStates.get(PROGRAM_ID);if(programState&&project.items[0])updateEditorLabels(programState,project.items[0],"program");announce(`Copied ${readableTime(selectedDuration)} from ${displayName(location.item)}.`);cue("add");
}
function pasteMediaInsert(insertionPoint=null){
  const state=activeState(),location=activeLocation();if(!mediaClipboard)return announce("Copy a Source selection first.",true);if(!state||location?.type!=="program")return announce("Move to Primary Production before pasting.",true);
  const next=structuredClone(project),point=Math.max(0,Math.min(duration(next),insertionPoint==null?state.cursor:insertionPoint)),target=sequencePoint(point),clip={...structuredClone(mediaClipboard),id:id(),label:`${mediaClipboard.label||mediaClipboard.name} - pasted selection`};
  if(!target||point>=duration(next)-0.0005)next.items.push(clip);
  else if(target.local<=0.0005)next.items.splice(target.index,0,clip);
  else if(target.local>=itemDuration(target.item)-0.0005)next.items.splice(target.index+1,0,clip);
  else{
    const original=next.items[target.index],left={...structuredClone(original),editSegments:sliceEditSegments(original,0,target.local),outPoint:target.local},right={...structuredClone(original),id:id(),label:`${original.label||original.name} - continuation`,editSegments:sliceEditSegments(original,target.local,itemDuration(original)),inPoint:0,outPoint:itemDuration(original)-target.local};
    next.items.splice(target.index,1,left,clip,right);
  }
  next.dirty=true;if(next.items[0])next.items[0].workingSource=null;clearProgramMarks();activeMediaId=PROGRAM_ID;rememberChange(next,`Inserted ${readableTime(itemDuration(clip))} at ${readableTime(point)}. Production duration increased.`);const program=editorStates.get(PROGRAM_ID);if(program){setEditorPosition(program,point,true);program.section.focus();}
}
function pasteMedia(){
  const state=activeState(),location=activeLocation();if(!mediaClipboard)return announce("Copy a Source selection first.",true);if(!state||location?.type!=="program")return announce("Move to Primary Production before pasting.",true);
  const plan=bracketSelectionPlan(duration(project),state.markIn,state.markOut),operation=primaryPasteOperation(plan);
  if(operation==="insert")return pasteMediaInsert(plan?.kind==="empty"?state.markIn:null);
  if(operation==="reject")return announce("Replacement needs one continuous Primary selection. Use outward brackets, or clear the brackets to insert at the playhead.",true);
  pasteMediaReplace();
}
function pasteMediaReplace(){
  const state=activeState(),location=activeLocation();if(!mediaClipboard)return announce("Copy a Source selection first.",true);if(!state||location?.type!=="program")return announce("Move to Primary Production before pasting.",true);
  const point=Math.max(0,Math.min(duration(project),state.cursor)),plan=bracketSelectionPlan(duration(project),state.markIn,state.markOut);
  if(plan?.selectedRanges?.length>1)return announce("Track replacement needs one continuous destination range. Use outward brackets or clear the brackets and position the playhead.",true);
  const containing=plan?.selectedRanges?.find(range=>point>=range.from-0.0005&&point<=range.to+0.0005),range=containing||plan?.selectedRanges?.[0]||null;
  const start=range?range.from:point,limit=range?range.to:null,target=programTarget(),clipDuration=itemDuration(mediaClipboard),destinationDuration=range?range.to-range.from:null;
  if(target!=="audio"&&mediaClipboard.kind==="Audio")return announce("An audio-only Source cannot replace a video track. Choose A for Audio Only.",true);
  const durationIssue=replacementDurationIssue(clipDuration,destinationDuration);
  if(durationIssue){
    announce(`Paste canceled. Copied duration ${readableTime(durationIssue.copied)}. Destination selection duration ${readableTime(durationIssue.destination)}. The copied selection is ${readableTime(durationIssue.excess)} longer. Clear the Primary Right Bracket to paste the complete copied selection from the Left Bracket, or shorten the Source selection.`,true);
    return;
  }
  if(range&&clipDuration+0.0005<destinationDuration){
    pendingShortReplacement={clip:structuredClone(mediaClipboard),target,start,limit,destinationDuration};
    const shortage=destinationDuration-clipDuration;clearAnnouncements();el["short-source-message"].textContent=`The Source is ${readableTime(shortage)} shorter than the Primary selection. Choose whether to replace only the matching duration, repeat the Source until the complete selection is filled, or cancel without changing the production.`;el["short-source-dialog"].showModal();el["short-source-replace"].focus();return;
  }
  applyTrackReplacement(mediaClipboard,target,start,limit);
}
function loopClipToDuration(clip,wanted){
  const sourceSegments=normalizedSegments(clip),sourceLength=itemDuration(clip);if(!sourceLength||!sourceSegments.length)return clip;
  const segments=[];let filled=0;while(filled<wanted-0.0005){for(const segment of sourceSegments){if(filled>=wanted-0.0005)break;const length=segment.end-segment.start,take=Math.min(length,wanted-filled);if(take>0){segments.push({start:segment.start,end:segment.start+take});filled+=take;}}}
  return{...structuredClone(clip),duration:Math.max(Number(clip.duration)||0,...segments.map(segment=>segment.end)),editSegments:segments};
}
function applyPendingShortReplacement(mode){
  const pending=pendingShortReplacement;if(!pending)return;pendingShortReplacement=null;el["short-source-dialog"].close();clearAnnouncements();
  if(mode==="cancel")return announce("Paste canceled. Primary selection retained for adjustment.");
  const clip=mode==="loop"?loopClipToDuration(pending.clip,pending.destinationDuration):pending.clip;
  applyTrackReplacement(clip,pending.target,pending.start,mode==="loop"?pending.limit:pending.start+itemDuration(clip),mode==="loop");
}
function applyTrackReplacement(clip,target,start,limit,looped=false){
  const next=addTrackReplacement(project,clip,target,start,limit,id());if(next===project)return announce("The copied selection does not fit in the available Primary Production time.",true);
  const edit=next.trackReplacements.at(-1);selectedReplacementId=edit.id;if(target!=="audio")clearProgramMarks();activeMediaId=PROGRAM_ID;
  rememberChange(next,target==="audio"?`Audio replaced${looped?" by repeating the Source":""} from ${readableTime(edit.timelineStart)} through ${readableTime(edit.timelineEnd)}. Range retained for an optional image.`:`Replaced ${targetText(target).toLowerCase()}${looped?" by repeating the Source":""} from ${readableTime(edit.timelineStart)} through ${readableTime(edit.timelineEnd)}. Production duration unchanged.`);
  const program=editorStates.get(PROGRAM_ID);if(program){setEditorPosition(program,edit.timelineStart,true);program.section.focus();}cue("add");
}
function showProperties(){const location=activeLocation(),item=location?.item;if(!item)return announce("No media editor active.",true);el["properties-name"].textContent=editorTitle(item,location.type);el["item-label"].value=item.label||item.name;el["item-duration"].value=item.duration??"";const media=["Video","Audio"].includes(item.kind),edited=["sequence","source"].includes(location.type)&&Array.isArray(item.editSegments);el["item-duration"].readOnly=media;el["trim-fields"].hidden=!media||edited;writeTime("item-in",Number(item.inPoint)||0);writeTime("item-out",item.outPoint==null?Number(item.duration)||0:Number(item.outPoint));el["properties-dialog"].showModal();el["item-label"].focus();}
function saveProperties(){const location=activeLocation(),item=location?.item;if(!item)return;const value=Number(el["item-duration"].value),media=["Video","Audio"].includes(item.kind),edited=["sequence","source"].includes(location.type)&&Array.isArray(item.editSegments),start=readTime("item-in"),end=readTime("item-out");if(!media&&(!Number.isFinite(value)||value<0.001))return announce("Enter a valid duration.",true);if(media&&!edited&&(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end>value))return announce("Enter valid Left and Right Bracket times.",true);const patch={label:el["item-label"].value.trim()||item.name,duration:value};if(media&&!edited){patch.inPoint=start;patch.outPoint=end;}el["properties-dialog"].close();rememberChange(updateLocated(item.id,patch),"Media properties saved.");}
function showTextDialog(){el["text-content"].value="";el["text-duration"].value="5";el["text-dialog"].showModal();el["text-content"].focus();}
function saveText(){const text=el["text-content"].value.trim(),seconds=Number(el["text-duration"].value);if(!text||!Number.isFinite(seconds)||seconds<0.1)return announce("Enter text and a valid duration.",true);const after=selectedId,item={id:id(),source:null,name:text.slice(0,40),label:text.slice(0,40),kind:"Text",text,duration:seconds,role:"sequence"};selectedId=item.id;el["text-dialog"].close();clearProgramMarks();rememberChange(addItem(project,item,after),"Text item added.",true);}
function addTransition(){const after=selectedId,item={id:id(),source:null,name:"Crossfade",label:"Crossfade",kind:"Transition",duration:1,role:"sequence"};selectedId=item.id;clearProgramMarks();rememberChange(addItem(project,item,after),"Crossfade added.",true);}
function undo(){
  const state=activeState();
  if(state?.markHistory?.length){const change=state.markHistory.pop();if(change.which==="in")state.markIn=change.previous;else state.markOut=change.previous;const location=activeLocation();if(location)updateEditorLabels(state,location.item,location.type);return announce(`${change.which==="in"?"Left":"Right"} bracket removed.`);}
  if(!undoStack.length)return announce("Nothing to undo.");const restore=removedLibraryItemUndo,previousActiveId=activeMediaId,previousSelectedId=selectedId,previousSelectedSourceId=selectedSourceId;redoStack.push(project);project=undoStack.pop();selectedId=project.items.some(item=>item.id===previousSelectedId)?previousSelectedId:(project.items[0]?.id||null);selectedSourceId=(project.sources||[]).some(item=>item.id===previousSelectedSourceId)?previousSelectedSourceId:((project.sources||[]).find(item=>item.kind!=="Image")?.id||null);if(restore&&(project.sources||[]).some(item=>item.id===restore.id)){if(restore.collection==="image")selectedImageId=restore.id;else selectedSourceId=restore.id;}activeMediaId=locateItem(previousActiveId)?previousActiveId:(project.items.length?PROGRAM_ID:selectedSourceId);removedLibraryItemUndo=null;render();if(activeWorkspace==="presentation"){el["presentation-items"].focus();announce("Undo completed in Production Sequence.");}else if(restore){const list=el[restore.collection==="image"?"image-items":"source-items"],remaining=(project.sources||[]).filter(item=>restore.collection==="image"?item.kind==="Image":item.kind!=="Image").length;list.focus();announce(`${restore.label} restored to ${restore.collection==="image"?"Project Image Library":"Source media"}. ${remaining} ${restore.collection==="image"?(remaining===1?"image":"images"):(remaining===1?"source item":"source items")} available.`);}else{editorStates.get(activeMediaId)?.section.focus();announce("Undo completed.");}
}
function redo(){if(!redoStack.length)return announce("Nothing to redo.");const previousActiveId=activeMediaId,previousSelectedSourceId=selectedSourceId;undoStack.push(project);project=redoStack.pop();selectedId=project.items[0]?.id||null;selectedSourceId=(project.sources||[]).some(item=>item.id===previousSelectedSourceId)?previousSelectedSourceId:(project.sources?.[0]?.id||null);activeMediaId=locateItem(previousActiveId)?previousActiveId:(project.items.length?PROGRAM_ID:selectedSourceId);render();if(activeWorkspace==="presentation"){el["presentation-items"].focus();announce("Redo completed in Production Sequence.");}else{editorStates.get(activeMediaId)?.section.focus();announce("Redo completed.");}}

function currentLogicalPosition(location,state){
  if(location.type==="program"){
    const current=project.items.find(item=>item.id===state.currentItemId);
    if(current?.kind==="Image")return state.cursor;
    return(state.currentItemOffset||0)+(current?sourceToLogicalTime(current,state.video.currentTime):0);
  }
  if(["sequence","source"].includes(location.type))return sourceToLogicalTime(location.item,state.video.currentTime);
  return state.video.currentTime;
}
async function togglePlayback(){
  if(el["presentation-preview-dialog"]?.open){const media=el["presentation-preview-media"];if(media.paused){try{await media.play();announce("Playing presentation preview.");}catch(error){announce(`Preview playback failed. ${error}`,true);}}else{media.pause();announce(`Preview paused at ${readableTime(media.currentTime)}.`);}return;}
  const location=activeLocation(),state=activeState();if(!location||!state)return announce("Activate a media editor first.",true);if(state.unsupported)return announce("This format requires conversion before preview.",true);cancelAudition(state,true);
  if(state.imageOnly)return announce("This is a reusable Source Image. Place it in Primary Production to play the assembled result.");
  if(location.type==="program"&&state.imagePlaying){state.imagePlaying=false;if(state.imageTimer)cancelAnimationFrame(state.imageTimer);syncBackgroundMusic(state,state.cursor,false);announce(`Paused at ${readableTime(state.cursor)}.`);return;}
  const currentProgram=location.type==="program"?sequencePoint(state.cursor):null;if(currentProgram?.item.kind==="Image"){setProgramMedia(state,state.cursor>=duration(project)?0:state.cursor,true);announce("Playing.");return;}
  if(state.video.paused){const bounds=editorBounds(location.item,location.type);if(state.cursor<bounds.start||state.cursor>=bounds.end)setEditorPosition(state,bounds.start,true);else setEditorPosition(state,state.cursor,true);try{await state.video.play();syncBackgroundMusic(state,state.cursor,true);announce("Playing.");}catch(error){announce(`Playback failed. ${error}`,true);}}
  else{const point=currentLogicalPosition(location,state);state.video.pause();storeCursor(state,location,point,true);announce(`Paused at ${readableTime(state.cursor)}.`);}
}
async function auditionAround(before=1,after=1,quiet=false){
  const location=activeLocation(),state=activeState();if(!location||!state)return announce("Activate a media editor first.",true);if(state.unsupported)return quiet?undefined:announce("This format requires conversion before preview.",true);if(state.imageOnly)return quiet?undefined:announce("Source Images have no independent playback. Place the image, then audition it in Primary Production.");cancelAudition(state,true);if(!state.video.paused)state.video.pause();
  const point=state.cursor,bounds=editorBounds(location.item,location.type),start=Math.max(bounds.start,point-before),end=Math.min(bounds.end,point+after);
  setEditorPosition(state,start,false);const audition={returnPoint:point,end,timer:null,quiet};
  state.audition=audition;
  try{
    await waitForMediaReady(state.video);if(state.audition!==audition)return;
    await state.video.play();if(state.audition!==audition)return;
    audition.timer=setTimeout(()=>{if(state.audition===audition){cancelAudition(state,true);if(!quiet)updateStatus(`Playhead ${readableTime(point)}.`);}},Math.max(300,(end-start)*1000+250));
    if(!quiet)updateStatus(`Auditioning around ${readableTime(point)}.`);
  }catch(error){if(state.audition===audition)cancelAudition(state,true);if(error?.name!=="AbortError"&&!quiet)announce(`Audition failed. ${error}`,true);}
}
async function playAuditionRange(state,audition){
  if(state.audition!==audition)return;
  const range=audition.ranges[audition.rangeIndex];audition.end=range.to;state.video.pause();setEditorPosition(state,range.from,false);
  try{await waitForMediaReady(state.video);if(state.audition!==audition)return;await state.video.play();}catch(error){if(state.audition===audition)cancelAudition(state,true);if(error?.name!=="AbortError")announce(`Audition failed. ${error}`,true);}
}
function auditionSelection(){
  const location=activeLocation(),state=activeState();if(!location||!state)return announce("Activate a media editor first.",true);if(state.unsupported)return announce("This format requires conversion before preview.",true);
  if(state.imageOnly)return announce("Source Images have no independent playback. Place the image, then audition it in Primary Production.");
  if(state.audition){cancelAudition(state,true);return;}
  if(!state.video.paused)state.video.pause();
  const bounds=editorBounds(location.item,location.type),total=location.type==="program"?duration(project):itemDuration(location.item),plan=bracketSelectionPlan(total,state.markIn,state.markOut);
  const ranges=(plan?.selectedRanges?.length?plan.selectedRanges:[{from:state.cursor,to:bounds.end}]).filter(range=>range.to-range.from>0.0005);
  if(!ranges.length)return announce("There is no media to audition from this position.");
  const audition={returnPoint:state.cursor,end:ranges[0].to,timer:null,quiet:true,ranges,rangeIndex:0};state.audition=audition;playAuditionRange(state,audition);
}
function movePlayhead(amount,label="Playhead"){if(el["presentation-preview-dialog"]?.open){const media=el["presentation-preview-media"];media.currentTime=Math.max(0,Math.min(Number.isFinite(media.duration)?media.duration:Infinity,media.currentTime+amount));announce(`Preview ${readableTime(media.currentTime)}.`);return;}const state=activeState();if(!state)return announce("Activate a media editor first.",true);if(state.imageOnly)return announce("Source Images do not have a playhead. Place the image in Primary Production first.");if(state.unsupported)return announce("This format requires conversion before editing.",true);cancelAudition(state,false);setEditorPosition(state,state.cursor+amount,true);announce(`${label} ${readableTime(state.cursor)}.`);}
function scrub(amount){const state=activeState();if(!state)return announce("Activate a media editor first.",true);if(state.imageOnly)return announce("Source Images do not have a playhead. Place the image in Primary Production first.");cancelAudition(state,false);setEditorPosition(state,state.cursor+amount,true);auditionAround(0,0.5,true);}
function jumpPlayhead(end=false){const location=activeLocation(),state=activeState();if(!location||!state)return announce("Activate a media editor first.",true);if(state.imageOnly)return announce("Source Images do not have a playhead. Place the image in Primary Production first.");const bounds=editorBounds(location.item,location.type);setEditorPosition(state,end?bounds.end:bounds.start,true);announce(`${end?"End":"Beginning"} ${readableTime(state.cursor)}.`);}
function setPoint(which){
  const location=activeLocation(),state=activeState();if(!location||!state)return announce("Activate a media editor first.",true);if(state.unsupported)return announce("This format requires conversion before editing.",true);
  if(state.imageOnly)return announce("Set brackets in Primary Production, then return to this Source Image and place it.");
  cancelAudition(state,true);
  const point=state.video.paused?state.cursor:currentLogicalPosition(location,state);storeCursor(state,location,point,true);
  const previous=which==="in"?state.markIn:state.markOut;if(previous===point)return announce(`${which==="in"?"Left":"Right"} Bracket is already set there.`);
  state.markHistory.push({which,previous});if(which==="in")state.markIn=point;else state.markOut=point;updateEditorLabels(state,location.item,location.type);
  const total=location.type==="program"?duration(project):itemDuration(location.item),plan=bracketSelectionPlan(total,state.markIn,state.markOut);
  const selectedDuration=plan.selectedRanges.reduce((sum,range)=>sum+range.to-range.from,0),durationAnnouncement=plan.kind==="empty"?"":` Selection duration ${readableTime(selectedDuration)}.`;
  const effect=plan.kind==="ending"?`Selected from ${readableTime(state.markIn)} to end.`:plan.kind==="beginning"?`Selected from beginning to ${readableTime(state.markOut)}.`:plan.kind==="inside"?`Outward brackets. Selected between ${readableTime(state.markIn)} and ${readableTime(state.markOut)}.`:plan.kind==="outside"?`Inward brackets. Beginning and end selected. Middle not selected.`:`Brackets meet at ${readableTime(point)}. Selection empty.`;
  announce(`${which==="in"?"Left":"Right"} Bracket. ${effect}${durationAnnouncement}`);
}
function removeProgramRange(base,from,to){
  const next=structuredClone(base),kept=[];let offset=0;
  for(const item of next.items){const length=itemDuration(item),itemEnd=offset+length;
    if(to<=offset||from>=itemEnd)kept.push(item);
    else{
      if(from>offset)kept.push({...structuredClone(item),editSegments:sliceEditSegments(item,0,from-offset),outPoint:from-offset});
      if(to<itemEnd)kept.push({...structuredClone(item),id:id(),label:`${item.label||item.name} - continuation`,editSegments:sliceEditSegments(item,to-offset,length),inPoint:0,outPoint:itemEnd-to});
    }
    offset=itemEnd;
  }
  if(!kept.length)return base;
  next.items=kept;next.items.forEach((item,index)=>{item.role=index===0?"primary":(item.role==="primary"?"sequence":item.role);});next.items[0].workingSource=null;next.dirty=true;return next;
}
async function commitPrimaryEdit(){
  const location=activeLocation(),state=activeState();
  if(!location||!["sequence","program","source"].includes(location.type)||!state)return announce("Activate Primary Production or a Source editor first.",true);
  const total=location.type==="program"?duration(project):itemDuration(location.item),plan=bracketSelectionPlan(total,state.markIn,state.markOut);
  if(!plan)return announce("Set a Left or Right Bracket before applying an edit.",true);
  if(!plan.selectedRanges.length)return announce("The brackets are at the same position. Move one bracket before applying the edit.",true);
  let next;
  if(location.type==="program")next=[...plan.selectedRanges].sort((a,b)=>b.from-a.from).reduce((current,range)=>removeProgramRange(current,range.from,range.to),project);
  else next=removeLogicalRanges(project,location.item.id,plan.selectedRanges,location.type==="source");
  if(next===project)return announce("That edit would remove the entire file or no media. Nothing changed.",true);
  const editedItem=location.type==="source"?(next.sources||[]).find(item=>item.id===location.item.id):next.items.find(item=>item.id===location.item.id);
  const itemId=location.item.id,deleted=plan.kind==="ending"?"End deleted.":plan.kind==="beginning"?"Beginning deleted.":plan.kind==="inside"?"Selection between outward brackets deleted.":"Beginning and end deleted. Middle between inward brackets kept.";clearEditorMarks(state);rememberChange(next,`${deleted} Duration ${readableTime(location.type==="program"?duration(next):itemDuration(editedItem))}.`);
  const edited=location.type==="source"?sourceItem(itemId):(sequenceItem(itemId)||next.items[0]),currentState=editorStates.get(location.type==="program"?PROGRAM_ID:itemId),nextPoint=plan.kind==="ending"?plan.selectedRanges[0].from:plan.kind==="inside"?plan.selectedRanges[0].from:0;if(currentState)setEditorPosition(currentState,Math.min(nextPoint,location.type==="program"?duration(next):itemDuration(edited)),true);
  if(location.type==="program"&&next.items.length>1){updateStatus("Production edit is ready for immediate playback. Multi-item export rendering is not included in this build.");return;}
  if(location.type==="source"){updateStatus("Source working timeline edited. Original file unchanged.");return;}
  if(!invoke)return;
  if(currentState)currentState.rendering=true;updateStatus("Creating the edited working file. Playback already uses the edited timeline.");
  try{
    const renderItemId=edited.id,path=await invoke("render_working_edit",{source:edited.source,segments:normalizedSegments(edited),mediaKind:edited.kind,itemId:renderItemId});
    project=updateItem(project,renderItemId,{workingSource:path});if(currentState)currentState.rendering=false;render();announce("Edited working file ready.");
  }catch(error){if(currentState)currentState.rendering=false;announce(`The edit remains available for preview, but the working file could not be created. ${error}`,true);}
}
function setTrackTarget(target){
  const location=activeLocation(),state=activeState();if(!location||!state)return announce("Activate a media editor first.",true);
  if(location.type!=="program")return announce("Choose Audio Only, Video Only, or Both Audio and Video in Primary Production before replacing a selected range.",true);
  preserveMarksWhileChangingTarget(state,target);
  if(location.type==="program")project={...project,editTarget:target};
  else project=updateLocated(location.item.id,{trackTarget:target});
  const updated=locateItem(state.id);updateEditorLabels(state,updated?.item||location.item,location.type);
  announce(`${targetText(target)} targeted for the next edit.`);
}
function showGoToTime(){const state=activeState();if(!state)return announce("Activate a media editor first.",true);if(state.imageOnly)return announce("Source Images do not have a playhead. Set the placement time in Primary Production.");writeTime("goto",state.cursor);el["go-to-time-dialog"].showModal();el["goto-hours"].focus();}
function confirmGoToTime(){const state=activeState(),location=activeLocation(),point=readTime("goto"),bounds=location?editorBounds(location.item,location.type):null;if(!state||!location||!Number.isFinite(point)||point>bounds.end)return announce("Enter a valid time.",true);el["go-to-time-dialog"].close();setEditorPosition(state,point,true);state.slider.focus();announce(`Playhead moved to ${readableTime(point)}.`);}
function splitSelected(){const location=activeLocation(),state=activeState();if(!location||location.type!=="sequence")return announce("Activate a Primary Sequence editor before splitting.",true);const newId=id(),next=splitItem(project,location.item.id,state.cursor,newId);if(next===project)return announce("Move the playhead inside the media before splitting.",true);clearProgramMarks();selectedId=newId;activeMediaId=newId;rememberChange(next,`Split at ${readableTime(state.cursor)}. Part 2 active.`,true);}
function cancel(){const state=activeState();if(el["presentation-item-properties-dialog"].open)closePresentationItemProperties();else if(el["properties-dialog"].open)el["properties-dialog"].close();else if(el["text-dialog"].open)el["text-dialog"].close();else if(el["go-to-time-dialog"].open)el["go-to-time-dialog"].close();else if(el["export-dialog"].open){el["export-dialog"].close();exportPhase="idle";clearAnnouncements();}else if(el["export-success-dialog"].open)el["export-success-dialog"].close();else if(state?.audition){cancelAudition(state,true);announce("Audition canceled.");}else if(state&&(state.markIn!=null||state.markOut!=null)){state.markIn=state.markOut=null;state.markHistory=[];const location=activeLocation();if(location)updateEditorLabels(state,location.item,location.type);announce("Uncommitted marks canceled.");}else announce("No temporary operation to cancel.");}

const actions={
  newProject,openProject,saveProject:()=>saveProject(false),saveProjectAs:()=>saveProject(true),importMedia,exportMedia,
  previousWorkspace:()=>switchWorkspace(-1),nextWorkspace:()=>switchWorkspace(1),showMediaWorkspace:()=>switchWorkspace(1,"media"),showPresentationWorkspace:()=>switchWorkspace(1,"presentation"),showAudioWorkspace:()=>switchWorkspace(1,"audio"),
  previousSection:()=>focusSection(-1),nextSection:()=>focusSection(1),openProjectsFolder:async()=>{try{await invoke("open_projects_folder");announce("Projects folder opened.");}catch(error){announce(String(error),true);}},openExportsFolder:async()=>{try{await invoke("open_exports_folder");announce("Exports folder opened.");}catch(error){announce(String(error),true);}},
  addText:showTextDialog,addTransition:()=>activeWorkspace==="presentation"?addPresentationCrossfade():addTransition(),moveEarlier:()=>activeWorkspace==="presentation"?movePresentation(-1):move(-1),moveLater:()=>activeWorkspace==="presentation"?movePresentation(1):move(1),properties:()=>activeWorkspace==="presentation"?showPresentationItemProperties():showProperties(),makeSourcePrimary:promoteSelectedSource,removeItem:()=>activeWorkspace==="presentation"?removePresentation():removeActive(),split:splitSelected,undo,redo,
  preview:togglePlayback,playPause:togglePlayback,audition:auditionSelection,setIn:()=>setPoint("in"),setOut:()=>setPoint("out"),goToTime:showGoToTime,
  saveSourceClip,cutMedia:cutMediaAction,copyMedia:copyMediaAction,pasteMedia:pasteMediaAction,pasteInsert:pasteMediaInsert,insertSource:copySourceSelection,appendSource:pasteMediaInsert,trimPrimary:commitPrimaryEdit,
  focusPresentationTimeline,focusPresentationSources,
  scrubBack1:()=>scrub(-1),scrubForward1:()=>scrub(1),scrubBack100ms:()=>scrub(-0.1),scrubForward100ms:()=>scrub(0.1),scrubBack10ms:()=>scrub(-0.01),scrubForward10ms:()=>scrub(0.01),
  moveBack5:()=>movePlayhead(-5),moveForward5:()=>movePlayhead(5),moveBack30:()=>movePlayhead(-30),moveForward30:()=>movePlayhead(30),moveBack300:()=>movePlayhead(-300),moveForward300:()=>movePlayhead(300),nudgeBack:()=>movePlayhead(-0.001),nudgeForward:()=>movePlayhead(0.001),
  jumpBeginning:()=>jumpPlayhead(false),jumpEnd:()=>jumpPlayhead(true),targetBoth:()=>setTrackTarget("both"),targetVideo:()=>setTrackTarget("video"),targetAudio:()=>setTrackTarget("audio"),cancel,stop:cancel,
  focusProjectItems:()=>{el["project-items"].focus();announce("Primary Sequence. Press Enter to open the selected media editor.");},
  focusPlayhead:()=>{const state=activeState();if(!state)return announce("No media editor active.");state.slider.focus();updateStatus(`Playhead ${readableTime(state.cursor)}.`);},
  showShortcuts:()=>{el["shortcuts-dialog"].showModal();el["shortcuts-dialog"].querySelector("button").focus();},showTestingGuide:()=>{el["testing-guide-dialog"].showModal();el["testing-guide-dialog"].querySelector("button").focus();},
  toggleSoundCues:()=>{soundCues=!soundCues;localStorage.setItem("ame-sound-cues",soundCues?"on":"off");announce(`Sound cues ${soundCues?"on":"off"}.`);},showAbout:()=>announce("Accessible Media Editor Build 0.11.27. Reliable project workspace focus, transition editing, bulk crossfades, precise item properties, preview, and automatic music ducking.")
};
Object.entries(actions).forEach(([name,handler])=>registerAction(name,handler));initShortcuts();

el["project-items"].addEventListener("change",()=>{selectedId=el["project-items"].value||null;});
el["project-items"].addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();activateMedia(PROGRAM_ID,true);}});
el["source-items"].addEventListener("change",()=>{selectedSourceId=el["source-items"].value||null;if(selectedSourceId)activateMedia(selectedSourceId,false);});
el["source-items"].addEventListener("focus",()=>{if(selectedSourceId)activateMedia(selectedSourceId,false);});
el["source-items"].addEventListener("keydown",event=>{if(event.key==="Delete"){event.preventDefault();event.stopPropagation();removeSelectedSource();}else if(event.key==="Enter"){event.preventDefault();activateMedia(selectedSourceId,true);}});
el["image-items"].addEventListener("change",()=>{selectedImageId=el["image-items"].value||null;const image=selectedImage();el["selected-image-summary"].textContent=image?`Reusable project image. ${image.label||image.name}. Importing it did not change Primary Production.`:"No project image selected.";});
el["image-items"].addEventListener("focus",()=>{activeSectionIndex=sectionElements().indexOf(el["image-library-section"]);updateStatus(`${(project.sources||[]).filter(item=>item.kind==="Image").length} project images.`);});
el["image-items"].addEventListener("keydown",event=>{if(event.key==="Delete"){event.preventDefault();event.stopPropagation();removeSelectedImage();}else if(event.key==="Enter"){event.preventDefault();reviewSelectedImage();}});
el["replacement-items"].addEventListener("change",()=>{selectedReplacementId=el["replacement-items"].value||null;render();});
el["import-media-button"].addEventListener("click",importMedia);el["edit-primary-button"].addEventListener("click",()=>activateMedia(PROGRAM_ID,true));el["activate-source-button"].addEventListener("click",()=>activateMedia(selectedSourceId,true));el["make-source-primary-button"].addEventListener("click",promoteSelectedSource);
el["add-text-button"].addEventListener("click",showTextDialog);el["move-earlier-button"].addEventListener("click",()=>move(-1));el["move-later-button"].addEventListener("click",()=>move(1));el["remove-item-button"].addEventListener("click",removeSelected);
el["insert-source-button"].addEventListener("click",()=>insertSelectedSource(false));el["append-source-button"].addEventListener("click",()=>insertSelectedSource(true));el["remove-source-button"].addEventListener("click",removeSelectedSource);
el["activate-image-button"].addEventListener("click",reviewSelectedImage);
el["place-image-button"].addEventListener("click",()=>{const image=(project.sources||[]).find(item=>item.id===selectedImageId);if(image)placeImageSource(image);});
el["move-image-earlier-button"].addEventListener("click",()=>moveSelectedImage(-1));el["move-image-later-button"].addEventListener("click",()=>moveSelectedImage(1));
el["remove-image-button"].addEventListener("click",removeSelectedImage);

el["remove-replacement-button"].addEventListener("click",removeSelectedReplacement);
el["instructions-shortcuts-button"].addEventListener("click",actions.showShortcuts);
el["save-project-button"].addEventListener("click",()=>saveProject(false));el["save-project-as-button"].addEventListener("click",()=>saveProject(true));el["media-editor-tab"].addEventListener("click",()=>switchWorkspace(1,"media"));el["audio-studio-tab"].addEventListener("click",()=>switchWorkspace(1,"audio"));el["presentation-tab"].addEventListener("click",()=>switchWorkspace(1,"presentation"));
el["export-button"].addEventListener("click",exportMedia);
el["export-confirm"].addEventListener("click",confirmExport);el["export-cancel"].addEventListener("click",()=>{el["export-dialog"].close();exportPhase="idle";clearAnnouncements();});
el["export-format"].addEventListener("change",()=>localStorage.setItem("ame-export-format",el["export-format"].value));
el["export-success-show-file"].addEventListener("click",async()=>{try{if(!lastExportPath)return announce("No completed export is available.",true);await invoke("reveal_exported_file",{path:lastExportPath});announce("Saved file shown in File Explorer.");}catch(error){announce(String(error),true);}});el["export-success-close"].addEventListener("click",()=>el["export-success-dialog"].close());
el["export-progress-dialog"].addEventListener("cancel",event=>event.preventDefault());
el["media-section-tab"].addEventListener("click",()=>activateSection("media-section"));el["output-section-tab"].addEventListener("click",()=>activateSection("output-section"));
document.querySelectorAll('[role="tab"]').forEach(tab=>tab.addEventListener("keydown",event=>{
  if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
  event.preventDefault();event.stopPropagation();
  const index=workspaceOrder.indexOf(activeWorkspace);
  const target=event.key==="Home"?workspaceOrder[0]:event.key==="End"?workspaceOrder[workspaceOrder.length-1]:workspaceOrder[(index+(event.key==="ArrowRight"?1:-1)+workspaceOrder.length)%workspaceOrder.length];
  switchWorkspace(1,target);el[workspaceTabs[target]].focus();
}));
el["presentation-items"].addEventListener("change",loadPresentationDescriptions);
el["presentation-new"].addEventListener("click",newPresentation);
el["presentation-open"].addEventListener("click",openProject);
el["presentation-save"].addEventListener("click",()=>saveProject(false));
el["presentation-save-as"].addEventListener("click",()=>saveProject(true));
el["presentation-create-slideshow"].addEventListener("click",createSlideshow);
el["presentation-earlier"].addEventListener("click",()=>movePresentation(-1));
el["presentation-later"].addEventListener("click",()=>movePresentation(1));
el["presentation-cut"].addEventListener("click",()=>copyPresentation(true));
el["presentation-copy"].addEventListener("click",()=>copyPresentation(false));
el["presentation-paste"].addEventListener("click",pastePresentation);
el["presentation-remove"].addEventListener("click",removePresentation);
el["presentation-properties"].addEventListener("click",showPresentationItemProperties);
el["presentation-bulk-transition-apply"].addEventListener("click",()=>applyPresentationTransition(false));el["presentation-bulk-transition-remove"].addEventListener("click",()=>applyPresentationTransition(true));
el["presentation-choose-source"].addEventListener("click",focusPresentationSources);
el["presentation-go-timeline"].addEventListener("click",focusPresentationTimeline);
el["presentation-items"].addEventListener("keydown",event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="a"){event.preventDefault();for(const option of el["presentation-items"].options)option.selected=true;announce(`${el["presentation-items"].options.length} presentation items selected.`);}});
el["presentation-music-apply"].addEventListener("click",()=>setPresentationMusic(false));
el["presentation-music-remove"].addEventListener("click",()=>setPresentationMusic(true));
el["presentation-preview"].addEventListener("click",previewPresentation);
el["presentation-preview-close"].addEventListener("click",closePresentationPreview);
el["presentation-preview-dialog"].addEventListener("cancel",event=>{event.preventDefault();closePresentationPreview();});
el["presentation-export"].addEventListener("click",exportPresentation);
el["presentation-insert-before"].addEventListener("click",()=>addPresentationSource("before"));
el["presentation-insert-after"].addEventListener("click",()=>addPresentationSource("after"));
el["presentation-append"].addEventListener("click",()=>addPresentationSource("end"));
el["presentation-save-accessibility"].addEventListener("click",savePresentationDescriptions);
el["presentation-item-properties-save"].addEventListener("click",savePresentationItemProperties);el["presentation-item-properties-cancel"].addEventListener("click",closePresentationItemProperties);el["presentation-item-properties-dialog"].addEventListener("cancel",event=>{event.preventDefault();closePresentationItemProperties();});
el["save-properties-button"].addEventListener("click",saveProperties);el["cancel-properties-button"].addEventListener("click",()=>el["properties-dialog"].close());el["save-text-button"].addEventListener("click",saveText);el["cancel-text-button"].addEventListener("click",()=>el["text-dialog"].close());
el["go-to-time-confirm"].addEventListener("click",confirmGoToTime);el["go-to-time-cancel"].addEventListener("click",()=>el["go-to-time-dialog"].close());
el["insert-image-confirm"].addEventListener("click",confirmImagePlacement);el["insert-image-cancel"].addEventListener("click",()=>finishImagePlacement(null));
el["short-source-replace"].addEventListener("click",()=>applyPendingShortReplacement("replace"));el["short-source-loop"].addEventListener("click",()=>applyPendingShortReplacement("loop"));el["short-source-cancel"].addEventListener("click",()=>applyPendingShortReplacement("cancel"));
if(listen){listen("menu-action",event=>triggerAction(event.payload));listen("production-render-progress",event=>handleExportProgress(event.payload));}
el["persistent-library-add"].addEventListener("click",addLibrarySelection);
el["persistent-library-remove"].addEventListener("click",removeLibrarySelection);
el["persistent-library-items"].addEventListener("change",renderLibrary);
// Native window visibility is independent of frontend startup and library I/O.
render();
if(invoke){
  invoke("frontend_ready").then(()=>{
    el["import-media-button"].focus();
    return invoke("log_frontend_startup",{message:"Frontend ready; clean workspace shown; loading reusable library."});
  }).catch(error=>{
    console.error("Frontend ready handoff failed",error);
    return invoke("log_frontend_startup",{message:`Frontend ready handoff failed: ${error}`}).catch(()=>{});
  }).finally(()=>{void loadLibrary();});
}else{
  el["import-media-button"].focus();
  void loadLibrary();
}
