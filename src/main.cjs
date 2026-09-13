const {app,BrowserWindow,dialog,ipcMain}=require('electron');
const {readJSON,writeJSON,projectKey,draftCompatible}=require('./local-state.cjs');
const {writeCorrected}=require('./output.cjs');
const {Worker}=require('node:worker_threads');
// Preserve review history when upgrading from the original product name.
app.setPath('userData', process.env.LAYERPROOF_TEST_USER_DATA||require('node:path').join(app.getPath('appData'),'PDF OCR QC'));
app.setAppUserModelId('com.kendallfelder.pdfocrqc');
const fs=require('node:fs/promises'); const path=require('node:path');
const {decode,hash,scanPDFs,matchFiles,discoveryReport,saveRegister}=require('./register.cjs');
let window,helpWindow,session=null,saving=false;
const settingsPath=()=>path.join(app.getPath('userData'),'settings.json');
const settings=()=>readJSON(settingsPath(),{reviewer:'',projects:{}});
function projectSettings(){return settings().projects?.[projectKey(session.workbook)]||{};}
function remember(){const state=settings();state.lastProject={workbook:session.workbook,folder:session.folder};state.projects||={};state.projects[projectKey(session.workbook)]={outputFolder:session.outputFolder,outputs:session.outputs};writeJSON(settingsPath(),state);}
const draftPath=()=>path.join(app.getPath('userData'),'draft-'+projectKey(session.workbook)+'.json');
function storeDraft(payload){if(!session||payload.workbook!==session.workbook)throw Error('Project changed before draft could be saved.');if(payload.draft===null){require('node:fs').rmSync(draftPath(),{force:true});return true;}if(JSON.stringify(payload.draft).length>8e6)throw Error('Recovery draft is too large.');selectedRecord(payload.draft.key);writeJSON(draftPath(),{...payload.draft,savedAt:new Date().toISOString()});return true;}
ipcMain.on('draft-sync',(event,payload)=>{try{event.returnValue={ok:true,value:storeDraft(payload)};}catch(e){event.returnValue={ok:false,error:e.message};}});

async function showHelp(){
  if(helpWindow&&!helpWindow.isDestroyed()){helpWindow.show();helpWindow.focus();return;}
  helpWindow=new BrowserWindow({parent:window,width:1080,height:820,minWidth:640,minHeight:500,title:'LayerProof '+app.getVersion()+' — Help',icon:path.join(__dirname,'assets/layerproof.png'),webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
  helpWindow.setMenu(null);
  helpWindow.on('page-title-updated',event=>event.preventDefault());
  helpWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  helpWindow.on('closed',()=>{helpWindow=null;});
  await helpWindow.loadFile(path.join(__dirname,'help.html'));
}

const argument=name=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:null;};
function publicSession() {if(!session) return null; const {workbook,folder,sheet,records,files,reviews,diagnostics,outputFolder,outputs}=session; return {workbook,folder,sheet,records,files,reviews,diagnostics,outputFolder,outputs};}
async function loadSession(workbook,folder) {
  const wb=decode(await fs.readFile(workbook)); const {files,diagnostics}=await scanPDFs(folder);
  const statePath=path.join(app.getPath('userData'),'reviews-'+hash(Buffer.from(path.resolve(workbook)))+'.json');
  let reviews={};try{reviews=JSON.parse(await fs.readFile(statePath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('Saved review history could not be read. Restore or rename '+statePath);}
  session={workbook,folder,sheet:wb.sheet,records:wb.records.map(r=>({...r,...matchFiles(r.id,files)})),files,reviews,diagnostics,statePath,fingerprint:wb.fingerprint};
  const saved=projectSettings();session.outputFolder=saved.outputFolder||'';session.outputs=saved.outputs||{};remember();
  return publicSession();
}
async function persistReviews(){const temp=session.statePath+'.tmp';await fs.writeFile(temp,JSON.stringify(session.reviews,null,2));await fs.rename(temp,session.statePath);}
function selectedRecord(key){const r=session?.records.find(r=>r.key===key);if(!r)throw Error('Open a workbook and select a document first.');return r;}
function selectedFile(filename){if(!session?.files.some(f=>f.path===filename)&&!Object.values(session?.outputs||{}).includes(filename))throw Error('Choose a PDF from the selected document folder.');return filename;}
function handle(name,fn){ipcMain.handle(name,async(_event,...args)=>{try{return {ok:true,value:await fn(...args)};}catch(e){return {ok:false,error:e.message};}});}
handle('help',async()=>{await showHelp();return true;});
handle('preferences',async()=>settings());
handle('resume',async()=>{const last=settings().lastProject;if(!last)throw Error('No previous project saved.');return loadSession(last.workbook,last.folder);});
handle('reviewer',async name=>{name=String(name||'').trim();if(!name||name.length>100)throw Error('Enter your reviewer name (1–100 characters).');const state=settings();state.reviewer=name;writeJSON(settingsPath(),state);return name;});
handle('draft',async payload=>storeDraft(payload));
handle('recover',async()=>{if(!session)return null;return readJSON(draftPath(),null);});
handle('validate-draft',async draft=>{const row=selectedRecord(draft.key);await validatePDF(draft.pdf,draft.signature);if(!draftCompatible(draft,row,draft.signature))throw Error('The workbook row changed since this draft. Copy its notes before discarding; automatic restore was stopped.');return true;});
handle('output-folder',async()=>{if(!session)throw Error('Open a project first.');const picked=await dialog.showOpenDialog(window,{title:'Select corrected PDF output folder',defaultPath:session.outputFolder||path.dirname(session.folder),properties:['openDirectory','createDirectory']});if(picked.canceled)return null;session.outputFolder=await fs.realpath(picked.filePaths[0]);remember();return session.outputFolder;});
handle('initial',async()=>publicSession());
handle('open-session',async()=>{
  const w=await dialog.showOpenDialog(window,{title:'Open control workbook',filters:[{name:'Excel workbook',extensions:['xlsx']}],properties:['openFile']});if(w.canceled)return null;
  const f=await dialog.showOpenDialog(window,{title:'Select folder containing PDFs',properties:['openDirectory']});if(f.canceled)return null;
  return loadSession(w.filePaths[0],f.filePaths[0]);
});
handle('rescan',async changeFolder=>{
  if(!session)throw Error('Open a review project first.');
  let folder=session.folder;
  if(changeFolder){const result=await dialog.showOpenDialog(window,{title:'Select the root folder containing all project PDFs',defaultPath:folder,properties:['openDirectory']});if(result.canceled)return null;folder=result.filePaths[0];}
  const {files,diagnostics}=await scanPDFs(folder);
  session.folder=folder;remember();session.files=files;session.diagnostics=diagnostics;
  session.records=session.records.map(r=>({...r,...matchFiles(r.id,files)}));
  return publicSession();
});
handle('discovery',async()=>{if(!session)throw Error('Open a review project first.');return discoveryReport(session);});
handle('export-discovery',async()=>{
  if(!session)throw Error('Open a review project first.');
  const result=await dialog.showSaveDialog(window,{title:'Save document discovery report',defaultPath:'pdf-ocr-qc-discovery.json',filters:[{name:'JSON report',extensions:['json']}]});
  if(result.canceled)return null;
  await fs.writeFile(result.filePath,JSON.stringify(discoveryReport(session),null,2));return result.filePath;
});
let pdfBusy=false;
function pdfJob(data){return new Promise((resolve,reject)=>{
  const worker=new Worker(path.join(__dirname,'pdf-worker.cjs'),{workerData:data});let settled=false;
  const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);worker.terminate();error?reject(error):resolve(result);};
  const timer=setTimeout(()=>finish(Error('PDF correction timed out. Try fewer changes or a smaller PDF.')),120000);
  worker.once('message',message=>finish(message.ok?null:Error(message.error),message.result));
  worker.once('error',e=>finish(e));worker.once('exit',()=>{if(!settled)finish(Error('PDF editing worker stopped unexpectedly.'));});
});}
async function validatePDF(filename,signature){selectedFile(filename);const st=await fs.stat(filename);if(signature!==st.size+':'+st.mtimeMs)throw Error('The PDF changed. Reopen it before correcting text.');}
handle('inspect-ocr',async payload=>{
  if(pdfBusy||saving)throw Error('Wait for the current save or PDF operation.');pdfBusy=true;
  try{await validatePDF(payload.pdf,payload.signature);const result=await pdfJob({action:'inspect',filename:payload.pdf,page:payload.page});await validatePDF(payload.pdf,payload.signature);return result;}finally{pdfBusy=false;}
});
handle('export-corrections',async payload=>{
  if(pdfBusy||saving)throw Error('Wait for the current save or PDF operation.');pdfBusy=true;
  try{
    await validatePDF(payload.pdf,payload.signature);
    const originalSource=Object.keys(session.outputs).find(source=>session.outputs[source]===payload.pdf)||payload.pdf;
    if(!session.outputFolder){const picked=await dialog.showOpenDialog(window,{title:'Select corrected PDF output folder',defaultPath:path.dirname(session.folder),properties:['openDirectory','createDirectory']});if(picked.canceled)return null;session.outputFolder=await fs.realpath(picked.filePaths[0]);remember();}
    const outputFolder=await fs.realpath(session.outputFolder),destination=path.join(outputFolder,path.basename(originalSource));
    const normalize=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
    if(normalize(await fs.realpath(originalSource).catch(e=>{if(e.code==='ENOENT')return originalSource;throw e;}))===normalize(destination))throw Error('Choose a separate output folder; original PDFs are preserved.');
    const result=await pdfJob({action:'correct',filename:payload.pdf,edits:payload.edits,rotations:payload.rotations});
    if(hash(await fs.readFile(payload.pdf))!==result.sourceSha256)throw Error('The original PDF changed during export. Reopen it and reapply the correction.');
    const audit={application:'LayerProof',version:app.getVersion(),publisher:'Melken TechWork',exportedAt:new Date().toISOString(),source:payload.pdf,originalSource,output:destination,sourceSha256:result.sourceSha256,outputSha256:result.outputSha256,verification:result.verification,corrections:payload.edits,rotations:result.verification.rotations};
    const written=await writeCorrected(destination,result.bytes,audit);session.outputs[originalSource]=destination;remember();
    return {...written,verification:result.verification,session:publicSession()};
  }finally{pdfBusy=false;}
});
handle('read-pdf',async filename=>{selectedFile(filename);const stat=await fs.stat(filename),bytes=await fs.readFile(filename);let kind=Object.values(session.outputs).includes(filename)?'Corrected copy':'Original PDF';try{const audit=JSON.parse(await fs.readFile(filename+'.corrections.json','utf8'));if(audit.application==='LayerProof'&&audit.outputSha256===hash(bytes)){kind='Corrected copy';session.outputs[audit.originalSource||audit.source]=filename;session.outputFolder||=path.dirname(filename);remember();}}catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}return {bytes,signature:stat.size+':'+stat.mtimeMs,kind,session:publicSession()};});
handle('save-review',async payload=>{
  if(saving||pdfBusy)throw Error('A save or PDF operation is already in progress.'); saving=true;
  try{
    const r=selectedRecord(payload.key);selectedFile(payload.pdf);
    const st=await fs.stat(payload.pdf);if(payload.signature!==st.size+':'+st.mtimeMs)throw Error('The PDF changed. Reopen it before saving.');
    if(!Number.isInteger(payload.pageCount)||payload.pageCount<1||!Array.isArray(payload.checkedPages))throw Error('Load the PDF before saving.');
    const checkedPages=[...new Set(payload.checkedPages)].filter(p=>Number.isInteger(p)&&p>=1&&p<=payload.pageCount);
    if(payload.hasIssues==='No' && checkedPages.length!==payload.pageCount)throw Error('Mark every page checked before recording No issues.');
    const reviewer=String(payload.reviewer||'').trim();if(!reviewer||reviewer.length>100)throw Error('Enter your reviewer name before saving.');const preferences=settings();preferences.reviewer=reviewer;writeJSON(settingsPath(),preferences);
    const concerns=String(payload.concerns??'');
    const legacyReviewedKeys=session.records.filter(record=>{const review=session.reviews[record.key];return review?.complete&&review.id===record.id&&review.hasIssues===record.hasIssues&&review.concerns===record.concerns;}).map(record=>record.key);
    const saved=await saveRegister(session.workbook,session.fingerprint,r.key,payload.hasIssues,concerns,checkedPages.length===payload.pageCount,legacyReviewedKeys,{reviewer,completedAt:checkedPages.length===payload.pageCount?new Date().toISOString():''});
    const storedRows=new Map(saved.records.map(row=>[row.key,row]));
    for(const record of session.records)Object.assign(record,{qcReviewed:storedRows.get(record.key).qcReviewed,qcReviewer:storedRows.get(record.key).qcReviewer,qcReviewedOn:storedRows.get(record.key).qcReviewedOn});
    session.fingerprint=saved.fingerprint;r.hasIssues=payload.hasIssues;r.concerns=concerns;
    session.reviews[r.key]={id:r.id,pdf:payload.pdf,signature:payload.signature,checkedPages,pageCount:payload.pageCount,complete:checkedPages.length===payload.pageCount,hasIssues:r.hasIssues,concerns,savedAt:new Date().toISOString(),backup:saved.backup};
    let warning='';try{await persistReviews();}catch(e){warning='Workbook saved, but review history could not be saved: '+e.message;}
    return {session:publicSession(),backup:saved.backup,warning};
  }finally{saving=false;}
});
app.whenReady().then(async()=>{
  const workbook=argument('--workbook'),folder=argument('--pdf-folder');
  let startupError='';if(workbook&&folder)try{await loadSession(workbook,folder);}catch(e){startupError=e.message;}
  window=new BrowserWindow({width:1550,height:1000,minWidth:1050,minHeight:720,backgroundColor:'#eef2f4',title:'LayerProof',icon:path.join(__dirname,'assets/layerproof.png'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  if(process.env.QC_DEBUG) window.webContents.on('console-message', (event, ...args)=>console.log('renderer:', event.message || args));
  window.webContents.on('before-input-event',(event,input)=>{if(input.type==='keyDown'&&input.key==='F1'){event.preventDefault();showHelp().catch(e=>dialog.showErrorBox('Help could not open',e.message));}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',e=>e.preventDefault());
  window.webContents.on('will-prevent-unload',event=>{const choice=dialog.showMessageBoxSync(window,{type:'question',buttons:['Keep reviewing','Close and keep recovery draft'],defaultId:0,cancelId:0,message:'This review has unsaved changes.'});if(choice===1)event.preventDefault();});
  await window.loadFile(path.join(__dirname,'index.html'));
  if(startupError)dialog.showErrorBox('Could not open review project',startupError);
});
app.on('window-all-closed',()=>app.quit());
