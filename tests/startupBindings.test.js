import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const app=readFileSync(new URL("../app/app.js",import.meta.url),"utf8");
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
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
test("presentation builder puts the editable timeline before the source library",()=>{
  assert.match(html,/id="presentation-builder-section"/);
  assert.doesNotMatch(html,/id="presentation-library-section"/);
  const sourcePosition=html.indexOf('id="presentation-sources"');
  const sequencePosition=html.indexOf('id="presentation-items"');
  assert.ok(sequencePosition>0&&sourcePosition>sequencePosition);
  assert.match(html,/id="presentation-choose-source"/);
  assert.match(app,/el\["presentation-choose-source"\]\.addEventListener/);
});
test("presentation sequence exposes Cut Copy and Paste with keyboard routing",()=>{
  assert.match(html,/id="presentation-cut"[^>]*>Cut Selected Items \(Ctrl\+X\)/);
  assert.match(html,/id="presentation-copy"[^>]*>Copy Selected Items \(Ctrl\+C\)/);
  assert.match(html,/id="presentation-paste"[^>]*>Paste Before Current Item \(Ctrl\+V\)/);
  assert.match(app,/function copyPresentation\(cut=false\)/);
  assert.match(app,/function pastePresentation\(\)/);
  assert.match(app,/cutMedia:cutMediaAction,copyMedia:copyMediaAction,pasteMedia:pasteMediaAction/);
  assert.match(app,/moveEarlier:\(\)=>activeWorkspace==="presentation"\?movePresentation\(-1\)/);
  assert.match(app,/removeItem:\(\)=>activeWorkspace==="presentation"\?removePresentation\(\):removeActive\(\)/);
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
