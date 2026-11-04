'use strict';
// Decimal currency is compared as integer cents, never floating point estimates.
function cents(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    value = String(value);
  }
  if (typeof value !== 'string') return null;
  const m = value.trim().match(/^(?:[¥￥]\s*)?(\d{1,9})(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] || '').padEnd(2,'0'));
}
function filterCatalog(data, args) {
  if (!['ok','empty'].includes(data.status) || !Array.isArray(data.results)) return data;
  const matched=[], pending=[], excluded=[];
  const min=args.price_min === undefined ? null : cents(args.price_min), max=args.price_max === undefined ? null : cents(args.price_max);
  for (const item of data.results) {
    const title=(item.title || '').normalize('NFKC').toLocaleLowerCase('zh-CN');
    const reasons=[];
    for (const word of args.include_terms || []) if (!title.includes(word.normalize('NFKC').toLocaleLowerCase('zh-CN'))) reasons.push({code:'required_term_missing',term:word});
    for (const word of args.exclude_terms || []) if (title.includes(word.normalize('NFKC').toLocaleLowerCase('zh-CN'))) reasons.push({code:'excluded_term_present',term:word});
    const groupPurchase = /多人团|万人团|(?:[3-9]|[1-9]\d+)\s*人(?:团|成团|拼团)|至少\s*(?:[3-9]|[1-9]\d+)\s*人/.test(String(item.price_conditions || ''));
    if (args.exclude_group_purchase === true && groupPurchase) reasons.push({code:'group_purchase_excluded'});
    const amount=cents(item.price);
    if (amount !== null && min !== null && amount < min) reasons.push({code:'below_display_price_min'});
    if (amount !== null && max !== null && amount > max) reasons.push({code:'above_display_price_max'});
    const result={...item,price_basis:item.price_basis || 'list_display',variant_price_verified:false,budget_verified:false,display_price_matches:amount === null ? null : (min === null || amount >= min) && (max === null || amount <= max)};
    if (reasons.length) excluded.push({goods_id:item.goods_id,reasons});
    else if (amount === null) pending.push({...result,verification_required:['display_price_unknown']});
    else matched.push(result);
  }
  const limit=args.limit || 10;
  return {...data,status:matched.length || pending.length ? 'ok' : 'empty',results:matched.slice(0,limit),count:Math.min(limit,matched.length),scanned_count:data.results.length,matched_count:matched.length,pending_verification:pending.slice(0,limit),pending_count:pending.length,excluded,excluded_count:excluded.length,empty_reason:matched.length || pending.length ? null : data.results.length ? 'no_loaded_cards_match_filters' : 'page_empty',filter_scope:'loaded_card_title_and_display_price',ranking:'page_order_not_quality',truncated:!!data.truncated || matched.length > limit || pending.length > limit};
}
function unitPrice({price,quantity,unit,pack_count=1}) {
  const amount=cents(price);
  const units={g:{factor:0.001,base:'kg'},kg:{factor:1,base:'kg'},ml:{factor:0.001,base:'L'},l:{factor:1,base:'L'},L:{factor:1,base:'L'},piece:{factor:1,base:'piece'}};
  if (amount === null || typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(pack_count) || pack_count < 1 || !Object.hasOwn(units,unit)) return {value:null,reason:'unverified_or_invalid_quantity'};
  const total=quantity*units[unit].factor*pack_count;
  if (!Number.isFinite(total) || total <= 0) return {value:null,reason:'unverified_or_invalid_quantity'};
  return {value:Number((amount/100/total).toFixed(4)),currency:'CNY',per:units[unit].base,quantity:total};
}
function normalizeQuantity(value) {
  if (typeof value !== 'string') return null;
  // A single pack is unambiguous. "2袋3kg" does not say whether 3kg is total.
  const m=value.trim().replace(/^1(?:袋|包|瓶)[（(]([^（）()]+)[）)]$/,'$1').replace(/^1(?:袋|包|瓶)(?=\d)/,'').match(/^(\d+(?:\.\d+)?)\s*(kg|千克|公斤|g|克|ml|毫升|l|L|升|件)(?:\s*[*×xX]\s*(\d+)\s*(?:袋|包|瓶|件)?)?$/i);
  if (!m) return null;
  const map={kg:'kg','千克':'kg','公斤':'kg',g:'g','克':'g',ml:'ml','毫升':'ml',l:'L','升':'L','件':'piece'};
  return {quantity:Number(m[1]),unit:map[m[2].toLowerCase()],pack_count:m[3]?Number(m[3]):1};
}
function priceAssessment(item, args = {}) {
  const amount = item.variant_price_verified === true ? cents(item.price) : null;
  const conditional = /coupon|conditional/.test(item.price_basis || '') || !!item.offer_conditions;
  const group = item.requires_group_purchase !== false && (item.requires_group_purchase === true || item.price_basis === 'loaded_sku_group_price');
  const conditions = [...new Set([...(Array.isArray(item.offer_conditions) ? item.offer_conditions : item.offer_conditions ? [item.offer_conditions] : []), ...(group ? ['group_purchase_required'] : [])])];
  const unknowns = ['shipping_fee'];
  if (amount === null) unknowns.push('specification_price');
  if ((conditional || group) && item.offer_eligibility_verified !== true) unknowns.push('offer_eligibility');
  const budget = cents(args.budget_max);
  const budget_status = amount === null || budget === null ? 'unknown' : amount > budget ? 'over_budget' : conditional || group ? 'conditional_within_budget' : 'item_price_within_budget';
  return { reference_price: amount === null ? null : amount / 100, currency:'CNY', quantity:1, basis:amount === null ? 'unknown' : group ? 'group_purchase' : conditional ? 'conditional_offer' : 'regular', conditions, unknowns, budget_max:budget === null ? null : budget/100, budget_status, total_price_confirmed:false };
}
function withComparison(data, args = {}) {
  if (!data || !['ok','unsupported'].includes(data.status)) return data;
  const attributes = data.attributes || [];
  const enrich = item => {
    const specValues=Object.values(item.specs||{});
    const explicitSpecs=specValues.map(normalizeQuantity).filter(Boolean);
    // Product-wide attributes may describe a different default pack. Never use them
    // to fill in an ambiguous or absent SKU quantity without explicit binding.
    const candidates=data.skus?(explicitSpecs.length?specValues:[]):[...specValues,...attributes.filter(a=>/^(净含量|净重|重量|容量|数量)$/.test(a.name)).map(a=>a.value)];
    const quantities=candidates.map(normalizeQuantity).filter(Boolean);
    const keys=new Set(quantities.map(q=>JSON.stringify(q)));
    const quantity=keys.size===1?quantities[0]:null;
    return {...item,price_assessment:priceAssessment(item,args),unit_price:item.variant_price_verified === true && quantity ? unitPrice({price:item.price,...quantity}) : {value:null,reason:item.variant_price_verified !== true?'sku_price_unverified':'quantity_unknown_or_ambiguous'}};
  };
  return data.skus ? {...data,price_assessment:priceAssessment({},args),skus:data.skus.map(enrich)} : enrich(data);
}
module.exports={cents,filterCatalog,unitPrice,normalizeQuantity,withComparison,priceAssessment};
