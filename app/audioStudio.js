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

export function createAudioStudio(options){
  const {elements,invoke,convertFileSrc,announce,getAudioItems,addLibraryAudio,addAudioToProject,importAudioFiles}=options;
  let stream=null,recorder=null,chunks=[],startedAt=0,accumulated=0,pending=null,previewUrl=null;
  const e=id=>elements[id];

  function setStatus(text){e("audio-studio-status").textContent=text;}
  function renderLibrary(){
    const items=getAudioItems(),list=e("audio-library-items"),previous=list.value;list.replaceChildren();
    for(const item of items)list.add(new Option(`${item.label||item.name}. ${naturalTime(item.duration||0)}.`,item.id));
    if(!items.length){const option=new Option("No saved audio sources","");option.disabled=true;list.add(option);}
    if(items.some(item=>item.id===previous))list.value=previous;
    e("audio-library-summary").textContent=`${items.length} saved audio ${items.length===1?"source":"sources"}. These sources are shared with Media Editor and Presentation.`;
    const available=items.length>0;e("audio-preview-source").disabled=!available;e("audio-add-to-project").disabled=!available;
  }

  async function enableMicrophone(){
    if(!navigator.mediaDevices?.getUserMedia)return announce("Microphone recording is not available on this system. Audio files can still be opened and used.",true);
    try{
      e("audio-enable-microphone").disabled=true;e("audio-microphone-status").textContent="Requesting microphone permission.";
      const permission=await navigator.mediaDevices.getUserMedia({audio:true});permission.getTracks().forEach(track=>track.stop());
      const devices=(await navigator.mediaDevices.enumerateDevices()).filter(device=>device.kind==="audioinput");
      e("audio-microphone-select").replaceChildren(...devices.map((device,index)=>new Option(device.label||`Microphone ${index+1}`,device.deviceId)));
      e("audio-recording-setup").hidden=false;e("audio-record-toggle").disabled=false;e("audio-microphone-status").textContent=`Microphone access enabled. ${devices.length} ${devices.length===1?"microphone":"microphones"} available.`;
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
      addLibraryAudio({id:itemId,name:`${name}.m4a`,label:name,kind:"Audio",source,workingSource:source,originalSource:original,duration:pending.duration,inPoint:0,outPoint:pending.duration,editSegments:[{start:0,end:pending.duration}],trackTarget:"audio",role:"source"});
      clearPending();renderLibrary();setStatus(`${name} saved to the shared Source Media Library.`);announce("Recording saved to the shared Source Media Library.");e("audio-library-items").value=itemId;e("audio-library-items").focus();
    }catch(error){setStatus("Recording was not saved.");announce(`Recording could not be saved. ${error}`,true);}finally{e("audio-keep-recording").disabled=false;}
  }
  function discardRecording(){if(!pending)return;clearPending();setStatus("Recording discarded. Ready to record.");announce("Recording discarded.");e("audio-record-toggle").focus();}
  function recordAgain(){clearPending();setStatus("Previous recording discarded. Ready to record again.");e("audio-record-toggle").focus();}
  function previewSource(){const item=getAudioItems().find(value=>value.id===e("audio-library-items").value);if(!item)return;e("audio-library-preview").src=convertFileSrc(item.source);e("audio-library-preview").play().catch(error=>announce(`Audio could not be played. ${error}`,true));}
  async function openAudio(){try{await importAudioFiles();renderLibrary();}catch(error){announce(`Audio import failed. ${error}`,true);}}
  function addSelected(){const item=getAudioItems().find(value=>value.id===e("audio-library-items").value);if(item)addAudioToProject(item);}

  e("audio-enable-microphone").addEventListener("click",enableMicrophone);e("audio-record-toggle").addEventListener("click",toggleRecording);e("audio-record-pause").addEventListener("click",pauseRecording);e("audio-keep-recording").addEventListener("click",keepRecording);e("audio-record-again").addEventListener("click",recordAgain);e("audio-discard-recording").addEventListener("click",discardRecording);e("audio-open-files").addEventListener("click",openAudio);e("audio-preview-source").addEventListener("click",previewSource);e("audio-add-to-project").addEventListener("click",addSelected);e("audio-recording-profile").addEventListener("change",()=>{e("audio-profile-description").textContent=profiles[e("audio-recording-profile").value].description;});
  renderLibrary();
  return{renderLibrary,toggleRecording,pauseRecording};
}
