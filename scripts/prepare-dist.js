import fs from "node:fs";
import path from "node:path";
const root=path.resolve(import.meta.dirname,"..");
const dist=path.join(root,"dist");
fs.rmSync(dist,{recursive:true,force:true});
fs.mkdirSync(path.join(dist,"app"),{recursive:true});
fs.copyFileSync(path.join(root,"index.html"),path.join(dist,"index.html"));
for(const name of fs.readdirSync(path.join(root,"app"))) fs.copyFileSync(path.join(root,"app",name),path.join(dist,"app",name));
console.log("Prepared Accessible Media Editor frontend.");
