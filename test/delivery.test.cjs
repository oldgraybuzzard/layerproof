const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const {hash}=require('../src/register.cjs');const {writeCorrected}=require('../src/output.cjs');const {verifyOutput,requireVerified,createHandoff}=require('../src/delivery.cjs');
test('verification is tied to exact PDF bytes; a re-export requires a fresh verification',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'layerproof-delivery-'));try{
 const file=path.join(dir,'40.pdf'),bytes=Buffer.from('fixture pdf');const audit={application:'LayerProof',source:'/source/40.pdf',originalSource:'/source/40.pdf',outputSha256:hash(bytes)};
 await writeCorrected(file,bytes,audit);await assert.rejects(()=>requireVerified(file),/latest corrected/);
 await verifyOutput(file,'Reviewer');assert.equal((await requireVerified(file)).audit.reviewVerification.reviewer,'Reviewer');
 const newer=Buffer.from('new bytes');await writeCorrected(file,newer,{...audit,outputSha256:hash(newer)});await assert.rejects(()=>requireVerified(file),/latest corrected/);
 await assert.rejects(()=>verifyOutput(file,'Reviewer',hash(bytes)),/changed after/);await verifyOutput(file,'Reviewer',hash(newer));await fs.appendFile(file,'tampering');await assert.rejects(()=>requireVerified(file),/changed/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('handoff includes only completed verified outputs, keeps filenames, protects CSV, and excludes machine paths',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'layerproof-handoff-'));try{
 const source='/private/client/40.pdf',output=path.join(dir,'40.pdf'),bytes=Buffer.from('pdf');await writeCorrected(output,bytes,{application:'LayerProof',source,originalSource:source,outputSha256:hash(bytes)});await verifyOutput(output,'Worker');
 const row={key:'row1',id:'=40',row:3,qcReviewed:true,hasIssues:'Yes',concerns:'Line one\n"two"',qcReviewer:'Worker',qcReviewedOn:'2026-09-13',pdfAssignment:'batch/40.pdf',exact:[source]};
 const session={records:[row,{...row,key:'row2',row:4,qcReviewed:false}],reviews:{},outputs:{[source]:output}};
 const made=await createHandoff(dir,session,'test');assert.equal(made.copied,1);assert.equal(made.warnings,1);assert.deepEqual(await fs.readFile(path.join(made.folder,'corrected-pdfs/row-3/40.pdf')),bytes);
 const summary=await fs.readFile(path.join(made.folder,'review-summary.csv'),'utf8');assert.match(summary,/'=40/);assert.match(summary,/Line one\n""two""/);assert(!summary.includes('/private/client'));
 const manifest=JSON.parse(await fs.readFile(path.join(made.folder,'manifest.json'),'utf8'));assert.equal(manifest.documents[1].correctedPDF,'');
 const log=await fs.readFile(path.join(made.folder,'corrected-pdfs/row-3/40.pdf.corrections.json'),'utf8');assert(!log.includes('/private/client'));
 await fs.appendFile(output,'changed');const excluded=await createHandoff(dir,session,'test');assert.equal(excluded.copied,0);assert.equal(excluded.warnings,2);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('signed build fails closed without credentials and enables mandatory signing for both providers',async()=>{
 const {signingConfig}=require('../scripts/signing-config.cjs');assert.throws(()=>signingConfig({}),/requires/);
 const base={LAYERPROOF_SIGNING_PROVIDER:'certificate',LAYERPROOF_SIGNING_PUBLISHER:'Example Publisher',WIN_CSC_LINK:'test-only',WIN_CSC_KEY_PASSWORD:'test-only'};
 const certificate=signingConfig(base);assert.equal(certificate.win.signExecutable,true);assert.equal(certificate.win.forceCodeSigning,true);assert.equal(certificate.nsis.createDesktopShortcut,true);
 const azure=signingConfig({...base,LAYERPROOF_SIGNING_PROVIDER:'azure',AZURE_TENANT_ID:'test',AZURE_CLIENT_ID:'test',AZURE_CLIENT_SECRET:'test',AZURE_SIGNING_ENDPOINT:'https://example.codesigning.azure.net',AZURE_SIGNING_ACCOUNT:'test',AZURE_SIGNING_PROFILE:'test'});assert.equal(azure.win.azureSignOptions.certificateProfileName,'test');assert.equal(azure.win.signtoolOptions,undefined);const {validateConfiguration}=require('app-builder-lib/out/util/config/config.js');await validateConfiguration(certificate,{isEnabled:false});await validateConfiguration(azure,{isEnabled:false});
});
