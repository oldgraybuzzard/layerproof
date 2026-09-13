const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const {scanPDFs,matchFiles,discoveryReport}=require('../src/register.cjs');
test('numbered Windows filename variants are suggestions, never silent assignments',()=>{
 const files=['00040.PDF','Document(40).pdf','DOC40-final.pdf','140.pdf','2040.pdf','40_53_combined.pdf'].map(name=>({name,path:'C:\\Ready for Delivery\\State\\'+name}));
 const matches=matchFiles('40',files);assert.equal(matches.exact.length,0);assert.equal(matches.suggested.length,4);assert(!matches.suggested.some(p=>p.endsWith('140.pdf')||p.endsWith('2040.pdf')));
});
test('duplicate exact filenames stay ambiguous across subfolders',()=>{
 const files=[{name:'40.pdf',path:'C:\\Root\\A\\40.pdf'},{name:'40.PDF',path:'C:\\Root\\B\\40.PDF'}];assert.equal(matchFiles('40',files).exact.length,2);
});
test('scan descends nested folders and follows directory links without cycles',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'qc-scan-'));const outside=await fs.mkdtemp(path.join(os.tmpdir(),'qc-linked-'));
 try{await fs.mkdir(path.join(root,'nested'));await fs.writeFile(path.join(root,'nested','40.PDF'),'fixture');await fs.writeFile(path.join(root,'readme.txt'),'fixture');await fs.writeFile(path.join(outside,'53.pdf'),'fixture');await fs.symlink(outside,path.join(root,'linked'),process.platform==='win32'?'junction':'dir');await fs.symlink(root,path.join(outside,'cycle'),process.platform==='win32'?'junction':'dir');
 const scan=await scanPDFs(root);assert.deepEqual(scan.files.map(f=>f.name).sort(),['40.PDF','53.pdf']);assert.equal(scan.diagnostics.directories,3);assert.equal(scan.diagnostics.otherFiles,1);assert.equal(scan.diagnostics.warnings.length,0);
 }finally{await fs.rm(root,{recursive:true,force:true});await fs.rm(outside,{recursive:true,force:true});}
});
test('unreadable nested folder is reported while other PDFs remain available',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'qc-scan-error-'));const original=fs.readdir;
 try{await fs.mkdir(path.join(root,'denied'));await fs.writeFile(path.join(root,'40.pdf'),'fixture');fs.readdir=async(p,...args)=>{if(p===path.join(root,'denied')){const e=Error('access denied');e.code='EACCES';throw e;}return original(p,...args);};const scan=await scanPDFs(root);assert.equal(scan.files.length,1);assert.equal(scan.diagnostics.warnings[0].error,'EACCES');assert.equal(scan.diagnostics.warnings[0].path,path.join(root,'denied'));}
 finally{fs.readdir=original;await fs.rm(root,{recursive:true,force:true});}
});
test('report reconciles every workbook row and lists original paths',()=>{
 const files=[{name:'40.pdf',path:'C:\\Root\\40.pdf'},{name:'DOC53.pdf',path:'C:\\Root\\DOC53.pdf'}];const records=['40','53','54'].map((id,i)=>({id,row:i+3,...matchFiles(id,files)}));const report=discoveryReport({workbook:'control.xlsx',folder:'C:\\Root',files,records,diagnostics:{directories:1,warnings:[]}});assert.deepEqual(report.rowCounts,{exact:1,ambiguous:0,suggested:1,unmatched:1});assert.equal(report.rows[2].id,'54');assert.equal(report.files[0].path,'C:\\Root\\40.pdf');
});
