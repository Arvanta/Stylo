const defaults={enabled:true,styles:[],globalCss:'',version:1};
async function get(){return browser.storage.local.get(defaults)}
browser.runtime.onMessage.addListener(async(msg)=>{if(msg.type==='open-manager') browser.runtime.openOptionsPage(); if(msg.type==='apply') {const d=await get(); browser.tabs.query({active:true,currentWindow:true}).then(ts=>ts[0]&&browser.tabs.sendMessage(ts[0].id,{type:'refresh',data:d}).catch(()=>{}))}});
browser.runtime.onInstalled.addListener(()=>browser.storage.local.set(defaults));
browser.storage.local.get().then(d=>{if(d.styles?.some(s=>s.id==='github-dark')) browser.storage.local.set({styles:d.styles.filter(s=>s.id!=='github-dark')})});