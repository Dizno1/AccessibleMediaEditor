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

test("critical editor functions required by startup and media import are defined",()=>{
  for(const name of ["saveSourceClip","renderEditorNavigation","updateActiveAppearance","activateMedia"]){
    assert.match(app,new RegExp(`function ${name}\\(`),`${name} must exist`);
  }
});
