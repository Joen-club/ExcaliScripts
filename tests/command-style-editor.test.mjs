import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
const require = createRequire(import.meta.url);
// TypeScript is an existing template devDependency, not an additional test dependency.
const ts = require("typescript");
const root=resolve("src/scripts/command-style-editor");
const loaded=new Map();
function load(moduleName) {
  const path=join(root,moduleName.endsWith(".ts") ? moduleName : `${moduleName}.ts`);
  if(loaded.has(path)) return loaded.get(path).exports;
  const m={exports:{}};loaded.set(path,m);
  const code=ts.transpileModule(readFileSync(path,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const localRequire=(id)=>id.startsWith(".") ? load(join(dirname(path),id).slice(root.length+1)) : require(id);
  new Function("module","exports","require",code)(m,m.exports,localRequire);
  return m.exports;
}
const {validateProfile,evaluateCommands,parseCommands,computeStyle}=load("engine");
const {collectTargets,SceneSession}=load("scene");
const {evaluatePosition,dockPosition}=load("position");
const {parseProfile}=load("profile-store");
const example=JSON.parse(readFileSync(join(root,"profiles/example-one-handed.json"),"utf8"));
const bind=(token,property,operation,value)=>({token,name:token,property,operation,value,enabled:true});
const repeat=(input,bindings)=>evaluateCommands(input,bindings).active;
const element=(id,type,extra={})=>({id,type,groupIds:[],fontSize:20,strokeWidth:1,strokeStyle:"solid",strokeColor:"#222222",opacity:100,version:1,...extra});

test("default profile has no commands; optional profile is valid and portable",()=>{
  assert.deepEqual(validateProfile({version:1,name:"Empty",bindings:[]}).bindings,[]);
  assert.equal(validateProfile(example).bindings.length,7);
});
test("overlapping tokens use longest match and recompute rather than applying both",()=>{
  const bindings=[bind("s","fontSize","add",2),bind("sc","strokeColor","set","#1971c2")];
  assert.equal(computeStyle(element("a","text"),repeat("s",bindings)).fontSize,22);
  const after=computeStyle(element("a","text"),repeat("sc",bindings));
  assert.equal(after.fontSize,20);assert.equal(after.strokeColor,"#1971c2");
  assert.equal(computeStyle(element("a","text"),repeat("s",bindings)).strokeColor,"#222222");
});
test("numeric counts, explicit z undo, and deleting z as redo",()=>{
  const bindings=[bind("s","fontSize","add",2)];
  assert.equal(computeStyle(element("a","text"),repeat("3s",bindings)).fontSize,26);
  assert.equal(computeStyle(element("a","text"),repeat("3sz",bindings)).fontSize,24);
  assert.equal(computeStyle(element("a","text"),repeat("3s2z",bindings)).fontSize,22);
  assert.equal(computeStyle(element("a","text"),repeat("3szz",bindings)).fontSize,22);
  assert.equal(computeStyle(element("a","text"),repeat("3s",bindings)).fontSize,26);
});
test("known prefixes preview while incomplete tokens and unknown tokens block finalization",()=>{
  const bindings=[bind("sc","strokeColor","set","#1971c2")];
  assert.equal(parseCommands("s",bindings).pending,"s");
  assert.equal(parseCommands("12",bindings).pending,"12");
  assert.equal(parseCommands("s?",bindings).issues.length,1);
  assert.equal(parseCommands("sa",[bind("s","fontSize","add",2),bind("save","consoleRemember","set","save")]).pending,"sa");
  assert.equal(parseCommands("0sc",bindings).issues.length,1);
  assert.equal(parseCommands("101sc",bindings).issues.length,1);
  assert.equal(parseCommands("1200sc",bindings).issues.length,1);
  assert.equal(parseCommands("2sc",bindings).steps[0].repeat,2);
});
test("unused token z cannot be replaced by a user binding",()=>{
  assert.throws(()=>validateProfile({version:1,name:"Bad",bindings:[bind("z","fontSize","add",1)]}),/reserved/);
  assert.throws(()=>validateProfile({version:1,name:"Bad",bindings:[bind("2a","fontSize","add",1)]}),/without digits/);
  assert.throws(()=>validateProfile({version:1,name:"Bad",bindings:[bind("a","fontSize","add",1),bind("a","fontSize","add",2)]}),/Duplicate/);
});
test("untrusted profile JSON rejects unsupported values and large payloads",()=>{
  assert.throws(()=>parseProfile('{"version":2,"name":"a","bindings":[]}'),/version 1/);
  assert.throws(()=>validateProfile({version:1,name:"X",bindings:[bind("a","__proto__","set",1)]}),/Unknown property/);
  assert.throws(()=>validateProfile({version:1,name:"X",bindings:[bind("a","strokeColor","set","javascript:bad")]}),/Color/);
  assert.throws(()=>parseProfile(" ".repeat(131073)),/128 KB/);
});
test("negative steps for numeric add are valid and stay within element bounds",()=>{
  const b=bind("d","fontSize","add",-10);
  assert.equal(validateProfile({version:1,name:"X",bindings:[b]}).bindings.length,1);
  assert.equal(computeStyle(element("a","text",{fontSize:5}),repeat("3d",[b])).fontSize,1);
});
test("choice cycling, roundness, arrowheads and element compatibility",()=>{
  const b=[bind("f","strokeStyle","cycle","solid"),bind("r","roundness","set","round"),bind("t","endArrowhead","set","triangle")];
  const arrow=computeStyle(element("a","arrow"),repeat("fft",b));
  assert.equal(arrow.strokeStyle,"dotted");assert.equal(arrow.endArrowhead,"triangle");
  const rect=computeStyle(element("b","rectangle"),repeat("r",b));
  assert.deepEqual(rect.roundness,{type:3});
  assert.equal(computeStyle(element("a","text"),repeat("f",b)).strokeStyle,"solid");
});
test("selecting group expands its members, includes bound labels, excludes locked",()=>{
  const all=[element("a","rectangle",{groupIds:["group1"],boundElements:[{id:"label",type:"text"}]}),element("b","arrow",{groupIds:["group1"]}),element("label","text"),element("c","rectangle",{groupIds:["group1"],locked:true}),element("d","text")];
  assert.deepEqual(collectTargets(all,[all[0]],["group1"]).map((el)=>el.id),["a","b","label"]);
  assert.deepEqual(collectTargets(all,[all[0]],[]).map((el)=>el.id),["a","label"]);
});
test("console dock commands can be overwritten and removed with live replay",()=>{
  const bindings=[bind("p","consoleY","add",12),bind("pc","consoleDock","set","center")];
  const base={dock:"custom",x:50,y:60};
  assert.equal(evaluatePosition(base,repeat("p",bindings),200,100,900,600).y,72);
  assert.equal(evaluatePosition(base,repeat("pc",bindings),200,100,900,600).y,250);
  assert.deepEqual(dockPosition({dock:"bottom",x:0,y:1},200,100,900,600),{x:350,y:484});
});
function mockEA(){
  const view={};
  const original=[element("a","text"),element("b","text",{groupIds:["g"]})];
  let scene=structuredClone(original);let staged=new Map();let commits=0;const actions=[];
  const ea={targetView:view,style:{fontSize:20,fontFamily:1},obsidian:{Notice:class{constructor() {}}},
    getViewElements:()=>scene,
    getViewSelectedElements:()=>[scene[0]],
    getExcalidrawAPI:()=>({getAppState:()=>({selectedGroupIds:{}})}),
    measureText:()=>({width:100,height:25}),
    viewUpdateScene:({elements,captureUpdate})=>{scene=structuredClone(elements);actions.push(captureUpdate);},
    clear:()=>{staged=new Map();},
    copyViewElementsToEAforEditing:(selected)=>{staged=new Map(selected.map((el)=>[el.id,structuredClone(el)]));},
    getElement:(id)=>staged.get(id),
    addElementsToView:async(...args)=>{commits++;scene=scene.map((el)=>staged.get(el.id) ?? el);actions.push(args[4]);return true;},
  };
  return {ea,view,scene:()=>scene,original,commits:()=>commits,actions};
}
test("live scene preview is not an EA commit; cancel restores original properties",()=>{
  const {ea,view,scene,commits,actions}=mockEA();
  const session=new SceneSession(ea,view);const b=[bind("s","fontSize","add",2)];
  session.preview(repeat("ss",b));assert.equal(scene()[0].fontSize,24);
  assert.equal(commits(),0);session.preview(repeat("s",b));assert.equal(scene()[0].fontSize,22);
  session.cancel();assert.equal(scene()[0].fontSize,20);
  assert.deepEqual(actions,["NEVER","NEVER","NEVER"]);
});
test("accept records exactly one identity-preserving transaction",async()=>{
  const {ea,view,scene,commits,actions}=mockEA();
  const session=new SceneSession(ea,view);
  session.preview(repeat("3s",[bind("s","fontSize","add",2)]));
  assert.equal(await session.commit(),1);
  assert.equal(scene()[0].fontSize,26);assert.equal(scene()[0].id,"a");
  assert.equal(commits(),1);assert.deepEqual(actions,["NEVER","NEVER","IMMEDIATELY"]);
});

test("resolves undo and control commands without allowing a duplicate z prefix",()=>{
  const commands=[bind("p","consoleY","add",5),bind("save","consoleRemember","set","save")];
  const evalResult=evaluateCommands("2psavez",commands);
  assert.deepEqual(evalResult.active.map((x)=>x.binding.property),["consoleY","consoleY"]);
  assert.equal(evalResult.undone,1);
  const pos=evaluatePosition({dock:"custom",x:10,y:20},evalResult.active,200,100,900,600);
  assert.equal(pos.y,30);
});
test("external edits block new previews and do not get overwritten on cancel",()=>{
  const {ea,view,scene,actions}=mockEA();
  const sess=new SceneSession(ea,view);
  const commands=[bind("s","fontSize","add",2)];
  sess.preview(repeat("s",commands));
  scene()[0].x=200; // an external canvas mutation while the preview is showing
  assert.throws(()=>sess.preview(repeat("ss",commands)),/outside the console/);
  sess.cancel();
  assert.equal(scene()[0].x,200);
  assert.equal(scene()[0].fontSize,20); // restore our temporary style even after an unrelated external edit
  assert.deepEqual(actions,["NEVER","NEVER"]);
});


test("preview retains unrelated element metadata and protects original links",()=>{
  const {ea,view,scene}=mockEA();
  scene()[0].link="[[Note]]";
  scene()[0].customData={owner:"another-plugin"};
  scene()[0].boundElements=[{id:"r1",type:"arrow"}];
  const session=new SceneSession(ea,view);
  session.preview(repeat("s",[bind("s","fontSize","add",2)]));
  assert.equal(scene()[0].link,"[[Note]]");
  assert.deepEqual(scene()[0].customData,{owner:"another-plugin"});
  assert.deepEqual(scene()[0].boundElements,[{id:"r1",type:"arrow"}]);
  scene()[0].customData={owner:"another-plugin",external:true};
  assert.equal(session.cancel(),true);
  assert.equal(scene()[0].fontSize,20);
  assert.equal(scene()[0].customData.external,true);
});

test("cancel merges external edits to the same style field without wiping unrelated preview fields",()=>{
  const {ea,view,scene}=mockEA();
  const session=new SceneSession(ea,view);
  const commands=[bind("s","fontSize","add",2),bind("o","opacity","set",50)];
  session.preview(repeat("so",commands));
  assert.equal(scene()[0].fontSize,22);
  assert.equal(scene()[0].opacity,50);
  scene()[0].fontSize=48; // user or another plugin changed our previewed property
  assert.equal(session.cancel(),false);
  assert.equal(scene()[0].fontSize,48);
  assert.equal(scene()[0].opacity,100);
  assert.equal(session.cancel(),true);
  assert.rejects(session.commit(),/stale/);
});

test("partial command removal restores all preview-only fields and metadata",()=>{
  const {ea,view,scene}=mockEA();
  const session=new SceneSession(ea,view);
  const commands=[bind("s","fontSize","add",2),bind("sc","strokeColor","set","#1971c2")];
  session.preview(repeat("s",commands));
  assert.equal(scene()[0].fontSize,22);
  session.preview(repeat("sc",commands));
  assert.equal(scene()[0].fontSize,20);
  assert.equal(scene()[0].strokeColor,"#1971c2");
  session.preview(repeat("s",commands));
  assert.equal(scene()[0].strokeColor,"#222222");
  assert.equal(scene()[0].fontSize,22);
  session.preview([]);
  assert.equal(scene()[0].fontSize,20);
});

test("externally changed targets block a commit even if the text is valid",async()=>{
  const {ea,view,scene,commits}=mockEA();
  const session=new SceneSession(ea,view);
  session.preview(repeat("s",[bind("s","fontSize","add",2)]));
  scene()[0].x=127;
  await assert.rejects(()=>session.commit(),/outside the console/);
  assert.equal(commits(),0);
  session.cancel();
  assert.equal(scene()[0].x,127);
  assert.equal(scene()[0].fontSize,20);
});

test("an in-flight persistent transaction rejects reentrant preview and commit",async()=>{
  const {ea,view}=mockEA();
  const original=ea.addElementsToView;
  let resume;
  ea.addElementsToView=()=>new Promise((resolve)=>{resume=async()=>resolve(await original());});
  const session=new SceneSession(ea,view);
  const steps=repeat("s",[bind("s","fontSize","add",2)]);
  session.preview(steps);
  const pending=session.commit();
  assert.throws(()=>session.preview(steps),/no longer active/);
  await assert.rejects(()=>session.commit(),/stale/);
  await resume();
  assert.equal(await pending,1);
});

test("a rejected persistent transaction blocks retries and does not leave temporary preview",async()=>{
  const {ea,view,scene}=mockEA();
  ea.addElementsToView=async()=>false;
  const session=new SceneSession(ea,view);
  session.preview(repeat("s",[bind("s","fontSize","add",2)]));
  await assert.rejects(session.commit(),/did not accept/);
  assert.equal(scene()[0].fontSize,20);
  await assert.rejects(session.commit(),/stale/);
});

test("profile path validation rejects traversal and platform-invalid names",()=>{
  const {safeVaultPath}=load("profile-store");
  const ea={obsidian:{normalizePath:s=>s.replace(/\/+/g,"/")}};
  assert.equal(safeVaultPath(ea,"Excalidraw/Commands.json"),"Excalidraw/Commands.json");
  for(const path of ["../file.json","a/../../file.json","/absolute.json","C:/drive.json","hidden/.private.json","foo//bar.json","foo\\bar.json","name:wrong.json","foo?bar.json","foo\nbar.json","a.txt",".json","a/./b.json"]){
    assert.equal(safeVaultPath(ea,path),null,`unexpectedly accepted ${JSON.stringify(path)}`);
  }
});

test("JSON profile size limit is measured in UTF-8 bytes rather than character count",()=>{
  assert.throws(()=>parseProfile("é".repeat(68000)),/128 KB/);
});

test("vault JSON profiles are created empty, validated and protected from unexpected overwrite",async()=>{
  const {loadProfile,writeProfile,EMPTY_PROFILE}=load("profile-store");
  const files=new Map();
  class TFile { constructor(path){this.path=path;} }
  class TFolder { constructor(path){this.path=path;} }
  const folders=new Set();
  const vault={
    getAbstractFileByPath:path=>files.get(path)?.file??(folders.has(path)?new TFolder(path):null),
    read:async f=>files.get(f.path).content,
    createFolder:async path=>{folders.add(path);},
    modify:async(f,content)=>{files.get(f.path).content=content;},
    create:async(path,content)=>{const f=new TFile(path);files.set(path,{file:f,content});return f;}
  };
  const ea={plugin:{app:{vault}},obsidian:{TFile,TFolder,normalizePath:s=>s}};
  const path="Excalidraw/Command Style Editor/commands.json";
  const initial=await loadProfile(ea,path,true);
  assert.deepEqual(initial,EMPTY_PROFILE);
  assert.equal(files.get(path).content.includes('"bindings": []'),true);
  await assert.rejects(writeProfile(ea,path,initial,false),/already exists/);
  const updated={...initial,bindings:[bind("s","fontSize","add",2)]};
  await writeProfile(ea,path,updated,true);
  assert.deepEqual((await loadProfile(ea,path,false)).bindings,updated.bindings);
  files.get(path).content='{bad JSON';
  await assert.rejects(loadProfile(ea,path,true));
  assert.equal(files.get(path).content,'{bad JSON');
});

test("incomplete longer token removes provisional shorter-token preview",()=>{
  const tokens=[bind("s","fontSize","add",2),bind("save","consoleRemember","set","save")];
  assert.equal(computeStyle(element("a","text"),repeat("s",tokens)).fontSize,22);
  const intermediate=evaluateCommands("sa",tokens);
  assert.equal(intermediate.pending,"sa");
  assert.deepEqual(intermediate.active,[]);
  const withPrior=evaluateCommands("ssa",tokens);
  assert.equal(withPrior.pending,"sa");
  assert.equal(withPrior.active.length,1);
  assert.equal(computeStyle(element("a","text"),withPrior.active).fontSize,22);
  const counted=evaluateCommands("3sa",tokens);
  assert.equal(counted.pending,"3sa");
  assert.equal(counted.active.length,0);
  assert.equal(evaluateCommands("save",tokens).active[0].binding.token,"save");
});


test("profile validator rejects nonstring token objects without runtime TypeError",()=>{
  const bad={version:1,name:"Bad",bindings:[{token:{invalid:true},name:"Bad",property:"fontSize",operation:"add",value:1,enabled:true}]};
  assert.throws(()=>validateProfile(bad),/Token must/);
});


test("malformed imported property objects are rejected, never coerced into keys",()=>{
  const dangerous=bind("p","strokeColor","set","#123456");
  dangerous.property={toString:null,valueOf:null};
  assert.throws(()=>validateProfile({version:1,name:"Malicious",bindings:[dangerous]}),/Unknown property/);
  dangerous.property=["strokeColor"];
  assert.throws(()=>validateProfile({version:1,name:"Malicious",bindings:[dangerous]}),/Unknown property/);
});

test("image opacity is editable without treating images as shapes",()=>{
  const opacity=bind("o","opacity","add",-20);
  const color=bind("c","strokeColor","set","#ff0000");
  const image=element("photo","image",{opacity:100,fileId:"immutable-image"});
  const updated=computeStyle(image,repeat("oc",[opacity,color]));
  assert.equal(updated.opacity,80);
  assert.equal(updated.strokeColor,"#222222");
  assert.equal(updated.fileId,"immutable-image");
});

test("cancellation handles a host that already restored previewed fields",()=>{
  const {ea,view,scene,actions}=mockEA();
  const session=new SceneSession(ea,view);
  session.preview(repeat("s",[bind("s","fontSize","add",2)]));
  scene()[0].fontSize=20;
  assert.equal(session.cancel(),true);
  assert.equal(scene()[0].fontSize,20);
  assert.deepEqual(actions,["NEVER","NEVER"]);
});

test("preview updates Excalidraw revision and nonce on detached elements",()=>{
  const {ea,view,scene}=mockEA();
  scene()[0].versionNonce=712;
  const session=new SceneSession(ea,view);
  session.preview(repeat("s",[bind("s","fontSize","add",2)]));
  assert.equal(scene()[0].versionNonce,713);
  assert.equal(scene()[0].version,2);
  session.cancel();
  assert.equal(scene()[0].versionNonce,714);
});

test("rapid asynchronous preview updates never interpret prior own states as external edits",()=>{
  const {ea,view,scene}=mockEA();
  const queued=[];
  const immediate=ea.viewUpdateScene;
  ea.viewUpdateScene=(change)=>{queued.push(change)};
  const session=new SceneSession(ea,view);
  const b=[bind("s","fontSize","add",2)];
  session.preview(repeat("s",b));
  session.preview(repeat("ss",b));
  assert.equal(scene()[0].fontSize,20); // host has not published any updates
  immediate(queued[0]);
  session.preview(repeat("sss",b));
  immediate(queued[1]);
  assert.equal(session.cancel(),true);
  assert.equal(queued.length,4);
  immediate(queued[2]);
  immediate(queued[3]);
  assert.equal(scene()[0].fontSize,20);
});

test("rollback handles a lagging earlier preview without overwriting unrelated edits",()=>{
  const {ea,view,scene}=mockEA();
  const session=new SceneSession(ea,view);
  const b=[bind("s","fontSize","add",2)];
  session.preview(repeat("s",b));
  const prior=structuredClone(scene()[0]);
  session.preview(repeat("ss",b));
  Object.assign(scene()[0],prior,{x:44}); // earlier host state with external X edit
  assert.equal(session.cancel(),true);
  assert.equal(scene()[0].fontSize,20);
  assert.equal(scene()[0].x,44);
});

/** Minimal Obsidian Modal/Setting DOM mock to exercise actual manager logic. */
function managerHarness(initialData={}){
  class FakeElement {
    constructor(doc,tag){this.ownerDocument=doc;this.tagName=tag;this.children=[];this.style={};this.attributes={};this.listeners=new Map();this.value="";this.textContent="";this.className="";}
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this.children=children;}
    setAttribute(key,value){this.attributes[key]=value;}
    addEventListener(key,fn){this.listeners.set(key,[...(this.listeners.get(key)??[]),fn]);}
    dispatchEvent(event){for(const fn of this.listeners.get(event.type)??[])fn(event);}
    click(){this.dispatchEvent({type:"click"});}
    querySelector(tag){return this.find((el)=>el.tagName===tag);}
    find(predicate){if(predicate(this)) return this;for(const child of this.children){const found=child.find?.(predicate);if(found)return found;}return null;}
    findAll(predicate){const found=predicate(this)?[this]:[];for(const child of this.children)found.push(...(child.findAll?.(predicate)??[]));return found;}
  }
  const doc={createElement:(tag)=>new FakeElement(doc,tag)};
  class TFile {constructor(path){this.path=path;this.extension=path.split(".").at(-1)}}
  class TFolder {constructor(path){this.path=path}}
  let lastModal=null;
  class Modal {
    constructor(){this.contentEl=doc.createElement("div");this.modalEl=doc.createElement("div");this.onOpen=()=>{};this.onClose=()=>{};lastModal=this;}
    open(){this.onOpen();}
    close(){this.onClose();}
  }
  function control(doc,tag,value){const input=doc.createElement(tag);input.value=value;return {
    inputEl:input,setValue(s){input.value=s;return this;},setPlaceholder(s){input.placeholder=s;return this;},
    addOption(){return this;},onChange(fn){input.addEventListener(tag==="select"?"change":"input",()=>fn(tag==="input-checkbox"?Boolean(input.checked):input.value));return this;},
  };}
  class Setting {
    constructor(parent){this.row=doc.createElement("div");this.controlEl=doc.createElement("div");this.row.append(this.controlEl);parent.append(this.row);}
    setName(name){const label=doc.createElement("label");label.textContent=name;this.row.append(label);return this;}
    addText(cb){const x=control(doc,"input","");this.controlEl.append(x.inputEl);cb(x);return this;}
    addDropdown(cb){const x=control(doc,"select","");this.controlEl.append(x.inputEl);cb(x);return this;}
    addToggle(cb){const x=control(doc,"input","false");x.setValue=(v)=>{x.inputEl.checked=v;return x;};x.onChange=(fn)=>{x.inputEl.addEventListener("input",()=>fn(x.inputEl.checked));return x;};this.controlEl.append(x.inputEl);cb(x);return this;}
  }
  const files=new Map(Object.entries(initialData));
  const folders=new Set(["Excalidraw","Excalidraw/Command Style Editor"]);
  const writes=[];const notices=[];
  const vault={
    getAbstractFileByPath:(p)=>files.has(p)?new TFile(p):folders.has(p)?new TFolder(p):null,
    createFolder:async(p)=>{folders.add(p)},
    create:async(p,v)=>{files.set(p,v);writes.push(p);return new TFile(p)},
    modify:async(f,v)=>{files.set(f.path,v);writes.push(f.path)},
    read:async(f)=>files.get(f.path),
    getFiles:()=>[...files.keys()].map(p=>new TFile(p)),
  };
  const settings={};
  const ea={plugin:{app:{vault}},getScriptSettings:()=>settings,setScriptSettings:async(s)=>Object.assign(settings,s),
    obsidian:{Modal,Setting,TFile,TFolder,Notice:class{constructor(m){notices.push(m)}},normalizePath:p=>p}};
  let confirmResult=undefined;
  const utils={suggester:async(...args)=>typeof confirmResult==="function"?confirmResult(...args):confirmResult,inputPrompt:async()=>undefined};
  function row(label){return lastModal?.contentEl.find((node)=>node.tagName==="div" && node.children.some(child=>child.tagName==="label"&&child.textContent===label));}
  function button(text){return lastModal?.contentEl.find((node)=>node.tagName==="button"&&node.textContent===text);}
  return {ea,utils,files,writes,notices,row,button,modal:()=>lastModal,confirm:(v)=>{confirmResult=v}};
}
const tick=()=>new Promise((resolve)=>setImmediate(resolve));

test("manager finishes profile load before presenting editable fields",async()=>{
  const {openCommandManager}=load("manager");
  const path="Excalidraw/Command Style Editor/commands.json";
  const harness=managerHarness({[path]:JSON.stringify({version:1,name:"Loaded name",bindings:[]})});
  const pending=openCommandManager(harness.ea,harness.utils);
  await tick();
  assert.equal(harness.row("Profile name").querySelector("input").value,"Loaded name");
  harness.button("Close").click();await pending;
});

test("manager cannot silently overwrite another file after profile path change",async()=>{
  const {openCommandManager}=load("manager");
  const path="Excalidraw/Command Style Editor/commands.json";
  const elsewhere="Excalidraw/private.json";
  const harness=managerHarness({[path]:JSON.stringify({version:1,name:"Original",bindings:[]}),[elsewhere]:'{"keep":true}'});
  const pending=openCommandManager(harness.ea,harness.utils);
  await tick();
  const input=harness.row("Active profile path").querySelector("input");
  input.value=elsewhere;input.dispatchEvent({type:"input"});
  harness.button("Save profile").click();await tick();await tick();
  assert.equal(harness.files.get(elsewhere),'{"keep":true}');
  harness.confirm(true);harness.button("Save profile").click();await tick();await tick();
  assert.equal(JSON.parse(harness.files.get(elsewhere)).name,"Original");
  harness.button("Close").click();await pending;
});

test("manager opens with corrupt profile without overwriting until user consents",async()=>{
  const {openCommandManager}=load("manager");
  const path="Excalidraw/Command Style Editor/commands.json";
  const harness=managerHarness({[path]:"invalid JSON"});
  const pending=openCommandManager(harness.ea,harness.utils);
  await tick();
  assert.ok(harness.modal().contentEl.find((n)=>n.attributes.role==="alert"));
  harness.button("Save profile").click();await tick();await tick();
  assert.equal(harness.files.get(path),"invalid JSON");
  harness.confirm(true);harness.button("Save profile").click();await tick();await tick();
  assert.equal(JSON.parse(harness.files.get(path)).bindings.length,0);
  harness.button("Close").click();await pending;
});

test("concurrent Save clicks do not race and edits made during I/O remain dirty",async()=>{
  const {openCommandManager}=load("manager");
  const path="Excalidraw/Command Style Editor/commands.json";
  const harness=managerHarness({[path]:JSON.stringify({version:1,name:"Before",bindings:[]})});
  let resume=()=>{};
  const gate=new Promise((r)=>{resume=r});
  let writes=0;
  const vault=harness.ea.plugin.app.vault;
  const modify=vault.modify;
  vault.modify=async(...args)=>{writes++;await gate;return modify(...args)};
  let resolved=false;
  const pending=openCommandManager(harness.ea,harness.utils).then(()=>{resolved=true});
  await tick();
  harness.button("Save profile").click();
  harness.button("Save profile").click();
  await tick();
  const name=harness.row("Profile name").querySelector("input");
  name.value="After";name.dispatchEvent({type:"input"});
  harness.button("Close").click();
  await tick();
  assert.equal(resolved,false); // modal closure waits for the pending vault operation
  assert.equal(writes,1); // double click was ignored
  resume();await pending;
  assert.equal(resolved,true);
  assert.equal(JSON.parse(harness.files.get(path)).name,"Before");
  assert.ok(harness.notices.some((v)=>String(v).includes("unsaved edits remain")));
});

test("import into a dirty manager requires consent and never silently discards edits",async()=>{
  const {openCommandManager}=load("manager");
  const path="Excalidraw/Command Style Editor/commands.json";
  const other="Excalidraw/Command Style Editor/other.json";
  const harness=managerHarness({
    [path]:JSON.stringify({version:1,name:"Current",bindings:[]}),
    [other]:JSON.stringify({version:1,name:"Other",bindings:[bind("s","fontSize","add",2)]}),
  });
  const pending=openCommandManager(harness.ea,harness.utils);
  await tick();
  harness.button("+ New binding").click();
  assert.equal(harness.modal().contentEl.findAll((x)=>x.tagName==="section").length,1);
  harness.button("Import from vault").click();await tick();await tick();
  assert.equal(harness.modal().contentEl.findAll((x)=>x.tagName==="section").length,1);
  harness.confirm((labels,values)=>labels[0]==="Cancel"?true:values.find((f)=>f.path===other));
  harness.button("Import from vault").click();await tick();await tick();
  assert.equal(harness.row("Profile name").querySelector("input").value,"Other");
  assert.equal(harness.modal().contentEl.findAll((x)=>x.tagName==="section").length,1);
  harness.button("Close").click();await pending;
  assert.equal(JSON.parse(harness.files.get(path)).bindings.length,0); // still requires Save
});

/** Minimal floating-modal harness for the actual compiled console module lifecycle. */
function consoleHarness(){
  let modal=null;
  class FakeElement {
    constructor(tag){
      this.tagName=tag;this.ownerDocument=doc;this.style={cssText:"",left:"0px",top:"0px"};
      this.children=[];this.handlers=new Map();this.offsetWidth=320;this.offsetHeight=135;
      this.hidden=false;this.value="";this.textContent="";this.disabled=false;
    }
    append(...children){this.children.push(...children)}
    replaceChildren(...children){this.children=[...children]}
    addEventListener(name,fn){this.handlers.set(name,[...(this.handlers.get(name)??[]),fn])}
    removeEventListener(name,fn){this.handlers.set(name,(this.handlers.get(name)??[]).filter(x=>x!==fn))}
    dispatch(type,extra={}){for(const fn of this.handlers.get(type)??[])fn({type,preventDefault(){},stopPropagation(){},...extra})}
    setAttribute(key,value){this[key]=value}
    getBoundingClientRect(){return {left:parseFloat(this.style.left)||0,top:parseFloat(this.style.top)||0}}
    find(predicate){if(predicate(this))return this;for(const child of this.children){const found=child.find?.(predicate);if(found)return found}return null}
    focus(){}
  }
  const win={innerWidth:1024,innerHeight:768,HTMLElement:FakeElement,handlers:new Map(),addEventListener(){},removeEventListener(){}};
  const doc={defaultView:win,createElement:tag=>new FakeElement(tag),importNode:el=>el};
  class FloatingModal {
    constructor(){this.contentEl=doc.createElement('div');this.modalEl=doc.createElement('div');this.onOpen=()=>{};this.onClose=()=>{};modal=this}
    enableKeyCapture(){}
    open(){this.onOpen()}
    close(){this.onClose()}
  }
  const original=element('a','text',{fontSize:20});
  let scene=[structuredClone(original)],staged=new Map(),commits=0;
  const view={},notifications=[];
  const ea={targetView:view,plugin:{app:{}},style:{fontSize:20,fontFamily:1},
    FloatingModal,obsidian:{Notice:class {constructor(message){notifications.push(message)}},getIcon:()=>null},
    getScriptSettings:()=>({}),setScriptSettings:async()=>{},registerCleanup:()=>()=>{},
    getViewElements:()=>scene,getViewSelectedElements:()=>[scene[0]],
    getExcalidrawAPI:()=>({getAppState:()=>({selectedGroupIds:{}})}),
    measureText:()=>({width:100,height:25}),
    viewUpdateScene:({elements})=>{scene=structuredClone(elements)},
    clear:()=>{staged=new Map()},
    copyViewElementsToEAforEditing:els=>{staged=new Map(els.map(el=>[el.id,structuredClone(el)]))},
    getElement:id=>staged.get(id),
    addElementsToView:async()=>{commits++;scene=scene.map(el=>staged.get(el.id)??el);return true},
  };
  return {ea,utils:{},modal:()=>modal,scene:()=>scene,commits:()=>commits,notifications};
}

test('floating console previews and cancel/toggle clean up its session without committing',async()=>{
  const {openStyleConsole}=load('console');
  const h=consoleHarness();
  const bindings=[bind('s','fontSize','add',2)];
  const profile={version:1,name:'UI test',bindings};
  const pending=openStyleConsole(h.ea,h.utils,profile);
  const input=h.modal().contentEl.find(el=>el.tagName==='input');
  assert.ok(input);
  input.value='s';input.dispatch('input');
  assert.equal(h.scene()[0].fontSize,22);
  const toggle=openStyleConsole(h.ea,h.utils,profile);
  await toggle;await pending;
  assert.equal(h.scene()[0].fontSize,20);
  assert.equal(h.commits(),0);
});

test('floating console commits once through EA workbench and resolves on close',async()=>{
  const {openStyleConsole}=load('console');
  const h=consoleHarness();
  const pending=openStyleConsole(h.ea,h.utils,{version:1,name:'UI test',bindings:[bind('s','fontSize','add',2)]});
  const input=h.modal().contentEl.find(el=>el.tagName==='input');
  input.value='3s';input.dispatch('input');
  assert.equal(h.scene()[0].fontSize,26);
  input.dispatch('keydown',{key:'Enter'});
  await pending;
  assert.equal(h.scene()[0].fontSize,26);
  assert.equal(h.commits(),1);
});
