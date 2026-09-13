const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function readOutput(filename){
 const [bytes,log]=await Promise.all([fs.readFile(filename),fs.readFile(filename+'.corrections.json','utf8')]);
 const audit=JSON.parse(log);
 if(audit.application!=='LayerProof'||audit.outputSha256!==hash(bytes))throw Error('Corrected PDF or change log changed. Re-export and verify the corrected copy.');
 return {bytes,audit};
}
async function requireVerified(filename){
 const result=await readOutput(filename),v=result.audit.reviewVerification;
 if(!v||v.outputSha256!==result.audit.outputSha256||!v.reviewer||!v.verifiedAt)throw Error('Open the latest corrected copy, check its pages, then choose Verify corrected copy before completing this document.');
 return result;
}
async function verifyOutput(filename,reviewer){
 reviewer=String(reviewer||'').trim();if(!reviewer||reviewer.length>100)throw Error('Enter your reviewer name before verifying.');
 const lock=filename+'.layerproof.lock',handle=await fs.open(lock,'wx').catch(e=>{if(e.code==='EEXIST')throw Error('A PDF export is in progress. Retry verification when it finishes.');throw e;});
 const temp=filename+'.verification-'+crypto.randomUUID()+'.tmp';
 try{const {audit}=await readOutput(filename);audit.reviewVerification={reviewer,verifiedAt:new Date().toISOString(),outputSha256:audit.outputSha256};await fs.writeFile(temp,JSON.stringify(audit,null,2),{flag:'wx'});if(hash(await fs.readFile(filename))!==audit.outputSha256)throw Error('Corrected PDF changed during verification. Reopen it.');await fs.rename(temp,filename+'.corrections.json');return audit.reviewVerification;}
 finally{await fs.rm(temp,{force:true});await handle.close();await fs.rm(lock,{force:true});}
}
const csvCell=value=>'"'+String(value??'').replace(/^[=+@\-\t\r]/,"'$&").replace(/"/g,'""')+'"';
async function createHandoff(parent,session,version){
 const folder=path.join(parent,'LayerProof-handoff-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(3).toString('hex'));
 await fs.mkdir(folder);let copied=0;
 try{
  const rows=[],warnings=[];
  for(const r of session.records){
   const previous=session.reviews?.[r.key]?.pdf;
   const selected=r.pdfAssignment?r.exact?.[0]:previous||r.exact?.[0];
   const original=Object.keys(session.outputs).find(source=>session.outputs[source]===selected)||selected;
   const output=session.outputs[original];let delivered='';let status=r.qcReviewed?'Reviewed':'Needs review';
   if(output){
    if(!r.qcReviewed)warnings.push(`Excel row ${r.row}: corrected PDF excluded because review is incomplete.`);
    else try{
     const {bytes,audit}=await requireVerified(output);
     // Each Excel row gets a folder, retaining the PDF basename without collisions.
     const relative=path.posix.join('corrected-pdfs','row-'+r.row,path.basename(output));
     await fs.mkdir(path.dirname(path.join(folder,relative)),{recursive:true});
     await fs.writeFile(path.join(folder,relative),bytes,{flag:'wx'});
     if(hash(await fs.readFile(path.join(folder,relative)))!==audit.outputSha256)throw Error('Copied PDF failed its checksum.');
     const portableAudit={...audit,source:r.pdfAssignment||path.basename(audit.source),originalSource:r.pdfAssignment||path.basename(audit.originalSource||audit.source),output:relative};
     await fs.writeFile(path.join(folder,relative+'.corrections.json'),JSON.stringify(portableAudit,null,2),{flag:'wx'});delivered=relative;copied++;
    }catch(e){if(e.code&&e.code!=='ENOENT')throw e;status='Needs corrected-copy verification';warnings.push(`Excel row ${r.row}: ${e.message}`);}
   }
   rows.push({documentId:r.id,excelRow:r.row,status,hasIssues:r.hasIssues,concerns:r.concerns,reviewer:r.qcReviewer,reviewedOn:r.qcReviewedOn,pdfAssignment:r.pdfAssignment||'',correctedPDF:delivered});
  }
  const keys=['documentId','excelRow','status','hasIssues','concerns','reviewer','reviewedOn','pdfAssignment','correctedPDF'];
  await fs.writeFile(path.join(folder,'review-summary.csv'),'\ufeff'+[keys.map(csvCell).join(','),...rows.map(r=>keys.map(k=>csvCell(r[k])).join(','))].join('\r\n'),{flag:'wx'});
  const report={application:'LayerProof',version,createdAt:new Date().toISOString(),totalDocuments:rows.length,correctedPDFs:copied,warnings,documents:rows};
  await fs.writeFile(path.join(folder,'manifest.json'),JSON.stringify(report,null,2),{flag:'wx'});
  await fs.writeFile(path.join(folder,'README.txt'),`LayerProof client handoff\nCreated ${report.createdAt}\n\n${copied} verified corrected PDF(s). Original PDFs are not included.\nReview-summary.csv contains all saved workbook rows, reviewer names, dates and concerns.\nPending work and exclusions appear in manifest.json. This package includes only the current computer's registered corrected outputs.\nPDF filenames are preserved inside separate Excel-row folders. Each PDF has a change log and SHA-256 checksum.\n\n${warnings.join('\n')}\n`,{flag:'wx'});
  return {folder,copied,warnings: warnings.length};
 }catch(e){await fs.rm(folder,{recursive:true,force:true});throw e;}
}
module.exports={readOutput,verifyOutput,requireVerified,createHandoff};
