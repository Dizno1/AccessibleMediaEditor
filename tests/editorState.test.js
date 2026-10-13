import test from "node:test";
import assert from "node:assert/strict";
import { clearEditorMarks } from "../app/editorState.js";

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
