'use strict';
const { inspectPage } = require('./_dom.cjs');
const { runtime, normalize, failure } = require('./_shared.cjs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const goodsURL = id => `https://mobile.yangkeduo.com/goods.html?goods_id=${id}`;
function entryEvidence(sourceUrl,destinationUrl,goodsId,clickTarget={}){
 const source=new URL(sourceUrl),destination=new URL(destinationUrl);
 const sourceQuery=source.searchParams.getAll('search_key'),landingQuery=destination.searchParams.getAll('_x_query');
 const sourcePage=source.searchParams.getAll('page_id'),landingPage=destination.searchParams.getAll('refer_page_id');
 return{observed_at:new Date().toISOString(),click_target_tag:clickTarget.tag||'unknown',click_target_kind:clickTarget.kind||'unknown',goods_id_matches:destination.searchParams.getAll('goods_id').length===1&&destination.searchParams.get('goods_id')===goodsId,source_query_present:sourceQuery.length>0,landing_query_present:landingQuery.length>0,search_query_matches:sourceQuery.length===1&&landingQuery.length===1?sourceQuery[0]===landingQuery[0]:null,source_page_present:sourcePage.length>0,landing_page_present:landingPage.length>0,source_page_matches:sourcePage.length===1&&landingPage.length===1?sourcePage[0]===landingPage[0]:null};
}
function sameSearch(a,b){
  a=new URL(a);b=new URL(b);
  return a.origin==='https://mobile.yangkeduo.com'&&a.origin===b.origin&&!a.username&&!a.password&&a.pathname==='/search_result.html'&&b.pathname===a.pathname&&a.searchParams.getAll('search_key').length===1&&b.searchParams.getAll('search_key').length===1&&a.searchParams.get('search_key')===b.searchParams.get('search_key')&&a.searchParams.getAll('sort').length<=1&&(a.searchParams.get('sort')||'default')===(b.searchParams.get('sort')||'default');
}
async function inspect(page, kind, args = {}, mutation = false) {
  const script = `(${inspectPage.toString()})(document,location,${JSON.stringify(kind)},${JSON.stringify(args)})`;
  for (let i = 0; ; i++) {
    try {
      const data = await page.evaluate(script);
      if (data?.code === 'AUTH_REQUIRED' || data?.code === 'VERIFICATION_REQUIRED') throw Object.assign(failure(data.code, data.code === 'AUTH_REQUIRED' ? '请在隔离浏览器中人工登录。' : '请人工完成验证码后恢复。'), { page_evidence: data.page_evidence });
      return data;
    } catch (e) {
      if (!mutation && i < 5 && /Execution context was destroyed|Cannot find context/.test(e.message || '')) { await sleep(500); continue; }
      throw e;
    }
  }
}
async function navigate(page, url, settle = true, {force=false} = {}) {
  let current;
  try { current = typeof page.url === 'function' ? await page.url() : await page.evaluate('location.href'); } catch {}
  if (current && !force) {
    const a = new URL(current), b = new URL(url);
    if (a.origin === b.origin && a.pathname === b.pathname && (b.pathname === '/goods.html' ? a.searchParams.getAll('goods_id').length === 1 && a.searchParams.get('goods_id') === b.searchParams.get('goods_id') : a.search === b.search)) return;
  }
  await page.goto(url, { waitUntil: 'none' });
  if (!settle) return;
  // Only read polls are retried. Click/send expressions are always evaluated once.
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const ready = await page.evaluate('({ready:document.readyState,body:!!document.body&&document.body.textContent.length>0})');
      if (ready?.ready === 'complete' && ready.body) { await sleep(1500); return; }
    } catch (e) { if (!/context|navigation/i.test(e.message || '')) throw e; }
    await sleep(500);
  }
  throw failure('PAGE_LOADING', '页面未完成加载，未将其作为空数据。');
}
async function waitForContent(page, kind, args, { timeout = 20000, pause = sleep, now = Date.now } = {}) {
  const deadline = now() + timeout;
  let data;
  do {
    data = await inspect(page, kind, args);
    if (data?.diagnostic === 'price_requires_app') return data;
    if (data?.status !== 'unsupported') return data;
    const state = await page.evaluate('({ready:document.readyState,loading:!!document.querySelector("[aria-busy=true],[data-loading=true]")})');
    if (state?.ready === 'complete' && !state.loading && kind === 'sku') return data;
    if (now() >= deadline) return { ...data, diagnostic: state?.ready !== 'complete' || state.loading ? 'content_load_timeout' : data.diagnostic, ...(state?.ready !== 'complete' || state.loading ? { status: 'timeout', code: 'PAGE_LOADING' } : {}) };
    await pause(500);
  } while (now() <= deadline);
  return data;
}
async function waitForSkuReadiness(page,args,initial,{timeout=20000,pause=sleep,now=Date.now}={}) {
  const transient=data=>data?.status==='unsupported'&&data.diagnostic==='sku_relationship_missing'&&!data.spec_groups?.length&&data.safe_entry_evidence?.candidates?.some(c=>c.reasons?.length===1&&c.reasons[0]==='product_bound_dialog_missing');
  let data=initial;
  const deadline=now()+timeout;
  while(transient(data)&&now()<deadline){await pause(Math.min(500,deadline-now()));data=await inspect(page,'sku',args);}
  return transient(data)?{...data,status:'timeout',code:'PAGE_LOADING',diagnostic:'content_load_timeout',state_diagnostic:'sku_relationship_missing'}:data;
}
async function navigateProduct(page,args,settle,entryStore) {
  const current = await page.evaluate('location.href');
  const u=new URL(current);
  if(u.origin==='https://mobile.yangkeduo.com'&&u.pathname==='/goods.html'&&u.searchParams.getAll('goods_id').length===1&&u.searchParams.get('goods_id')===args.goods_id&&entryStore.matches(args.goods_id,await page.evaluate('performance.timeOrigin')))return{navigation_source:'existing_search_target'};
  if(process.env.PDD_SOURCE_URL){
    const source=new URL(process.env.PDD_SOURCE_URL);
    if(source.origin!=='https://mobile.yangkeduo.com'||source.username||source.password||source.pathname!=='/goods.html'||source.searchParams.getAll('goods_id').length!==1||source.searchParams.get('goods_id')!==args.goods_id)throw failure('INVALID_ARGUMENT','搜索来源链接与目标商品不一致。');
  }
  if(process.env.PDD_SOURCE_SEARCH_URL||u.origin==='https://mobile.yangkeduo.com'&&u.pathname==='/search_result.html'){
      const search=new URL(process.env.PDD_SOURCE_SEARCH_URL||current);
      if(search.origin!=='https://mobile.yangkeduo.com'||search.username||search.password||search.pathname!=='/search_result.html'||search.searchParams.getAll('search_key').length!==1||[...search.searchParams.keys()].some(k=>!['search_key','sort'].includes(k)))throw failure('INVALID_ARGUMENT','搜索页来源不合法。');
      const currentDocument=await page.evaluate('performance.timeOrigin');
      const sourceDocument=process.env.PDD_SOURCE_DOCUMENT_ID?Number(process.env.PDD_SOURCE_DOCUMENT_ID):null;
      const canReturn=u.pathname==='/goods.html'&&entryStore.matches(u.searchParams.get('goods_id'),currentDocument)&&await page.evaluate(`(() => {try{const r=JSON.parse(sessionStorage.getItem('pdd_mcp_search_return'));return !!r&&r.product_document_id===performance.timeOrigin&&r.expires_at>Date.now()&&r.search===${JSON.stringify(search.href)}&&(${JSON.stringify(sourceDocument)}===null||r.source_document_id===${JSON.stringify(sourceDocument)});}catch{return false;}})()`);
      let returnMethod=sameSearch(u,search)?'existing_search':'source_navigation';
      if(canReturn){
        returnMethod='history';
        await page.evaluate('history.back()');
        const deadline=Date.now()+(settle?20000:0);let returned=false;
        do{
          const back=new URL(await page.evaluate('location.href'));
          if(sameSearch(back,search)){returned=true;break;}
          if(back.pathname==='/login.html')return{status:'auth_required',code:'AUTH_REQUIRED',page_evidence:{kind:'login_wall',source:'login_url',observed_at:new Date().toISOString()}};
          if(Date.now()>=deadline)break;
          await sleep(500);
        }while(Date.now()<=deadline);
        if(!returned)return{status:'unsupported',diagnostic:'search_return_mismatch',goods_id:args.goods_id,message:'正常返回未恢复原搜索页，已停止，不重复返回或点击。'};
      }else if(!sameSearch(u,search))await navigate(page,search.href,settle);
      if(settle){const catalog=await waitForContent(page,'catalog',{limit:Number.MAX_SAFE_INTEGER});if(catalog.status!=='ok')return catalog;}
      await page.evaluate(`(() => {try{sessionStorage.setItem('pdd_mcp_search_return',JSON.stringify({search:${JSON.stringify(search.href)},search_document_id:performance.timeOrigin,source_document_id:${JSON.stringify(sourceDocument)},history_length:history.length,expires_at:Date.now()+1800000}));}catch{}})()`);
      const clickSource=await page.evaluate('location.href');
      const opened=await inspect(page,'product_open',args,true);
      if(!opened.clicked)return{...opened,goods_id:args.goods_id,search_return_method:returnMethod};
      const deadline=Date.now()+(settle?20000:0);
      do{
        const destination=new URL(await page.evaluate('location.href'));
        if(destination.origin===search.origin&&destination.pathname==='/goods.html'&&destination.searchParams.getAll('goods_id').length===1){
          if(destination.searchParams.get('goods_id')!==args.goods_id)return{status:'target_mismatch',diagnostic:'clicked_product_target_mismatch',goods_id:args.goods_id};
          entryStore.record(args.goods_id,await page.evaluate('performance.timeOrigin'));
          await page.evaluate(`(() => {try{const r=JSON.parse(sessionStorage.getItem('pdd_mcp_search_return'));if(r){r.product_document_id=performance.timeOrigin;sessionStorage.setItem('pdd_mcp_search_return',JSON.stringify(r));}}catch{}})()`);
          return{navigation_source:'search_card_click',search_return_method:returnMethod,navigation_evidence:entryEvidence(clickSource,destination.href,args.goods_id,opened.click_target)};
        }
        if(destination.pathname==='/login.html')return{status:'auth_required',code:'AUTH_REQUIRED',page_evidence:{kind:'login_wall',source:'login_url',observed_at:new Date().toISOString()}};
        if(Date.now()>=deadline)break;
        // Poll reads only. The card click above is never repeated.
        const state=await inspect(page,'session',{});if(['auth_required','verification_required','service_unavailable'].includes(state.status))return state;
        await sleep(500);
      }while(Date.now()<=deadline);
      return{status:'timeout',code:'PAGE_LOADING',diagnostic:'search_card_navigation_unconfirmed',goods_id:args.goods_id};
  }
  return{status:'unsupported',code:'SEARCH_CONTEXT_MISSING',diagnostic:process.env.PDD_SOURCE_URL?'search_page_required':'search_context_missing',message:'商品只能通过正常搜索卡片点击进入；请先搜索，不直接打开商品链接。'};
}
async function waitForSelectedSku(page,args,{timeout=8000,pause=sleep,now=Date.now,read=()=>inspect(page,'sku',args)}={}) {
  const deadline=now()+timeout;let previous=null,last;
  do {
    last=await read();
    if(!['ok','unsupported'].includes(last.status))return last;
    const row=last.skus?.find(s=>s.variant_price_verified===true&&Object.keys(s.specs||{}).length===Object.keys(args.spec_selection||{}).length&&Object.entries(args.spec_selection||{}).every(([k,v])=>s.specs[k]===v));
    const fingerprint=last.status==='ok'&&row?JSON.stringify({specs:row.specs,price:row.price,sku_id:row.sku_id}):null;
    if(fingerprint&&fingerprint===previous)return last;
    previous=fingerprint;
    if(now()>=deadline)break;
    await pause(500);
  }while(now()<=deadline);
  return {...last,status:'unsupported',selection_status:'price_unconfirmed',missing_evidence:[...new Set([...(last?.missing_evidence||[]),'specification_price'])],diagnostic:'selected_price_update_unconfirmed',skus:(last?.skus||[]).map(s=>({...s,variant_price_verified:false}))};
}
async function waitForSelection(page,args,{timeout=4000,pause=sleep,now=Date.now,read=()=>inspect(page,'selection',{goods_id:args.goods_id})}={}) {
  const deadline=now()+timeout;let last;
  do {
    last=await read();
    if(last?.status==='target_mismatch')return last;
    if(last?.selected&&Object.entries(args.spec_selection||{}).every(([k,v])=>last.selected[k]===v))return last;
    if(now()>=deadline)break;
    await pause(250);
  } while(now()<=deadline);
  return {...(last||{}),selected:last?.selected||{},diagnostic:'selected_specs_mismatch'};
}
function selectionSnapshot(value={}) {return {selected:value.selected||{},summary:value.summary||null,sku_id:value.sku_id||null,price_nodes:value.price_nodes||[],loading:value.loading===true};}
async function perform(kind, page, args, { settle = true,entryStore=require('./_product-entry.cjs').entryStore } = {}) {
    if(process.env.PDD_TARGET_ID){
      if(typeof page.cdp!=='function')return{status:'unsupported',diagnostic:'browser_target_unconfirmed'};
      const info=await page.cdp('Target.getTargetInfo');
      if(info?.targetInfo?.targetId!==process.env.PDD_TARGET_ID)return{status:'target_mismatch',diagnostic:'browser_target_mismatch',message:'当前浏览器标签与搜索来源不一致，已停止。'};
    }
  if (kind === 'auth') {
    await navigate(page, 'https://mobile.yangkeduo.com/login.html', settle);
    return { status: 'login_page_opened', note: '请人工登录，再调用 pdd_resume；本工具不填写凭证。' };
  }
  if (kind === 'resume') {
    // Inspect an existing page without destroying a detail/verification failure scene.
    return inspect(page, 'session');
  }
  if (kind === 'search' || kind === 'browse_home') {
    const url = kind === 'search' ? `https://mobile.yangkeduo.com/search_result.html?search_key=${encodeURIComponent(args.query)}${args.sort && args.sort !== 'default' ? `&sort=${args.sort}` : ''}` : 'https://mobile.yangkeduo.com/';
    await navigate(page, url, settle);
    if (kind === 'browse_home') return waitForContent(page, 'catalog', args);
    const catalog = await waitForContent(page, 'catalog', { ...args, limit: Number.MAX_SAFE_INTEGER, internal_links:process.env.PDD_INTERNAL_LINKS==='1' });
    const filtered=require('./_comparison.cjs').filterCatalog(catalog, args);
    if(process.env.PDD_INTERNAL_LINKS==='1')filtered._search_context={target_id:process.env.PDD_TARGET_ID||null,document_id:await page.evaluate('performance.timeOrigin')};
    return filtered;
  }
  if (kind === 'read_cart') {
    await navigate(page, 'https://mobile.yangkeduo.com/cart.html', settle);
    return inspect(page, 'cart', args);
  }
  if (kind === 'detail' || kind === 'read_sku') {
    const navigation=await navigateProduct(page, args, settle,entryStore);
    if(navigation.status)return navigation;
    const detail = {...await waitForContent(page, 'detail', args),...navigation};
    if (kind === 'detail' || (detail.status !== 'ok' && detail.diagnostic !== 'price_requires_app')) {
      if(kind==='detail'&&args.include_product_images===true&&detail.status==='ok')detail._product_media=await page.evaluate('('+require('./_product-media.cjs').productMedia.toString()+')(document,location,'+JSON.stringify(args.goods_id)+')');
      return require('./_comparison.cjs').withComparison(detail,args);
    }
    let sku = await inspect(page, 'sku', args);
    sku = await waitForSkuReadiness(page,args,sku);
    if(sku.status==='timeout')return require('./_comparison.cjs').withComparison({...sku,...navigation},args);
    if (args.spec_selection && sku.spec_groups?.length) {
      const groups=sku.spec_groups;
      const valid=Object.keys(args.spec_selection).length===groups.length && groups.every(g=>Object.hasOwn(args.spec_selection,g.label)&&g.options.includes(args.spec_selection[g.label]));
      if(!valid)return require('./_comparison.cjs').withComparison({...sku,...navigation,status:'unsupported',selection_status:'incomplete',missing_evidence:[...new Set([...(sku.missing_evidence||[]),'complete_selection','specification_price'])],skus:(sku.skus||[]).map(s=>({...s,variant_price_verified:false})),diagnostic:'incomplete_spec_selection',message:'请按页面规格组指定完整且存在的组合；没有点击规格入口。'},args);
    }
    if (sku.status === 'ok') return require('./_comparison.cjs').withComparison({...sku,...navigation},args);
    const opened = sku.dialog_open ? {opened:true} : await inspect(page, 'spec_open', args, true);
      if (!opened.opened) return require('./_comparison.cjs').withComparison({ ...sku, ...navigation, safe_entry_status:opened.safe_entry_status||sku.safe_entry_status,entry_diagnostic:opened.diagnostic,state_diagnostic:sku.state_diagnostic||sku.diagnostic,diagnostic:sku.diagnostic||opened.diagnostic,message:opened.message },args);
    if (settle) await sleep(1500);
    sku = await waitForContent(page, 'sku', args);
    const selectionTrace=[];
    const rejectSelection=(diagnostic,extra={})=>require('./_comparison.cjs').withComparison({...sku,...navigation,status:'unsupported',selection_status:'price_unconfirmed',diagnostic,...extra,missing_evidence:[...new Set([...(sku.missing_evidence||[]),'specification_price'])],skus:(sku.skus||[]).map(s=>({...s,variant_price_verified:false}))},args);
    // One complete combination per call; the observed footer may open the
    // specification modal, but no confirm, purchase or checkout is executed.
    if (sku.status !== 'ok' && args.spec_selection) {
      const groups=sku.spec_groups||[];
      if(!groups.length||Object.keys(args.spec_selection).length!==groups.length||!groups.every(g=>Object.hasOwn(args.spec_selection,g.label)&&g.options.includes(args.spec_selection[g.label])))return rejectSelection('incomplete_spec_selection');
      let actual=await inspect(page,'selection',{goods_id:args.goods_id});
      for (const [label,value] of Object.entries(args.spec_selection)) {
        if(actual.selected?.[label]===value)continue;
        const before=selectionSnapshot(actual);
        const selected = await inspect(page, 'spec_click', {goods_id:args.goods_id,label,value}, true);
        if (!selected.selected) {selectionTrace.push({label,value,before,after:before,option_text:selected.option_text||null,diagnostic:selected.diagnostic||'spec_option_click_unconfirmed'});return rejectSelection(selected.diagnostic||'spec_option_click_unconfirmed',{selection_trace:selectionTrace});}
        actual=await waitForSelection(page,{goods_id:args.goods_id,spec_selection:{[label]:value}});
        selectionTrace.push({label,value,before,after:selectionSnapshot(actual),option_text:selected.option_text||null,diagnostic:actual.selected?.[label]===value?null:'option_click_no_state_change'});
        if(actual.status==='target_mismatch')return rejectSelection('spec_product_mismatch',{selection_trace:selectionTrace});
        if(actual.selected?.[label]!==value)return rejectSelection('option_click_no_state_change',{selection_trace:selectionTrace});
      }
      if (Object.entries(args.spec_selection).some(([k,v]) => actual.selected?.[k] !== v)) return rejectSelection('selected_specs_mismatch',{selection_trace:selectionTrace});
      sku = await waitForSelectedSku(page,args);
    }
    return require('./_comparison.cjs').withComparison({...sku,...navigation,...(selectionTrace.length?{selection_trace:selectionTrace}:{})},args);
  }
  if (kind === 'add_cart') {
    await navigate(page, 'https://mobile.yangkeduo.com/cart.html', settle);
    const baseline = await inspect(page, 'cart');
    if (!['ok', 'empty'].includes(baseline?.status) || baseline.truncated) return { status: 'unsupported', message: '无法取得完整购物车基线，未执行加购。' };
    await navigate(page, goodsURL(args.goods_id), settle);
    const detail = await inspect(page, 'detail', args);
    if (detail.status !== 'ok') return { status: 'unsupported', message: '无法核对商品与价格。' };
    const sku = await inspect(page, 'sku', args);
    if (!sku.skus?.length) return { status: 'unsupported', message: '无法建立规格与价格库存的对应关系。' };
    let chosen;
    let selection = args.spec_selection;
    if (selection && Object.keys(selection).length) {
      const matches = sku.skus.filter(s => Object.keys(s.specs).length === Object.keys(selection).length && Object.entries(selection).every(([k, v]) => s.specs[k] === v));
      if (matches.length === 1) chosen = matches[0];
    } else if (args.sku_index !== undefined && !sku.truncated) chosen = sku.skus[args.sku_index];
    else if (sku.skus.length === 1 && !sku.truncated) chosen = sku.skus[0];
    if (!chosen) return { status: 'spec_required', message: '请提供能唯一识别规格组合的 spec_selection。' };
    selection = chosen.specs;
    if (chosen.price === null || chosen.stock === null || chosen.stock < args.quantity) return { status: 'unsupported', message: '规格价格或库存未核实，未加购。' };
    for (const [label, value] of Object.entries(selection)) {
      const selected = await inspect(page, 'spec_click', {goods_id:args.goods_id,label,value}, true);
      if (!selected.selected) return { status: 'unsupported', message: '无法唯一选中指定规格。' };
    }
    const selected = await inspect(page, 'selection');
    if (Object.entries(selection).some(([k, v]) => selected.selected?.[k] !== v)) return { status: 'unsupported', message: '无法确认页面已选中目标规格。' };
    const before = baseline.items.filter(i => i.goods_id === args.goods_id && i.sku_id === chosen.sku_id);
    if (before.some(i => !Number.isInteger(i.qty))) return { status: 'unsupported', message: '购物车数量未知，未加购。' };
    const countBefore = before.reduce((n, i) => n + i.qty, 0);
    const click = await inspect(page, 'cart_click', args, true);
    if (!click.clicked) return click;
    if (settle) await sleep(1500);
    await navigate(page, 'https://mobile.yangkeduo.com/cart.html', settle);
    const after = await inspect(page, 'cart');
    const matches = after.items?.filter(i => i.goods_id === args.goods_id && i.sku_id === chosen.sku_id);
    if (after.status === 'ok' && !after.truncated && matches.length === 1 && matches[0].qty === countBefore + args.quantity) return { status: 'add_cart_confirmed', goods_id: args.goods_id, sku_id: chosen.sku_id, quantity_added: args.quantity };
    return { status: 'result_unknown', message: '已点击一次加购，但未核验到对应购物车变化。' };
  }
  if (kind === 'contact_seller') {
    await navigate(page, goodsURL(args.goods_id), settle);
    const detail = await inspect(page, 'detail', args);
    if (detail.status !== 'ok' || !detail.shop_id) return { status: 'unsupported', message: '无法核对商品所属店铺。' };
    if (args.shop_id && args.shop_id !== detail.shop_id) return { status: 'target_mismatch', message: '指定店铺与商品店铺不一致。' };
    const expected = args.shop_id || detail.shop_id;
    const opened = await inspect(page, 'contact_open', {}, true);
    if (!opened.opened) return opened;
    if (settle) await sleep(2000);
    const before = await inspect(page, 'chat', { shop_id: expected, message: args.message });
    if (before.status !== 'ok') return before;
    if (args.mode !== 'send') return { ...before, mode: 'read' };
    const sent = await inspect(page, 'chat_send', { shop_id: expected, message: args.message }, true);
    if (!sent.sent) return sent;
    if (settle) await sleep(1500);
    const after = await inspect(page, 'chat', { shop_id: expected, message: args.message });
    return after.status === 'ok' && after.outgoing_count === before.outgoing_count + 1 ? { status: 'sent_confirmed', shop_id: expected, mode: 'send' } : { status: 'result_unknown', message: '发送只尝试一次，未取得新增发出消息证据。' };
  }
  throw failure('UNSUPPORTED', '未知适配器操作。');
}
function fromCLI(kind, kwargs) {
  const args = Object.fromEntries(Object.entries(kwargs).filter(([key]) => !key.startsWith('__')));
  for (const key of ['limit', 'sku_index', 'quantity','price_min','price_max','budget_max']) if (args[key] !== undefined) args[key] = Number(args[key]);
  for (const key of ['include_terms','exclude_terms']) if (typeof args[key] === 'string') { try { args[key]=JSON.parse(args[key]); } catch { throw failure('INVALID_ARGUMENT',`${key} 必须是 JSON 数组。`); } }
  for (const key of ['confirm','exclude_group_purchase','include_product_images']) if (args[key] !== undefined) {
    if (args[key] !== true && args[key] !== false && args[key] !== 'true' && args[key] !== 'false') throw failure('INVALID_ARGUMENT', `${key} 必须是 true 或 false。`);
    args[key] = args[key] === true || args[key] === 'true';
  }
  if (typeof args.spec_selection === 'string') { try { args.spec_selection = JSON.parse(args.spec_selection); } catch { throw failure('INVALID_ARGUMENT', 'spec_selection 必须是 JSON 对象。'); } }
  return normalize(kind, args);
}
async function execute(kind, page, kwargs, runner = runtime) {
  try { return await runner.run(kind, fromCLI(kind, kwargs), args => perform(kind, page, args)); }
  catch (error) {
    // Runtime first records verification cooldown; then retain only narrow page proof
    // in data, since OpenCLI's generic thrown-error envelope drops extra fields.
    if (['AUTH_REQUIRED','VERIFICATION_REQUIRED'].includes(error.code) && error.page_evidence) {
      const e=error.page_evidence;
      return { status:error.code==='AUTH_REQUIRED'?'auth_required':'verification_required',code:error.code,message:error.message,page_evidence:{kind:e.kind,source:e.source,observed_at:e.observed_at} };
    }
    throw error;
  }
}
const arg = (name, extra = {}) => ({ name, valueRequired: true, ...extra });
function definition(name) {
  const positional = field => arg(field, { positional: true, required: true });
  const map = {
    search: { access: 'read', description: '搜索商品；价格与关键词仅筛选已加载卡片', args: [positional('query'), arg('limit', { type: 'int', default: 10 }), arg('sort', { default: 'default', choices: ['default', 'sales', 'price'] }),arg('price_min'),arg('price_max'),arg('include_terms'),arg('exclude_terms'),arg('exclude_group_purchase')] },
    detail: { access: 'read', description: '读取商品详情，未知字段不猜测', args: [positional('target'),arg('budget_max'),arg('include_product_images')] },
    browse_home: { access: 'read', description: '读取首页已加载商品，显式标记截断', args: [arg('limit', { type: 'int', default: 20 }), arg('cursor')] },
    read_cart: { access: 'read', description: '按商品与规格读取购物车及控件状态', args: [arg('cursor')] },
    read_sku: { access: 'read', description: '读取有明确组合关联的规格价格与库存', args: [positional('goods_id'), arg('spec_selection'),arg('budget_max')] },
    add_cart: { access: 'write', description: '默认关闭的受控加购，执行后核对购物车', args: [positional('goods_id'), arg('sku_index', { type: 'int' }), arg('quantity', { type: 'int', default: 1 }), arg('spec_selection'), arg('confirm', { default: 'false' }), arg('request_id')] },
    contact_seller: { access: 'write', description: '读取会话或发送已确认店铺消息', args: [positional('goods_id'), arg('mode', { default: 'read', choices: ['read', 'send'] }), arg('shop_id'), arg('message'), arg('confirm', { default: 'false' }), arg('request_id')] },
    auth: { access: 'read', description: '打开登录页，由用户人工登录', args: [] },
    resume: { access: 'read', description: '以正向证据核对登录状态', args: [] },
  };
  if (!map[name]) throw Error('未知命令');
  return { site: 'pdd', name, ...map[name], domain: 'mobile.yangkeduo.com', navigateBefore: false, func: (page, kwargs) => execute(name, page, kwargs) };
}
  module.exports = { inspect, navigate, sameSearch, entryEvidence, waitForContent, waitForSkuReadiness, waitForSelectedSku, waitForSelection, perform, execute, definition, fromCLI };
