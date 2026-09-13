export function matchingReview(record,reviews){const review=reviews[record.key];return review&&review.id===record.id&&review.hasIssues===record.hasIssues&&review.concerns===record.concerns?review:null;}
export const isComplete=(record,reviews)=>record.qcReviewed??!!matchingReview(record,reviews)?.complete;
export const hasPDF=record=>!!(record.exact.length||record.suggested.length);
export function queueRows(records,reviews,filter='pending',search=''){
  const query=search.trim().toLowerCase();
  return records.filter(r=>{
    if(!r.id.toLowerCase().includes(query)&&String(r.row)!==query)return false;
    const complete=isComplete(r,reviews);
    switch(filter){
      case 'pending':return hasPDF(r)&&!complete;
      case 'completed':return complete;
      case 'available':return hasPDF(r);
      case 'missing':return !hasPDF(r);
      case 'issues':return r.hasIssues.toLowerCase()==='yes';
      case 'all':return true;
      default:return false;
    }
  });
}
export function nextPending(records,reviews,currentKey){
  const index=records.findIndex(r=>r.key===currentKey);
  return [...records.slice(index+1),...records.slice(0,Math.max(index,0))].find(r=>hasPDF(r)&&!isComplete(r,reviews))||null;
}
