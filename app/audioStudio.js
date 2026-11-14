const profiles={
  spoken:{description:"Clear speech recording with echo cancellation and noise suppression.",constraints:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},bits:128000},
  music:{description:"Music recording with automatic speech processing disabled.",constraints:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},bits:192000},
  unprocessed:{description:"Unprocessed recording using the selected microphone's available signal.",constraints:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},bits:192000}
};

function naturalTime(seconds){
  const total=Math.max(0,Math.round((seconds||0)*1000)),hours=Math.floor(total/3600000),minutes=Math.floor(total/60000)%60,whole=Math.floor(total/1000)%60,milliseconds=total%1000,parts=[];
  if(hours)parts.push(`${hours} ${hours===1?"hour":"hours"}`);
  if(minutes)parts.push(`${minutes} ${minutes===1?"minute":"minutes"}`);
  parts.push(`${whole} ${whole===1?"second":"seconds"}`);
  if(milliseconds)parts.push(`${milliseconds} ${milliseconds===1?"millisecond":"milliseconds"}`);
  return parts.join(", ");
}

function recordingExtension(type){if(type.includes("ogg"))return"ogg";if(type.includes("mp4"))return"m4a";return"webm";}
function supportedType(){return typeof MediaRecorder==="undefined"?"":(["audio/webm;codecs=opus","audio/webm","audio/ogg;codecs=opus","audio/mp4"].find(type=>MediaRecorder.isTypeSupported(type))||"");}
function blobDataUrl(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error||new Error("The recording could not be read."));reader.readAsDataURL(blob);});}
const audioNaturalCollator=new Intl.Collator(undefined,{numeric:true,sensitivity:"base"});
function baseBookName(item){return String(item.audiobookCollection||item.collection||"Audiobook").replace(/ - Shortened Pauses$/i,"");}
function looksLikeBookChapter(item){return /(?:chapter\s*0*\d+|(?:^|[_ -])0*\d+(?:[_ .-]|$)|intro|outro)/i.test(String(item.label||item.name||""));}
export function audioCollectionInfo(item){
  if(item.collectionType==="recording")return{key:"recordings",label:"Recordings",rank:1};
  const book=item.collectionType?.startsWith("audiobook")||item.audiobookCollection||(item.collection&&looksLikeBookChapter(item));
  if(book){const name=baseBookName(item),shortened=item.collectionType==="audiobook-shortened"||item.silenceShortened;return{key:"book:"+(shortened?"shortened:":"original:")+name,label:name+(shortened?" - Shortened Pauses":""),rank:shortened?3:2};}
  return{key:"other",label:"Other Audio",rank:0};
}
export function sortAudioItems(items){return [...items].sort((left,right)=>audioNaturalCollator.compare(String(left.label||left.name||""),String(right.label||right.name||"")));}

export function createAudioStudio(options){
  const {elements,invoke,convertFileSrc,announce,getAudioItems,addLibraryAudio,addAudioToProject,removeLibraryAudio,exportAudioFiles,importAudioFiles,importAudioFolder,retryAudioFiles}=options;
  let stream=null,recorder=null,chunks=[],startedAt=0,accumulated=0,pending=null,previewUrl=null;
  let editingItem=null,cursor=0,markIn=null,markOut=null,auditionTimer=null,libraryPreviewEnd=null,lastImportReport=null,selectionSnapshot=new Set();
  const e=id=>elements[id],editor=e("audio-editor-media");
  let playbackSpeed=Number(localStorage.getItem("ame-playback-speed"))||1;

  function setStatus(text){e("audio-studio-status").textContent=text;}
  function visibleItems(){const value=e("audio-library-collection").value,items=getAudioItems();return sortAudioItems(value==="all"?items:items.filter(item=>audioCollectionInfo(item).key===value));}
  function selectedItem(){return getAudioItems().find(value=>value.id===e("audio-library-items").value);}
  function selectedItems(){const ids=new Set([...e("audio-library-items").selectedOptions].map(option=>option.value));return visibleItems().filter(item=>ids.has(item.id));}
  function selectedIds(){return new Set([...e("audio-library-items").selectedOptions].map(option=>option.value));}
  function optionName(option){return String(option?.textContent||option?.text||"Audio file").replace(/\. \d+(?: minute| hour| second| millisecond)s?.*$/i,"");}
  function updateSelectionStatus(){
    const count=selectedItems().length,total=visibleItems().length;
    e("audio-library-selection-status").textContent=count?`${count} of ${total} audio ${total===1?"file":"files"} selected.`:"No audio files selected.";
    e("audio-editor-shorten-silence").disabled=!count;
  }
  function reportSelectionChange(){
    const list=e("audio-library-items"),current=selectedIds(),added=[...current].filter(id=>!selectionSnapshot.has(id)),removed=[...selectionSnapshot].filter(id=>!current.has(id)),count=current.size;
    updateSelectionStatus();
    if(added.length===1&&!removed.length){const option=[...list.options].find(value=>value.value===added[0]);announce(`${optionName(option)} selected. ${count} audio ${count===1?"file":"files"} selected.`);}
    else if(removed.length===1&&!added.length){const option=[...list.options].find(value=>value.value===removed[0]);announce(`${optionName(option)} unselected. ${count?`${count} audio ${count===1?"file":"files"} selected.`:"No audio files selected."}`);}
    else if(added.length||removed.length)announce(count?`${count} of ${list.options.length} audio files selected.`:"Selection cleared. No audio files selected.");
    selectionSnapshot=current;
  }
  function sourceUrl(item){return convertFileSrc?convertFileSrc(item.source):item.source;}
  function sourceRange(item){
    const segments=Array.isArray(item?.editSegments)&&item.editSegments.length?item.editSegments:null;
    if(segments?.length===1)return{start:Number(segments[0].start)||0,end:Number(segments[0].end)||Number(item.duration)||0};
    return{start:Number(item?.inPoint)||0,end:Number(item?.outPoint)||Number(item?.duration)||0};
  }
  function editorDuration(){if(!editingItem)return 0;const range=sourceRange(editingItem);return Math.max(0,range.end-range.start)||Number(editingItem.duration)||0;}
  function sourceTime(logical){return sourceRange(editingItem).start+logical;}
  function updateEditor(exposePlayheadValue=true){
    const length=editorDuration();cursor=Math.max(0,Math.min(length,cursor));
    const playhead=e("audio-editor-playhead");playhead.value=String(Number(cursor.toFixed(3)));if(exposePlayheadValue)playhead.setAttribute("aria-valuetext",naturalTime(cursor));
    e("audio-editor-position").textContent=editingItem?`Position ${naturalTime(cursor)} of ${naturalTime(length)}.`:"Position 0 seconds. No audio open.";
    const marks=[];if(markIn!=null)marks.push(`Left Bracket ${naturalTime(markIn)}`);if(markOut!=null)marks.push(`Right Bracket ${naturalTime(markOut)}`);
    e("audio-editor-marks").textContent=marks.length?marks.join(". ")+".":"No brackets set.";
    e("audio-editor-clear-marks").disabled=!marks.length;e("audio-editor-save-range").disabled=!(markIn!=null&&markOut!=null&&markOut>markIn);
  }
  function renderLibrary(){
    const allItems=getAudioItems(),collection=e("audio-library-collection"),previousCollection=collection.value||"all",collections=new Map();
    for(const item of allItems){const info=audioCollectionInfo(item);collections.set(info.key,info);}
    const collectionOptions=[new Option("All Audio, "+allItems.length+" files","all"),...([...collections.values()].sort((left,right)=>left.rank-right.rank||audioNaturalCollator.compare(left.label,right.label)).map(info=>new Option(info.label+", "+allItems.filter(item=>audioCollectionInfo(item).key===info.key).length+" files",info.key)))];
    collection.replaceChildren(...collectionOptions);collection.value=[...collection.options].some(option=>option.value===previousCollection)?previousCollection:"all";
    const items=visibleItems(),list=e("audio-library-items"),previous=new Set([...list.selectedOptions].map(option=>option.value));list.replaceChildren();
    for(const item of items)list.add(new Option(`${item.label||item.name}. ${naturalTime(item.duration||0)}.`,item.id));
    if(!items.length){const option=new Option("No saved audio sources","");option.disabled=true;list.add(option);}
    for(const option of list.options)option.selected=previous.has(option.value);
    const selectedCollection=collection.options[collection.selectedIndex]?.textContent?.replace(/, \d+ files$/,"")||"All Audio";
    e("audio-library-summary").textContent=selectedCollection+". "+items.length+" saved audio "+(items.length===1?"source":"sources")+". These sources are shared with Media Editor and Presentation.";
    const available=items.length>0;for(const id of ["audio-preview-source","audio-edit-source","audio-add-to-project","audio-export-sources","audio-remove-sources"])e(id).disabled=!available;
    selectionSnapshot=selectedIds();updateSelectionStatus();
  }

  async function populateMicrophones(){
    const devices=(await navigator.mediaDevices.enumerateDevices()).filter(device=>device.kind==="audioinput");
    e("audio-microphone-select").replaceChildren(...devices.map((device,index)=>new Option(device.label||`Microphone ${index+1}`,device.deviceId)));
    e("audio-recording-setup").hidden=false;e("audio-record-toggle").disabled=false;e("audio-enable-microphone").disabled=true;e("audio-microphone-status").textContent=`Microphone access enabled. ${devices.length} ${devices.length===1?"microphone":"microphones"} available.`;
  }

  async function restoreMicrophonePermission(){
    if(typeof navigator==="undefined"||!navigator.mediaDevices?.enumerateDevices||!navigator.permissions?.query)return;
    try{const permission=await navigator.permissions.query({name:"microphone"});if(permission.state==="granted")await populateMicrophones();}catch(error){console.debug("Microphone permission state is not available.",error);}
  }

  async function enableMicrophone(){
    if(!navigator.mediaDevices?.getUserMedia)return announce("Microphone recording is not available on this system. Audio files can still be opened and used.",true);
    try{
      e("audio-enable-microphone").disabled=true;e("audio-microphone-status").textContent="Requesting microphone permission.";
      const permission=await navigator.mediaDevices.getUserMedia({audio:true});permission.getTracks().forEach(track=>track.stop());
      await populateMicrophones();
      announce("Microphone access enabled. Ready to record.");
    }catch(error){e("audio-enable-microphone").disabled=false;e("audio-microphone-status").textContent="Microphone access was not enabled.";announce(`Microphone access failed. ${error}`,true);}
  }

  async function startRecording(){
    if(recorder&&recorder.state!=="inactive")return;
    const type=supportedType();if(!type)return announce("No supported recording format is available.",true);
    try{
      const profile=profiles[e("audio-recording-profile").value],device=e("audio-microphone-select").value;
      stream=await navigator.mediaDevices.getUserMedia({audio:{...profile.constraints,...(device?{deviceId:{exact:device}}:{})}});
      chunks=[];accumulated=0;startedAt=Date.now();recorder=new MediaRecorder(stream,{mimeType:type,audioBitsPerSecond:profile.bits});
      recorder.ondataavailable=event=>{if(event.data?.size)chunks.push(event.data);};
      recorder.onstop=()=>finishRecording(type);
      recorder.onerror=event=>announce(`Recording failed. ${event.error||"Unknown recording error."}`,true);
      recorder.start();e("audio-record-toggle").textContent="Stop Recording (Ctrl+Alt+R)";e("audio-record-pause").disabled=false;e("audio-record-pause").textContent="Pause Recording (Ctrl+Alt+Space)";setStatus("Recording.");announce("Recording started.");
    }catch(error){announce(`Recording could not start. ${error}`,true);}
  }

  function stopRecording(){if(!recorder||recorder.state==="inactive")return;if(recorder.state==="recording")accumulated+=Date.now()-startedAt;recorder.stop();stream?.getTracks().forEach(track=>track.stop());stream=null;}
  function toggleRecording(){if(recorder&&recorder.state!=="inactive")stopRecording();else if(!e("audio-record-toggle").disabled)void startRecording();else announce("Enable microphone access before recording.",true);}
  function pauseRecording(){
    if(!recorder||recorder.state==="inactive")return announce("There is no active recording to pause.",true);
    if(recorder.state==="recording"){recorder.pause();accumulated+=Date.now()-startedAt;e("audio-record-pause").textContent="Resume Recording (Ctrl+Alt+Space)";setStatus("Recording paused.");announce("Recording paused.");}
    else{recorder.resume();startedAt=Date.now();e("audio-record-pause").textContent="Pause Recording (Ctrl+Alt+Space)";setStatus("Recording resumed.");announce("Recording resumed.");}
  }
  function finishRecording(type){
    const duration=accumulated/1000,blob=new Blob(chunks,{type});pending={blob,duration,type};
    if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(blob);e("audio-recording-preview").src=previewUrl;e("audio-review-duration").textContent=`Recording duration ${naturalTime(duration)}.`;e("audio-recording-review").hidden=false;e("audio-record-toggle").textContent="Start Recording (Ctrl+Alt+R)";e("audio-record-toggle").disabled=true;e("audio-record-pause").disabled=true;setStatus("Recording stopped. Review, keep, record again, or discard.");announce("Recording stopped.");e("audio-review-heading").focus();
  }
  function clearPending(){pending=null;e("audio-recording-preview").pause();e("audio-recording-preview").removeAttribute("src");e("audio-recording-preview").load();if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=null;e("audio-recording-review").hidden=true;e("audio-record-toggle").disabled=false;}
  async function keepRecording(){
    if(!pending)return;const name=e("audio-recording-name").value.trim()||"New Recording",extension=recordingExtension(pending.type);
    try{
      e("audio-keep-recording").disabled=true;setStatus("Saving recording to the shared library. Please wait.");
      const dataUrl=await blobDataUrl(pending.blob),original=await invoke("save_audio_recording",{dataUrl,suggestedName:name,extension}),itemId=`audio-${Date.now()}`,source=await invoke("normalize_media",{source:original,mediaKind:"Audio",itemId});
      addLibraryAudio({id:itemId,name:`${name}.m4a`,label:name,kind:"Audio",source,workingSource:source,originalSource:original,collection:"Recordings",collectionType:"recording",duration:pending.duration,inPoint:0,outPoint:pending.duration,editSegments:[{start:0,end:pending.duration}],trackTarget:"audio",role:"source"});
      clearPending();renderLibrary();setStatus(`${name} saved to the shared Source Media Library.`);announce("Recording saved to the shared Source Media Library.");e("audio-library-items").value=itemId;e("audio-library-items").focus();
    }catch(error){setStatus("Recording was not saved.");announce(`Recording could not be saved. ${error}`,true);}finally{e("audio-keep-recording").disabled=false;}
  }
  function discardRecording(){if(!pending)return;clearPending();setStatus("Recording discarded. Ready to record.");announce("Recording discarded.");e("audio-record-toggle").focus();}
  function recordAgain(){clearPending();setStatus("Previous recording discarded. Ready to record again.");e("audio-record-toggle").focus();}
  function previewSource(){
    const item=selectedItem();if(!item)return;
    const preview=e("audio-library-preview"),range=sourceRange(item);
    if(!preview.paused&&preview.dataset.itemId===item.id){preview.pause();e("audio-preview-source").textContent="Play or Stop Selected Audio Preview";announce(`Preview paused at ${naturalTime(Math.max(0,preview.currentTime-range.start))}.`);return;}
    if(preview.paused&&preview.dataset.itemId===item.id&&Number.isFinite(preview.currentTime)&&preview.currentTime>=range.start&&(!range.end||preview.currentTime<range.end-.01)){
      pauseEditor();libraryPreviewEnd=range.end||null;preview.hidden=false;preview.play().then(()=>{e("audio-preview-source").textContent="Pause Selected Audio Preview";announce(`Preview resumed at ${naturalTime(Math.max(0,preview.currentTime-range.start))}.`);}).catch(error=>announce(`Audio could not be played. ${error}`,true));return;
    }
    pauseEditor();preview.pause();preview.dataset.itemId=item.id;libraryPreviewEnd=range.end||null;preview.hidden=false;preview.src=sourceUrl(item);e("audio-preview-source").textContent="Stop Selected Audio Preview";
    preview.addEventListener("loadedmetadata",()=>{preview.currentTime=range.start;preview.play().catch(error=>announce(`Audio could not be played. ${error}`,true));},{once:true});preview.load();
  }
  function setImportReport(report){
    if(!report||!report.total)return;
    lastImportReport=report;const failures=Array.isArray(report.failed)?report.failed:[],summary=e("audio-import-results-summary"),list=e("audio-import-results-list");
    summary.textContent=failures.length?`Import incomplete. ${report.imported} of ${report.total} chapters imported. ${failures.length} ${failures.length===1?"chapter requires":"chapters require"} attention.`:`Import complete. All ${report.imported} chapters imported.${report.recovered?` ${report.recovered} ${report.recovered===1?"chapter uses":"chapters use"} a compatible working copy.`:""}`;
    list.replaceChildren(...(failures.length?failures.map(failure=>{const item=document.createElement("li");item.textContent=`${failure.name}. ${failure.reason}`;return item;}):[Object.assign(document.createElement("li"),{textContent:"No chapter failures."})]));
    e("audio-import-retry").hidden=!failures.length;e("audio-review-import").hidden=false;
  }
  function showImportReport(){if(!lastImportReport)return announce("No audio import results are available yet.");e("audio-import-results-dialog").showModal();e("audio-import-results-heading").focus();}
  async function retryFailedImports(){
    const paths=lastImportReport?.failed?.map(item=>item.path).filter(Boolean)||[];if(!paths.length)return announce("There are no failed chapters to retry.");
    e("audio-import-retry").disabled=true;announce(`Retrying ${paths.length} failed ${paths.length===1?"chapter":"chapters"}.`);
    try{const report=await retryAudioFiles(paths,lastImportReport?.origin);setImportReport(report);renderLibrary();if(!report.failed.length){e("audio-import-results-dialog").close();e("audio-library-items").focus();}}
    catch(error){announce(`Failed chapters could not be retried. ${error}`,true);}finally{e("audio-import-retry").disabled=false;}
  }
  async function openAudio(){try{const report=await importAudioFiles();setImportReport(report);renderLibrary();}catch(error){announce(`Audio import failed. ${error}`,true);}}
  async function openFolder(){try{const report=await importAudioFolder();setImportReport(report);renderLibrary();if(report?.collection){e("audio-library-collection").value="book:original:"+report.collection;renderLibrary();announce(`${report.collection} opened. ${visibleItems().length} chapters in filename order.`);e("audio-library-items").focus();}}catch(error){announce(`Audio folder import failed. ${error}`,true);}}
  function addSelected(){const items=selectedItems();if(!items.length)return announce("Select one or more entries in the Shared Audio Library first.",true);addAudioToProject(items);e("audio-library-items").focus();}
  async function exportSelected(){const items=selectedItems();if(!items.length)return announce("Select one or more entries in the Shared Audio Library first.",true);await exportAudioFiles(items);e("audio-library-items").focus();}
  function removeSelected(){const items=selectedItems();if(!items.length)return announce("Select one or more entries in the Shared Audio Library first.",true);removeLibraryAudio(items);e("audio-library-items").focus();}

  function openEditor(){
    const item=selectedItem();if(!item)return announce("Choose an audio source first.",true);
    const segments=Array.isArray(item.editSegments)?item.editSegments:[];
    if(segments.length>1)return announce("This source contains multiple edited segments. Open it in Media Editor for now.",true);
    editingItem=item;cursor=0;markIn=markOut=null;editor.pause();editor.src=sourceUrl(item);editor.load();
    const length=Math.max(0,Number(item.duration)||sourceRange(item).end-sourceRange(item).start);
    e("audio-editor-playhead").max=String(Number(length.toFixed(3)));e("audio-editor-playhead").disabled=false;
    for(const id of ["audio-editor-play","audio-editor-mark-in","audio-editor-mark-out","audio-editor-goto"])e(id).disabled=false;
    e("audio-edited-copy-name").value=`Edited - ${item.label||item.name}`;
    e("audio-editor-summary").textContent=`Editing ${item.label||item.name}. Duration ${naturalTime(length)}.`;updateEditor();e("audio-editor-playhead").focus();announce(`${item.label||item.name} opened in Audio Editor. Duration ${naturalTime(length)}.`);
  }
  function pauseEditor(){clearTimeout(auditionTimer);auditionTimer=null;editor.pause();e("audio-editor-play").textContent="Play or Pause (X)";}
  function setPlaybackSpeed(){playbackSpeed=Number(e("audio-editor-speed").value)||1;editor.playbackRate=playbackSpeed;editor.preservesPitch=true;localStorage.setItem("ame-playback-speed",String(playbackSpeed));window.dispatchEvent(new CustomEvent("ame-playback-speed-change",{detail:playbackSpeed}));announce(`Playback speed ${playbackSpeed===1?"normal":`${playbackSpeed} times`}.`);}
  function adjustPlaybackSpeed(direction){
    const rates=[.75,1,1.25,1.5,1.75,2],current=rates.indexOf(playbackSpeed),next=Math.max(0,Math.min(rates.length-1,(current<0?1:current)+direction));
    if(rates[next]===playbackSpeed)return announce(`Playback speed is already ${direction<0?"at the slowest setting":"at the fastest setting"}.`);
    e("audio-editor-speed").value=String(rates[next]);setPlaybackSpeed();
  }
  function togglePlayback(){
    const libraryPreview=e("audio-library-preview");if(!libraryPreview.paused){libraryPreview.pause();e("audio-preview-source").textContent="Play or Stop Selected Audio Preview";announce("Audio Source Library preview stopped.");return;}
    if(!editingItem)return announce("Open an audio source in Audio Editor first.",true);
    if(!editor.paused){pauseEditor();updateEditor(true);announce(`Paused at ${naturalTime(cursor)}.`);return;}
    if(cursor>=editorDuration())cursor=0;editor.currentTime=sourceTime(cursor);editor.play().then(()=>{e("audio-editor-play").textContent="Pause (X)";}).catch(error=>announce(`Audio could not be played. ${error}`,true));
  }
  function seek(amount,quiet=false){
    if(!editingItem)return announce("Open an audio source in Audio Editor first.",true);
    cursor=Math.max(0,Math.min(editorDuration(),cursor+amount));editor.currentTime=sourceTime(cursor);updateEditor();if(!quiet)announce(`Audio playhead ${naturalTime(cursor)}.`);
  }
  function jump(end){if(!editingItem)return announce("Open an audio source in Audio Editor first.",true);cursor=end?editorDuration():0;editor.currentTime=sourceTime(cursor);updateEditor();announce(`${end?"End":"Beginning"} ${naturalTime(cursor)}.`);}
  function scrub(amount){
    if(!editingItem)return announce("Open an audio source in Audio Editor first.",true);
    pauseEditor();seek(amount,true);editor.currentTime=sourceTime(cursor);editor.play().then(()=>{auditionTimer=setTimeout(pauseEditor,500);}).catch(()=>{});
  }
  function setMark(which){
    if(!editingItem)return announce("Open an audio source in Audio Editor first.",true);
    if(which==="in")markIn=cursor;else markOut=cursor;updateEditor();announce(`${which==="in"?"Left":"Right"} Bracket set at ${naturalTime(cursor)}.`);
  }
  function clearMarks(){markIn=markOut=null;updateEditor();announce("Audio brackets cleared.");}
  function goToTime(){
    if(!editingItem)return announce("Open an audio source in Audio Editor first.",true);
    const hours=Number(e("audio-goto-hours").value),minutes=Number(e("audio-goto-minutes").value),seconds=Number(e("audio-goto-seconds").value),milliseconds=Number(e("audio-goto-milliseconds").value);
    if(![hours,minutes,seconds,milliseconds].every(Number.isFinite)||hours<0||minutes<0||minutes>59||seconds<0||seconds>59||milliseconds<0||milliseconds>999)return announce("Enter a valid audio time.",true);
    cursor=Math.min(editorDuration(),hours*3600+minutes*60+seconds+milliseconds/1000);editor.currentTime=sourceTime(cursor);updateEditor();e("audio-editor-playhead").focus();announce(`Audio playhead moved to ${naturalTime(cursor)}.`);
  }
  function saveRange(){
    if(!editingItem||markIn==null||markOut==null||markOut<=markIn)return announce("Set a Left Bracket before a Right Bracket to keep a range.",true);
    const name=e("audio-edited-copy-name").value.trim()||`Edited - ${editingItem.label||editingItem.name}`,range=sourceRange(editingItem),start=range.start+markIn,end=range.start+markOut,itemId=`audio-edit-${Date.now()}`;
    addLibraryAudio({...editingItem,id:itemId,name,label:name,duration:markOut-markIn,inPoint:0,outPoint:markOut-markIn,editSegments:[{start,end}],role:"source"});
    renderLibrary();e("audio-library-items").value=itemId;announce(`${name} saved automatically to the Shared Audio Library as a new nondestructive audio source. Duration ${naturalTime(markOut-markIn)}. Use Export Selected Audio Copies to Folder to create an ordinary file.`);e("audio-library-items").focus();
  }
  async function shortenSilence(){
    const items=selectedItems();if(!items.length)return announce("Select one or more chapters in the Shared Audio Library first.",true);
    const minimum=Number(e("audio-silence-minimum").value),retain=Number(e("audio-silence-retain").value),threshold=Number(e("audio-silence-threshold").value);
    if(!Number.isFinite(minimum)||minimum<.5||minimum>30)return announce("Enter a minimum pause between 0.5 and 30 seconds.",true);
    if(!Number.isFinite(retain)||retain<.1||retain>10||retain>=minimum)return announce("The retained pause must be at least 0.1 seconds and shorter than the minimum detected pause.",true);
    const button=e("audio-editor-shorten-silence"),status=e("audio-silence-status"),plans=[];button.disabled=true;status.textContent=`Analyzing ${items.length} selected ${items.length===1?"chapter":"chapters"}. Please wait.`;announce(status.textContent);
    try{
      for(const [index,item] of items.entries()){
        const label=item.label||item.name,range=sourceRange(item);status.textContent=`Analyzing chapter ${index+1} of ${items.length}. ${label}.`;announce(status.textContent);
        const reminder=setTimeout(()=>announce(`Still analyzing chapter ${index+1} of ${items.length}. ${label}.`),30000);
        let silences;try{silences=await invoke("analyze_silence",{source:item.source,start:range.start,end:range.end,minimumDuration:minimum,thresholdDb:threshold});}finally{clearTimeout(reminder);}
        const retained=[];let position=range.start,removed=0;
        for(const silence of silences){const start=Math.max(position,Number(silence.start)),end=Math.min(range.end,Number(silence.end)),length=end-start;if(length<minimum-.001)continue;const keep=Math.min(retain,length),cutStart=start+keep/2,cutEnd=end-keep/2;if(cutStart>position+.001)retained.push({start:position,end:cutStart});removed+=Math.max(0,cutEnd-cutStart);position=Math.max(position,cutEnd);}
        if(position<range.end-.001)retained.push({start:position,end:range.end});
        if(removed>=.001)plans.push({item,retained,removed,newDuration:retained.reduce((total,segment)=>total+segment.end-segment.start,0),pauseCount:silences.length});
        announce(`Chapter ${index+1} of ${items.length} analyzed. ${label}.`);
      }
      if(!plans.length){status.textContent=`No pauses of at least ${naturalTime(minimum)} were detected in the selected chapters.`;announce(status.textContent);return;}
      const totalRemoved=plans.reduce((total,plan)=>total+plan.removed,0),message=`${plans.length} of ${items.length} selected ${items.length===1?"chapter has":"chapters have"} long pauses. Creating shortened copies will remove ${naturalTime(totalRemoved)} in total. Original sources will remain unchanged. Continue?`;
      status.textContent=message;if(!window.confirm(message)){announce("Silence shortening canceled. Original sources were not changed.");return;}
      const created=[],shortenedBook=items.length?baseBookName(items[0]):"Audiobook";
      for(const [index,plan] of plans.entries()){
        const label=plan.item.label||plan.item.name;status.textContent=`Creating shortened chapter ${index+1} of ${plans.length}. ${label}.`;announce(status.textContent);
        const reminder=setTimeout(()=>announce(`Still creating shortened chapter ${index+1} of ${plans.length}. ${label}.`),30000),itemId=`audio-silence-${Date.now()}-${index}`;
        let path;try{path=await invoke("render_working_edit",{source:plan.item.source,segments:plan.retained,mediaKind:"Audio",itemId});}finally{clearTimeout(reminder);}
        const name=`${label.replace(/\.[^.]+$/,'')} - Shortened Pauses`;
        addLibraryAudio({...plan.item,id:itemId,name,label:name,source:path,workingSource:path,originalSource:plan.item.originalSource||plan.item.source,collection:`${baseBookName(plan.item)} - Shortened Pauses`,collectionType:"audiobook-shortened",audiobookCollection:baseBookName(plan.item),duration:plan.newDuration,inPoint:0,outPoint:plan.newDuration,editSegments:[{start:0,end:plan.newDuration}],silenceShortened:true,sourceItemId:plan.item.id,role:"source"});created.push(itemId);
        announce(`Shortened chapter ${index+1} of ${plans.length} created. ${label}.`);
      }
      renderLibrary();e("audio-library-collection").value=`book:shortened:${shortenedBook}`;renderLibrary();for(const option of e("audio-library-items").options)option.selected=created.includes(option.value);selectionSnapshot=selectedIds();updateSelectionStatus();status.textContent=`${created.length} shortened ${created.length===1?"chapter":"chapters"} created in ${shortenedBook} - Shortened Pauses. ${naturalTime(totalRemoved)} removed in total. Original sources unchanged.`;announce(status.textContent);e("audio-library-items").focus();
    }catch(error){status.textContent="The shortened copies could not all be created.";announce(`Silence analysis or rendering failed. ${error}`,true);}finally{button.disabled=!selectedItems().length;}
  }
  function focusSection(offset){
    const ids=["audio-recording-section",...(!e("audio-recording-review").hidden?["audio-recording-review"]:[]),"audio-library-section","audio-editor-section"],current=document.activeElement?.closest?.("section")?.id,index=Math.max(0,ids.indexOf(current)),next=ids[(index+offset+ids.length)%ids.length],section=e(next);section.focus();setStatus(`${section.querySelector("h2").textContent} section.`);
  }
  function focusLibrary(){e("audio-library-items").focus();}

  editor.addEventListener("loadedmetadata",()=>{if(!editingItem)return;const range=sourceRange(editingItem);if(!range.end&&Number.isFinite(editor.duration)){editingItem.duration=editor.duration;editingItem.outPoint=editor.duration;editingItem.editSegments=[{start:0,end:editor.duration}];e("audio-editor-playhead").max=String(Number(editor.duration.toFixed(3)));}editor.currentTime=sourceTime(cursor);updateEditor();});
  editor.addEventListener("timeupdate",()=>{if(!editingItem)return;cursor=Math.max(0,editor.currentTime-sourceRange(editingItem).start);if(cursor>=editorDuration()-0.01){cursor=editorDuration();pauseEditor();updateEditor(true);return;}updateEditor(false);});
  editor.addEventListener("ended",()=>{cursor=editorDuration();pauseEditor();updateEditor(true);});
  e("audio-library-preview").addEventListener("timeupdate",()=>{const preview=e("audio-library-preview");if(libraryPreviewEnd!=null&&preview.currentTime>=libraryPreviewEnd){preview.pause();libraryPreviewEnd=null;e("audio-preview-source").textContent="Play or Stop Selected Audio Preview";}});
  e("audio-library-preview").addEventListener("ended",()=>{e("audio-preview-source").textContent="Play or Stop Selected Audio Preview";});
  e("audio-library-items").addEventListener("change",reportSelectionChange);
  e("audio-library-collection").addEventListener("change",()=>{renderLibrary();announce(e("audio-library-summary").textContent);e("audio-library-items").focus();});
  e("audio-library-items").addEventListener("keydown",event=>{
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="a"){
      event.preventDefault();for(const option of e("audio-library-items").options)if(!option.disabled)option.selected=true;selectionSnapshot=selectedIds();updateSelectionStatus();announce(`All ${selectionSnapshot.size} audio files selected.`);
    }else if(event.key==="Enter"&&!event.ctrlKey&&!event.altKey&&!event.shiftKey){event.preventDefault();openEditor();}
    else if(event.key.toLowerCase()==="p"&&!event.ctrlKey&&!event.altKey&&!event.shiftKey){event.preventDefault();previewSource();}
    else if(event.key==="Delete"){event.preventDefault();removeSelected();}
  });
  e("audio-enable-microphone").addEventListener("click",enableMicrophone);e("audio-record-toggle").addEventListener("click",toggleRecording);e("audio-record-pause").addEventListener("click",pauseRecording);e("audio-keep-recording").addEventListener("click",keepRecording);e("audio-record-again").addEventListener("click",recordAgain);e("audio-discard-recording").addEventListener("click",discardRecording);e("audio-open-files").addEventListener("click",openAudio);e("audio-open-folder").addEventListener("click",openFolder);e("audio-review-import").addEventListener("click",showImportReport);e("audio-import-retry").addEventListener("click",retryFailedImports);e("audio-preview-source").addEventListener("click",previewSource);e("audio-edit-source").addEventListener("click",openEditor);e("audio-add-to-project").addEventListener("click",addSelected);e("audio-export-sources").addEventListener("click",exportSelected);e("audio-remove-sources").addEventListener("click",removeSelected);e("audio-recording-profile").addEventListener("change",()=>{e("audio-profile-description").textContent=profiles[e("audio-recording-profile").value].description;});
  e("audio-editor-play").addEventListener("click",togglePlayback);e("audio-editor-mark-in").addEventListener("click",()=>setMark("in"));e("audio-editor-mark-out").addEventListener("click",()=>setMark("out"));e("audio-editor-clear-marks").addEventListener("click",clearMarks);e("audio-editor-goto").addEventListener("click",goToTime);e("audio-editor-save-range").addEventListener("click",saveRange);e("audio-editor-shorten-silence").addEventListener("click",shortenSilence);e("audio-editor-speed").addEventListener("change",setPlaybackSpeed);e("audio-editor-playhead").addEventListener("input",()=>{cursor=Number(e("audio-editor-playhead").value)||0;editor.currentTime=sourceTime(cursor);updateEditor();});
  e("audio-editor-speed").value=String(playbackSpeed);editor.playbackRate=playbackSpeed;editor.preservesPitch=true;window.addEventListener("ame-playback-speed-change",event=>{playbackSpeed=Number(event.detail)||1;e("audio-editor-speed").value=String(playbackSpeed);editor.playbackRate=playbackSpeed;editor.preservesPitch=true;});
  renderLibrary();updateEditor();void restoreMicrophonePermission();
  return{renderLibrary,toggleRecording,pauseRecording,focusSection,focusLibrary,openAudio,openFolder,togglePlayback,adjustPlaybackSpeed,seek,scrub,jump,setMark,goToTime,saveRange,shortenSilence};
}
