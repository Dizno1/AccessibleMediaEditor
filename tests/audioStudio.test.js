import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const studio=readFileSync(new URL("../app/audioStudio.js",import.meta.url),"utf8");
const app=readFileSync(new URL("../app/app.js",import.meta.url),"utf8");
const shortcuts=readFileSync(new URL("../app/shortcutService.js",import.meta.url),"utf8");
const rust=readFileSync(new URL("../src-tauri/src/main.rs",import.meta.url),"utf8");
const prepare=readFileSync(new URL("../scripts/prepare-dist.js",import.meta.url),"utf8");

test("AudioStudio Pro exposes keyboard-operable recording, review, and shared-library controls",()=>{
  for(const id of ["audio-enable-microphone","audio-microphone-select","audio-recording-profile","audio-record-toggle","audio-record-pause","audio-recording-preview","audio-keep-recording","audio-record-again","audio-discard-recording","audio-library-items","audio-open-files","audio-edit-source","audio-add-to-project","audio-editor-playhead","audio-editor-play","audio-editor-mark-in","audio-editor-mark-out","audio-editor-goto","audio-editor-save-range"]){
    assert.match(html,new RegExp(`id=["']${id}["']`));
  }
  assert.match(html,/shared Source Media Library/i);
});

test("every AudioStudio element reference exists and an empty preview is not exposed",()=>{
  const ids=new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match=>match[1]));
  const referenced=[...studio.matchAll(/\be\("([^"]+)"\)/g)].map(match=>match[1]);
  assert.deepEqual([...new Set(referenced.filter(id=>!ids.has(id)))],[]);
  assert.match(html,/id="audio-library-preview"[^>]*hidden/);
  assert.match(studio,/libraryPreviewEnd/);
});

test("AudioStudio Pro records with MediaRecorder and handles missing microphone support",()=>{
  assert.match(studio,/new MediaRecorder/);
  assert.match(studio,/navigator\.mediaDevices\?\.getUserMedia/);
  assert.match(studio,/Microphone recording is not available/);
  assert.doesNotMatch(studio,/indexedDB/i);
});

test("recordings use app-owned native storage and the existing normalization pipeline",()=>{
  assert.match(rust,/fn save_audio_recording/);
  assert.match(rust,/join\("Recordings"\)/);
  assert.match(app,/createAudioStudio/);
  assert.match(studio,/invoke\("save_audio_recording"/);
  assert.match(studio,/invoke\("normalize_media"/);
});

test("the production frontend package includes the AudioStudio module",()=>{
  assert.match(prepare,/"audioStudio\.js"/);
});

test("recording shortcuts are app-wide but handlers act only in AudioStudio Pro",()=>{
  assert.match(shortcuts,/toggleAudioRecording.*ctrl:true,alt:true,key:"r"/s);
  assert.match(shortcuts,/pauseAudioRecording.*ctrl:true,alt:true,key:" "/s);
  assert.match(app,/activeWorkspace==="audio".*toggleRecording/s);
});

test("AudioStudio uses app-wide transport and section navigation commands",()=>{
  assert.match(app,/audioStudio\?\.focusSection\(offset\)/);
  assert.match(app,/activeWorkspace==="audio"\?audioStudio\?\.togglePlayback\(\)/);
  assert.match(app,/activeWorkspace==="audio"\?audioStudio\?\.scrub\(-1\)/);
  assert.match(app,/activeWorkspace==="audio"\?audioStudio\?\.setMark\("in"\)/);
  assert.match(studio,/function focusSection\(offset\)/);
});

test("bracketed audio ranges are saved nondestructively",()=>{
  assert.match(studio,/Keep Bracketed Range as New Audio Source|saveRange/);
  assert.match(studio,/editSegments:\[\{start,end\}\]/);
  assert.match(studio,/original audio source is not changed|nondestructive/i);
});

test("all visible and native build identification is 0.12.1",()=>{
  assert.match(html,/Build 0\.12\.1 Development Testing Build/);
  assert.match(app,/Accessible Media Editor Build 0\.12\.1/);
  assert.match(rust,/Build 0\.12\.1 executable started/);
});
