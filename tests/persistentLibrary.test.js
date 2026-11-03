import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../app/app.js',import.meta.url),'utf8');
const rust=readFileSync(new URL('../src-tauri/src/main.rs',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('clean startup loads library without restoring project',()=>{
  assert.match(app,/void loadLibrary\(\)/);
  assert.doesNotMatch(app,/async function restoreRecovery\(/);
  assert.match(app,/let project=createProject\(\)/);
});
test('persistent library supports selection and reuse',()=>{
  assert.match(html,/id="persistent-library-items"/);
  assert.match(html,/id="persistent-library-add"/);
  assert.match(app,/function addLibrarySelection\(/);
  assert.match(app,/function collectLibraryItems\(/);
});
test('library uses separate persistent folder with guarded writes',()=>{
  assert.match(rust,/app_folder\("Library"\)/);
  assert.match(rust,/MediaLibrary\.json/);
  assert.match(rust,/MediaLibrary\.backup\.json/);
  assert.match(rust,/fn read_media_library\(/);
  assert.match(rust,/fn write_media_library\(/);
});
test('legacy migration reads old session without restoring workspace',()=>{
  assert.match(app,/invoke\("read_recovery_session"\)/);
  assert.match(app,/libraryItems=\[/);
  assert.doesNotMatch(app,/project=migrateProject\(saved\.project\)/);
});
