export function nextCheckedPage(current,total){return Number.isInteger(current)&&current>=1&&current<total?current+1:null;}
export function nextUncheckedPage(current,total,checkedPages){
	const checked=new Set(checkedPages);
	for(let offset=1;offset<total;offset++){const page=(current-1+offset)%total+1;if(!checked.has(page))return page;}
	return null;
}
export function sortByPageCount(rows,pageCounts,direction){
	if(!['shortest','longest'].includes(direction))return rows;
	const factor=direction==='shortest'?1:-1;
	return rows.map((row,index)=>({row,index,count:pageCounts.get(row.key)})).sort((a,b)=>{
		if(a.count==null)return b.count==null?a.index-b.index:1;
		if(b.count==null)return -1;
		return (a.count-b.count)*factor||a.index-b.index;
	}).map(item=>item.row);
}
export function queueTarget(rows,currentKey,move){
	if(!rows.length)return null;
	const current=Math.max(0,rows.findIndex(row=>row.key===currentKey));
	const index=move==='first'?0:move==='last'?rows.length-1:Math.max(0,Math.min(rows.length-1,current+(move==='previous'?-1:1)));
	return rows[index]||null;
}
export function paneShare(value,width=800){const min=Math.max(25,150/width*100),max=Math.min(75,(width-159)/width*100);return Math.max(min,Math.min(max,Number.isFinite(value)?value:59));}
export function matchingTextObject(objects,text){const candidates=objects.filter(o=>o.editable&&o.text.trim()===text.trim());return candidates.length===1?candidates[0].index:null;}
export function mergedCorrections(exported,pending){return [...new Map([...exported,...pending]).values()].filter(e=>e.after!==e.before);}

export function pendingRotationCount(current,exported){return [...new Set([...current.keys(),...exported.keys()])].filter(page=>(current.get(page)||0)!==(exported.get(page)||0)).length;}

export function parsePageSelection(value,total){
	if(!Number.isInteger(total)||total<1)throw Error('Open a PDF before selecting pages.');
	const input=String(value).trim();if(!input)throw Error('Enter at least one page number.');
	const pages=new Set();
	for(const part of input.split(',')){
		const match=part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);if(!match)throw Error('Use page numbers and ranges such as 2-6, 9.');
		const start=Number(match[1]),end=Number(match[2]||match[1]);if(start<1||end>total)throw Error(`Pages must be between 1 and ${total}.`);if(start>end)throw Error('Page ranges must start with the lower page number.');
		for(let page=start;page<=end;page++)pages.add(page);
	}
	return [...pages].sort((a,b)=>a-b);
}
