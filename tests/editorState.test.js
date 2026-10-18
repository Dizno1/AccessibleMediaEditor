import test from "node:test";
import assert from "node:assert/strict";
import { clearEditorMarks, preserveMarksWhileChangingTarget, copiedTrackTarget, replacementDurationIssue } from "../app/editorState.js";

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
test("the Source target travels with copied media",()=>{
  assert.equal(copiedTrackTarget("Video","both"),"both");
  assert.equal(copiedTrackTarget("Video","video"),"video");
  assert.equal(copiedTrackTarget("Video","audio"),"audio");
  assert.equal(copiedTrackTarget("Audio","both"),"audio");
});
test("a shorter destination is detected before paste can truncate media",()=>{
  const issue=replacementDurationIssue(33.397,24.585);
  assert.equal(issue.copied,33.397);
  assert.equal(issue.destination,24.585);
  assert.ok(Math.abs(issue.excess-8.812)<0.000001);
  assert.equal(replacementDurationIssue(20,24.585),null);
  assert.equal(replacementDurationIssue(33.397,null),null);
});
