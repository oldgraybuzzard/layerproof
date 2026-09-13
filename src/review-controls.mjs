export function nextCheckedPage(current,total){return Number.isInteger(current)&&current>=1&&current<total?current+1:null;}
export function paneShare(value,width=800){const min=Math.max(25,150/width*100),max=Math.min(75,(width-159)/width*100);return Math.max(min,Math.min(max,Number.isFinite(value)?value:59));}
export function matchingTextObject(objects,text){const candidates=objects.filter(o=>o.editable&&o.text.trim()===text.trim());return candidates.length===1?candidates[0].index:null;}
export function mergedCorrections(exported,pending){return [...new Map([...exported,...pending]).values()].filter(e=>e.after!==e.before);}

export function pendingRotationCount(current,exported){return [...new Set([...current.keys(),...exported.keys()])].filter(page=>(current.get(page)||0)!==(exported.get(page)||0)).length;}
