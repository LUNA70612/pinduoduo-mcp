'use strict';
// Self-contained function: serialized into the browser, also tested against DOM fixtures.
function inspectPage(document, location, kind, args = {}) {
  const text = e => String(e?.innerText || e?.textContent || '').replace(/\s+/g, ' ').trim();
  const all = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const one = (selector, root = document) => root.querySelector(selector);
  const bodyText = text(document.body);
  const visible = e => {
    for (let n = e; n && n.nodeType === 1; n = n.parentElement) {
      if (n.hidden || n.getAttribute('aria-hidden') === 'true' || /display\s*:\s*none|visibility\s*:\s*hidden/.test(n.getAttribute('style') || '')) return false;
      const style = document.defaultView?.getComputedStyle?.(n);
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    }
    return true;
  };
  const DomEvent = document.defaultView?.Event || Event;
  const href = location.href;
  const origin = new URL(href);
  if (origin.protocol !== 'https:' || origin.hostname !== 'mobile.yangkeduo.com' || origin.port) return { status: 'unsupported', code: 'ORIGIN_MISMATCH', logged_in: false, url: href, clicked: false, sent: false };
  const wall = /\/login\.html/.test(href) || /发送验证码|手机号登录|请先登录/.test(bodyText);
  const verify = /请完成.{0,8}验证|滑块验证|人机验证|安全验证|操作过于频繁/.test(bodyText) || !!one('iframe[src*="captcha"], [id*="captcha"]');
  const logout = all('button,a,[role="button"]').some(e => /^(退出登录|退出账号)$/.test(text(e)) && visible(e));
  // Match the server-rendered identity to the visible profile without returning identity data.
  const store = document.defaultView?.rawData?.stores?.store;
  const user = store?.userInfo;
  const profile = one('.personal-section .userInfoBox, .personal-section .profile-wrapper');
  const nickname = profile && one('.nickname', profile);
  const avatar = profile && one('img.avatar, .avatar', profile);
  const cleanName = value => String(value || '').replace(/[\u201c\u201d"']/g, '').replace(/\s+/g, ' ').trim();
  const profileMatch = origin.pathname === '/personal.html' && store?.isServerRendered === true && store?.isFinishInitLoading === true && /^[1-9]\d*$/.test(String(user?.uid || '')) && typeof user?.nickname === 'string' && !!user.nickname.trim() && !!nickname && visible(nickname) && cleanName(text(nickname)) === cleanName(user.nickname) && !!avatar && visible(avatar) && !!user.avatar;
  const loggedIn = !wall && !verify && (logout || !!profileMatch);
  const status = verify ? 'verification_required' : wall ? 'auth_required' : loggedIn ? 'session_ok' : 'session_unknown';
  const pageEvidence = verify || wall ? { kind: verify ? 'verification' : 'login_wall', source: /\/login\.html/.test(href) && !verify ? 'login_url' : 'visible_page', observed_at: new Date().toISOString() } : undefined;
  if (kind === 'session') return { status, logged_in: loggedIn, url: href, evidence: loggedIn ? (logout ? 'visible_logout_control' : 'personal_server_profile_matches_dom') : null, ...(pageEvidence ? { page_evidence: pageEvidence } : {}) };
  if (verify || wall) return { status, code: verify ? 'VERIFICATION_REQUIRED' : 'AUTH_REQUIRED', page_evidence: pageEvidence };
  if (all('p,[role="alert"]').some(e => visible(e) && text(e) === '系统繁忙') && all('p,[role="alert"]').some(e => visible(e) && text(e) === '请稍后再试')) return { status: 'service_unavailable', code: 'SERVICE_UNAVAILABLE', message: '页面显示系统繁忙，请稍后再试。' };
  if (['detail','sku','sku_read'].includes(kind) && origin.pathname==='/goods.html' && origin.searchParams.getAll('goods_id').length===1 && origin.searchParams.get('goods_id')===args.goods_id) {
    const notice=all('span,p,div,[role="alert"]').find(e=>!e.children.length&&visible(e)&&/^商品(?:已售罄|已下架|不存在)(?:[，。！,\s]|$)/.test(text(e)));
    if(notice)return{status:'product_unavailable',code:'PRODUCT_UNAVAILABLE',diagnostic:text(notice).includes('已售罄')?'product_sold_out':text(notice).includes('已下架')?'product_removed':'product_not_found',goods_id:args.goods_id,title:null,price:null,variant_price_verified:false,message:text(notice),source:'visible_product_availability_notice',fetched_at:new Date().toISOString()};
  }
  const emptyNodes=all('[data-empty],p,span,div,[role="status"]').filter(e=>visible(e)&&(!e.children.length||e.hasAttribute('data-empty'))&&/暂无相关商品|没有找到相关商品|购物车空空|购物车还是空的|暂无商品/.test(text(e)));
  const empty = emptyNodes.length>0;
  const unsupported = (extra = {}) => ({ status: 'unsupported', code: 'UNSUPPORTED', diagnostic: 'page_structure_unsupported', ...extra });
  const observedAt = new Date().toISOString();
  const evidence = (value, source, verified = value !== null && value !== undefined && value !== '') => ({ source: value == null ? null : source, observed_at: observedAt, verified });
  const detailEvidence = data => {
    const fields = {};
    for (const key of ['goods_id', 'title', 'price', 'shop', 'shop_id', 'product_attributes_text', 'coupon_offer']) fields[key] = evidence(data[key] ?? null, key === 'goods_id' ? 'page_url_matches_request' : 'visible_product_dom');
    const diagnostic_evidence=data.status==='unsupported'?{
      goods_id:args.goods_id,title:data.title||null,observed_at:observedAt,
      ready_state:document.readyState||'unknown',loading:all('[aria-busy=true],[data-loading=true]').some(visible),
      price_nodes:all('.uPP2olgd,[data-main-price],[class*="goods-price"],[class*="goodsPrice"]').filter(visible).slice(0,6).map(e=>text(e).slice(0,160)),
      notices:all('p,span,[role="alert"]').filter(e=>!e.children.length&&visible(e)&&/前往\s*APP\s*查看价格|系统繁忙|请稍后再试|商品已售罄|正在加载/.test(text(e))).slice(0,6).map(e=>text(e).slice(0,120))
    }:undefined;
    return { ...data,...(diagnostic_evidence?{diagnostic_evidence}:{}), fetched_at: observedAt, field_evidence: fields, missing_fields: Object.keys(fields).filter(k => !fields[k].verified), offer_eligibility_verified: false };
  };
  const price = e => { const v = text(e); return (v.match(/[¥￥]\s*\d+(?:\.\d+)?/) || [])[0]?.replace(/\s/g, '').replace('￥', '¥') || null; };
  const specLabel = e => { if (!e) return ''; const copy=e.cloneNode(true); for (const guide of all('.oecDTzM9',copy)) if (text(guide)==='尺码详情') guide.remove(); return text(copy); };
  const optionDisabled = e => !!e && (!!e.disabled || e.getAttribute('aria-disabled')==='true' || e.classList.contains('uRVpnTQ1') || document.defaultView?.getComputedStyle?.(e)?.pointerEvents==='none');
  const idFrom = e => {
    const direct = e.getAttribute('data-goods-id');
    if (/^[1-9]\d*$/.test(direct || '')) return direct;
    const a = e.matches?.('a[href]') ? e : one('a[href*="goods_id="]', e);
    try { const u = new URL(a?.getAttribute('href') || '', href); const id = u.searchParams.get('goods_id'); return u.hostname === 'mobile.yangkeduo.com' && /^[1-9]\d*$/.test(id || '') ? id : null; } catch { return null; }
  };
  if (kind === 'product_open') {
    if(origin.pathname!=='/search_result.html')return unsupported({diagnostic:'search_page_required',clicked:false});
    const targets=[];
    for(const card of all('div._3glhOBhU[data-uniqid]')){
      if(!visible(card))continue;
      const keys=Object.keys(card).filter(k=>k.startsWith('__reactProps$'));if(keys.length!==1)continue;
      const children=card[keys[0]]?.children,goods=(Array.isArray(children)?children:[children]).map(c=>c?.props?.goods).filter(Boolean);
      if(goods.length!==1||String(goods[0].goodsID)!==args.goods_id)continue;
      try{const u=new URL(goods[0].linkURL,href);if(u.origin!==origin.origin||u.username||u.password||u.pathname!=='/goods.html'||u.searchParams.getAll('goods_id').length!==1||u.searchParams.get('goods_id')!==args.goods_id)continue;}catch{continue;}
      const image=one('.LOFjVUas img',card);if(image&&visible(image))targets.push(image);
    }
    // Anchor cards also use their own normal DOM click; never call component handlers directly.
    if(!targets.length)for(const anchor of all('a[href*="goods_id="]')){
      if(idFrom(anchor)!==args.goods_id||!visible(anchor))continue;
      try{const u=new URL(anchor.getAttribute('href'),href);if(u.origin===origin.origin&&!u.username&&!u.password&&u.pathname==='/goods.html'&&u.searchParams.getAll('goods_id').length===1&&u.searchParams.get('goods_id')===args.goods_id)targets.push(anchor);}catch{}
    }
    if(targets.length!==1)return unsupported({diagnostic:'unique_search_card_missing',clicked:false});
    const click_target={tag:targets[0].tagName,kind:targets[0].tagName==='IMG'?'bound_card_image':'normal_anchor'};
    targets[0].click();
    return{status:'ok',clicked:true,goods_id:args.goods_id,click_target};
  }
  if (kind === 'product_link') {
    const links=[];
    for (const anchor of all('a[href*="goods_id="]')) if (idFrom(anchor) === args.goods_id && visible(anchor)) links.push(anchor.getAttribute('href'));
    for (const card of all('div._3glhOBhU[data-uniqid]')) {
      if (!visible(card)) continue;
      const keys=Object.keys(card).filter(k=>k.startsWith('__reactProps$'));if(keys.length!==1)continue;
      const children=card[keys[0]]?.children;
      for (const child of Array.isArray(children)?children:[children]) {const g=child?.props?.goods;if(String(g?.goodsID)===args.goods_id&&typeof g.linkURL==='string')links.push(g.linkURL);}
    }
    const valid=[...new Set(links.map(value=>{try{const u=new URL(value,href);return u.origin===origin.origin&&!u.username&&!u.password&&u.pathname==='/goods.html'&&u.searchParams.getAll('goods_id').length===1&&u.searchParams.get('goods_id')===args.goods_id?u.href:null;}catch{return null;}}).filter(Boolean))];
    return valid.length===1?{status:'ok',url:valid[0]}:unsupported({diagnostic:'product_source_link_unavailable'});
  }
  if (kind === 'catalog') {
    const noResults=emptyNodes.some(e=>/暂无相关商品|没有找到相关商品/.test(text(e)));
    const searchContext={result_kind:noResults?'no_results':'unknown',query_match_verified:false,source:'visible_page_notice',notice:noResults?text(emptyNodes.find(e=>/暂无相关商品|没有找到相关商品/.test(text(e)))).slice(0,200):null};
    const results = [], seen = new Set();
    for (const anchor of all('a[href*="goods_id="]')) {
      const id = idFrom(anchor); if (!id || seen.has(id)) continue;
      const card = anchor.closest('[data-goods-card], [class*="goods-item"], [class*="goodsItem"], article, li') || anchor;
      const title = text(one('[data-title],h3,h2,[class*="goods-title"],[class*="goodsTitle"]', card)) || anchor.getAttribute('aria-label') || one('img[alt]', card)?.getAttribute('alt');
      if (!title) continue;
      seen.add(id);
      results.push({ rank: results.length + 1, goods_id: id, title, price: price(one('[data-price],[class*="price"]', card)), sales: text(one('[data-sales],[class*="sales"]', card)) || null, shop: text(one('[data-shop],[class*="shop-name"]', card)) || null, url: `https://mobile.yangkeduo.com/goods.html?goods_id=${id}`, ...(args.internal_links?{_source_url:new URL(anchor.getAttribute('href'),href).href}:{}) });
    }
    // Observed desktop search cards have no anchor. Read only the card's bound
    // component props; cross-check its ID/link, image and displayed yuan price.
    for (const card of all('div._3glhOBhU[data-uniqid]')) {
      if (!visible(card)) continue;
      const keys = Object.keys(card).filter(k => k.startsWith('__reactProps$'));
      if (keys.length !== 1) continue;
      const children = card[keys[0]]?.children;
      const goods = (Array.isArray(children) ? children : [children]).map(c => c?.props?.goods).filter(Boolean);
      if (goods.length !== 1) continue;
      const g = goods[0];
      if (typeof g.goodsID === 'number' && !Number.isSafeInteger(g.goodsID)) continue;
      const id = String(g.goodsID || '');
      if (!/^[1-9]\d*$/.test(id) || seen.has(id) || typeof g.goodsName !== 'string' || !g.goodsName.trim()) continue;
      try {
        if (typeof g.linkURL !== 'string') continue;
        const link = new URL(g.linkURL, href);
        if (link.origin !== origin.origin || link.pathname !== '/goods.html' || link.searchParams.getAll('goods_id').length !== 1 || link.searchParams.get('goods_id') !== id) continue;
        const image = one('.LOFjVUas img', card);
        const renderedImage = new URL(image?.getAttribute('src') || image?.getAttribute('data-src') || '', href);
        const boundImage = new URL(g.imgUrl);
        if (!/(^|\.)pddpic\.com$/.test(renderedImage.hostname) || !/(^|\.)pddpic\.com$/.test(boundImage.hostname) || renderedImage.pathname !== boundImage.pathname) continue;
      } catch { continue; }
      const priceNode = one('._3_U04GgA', card);
      const match = text(priceNode).replace(/\s/g, '').match(/[¥￥](\d+(?:\.\d{1,2})?)(?![\d.])/);
      const boundPrice = String(g.priceInfo ?? '');
      if (match && /^\d+(?:\.\d{1,2})?$/.test(boundPrice) && Number(match[1]) !== Number(boundPrice)) continue;
      const verifiedPrice = !!priceNode && visible(priceNode) && !!match && /^\d+(?:\.\d{1,2})?$/.test(boundPrice);
      const shopId = String(g.mallEntrance?.mall_id || '');
      seen.add(id);
      const priceLabel = text(priceNode);
      results.push({ rank: results.length + 1, goods_id: id, title: g.goodsName.trim(), title_source: 'bound_component_state', price: verifiedPrice ? `¥${match[1]}` : null, price_basis: !verifiedPrice ? 'unknown' : priceLabel.includes('券后') ? 'list_coupon' : /新客|补贴|限时|多人团|万人团|拼单/.test(priceLabel) ? 'list_conditional' : 'list_display', price_conditions: priceLabel.replace(/[¥￥]\s*\d+(?:\s*\.\s*\d+)?/g,'').trim() || null, offer_eligibility_verified: false, sales: text(one('._2u4gEhMf', card)) || null, shop: null, shop_id: /^[1-9]\d*$/.test(shopId) ? shopId : null, tags: all('._2OP4vH_6', card).filter(visible).map(text).filter(Boolean), url: `https://mobile.yangkeduo.com/goods.html?goods_id=${id}` });
      if(args.internal_links) results[results.length-1]._source_url=new URL(g.linkURL,href).href;
    }
    if (!results.length) return empty ? { status: 'empty', results: [], count: 0, truncated: false, search_context:searchContext } : unsupported({ results: [], count: 0, truncated: true, search_context:searchContext });
    const limit = args.limit || 10;
    return { status: 'ok', results: results.slice(0, limit), count: Math.min(limit, results.length), truncated: !one('[data-end-of-list="true"]') || results.length > limit, search_context:{...searchContext,result_kind:noResults?'recommendations_after_no_results':'unknown'} };
  }
  if (kind === 'detail') {
    if (origin.pathname !== '/goods.html' || origin.searchParams.getAll('goods_id').length !== 1 || origin.searchParams.get('goods_id') !== args.goods_id) return { status: 'target_mismatch', goods_id: args.goods_id };
    const canonicalURL = `https://mobile.yangkeduo.com/goods.html?goods_id=${args.goods_id}`;
    const actualTitles = all('.tLYIg_Ju.enable-select').filter(visible);
    const actualPrices = all('.uPP2olgd').filter(visible);
    const actualAttributes = all('.pApAfrwF .iUUH2sOQ').filter(visible).map(row => ({name:text(one('.rMnkPxwx',row)),value:text(one('.KjtdjVU2',row)),source:'merchant_page_claim'})).filter(a=>a.name&&a.value);
    if (actualTitles.length === 1 && /前往\s*APP\s*查看价格/i.test(bodyText)) return detailEvidence(unsupported({code:'PRICE_APP_REQUIRED',diagnostic:'price_requires_app',message:'网页隐藏价格并提示前往 APP；保留可见商品信息，不推测价格。',goods_id:args.goods_id,title:text(actualTitles[0]),price:null,price_basis:'unknown',variant_price_verified:false,attributes:actualAttributes,product_attributes_text:text(one('.pApAfrwF'))||null,url:canonicalURL}));
    if (actualTitles.length === 1 && actualPrices.length === 1) {
      const title = text(actualTitles[0]);
      const amount = text(actualPrices[0]).replace(/\s/g, '');
      const amountMatch = amount.match(/^(券后|大促价|特卖价|秒杀价|多人团价|万人团价|补贴价|新客(?:券后)?|限时价|限[1-9]\d*件|首件)?[¥￥](\d+(?:\.\d{1,2})?)$/);
      if (title && amountMatch) {
        const offers = all('.KM4qx8ua').filter(visible).map(text).filter(t => t.includes('券后'));
        const claims = new Set(['正品发票', '退货包运费', '7天无理由退货', '48小时内发货']);
        const attributes = all('.pApAfrwF .iUUH2sOQ').map(row => ({ name: text(one('.rMnkPxwx', row)), value: text(one('.KjtdjVU2', row)), source: 'merchant_page_claim' })).filter(a => a.name && a.value);
        return detailEvidence({ status: 'ok', goods_id: args.goods_id, title, price: `¥${amountMatch[2]}`, price_basis: amountMatch[1]?.includes('券后') ? 'detail_coupon' : amountMatch[1] ? 'detail_conditional' : 'detail_display', offer_conditions:amountMatch[1]||null, coupon_offer: offers.length === 1 ? offers[0] : amountMatch[1]?.includes('券后') ? amount : null, variant_price_verified: false, market_price: null, sales: text(one('.BD_8SBr6')) || null, shop: text(one('.BAq4Lzv7')) || null, shop_id: null, service_claims: [...new Set(all('span,div,p').filter(e => !e.children.length && visible(e) && claims.has(text(e))).map(text))], attributes, product_attributes_text: text(one('.pApAfrwF')) || null, url: canonicalURL });
      }
    }
    const title = actualTitles.length === 1 ? text(actualTitles[0]) : text(one('[data-goods-title],h1,[class*="goods-title"],[class*="goodsTitle"]'));
    const fallbackPrices=all('[data-main-price],[class*="goods-price"],[class*="goodsPrice"]').filter(visible);
    const value = fallbackPrices.length===1&&/^[¥￥]\s*\d+(?:\.\d{1,2})?$/.test(text(fallbackPrices[0]))?price(fallbackPrices[0]):null;
    if (!title || !value) return detailEvidence(unsupported({ diagnostic:!title?'page_structure_unsupported':actualPrices.some(e=>text(e))||fallbackPrices.some(e=>text(e))?'price_format_unsupported':'price_missing',goods_id: args.goods_id, title: title || null, price: value, attributes:actualAttributes, product_attributes_text:text(one('.pApAfrwF'))||null, variant_price_verified: false, url: canonicalURL }));
    return detailEvidence({ status: 'ok', goods_id: args.goods_id, title, price: value, price_basis: /券后/.test(text(one('[data-main-price],[class*="goods-price"],[class*="goodsPrice"]'))) ? 'detail_coupon' : 'detail_display', variant_price_verified: false, market_price: price(one('[data-market-price],del')), sales: text(one('[data-sales],[class*="sales"]')) || null, shop: text(one('[data-shop-name],[class*="shop-name"]')) || null, shop_id: one('[data-mall-id],[data-shop-id]')?.getAttribute('data-mall-id') || one('[data-shop-id]')?.getAttribute('data-shop-id') || null, url: canonicalURL });
  }
  if (kind === 'cart') {
    const items = [], seen = new Set();
    const candidates = all('[data-cart-item], [class*="cart-item"], [class*="cartItem"], [class*="CartItem"]');
    for (const card of candidates) {
      if (candidates.some(other => other !== card && card.contains(other))) continue;
      const goodsId = idFrom(card); if (!goodsId) continue;
      const skuId = card.getAttribute('data-sku-id') || null;
      const specs = text(one('[data-spec],[class*="spec"],[class*="sku-name"]', card)) || null;
      const key = `${goodsId}:${skuId || specs || items.length}`;
      if (seen.has(key)) continue; seen.add(key);
      const qtyInput = one('input[type="number"],input[data-quantity],[role="spinbutton"]', card);
      const raw = qtyInput?.value ?? qtyInput?.getAttribute('value') ?? qtyInput?.getAttribute('aria-valuenow');
      const quantity = raw && /^\d+$/.test(raw) ? Number(raw) : null;
      const cb = one('input[type="checkbox"],[role="checkbox"]', card);
      const aria = cb?.getAttribute('aria-checked');
      const checked = cb ? (cb.matches('input') ? (typeof cb.checked === 'boolean' ? cb.checked : cb.hasAttribute('checked')) : (aria === 'true' ? true : aria === 'false' ? false : null)) : null;
      items.push({ index: items.length + 1, goods_id: goodsId, sku_id: skuId, specs, title: text(one('[data-title],h3,[class*="goods-name"],[class*="goodsTitle"]', card)) || null, price: price(one('[data-price],[class*="price"]', card)), qty: quantity, checked, shop: text(one('[data-shop],[class*="shop-name"]', card)) || null, anomaly: text(one('[data-anomaly],[class*="invalid"],[class*="sold-out"]', card)) || null });
    }
    if (!items.length) return empty ? { status: 'empty', items: [], count: 0, truncated: false } : unsupported({ items: [], count: 0, truncated: true });
    return { status: 'ok', items, count: items.length, truncated: !one('[data-end-of-list="true"]') };
  }
  if (kind === 'sku') {
    const raw=inspectPage(document,location,'sku_read',args);
    if (!['ok','unsupported','target_mismatch'].includes(raw.status)) return raw;
    const entry=inspectPage(document,location,'spec_entry',args);
    const groups=raw.spec_groups||[],selected=raw._selection||{};
    const verified=raw.status==='ok'&&raw.skus?.some(s=>s.variant_price_verified===true);
    const identity=raw.status!=='target_mismatch'&&raw.diagnostic!=='bound_sku_state_mismatch'&&raw.goods_id===args.goods_id;
    const complete=groups.length>0&&groups.length===Object.keys(selected).length&&groups.every(g=>g.options.includes(selected[g.label]));
    const selection_status=verified?'verified':!identity||!groups.length?'unknown':!Object.keys(selected).length?'not_selected':!complete?'incomplete':'price_unconfirmed';
    const missing_evidence=[];
    if(!identity)missing_evidence.push('product_identity');
    if(!verified&&!complete)missing_evidence.push('complete_selection');
    if(!verified)missing_evidence.push('specification_price');
    if(!verified&&entry.safe_entry_status!=='available')missing_evidence.push('safe_spec_entry');
    const result={...raw,selection_status,safe_entry_status:entry.safe_entry_status||'missing',safe_entry_evidence:entry.safe_entry_evidence,missing_evidence};
    delete result._selection;
    return result;
  }
  if (kind === 'sku_read') {
    if (origin.pathname !== '/goods.html' || origin.searchParams.getAll('goods_id').length !== 1 || origin.searchParams.get('goods_id') !== args.goods_id) return { status: 'target_mismatch', goods_id: args.goods_id };
    const realDialogs=all('[role="dialog"].HidQ9ROd').filter(e=>one('.sku-specs-key',e));
    const openDialogs=realDialogs.filter(visible);
    const dialog=openDialogs.length===1?openDialogs[0]:realDialogs.length===1?realDialogs[0]:null;
    if(dialog) {
      const dialogOpen=openDialogs.length===1;
      if(dialogOpen&&(dialog.getAttribute('aria-busy')==='true'||all('[aria-busy="true"],[data-loading="true"]',dialog).some(visible)))return unsupported({diagnostic:'sku_price_loading',goods_id:args.goods_id,dialog_open:true,skus:[],truncated:true});
      const selected={},groups=[];
      for(const group of all('.bIhLWVqm',dialog)) {
        const label=specLabel(one('.sku-specs-key',group));
        const options=all('.F7sZG3xe[role="button"][aria-label]',group);
        if(!label||groups.some(g=>g.label===label))continue;
        groups.push({label,options:options.map(e=>e.getAttribute('aria-label')).filter(Boolean),option_states:options.map(e=>({value:e.getAttribute('aria-label'),selectable:optionDisabled(e)?false:null,reason:optionDisabled(e)?'disabled_control':null})),source:dialogOpen?'visible_sku_dialog':'preloaded_sku_dialog',visible:dialogOpen});
        const picked=options.filter(e=>e.classList.contains('hr353bdX')||e.getAttribute('aria-pressed')==='true');
        if(picked.length===1)selected[label]=picked[0].getAttribute('aria-label');
      }
      const summary=text(one('.Mbx2m60G',dialog));
      const prices=all('.ujEqGzEB',dialog).filter(visible);
      const amount=dialogOpen&&prices.length===1?price(prices[0]):null;
      const relation=dialogOpen&&groups.length>0&&groups.length===Object.keys(selected).length&&Object.values(selected).every(v=>summary.includes(String(v).replace(/\s+/g,' ').trim()))&&!!amount;
      const requested=!args.spec_selection||(Object.keys(args.spec_selection).length===Object.keys(selected).length&&Object.entries(args.spec_selection).every(([k,v])=>selected[k]===v));
      const good=relation&&requested;
      const detail=inspectPage(document,location,'detail',args);
      const panelCondition=dialogOpen&&prices.length===1?(text(prices[0]).match(/^(券后|大促价|补贴价|首件|新客(?:券后)?|限时价|限[1-9]\d*件)/)||[])[1]:null;
      const groupLabels=dialogOpen?all('.fXpFACQG .mhHA_CEU',dialog).filter(visible):[];
      const groupLabel=groupLabels.length===1?text(groupLabels[0]):null;
      const groupPanelPrice=groupLabels.length===1&&/^补贴价/.test(groupLabel)?price(groupLabels[0]):null;
      const preCouponPrice=groupLabels.length===1&&/^券前[¥￥]/.test(groupLabel)?price(groupLabels[0]):null;
      const exemptFooter=all('.Rrut_NDL .AANc1tSj .yK39frdi[role="button"]').filter(e=>visible(e)&&/免拼购买/.test(text(e))&&/[¥￥]\s*\d/.test(text(e))&&!/立即购买|开团|去拼单|付款|支付|结算|提交订单|确定/.test(text(e)));
      const groupExempt=exemptFooter.length===1;
      const offerConditions=[...new Set([...(Array.isArray(detail.offer_conditions)?detail.offer_conditions:detail.offer_conditions?[detail.offer_conditions]:[]),...(panelCondition?[panelCondition]:[]),...(groupPanelPrice?['补贴价']:[]),...(preCouponPrice?['券前价']:[])])];
      // Observed first-item panels also show a SKU-bound secondary promotion price.
      // Verify that visible base price; do not qualify the lower first-item offer.
      const firstItemBaseLabel=dialogOpen&&panelCondition==='首件'&&groupLabels.length===1?(groupLabel.match(/^(秒杀价|大促价|补贴价)[¥￥]\s*\d+(?:\.\d{1,2})?$/)||[])[1]:null;
      const firstItemBasePrice=firstItemBaseLabel?price(groupLabels[0]):null;
      if(firstItemBasePrice&&!offerConditions.includes(firstItemBaseLabel))offerConditions.push(firstItemBaseLabel);
      const dialogGoods=dialog.getAttribute('data-goods-id');
      if(dialogGoods&&dialogGoods!==args.goods_id)return unsupported({diagnostic:'bound_sku_state_mismatch',goods_id:args.goods_id,dialog_open:dialogOpen,spec_groups:groups,_selection:selected,skus:[],truncated:true});
      // Read only the product-bound SKU component already loaded by this page.
      // Never invoke its callbacks, mutate state, decode hidden prices or fetch APIs.
      {
        const fiberKeys=Object.keys(dialog).filter(k=>k.startsWith('__reactFiber$'));
        let fiber=fiberKeys.length===1?dialog[fiberKeys[0]]:null;
        for(let depth=0;fiber&&depth<5;depth++,fiber=fiber.return) {
          const goods=fiber.memoizedProps?.goods,state=fiber.stateNode?.state;
          if(!goods||!state?.skuInfos||!state.typeHashToSkuID||!state.currentSelect)continue;
          const idString=value=>typeof value==='string'&&/^[1-9]\d*$/.test(value)?value:typeof value==='number'&&Number.isSafeInteger(value)&&value>0?String(value):null;
          const rejected=()=>unsupported({diagnostic:'bound_sku_state_mismatch',goods_id:args.goods_id,dialog_open:dialogOpen,spec_groups:groups,skus:[],truncated:true});
          if((!dialogOpen&&detail.status!=='ok')||!detail.title||idString(goods.goodsID)!==args.goods_id||goods.goodsName!==detail.title)return rejected();
          const same=(a,b)=>a&&b&&Object.keys(a).length===Object.keys(b).length&&Object.entries(a).every(([k,v])=>typeof v==='string'&&b[k]===v);
          const rows=[],ids=new Set();let invalid=false;
          for(const [hash,rawID] of Object.entries(state.typeHashToSkuID)) {
            let specs;try{specs=JSON.parse(hash);}catch{invalid=true;break;}
            const id=idString(rawID),sku=id&&state.skuInfos[id];
            if(!specs||Array.isArray(specs)||typeof specs!=='object'||Object.keys(specs).length!==groups.length||!groups.length||Object.entries(specs).some(([label,value])=>!groups.some(g=>g.label===label&&g.options.includes(value)))||!sku||ids.has(id)||idString(sku.goodsId)!==args.goods_id||idString(sku.skuID)!==id||idString(sku.skuId)!==id||typeof sku.groupPrice!=='string'||!/^\d+(?:\.\d{1,2})?$/.test(sku.groupPrice)){invalid=true;break;}
            ids.add(id);
            const visiblePrice=dialogOpen?amount:detail.price;
            const selectedBound=id===idString(state.selectedSkuID)&&same(specs,state.currentSelect)&&same(specs,selected)&&Object.values(specs).every(v=>summary.includes(String(v).replace(/\s+/g,' ').trim()));
            const shownCents=visiblePrice?Math.round(Number(visiblePrice.replace('¥',''))*100):null;
            const groupCents=Math.round(Number(sku.groupPrice)*100);
            const couponMatch=dialogOpen&&selectedBound&&panelCondition==='券后'&&Number.isSafeInteger(sku.skuPrice)&&sku.skuPrice>=0&&sku.skuPrice===shownCents&&!!groupPanelPrice&&Math.round(Number(groupPanelPrice.replace('¥',''))*100)===groupCents;
            // A separately visible before-coupon price may verify the base SKU
            // amount; it never establishes eligibility for the lower offer.
            const preCouponMatch=dialogOpen&&selectedBound&&(panelCondition==='券后'||/^限[1-9]\d*件$/.test(panelCondition||''))&&!!preCouponPrice&&Math.round(Number(preCouponPrice.replace('¥',''))*100)===groupCents&&shownCents!==null&&shownCents<groupCents;
            const firstItemBaseMatch=dialogOpen&&selectedBound&&!!firstItemBasePrice&&Math.round(Number(firstItemBasePrice.replace('¥',''))*100)===groupCents&&shownCents!==null&&shownCents<groupCents;
            const crosschecked=selectedBound&&shownCents!==null&&(groupCents===shownCents||couponMatch||preCouponMatch||firstItemBaseMatch);
            const rowPrice=couponMatch?String(sku.skuPrice/100):sku.groupPrice;
            const selectionBlocked=groups.some(g=>g.option_states.some(o=>o.value===specs[g.label]&&o.selectable===false)&&groups.every(other=>other.label===g.label||selected[other.label]===specs[other.label]));
            // Quantity belongs to this exact SKU. Sale flags, purchase limits,
            // initial quantities and the product total are not stock evidence.
            let quantity;try{quantity=sku.quantity;}catch{}
            const stock=Number.isSafeInteger(quantity)&&quantity>=0?quantity:null;
            rows.push({sku_id:id,specs,selection_available:selectionBlocked?false:null,unselectable_reason:selectionBlocked?(stock===0?'page_stock_zero':'disabled_control'):null,price:rowPrice,price_basis:couponMatch?'loaded_sku_coupon_price':preCouponMatch?'loaded_sku_pre_coupon_price':firstItemBaseMatch?'loaded_sku_secondary_price':'loaded_sku_group_price',...(couponMatch?{group_price:sku.groupPrice}:{}),requires_group_purchase:!groupExempt,offer_conditions:offerConditions.length?offerConditions:null,offer_eligibility_verified:false,stock,available:sku.isOnsale===1?true:sku.isOnsale===0?false:null,variant_price_verified:crosschecked&&!selectionBlocked,field_evidence:{specs:evidence(specs,'product_bound_sku_state'),price:evidence(rowPrice,crosschecked&&!selectionBlocked?(couponMatch?'selected_sku_coupon_panel_crosscheck':preCouponMatch?'selected_sku_pre_coupon_panel_crosscheck':firstItemBaseMatch?'selected_sku_secondary_panel_crosscheck':'loaded_state_visible_price_crosscheck'):'loaded_state_not_visually_crosschecked',crosschecked&&!selectionBlocked),stock:evidence(stock,'product_bound_sku_quantity')}});
          }
          // A selected row must match both the DOM and the component's explicit map.
          if(invalid||!rows.length)return rejected();
          // Explain a disabled option even when its rows fall outside the
          // three-row response. Only complete, unique mappings with zero for
          // every package support this reason; never generalize one package.
          for(const group of groups)for(const option of group.option_states){
            option.unselectable_reason=option.selectable===false?'disabled_control':null;
            if(option.selectable!==false)continue;
            const related=rows.filter(row=>row.specs[group.label]===option.value);
            const expected=groups.filter(other=>other!==group).reduce((n,other)=>n*new Set(other.options).size,1);
            const unique=new Set(related.map(row=>JSON.stringify(groups.map(g=>row.specs[g.label])))).size;
            if(Number.isSafeInteger(expected)&&expected>0&&related.length===expected&&unique===expected&&related.every(row=>row.stock===0)){
              option.unselectable_reason='page_stock_zero';
              option.stock_evidence={...evidence(0,'product_bound_sku_quantity'),quantity:0,scope:'all_mapped_combinations_for_option',combination_count:related.length};
            }
          }
          rows.sort((a,b)=>Number(b.variant_price_verified)-Number(a.variant_price_verified));
          const matches=args.spec_selection?rows.filter(r=>same(r.specs,args.spec_selection)):rows;
          const chosen=matches.slice(0,3),verified=chosen.some(r=>r.variant_price_verified);
          return{status:verified?'ok':'unsupported',...(verified?{}:{code:'UNSUPPORTED',diagnostic:'selected_price_unverified',state_diagnostic:'loaded_combinations_not_visually_crosschecked'}),goods_id:args.goods_id,dialog_open:dialogOpen,verification_method:verified?(dialogOpen?'loaded_state_selected_panel_crosscheck':'loaded_state_visible_price_crosscheck'):'loaded_state_not_visually_crosschecked',spec_groups:groups,_selection:selected,skus:chosen,truncated:true,fetched_at:observedAt};
        }
      }
      return {status:good?'ok':'unsupported',...(good?{}:{code:'UNSUPPORTED',diagnostic:!dialogOpen?'sku_dialog_hidden':!requested?'spec_combination_unverified':'selected_price_unverified'}),goods_id:args.goods_id,dialog_open:dialogOpen,spec_groups:groups,_selection:selected,skus:good?[{sku_id:null,specs:selected,price:amount.replace('¥',''),price_basis:offerConditions.length?'selected_sku_conditional':'selected_sku_display',offer_conditions:offerConditions.length?offerConditions:null,offer_eligibility_verified:false,stock:null,available:null,variant_price_verified:true,field_evidence:{specs:evidence(selected,'visible_sku_dialog'),price:evidence(amount,'visible_selected_sku_price'),stock:evidence(null,null,false)}}]:[],truncated:true,fetched_at:observedAt};
    }
    const groups = [];
    for (const group of all('[data-spec-group],[class*="sku-group"],[class*="spec-group"]')) {
      const label = group.getAttribute('data-spec-group') || text(one('[data-spec-label],legend,[class*="label"]', group));
      const options = all('[data-spec-value],[role="option"],button', group).filter(visible).map(e => e.getAttribute('data-spec-value') || text(e)).filter(Boolean);
      if (label && options.length) groups.push({ label, options: [...new Set(options)] });
    }
    const skus = [];
    for (const node of all('[data-sku-id][data-specs]')) {
      let specs; try { specs = JSON.parse(node.getAttribute('data-specs')); } catch { continue; }
      if (!specs || Array.isArray(specs) || typeof specs !== 'object' || Object.values(specs).some(v => typeof v !== 'string')) continue;
      const priceValue = node.getAttribute('data-price');
      const stock = node.getAttribute('data-stock');
      const value = /^\d+(?:\.\d{1,2})?$/.test(priceValue || '') ? priceValue : null;
      const quantity = /^\d+$/.test(stock || '') && Number.isSafeInteger(Number(stock)) ? Number(stock) : null;
      skus.push({ sku_id: node.getAttribute('data-sku-id'), specs, price: value, price_basis: 'sku_display', stock: quantity, available: node.getAttribute('data-available') === 'true' ? true : node.getAttribute('data-available') === 'false' ? false : quantity !== null ? quantity > 0 : null, variant_price_verified: value !== null && visible(node), field_evidence: { specs: evidence(specs, 'explicit_sku_dom'), price: evidence(value, 'explicit_sku_dom', value !== null && visible(node)), stock: evidence(quantity, 'explicit_sku_dom') } });
    }
    const matches = args.spec_selection ? skus.filter(s => Object.keys(s.specs).length === Object.keys(args.spec_selection).length && Object.entries(args.spec_selection).every(([k,v]) => s.specs[k] === v)) : skus;
    const selected = args.spec_selection ? (matches.length === 1 ? matches : []) : matches.slice(0,3);
    return { status: selected.length ? 'ok' : 'unsupported', ...(selected.length ? {} : { code: 'UNSUPPORTED', diagnostic: args.spec_selection ? 'spec_combination_unverified' : 'sku_relationship_missing' }), goods_id: args.goods_id, spec_groups: groups, skus: selected, stock_text: text(one('[data-stock-text],[class*="stock"]')) || null, fetched_at: observedAt, truncated: !one('[data-sku-complete="true"]') || matches.length > selected.length };
  }
  if (kind === 'spec_open' || kind === 'spec_entry') {
    if (origin.pathname !== '/goods.html' || origin.searchParams.getAll('goods_id').length!==1 || origin.searchParams.get('goods_id') !== args.goods_id) return { status: 'target_mismatch', opened: false };
    const dialogs=all('[role="dialog"].HidQ9ROd').filter(e=>one('.sku-specs-key',e));
    const bound=dialog=>{
      const keys=Object.keys(dialog).filter(k=>k.startsWith('__reactFiber$'));
      let f=keys.length===1?dialog[keys[0]]:null;
      for(let depth=0;f&&depth<5;depth++,f=f.return){
        const g=f.memoizedProps?.goods,s=f.stateNode?.state;
        if(g&&s?.skuInfos&&s.typeHashToSkuID&&s.currentSelect)return String(g.goodsID)===args.goods_id&&g.goodsName===text(one('.tLYIg_Ju.enable-select,[data-goods-title],h1'));
      }
      return false;
    };
    const open=dialogs.filter(visible);
    if(kind==='spec_entry'&&open.length===1&&bound(open[0]))return{status:'ok',safe_entry_status:'available',safe_entry_evidence:{observed_at:observedAt,visible_region_count:1,hidden_region_count:dialogs.length-1,accepted_count:1,candidates:[]}};
    if(kind==='spec_open'&&open.length)return open.length===1&&bound(open[0])?{status:'ok',opened:true,entry_kind:'existing_spec_modal'}:unsupported({opened:false,diagnostic:'spec_dialog_ambiguous_or_unbound'});
      const regionSelector='[data-spec-entry],[data-spec-region],[class*="sku-entry"],[class*="spec-entry"],.xJDS9NLo';
      const regions=all(regionSelector),candidates=[];
      let buttons = all('button,a,[role="button"],[data-spec-entry],[class*="sku-entry"],[class*="spec-entry"],.xJDS9NLo').filter(e => {
        const label=text(e),explicit=/^(选择规格|请选择规格|规格选择)$/.test(label);
        const row=/^(?:已选|规格)[：:]\s*\S/.test(label)&&label.length<=160;
        const keys=Object.keys(e).filter(k=>k.startsWith('__reactProps$'));
        const clickable=typeof e.onclick==='function'||keys.length===1&&typeof e[keys[0]]?.onClick==='function';
        const region=e.closest(regionSelector),reasons=[];
        if(!region)reasons.push('outside_spec_region');
        if(!explicit&&!row)reasons.push('not_spec_entry');
        if(row&&!clickable)reasons.push('click_behavior_unconfirmed');
        if(/立即购买|拼单|开团|付款|支付|结算|提交订单|加入购物车|确定|发送/.test(label)||e.closest('form')||/javascript:|order|checkout|pay|group/i.test(e.getAttribute('href')||''))reasons.push('unsafe_control');
        if(e.disabled||e.getAttribute('aria-disabled')==='true')reasons.push('disabled');
        if(visible(e)&&label.length<=160&&(region||explicit||row)&&candidates.length<12)candidates.push({tag:e.tagName,text:label,within_spec_region:!!region,click_bound:clickable,reasons});
        return !!region&&visible(e)&&reasons.length===0;
      });
    // Observed footer control opens a product-bound SKU modal. Never match a
    // generic buy label, execute a private handler, submit a form or confirm.
    let entry_kind='independent_spec_entry',ambiguousFooter=false;
    if(!buttons.length&&!open.length){
      const footer=all('.Rrut_NDL .AANc1tSj .yK39frdi[role="button"]').filter(visible);
      const modalFooter=footer.filter(e=>/免拼购买/.test(text(e))&&/[¥￥]\s*\d/.test(text(e))&&!/立即购买|开团|去拼单|付款|支付|结算|提交订单|确定/.test(text(e)));
      ambiguousFooter=modalFooter.length>1;
      const accepted=footer.filter(e=>{
        const label=text(e),keys=Object.keys(e).filter(k=>k.startsWith('__reactProps$'));
        const handler=keys.length===1&&e[keys[0]]?.onClick;
        const reasons=[];
        if(ambiguousFooter)reasons.push('duplicate_footer_controls');
        if(dialogs.length!==1||!bound(dialogs[0]))reasons.push('product_bound_dialog_missing');
        if(!/免拼购买/.test(label)||!/[¥￥]\s*\d/.test(label)||/立即购买|开团|去拼单|付款|支付|结算|提交订单|确定/.test(label))reasons.push('unrecognized_footer_action');
        if(typeof handler!=='function'||!['setModal','useData','buttonData'].every(k=>Function.prototype.toString.call(handler).includes(k)))reasons.push('modal_behavior_unconfirmed');
        if(e.closest('form')||e.hasAttribute('href')||e.disabled||e.getAttribute('aria-disabled')==='true')reasons.push('unsafe_control');
        if(candidates.length<12)candidates.push({tag:e.tagName,text:label.slice(0,160),within_spec_region:false,click_bound:typeof handler==='function',reasons});
        return reasons.length===0;
      });
      if(accepted.length){buttons=accepted;entry_kind='footer_spec_modal';}
    }
    const safe_entry_status=ambiguousFooter||buttons.length>1?'ambiguous':buttons.length===1?'available':'missing';
    const safe_entry_evidence={observed_at:observedAt,visible_region_count:regions.filter(visible).length,hidden_region_count:regions.filter(e=>!visible(e)).length,accepted_count:buttons.length,candidates};
    if(kind==='spec_entry')return{status:'ok',safe_entry_status,safe_entry_evidence};
    if (buttons.length !== 1) return unsupported({ opened: false,safe_entry_status,safe_entry_evidence,diagnostic:safe_entry_status==='ambiguous'?'safe_spec_entry_ambiguous':'safe_spec_entry_missing', message: '没有唯一可核验的规格入口；不执行购买或拼单。' });
    buttons[0].click(); return { status: 'ok', opened: true,entry_kind,safe_entry_status,safe_entry_evidence };
  }
  if (kind === 'spec_click') {
    if(origin.pathname!=='/goods.html'||origin.searchParams.getAll('goods_id').length!==1||origin.searchParams.get('goods_id')!==args.goods_id)return{status:'target_mismatch',selected:false,diagnostic:'spec_product_mismatch'};
    const dialogs=all('[role="dialog"]').filter(visible);
    if(dialogs.length!==1)return unsupported({selected:false,diagnostic:'spec_dialog_not_unique'});
    const dialog=dialogs[0],keys=Object.keys(dialog).filter(k=>k.startsWith('__reactFiber$'));
    let f=keys.length===1?dialog[keys[0]]:null,owned=dialog.getAttribute('data-goods-id')===args.goods_id;
    for(let depth=0;f&&depth<5;depth++,f=f.return){const g=f.memoizedProps?.goods;if(g){owned=String(g.goodsID)===args.goods_id&&g.goodsName===text(one('.tLYIg_Ju.enable-select,[data-goods-title],h1'));break;}}
    if(!owned)return unsupported({selected:false,diagnostic:'spec_dialog_product_unconfirmed'});
    const matches = all('[data-spec-group],[class*="sku-group"],[class*="spec-group"],.bIhLWVqm',dialog).filter(g => visible(g) && (g.getAttribute('data-spec-group') || specLabel(one('.sku-specs-key,[data-spec-label],legend,[class*="label"]', g))) === args.label);
    if (matches.length !== 1) return unsupported({ selected: false });
    const options = all('[data-spec-value],[role="option"],button,.F7sZG3xe[role="button"][aria-label]', matches[0]).filter(e => visible(e) && (e.getAttribute('data-spec-value') || e.getAttribute('aria-label') || text(e)) === args.value && !/立即购买|拼单|开团|付款|支付|结算|提交订单|加入购物车|发送|确定/.test(text(e)) && !e.closest('form') && !e.disabled && e.getAttribute('aria-disabled') !== 'true');
    if (options.length !== 1) return unsupported({ selected: false });
    if(optionDisabled(options[0]))return unsupported({selected:false,diagnostic:'spec_option_disabled',option_text:text(options[0])});
    options[0].click(); return { status: 'ok', selected: true, option_text:text(options[0]) };
  }
  if (kind === 'selection') {
    const dialog=all('[role="dialog"].HidQ9ROd').filter(visible);
    if(args.goods_id&&(origin.pathname!=='/goods.html'||origin.searchParams.getAll('goods_id').length!==1||origin.searchParams.get('goods_id')!==args.goods_id))return{status:'target_mismatch',selected:{}};
    if(args.goods_id&&dialog.length!==1)return unsupported({diagnostic:'spec_dialog_not_unique',selected:{}});
    if(dialog.length===1){const result={};let sku_id=null;const keys=Object.keys(dialog[0]).filter(k=>k.startsWith('__reactFiber$'));let f=keys.length===1?dialog[0][keys[0]]:null;
      for(let depth=0;f&&depth<5;depth++,f=f.return){const g=f.memoizedProps?.goods,s=f.stateNode?.state;if(g){if(args.goods_id&&(String(g.goodsID)!==args.goods_id||g.goodsName!==text(one('.tLYIg_Ju.enable-select,[data-goods-title],h1'))))return{status:'target_mismatch',selected:{}};if(s?.selectedSkuID)sku_id=String(s.selectedSkuID);break;}}
      for(const group of all('.bIhLWVqm',dialog[0])){const label=specLabel(one('.sku-specs-key',group)),picked=all('.F7sZG3xe.hr353bdX[aria-label]',group).filter(visible);if(label&&picked.length===1)result[label]=picked[0].getAttribute('aria-label');}return{selected:result,summary:text(one('.Mbx2m60G',dialog[0]))||null,sku_id,price_nodes:all('.ujEqGzEB',dialog[0]).filter(visible).slice(0,3).map(e=>text(e).slice(0,160)),loading:all('[aria-busy=true],[data-loading=true]',dialog[0]).some(visible)};}
    const selected = {};
    for (const group of all('[data-spec-group],[class*="sku-group"],[class*="spec-group"]')) {
      const label = group.getAttribute('data-spec-group') || text(one('[data-spec-label],legend,[class*="label"]', group));
      const options = all('[data-selected="true"],[aria-selected="true"],[aria-pressed="true"],input:checked', group);
      if (label && options.length === 1) selected[label] = options[0].getAttribute('data-spec-value') || text(options[0]);
    }
    return { status: 'ok', selected };
  }
  if (kind === 'cart_click') {
    const pageId = new URL(href).searchParams.get('goods_id');
    if (pageId !== args.goods_id) return { status: 'target_mismatch', clicked: false };
    const buttons = all('button,a,[role="button"]').filter(e => visible(e) && !e.disabled && text(e) === '加入购物车');
    if (buttons.length !== 1) return unsupported({ clicked: false });
    const quantity = one('input[type="number"][data-quantity],input[data-buy-quantity]');
    if (!quantity || !visible(quantity)) return unsupported({ clicked: false });
    quantity.value = String(args.quantity || 1);
    quantity.dispatchEvent(new DomEvent('input', { bubbles: true }));
    quantity.dispatchEvent(new DomEvent('change', { bubbles: true }));
    if (Number(quantity.value) !== (args.quantity || 1)) return unsupported({ clicked: false });
    buttons[0].click(); return { status: 'clicked', clicked: true };
  }
  if (kind === 'contact_open') {
    const buttons = all('button,a,[role="button"]').filter(e => visible(e) && /^(联系客服|客服)$/.test(text(e)));
    if (buttons.length !== 1) return unsupported({ opened: false });
    buttons[0].click(); return { status: 'opened', opened: true };
  }
  if (kind === 'chat' || kind === 'chat_send') {
    const panels = all('[data-chat-shop-id],[data-chat-mall-id]');
    if (panels.length !== 1) return unsupported({ sent: false, messages: [], shop_id: null, outgoing_count: 0 });
    const panel = panels[0];
    const shopId = panel.getAttribute('data-chat-shop-id') || panel.getAttribute('data-chat-mall-id');
    if (args.shop_id && shopId !== args.shop_id) return { status: 'target_mismatch', sent: false, messages: [], shop_id: shopId, outgoing_count: 0 };
    const outgoing = all('[data-message-direction="outgoing"],[data-direction="outgoing"]', panel);
    const bubbles = all('[data-message-direction],[data-direction], [data-message-bubble]', panel);
    if (kind === 'chat') return { status: 'ok', shop_id: shopId, messages: bubbles.map(text).filter(Boolean).slice(-50), outgoing_count: outgoing.filter(e => args.message === undefined || text(e) === String(args.message).replace(/\s+/g, ' ').trim()).length, outgoing_messages: outgoing.map(text) };
    const inputs = all('textarea,input[type="text"],[contenteditable="true"]', panel).filter(visible);
    const buttons = all('button,[role="button"]', panel).filter(e => visible(e) && !e.disabled && text(e) === '发送');
    if (inputs.length !== 1 || buttons.length !== 1) return unsupported({ sent: false });
    const input = inputs[0];
    if (input.getAttribute('contenteditable') === 'true') input.textContent = args.message;
    else {
      const proto = Object.getPrototypeOf(input);
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(input, args.message); else input.value = args.message;
    }
    input.dispatchEvent(new DomEvent('input', { bubbles: true }));
    input.dispatchEvent(new DomEvent('change', { bubbles: true }));
    const actual = input.getAttribute('contenteditable') === 'true' ? input.textContent : input.value;
    if (actual !== args.message) return { status: 'input_mismatch', sent: false };
    buttons[0].click(); return { status: 'clicked', sent: true };
  }
  return unsupported();
}
module.exports = { inspectPage };
