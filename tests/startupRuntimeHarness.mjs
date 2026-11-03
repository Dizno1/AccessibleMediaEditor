import {JSDOM} from "jsdom";
import {readFileSync} from "node:fs";

const scenario=process.env.AME_SESSION||"missing";
const sessions={
  missing:null,
  empty:"",
  corrupt:"{not valid json",
  incompatible:JSON.stringify({schema:99,project:{items:[],sources:[]}}),
  valid:JSON.stringify({schema:1,project:{format:"Open Door Design Accessible Media Editor Project",version:5,name:"Recovered",items:[],sources:[],trackReplacements:[],presentation:{items:[]}},workspace:"media"})
};
const dom=new JSDOM(readFileSync(new URL("../index.html",import.meta.url),"utf8"),{url:"http://localhost/",pretendToBeVisual:true});
const {window}=dom,calls=[];
window.__TAURI__={core:{invoke:async(command,args)=>{calls.push([command,args]);if(command==="read_recovery_session")return sessions[scenario];return null;},convertFileSrc:path=>`file:///${path}`},event:{listen:async()=>()=>{}}};
Object.assign(globalThis,{window,document:window.document,localStorage:window.localStorage,Option:window.Option,Audio:window.Audio,HTMLElement:window.HTMLElement,HTMLMediaElement:window.HTMLMediaElement});
globalThis.requestAnimationFrame=window.requestAnimationFrame.bind(window);globalThis.cancelAnimationFrame=window.cancelAnimationFrame.bind(window);
const applicationModuleUrl=new URL("../app/app.js",import.meta.url);
applicationModuleUrl.searchParams.set("scenario",scenario);
await import(applicationModuleUrl.href);
await new Promise(resolve=>setTimeout(resolve,500));
console.log(JSON.stringify({calls:calls.map(call=>call[0]),focus:document.activeElement?.id,main:document.querySelectorAll("main").length,alert:document.querySelector("#alert-announcer")?.textContent||"",summary:document.querySelector("#project-summary")?.textContent||""}));
