function signingConfig(env=process.env){
 const requireValue=name=>{if(!env[name]?.trim())throw Error('Signed build requires '+name+'. See SIGNING.md.');return env[name];};
 const win={signAndEditExecutable:true,signExecutable:true,forceCodeSigning:true};
 const provider=requireValue('LAYERPROOF_SIGNING_PROVIDER');
 if(provider==='azure'){
  for(const name of ['AZURE_TENANT_ID','AZURE_CLIENT_ID','AZURE_CLIENT_SECRET'])requireValue(name);
  const endpoint=requireValue('AZURE_SIGNING_ENDPOINT');if(!/^https:\/\/[a-z0-9.-]+\/?$/i.test(endpoint))throw Error('Azure signing endpoint must be an HTTPS service URL.');
  win.azureSignOptions={endpoint,codeSigningAccountName:requireValue('AZURE_SIGNING_ACCOUNT'),certificateProfileName:requireValue('AZURE_SIGNING_PROFILE'),publisherName:requireValue('LAYERPROOF_SIGNING_PUBLISHER')};
 }else if(provider==='certificate'){
  requireValue('WIN_CSC_LINK');requireValue('WIN_CSC_KEY_PASSWORD');
  win.signtoolOptions={publisherName:requireValue('LAYERPROOF_SIGNING_PUBLISHER'),signingHashAlgorithms:['sha256']};
 }else throw Error('Signing provider must be azure or certificate.');
 const base=require('../package.json').build;return {...base,win:{...base.win,...win}};
}
module.exports={signingConfig};
