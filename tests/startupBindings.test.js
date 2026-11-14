import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const app=readFileSync(new URL("../app/app.js",import.meta.url),"utf8");
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const rust=readFileSync(new URL("../src-tauri/src/main.rs",import.meta.url),"utf8");
const tauri=readFileSync(new URL("../src-tauri/tauri.conf.json",import.meta.url),"utf8");
const projectModel=readFileSync(new URL("../app/projectModel.js",import.meta.url),"utf8");
const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
test("visual condensation preserves Virtual PC Cursor off keyboard targets",()=>{
  assert.match(html,/class="visual-disclosure-toggle" tabindex="-1" aria-expanded="false"/);
  assert.doesNotMatch(html,/<details|<summary/);
  assert.match(app,/\.visual-disclosure-toggle/);
});
test("transition rendering is not restricted to half of either neighboring item",()=>{
  assert.doesNotMatch(rust,/joined_duration\/2\.0|next_duration\/2\.0/);
  assert.match(rust,/requested\.min\(joined_duration\)\.min\(next_duration\)/);
  assert.match(app,/available transition duration at this position/);
});
test("presentation direct-focus commands are native Windows accelerators and web shortcuts",()=>{
  assert.match(rust,/"Presentation Timeline Alt\+P","focusPresentationTimeline","Alt\+P"/);
  assert.match(rust,/"Source Media Library Alt\+S","focusPresentationSources","Alt\+S"/);
  assert.match(app,/focusPresentationTimeline,focusPresentationSources/);
});
test("opening and closing effects incorporate boundary item durations",()=>{
  assert.match(rust,/opening_extra=\(opening_duration-first_duration\)\.max\(0\.0\)/);
  assert.match(rust,/closing_extra=\(closing_duration-last_duration\)\.max\(0\.0\)/);
  assert.match(rust,/opening_extra\+joined_duration\+closing_extra/);
  assert.match(rust,/tpad=start_mode=clone:start_duration/);
  assert.match(rust,/\[aopensilence\].*concat=n=2:v=0:a=1\[aopenbase\]/);
  assert.match(rust,/\[aopenbase\]afade=t=in:st=/);
  assert.match(rust,/tpad=stop_mode=clone:stop_duration/);
  assert.match(rust,/\[musicsilence\]\[musicbody\]concat=n=2:v=0:a=1\[musicdelayed\]/);
  assert.match(rust,/range\.start\+opening_extra/);
  assert.match(rust,/\[mixed\]afade=t=out:st=/);
  assert.match(rust,/afade=t=out:st=/);
});
test("the current build and copyright are available inside the interface",()=>{
  assert.match(html,/Build 0\.12\.12 Development Testing Build\. Copyright 2026 Open Door Design\./);
  assert.match(app,/Accessible Production Studio Build 0\.12\.12 Development Testing Build/);
});
test("the product rename preserves existing projects and application data",()=>{
  assert.match(tauri,/"productName": "Accessible Production Studio"/);
  assert.match(tauri,/"identifier": "org\.opendoordesign\.accessiblemediaeditor"/);
  assert.match(projectModel,/Open Door Design Accessible Media Editor Project/);
  assert.match(rust,/join\("Accessible Media Editor"\)/);
});
test("all statically referenced UI element IDs exist",()=>{
  const referenced=[...app.matchAll(/\bel\["([^"]+)"\]/g)].map(m=>m[1]);
  assert.deepEqual([...new Set(referenced.filter(id=>!ids.has(id)))],[]);
});
test("new presentation command exists and is wired",()=>{
  assert.match(html,/id="presentation-new"/);
  assert.match(app,/el\["presentation-new"\]\.addEventListener\("click",newPresentation\)/);
});
test("presentation workspace exposes project save and save as controls",()=>{
  assert.match(html,/id="presentation-open"[^>]*>Open Presentation Project</);
  assert.match(html,/id="presentation-save"[^>]*>Save Presentation Project \(Ctrl\+S\)/);
  assert.match(html,/id="presentation-save-as"[^>]*>Save Presentation Project As \(Ctrl\+Shift\+S\)/);
  assert.match(app,/el\["presentation-save"\]\.addEventListener\("click",\(\)=>saveProject\(false\)\)/);
  assert.match(app,/el\["presentation-save-as"\]\.addEventListener\("click",\(\)=>saveProject\(true\)\)/);
  assert.match(app,/el\["presentation-open"\]\.addEventListener\("click",openProject\)/);
});
test("an AMEPROJECT selected through Open Media is redirected to project opening",()=>{
  assert.match(app,/const projectPaths=paths\.filter/);
  assert.match(app,/invoke\("open_project_path",\{path:projectPaths\[0\]\}\)/);
  assert.match(app,/applyOpenedProject\(result\)/);
});
test("opening a presentation project switches workspace and focuses its timeline",()=>{
  const opening=app.slice(app.indexOf("function applyOpenedProject("),app.indexOf("async function openProject("));
  assert.match(opening,/presentationProject=presentationItems\(\)\.length>0/);
  assert.match(opening,/switchWorkspace\(1,"presentation"\)/);
  assert.match(opening,/el\["presentation-items"\]\.focus\(\)/);
  assert.match(opening,/switchWorkspace\(1,"media"\)/);
});
test("presentation builder places the active timeline before the source library",()=>{
  assert.match(html,/id="presentation-builder-section"/);
  assert.doesNotMatch(html,/id="presentation-library-section"/);
  const sourcePosition=html.indexOf('id="presentation-sources"');
  const sequencePosition=html.indexOf('id="presentation-items"');
  assert.ok(sequencePosition>0&&sourcePosition>sequencePosition);
  assert.match(html,/id="presentation-choose-source"/);
  assert.match(app,/el\["presentation-choose-source"\]\.addEventListener/);
  assert.match(html,/id="presentation-go-timeline"/);
  assert.match(app,/el\["presentation-go-timeline"\]\.addEventListener/);
});
test("presentation provides a synchronized visual timeline for mouse users",()=>{
  assert.match(html,/id="presentation-visual-timeline"[^>]*aria-hidden="true"/);
  assert.match(app,/function renderPresentationVisualTimeline\(items\)/);
  assert.match(app,/presentation-visual-card/);
  assert.match(app,/el\["presentation-visual-timeline"\]\.addEventListener\("click"/);
  for(const action of ["select","earlier","later","edit","remove"])assert.match(app,new RegExp(`\\["${action}"`));
});
test("presentation sequence exposes Cut Copy and Paste with keyboard routing",()=>{
  assert.match(html,/id="presentation-cut"[^>]*>Cut Current or Selected Items \(Ctrl\+X\)/);
  assert.match(html,/id="presentation-copy"[^>]*>Copy Current or Selected Items \(Ctrl\+C\)/);
  assert.match(html,/id="presentation-paste"[^>]*>Paste Before Current Item \(Ctrl\+V\)/);
  assert.match(app,/function copyPresentation\(cut=false\)/);
  assert.match(app,/function pastePresentation\(\)/);
  assert.match(app,/cutMedia:cutMediaAction,copyMedia:copyMediaAction,pasteMedia:pasteMediaAction/);
  assert.match(app,/moveEarlier:\(\)=>activeWorkspace==="presentation"\?movePresentation\(-1\)/);
  assert.match(app,/removeItem:\(\)=>activeWorkspace==="presentation"\?removePresentation\(\):removeActive\(\)/);
});

test("presentation provides direct timeline and source library navigation",()=>{
  assert.match(app,/function focusPresentationTimeline\(\)/);
  assert.match(app,/function focusPresentationSources\(\)/);
  assert.match(app,/focusPresentationTimeline,focusPresentationSources/);
});
test("native crossfade menu edits the selected presentation item",()=>{assert.match(app,/function addPresentationCrossfade\(\)/);assert.match(app,/addTransition:\(\)=>activeWorkspace==="presentation"\?addPresentationCrossfade\(\):addTransition\(\)/);});

test("presentation transitions can be applied to current or selected timeline items",()=>{
  assert.match(html,/id="presentation-bulk-transition-duration"/);
  assert.match(html,/id="presentation-bulk-transition-apply"/);
  assert.match(html,/id="presentation-bulk-transition-remove"/);
  assert.match(app,/function applyPresentationTransition\(remove=false\)/);
  assert.match(app,/presentation-bulk-transition-apply/);
});
test("presentation exposes opening closing and editable title slide controls",()=>{
  for(const id of ["presentation-opening-effect","presentation-closing-effect","presentation-effects-apply","presentation-title-property-fields","presentation-edit-title"])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(app,/function applyPresentationEffects\(\)/);
  assert.match(app,/async function renderTitleSlideImage/);
  assert.match(app,/Title slide \$\{title\} created at position/);
  assert.match(rust,/opening_effect_type/);
  assert.match(rust,/fade=t=in/);
  assert.match(rust,/fade=t=out/);
});
test("opening and closing effects return focus to the first timeline item",()=>{
  const effects=app.slice(app.indexOf("function applyPresentationEffects("),app.indexOf("function addPresentationSource("));
  assert.match(effects,/const first=next\.presentation\.items\[0\]/);
  assert.match(effects,/el\["presentation-items"\]\.value=first\.id/);
  assert.match(effects,/el\["presentation-items"\]\.focus\(\)/);
});
test("presentation join normalizes every intermediate stream before transitions",()=>{
  assert.match(rust,/fps=30,scale=1280:720,format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS\[vin/);
  assert.match(rust,/aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS\[ain/);
  assert.match(rust,/Joining rendered presentation items failed/);
});
test("decimal time entry never exposes floating point spin box limits",()=>{
  for(const id of ["presentation-bulk-transition-duration","presentation-opening-duration","presentation-closing-duration","presentation-slide-duration","presentation-title-duration","presentation-item-duration","presentation-transition-duration","item-duration","text-duration"]){
    assert.match(html,new RegExp(`<input[^>]*type="text"[^>]*id="${id}"|<input[^>]*id="${id}"[^>]*type="text"`));
  }
  assert.match(app,/function editableSeconds\(seconds\)/);
  assert.match(app,/if\(expose\)state\.slider\.setAttribute\("aria-valuetext",readableTime\(next\)\)/);
});

test("attached audio uses the complete persistent and project audio collection",()=>{
  assert.match(app,/function presentationAudioSources\(\)/);
  assert.match(app,/return \[\.\.\.libraryItems,\.\.\.sources\]\.filter/);
  assert.match(app,/function showCreateTitleSlide\(\)[\s\S]*const sources=presentationAudioSources\(\)/);
  assert.match(app,/const audioSources=presentationAudioSources\(\)/);
  assert.match(app,/audio=presentationAudioSources\(\)\.find\(source=>source\.id===el\["presentation-still-audio"\]\.value\)/);
});

test("matched attached audio supplies and controls the visual duration",()=>{
  assert.match(app,/async function resolveAudioDuration\(audio\)/);
  assert.match(app,/if\(match\)\{try\{duration=await resolveAudioDuration\(audio\)/);
  assert.match(app,/if\(!match&&\(!Number\.isFinite\(value\)/);
  assert.match(app,/visualDuration=await resolveAudioDuration\(audio\)/);
  assert.match(app,/function updateAttachedAudioDurationControl\(durationField,audioField,matchField\)/);
  assert.match(app,/el\[durationField\]\.disabled=matched/);
  assert.match(app,/presentation-still-match-audio"\]\.addEventListener\("change"/);
});

test("opening item properties reads retained edit segment boundaries",()=>{
  assert.match(app,/function showPresentationItemProperties\(\).*segments=normalizedSegments\(item\),singleSegment=segments\.length===1/);
  assert.match(app,/writeTime\("presentation-start",singleSegment\?segments\[0\]\.start:0\)/);
  assert.match(app,/writeTime\("presentation-end",singleSegment\?segments\[0\]\.end:0\)/);
});

test("presentation rendering announces immediately and accepts native progress events",()=>{
  assert.match(app,/function showExportProgress\(message\)[\s\S]*queueExportAnnouncement\(message\)/);
  assert.match(app,/async function previewPresentation\(\)[\s\S]*exportPhase="rendering"/);
  assert.match(app,/async function exportPresentation\(\)[\s\S]*exportPhase="rendering"/);
});

test("instructions and keyboard shortcuts are app-wide and explain screen reader modes",()=>{
  assert.match(html,/id="instructions-shortcuts-button"/);
  assert.match(app,/el\["instructions-shortcuts-button"\]\.addEventListener\("click",actions\.showShortcuts\)/);
  assert.match(html,/NVDA\+Space to enter Focus Mode/);
  assert.match(html,/Insert\+Z to turn the Virtual PC Cursor off/);
  assert.match(html,/Narrator\+Space to turn Scan Mode off/);
});

test("critical editor functions required by startup and media import are defined",()=>{
  for(const name of ["saveSourceClip","renderEditorNavigation","updateActiveAppearance","activateMedia"]){
    assert.match(app,new RegExp(`function ${name}\\(`),`${name} must exist`);
  }
});
