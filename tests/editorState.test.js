import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { clearEditorMarks, preserveMarksWhileChangingTarget, replacementDurationIssue, primaryPasteOperation } from "../app/editorState.js";

test("completed operations clear brackets and their undo history",()=>{
  const state={cursor:12.345,markIn:3,markOut:8,markHistory:[{which:"in",previous:null},{which:"out",previous:null}]};
  assert.equal(clearEditorMarks(state),true);
  assert.equal(state.markIn,null);
  assert.equal(state.markOut,null);
  assert.deepEqual(state.markHistory,[]);
  assert.equal(state.cursor,12.345);
});

test("clearing an editor without brackets is safe",()=>{
  const state={cursor:4,markIn:null,markOut:null,markHistory:[]};
  assert.equal(clearEditorMarks(state),false);
  assert.deepEqual(state,{cursor:4,markIn:null,markOut:null,markHistory:[]});
  assert.equal(clearEditorMarks(null),false);
});
test("changing A V or B target preserves both active brackets and playhead",()=>{
  const state={cursor:11.817,markIn:11.817,markOut:null,markHistory:[{which:"in",previous:null}],trackTarget:"both"};
  assert.equal(preserveMarksWhileChangingTarget(state,"audio"),true);
  assert.equal(state.cursor,11.817);
  assert.equal(state.markIn,11.817);
  assert.equal(state.markOut,null);
  assert.deepEqual(state.markHistory,[{which:"in",previous:null}]);
  assert.equal(state.trackTarget,"audio");
});
test("a shorter destination is detected before paste can truncate media",()=>{
  const issue=replacementDurationIssue(33.397,24.585);
  assert.equal(issue.copied,33.397);
  assert.equal(issue.destination,24.585);
  assert.ok(Math.abs(issue.excess-8.812)<0.000001);
  assert.equal(replacementDurationIssue(20,24.585),null);
  assert.equal(replacementDurationIssue(33.397,null),null);
});
test("Ctrl+V inserts without a selected range and replaces one continuous selected range",()=>{
  assert.equal(primaryPasteOperation(null),"insert");
  assert.equal(primaryPasteOperation({kind:"empty",selectedRanges:[]}),"insert");
  assert.equal(primaryPasteOperation({kind:"inside",selectedRanges:[{from:5,to:7}]}),"replace");
  assert.equal(primaryPasteOperation({kind:"outside",selectedRanges:[{from:0,to:2},{from:8,to:10}]}),"reject");
});
test("export completion uses a focused path dialog for screen readers",()=>{
  const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
  const app=fs.readFileSync(new URL("../app/app.js",import.meta.url),"utf8");
  assert.match(html,/id="export-success-dialog"[^>]*aria-labelledby="export-success-heading"[^>]*aria-describedby="export-success-path"/);
  assert.match(html,/id="export-success-path" tabindex="-1"/);
  assert.match(app,/el\["export-success-path"\]\.focus\(\)/);
  assert.match(app,/Complete production saved to \$\{path\}/);
});
