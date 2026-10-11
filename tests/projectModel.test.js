import test from "node:test";
import assert from "node:assert/strict";
import { createProject, addItem, moveItem, removeItem, updateItem, addSource, updateSource, appendSourceSelection, insertSourceSelection, splitItem, itemDuration, duration, serializable, logicalToSourceTime, sourceToLogicalTime, removeLogicalRange, bracketSelectionRange } from "../app/projectModel.js";
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
test("source media is excluded from output duration until inserted",()=>{
  const primary=addItem(createProject(),item("primary",10));
  const withSource=addSource(primary,{...item("source",4),inPoint:1,outPoint:3});
  assert.equal(duration(withSource),10); assert.equal(withSource.sources.length,1);
  const inserted=appendSourceSelection(withSource,withSource.sources[0],"inserted");
  assert.equal(duration(inserted),12);
});
test("a source selection inserts at the primary playhead nondestructively",()=>{
  const primary=addItem(createProject(),{...item("primary",10),inPoint:0,outPoint:10});
  const source={...item("source",8),inPoint:2,outPoint:5};
  const result=insertSourceSelection(primary,"primary",4,source,"first","inserted","second");
  assert.deepEqual(result.items.map(value=>value.id),["first","inserted","second"]);
  assert.equal(duration(result),13); assert.equal(primary.items.length,1);
});
test("committed edits remove a logical range while preserving the original source",()=>{
  const primary=addItem(createProject(),{...item("primary",10),inPoint:0,outPoint:10,editSegments:[{start:0,end:10}]});
  const edited=removeLogicalRange(primary,"primary",3,6);
  assert.deepEqual(edited.items[0].editSegments,[{start:0,end:3},{start:6,end:10}]);
  assert.equal(itemDuration(edited.items[0]),7);
  assert.equal(edited.items[0].source,"C:/primary.mp4");
  assert.equal(logicalToSourceTime(edited.items[0],4),7);
  assert.equal(sourceToLogicalTime(edited.items[0],7),4);
});
test("a lone Left Bracket selects everything to its right",()=>{
  const primary=addItem(createProject(),{...item("primary",10),editSegments:[{start:0,end:10}]});
  const range=bracketSelectionRange(10,4.25,null);
  assert.deepEqual(range,{from:4.25,to:10,kind:"ending"});
  const edited=removeLogicalRange(primary,"primary",range.from,range.to);
  assert.deepEqual(edited.items[0].editSegments,[{start:0,end:4.25}]);
  assert.equal(itemDuration(edited.items[0]),4.25);
});
test("a lone Right Bracket selects everything to its left",()=>{
  const primary=addItem(createProject(),{...item("primary",10),editSegments:[{start:0,end:10}]});
  const range=bracketSelectionRange(10,null,4.25);
  assert.deepEqual(range,{from:0,to:4.25,kind:"beginning"});
  const edited=removeLogicalRange(primary,"primary",range.from,range.to);
  assert.deepEqual(edited.items[0].editSegments,[{start:4.25,end:10}]);
  assert.equal(itemDuration(edited.items[0]),5.75);
});
test("paired brackets select only the content between them",()=>{
  assert.deepEqual(bracketSelectionRange(10,2.125,7.875),{from:2.125,to:7.875,kind:"between"});
});
test("a Source edit changes only its nondestructive working timeline",()=>{
  const original={...item("source",10),originalSource:"C:/original-source.mp4",editSegments:[{start:0,end:10}]};
  const project=addSource(createProject(),original);
  const range=bracketSelectionRange(10,null,3.25);
  const edited=removeLogicalRange(project,"source",range.from,range.to,true);
  assert.deepEqual(edited.sources[0].editSegments,[{start:3.25,end:10}]);
  assert.equal(itemDuration(edited.sources[0]),6.75);
  assert.equal(edited.sources[0].originalSource,"C:/original-source.mp4");
});
