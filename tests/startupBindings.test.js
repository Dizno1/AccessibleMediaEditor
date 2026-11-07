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
  assert.match(html,/id="presentation-save"[^>]*>Save Presentation Project \(Ctrl\+S\)/);
  assert.match(html,/id="presentation-save-as"[^>]*>Save Presentation Project As \(Ctrl\+Shift\+S\)/);
  assert.match(app,/el\["presentation-save"\]\.addEventListener\("click",\(\)=>saveProject\(false\)\)/);
  assert.match(app,/el\["presentation-save-as"\]\.addEventListener\("click",\(\)=>saveProject\(true\)\)/);
});
test("presentation builder places sources and sequence in one task-oriented section",()=>{
  assert.match(html,/id="presentation-builder-section"/);
  assert.doesNotMatch(html,/id="presentation-library-section"/);
  const sourcePosition=html.indexOf('id="presentation-sources"');
  const sequencePosition=html.indexOf('id="presentation-items"');
  assert.ok(sourcePosition>0&&sequencePosition>sourcePosition);
  assert.match(html,/id="presentation-choose-source"/);
  assert.match(app,/el\["presentation-choose-source"\]\.addEventListener/);
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
