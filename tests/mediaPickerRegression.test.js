import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const main=readFileSync(new URL("../src-tauri/src/main.rs",import.meta.url),"utf8");
const app=readFileSync(new URL("../app/app.js",import.meta.url),"utf8");
test("Open Media uses restored native 0.10.21 picker",()=>{
 const section=main.slice(main.indexOf("fn pick_media_files("),main.indexOf("#[tauri::command]",main.indexOf("fn pick_media_files(")));
 assert.match(section,/native_media_picker::pick_media_files\(&app\)/);
 assert.doesNotMatch(section,/rfd::FileDialog/);
});
test("Open Media button and contextual Ctrl+O retain the native picker",()=>{
 assert.match(app,/el\["import-media-button"\]\.addEventListener\("click",importMedia\)/);
 assert.match(app,/const paths=await invoke\("pick_media_files"\)/);
 assert.match(app,/openCurrentWorkspace:.*activeWorkspace==="audio".*openAudio\(\).*importMedia\(\)/);
});
