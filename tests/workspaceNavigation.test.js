import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../app/app.js',import.meta.url),'utf8');
const shortcuts=readFileSync(new URL('../app/shortcutService.js',import.meta.url),'utf8');
const workspace=app.slice(app.indexOf('function switchWorkspace('),app.indexOf('async function importMedia('));
test('workspace switches focus a useful control, not the document-like tabpanel',()=>{
  assert.match(workspace,/destination\?\.focus\(\)/);
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
