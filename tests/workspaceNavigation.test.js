import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../app/app.js',import.meta.url),'utf8');
const shortcuts=readFileSync(new URL('../app/shortcutService.js',import.meta.url),'utf8');
const workspace=app.slice(app.indexOf('function switchWorkspace('),app.indexOf('async function importMedia('));
test('workspace switches focus the selected tab, not the document-like tabpanel',()=>{
  assert.match(workspace,/el\[workspaceTabs\[next\]\]\.focus\(\)/);
  assert.doesNotMatch(workspace,/el\[workspacePanels\[next\]\]\.focus\(\)/);
});
test('workspace switches do not duplicate native tab announcements through live regions',()=>{
  assert.doesNotMatch(workspace,/announce\(/);
});
test('held control tab does not cause repeated workspace switching',()=>{
  assert.match(shortcuts,/event\.repeat && event\.ctrlKey && event\.key\.toLowerCase\(\) === "tab"/);
});
test('F1 opens app-wide instructions and keyboard shortcuts',()=>{
  assert.match(shortcuts,/\["showShortcuts", \{key:"f1"\}\]/);
});
test('Escape closes a native select without also running the app Cancel command',()=>{
  assert.match(shortcuts,/event\.key === "Escape" && event\.target\?\.tagName\?\.toLowerCase\(\) === "select"/);
});
test('Ctrl Tab enters the destination workspace instead of focusing its tab',()=>{
  assert.match(app,/previousWorkspace:\(\)=>switchWorkspace\(-1,null,true\)/);
  assert.match(app,/nextWorkspace:\(\)=>switchWorkspace\(1,null,true\)/);
  assert.match(workspace,/if\(focusContent\)focusWorkspaceContent\(next\)/);
});
test('workspace focus moves before the old panel is hidden',()=>{
  const focusPosition=workspace.indexOf('if(focusContent)focusWorkspaceContent(next)');
  const hidePosition=workspace.indexOf('if(name!==next)el[workspacePanels[name]].hidden=true');
  assert.ok(focusPosition>0&&hidePosition>focusPosition);
});
