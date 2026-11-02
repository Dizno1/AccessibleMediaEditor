import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const app=readFileSync(new URL("../app/app.js",import.meta.url),"utf8");
test("saving a clip returns focus to its Save Selection button rather than the editor section",()=>{
  const clipFunction=app.slice(app.indexOf("function saveSourceClip(){"),app.indexOf("function sectionElements(){"));
  assert.match(clipFunction,/updated\.saveClip\.focus\(\)/);
  assert.doesNotMatch(clipFunction,/updated\.section\.focus\(\)/);
});
