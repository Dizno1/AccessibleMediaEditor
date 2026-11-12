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
  for(const id of ["audio-enable-microphone","audio-microphone-select","audio-recording-profile","audio-record-toggle","audio-record-pause","audio-recording-preview","audio-keep-recording","audio-record-again","audio-discard-recording","audio-library-items","audio-open-files","audio-add-to-project"]){
    assert.match(html,new RegExp(`id=["']${id}["']`));
  }
  assert.match(html,/shared Source Media Library/i);
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

test("all visible and native build identification is 0.12.0",()=>{
  assert.match(html,/Build 0\.12\.0 Development Testing Build/);
  assert.match(app,/Accessible Media Editor Build 0\.12\.0/);
  assert.match(rust,/Build 0\.12\.0 executable started/);
});
