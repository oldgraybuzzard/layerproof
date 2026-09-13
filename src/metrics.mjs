export function distance(a,b) {
  if(a.length<b.length) [a,b]=[b,a];
  let previous=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=0;i<a.length;i++) {const current=[i+1]; for(let j=0;j<b.length;j++) current[j+1]=Math.min(current[j]+1,previous[j+1]+1,previous[j]+(a[i]===b[j]?0:1)); previous=current;}
  return previous[b.length];
}
export function errorRates(reference,ocr) {
  const normalize=s=>s.normalize('NFC').replace(/\s+/gu,' ').trim();
  const r=normalize(reference),o=normalize(ocr);
  if(!r) throw Error('Enter a manually verified reference transcript first.');
  if(Array.from(r).length>12000 || Array.from(o).length>12000) throw Error('Use a page or excerpt of at most 12,000 characters.');
  const rw=r.split(' '),ow=o?o.split(' '):[];
  const characterErrors=distance(Array.from(r),Array.from(o)),wordErrors=distance(rw,ow);
  return {cer:characterErrors/Array.from(r).length,wer:wordErrors/rw.length,characterErrors,wordErrors,characters:Array.from(r).length,words:rw.length};
}
