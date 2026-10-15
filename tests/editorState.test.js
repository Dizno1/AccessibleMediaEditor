import test from "node:test";
import assert from "node:assert/strict";
import { clearEditorMarks, preserveMarksWhileChangingTarget } from "../app/editorState.js";

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
