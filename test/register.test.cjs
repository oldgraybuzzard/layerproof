const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const {zipSync,unzipSync,strToU8,strFromU8}=require('fflate');const {decode,updateBuffer,matchFiles,saveRegister,hash}=require('../src/register.cjs');
function fixture(){return zipSync(Object.fromEntries(Object.entries({
'xl/workbook.xml':'<workbook><sheets><sheet name="Control" r:id="rId1"/></sheets></workbook>',
'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
'xl/worksheets/sheet1.xml':'<worksheet><sheetData><row r="2"><c r="A2" t="inlineStr"><is><t>Document ID</t></is></c><c r="D2" t="inlineStr"><is><t>Has Issues</t></is></c></row><row r="3"><c r="A3"><v>64</v></c><c r="C3" s="1"><f>1+1</f><v>2</v></c><c r="D3" s="2" t="inlineStr"><is><t>No</t></is></c><c r="F3"><v>42</v></c></row><row r="4"><c r="A4"><v>64</v></c><c r="D4" s="2"/></row></sheetData><mergeCells><mergeCell ref="A1:E1"/></mergeCells></worksheet>',
'xl/styles.xml':'<styleSheet>preserve me</styleSheet>'}).map(([k,v])=>[k,strToU8(v)])));}
test('finds headers below title and retains duplicate row identities',()=>{const r=decode(fixture()).records;assert.equal(r.length,2);assert.equal(r[0].row,3);assert.equal(r[0].duplicate,true);assert.notEqual(r[0].key,r[1].key);});
test('patches only requested D/E cells, preserves styles, formulas and ZIP members',()=>{
 const before=fixture(),wb=decode(before),updated=updateBuffer(before,wb.records[0].key,'Yes','Page 1: <bad> & “text”\n=not a formula');const result=decode(updated);
 assert.equal(result.records[0].concerns,'Page 1: <bad> & “text”\n=not a formula');assert.equal(result.records[1].hasIssues,'');
 const a=unzipSync(before),b=unzipSync(updated);for(const name of Object.keys(a))if(name!==wb.member)assert.deepEqual(a[name],b[name]);
 const clean=xml=>xml.replace(/<c\b[^>]*r="[DE]3"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g,'');assert.equal(clean(strFromU8(a[wb.member])),clean(strFromU8(b[wb.member])));assert.match(strFromU8(b[wb.member]),/r="D3" s="2"/);
});
test('self-closing cells and No clear work',()=>{const wb=decode(fixture());const out=decode(updateBuffer(fixture(),wb.records[1].key,'No',''));assert.equal(out.records[1].hasIssues,'No');assert.equal(out.records[0].hasIssues,'No');});
test('rejects invalid decisions and invalid concern contents',()=>{const key=decode(fixture()).records[0].key;for(const [d,c] of [['',''],['Yes',''],['No','bad'],['Yes','x\u0000']])assert.throws(()=>updateBuffer(fixture(),key,d,c));});
test('exact matching is case insensitive; combined PDFs remain suggestions',()=>{const files=['64.PDF','164.pdf','4644_4646_4648_4649_bookmarked.pdf','4656_bookmarked.pdf'].map(name=>({name,path:name}));assert.deepEqual(matchFiles('64',files),{exact:['64.PDF'],suggested:[]});assert.equal(matchFiles('4646',files).exact.length,0);assert.equal(matchFiles('4646',files).suggested.length,1);assert.equal(matchFiles('4656',files).suggested.length,1);});
test('save creates exact backup and rejects stale workbook changes',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ocr-qc-unit-'));try{const filename=path.join(dir,'control.xlsx'),buffer=fixture(),wb=decode(buffer);await fs.writeFile(filename,buffer);const saved=await saveRegister(filename,hash(buffer),wb.records[0].key,'Yes','Page 1: test');assert.deepEqual(await fs.readFile(saved.backup),Buffer.from(buffer));assert.equal(decode(await fs.readFile(filename)).records[0].hasIssues,'Yes');await assert.rejects(()=>saveRegister(filename,hash(buffer),wb.records[0].key,'No',''),/changed/);assert.equal((await fs.readdir(dir)).some(n=>n.endsWith('.lock')),false);}finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('error rates use reference denominator and count substitutions, deletions, insertions',async()=>{const {errorRates}=await import('../src/metrics.mjs');assert.equal(errorRates('cat','cut').cer,1/3);assert.equal(errorRates('one two','one').wer,.5);assert.equal(errorRates('one','one two three').wer,2);assert.equal(errorRates(' A  B\n','A B').cer,0);assert.throws(()=>errorRates('','a'));});
function sheetFixture(transform){const files=unzipSync(fixture());files['xl/worksheets/sheet1.xml']=strToU8(transform(strFromU8(files['xl/worksheets/sheet1.xml'])));return zipSync(files);}
test('QC flag appends beyond client columns and survives reopening without local history',async()=>{
 const original=fixture(),wb=decode(original),updated=updateBuffer(original,wb.records[0].key,'Yes','Found an issue',true),out=decode(updated);
 assert.equal(out.qcColumn,'G');assert.equal(out.records[0].qcReviewed,true);assert.equal(out.records[1].qcReviewed,false);
 const xml=strFromU8(out.files[out.member]);assert.match(xml,/<c r="F3"><v>42<\/v><\/c>/);assert.match(xml,/QC Reviewed/);
 const {queueRows,nextPending}=await import('../src/queue.mjs');const rows=out.records.map(r=>({...r,exact:['file.pdf'],suggested:[]}));assert.deepEqual(queueRows(rows,{}).map(r=>r.row),[4]);assert.equal(queueRows(rows,{},'completed')[0].row,3);assert.equal(nextPending(rows,{},rows[1].key),null);
 const after=decode(updateBuffer(updated,out.records[0].key,'Yes','Partial recheck',false));assert.equal(after.records[0].qcReviewed,false);assert.equal(after.qcColumn,'G');
});
test('existing QC headers accept Yes, TRUE, and Excel boolean cells without adding columns',()=>{
 for(const [type,value] of [['inlineStr',' Yes '],['inlineStr','TRUE'],['b','1'],['n','1'],['inlineStr','false'],['b','0']]){
  const cell=type==='inlineStr'?`<c r="H3" t="inlineStr"><is><t>${value}</t></is></c>`:`<c r="H3" t="${type}"><v>${value}</v></c>`;
  const input=sheetFixture(x=>x.replace('</row>','<c r="H2" t="inlineStr"><is><t>QC Performed</t></is></c></row>').replace(/(<row r="3">[\s\S]*?)(<\/row>)/,(_,row,end)=>row+cell+end));
  const wb=decode(input);assert.equal(wb.qcColumn,'H');assert.equal(wb.records[0].qcReviewed,/yes|true|1/i.test(value));
  assert.equal(decode(updateBuffer(input,wb.records[1].key,'No','',true)).qcColumn,'H');
 }
});
test('first-save migration carries forward only provided completed row keys',()=>{
 const input=fixture(),wb=decode(input);const output=decode(updateBuffer(input,wb.records[0].key,'Yes','Partial',false,[wb.records[1].key]));assert.equal(output.records[0].qcReviewed,false);assert.equal(output.records[1].qcReviewed,true);
 const next=decode(updateBuffer(zipSync(output.files),output.records[0].key,'No','',true,[output.records[1].key]));assert.equal(next.records[1].qcReviewed,true);
});
test('QC column stays outside existing merges and expands worksheet dimension',()=>{
 const input=sheetFixture(x=>x.replace('<sheetData>','<dimension ref="A1:F4"/><sheetData>').replace('A1:E1','A1:H1'));
 const wb=decode(input),output=decode(updateBuffer(input,wb.records[0].key,'No','',true));assert.equal(output.qcColumn,'I');assert.match(strFromU8(output.files[output.member]),/<dimension ref="A1:I4"\/>/);
});
test('saved completion is durable on disk with an exact pre-save backup',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'layerproof-reviewed-'));try{const filename=path.join(dir,'control.xlsx'),before=fixture(),wb=decode(before);await fs.writeFile(filename,before);const result=await saveRegister(filename,hash(before),wb.records[0].key,'No','',true);assert.equal(decode(await fs.readFile(filename)).records[0].qcReviewed,true);assert.deepEqual(await fs.readFile(result.backup),Buffer.from(before));}finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('saving a blank decision cell preserves the following populated cells',()=>{
 const input=sheetFixture(x=>x.replace('<c r="D3" s="2" t="inlineStr"><is><t>No</t></is></c>','<c r="D3" s="2"/><c r="E3" s="2"/>'));
 const wb=decode(input),out=decode(updateBuffer(input,wb.records[0].key,'Yes','Checked',true));assert.match(strFromU8(out.files[out.member]),/<c r="F3"><v>42<\/v><\/c>/);assert.equal(out.records[1].id,'64');
});
