const {fields:accessibilityFields}=require('./accessibility.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { unzipSync, zipSync, strFromU8, strToU8 } = require('fflate');
const { XMLParser } = require('fast-xml-parser');
const parser = new XMLParser({ignoreAttributes:false, attributeNamePrefix:'@', parseTagValue:false, trimValues:false});
const array = x => x == null ? [] : Array.isArray(x) ? x : [x];
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const plain = x => x == null ? '' : typeof x === 'object' ? String(x['#text'] ?? '') : String(x);
const richText = x => x?.r ? array(x.r).map(r=>plain(r.t)).join('') : plain(x?.t);
const normalize = id => String(id ?? '').trim().replace(/\.pdf$/i,'').toLowerCase();
const colNumber = col => [...col].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
const colName = n => {let s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s;};
const reviewedValue = value => /^(yes|true|1)$/i.test(String(value??'').trim());
function decode(buffer) {
  const files = unzipSync(buffer);
  const xml = p => files[p] ? parser.parse(strFromU8(files[p])) : {};
  const strings = array(xml('xl/sharedStrings.xml').sst?.si).map(richText);
  const rels = array(xml('xl/_rels/workbook.xml.rels').Relationships?.Relationship);
  const sheets = array(xml('xl/workbook.xml').workbook?.sheets?.sheet);
  const registers=[];
  for (const sheet of sheets) {
    const target=rels.find(r=>r['@Id']===sheet['@r:id'])?.['@Target'];
    if (!target) continue;
    const member=target.startsWith('/') ? target.slice(1) : path.posix.normalize('xl/'+target);
    const rows=array(xml(member).worksheet?.sheetData?.row).map(r=>{
      const cells={};
      for(const c of array(r.c)) {
        const col=c['@r']?.replace(/[0-9]/g,'');
        cells[col]= c['@t']==='s' ? strings[Number(c.v)] ?? '' : c['@t']==='inlineStr' ? richText(c.is) : plain(c.v);
      }
      return {row:Number(r['@r']),cells};
    });
    const header=rows.find(r=>normalize(r.cells.A)==='document id' && normalize(r.cells.D)==='has issues');
    if(header) {
      const qcColumns=Object.keys(header.cells).filter(col=>['qc reviewed','qc performed'].includes(String(header.cells[col]).trim().toLowerCase()));
      if(qcColumns.length>1)throw Error('Multiple QC review columns found. Keep one QC Reviewed or QC Performed column.');
      const qcColumn=qcColumns[0]||null;
      const auditColumn=name=>{const columns=Object.keys(header.cells).filter(c=>String(header.cells[c]).trim().toLowerCase()===name);if(columns.length>1||columns.some(c=>colNumber(c)<=5))throw Error('Use one '+name+' column after A–E.');return columns[0]||null;};
      const accessibilityColumns=Object.fromEntries(Object.entries(accessibilityFields).map(([key,title])=>[key,auditColumn(title.toLowerCase())]));
      const reviewerColumn=auditColumn('qc reviewed by'),reviewedOnColumn=auditColumn('qc reviewed on'),assignmentColumn=auditColumn('pdf assignment');
      if(qcColumn&&colNumber(qcColumn)<=5)throw Error('Place QC Reviewed after the existing A–E control columns.');
      // Append beyond every existing cell and merged range, never overwrite a client column.
      const refs=[...strFromU8(files[member]).matchAll(/\b(?:r|ref)="([A-Z]+)[0-9]+(?::([A-Z]+)[0-9]+)?"/g)];
      const lastColumn=refs.reduce((max,m)=>Math.max(max,colNumber(m[1]),m[2]?colNumber(m[2]):0),5);
      registers.push({sheet:sheet['@name'],member,headerRow:header.row,accessibilityColumns,qcColumn,reviewerColumn,reviewedOnColumn,assignmentColumn,nextColumn:colName(lastColumn+1),records:rows.filter(r=>r.row>header.row && r.cells.A?.trim()).map(r=>({key:member+':'+r.row,row:r.row,id:r.cells.A,format:r.cells.B||'',compliant:r.cells.C||'',hasIssues:r.cells.D||'',concerns:r.cells.E||'',qcReviewed:qcColumn?reviewedValue(r.cells[qcColumn]):null,qcReviewer:r.cells[reviewerColumn]||'',qcReviewedOn:r.cells[reviewedOnColumn]||'',pdfAssignment:r.cells[assignmentColumn]||'',accessibility:Object.fromEntries(Object.entries(accessibilityColumns).map(([key,col])=>[key,r.cells[col]||'']))}))});
    }
  }
  if(registers.length!==1) throw Error(registers.length ? 'Multiple control sheets found. Use a workbook with one Document ID / Has Issues register.' : 'No control sheet found. Expected Document ID in column A and Has Issues in column D.');
  const result=registers[0];
  const counts=new Map(); result.records.forEach(r=>counts.set(normalize(r.id),(counts.get(normalize(r.id))||0)+1));
  result.records.forEach(r=>r.duplicate=counts.get(normalize(r.id))>1);
  return {...result, files, fingerprint:hash(buffer)};
}
const escape = s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function patchCell(xml, address, text) {
  if (text.length>32767 || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(text)) throw Error('Concern text contains unsupported characters or exceeds Excel’s 32,767-character cell limit.');
  const row=address.match(/\d+$/)[0];
  const rowPattern=new RegExp(`<row\\b(?=[^>]*\\br="${row}")[^>]*>[\\s\\S]*?<\\/row>`);
  if(!rowPattern.test(xml)) throw Error('The selected Excel row no longer exists.');
  return xml.replace(rowPattern, rowXml=>{
    const cellPattern=new RegExp(`<c\\b(?=[^>]*\\br="${address}")[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)`);
    const existing=rowXml.match(cellPattern)?.[0];
    const style=existing?.match(/\bs="[^"]*"/)?.[0];
    const cell=`<c r="${address}"${style?' '+style:''} t="inlineStr"><is><t xml:space="preserve">${escape(text)}</t></is></c>`;
    if(existing) return rowXml.replace(cellPattern,cell);
    const col=address.replace(/\d/g,'');
    const later=Array.from(rowXml.matchAll(/<c\b[^>]*\br="([A-Z]+)\d+"/g)).find(m=>m[1].length>col.length || (m[1].length===col.length && m[1]>col));
    return later ? rowXml.slice(0,later.index)+cell+rowXml.slice(later.index) : rowXml.replace('</row>',cell+'</row>');
  });
}
function updateBuffer(buffer,key,hasIssues,concerns,reviewed,legacyReviewedKeys=[],audit=null) {
  if(reviewed!==undefined && typeof reviewed!=='boolean')throw Error('QC Reviewed must be true or false.');
  if(!['Yes','No'].includes(hasIssues)) throw Error('Select Yes or No.');
  if(hasIssues==='Yes' && !concerns.trim()) throw Error('Describe the issues before saving Yes.');
  if(hasIssues==='No' && concerns.trim()) throw Error('Clear concerns before saving No.');
  const wb=decode(buffer); const record=wb.records.find(r=>r.key===key);
  if(!record) throw Error('Selected row not found. Reload the workbook.');
  let xml=strFromU8(wb.files[wb.member]);
  xml=patchCell(xml,'D'+record.row,hasIssues); xml=patchCell(xml,'E'+record.row,concerns);
  if(reviewed!==undefined){
    let column=wb.qcColumn||wb.nextColumn;
    if(colNumber(column)>16384)throw Error('No free Excel column remains for QC Reviewed.');
    if(!wb.qcColumn){
      xml=patchCell(xml,column+wb.headerRow,'QC Reviewed');
      const legacy=new Set(legacyReviewedKeys);
      for(const other of wb.records)if(other.key!==key&&legacy.has(other.key))xml=patchCell(xml,column+other.row,'Yes');
    }
    xml=patchCell(xml,column+record.row,reviewed?'Yes':'No');
    if(audit){
      if(typeof audit.reviewer!=='string'||!audit.reviewer.trim()||audit.reviewer.length>100)throw Error('Reviewer name is required.');
      if(reviewed&&!/^\d{4}-\d\d-\d\dT/.test(audit.completedAt||''))throw Error('Completion date is required.');
      let next=Math.max(colNumber(wb.nextColumn),colNumber(column)+1);
      const reviewerCol=wb.reviewerColumn||colName(next++),dateCol=wb.reviewedOnColumn||colName(next++);
      if(Math.max(colNumber(reviewerCol),colNumber(dateCol))>16384)throw Error('No free Excel columns remain for review details.');
      if(!wb.reviewerColumn)xml=patchCell(xml,reviewerCol+wb.headerRow,'QC Reviewed By');
      if(!wb.reviewedOnColumn)xml=patchCell(xml,dateCol+wb.headerRow,'QC Reviewed On');
      xml=patchCell(xml,reviewerCol+record.row,audit.reviewer.trim());xml=patchCell(xml,dateCol+record.row,reviewed?audit.completedAt:'');
      column=colName(Math.max(colNumber(column),colNumber(reviewerCol),colNumber(dateCol)));
      if(audit.pdfAssignment!==undefined){
        const assignment=require('./assignments.cjs').portablePath(audit.pdfAssignment);
        const assignmentCol=wb.assignmentColumn||colName(Math.max(next,colNumber(column)+1));
        if(colNumber(assignmentCol)>16384)throw Error('No free Excel column remains for PDF Assignment.');
        if(!wb.assignmentColumn)xml=patchCell(xml,assignmentCol+wb.headerRow,'PDF Assignment');
        xml=patchCell(xml,assignmentCol+record.row,assignment);
        column=colName(Math.max(colNumber(column),colNumber(assignmentCol)));
      }
    }
    if(audit?.accessibility){
      let next=Math.max(colNumber(wb.nextColumn),colNumber(column)+1);
      for(const [key,title] of Object.entries(accessibilityFields)){
        const c=wb.accessibilityColumns[key]||colName(next++);
        if(colNumber(c)>16384)throw Error('No free Excel columns remain for accessibility results.');
        if(!wb.accessibilityColumns[key])xml=patchCell(xml,c+wb.headerRow,title);
        xml=patchCell(xml,c+record.row,String(audit.accessibility[key]||''));
        column=colName(Math.max(colNumber(column),colNumber(c)));
      }
    }
    // Keep the used range accurate for Excel and readers that honor dimension.
    xml=xml.replace(/<dimension\b[^>]*\bref="([A-Z]+)([0-9]+)(?::([A-Z]+)([0-9]+))?"[^>]*\/>/,(_,left,top,right,bottom)=>`<dimension ref="${left}${top}:${colName(Math.max(colNumber(right||left),colNumber(column)))}${wb.records.reduce((max,r)=>Math.max(max,r.row),Number(bottom||top))}"/>`);
  }
  wb.files[wb.member]=strToU8(xml);
  return zipSync(wb.files);
}
async function scanPDFsOnce(folder) {
  const result=[],warnings=[],visited=new Set();let directories=0,otherFiles=0;
  async function walk(dir,isRoot=false) {
    let entries;
    try {
      const real=await fs.realpath(dir);
      // Windows junctions/symlinks can point back to ancestors. Scan each real folder once.
      const identity=process.platform==='win32'?real.toLowerCase():real;
      if(visited.has(identity))return;
      entries=await fs.readdir(dir,{withFileTypes:true});visited.add(identity);directories++;
    }catch(e){if(isRoot)throw Error('Cannot read the selected PDF folder: '+e.message);warnings.push({path:dir,error:e.code||e.message});return;}
    for(const entry of entries){
      const filename=path.join(dir,entry.name);let info=entry;
      try{if(entry.isSymbolicLink()||(!entry.isDirectory()&&!entry.isFile()))info=await fs.stat(filename);}catch(e){warnings.push({path:filename,error:e.code||e.message});continue;}
      if(info.isDirectory())await walk(filename);
      else if(info.isFile()){
        if(/\.pdf$/i.test(entry.name))result.push({path:filename,name:entry.name,relative:path.relative(folder,filename)});
        else otherFiles++;
      }
    }
  }
  await walk(folder,true);
  return {files:result.sort((a,b)=>a.relative.localeCompare(b.relative)),diagnostics:{folder,directories,otherFiles,warnings,scannedAt:new Date().toISOString()}};
}
// Verify fresh directory snapshots before presenting the queue. Do not merge old
// paths into the newest result: removed files must not survive verification.
async function scanPDFs(folder, {pauseMs=400}={}) {
  let previous=null,latest,stable=false;const passes=[];
  const keyFor=result=>JSON.stringify({paths:result.files.map(f=>f.path).sort(),warnings:result.diagnostics.warnings.map(w=>w.path+':'+w.error).sort()});
  for(let pass=1;pass<=3;pass++){
    if(pass>1 && pauseMs)await new Promise(resolve=>setTimeout(resolve,pauseMs));
    latest=await scanPDFsOnce(folder);
    const currentPaths=new Set(latest.files.map(f=>f.path));
    const previousPaths=new Set(previous?.files.map(f=>f.path)||[]);
    passes.push({pass,pdfCount:latest.files.length,directories:latest.diagnostics.directories,warningCount:latest.diagnostics.warnings.length,
      added:previous?[...currentPaths].filter(p=>!previousPaths.has(p)):[],
      removed:previous?[...previousPaths].filter(p=>!currentPaths.has(p)):[]});
    if(previous && keyFor(previous)===keyFor(latest)){stable=true;break;}
    previous=latest;
  }
  latest.diagnostics.verification={stable,passes};
  if(!stable)latest.diagnostics.warnings.push({path:folder,error:'Folder listings changed across three scans. Results show the latest scan; rescan when file transfers have finished.'});
  return latest;
}
async function listPDFs(folder){return (await scanPDFs(folder)).files;}
function matchFiles(id,files) {
  const key=normalize(id).normalize('NFKC');
  const stem=f=>normalize(f.name).normalize('NFKC');
  const exact=files.filter(f=>stem(f)===key);
  // A looser match is only a suggestion, never an automatic assignment.
  // Numeric tokens support 00040, Document(40), and DOC40 without matching 140.
  const digits=/^\d+$/.test(key)?key.replace(/^0+(?=\d)/,''):null;
  const suggested=files.filter(f=>!exact.includes(f) && (
    stem(f).split(/[^\p{L}\p{N}]+/u).includes(key) ||
    digits!==null && (stem(f).match(/\d+/g)||[]).some(n=>n.replace(/^0+(?=\d)/,'')===digits)
  ));
  return {exact:exact.map(f=>f.path),suggested:suggested.map(f=>f.path)};
}
function discoveryReport(session){
  const rows=session.records.map(r=>({row:r.row,id:r.id,status:r.exact.length===1?'exact':r.exact.length>1?'ambiguous':r.suggested.length?'suggested':'unmatched',exact:r.exact,suggested:r.suggested}));
  return {workbook:session.workbook,folder:session.folder,...session.diagnostics,pdfCount:session.files.length,rowCounts:{exact:rows.filter(r=>r.status==='exact').length,ambiguous:rows.filter(r=>r.status==='ambiguous').length,suggested:rows.filter(r=>r.status==='suggested').length,unmatched:rows.filter(r=>r.status==='unmatched').length},rows,files:session.files};
}
async function saveRegister(filename,expectedHash,key,hasIssues,concerns,reviewed,legacyReviewedKeys=[],audit=null) {
  const lock=filename+'.ocr-qc.lock'; let handle;
  try {handle=await fs.open(lock,'wx');} catch(e) {if(e.code==='EEXIST') throw Error('Another review save is in progress. If no app is saving, remove the stale .ocr-qc.lock file.'); throw e;}
  let temp;
  try {
    const before=await fs.readFile(filename);
    if(hash(before)!==expectedHash) throw Error('Workbook changed outside this session. Reopen it before saving; your on-screen edits are still available.');
    const updated=updateBuffer(before,key,hasIssues,concerns,reviewed,legacyReviewedKeys,audit);
    const stamp=new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(3).toString('hex');
    const backup=filename+'.backups'; await fs.mkdir(backup,{recursive:true});
    const backupFile=path.join(backup,path.basename(filename,'.xlsx')+'-'+stamp+'.xlsx');
    await fs.writeFile(backupFile,before,{flag:'wx'});
    temp=path.join(path.dirname(filename),'.ocr-qc-'+stamp+'.tmp');
    await fs.writeFile(temp,updated,{flag:'wx'});
    if(hash(await fs.readFile(filename))!==expectedHash) throw Error('Workbook changed while saving. Reopen the workbook and retry.');
    await fs.rename(temp,filename); temp=null;
    return {fingerprint:hash(updated),backup:backupFile,records:decode(updated).records};
  } catch(e) {
    if(['EBUSY','EPERM','EACCES'].includes(e.code)) throw Error('Cannot write the workbook. Close it in Excel and check folder permissions, then retry.');
    throw e;
  } finally {if(temp) await fs.unlink(temp).catch(()=>{}); await handle.close(); await fs.unlink(lock).catch(()=>{});}
}
module.exports={decode,hash,normalize,updateBuffer,listPDFs,scanPDFs,matchFiles,discoveryReport,saveRegister};
