import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,createInterleavedPresentation,itemDuration} from '../app/projectModel.js';
test('different saved source clips appear between slides and drive ducking ranges',()=>{
 const p=createProject();
 const images=Array.from({length:3},(_,i)=>({image:{id:`image${i}`,name:`Image ${i}`,kind:'Image',duration:5,source:`image${i}.jpg`},duration:5}));
 const clips=[{id:'c1',name:'Dogs',kind:'Video',duration:60,source:'dogs.mov',editSegments:[{start:3,end:8}]},{id:'c2',name:'Dogs',kind:'Video',duration:60,source:'dogs.mov',editSegments:[{start:20,end:26}]}];
 const result=createInterleavedPresentation(p,images,['i1','i2','i3'],clips,['v1','v2'],{source:'music.m4a',duration:90},true);
 assert.deepEqual(result.items.map(item=>item.kind),['Image','Video','Image','Video','Image']);
 assert.deepEqual(result.items.filter(item=>item.kind==='Video').map(item=>itemDuration(item)),[5,6]);
 assert.deepEqual(result.backgroundMusic.duckRanges,[{start:5,end:10},{start:15,end:21}]);
});
