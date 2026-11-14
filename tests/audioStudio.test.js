import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { audioCollectionInfo, itemMatchesAudioArea, sortAudioItems } from "../app/audioStudio.js";

const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const studio=readFileSync(new URL("../app/audioStudio.js",import.meta.url),"utf8");
const app=readFileSync(new URL("../app/app.js",import.meta.url),"utf8");
const shortcuts=readFileSync(new URL("../app/shortcutService.js",import.meta.url),"utf8");
const rust=readFileSync(new URL("../src-tauri/src/main.rs",import.meta.url),"utf8");
const prepare=readFileSync(new URL("../scripts/prepare-dist.js",import.meta.url),"utf8");

test("Audio Editor exposes keyboard-operable recording, review, and shared-library controls",()=>{
  for(const id of ["audio-enable-microphone","audio-microphone-select","audio-recording-profile","audio-record-toggle","audio-record-pause","audio-recording-preview","audio-keep-recording","audio-record-again","audio-discard-recording","audio-library-collection","audio-library-items","audio-open-files","audio-open-folder","audio-edit-source","audio-add-to-project","audio-export-sources","audio-remove-sources","audio-editor-playhead","audio-editor-speed","audio-editor-play","audio-editor-mark-in","audio-editor-mark-out","audio-editor-goto","audio-editor-save-range","audio-silence-minimum","audio-silence-retain","audio-silence-threshold","audio-editor-shorten-silence"]){
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

test("Audio Editor records with MediaRecorder and handles missing microphone support",()=>{
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

test("recording shortcuts are app-wide but handlers act only in Audio Editor",()=>{
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

test("Alt S is contextual and the active workspace survives refresh",()=>{
  assert.match(app,/function focusWorkspaceSources\(\)/);
  assert.match(app,/activeWorkspace==="audio".*focusLibrary/s);
  assert.match(app,/ame-active-workspace/);
  assert.match(app,/switchWorkspace\(1,startupWorkspace\)/);
});

test("audio preview toggles and retained microphone permission is reused",()=>{
  assert.match(studio,/Stop Selected Audio Preview/);
  assert.match(studio,/Audio Source Library preview stopped/);
  assert.match(studio,/navigator\.permissions\.query\(\{name:"microphone"\}\)/);
  assert.match(studio,/permission\.state==="granted"/);
});

test("playback speed is available in AudioStudio and every Media Editor",()=>{
  assert.match(html,/id="audio-editor-speed"/);
  assert.match(studio,/editor\.playbackRate=playbackSpeed/);
  assert.match(app,/Playback speed/);
  assert.match(app,/media\.playbackRate=rate/);
  assert.match(app,/ame-playback-speed/);
});

test("long pauses are analyzed and shortened only in a confirmed new source",()=>{
  assert.match(studio,/invoke\("analyze_silence"/);
  assert.match(studio,/window\.confirm\(message\)/);
  assert.match(studio,/invoke\("render_working_edit"/);
  assert.match(studio,/Original sources unchanged/);
  assert.match(rust,/async fn analyze_silence/);
  assert.match(rust,/silencedetect=noise=/);
  assert.match(rust,/analyze_silence,render_working_edit/);
});

test("audiobook folders and multiple chapters are managed from Shared Audio Library",()=>{
  assert.match(html,/id="audio-library-items"[^>]*multiple/);
  assert.match(html,/Open Audiobook or Audio Folder/);
  assert.match(studio,/selectedOptions/);
  assert.match(studio,/importAudioFolder/);
  assert.match(studio,/removeLibraryAudio/);
  assert.match(app,/pick_audio_folder_files/);
  assert.match(rust,/fn pick_audio_folder_files/);
  assert.match(rust,/files\.sort_by/);
  assert.match(rust,/fn export_audio_files_to_folder/);
});

test("audiobooks use separate collections and natural chapter order",()=>{
  const book={collection:"My Book",collectionType:"audiobook"};
  assert.deepEqual(sortAudioItems([{...book,label:"Chapter 10"},{...book,label:"Chapter 2"},{...book,label:"Chapter 1"}]).map(item=>item.label),["Chapter 1","Chapter 2","Chapter 10"]);
  assert.equal(audioCollectionInfo({...book,label:"Chapter 1"}).label,"My Book");
  assert.equal(audioCollectionInfo({...book,label:"Chapter 1",silenceShortened:true}).label,"My Book - Shortened Pauses");
  assert.equal(audioCollectionInfo({label:"Music.mp3",collection:"Music"}).label,"Other Audio");
  assert.equal(audioCollectionInfo({label:"Voice note",collectionType:"recording"}).label,"Recordings");
  assert.match(studio,/visibleItems\(\)\.filter|visibleItems\(\)/);
  assert.match(app,/collectionType:"audiobook"/);
  assert.match(app,/!derived&&!entry\.silenceShortened/);
});

test("Audio Editor separates audio into accessible areas without moving source files",()=>{
  for(const area of ["audiobooks","music","recordings","other","all"])assert.match(html,new RegExp(`data-audio-area=["']${area}["']`));
  assert.equal(itemMatchesAudioArea({collectionType:"audiobook",label:"Chapter 1"},"audiobooks"),true);
  assert.equal(itemMatchesAudioArea({audioCategory:"music",label:"Song"},"music"),true);
  assert.equal(itemMatchesAudioArea({collectionType:"recording",label:"Voice note"},"recordings"),true);
  assert.equal(itemMatchesAudioArea({audioCategory:"other",label:"Sound effect"},"other"),true);
  assert.equal(itemMatchesAudioArea({label:"Legacy audio"},"all"),true);
  assert.match(studio,/No file was moved, duplicated, or edited/);
  assert.match(app,/function classifyAudioLibraryItems/);
  assert.match(html,/AccessibleAudioStudioPro is planned as a separate audio-focused application/);
});

test("all visible and native build identification is 0.12.12",()=>{
  assert.match(html,/Build 0\.12\.12 Development Testing Build/);
  assert.match(app,/Accessible Production Studio Build 0\.12\.12/);
  assert.match(rust,/Build 0\.12\.12 executable started/);
});

test("AudioStudio presents opening before the library and selected-item actions after it",()=>{
  const open=html.indexOf('id="audio-open-files"'),list=html.indexOf('id="audio-library-items"'),actions=html.indexOf('id="audio-preview-source"');
  assert.ok(open<list&&list<actions);
  assert.match(html,/id="audio-open-folder">Open Audiobook or Audio Folder</);
  assert.match(shortcuts,/openCurrentWorkspace.*ctrl:true,key:"o"/s);
  assert.match(shortcuts,/openWorkspaceCollection.*ctrl:true,shift:true,key:"o"/s);
  assert.match(app,/openWorkspaceCollection:showStructuredOpen/);
  assert.doesNotMatch(shortcuts,/openAudioFolder/);
});

test("structured opening works from every workspace and routes to the correct editor",()=>{
  assert.match(html,/id="structured-open-dialog"/);
  assert.match(html,/id="structured-open-project"/);
  assert.match(html,/id="structured-open-audiobook"/);
  assert.match(app,/function showStructuredOpen\(\)/);
  assert.match(app,/showStructuredOpen\(\).*structured-open-project.*focus\(\)/s);
  assert.doesNotMatch(app,/activeWorkspace==="audio"\?el\["structured-open-audiobook"\]/);
  assert.match(app,/function openStructuredProject\(\).*openProject\(\)/s);
  assert.match(app,/function openStructuredAudiobook\(\).*switchWorkspace\(1,"audio"\).*openFolder\(\)/s);
  assert.match(app,/async function importAudioStudioFiles\([^)]*\).*projectPaths.*open_project_path.*applyOpenedProject/s);
  assert.match(rust,/"Open Project\.\.\.","openProject"/);
  assert.match(rust,/"Open Audiobook or Audio Folder\.\.\.","openAudioFolder"/);
});

test("F1 provides concise instructions and an expandable complete shortcut reference",()=>{
  assert.match(html,/id="shortcut-key-list-toggle" aria-expanded="false" aria-controls="shortcut-key-list"/);
  assert.match(html,/id="shortcut-key-list" hidden/);
  assert.match(html,/Ctrl\+Shift\+O: Open a choice between an editable AMEPROJECT and an audiobook or audio folder/);
  assert.match(app,/function toggleShortcutKeyList\(\)/);
  assert.match(app,/showShortcuts:.*shortcut-key-list-toggle.*focus\(\)/s);
});

test("Shared Audio Library reports individual and aggregate selection changes",()=>{
  assert.match(html,/id="audio-library-selection-status"/);
  assert.match(studio,/selected\. \$\{count\} audio/);
  assert.match(studio,/unselected\. \$\{count/);
  assert.match(studio,/All \$\{selectionSnapshot\.size\} audio files selected/);
  assert.match(studio,/event\.key==="Delete"/);
  assert.match(studio,/event\.key==="Enter"/);
});

test("audiobook imports recover from direct metadata failure and retain exact failure reports",()=>{
  assert.match(app,/could not be measured directly\. Preparing a compatible working copy/);
  assert.match(app,/failed\.push\(\{path,name,reason/);
  assert.match(app,/retryAudioStudioFiles/);
  assert.match(html,/Review Last Import Results/);
  assert.match(html,/Retry Failed Chapters/);
  assert.match(studio,/failure\.name.*failure\.reason/s);
});

test("playback position is quiet while playing and speed has direct shortcuts",()=>{
  assert.match(studio,/updateEditor\(false\)/);
  assert.match(studio,/function adjustPlaybackSpeed/);
  assert.match(shortcuts,/slowerPlayback.*key:","/);
  assert.match(shortcuts,/fasterPlayback.*key:"\."/);
  assert.match(app,/adjustMediaPlaybackSpeed/);
  assert.match(html,/Press Comma to decrease playback speed or Period to increase playback speed/);
  assert.match(studio,/saved automatically to the Shared Audio Library/);
});

test("audio playhead time, preview resume, batch silence processing, and long import progress are accessible",()=>{
  assert.match(studio,/aria-valuetext.*naturalTime/);
  assert.match(studio,/Preview resumed at/);
  assert.match(studio,/Still analyzing chapter/);
  assert.match(studio,/for\(const \[index,item\] of items\.entries\(\)\)/);
  assert.match(app,/Still preparing chapter/);
  assert.match(app,/Completed chapter/);
  assert.match(app,/function audioCanOpenDirectly/);
  assert.match(app,/Opening directly from its folder/);
  assert.match(app,/setInterval.*30000/);
});
