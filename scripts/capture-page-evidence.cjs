'use strict';
const {browserConfig}=require('../tools/config.cjs');
// Read only a narrow whitelist. Never return full URLs, storage or account state.
function visibleProof(){
 const visible=e=>{if(!e||!e.getClientRects().length)return false;for(let p=e;p&&p.nodeType===1;p=p.parentElement){const s=getComputedStyle(p);if(p.hidden||p.getAttribute('aria-hidden')==='true'||s.display==='none'||s.visibility==='hidden')return false;}return true;};
 const text=e=>String(e?.innerText||e?.textContent||'').replace(/\s+/g,' ').trim().slice(0,500);
 const all=s=>[...document.querySelectorAll(s)].filter(visible);
 const dialogs=all('[role=dialog].HidQ9ROd'),d=dialogs.length===1?dialogs[0]:null,selected={};
 if(d)for(const group of d.querySelectorAll('.bIhLWVqm')){const heading=group.querySelector('.sku-specs-key')?.cloneNode(true);if(heading)for(const guide of heading.querySelectorAll('.oecDTzM9'))if(text(guide)==='尺码详情')guide.remove();const label=text(heading),options=[...group.querySelectorAll('.F7sZG3xe.hr353bdX[aria-label]')].filter(visible);if(label&&options.length===1)selected[label]=options[0].getAttribute('aria-label');}
 let bound=null;const panels=[...document.querySelectorAll('[role=dialog].HidQ9ROd')];
 if(panels.length===1){const keys=Object.keys(panels[0]).filter(k=>k.startsWith('__reactFiber$'));let f=keys.length===1?panels[0][keys[0]]:null;for(let i=0;f&&i<5;i++,f=f.return){const g=f.memoizedProps?.goods,s=f.stateNode?.state;if(g&&s?.skuInfos&&s.currentSelect){const row=s.skuInfos[s.selectedSkuID];bound={goods_id:String(g.goodsID),selected_sku_id:String(s.selectedSkuID),selected:s.currentSelect,group_price:row?.groupPrice,coupon_cents:row?.skuPrice};break;}}}
 return{observed_at:new Date().toISOString(),path:location.pathname,goods_id:new URL(location.href).searchParams.get('goods_id'),query:new URL(location.href).searchParams.get('search_key'),title:text(document.querySelector('.tLYIg_Ju.enable-select')),detail_prices:all('.uPP2olgd').map(text),attributes:all('.pApAfrwF .iUUH2sOQ').map(e=>({name:text(e.querySelector('.rMnkPxwx')),value:text(e.querySelector('.KjtdjVU2'))})),dialog_count:dialogs.length,selected,summary:d?text(d.querySelector('.Mbx2m60G')):null,panel_prices:d?[...d.querySelectorAll('.ujEqGzEB')].filter(visible).map(text):[],secondary_prices:d?[...d.querySelectorAll('.fXpFACQG .mhHA_CEU')].filter(visible).map(text):[],bound,notices:all('span,p,div,[role=alert]').filter(e=>!e.children.length&&/商品已售罄|商品已下架|系统繁忙|请稍后再试|安全验证|请选择/.test(text(e))).slice(0,6).map(text),search_cards:location.pathname==='/search_result.html'?all('div._3glhOBhU[data-uniqid]').slice(0,25).map(e=>{const keys=Object.keys(e).filter(k=>k.startsWith('__reactProps$')),children=keys.length===1?e[keys[0]]?.children:null,goods=(Array.isArray(children)?children:[children]).map(c=>c?.props?.goods).filter(Boolean);return{goods_id:goods.length===1?String(goods[0].goodsID):null,title:goods.length===1?String(goods[0].goodsName||'').slice(0,200):null,price:text(e.querySelector('._3_U04GgA'))};}):[]};
}
async function capture(target,endpoint=browserConfig().endpoint){
 if(!/^(?:[1-9]\d*|search_result\.html)$/.test(target||''))throw Error('Invalid exact evidence target');
 const version=await(await fetch(endpoint+'/json/version',{signal:AbortSignal.timeout(5000)})).json(),ws=new WebSocket(version.webSocketDebuggerUrl);
 await new Promise((r,j)=>{ws.onopen=r;ws.onerror=()=>j(Error('Evidence CDP connection unavailable'));});
 let id=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.j(Error('Evidence CDP read failed')):p.r(m.result);}};
 const send=(method,params={},sessionId)=>new Promise((r,j)=>{const n=++id;pending.set(n,{r,j});ws.send(JSON.stringify({id:n,method,params,...(sessionId?{sessionId}:{})}));});
 const timer=setTimeout(()=>{for(const p of pending.values())p.j(Error('Evidence CDP read timed out'));ws.close();},10000);
 try{const{targetInfos}=await send('Target.getTargets');const pages=targetInfos.filter(t=>{if(t.type!=='page')return false;try{const u=new URL(t.url);return u.origin==='https://mobile.yangkeduo.com'&&(target==='search_result.html'?u.pathname==='/search_result.html':u.pathname==='/goods.html'&&u.searchParams.getAll('goods_id').length===1&&u.searchParams.get('goods_id')===target);}catch{return false;}});if(pages.length!==1)throw Error('Evidence target missing or ambiguous');
 const{sessionId}=await send('Target.attachToTarget',{targetId:pages[0].targetId,flatten:true});const result=await send('Runtime.evaluate',{expression:`(${visibleProof.toString()})()`,returnByValue:true},sessionId);if(result.exceptionDetails)throw Error('Narrow page evidence unavailable');return result.result.value;
 }finally{clearTimeout(timer);ws.close();}
}
if(require.main===module)capture(process.argv[2]).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={capture,visibleProof};
