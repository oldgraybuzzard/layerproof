const {test}=require('node:test');const assert=require('node:assert/strict');
const records=[1,2,3,4].map((id,i)=>({id:String(id),key:'row'+id,row:i+3,hasIssues:'Yes',concerns:'Page 1: text',exact:id===4?[]:['doc'+id+'.pdf'],suggested:[]}));
const review=(i,complete)=>({...records[i],complete});
test('default queue hides completed reviews but keeps saved partial reviews',async()=>{const {queueRows}=await import('../src/queue.mjs');const reviews={row1:review(0,true),row2:review(1,false)};assert.deepEqual(queueRows(records,reviews).map(r=>r.id),['2','3']);assert.deepEqual(queueRows(records,reviews,'completed').map(r=>r.id),['1']);assert.equal(queueRows(records,reviews,'all').length,4);});
test('changed workbook decision makes completed review pending again',async()=>{const {queueRows}=await import('../src/queue.mjs');const reviews={row1:{...review(0,true),concerns:'old concern'}};assert.equal(queueRows(records,reviews).length,3);});
test('save-next skips completed rows and wraps to earlier unfinished work',async()=>{const {nextPending}=await import('../src/queue.mjs');assert.equal(nextPending(records,{row2:review(1,true)},'row1').id,'3');assert.equal(nextPending(records,{},'row3').id,'1');assert.equal(nextPending(records,{row1:review(0,true),row2:review(1,true)},'row3'),null);});
test('completed reviews remain searchable when explicitly shown',async()=>{const {queueRows}=await import('../src/queue.mjs');const reviews={row1:review(0,true)};assert.equal(queueRows(records,reviews,'pending','1').length,0);assert.equal(queueRows(records,reviews,'completed','1').length,1);assert.equal(queueRows(records,reviews,'missing')[0].id,'4');});
test('workbook completion overrides absent or stale local history and allows explicit reopening',async()=>{
 const {queueRows,nextPending}=await import('../src/queue.mjs');const rows=records.map((r,i)=>({...r,qcReviewed:i===0}));const reviews={row2:review(1,true)};
 assert.deepEqual(queueRows(rows,reviews).map(r=>r.id),['2','3']);assert.deepEqual(queueRows(rows,{},'completed').map(r=>r.id),['1']);assert.equal(nextPending(rows,reviews,'row3').id,'2');
});
