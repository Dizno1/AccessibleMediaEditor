import test from "node:test";
import assert from "node:assert/strict";
import { createProject, addItem, moveItem, removeItem, updateItem, splitItem, itemDuration, duration, serializable } from "../app/projectModel.js";
const item = (id, seconds=1) => ({id, name:id, kind:"Video", source:"C:/"+id+".mp4", duration:seconds});
test("items add, move, update, and remove without mutating earlier states", () => {
  const empty=createProject(); const a=addItem(empty,item("a",2)); const b=addItem(a,item("b",3)); const moved=moveItem(b,"b",-1);
  assert.deepEqual(moved.items.map(i=>i.id),["b","a"]); assert.deepEqual(b.items.map(i=>i.id),["a","b"]);
  const changed=updateItem(moved,"b",{duration:5}); assert.equal(duration(changed),7);
  assert.deepEqual(removeItem(changed,"b").items.map(i=>i.id),["a"]); assert.equal(empty.items.length,0);
});
test("saved project excludes transient path and dirty state",()=>{ const value=serializable({...createProject("Demo"),path:"C:/Demo.odmep",dirty:true}); assert.equal(value.path,undefined); assert.equal(value.dirty,undefined); });
test("media duration honors millisecond-precision In and Out points",()=>{
  const clip={...item("clip",10),inPoint:1.125,outPoint:8.875};
  assert.equal(itemDuration(clip),7.75);
  assert.equal(duration(addItem(createProject(),clip)),7.75);
});
test("a clip splits nondestructively at an exact point",()=>{
  const source=addItem(createProject(),{...item("clip",10),inPoint:1,outPoint:9});
  const result=splitItem(source,"clip",4.25,"second");
  assert.equal(result.items.length,2); assert.equal(result.items[0].outPoint,4.25); assert.equal(result.items[1].inPoint,4.25);
  assert.equal(duration(result),8);
});
