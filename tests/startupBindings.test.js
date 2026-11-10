import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const app=readFileSync(new URL("../app/app.js",import.meta.url),"utf8");
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const rust=readFileSync(new URL("../src-tauri/src/main.rs",import.meta.url),"utf8");
const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
test("all statically referenced UI element IDs exist",()=>{
  const referenced=[...app.matchAll(/\bel\["([^"]+)"\]/g)].map(m=>m[1]);
  assert.deepEqual([...new Set(referenced.filter(id=>!ids.has(id)))],[]);
});
test("new presentation command exists and is wired",()=>{
  assert.match(html,/id="presentation-new"/);
  assert.match(app,/el\["presentation-new"\]\.addEventListener\("click",newPresentation\)/);
});
test("presentation workspace exposes project save and save as controls",()=>{
  assert.match(html,/id="presentation-open"[^>]*>Open Presentation Project \(Ctrl\+Shift\+O\)/);
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
test("decimal time entry never exposes floating point spin box limits",()=>{
  for(const id of ["presentation-bulk-transition-duration","presentation-opening-duration","presentation-closing-duration","presentation-slide-duration","presentation-title-duration","presentation-item-duration","presentation-transition-duration","item-duration","text-duration"]){
    assert.match(html,new RegExp(`<input[^>]*type="text"[^>]*id="${id}"|<input[^>]*id="${id}"[^>]*type="text"`));
  }
  assert.match(app,/function editableSeconds\(seconds\)/);
  assert.match(app,/setAttribute\("aria-valuetext",readableTime\(state\.cursor\)\)/);
});

test("attached audio uses the complete persistent and project audio collection",()=>{
  assert.match(app,/function presentationAudioSources\(\)/);
  assert.match(app,/return \[\.\.\.libraryItems,\.\.\.sources\]\.filter/);
  assert.match(app,/function showCreateTitleSlide\(\)[\s\S]*const sources=presentationAudioSources\(\)/);
  assert.match(app,/const audioSources=presentationAudioSources\(\)/);
  assert.match(app,/const audio=presentationAudioSources\(\)\.find\(source=>source\.id===el\["presentation-still-audio"\]\.value\)/);
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
