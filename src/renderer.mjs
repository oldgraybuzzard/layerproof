import * as pdfjs from '../node_modules/pdfjs-dist/build/pdf.mjs';
import {errorRates} from './metrics.mjs';
import {matchingReview,isComplete,queueRows,nextPending,projectSummary} from './queue.mjs';
import {nextCheckedPage,paneShare,matchingTextObject,mergedCorrections,pendingRotationCount} from './review-controls.mjs';
pdfjs.GlobalWorkerOptions.workerSrc=new URL('../node_modules/pdfjs-dist/build/pdf.worker.mjs',import.meta.url).href;
const $=id=>document.getElementById(id);
let session=null,record=null,pdf=null,pdfPath='',signature='',pageNumber=1,zoom=1,pageText='',segments=[],selected=-1,checked=new Set(),dirty=false,loadVersion=0,renderVersion=0,renderTask=null,loadingTask=null,busy=false,refs={},pageFindings=new Map();
let viewRotations=new Map(),exportedRotations=new Map(),viewDeskews=new Map(),exportedDeskews=new Map(),outputVerified=null,correctedOpen=false;
const pendingPDFChanges=()=>pendingCorrections.size+pendingRotationCount(viewRotations,exportedRotations)+pendingRotationCount(viewDeskews,exportedDeskews);
let pendingCorrections=new Map(),exportedCorrections=new Map(),correctionObjects=[],correctionPage=0;
const notice=(message,error=false)=>{$('notice').textContent=message;$('notice').classList.toggle('error',error);$('notice').title=message;};
const guarded=fn=>async(...args)=>{try{await fn(...args);}catch(e){notice(e.message,true);console.error(e);}};
function dirtyChanged(){scheduleDraft();dirty=true;$('review-state').textContent='Unsaved changes';}
function savedReview(r){return matchingReview(r,session.reviews);}
function queue(){
  const search=$('search').value.toLowerCase(),filter=$('filter').value;
  const rows=queueRows(session.records,session.reviews,filter,search);
  $('count').textContent=rows.length;$('queue').replaceChildren();
  for(const r of rows){const b=document.createElement('button');b.className='queue-item'+(record?.key===r.key?' active':'');b.dataset.key=r.key;
    const status=document.createElement('span');status.className='status'+(isComplete(r,session.reviews)?' done':'');status.textContent=isComplete(r,session.reviews)?'Reviewed':savedReview(r)?'In progress':r.hasIssues.toLowerCase()==='yes'?'Issues':'';
    const title=document.createElement('strong');title.textContent=r.id;
    const subtitle=document.createElement('small');subtitle.textContent=`Excel row ${r.row}${r.duplicate?' · duplicate ID':''}${!r.exact.length?' · '+(r.suggested.length?'assign PDF':'no match'):''}`;
    b.append(status,title,subtitle);b.onclick=guarded(()=>selectRecord(r));$('queue').append(b);
  }
  if(!rows.length){const p=document.createElement('p');p.className='muted pad';p.textContent=filter==='pending'?'No unfinished matching documents. Choose Completed reviews to see finished work, or Unmatched rows to locate missing PDFs.':'No matching rows. Try another filter.';$('queue').append(p);}
  const unmatched=session.records.filter(r=>!r.exact.length&&!r.suggested.length).length;
  $('progress').textContent=`${session.files.length} PDFs · ${unmatched} unmatched rows${session.diagnostics?.warnings.length?' · '+session.diagnostics.warnings.length+' scan warnings':''}`;
  const summary=projectSummary(session.records,session.reviews);$('project-summary').textContent=`${summary.complete} of ${summary.total} reviewed\n${summary.remaining} remaining · ${summary.issues} with issues\n${summary.missing} missing PDFs`;
  $('output-folder').textContent=session.outputFolder?'Output: '+session.outputFolder:'Choose an output folder on first export.';
  $('discovery').disabled=false;$('handoff').disabled=busy;
}
async function mayLeave(){if(!dirty&&!pendingPDFChanges())return true;const d=$('discard');d.showModal();return new Promise(resolve=>{ $('cancel-discard').onclick=()=>{d.close();resolve(false);};$('confirm-discard').onclick=()=>{clearDraft();d.close();resolve(true);};});}
function updateCoverage(){$('handoff').disabled=busy||!session;updateCorrectionControls();for(const id of ['mark-page-checked','rotate-left','rotate-right','deskew','change-output','open-corrected'])$(id).disabled=busy||!pdf;$('review-next-page').disabled=busy||!pdf||pageNumber>=pdf.numPages;for(const id of ['decision','concerns','pdf-file','page-checked','page-clear'])$(id).disabled=busy;document.querySelectorAll('[data-issue]').forEach(b=>b.disabled=busy);const count=pdf?.numPages||0;$('coverage').textContent=`${checked.size} of ${count} pages checked${count&&checked.size===count?' · all pages checked':''}`;$('page-checked').checked=checked.has(pageNumber);$('save').disabled=$('save-next').disabled=!pdf||busy;$('prev').disabled=!pdf||pageNumber<=1;$('next').disabled=!pdf||pageNumber>=count;$('page-number').disabled=!pdf;}
function clearViewer(){outputVerified=null;correctedOpen=false;viewDeskews=new Map();exportedDeskews=new Map();$('pdf-kind').textContent='No PDF open';$('open-corrected').hidden=true;viewRotations=new Map();exportedRotations=new Map();pendingCorrections=new Map();exportedCorrections=new Map();pdf=null;pageText='';segments=[];selected=-1;refs={};pageFindings=new Map();checked=new Set();$('canvas').width=0;$('canvas').height=0;$('paper').style.width='0px';$('paper').style.height='0px';$('overlay').replaceChildren();$('ocr-text').replaceChildren();$('empty').hidden=false;$('text-warning').hidden=true;$('selected-text').textContent='Nothing selected';$('flag-selection').disabled=true;$('page-count').textContent='/ —';$('text-count').textContent='No page loaded';$('reference').value='';$('metrics').textContent='';updateCoverage();}
async function selectRecord(r){
  if(busy||!await mayLeave())return;
  loadVersion++;renderVersion++;renderTask?.cancel();loadingTask?.destroy();
  record=r;dirty=false;clearViewer();$('doc-title').textContent=`Document ${r.id}`;$('row-label').textContent=`${session.sheet} · EXCEL ROW ${r.row}${r.duplicate?' · DUPLICATE DOCUMENT ID':''}`;
  $('review-state').textContent=isComplete(r,session.reviews)?'Previously reviewed':'Awaiting review';$('decision').value=['Yes','No'].includes(r.hasIssues)?r.hasIssues:'';$('concerns').value=r.concerns;$('last-saved').textContent=savedReview(r)?'Last saved '+new Date(savedReview(r).savedAt).toLocaleString():'';
  $('mapping').hidden=false;$('pdf-file').replaceChildren(new Option('Choose a PDF…',''));
  for(const file of session.files)$('pdf-file').add(new Option(file.relative+(r.suggested.includes(file.path)?' (suggested)':''),file.path));
  const previous=r.pdfAssignment?null:savedReview(r)?.pdf;const auto=previous&&(session.files.some(f=>f.path===previous)||Object.values(session.outputs||{}).includes(previous))?previous:r.exact.length===1?r.exact[0]:'';
  $('pdf-file').value=auto;$('mapping-note').textContent=r.assignmentMissing?'Saved PDF assignment is missing. Locate that relative path or explicitly choose its replacement.':r.pdfAssignment?'Saved assignment: '+r.pdfAssignment:r.exact.length>1?'Multiple exact matches: choose the correct file.':r.suggested.length&&!auto?'Possible filename match: confirm the correct PDF for this row.':r.duplicate?'Saves affect this Excel row only.':'';
  queue();if(auto)await openPDF(auto);else notice(!session.files.length?'No PDFs found in the selected folder. Open Document discovery to check the folder and scan warnings.':r.suggested.length?'Possible filenames found. Confirm the correct PDF in PDF assignment.':r.exact.length>1?'Multiple exact filenames found. Choose the correct subfolder in PDF assignment.':`No filename match for ${r.id} among ${session.files.length} PDFs. Open Document discovery to see the scanned paths or change the folder.`);
}
async function openPDF(filename){
  const version=++loadVersion;renderVersion++;renderTask?.cancel();loadingTask?.destroy();clearViewer();pdfPath=filename;if(!filename)return;
  notice('Loading '+filename.split(/[\\/]/).pop()+'…');
  const result=await window.qc.readPDF(filename);if(version!==loadVersion)return;
  session=result.session||session;record=session.records.find(r=>r.key===record.key);signature=result.signature;outputVerified=result.verification;correctedOpen=result.kind==='Corrected copy';if(![...$('pdf-file').options].some(o=>o.value===filename))$('pdf-file').add(new Option(filename.split(/[\\/]/).pop()+' (corrected copy)',filename));$('pdf-file').value=filename;$('scan-heading').textContent=result.kind==='Corrected copy'?'Corrected page':'Original page';$('pdf-kind').textContent=result.kind||'Original PDF';$('pdf-kind').title=filename;const corrected=Object.values(session.outputs||{}).includes(filename)?filename:session.outputs?.[filename];$('open-corrected').hidden=!corrected||corrected===filename;$('open-corrected').dataset.path=corrected||'';
  loadingTask=pdfjs.getDocument({data:new Uint8Array(result.bytes),cMapUrl:new URL('../node_modules/pdfjs-dist/cmaps/',import.meta.url).href,cMapPacked:true,standardFontDataUrl:new URL('../node_modules/pdfjs-dist/standard_fonts/',import.meta.url).href,wasmUrl:new URL('../node_modules/pdfjs-dist/wasm/',import.meta.url).href,isEvalSupported:false});
  const loaded=await loadingTask.promise;if(version!==loadVersion){await loaded.destroy();return;}pdf=loaded;
  const prev=savedReview(record);if(prev?.pdf===filename&&prev.signature===signature)checked=new Set(prev.checkedPages.filter(p=>p>=1&&p<=pdf.numPages));else if(prev)notice('This PDF or workbook decision changed. Page checkmarks have been reset.');
  pageNumber=1;zoom=1;$('page-count').textContent='/ '+pdf.numPages;$('page-number').max=pdf.numPages;$('empty').hidden=true;await renderPage();
  notice(`Loaded ${pdf.numPages} pages. Compare the scan with the stored text; extraction alone does not establish accuracy.`);
}
async function renderPage(){
  if(!pdf)return;const version=++renderVersion;renderTask?.cancel();
  const page=await pdf.getPage(pageNumber);if(version!==renderVersion)return;
  const rotation=(page.rotate+(viewRotations.get(pageNumber)||0))%360;const base=page.getViewport({scale:1,rotation});const fit=Math.max(150,$('scan-scroll').clientWidth-36)/base.width;
  const viewport=page.getViewport({scale:fit*zoom,rotation});const ratio=window.devicePixelRatio||1;
  const scratch=document.createElement('canvas');scratch.width=Math.ceil(viewport.width*ratio);scratch.height=Math.ceil(viewport.height*ratio);
  renderTask=page.render({canvasContext:scratch.getContext('2d'),viewport,transform:[ratio,0,0,ratio,0,0]});
  const renderDone=renderTask.promise.catch(e=>{if(e.name!=='RenderingCancelledException')throw e;});
  const content=await page.getTextContent();await renderDone;if(version!==renderVersion)return;
  const canvas=$('canvas');canvas.width=scratch.width;canvas.height=scratch.height;canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';canvas.getContext('2d').drawImage(scratch,0,0);
  $('paper').style.width=viewport.width+'px';$('paper').style.height=viewport.height+'px';applyDeskewPreview(viewDeskews.get(pageNumber)||0,viewport.width,viewport.height);$('overlay').replaceChildren();$('ocr-text').replaceChildren();segments=[];pageText='';selected=-1;
  $('selected-text').textContent='Nothing selected';$('flag-selection').disabled=true;
  const measure=document.createElement('canvas').getContext('2d');
  for(const item of content.items){if(!('str' in item))continue;
    pageText+=item.str+(item.hasEOL?'\n':' ');
    if(!item.str.trim()){if(item.hasEOL)$('ocr-text').append(document.createTextNode('\n'));continue;}
    const index=segments.length;segments.push(item.str);
    const span=document.createElement('span');span.className='text-segment';span.textContent=item.str;span.dataset.index=index;span.tabIndex=0;span.setAttribute('role','button');span.onclick=()=>selectSegment(index,'text');span.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectSegment(index,'text');}};
    $('ocr-text').append(span,document.createTextNode(item.hasEOL?'\n':' '));
    const tx=pdfjs.Util.transform(viewport.transform,item.transform),fontHeight=Math.hypot(tx[2],tx[3]),style=content.styles[item.fontName]||{};
    let angle=Math.atan2(tx[1],tx[0]);if(style.vertical)angle+=Math.PI/2;
    const ascent=fontHeight*(style.ascent??(style.descent?1+style.descent:.8));
    const box=document.createElement('button');box.className='ocr-box';box.dataset.index=index;box.title=item.str;box.setAttribute('aria-label',item.str);box.style.left=(tx[4]+ascent*Math.sin(angle))+'px';box.style.top=(tx[5]-ascent*Math.cos(angle))+'px';box.style.width=Math.max(2,(style.vertical?item.height:item.width)*viewport.scale)+'px';box.style.height=Math.max(2,fontHeight)+'px';box.style.transform=`rotate(${angle}rad)`;box.onclick=()=>selectSegment(index,'scan');
    const word=document.createElement('span');word.className='overlay-word';word.textContent=item.str;word.style.fontSize=fontHeight+'px';measure.font=fontHeight+'px Arial';const measured=measure.measureText(item.str).width;word.style.transformOrigin='0 0';word.style.transform=`scaleX(${measured?parseFloat(box.style.width)/measured:1})`;box.append(word);$('overlay').append(box);
  }
  $('text-warning').hidden=!!segments.length;$('text-warning').textContent='No extractable text on this page. Check whether it contains visible text; a blank page or image-only map is not automatically an OCR error.';
  $('text-count').textContent=segments.length+' text segments';$('page-number').value=pageNumber;$('zoom-label').textContent=Math.round(zoom*100)+'%';$('reference').value=refs[pageNumber]||'';$('metrics').textContent='';updateCoverage();
}
function selectSegment(index,source){selected=index;document.querySelectorAll('.selected').forEach(e=>e.classList.remove('selected'));const box=$('overlay').querySelector(`[data-index="${index}"]`),span=$('ocr-text').querySelector(`[data-index="${index}"]`);box?.classList.add('selected');span?.classList.add('selected');(source==='scan'?span:box)?.scrollIntoView({block:'nearest',inline:'nearest'});$('selected-text').textContent=segments[index];$('flag-selection').disabled=false;updateCorrectionControls();}
function addConcern(text){if(!pdf||busy)return;const entry=`Page ${pageNumber}: ${text}`;$('concerns').value+=($('concerns').value.trim()?'\n':'')+entry;const findings=pageFindings.get(pageNumber)||[];findings.push(entry);pageFindings.set(pageNumber,findings);$('decision').value='Yes';dirtyChanged();notice(`Concern added for page ${pageNumber}. Moving to another page will mark it checked.`);}
function finishPageWithFindings(){if((pageFindings.get(pageNumber)||[]).some(entry=>$('concerns').value.includes(entry))){checked.add(pageNumber);dirtyChanged();updateCoverage();}}
function markPageClear(){if(!pdf)return;const prefix=`Page ${pageNumber}:`;if($('concerns').value.split('\n').some(line=>line.trim().startsWith(prefix))){notice('This page already has concerns. Remove or correct those entries before marking it clear.',true);return;}checked.add(pageNumber);pageFindings.delete(pageNumber);dirtyChanged();updateCoverage();notice(`Page ${pageNumber} marked checked with no issues. The document decision is unchanged.`);}
async function navigate(p){if(!pdf||busy)return;const target=Number(p);if(!Number.isInteger(target)||target<1||target>pdf.numPages){$('page-number').value=pageNumber;return;}if(target!==pageNumber)finishPageWithFindings();pageNumber=target;await renderPage();$('scan-scroll').scrollTop=0;$('ocr-text').scrollTop=0;}
async function save(next=false){
  if(!pdf||busy)return;finishPageWithFindings();busy=true;updateCoverage();
  try{const result=await window.qc.save({key:record.key,pdf:pdfPath,signature,pageCount:pdf.numPages,checkedPages:[...checked],hasIssues:$('decision').value,concerns:$('concerns').value,reviewer:$('reviewer').value,pendingChanges:pendingPDFChanges()});session=result.session;record=session.records.find(r=>r.key===record.key);dirty=false;persistDraft();$('review-state').textContent=checked.size===pdf.numPages?'Review complete':'Findings saved';$('last-saved').textContent='Saved '+new Date().toLocaleTimeString()+'. Backup: '+result.backup;queue();notice(result.warning||(next?(pendingPDFChanges()?'Document saved to Excel. Export your staged PDF corrections before moving to the next document.':'Document saved to Excel.'):`All pending review changes saved to Excel. ${pendingPDFChanges()?'Export your staged PDF corrections before closing.':'You can close the app.'}${checked.size===pdf.numPages?' Completed review hidden from the Needs review queue.':' This partial review remains in the queue.'}`),!!result.warning);
    busy=false;updateCoverage();if(next&&!pendingPDFChanges()){const following=nextPending(session.records,session.reviews,record.key);if(following){$('filter').value='pending';$('search').value='';await selectRecord(following);}else notice(result.warning||(checked.size===pdf.numPages?'Saved. No other unfinished documents with matching PDFs. You can close the app.':'Saved. This document still has unchecked pages; no other unfinished matched documents remain.'),!!result.warning);}
  }finally{busy=false;updateCoverage();}
}
async function openProject(resume=false){if(busy||!await mayLeave())return;const result=await (resume===true?window.qc.resume():window.qc.open());if(!result)return;session=result;record=null;dirty=false;$('project').textContent=session.workbook.split(/[\\/]/).pop()+' / '+session.folder.split(/[\\/]/).pop();$('project').title=session.workbook+'\n'+session.folder;queue();$('filter').value='pending';const first=queueRows(session.records,session.reviews)[0]||session.records[0];if(first)await selectRecord(first);await offerRecovery();}
async function showDiscovery(){
  const report=await window.qc.discovery();
  $('discovery-summary').textContent=`${report.pdfCount} PDFs found in ${report.directories} folders. ${report.rowCounts.exact} rows have one exact match; ${report.rowCounts.ambiguous} have multiple exact matches; ${report.rowCounts.suggested} have suggested filenames; ${report.rowCounts.unmatched} have no match.`;
  $('discovery-folder').textContent='Selected root: '+report.folder;
  $('discovery-details').textContent=[
    'SCAN VERIFICATION',...(report.verification?[`${report.verification.stable?'Two consecutive file lists agree':'File lists still differ'}. ${report.verification.passes.length} scans.`,...report.verification.passes.map(p=>`Pass ${p.pass}: ${p.pdfCount} PDFs, ${p.directories} folders, ${p.warningCount} warnings${p.pass>1?`; ${p.added.length} added, ${p.removed.length} removed`:''}`)]:['Not available in this scan.']),
    '\nSCAN WARNINGS',...(report.warnings.length?report.warnings.map(w=>w.path+' — '+w.error):['None.']),
    '\nUNMATCHED WORKBOOK ROWS',...report.rows.filter(r=>r.status==='unmatched').map(r=>`Excel row ${r.row}: ${r.id}`),
    '\nSUGGESTED OR AMBIGUOUS MATCHES',...report.rows.filter(r=>['suggested','ambiguous'].includes(r.status)).map(r=>`Excel row ${r.row}: ${r.id}\n  `+[...r.exact,...r.suggested].join('\n  ')),
    '\nALL DISCOVERED PDF PATHS',...report.files.map(f=>f.path)
  ].join('\n');
  if(!$('discovery-dialog').open)$('discovery-dialog').showModal();
}
async function refreshDiscovery(changeFolder){
  $('discovery-dialog').close();if(busy||!await mayLeave())return;
  const current=record?.key;notice('Scanning PDF folders and verifying the file list…');const result=await window.qc.rescan(changeFolder);if(!result){await showDiscovery();return;}
  session=result;dirty=false;$('project').textContent=session.workbook.split(/[\\/]/).pop()+' / '+session.folder.split(/[\\/]/).pop();$('project').title=session.workbook+'\n'+session.folder;queue();
  const next=session.records.find(r=>r.key===current)||session.records[0];if(next)await selectRecord(next);await showDiscovery();
}
$('discovery').onclick=guarded(showDiscovery);$('close-discovery').onclick=()=>$('discovery-dialog').close();$('rescan').onclick=guarded(()=>refreshDiscovery(false));$('change-folder').onclick=guarded(()=>refreshDiscovery(true));$('export-discovery').onclick=guarded(async()=>{const filename=await window.qc.exportDiscovery();if(filename)notice('Scan report saved to '+filename);});
function updateCorrectionControls(){
  $('edit-ocr').disabled=busy||!pdf||selected<0;
  $('export-corrections').disabled=busy||!pendingPDFChanges();
  $('verify-output').hidden=!correctedOpen;$('verify-output').disabled=busy||!pdf||!!pendingPDFChanges()||checked.size!==pdf.numPages;$('verification-status').textContent=correctedOpen?(outputVerified?'Corrected copy verified by '+outputVerified.reviewer:'Check every page, then verify this corrected copy before completing the review.'):'';renderPending();
  $('correction-count').textContent=pendingPDFChanges()?`${pendingCorrections.size} text correction(s), ${pendingRotationCount(viewRotations,exportedRotations)} rotation(s), ${pendingRotationCount(viewDeskews,exportedDeskews)} straightening change(s) pending export. The original PDF is unchanged.`:'';
}
function selectCorrectionObject(){
  const obj=correctionObjects.find(o=>String(o.index)===$('correction-object').value);
  $('correction-original').value=obj?.text||'';
  $('correction-replacement').value=obj?(pendingCorrections.get(correctionPage+':'+obj.index)?.after??exportedCorrections.get(correctionPage+':'+obj.index)?.after??obj.text):'';
  $('stage-correction').disabled=$('delete-correction').disabled=!obj;
}
async function editOCR(){
  if(!pdf||busy||selected<0)return;const selectedText=segments[selected];busy=true;updateCoverage();notice('Inspecting the page’s editable OCR text…');
  try{
    const result=await window.qc.inspectOCR({pdf:pdfPath,signature,page:pageNumber});correctionPage=pageNumber;correctionObjects=result.objects.filter(o=>o.editable);
    if(!correctionObjects.length)throw Error('This page has no supported invisible text blocks. Visible text and text inside nested forms are review-only.');
    $('correction-object').replaceChildren(new Option('Choose the text block to correct…',''));
    for(const obj of correctionObjects)$('correction-object').add(new Option(obj.text.slice(0,110)+' [block '+obj.index+']',String(obj.index)));
    const candidate=matchingTextObject(correctionObjects,selectedText);$('correction-object').value=candidate===null?'':String(candidate);selectCorrectionObject();
    $('correction-help').textContent=`Page ${pageNumber}. Keep corrections small; the PDF’s existing font must support the replacement. ${result.nested?'Text inside nested forms is not editable in this release.':''}`;
    $('correction-dialog').showModal();
  }finally{busy=false;updateCoverage();}
}
function stageCorrection(remove=false){
  const obj=correctionObjects.find(o=>String(o.index)===$('correction-object').value);if(!obj)return;
  const after=remove?'':$('correction-replacement').value;if((!remove&&!after.trim())||/[\x00-\x1f]/.test(after)){$('correction-help').textContent='Enter a single-line correction, or use Delete erroneous text.';return;}
  const key=correctionPage+':'+obj.index;if(after===(exportedCorrections.get(key)?.after??obj.text))pendingCorrections.delete(key);else pendingCorrections.set(key,{page:correctionPage,index:obj.index,before:obj.text,after,...(remove?{operation:'delete'}:{})});
  $('correction-dialog').close();updateCorrectionControls();scheduleDraft();notice((remove?'Text deletion staged. ':'Correction staged. ')+'Export a corrected PDF to apply it; the original text remains unchanged.');
}
async function exportCorrections(){
  if(busy||!pendingPDFChanges())return;busy=true;updateCoverage();const edits=mergedCorrections(exportedCorrections,pendingCorrections);const rotations=[...viewRotations].filter(([,degrees])=>degrees).map(([page,degrees])=>({page,degrees}));const deskews=[...viewDeskews].filter(([,degrees])=>degrees).map(([page,degrees])=>({page,degrees}));if(!edits.length&&!rotations.length&&!deskews.length){pendingCorrections.clear();exportedCorrections.clear();exportedRotations=new Map(viewRotations);busy=false;updateCoverage();notice('All corrections were reverted. The original PDF already contains the requested text and orientation.');return;}notice('Creating a corrected copy and verifying its text and page appearance…');
  try{const result=await window.qc.exportCorrections({key:record.key,pdf:pdfPath,signature,edits,rotations,deskews});if(!result){notice('Export cancelled. Staged corrections are still available.');return;}
    session=result.session;record=session.records.find(r=>r.key===record.key);queue();$('open-corrected').hidden=false;$('open-corrected').dataset.path=result.path;
    const name=result.path.split(/[\\/]/).pop();for(const page of new Set([...edits.map(e=>e.page),...rotations.map(r=>r.page),...deskews.map(d=>d.page)])){$('concerns').value+=($('concerns').value.trim()?'\n':'')+`Page ${page}: PDF corrections exported to ${name}; original PDF retained.`;}
    $('decision').value='Yes';dirtyChanged();const savedPage=pageNumber;await openPDF(result.path);checked.clear();pageNumber=savedPage;await renderPage();scheduleDraft();notice(`Corrected copy saved: ${result.path}. Change log saved alongside it. Review this corrected copy, check every page, and choose Verify corrected copy before completing the review in Excel.`);
  }finally{busy=false;updateCoverage();}
}
$('edit-ocr').onclick=guarded(editOCR);$('correction-object').onchange=selectCorrectionObject;$('stage-correction').onclick=()=>stageCorrection();$('delete-correction').onclick=()=>stageCorrection(true);$('cancel-correction').onclick=()=>$('correction-dialog').close();$('export-corrections').onclick=guarded(exportCorrections);
$('review-next-page').onclick=guarded(async()=>{if(!pdf||busy)return;const next=nextCheckedPage(pageNumber,pdf.numPages);if(next===null)return;checked.add(pageNumber);dirtyChanged();updateCoverage();await navigate(next);});
let split=59;try{split=Number(localStorage.getItem('ocr-qc-pane-share'))||59;}catch{}
function setSplit(value){const grid=$('viewer-grid');split=paneShare(value,grid.clientWidth||800);grid.style.setProperty('--scan-share',split+'%');$('pane-divider').setAttribute('aria-valuenow',String(Math.round(split)));try{localStorage.setItem('ocr-qc-pane-share',String(split));}catch{}}
setSplit(split);let dragging=false;
$('pane-divider').onpointerdown=e=>{dragging=true;e.currentTarget.setPointerCapture(e.pointerId);document.body.classList.add('resizing-panes');};
$('pane-divider').onpointermove=e=>{if(!dragging)return;const bounds=$('viewer-grid').getBoundingClientRect();setSplit((e.clientX-bounds.left)/bounds.width*100);};
$('pane-divider').onpointerup=$('pane-divider').onpointercancel=()=>{dragging=false;document.body.classList.remove('resizing-panes');};
$('pane-divider').ondblclick=()=>setSplit(59);
$('pane-divider').onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home'].includes(e.key)){e.preventDefault();setSplit(e.key==='Home'?59:split+(e.key==='ArrowLeft'?-3:3));}};
$('open').onclick=$('open-empty').onclick=guarded(openProject);$('search').oninput=$('filter').onchange=()=>session&&queue();
$('pdf-file').onchange=guarded(async()=>{const filename=$('pdf-file').value;if(!await mayLeave()){$('pdf-file').value=pdfPath;return;}await openPDF(filename);dirtyChanged();});
$('prev').onclick=guarded(()=>navigate(pageNumber-1));$('next').onclick=guarded(()=>navigate(pageNumber+1));$('page-number').onchange=guarded(()=>navigate($('page-number').value));
$('zoom-in').onclick=guarded(async()=>{zoom=Math.min(4,zoom+.25);await renderPage();});$('zoom-out').onclick=guarded(async()=>{zoom=Math.max(.5,zoom-.25);await renderPage();});$('fit').onclick=guarded(async()=>{zoom=1;await renderPage();});
$('boxes').onchange=()=> $('overlay').classList.toggle('hide-boxes',!$('boxes').checked);$('text-overlay').onchange=()=> $('overlay').classList.toggle('show-text',$('text-overlay').checked);
$('page-checked').onchange=()=>{if(!pdf){$('page-checked').checked=false;return;}if($('page-checked').checked)checked.add(pageNumber);else checked.delete(pageNumber);dirtyChanged();updateCoverage();};
$('decision').onchange=$('concerns').oninput=()=>record&&dirtyChanged();document.querySelectorAll('[data-issue]').forEach(b=>b.onclick=()=>addConcern(b.dataset.issue));$('flag-selection').onclick=()=>addConcern('Incorrect text: “'+segments[selected]+'” — ');
$('page-clear').onclick=markPageClear;
$('save').onclick=guarded(()=>save());$('save-next').onclick=guarded(()=>save(true));$('reference').oninput=()=>{refs[pageNumber]=$('reference').value;$('metrics').textContent='';};
$('measure').onclick=guarded(async()=>{if(!pdf)throw Error('Load a PDF page first.');const rates=errorRates($('reference').value,pageText);$('metrics').textContent=`Character error rate: ${(rates.cer*100).toFixed(2)}% (${rates.characterErrors}/${rates.characters}) · Word error rate: ${(rates.wer*100).toFixed(2)}% (${rates.wordErrors}/${rates.words}). Insertions can make a rate exceed 100%.`;});
window.addEventListener('beforeunload',e=>{persistDraft();if(dirty||pendingPDFChanges()){e.preventDefault();e.returnValue='';}});
let resizeTimer;new ResizeObserver(()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>guarded(renderPage)(),180);}).observe($('scan-scroll'));
let draftTimer,recovering=false,heldDraft=false;
function draftPayload(){if(!record||!pdf)return null;return {key:record.key,id:record.id,pdf:pdfPath,signature,baseIssues:record.hasIssues,baseConcerns:record.concerns,baseReviewed:record.qcReviewed,baseReviewer:record.qcReviewer,baseReviewedOn:record.qcReviewedOn,baseAssignment:record.pdfAssignment,decision:$('decision').value,concerns:$('concerns').value,reviewer:$('reviewer').value,checked:[...checked],pageNumber,pageFindings:[...pageFindings],pendingCorrections:[...pendingCorrections],exportedCorrections:[...exportedCorrections],viewRotations:[...viewRotations],exportedRotations:[...exportedRotations],viewDeskews:[...viewDeskews],exportedDeskews:[...exportedDeskews],dirty};}
function scheduleDraft(){if(!session||recovering||heldDraft)return;clearTimeout(draftTimer);draftTimer=setTimeout(persistDraft,400);}
function persistDraft(){clearTimeout(draftTimer);if(!session||recovering||heldDraft)return;const payload=draftPayload();if(!payload)return;const result=window.qc.draftSync({workbook:session.workbook,draft:dirty||pendingPDFChanges()?payload:null});$('draft-status').textContent=result.ok?(dirty||pendingPDFChanges()?'Recovery draft saved locally':'Review saved; no pending draft'):'Draft not saved: '+result.error;}
function clearDraft(){clearTimeout(draftTimer);if(session){const result=window.qc.draftSync({workbook:session.workbook,draft:null});if(!result.ok)throw Error(result.error);}heldDraft=false;}
async function offerRecovery(){const draft=await window.qc.recover();if(!draft)return;heldDraft=true;const dialog=$('recovery');dialog.oncancel=event=>event.preventDefault();$('recovery-message').textContent=`Document ${draft.id}, saved ${new Date(draft.savedAt).toLocaleString()}. Restore concerns, page checks, and pending PDF changes?`;$('recovery-notes').value=draft.concerns||'';dialog.showModal();return new Promise(resolve=>{
 $('discard-draft').onclick=()=>{clearDraft();dialog.close();resolve();};
 $('restore-draft').onclick=async()=>{try{await window.qc.validateDraft(draft);recovering=true;heldDraft=false;dirty=false;await selectRecord(session.records.find(r=>r.key===draft.key));if(pdfPath!==draft.pdf)await openPDF(draft.pdf);if(!pdf)throw Error('Cannot restore until the PDF is loaded.');$('decision').value=draft.decision;$('concerns').value=draft.concerns;$('reviewer').value=draft.reviewer||$('reviewer').value;checked=new Set(draft.checked.filter(p=>p>=1&&p<=pdf.numPages));pageFindings=new Map(draft.pageFindings);pendingCorrections=new Map(draft.pendingCorrections);exportedCorrections=new Map(draft.exportedCorrections);viewRotations=new Map(draft.viewRotations);exportedRotations=new Map(draft.exportedRotations);viewDeskews=new Map(draft.viewDeskews||[]);exportedDeskews=new Map(draft.exportedDeskews||[]);dirty=draft.dirty;$('review-state').textContent=dirty?'Restored unsaved review':'PDF changes restored';pageNumber=Math.min(pdf.numPages,Math.max(1,draft.pageNumber));await renderPage();dialog.close();notice('Draft restored. Save the review and export pending PDF changes when ready.');resolve();}catch(e){heldDraft=true;$('recovery-message').textContent=e.message;}finally{recovering=false;}};
});}
await guarded(async()=>{const preferences=await window.qc.preferences();$('reviewer').value=preferences.reviewer||'';$('resume').hidden=!preferences.lastProject;$('resume').title=preferences.lastProject?.workbook||'';session=await window.qc.initial();if(session){$('project').textContent=session.workbook.split(/[\\/]/).pop()+' / '+session.folder.split(/[\\/]/).pop();queue();const first=queueRows(session.records,session.reviews)[0]||session.records[0];if(first)await selectRecord(first);await offerRecovery();}updateCoverage();})();

$('mark-page-checked').onclick=()=>{if(!pdf||busy)return;checked.add(pageNumber);dirtyChanged();updateCoverage();notice('Page '+pageNumber+' marked checked. Save to record your review.');};
async function rotateView(turn){if(!pdf||busy)return;viewRotations.set(pageNumber,((viewRotations.get(pageNumber)||0)+turn+360)%360);updateCorrectionControls();scheduleDraft();await renderPage();notice(pendingPDFChanges()?'Page rotation staged. Choose Export corrected PDF to save the turned page.':'Page orientation restored; no new PDF changes to export.');}
$('rotate-left').onclick=guarded(()=>rotateView(-90));$('rotate-right').onclick=guarded(()=>rotateView(90));

$('help').onclick=guarded(()=>window.qc.help());

$('resume').onclick=guarded(()=>openProject(true));
$('reviewer').onchange=guarded(async()=>{await window.qc.reviewer($('reviewer').value);scheduleDraft();});
$('change-output').onclick=guarded(async()=>{const folder=await window.qc.outputFolder();if(folder){session.outputFolder=folder;queue();}});
$('open-corrected').onclick=guarded(async()=>{if(pendingPDFChanges())throw Error('Export or undo pending changes before opening the corrected copy.');const target=$('open-corrected').dataset.path;await openPDF(target);scheduleDraft();notice('Viewing corrected copy. Your concerns are retained; check its pages before verifying.');});
$('verify-output').onclick=guarded(async()=>{if(pendingPDFChanges())throw Error('Export pending changes first.');busy=true;updateCoverage();try{outputVerified=await window.qc.verifyOutput({pdf:pdfPath,signature,checkedPages:[...checked],reviewer:$('reviewer').value});dirtyChanged();notice('Corrected copy verified. Save to workbook to record completion.');}finally{busy=false;updateCoverage();}});
$('handoff').onclick=guarded(async()=>{if(dirty||pendingPDFChanges())throw Error('Save your review and export pending changes before creating the handoff package.');busy=true;updateCoverage();try{const result=await window.qc.handoff();if(result)notice(`Handoff saved: ${result.folder}. ${result.copied} verified corrected PDFs; ${result.warnings} exclusions listed in the manifest.`);}finally{busy=false;updateCoverage();}});
function renderPending(){
 $('pending-count').textContent=pendingPDFChanges();$('pending-list').replaceChildren();
 const add=(label,undo)=>{const row=document.createElement('div'),text=document.createElement('span'),button=document.createElement('button');row.className='pending-row';text.textContent=label;button.textContent='Undo';button.disabled=busy;button.onclick=guarded(async()=>{undo();scheduleDraft();updateCoverage();await renderPage();});row.append(text,button);$('pending-list').append(row);};
 for(const [key,e] of pendingCorrections)add(`Page ${e.page}, block ${e.index}: ${e.operation==='delete'?'Delete “'+e.before+'”':'“'+e.before+'” → “'+e.after+'”'}`,()=>pendingCorrections.delete(key));
 for(const [current,exported,label] of [[viewRotations,exportedRotations,'Rotation'],[viewDeskews,exportedDeskews,'Straighten']])for(const page of new Set([...current.keys(),...exported.keys()]))if((current.get(page)||0)!==(exported.get(page)||0))add(`Page ${page}: ${label} ${current.get(page)||0}°`,()=>current.set(page,exported.get(page)||0));
}
function applyDeskewPreview(degrees,width=parseFloat($('paper').style.width),height=parseFloat($('paper').style.height)){
 const radians=degrees*Math.PI/180,c=Math.abs(Math.cos(radians)),s=Math.abs(Math.sin(radians));const scale=width&&height?Math.min(width/(c*width+s*height),height/(s*width+c*height)):1;
 for(const id of ['canvas','overlay'])$(id).style.transform=`rotate(${degrees}deg) scale(${scale})`;
}
$('deskew').onclick=()=>{$('deskew-angle').value=viewDeskews.get(pageNumber)||0;$('deskew-dialog').showModal();};
$('deskew-angle').oninput=()=>{const value=Number($('deskew-angle').value);if(Number.isFinite(value)&&Math.abs(value)<=10)applyDeskewPreview(value);};
const cancelDeskew=()=>{applyDeskewPreview(viewDeskews.get(pageNumber)||0);$('deskew-dialog').close();};
$('cancel-deskew').onclick=cancelDeskew;$('deskew-dialog').oncancel=cancelDeskew;
$('stage-deskew').onclick=guarded(async()=>{const value=Number($('deskew-angle').value);if(!Number.isFinite(value)||Math.abs(value)>10)throw Error('Use an angle between −10 and 10 degrees.');viewDeskews.set(pageNumber,Math.round(value*10)/10);$('deskew-dialog').close();scheduleDraft();updateCoverage();await renderPage();notice('Straightening staged. Export corrected PDF to save it.');});
