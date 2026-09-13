const path=require('node:path');
function portablePath(value){
 if(typeof value!=='string')throw Error('Invalid PDF assignment.');
 const clean=value.replace(/\\/g,'/');
 if(!clean||clean.startsWith('/')||/^[a-z]:/i.test(clean)||clean.split('/').some(part=>!part||part==='.'||part==='..')||/[\x00-\x1f]/.test(clean)||!/[.]pdf$/i.test(clean))throw Error('PDF assignment must be a PDF path inside the project folder.');
 return clean;
}
function assignedFiles(record,files,matchFiles){
 if(!record.pdfAssignment)return matchFiles(record.id,files);
 let value;try{value=portablePath(record.pdfAssignment);}catch{return {exact:[],suggested:[],assignmentMissing:true};}
 // Preserve case-sensitive distinctions. Only accept case-insensitive matches when unique.
 let found=files.filter(f=>f.relative.replace(/\\/g,'/')===value);
 if(!found.length)found=files.filter(f=>f.relative.replace(/\\/g,'/').toLowerCase()===value.toLowerCase());
 return {exact:found.length===1?[found[0].path]:[],suggested:found.length>1?found.map(f=>f.path):[],assignmentMissing:found.length!==1};
}
function assignmentFor(root,filename){return portablePath(path.relative(root,filename));}
module.exports={portablePath,assignedFiles,assignmentFor};
