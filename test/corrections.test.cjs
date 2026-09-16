const {test}=require('node:test');const assert=require('node:assert/strict');const {getEngine,inspect,correct,saveBytes}=require('../src/pdf-corrections.cjs');
async function fixture(){const p=await getEngine(),doc=p.FPDF_CreateNewDocument(),page=p.FPDFPage_New(doc,0,300,200);try{for(const [text,mode,y] of [['Visible page image substitute',0,140],['Mispelled word',3,100],['Mispelled word',3,70]]){const obj=p.FPDFPageObj_NewTextObj(doc,'Helvetica',12),b=Buffer.from(text+'\0','utf16le'),ptr=p.pdfium.wasmExports.malloc(b.length);p.pdfium.HEAPU8.set(b,ptr);assert(p.FPDFText_SetText(obj,ptr));p.pdfium.wasmExports.free(ptr);p.FPDFTextObj_SetTextRenderMode(obj,mode);p.FPDFPageObj_Transform(obj,1,0,0,1,25,y);p.FPDFPage_InsertObject(page,obj);}assert(p.FPDFPage_GenerateContent(page));return saveBytes(p,doc);}finally{p.FPDF_ClosePage(page);p.FPDF_CloseDocument(doc);}}
test('edits only selected invisible object, reads back actual replacement, and preserves appearance',async()=>{const bytes=await fixture(),before=Buffer.from(bytes),page=await inspect(bytes,1);assert.equal(page.objects.filter(o=>o.editable).length,2);const obj=page.objects.find(o=>o.editable);const result=await correct(bytes,[{page:1,index:obj.index,before:obj.text,after:'Misspelled word'}]);assert(result.verification.pagePixelsUnchanged);const saved=await inspect(result.bytes,1);assert.equal(saved.objects.filter(o=>o.text==='Misspelled word').length,1);assert.equal(saved.objects.filter(o=>o.text==='Mispelled word').length,1);assert.deepEqual(bytes,before);});
test('rejects visible-text changes and stale targets',async()=>{const bytes=await fixture(),page=await inspect(bytes,1),visible=page.objects.find(o=>!o.editable),hidden=page.objects.find(o=>o.editable);await assert.rejects(()=>correct(bytes,[{page:1,index:visible.index,before:visible.text,after:'Changed'}]),/Only invisible/);await assert.rejects(()=>correct(bytes,[{page:1,index:hidden.index,before:'wrong original',after:'Changed'}]),/changed/);});
test('rejects duplicate corrections, empty replacement and nonexistent pages',async()=>{const bytes=await fixture(),obj=(await inspect(bytes,1)).objects.find(o=>o.editable),e={page:1,index:obj.index,before:obj.text,after:'fixed'};await assert.rejects(()=>correct(bytes,[e,e]),/Duplicate/);await assert.rejects(()=>correct(bytes,[{...e,after:''}]),/nonempty/);await assert.rejects(()=>correct(bytes,[{...e,page:100}]),/Invalid page/);});
test('new next-page action cannot move beyond last page; splitter stays usable',async()=>{const {nextCheckedPage,paneShare,matchingTextObject}=await import('../src/review-controls.mjs');assert.equal(nextCheckedPage(1,3),2);assert.equal(nextCheckedPage(3,3),null);assert.equal(paneShare(-100,800),25);assert.equal(paneShare(100,800),75);assert.equal(matchingTextObject([{index:1,text:'word ',editable:true}], 'word'),1);assert.equal(matchingTextObject([{index:1,text:'word',editable:true},{index:2,text:'word',editable:true}],'word'),null);});
test('next unchecked page wraps and page-count sorting keeps unknown documents last',async()=>{const {nextUncheckedPage,sortByPageCount}=await import('../src/review-controls.mjs');assert.equal(nextUncheckedPage(3,5,[1,2,3,5]),4);assert.equal(nextUncheckedPage(4,5,[2,3,4,5]),1);assert.equal(nextUncheckedPage(3,3,[1,2]),null);const rows=[{key:'a'},{key:'b'},{key:'c'},{key:'d'}],counts=new Map([['a',20],['b',4],['d',20]]);assert.deepEqual(sortByPageCount(rows,counts,'shortest').map(r=>r.key),['b','a','d','c']);assert.deepEqual(sortByPageCount(rows,counts,'longest').map(r=>r.key),['a','d','b','c']);assert.equal(sortByPageCount(rows,counts,'workbook'),rows);});
test('keyboard queue navigation follows the visible queue without wrapping',async()=>{const {queueTarget}=await import('../src/review-controls.mjs');const rows=[{key:'a'},{key:'b'},{key:'c'}];assert.equal(queueTarget(rows,'b','next').key,'c');assert.equal(queueTarget(rows,'b','previous').key,'a');assert.equal(queueTarget(rows,'a','previous').key,'a');assert.equal(queueTarget(rows,'c','next').key,'c');assert.equal(queueTarget(rows,'b','first').key,'a');assert.equal(queueTarget(rows,'b','last').key,'c');assert.equal(queueTarget([],null,'next'),null);});
test('repeated exports retain previous corrections and permit revising them',async()=>{const {mergedCorrections}=await import('../src/review-controls.mjs');const one={page:1,index:2,before:'bad',after:'good'},two={page:2,index:5,before:'erro',after:'error'};const exported=new Map([['1:2',one]]);assert.deepEqual(mergedCorrections(exported,new Map([['2:5',two]])),[one,two]);assert.deepEqual(mergedCorrections(exported,new Map([['1:2',{...one,after:'better'}]])),[{...one,after:'better'}]);assert.deepEqual(mergedCorrections(exported,new Map([['1:2',{...one,after:'bad'}]])),[]);});
test('deletes one of two identical OCR blocks without deleting its neighbor or changing pixels',async()=>{
 const bytes=await fixture(),original=Buffer.from(bytes),objects=(await inspect(bytes,1)).objects,hidden=objects.filter(o=>o.editable);
 const result=await correct(bytes,[{page:1,index:hidden[0].index,before:hidden[0].text,after:'',operation:'delete'}]);
 const saved=(await inspect(result.bytes,1)).objects;assert.equal(saved.filter(o=>o.editable).length,1);assert.equal(saved.find(o=>o.editable).text,hidden[1].text);assert.equal(saved.find(o=>!o.editable).text,objects.find(o=>!o.editable).text);assert(result.verification.pagePixelsUnchanged);assert.deepEqual(bytes,original);
});
test('mixed deletion and correction handle shifted object indices; all invisible text can be removed',async()=>{
 const bytes=await fixture(),hidden=(await inspect(bytes,1)).objects.filter(o=>o.editable);const edits=hidden.map((o,i)=>({page:1,index:o.index,before:o.text,after:i?'Correct text':'',...(i?{}:{operation:'delete'})}));
 const result=await correct(bytes,edits);assert.deepEqual((await inspect(result.bytes,1)).objects.filter(o=>o.editable).map(o=>o.text),['Correct text']);
 const removed=await correct(bytes,hidden.map(o=>({page:1,index:o.index,before:o.text,after:'',operation:'delete'})));assert.equal((await inspect(removed.bytes,1)).objects.filter(o=>o.editable).length,0);assert(removed.verification.pagePixelsUnchanged);
});
test('visible text cannot be deleted and deletion requires an empty replacement',async()=>{
 const bytes=await fixture(),objects=(await inspect(bytes,1)).objects,visible=objects.find(o=>!o.editable),hidden=objects.find(o=>o.editable);
 await assert.rejects(()=>correct(bytes,[{page:1,index:visible.index,before:visible.text,after:'',operation:'delete'}]),/Only invisible/);
 await assert.rejects(()=>correct(bytes,[{page:1,index:hidden.index,before:hidden.text,after:'replacement',operation:'delete'}]),/explicitly delete/);
});
async function rotationOf(bytes){const {load}=require('../src/pdf-corrections.cjs'),p=await getEngine(),f=load(p,bytes);try{const page=p.FPDF_LoadPage(f.doc,0);try{return p.FPDFPage_GetRotation(page)*90;}finally{p.FPDF_ClosePage(page);}}finally{f.close();}}
test('rotation-only export saves orientation, retains OCR and preserves content pixels',async()=>{
 const bytes=await fixture(),before=Buffer.from(bytes),text=(await inspect(bytes,1)).objects.map(o=>o.text);
 for(const degrees of [90,180,270]){const result=await correct(bytes,[],[{page:1,degrees}]);assert.equal(await rotationOf(result.bytes),degrees);assert.deepEqual((await inspect(result.bytes,1)).objects.map(o=>o.text),text);assert(result.verification.pageContentPixelsUnchanged);assert(result.verification.rotationReadback);assert.equal(result.verification.pagePixelsUnchanged,false);}assert.deepEqual(bytes,before);
});
test('rotation combines with deletion and adds to existing PDF rotation',async()=>{
 const source=await fixture(),rotated=(await correct(source,[],[{page:1,degrees:270}])).bytes,obj=(await inspect(rotated,1)).objects.find(o=>o.editable);
 const result=await correct(rotated,[{page:1,index:obj.index,before:obj.text,after:'',operation:'delete'}],[{page:1,degrees:90}]);assert.equal(await rotationOf(result.bytes),0);assert.equal((await inspect(result.bytes,1)).objects.filter(o=>o.editable).length,1);assert(result.verification.pageContentPixelsUnchanged);assert.equal(result.verification.rotations[0].beforeDegrees,270);
});
test('rotation validation and pending state cover undo, re-export, and invalid pages',async()=>{
 const bytes=await fixture();await assert.rejects(()=>correct(bytes,[],[{page:1,degrees:45}]),/90/);await assert.rejects(()=>correct(bytes,[],[{page:99,degrees:90}]),/Invalid page/);await assert.rejects(()=>correct(bytes,[],[{page:1,degrees:90},{page:1,degrees:180}]),/one/);
 const {pendingRotationCount}=await import('../src/review-controls.mjs');assert.equal(pendingRotationCount(new Map([[1,90]]),new Map()),1);assert.equal(pendingRotationCount(new Map([[1,0]]),new Map()),0);assert.equal(pendingRotationCount(new Map([[1,90]]),new Map([[1,90]])),0);assert.equal(pendingRotationCount(new Map([[1,0],[2,90]]),new Map([[1,90]])),2);
});

test('deskew preserves text, saves transformed bounds, combines with correction and rotation',async()=>{
 const bytes=await fixture(),before=await inspect(bytes,1),hidden=before.objects.find(o=>o.editable);
 const result=await correct(bytes,[{page:1,index:hidden.index,before:hidden.text,after:'Fixed word'}],[{page:1,degrees:90}],[{page:1,degrees:2.5}]);
 assert.equal(await rotationOf(result.bytes),90);const after=await inspect(result.bytes,1);assert.equal(after.objects.find(o=>o.index===hidden.index).text,'Fixed word');
 assert.notDeepEqual(after.objects[0].bounds,before.objects[0].bounds);assert(result.verification.deskewReadback);assert.equal(result.verification.pageContentPixelsUnchanged,false);assert(result.verification.deskews[0].scale<1);
 for(const degrees of [-10,-0.1,0.1,10])assert((await correct(bytes,[],[],[{page:1,degrees}])).verification.deskewReadback);
 await assert.rejects(()=>correct(bytes,[],[],[{page:1,degrees:11}]),/deskew angle/);
});

async function spacingFixture(){
 const p=await getEngine(),doc=p.FPDF_CreateNewDocument(),page=p.FPDFPage_New(doc,0,300,200);
 try{for(const [text,x] of [['MINERALS ',25],['T',95],['HE',115]]){
  const obj=p.FPDFPageObj_NewTextObj(doc,'Helvetica',12),b=Buffer.from(text+'\0','utf16le'),ptr=p.pdfium.wasmExports.malloc(b.length);p.pdfium.HEAPU8.set(b,ptr);assert(p.FPDFText_SetText(obj,ptr));p.pdfium.wasmExports.free(ptr);p.FPDFTextObj_SetTextRenderMode(obj,3);p.FPDFPageObj_Transform(obj,1,0,0,1,x,70);p.FPDFPage_InsertObject(page,obj);
 }assert(p.FPDFPage_GenerateContent(page));return saveBytes(p,doc);}finally{p.FPDF_ClosePage(page);p.FPDF_CloseDocument(doc);}
}
test('deleting adjacent OCR objects tolerates extraction boundary-space changes without losing retained text',async()=>{
 const bytes=await spacingFixture(),objects=(await inspect(bytes,1)).objects;assert.equal(objects[0].text,'MINERALS ');
 const result=await correct(bytes,objects.slice(1).map(o=>({page:1,index:o.index,before:o.text,after:'',operation:'delete'})));
 const saved=(await inspect(result.bytes,1)).objects;assert.equal(saved.length,1);assert.equal(saved[0].text,'MINERALS');assert(result.verification.pagePixelsUnchanged);assert(result.verification.textReadback);
});
test('unsupported replacement characters still fail saved-text verification with page and block details',async()=>{
 const bytes=await spacingFixture(),obj=(await inspect(bytes,1)).objects[0];
 await assert.rejects(()=>correct(bytes,[{page:1,index:obj.index,before:obj.text,after:'MINERALS 😀'}]),/Page 1, text block 0: saved text/);
});
