const fs=require('node:fs/promises');const crypto=require('node:crypto');const {init}=require('@embedpdf/pdfium');
let engine;
async function getEngine(){if(!engine)engine=init({wasmBinary:await fs.readFile(require.resolve('@embedpdf/pdfium/pdfium.wasm'))}).then(p=>{p.PDFiumExt_Init();return p;});return engine;}
function allocate(p,bytes){const ptr=p.pdfium.wasmExports.malloc(bytes.length);if(!ptr)throw Error('Not enough memory to edit this PDF.');p.pdfium.HEAPU8.set(bytes,ptr);return ptr;}
const release=(p,ptr)=>p.pdfium.wasmExports.free(ptr);
function load(p,bytes){const ptr=allocate(p,bytes),doc=p.FPDF_LoadMemDocument(ptr,bytes.length,0);if(!doc){release(p,ptr);throw Error('Cannot open PDF for correction. Password-protected or damaged PDFs are not supported.');}return {doc,close:()=>{p.FPDF_CloseDocument(doc);release(p,ptr);}};}
function checkDocument(p,doc){if(p.FPDF_GetSignatureCount(doc)>0)throw Error('This PDF is digitally signed. OCR editing is disabled to preserve its signature.');if(p.FPDF_GetSecurityHandlerRevision(doc)!==-1)throw Error('OCR editing is not available for encrypted PDFs.');}
function objectText(p,obj,textPage){const length=p.FPDFTextObj_GetText(obj,textPage,0,0);if(length<2)return '';const ptr=allocate(p,new Uint8Array(length));try{p.FPDFTextObj_GetText(obj,textPage,ptr,length);return Buffer.from(p.pdfium.HEAPU8.slice(ptr,ptr+length-2)).toString('utf16le');}finally{release(p,ptr);}}
function listObjects(p,page){const tp=p.FPDFText_LoadPage(page);if(!tp)throw Error('Cannot inspect this page’s text.');const objects=[];let nested=0;try{for(let index=0;index<p.FPDFPage_CountObjects(page);index++){const obj=p.FPDFPage_GetObject(page,index),type=p.FPDFPageObj_GetType(obj);if(type===5){nested++;continue;}if(type!==1)continue;const text=objectText(p,obj,tp);if(!text.trim())continue;const ptr=allocate(p,new Uint8Array(16));let bounds=null;try{if(p.FPDFPageObj_GetBounds(obj,ptr,ptr+4,ptr+8,ptr+12)){const v=new DataView(p.pdfium.HEAPU8.buffer);bounds=[0,4,8,12].map(i=>v.getFloat32(ptr+i,true));}}finally{release(p,ptr);}objects.push({index,text,bounds,editable:p.FPDFTextObj_GetTextRenderMode(obj)===3});}}finally{p.FPDFText_ClosePage(tp);}return {objects,nested};}
function pageHandle(p,doc,number){if(!Number.isInteger(number)||number<1||number>p.FPDF_GetPageCount(doc))throw Error('Invalid page number.');const page=p.FPDF_LoadPage(doc,number-1);if(!page)throw Error('Cannot load this page.');return page;}
async function inspect(bytes,number){const p=await getEngine(),file=load(p,bytes);try{checkDocument(p,file.doc);const page=pageHandle(p,file.doc,number);try{return listObjects(p,page);}finally{p.FPDF_ClosePage(page);}}finally{file.close();}}
function pixels(p,page){const width=p.FPDF_GetPageWidth(page),height=p.FPDF_GetPageHeight(page);const scale=Math.min(4/3,4096/Math.max(width,height));const w=Math.ceil(width*scale),h=Math.ceil(height*scale);if(w<1||h<1)throw Error('Invalid page dimensions.');const bitmap=p.FPDFBitmap_Create(w,h,0);if(!bitmap)throw Error('Cannot verify page appearance.');try{p.FPDFBitmap_FillRect(bitmap,0,0,w,h,0xffffffff);p.FPDF_RenderPageBitmap(bitmap,page,0,0,w,h,0,1);const ptr=p.FPDFBitmap_GetBuffer(bitmap),size=p.FPDFBitmap_GetStride(bitmap)*h;return crypto.createHash('sha256').update(p.pdfium.HEAPU8.subarray(ptr,ptr+size)).digest('hex');}finally{p.FPDFBitmap_Destroy(bitmap);}}
function saveBytes(p,doc){const writer=p.PDFiumExt_OpenFileWriter();if(!writer)throw Error('Cannot allocate PDF writer.');try{if(!p.FPDF_SaveAsCopy(doc,writer,2))throw Error('Cannot create corrected PDF.');const length=p.PDFiumExt_GetFileWriterSize(writer),ptr=allocate(p,new Uint8Array(length));try{const copied=p.PDFiumExt_GetFileWriterData(writer,ptr,length);if(copied!==length)throw Error('Incomplete PDF output.');return Buffer.from(p.pdfium.HEAPU8.slice(ptr,ptr+length));}finally{release(p,ptr);}}finally{p.PDFiumExt_CloseFileWriter(writer);}}
function deskewPage(p,page,degrees){
 if(p.FPDFPage_GetAnnotCount(page))throw Error('Deskew is not supported on pages with annotations or form fields.');
 const ptr=allocate(p,new Uint8Array(16));let box;
 try{if(!p.FPDFPage_GetCropBox(page,ptr,ptr+4,ptr+8,ptr+12)&&!p.FPDFPage_GetMediaBox(page,ptr,ptr+4,ptr+8,ptr+12))throw Error('Cannot determine page bounds for deskew.');const v=new DataView(p.pdfium.HEAPU8.buffer);box=[0,4,8,12].map(i=>v.getFloat32(ptr+i,true));}finally{release(p,ptr);}
 const [left,bottom,right,top]=box,w=right-left,h=top-bottom;
 if(!(w>0&&h>0))throw Error('Invalid page bounds for deskew.');
 const radians=-degrees*Math.PI/180,cos=Math.cos(radians),sin=Math.sin(radians);
 const scale=Math.min(w/(Math.abs(cos)*w+Math.abs(sin)*h),h/(Math.abs(sin)*w+Math.abs(cos)*h));
 const a=scale*cos,b=scale*sin,c=-scale*sin,d=scale*cos,cx=(left+right)/2,cy=(bottom+top)/2,e=cx-a*cx-c*cy,f=cy-b*cx-d*cy;
 for(let i=0;i<p.FPDFPage_CountObjects(page);i++){const obj=p.FPDFPage_GetObject(page,i);p.FPDFPageObj_Transform(obj,a,b,c,d,e,f);p.FPDFPageObj_TransformClipPath(obj,a,b,c,d,e,f);}
 if(!p.FPDFPage_GenerateContent(page))throw Error('Cannot generate deskewed page content.');
 return {degrees,scale,matrix:[a,b,c,d,e,f]};
}
// PDFium's extracted object text can gain/lose boundary spaces when neighboring
// objects are removed. Keep object identity/order and every non-boundary character
// strict; only ASCII spaces at the edges are presentation-dependent.
const verificationText=text=>text.replace(/^ +| +$/g,'');
function verifyTextObjects(actual,expected,page){
 if(actual.length!==expected.length)throw Error(`Page ${page}: saved OCR block count differs from the requested result. Export cancelled.`);
 for(let i=0;i<expected.length;i++){
  const a=actual[i],e=expected[i];
  if(a.index!==e.index||a.editable!==e.editable||verificationText(a.text)!==verificationText(e.text))throw Error(`Page ${page}, text block ${e.index}: saved text did not match the requested corrections or deletions. Export cancelled.`);
 }
}
async function correct(bytes,edits,rotations=[],deskews=[]){
 if(!Array.isArray(edits)||edits.length>500||!Array.isArray(rotations)||rotations.length>10000||!Array.isArray(deskews)||deskews.length>10000||(!edits.length&&!rotations.length&&!deskews.length))throw Error('Choose text corrections or page rotations to export.');
 const deskewPages=new Set();for(const d of deskews){if(!Number.isInteger(d.page)||d.page<1||!Number.isFinite(d.degrees)||Math.abs(d.degrees)>10||Math.abs(d.degrees)<0.01||deskewPages.has(d.page))throw Error('Choose one deskew angle between -10 and 10 degrees per page (not zero).');deskewPages.add(d.page);}
 const deskewResults=[];
 const rotationPages=new Set();for(const r of rotations){if(!Number.isInteger(r.page)||r.page<1||![90,180,270].includes(r.degrees)||rotationPages.has(r.page))throw Error('Choose one 90, 180, or 270 degree rotation per page.');rotationPages.add(r.page);}
 const seen=new Set();for(const e of edits){const key=e.page+':'+e.index;if(seen.has(key))throw Error('Duplicate correction target.');seen.add(key);if(!Number.isInteger(e.index)||e.index<0||typeof e.before!=='string'||typeof e.after!=='string'||(e.operation==='delete'?e.after!=='':!e.after.trim())||e.after.length>4000||/[\x00-\x1f]/.test(e.after))throw Error('Use a nonempty, single-line correction of at most 4,000 characters, or explicitly delete the text.');}
 const p=await getEngine(),file=load(p,bytes),visuals=new Map(),expected=new Map(),orientations=new Map(),rotatedPixels=new Map();let output;
 try{checkDocument(p,file.doc);for(const number of new Set([...edits.map(e=>e.page),...rotations.map(r=>r.page),...deskews.map(d=>d.page)])){const page=pageHandle(p,file.doc,number);try{visuals.set(number,pixels(p,page));const list=listObjects(p,page).objects;const pageEdits=edits.filter(e=>e.page===number);const removed=pageEdits.filter(e=>e.operation==='delete').map(e=>e.index);
 expected.set(number,list.filter(o=>!removed.includes(o.index)).map(o=>({index:o.index-removed.filter(i=>i<o.index).length,text:pageEdits.find(e=>e.index===o.index)?.after??o.text,editable:o.editable})));
 for(const e of [...pageEdits].sort((a,b)=>b.index-a.index)){const original=list.find(o=>o.index===e.index);if(!original||original.text!==e.before)throw Error('The selected PDF text changed. Reload the correction list.');if(!original.editable)throw Error('Only invisible OCR text can be corrected; visible text is review-only.');const obj=p.FPDFPage_GetObject(page,e.index);if(e.operation==='delete'){if(!p.FPDFPage_RemoveObject(page,obj))throw Error('Cannot remove this OCR text block.');p.FPDFPageObj_Destroy(obj);continue;}const ptr=allocate(p,Buffer.from(e.after+'\0','utf16le'));try{if(!p.FPDFText_SetText(obj,ptr))throw Error('The PDF font cannot accept this correction.');}finally{release(p,ptr);}}
 if(pageEdits.length&&!p.FPDFPage_GenerateContent(page))throw Error('Cannot regenerate corrected page content.');if(pixels(p,page)!==visuals.get(number))throw Error('Correction changed the visible page. Export cancelled.');
 const deskew=deskews.find(d=>d.page===number);if(deskew)deskewResults.push({page:number,...deskewPage(p,page,deskew.degrees)});
 const beforeRotation=p.FPDFPage_GetRotation(page),degrees=rotations.find(r=>r.page===number)?.degrees||0,afterRotation=(beforeRotation+degrees/90)%4;orientations.set(number,{before:beforeRotation,after:afterRotation});p.FPDFPage_SetRotation(page,afterRotation);rotatedPixels.set(number,pixels(p,page));
 }finally{p.FPDF_ClosePage(page);}}
 output=saveBytes(p,file.doc);
 }finally{file.close();}
 const verified=load(p,output);try{for(const [number,digest] of visuals){const page=pageHandle(p,verified.doc,number);try{const orientation=orientations.get(number);if(p.FPDFPage_GetRotation(page)!==orientation.after||pixels(p,page)!==rotatedPixels.get(number))throw Error('Saved page rotation did not match the requested orientation. Export cancelled.');p.FPDFPage_SetRotation(page,orientation.before);if(!deskewPages.has(number)&&pixels(p,page)!==digest)throw Error('Saved PDF changed the page appearance. Export cancelled.');const actual=listObjects(p,page).objects.map(({index,text,editable})=>({index,text,editable}));verifyTextObjects(actual,expected.get(number),number);}finally{p.FPDF_ClosePage(page);}}}finally{verified.close();}
 return {bytes:output,verification:{editedPages:[...visuals.keys()],textReadback:true,pagePixelsUnchanged:rotations.length===0&&deskews.length===0,pageContentPixelsUnchanged:deskews.length===0,deskewReadback:true,deskews:deskewResults,rotationReadback:true,rotations:rotations.map(r=>({...r,beforeDegrees:orientations.get(r.page).before*90,afterDegrees:orientations.get(r.page).after*90})),renderDpi:96,maxRenderDimension:4096},sourceSha256:crypto.createHash('sha256').update(bytes).digest('hex'),outputSha256:crypto.createHash('sha256').update(output).digest('hex')};
}
module.exports={inspect,correct,getEngine,load,saveBytes,pixels};
