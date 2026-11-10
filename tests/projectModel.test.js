import test from "node:test";
import assert from "node:assert/strict";
import { createProject, addItem, moveItem, removeItem, updateItem, addSource, updateSource, moveSource, appendImageSlideshow, createInterleavedPresentation, presentationDuckRanges, makeSourcePrimary, appendSourceSelection, insertSourceSelection, splitItem, itemDuration, duration, serializable, logicalToSourceTime, sourceToLogicalTime, removeLogicalRange, removeLogicalRanges, bracketSelectionRange, bracketSelectionPlan, logicalSegmentsForRanges, productionRenderItems, addTrackReplacement, removeTrackReplacement, productionRenderReplacements, productionRenderBackgroundMusic } from "../app/projectModel.js";
import { shortcuts } from "../app/shortcutService.js";
const item = (id, seconds=1) => ({id, name:id, kind:"Video", source:"C:/"+id+".mp4", duration:seconds});
test("a presentation interleaves video and ducks continuous music",()=>{const p=createProject(),slides=[1,2,3].map(n=>({image:{id:`i${n}`,name:`Image ${n}`,kind:"Image",source:`C:/i${n}.jpg`},duration:5})),video=item("dogs",2),music={id:"music",name:"Music",kind:"Audio",source:"C:/music.mp3",duration:20};const next=createInterleavedPresentation(p,slides,["a","b","c"],video,["v1","v2"],music,true);assert.deepEqual(next.items.map(x=>x.kind),["Image","Video","Image","Video","Image"]);assert.equal(duration(next),19);assert.equal(productionRenderBackgroundMusic(next).duckRanges.length,2);});
test("presentation ducking follows video and audio items but not still images",()=>{const items=[{...item("video",3)},{id:"image",name:"image",kind:"Image",duration:5},{id:"audio",name:"audio",kind:"Audio",duration:2}];assert.deepEqual(presentationDuckRanges(items),[{start:0,end:3},{start:8,end:10}]);});
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
test("copying uses the content between two brackets",()=>{
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
test("an edited Source pause converts original media time back to edited timeline time",()=>{
  const source={...item("source",240.767),editSegments:[{start:10.417,end:240.767}]};
  const logical=sourceToLogicalTime(source,23.464);
  assert.ok(Math.abs(logical-13.047)<0.000001);
  assert.ok(Math.abs(logicalToSourceTime(source,logical)-23.464)<0.000001);
});
test("Undo and Redo are registered keyboard shortcuts rather than menu labels only",()=>{
  assert.ok(shortcuts.some(([name,key])=>name==="undo"&&key.ctrl&&key.key==="z"));
  assert.ok(shortcuts.some(([name,key])=>name==="redo"&&key.ctrl&&key.key==="y"));
});
test("precision scrubbing avoids Chromium View Source and Developer Tools shortcuts",()=>{
  assert.ok(shortcuts.some(([name,key])=>name==="scrubBack10ms"&&key.ctrl&&key.alt&&key.key==="u"));
  assert.ok(shortcuts.some(([name,key])=>name==="scrubForward10ms"&&key.ctrl&&key.alt&&key.key==="i"));
  assert.ok(!shortcuts.some(([name,key])=>["scrubBack10ms","scrubForward10ms"].includes(name)&&key.ctrl&&key.shift));
});
test("all four logical bracket arrangements produce the intended selection plan",()=>{
  assert.deepEqual(bracketSelectionPlan(10,4,null),{kind:"ending",selectedRanges:[{from:4,to:10}]});
  assert.deepEqual(bracketSelectionPlan(10,null,4),{kind:"beginning",selectedRanges:[{from:0,to:4}]});
  assert.deepEqual(bracketSelectionPlan(10,2,7),{kind:"inside",selectedRanges:[{from:2,to:7}],unselectedRange:null});
  assert.deepEqual(bracketSelectionPlan(10,7,2),{kind:"outside",selectedRanges:[{from:0,to:2},{from:7,to:10}],unselectedRange:{from:2,to:7}});
});
test("inward-facing brackets select both ends so deletion retains only the middle",()=>{
  const primary=addItem(createProject(),{...item("primary",10),editSegments:[{start:0,end:10}]});
  const plan=bracketSelectionPlan(10,7,2);
  const edited=removeLogicalRanges(primary,"primary",plan.selectedRanges);
  assert.deepEqual(edited.items[0].editSegments,[{start:2,end:7}]);
  assert.equal(itemDuration(edited.items[0]),5);
});
test("inward-facing Source brackets select both ends and preserve the unselected middle",()=>{
  const project=addSource(createProject(),{...item("source",12),originalSource:"C:/source-original.mp4",editSegments:[{start:0,end:12}]});
  const plan=bracketSelectionPlan(12,9,3);
  const edited=removeLogicalRanges(project,"source",plan.selectedRanges,true);
  assert.deepEqual(edited.sources[0].editSegments,[{start:3,end:9}]);
  assert.equal(edited.sources[0].originalSource,"C:/source-original.mp4");
});
test("copying an inward Source selection copies both selected ends in timeline order",()=>{
  const source={...item("source",12),editSegments:[{start:0,end:12}]};
  const plan=bracketSelectionPlan(12,9,3);
  const segments=logicalSegmentsForRanges(source,plan.selectedRanges);
  assert.deepEqual(segments,[{start:0,end:3},{start:9,end:12}]);
  assert.equal(segments.reduce((sum,segment)=>sum+segment.end-segment.start,0),6);
});
test("copying inward and single-bracket selections uses the same selected ranges as deletion",()=>{
  const source={...item("source",10),editSegments:[{start:0,end:10}]};
  assert.deepEqual(logicalSegmentsForRanges(source,bracketSelectionPlan(10,2,7).selectedRanges),[{start:2,end:7}]);
  assert.deepEqual(logicalSegmentsForRanges(source,bracketSelectionPlan(10,4,null).selectedRanges),[{start:4,end:10}]);
  assert.deepEqual(logicalSegmentsForRanges(source,bracketSelectionPlan(10,null,4).selectedRanges),[{start:0,end:4}]);
});
test("a Source can become Primary while the old Primary becomes a Source",()=>{
  const original=addItem(createProject(),{...item("original",8),role:"primary",editSegments:[{start:1,end:8}]});
  const project=addSource(original,{...item("replacement",5),role:"source",editSegments:[{start:0,end:4}]});
  const swapped=makeSourcePrimary(project,"replacement");
  assert.equal(swapped.items[0].id,"replacement");
  assert.equal(swapped.items[0].role,"primary");
  assert.equal(swapped.sources[0].id,"original");
  assert.equal(swapped.sources[0].role,"source");
  assert.deepEqual(swapped.sources[0].editSegments,[{start:1,end:8}]);
  const restored=makeSourcePrimary(swapped,"original");
  assert.equal(restored.items[0].id,"original");
  assert.equal(restored.sources[0].id,"replacement");
  assert.deepEqual(restored.items[0].editSegments,[{start:1,end:8}]);
});
test("production rendering receives every timeline item in order",()=>{
  let project=addItem(createProject(),{...item("primary",10),workingSource:"C:/working-primary.mp4",editSegments:[{start:1,end:4}],trackTarget:"both"});
  project=addItem(project,{...item("inserted",8),kind:"Audio",workingSource:"C:/inserted.m4a",editSegments:[{start:2,end:6}],trackTarget:"audio"});
  assert.deepEqual(productionRenderItems(project),[
    {source:"C:/primary.mp4",segments:[{start:1,end:4}],mediaKind:"Video",trackTarget:"both",audioVolume:1,transitionType:"none",transitionDuration:0,attachedAudioSource:""},
    {source:"C:/inserted.mp4",segments:[{start:2,end:6}],mediaKind:"Audio",trackTarget:"audio",audioVolume:1,transitionType:"none",transitionDuration:0,attachedAudioSource:""}
  ]);
});
test("audio replacement preserves production duration and stores an exact timeline range",()=>{
  const primary=addItem(createProject(),{...item("primary",60),role:"primary",editSegments:[{start:0,end:60}]});
  const audio={...item("narration",12),kind:"Audio",source:"C:/narration.m4a",workingSource:"C:/working-narration.m4a",editSegments:[{start:2,end:9}]};
  const replaced=addTrackReplacement(primary,audio,"audio",20,null,"audio-edit");
  assert.equal(duration(replaced),60);
  assert.equal(replaced.trackReplacements.length,1);
  assert.deepEqual(replaced.trackReplacements[0],{
    id:"audio-edit",label:"narration",source:"C:/working-narration.m4a",originalSource:"C:/narration.m4a",mediaKind:"Audio",target:"audio",timelineStart:20,timelineEnd:27,segments:[{start:2,end:9}]
  });
});
test("a destination bracket limits replacement without stretching the source",()=>{
  const primary=addItem(createProject(),{...item("primary",30),editSegments:[{start:0,end:30}]});
  const clip={...item("clip",20),editSegments:[{start:5,end:15}]};
  const replaced=addTrackReplacement(primary,clip,"video",8,12,"video-edit");
  assert.equal(replaced.trackReplacements[0].timelineEnd,12);
  assert.deepEqual(replaced.trackReplacements[0].segments,[{start:5,end:9}]);
  assert.equal(duration(replaced),30);
});
test("a selected Primary range uses the Primary Audio target and complete matching Source selection",()=>{
  const primary=addItem(createProject(),{...item("primary",60),editSegments:[{start:0,end:60}]});
  const clip={...item("complete-copy",60),kind:"Video",source:"C:/source-video.mp4",editSegments:[{start:4,end:37.855}]};
  const replaced=addTrackReplacement(primary,clip,"audio",11.565,45.42,"complete-copy-edit");
  assert.equal(replaced.trackReplacements[0].timelineStart,11.565);
  assert.ok(Math.abs(replaced.trackReplacements[0].timelineEnd-45.42)<0.000001);
  assert.equal(replaced.trackReplacements[0].target,"audio");
  assert.deepEqual(replaced.trackReplacements[0].segments,[{start:4,end:37.855}]);
});
test("track replacements are passed to FFmpeg in project order",()=>{
  let project=addItem(createProject(),{...item("primary",30),editSegments:[{start:0,end:30}]});
  project=addTrackReplacement(project,{...item("voice",5),kind:"Audio",editSegments:[{start:0,end:5}]},"audio",3,null,"voice-edit");
  assert.deepEqual(productionRenderReplacements(project),[{
    source:"C:/voice.mp4",segments:[{start:0,end:5}],mediaKind:"Audio",trackTarget:"audio",timelineStart:3,timelineEnd:8
  }]);
});

test("a still image renders as a silent video item for its exact duration",()=>{
  let project=createProject("Images");
  project=addItem(project,{id:"photo",name:"photo.jpg",label:"Photo",kind:"Image",source:"C:/photo.jpg",duration:5.25,editSegments:[{start:0,end:5.25}],trackTarget:"video"});
  assert.deepEqual(productionRenderItems(project),[{source:"C:/photo.jpg",segments:[{start:0,end:5.25}],mediaKind:"Image",trackTarget:"video",audioVolume:1,transitionType:"none",transitionDuration:0,attachedAudioSource:""}]);
  assert.equal(duration(project),5.25);
});

test("a still image can occupy an exact retained audio replacement range",()=>{
  let project=createProject("Image overlay");
  project=addItem(project,item("primary",30));
  project=addTrackReplacement(project,{id:"photo",name:"photo.jpg",label:"Photo",kind:"Image",source:"C:/photo.jpg",duration:6.5,editSegments:[{start:0,end:6.5}],trackTarget:"video"},"video",11.25,17.75,"photo-range");
  const replacement=productionRenderReplacements(project)[0];
  assert.equal(replacement.timelineStart,11.25);
  assert.equal(replacement.timelineEnd,17.75);
  assert.equal(replacement.mediaKind,"Image");
  assert.equal(replacement.trackTarget,"video");
});
test("project images reorder without changing Primary Production",()=>{
  let project=addItem(createProject(),item("primary",10));
  project=addSource(project,{id:"one",name:"one.jpg",kind:"Image",source:"C:/one.jpg",duration:5});
  project=addSource(project,{id:"two",name:"two.jpg",kind:"Image",source:"C:/two.jpg",duration:5});
  const moved=moveSource(project,"two",-1);
  assert.deepEqual(moved.sources.map(source=>source.id),["two","one"]);
  assert.equal(duration(moved),10);
});
test("a slideshow uses ordered images and exact individual durations",()=>{
  const images=[{id:"one",name:"one.jpg",kind:"Image",source:"C:/one.jpg"},{id:"two",name:"two.jpg",kind:"Image",source:"C:/two.jpg"}];
  const result=appendImageSlideshow(createProject("Slideshow"),[{image:images[1],duration:4.25},{image:images[0],duration:6.5}],["slide-two","slide-one"]);
  assert.deepEqual(result.items.map(value=>value.id),["slide-two","slide-one"]);
  assert.deepEqual(result.items.map(value=>value.role),["primary","inserted"]);
  assert.equal(duration(result),10.75);
  assert.deepEqual(productionRenderItems(result).map(value=>value.segments),[[{start:0,end:4.25}],[{start:0,end:6.5}]]);
});
test("a saved track replacement can be removed nondestructively",()=>{
  let project=addItem(createProject(),{...item("primary",30),editSegments:[{start:0,end:30}]});
  project=addTrackReplacement(project,{...item("voice",5),kind:"Audio",editSegments:[{start:0,end:5}]},"audio",3,null,"voice-edit");
  const removed=removeTrackReplacement(project,"voice-edit");
  assert.equal(removed.trackReplacements.length,0);
  assert.equal(duration(removed),30);
  assert.equal(project.trackReplacements.length,1);
});
test("Ctrl+V is contextual paste while Ctrl+Shift+V remains an explicit insert",()=>{
  assert.ok(shortcuts.some(([name,key])=>name==="pasteMedia"&&key.ctrl&&!key.shift&&key.key==="v"));
  assert.ok(shortcuts.some(([name,key])=>name==="pasteInsert"&&key.ctrl&&key.shift&&key.key==="v"));
});
test("Ctrl+X is registered for presentation sequence cutting",()=>{assert.ok(shortcuts.some(([name,key])=>name==="cutMedia"&&key.ctrl&&key.key==="x"));});

test("additional presentation transitions retain overlap and render type",()=>{
  for(const type of ["crossfade","fadeblack","fadewhite","wipeleft","wiperight"]){
    const project=createProject();project.items=[{...item("a",5)},{...item("b",5),transition:{type,duration:2}}];
    const output=productionRenderItems(project);
    assert.equal(output[1].transitionType,type);assert.equal(output[1].transitionDuration,2);
  }
});

test("attached narration is passed to production renderer and triggers music ducking",()=>{
  const image={id:"narrated",kind:"Image",source:"C:/porch.png",duration:7,editSegments:[{start:0,end:7}],attachedAudio:{source:"C:/voice.m4a",name:"Voice"}};
  const project={...createProject(),items:[image]};
  assert.equal(productionRenderItems(project)[0].attachedAudioSource,"C:/voice.m4a");
  assert.deepEqual(presentationDuckRanges([image]),[{start:0,end:7}]);
});
