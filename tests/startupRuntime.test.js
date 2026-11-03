import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

const harnessPath=fileURLToPath(new URL("startupRuntimeHarness.mjs",import.meta.url));

function run(scenario){
  const result=spawnSync(process.execPath,[harnessPath],{encoding:"utf8",env:{...process.env,AME_SESSION:scenario}});
  assert.equal(result.status,0,result.stderr);
  return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
}
for(const scenario of ["missing","empty","valid"]){
  test(`startup reaches the accessible editor with a ${scenario} recovery session`,()=>{
    const result=run(scenario);assert.equal(result.main,1);assert.equal(result.focus,"import-media-button");assert.equal(result.calls[0],"frontend_ready");assert.ok(result.calls.indexOf("read_recovery_session")>result.calls.indexOf("frontend_ready"));
  });
}
for(const scenario of ["corrupt","incompatible"]){
  test(`${scenario} recovery data cannot block startup or be overwritten`,()=>{
    const result=run(scenario);assert.equal(result.main,1);assert.equal(result.focus,"import-media-button");assert.match(result.alert,/opened an empty workspace/i);assert.equal(result.calls.includes("write_recovery_session"),false);
  });
}
test("native startup cannot depend on a hidden WebView or persisted window state",()=>{
  const config=readFileSync(new URL("../src-tauri/tauri.conf.json",import.meta.url),"utf8"),rust=readFileSync(new URL("../src-tauri/src/main.rs",import.meta.url),"utf8"),cargo=readFileSync(new URL("../src-tauri/Cargo.toml",import.meta.url),"utf8");
  assert.match(config,/"visible"\s*:\s*true/);assert.doesNotMatch(cargo,/tauri-plugin-window-state/);assert.match(rust,/window\.show\(\)\?/);assert.match(rust,/window\.set_focus\(\)\?/);
});
test("startup runtime files use Windows-safe file URL conversion",()=>{
  const testSource=readFileSync(new URL("startupRuntime.test.js",import.meta.url),"utf8");
  const harnessSource=readFileSync(new URL("startupRuntimeHarness.mjs",import.meta.url),"utf8");
  assert.doesNotMatch(testSource,/new URL\([^\n]+\)\.pathname/);
  assert.doesNotMatch(harnessSource,/\.pathname/);
  assert.doesNotMatch(harnessSource,/pathToFileURL/);
  assert.match(testSource,/fileURLToPath/);
  assert.match(harnessSource,/await import\(applicationModuleUrl\.href\)/);
});
