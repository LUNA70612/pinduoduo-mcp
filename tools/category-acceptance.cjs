'use strict';
const categories={
 cat_food:{query:'成猫 全价 猫粮',price_max:200,include_terms:['猫粮'],exclude_terms:['试吃']},
 earphones:{query:'蓝牙耳机',price_max:200,include_terms:['耳机']},
 clothing:{query:'纯棉 短袖 T恤',price_max:200,include_terms:['短袖']},
 shoes:{query:'运动鞋',price_max:200,include_terms:['鞋']},
 bedding:{query:'纯棉 床单',price_max:200,include_terms:['床单']},
 household:{query:'洗衣液',price_max:200,include_terms:['洗衣液']},
 kitchen:{query:'不锈钢 保温杯',price_max:200,include_terms:['保温杯']},
 appliances:{query:'电热水壶',price_max:200,include_terms:['水壶']},
 accessories:{query:'USB C 充电器',price_max:200,include_terms:['充电器']},
 food:{query:'纯牛奶',price_max:200,include_terms:['牛奶']}
};
const stopStatuses=new Set(['auth_required','verification_required','service_unavailable','browser_disconnected','timeout','page_loading','operation_failed','parse_failed','rpc_error','browser_busy','stale_lock','interrupted','state_corrupt','result_unknown']);
function planSelectionFollowup(sku,goodsId){
 if(sku?.status!=='unsupported'||sku.goods_id!==goodsId||sku.safe_entry_status!=='available'||!['not_selected','incomplete'].includes(sku.selection_status))return null;
 const groups=sku.spec_groups;
 if(!Array.isArray(groups)||!groups.length||groups.length>10||new Set(groups.map(g=>g.label)).size!==groups.length||groups.some(g=>typeof g.label!=='string'||!g.label.trim()||g.label.length>100||!Array.isArray(g.options)))return null;
 const rows=(sku.skus||[]).filter(s=>s.specs&&Object.keys(s.specs).length===groups.length&&groups.every(g=>typeof s.specs[g.label]==='string'&&s.specs[g.label].trim()&&s.specs[g.label].length<=100&&g.options.includes(s.specs[g.label])));
 const key=s=>JSON.stringify(groups.map(g=>[g.label,s.specs[g.label]]));
 const chosen=rows.find(s=>s.selection_available!==false&&s.available!==false&&s.stock!==0&&s.field_evidence?.specs?.verified===true&&s.field_evidence.specs.source==='product_bound_sku_state'&&rows.filter(other=>key(s)===key(other)).length===1);
 return chosen?Object.fromEntries(groups.map(g=>[g.label,chosen.specs[g.label]])):null;
}
async function runCategory(category,call,{feasibility=false,selectionFollowup=false}={}) {
 if(!Object.hasOwn(categories,category))throw Error('未知品类');
 const definition=categories[category],result={category,stop_all:false,business_accepted:false,comparison_complete:false,manual_page_crosscheck:'pending',selected_goods:[],limitations:[]};
 const search=await call('pdd_search',{...definition,limit:10},{case:'search'});
 if(stopStatuses.has(search.status)){result.stop_all=true;return result;}
 if(search.status!=='ok'||search.search_context?.result_kind==='recommendations_after_no_results'){result.limitations.push('搜索未取得可继续核验的相关候选；不扩大搜索或重试。');return result;}
 const products=[...new Map((search.results||[]).filter(p=>p.goods_id&&p.url&&definition.include_terms.every(t=>(p.title||'').includes(t))).map(p=>[p.goods_id,p])).values()].slice(0,3);
 result.selected_goods=products.map(p=>p.goods_id);
 let skuCalls=0,verifiedDefaults=0,verifiedAlternates=0,verifiedSpecifications=0,selectionFollowups=0;
 for(const product of products){
  const detail=await call('pdd_read_item',{url:product.url,entry:'search',budget_max:200},{case:'detail'});
  if(stopStatuses.has(detail.status)){result.stop_all=true;break;}
  if(detail.status!=='ok'){
   result.stop_all=true;
   result.limitations.push('详情读取未通过，保留当前页面供诊断；停止后续导航，不自动重试或替换商品。');
   break;
  }
  if(feasibility||skuCalls<1||['cat_food','earphones'].includes(category)){
   skuCalls++;
   let sku=await call('pdd_read_sku',{goods_id:product.goods_id,budget_max:200},{case:'default_sku'});
   if(stopStatuses.has(sku.status)){result.stop_all=true;break;}
   const initialRows=Array.isArray(sku.skus)?sku.skus.slice():[];
   let followed=false;
   const followup=selectionFollowup?planSelectionFollowup(sku,product.goods_id):null;
   if(followup){
    // The callback has saved the failed result before this distinct explicit request.
    followed=true;selectionFollowups++;
    sku=await call('pdd_read_sku',{goods_id:product.goods_id,spec_selection:followup,budget_max:200},{case:'selection_followup',batch_kind:'explicit_selection_followup',follows_case:'default_sku'});
    const matches=sku.skus?.filter(s=>s.variant_price_verified===true&&Object.keys(s.specs||{}).length===Object.keys(followup).length&&Object.entries(followup).every(([k,v])=>s.specs[k]===v)&&typeof s.price_assessment?.reference_price==='number');
    if(sku.status!=='ok'||sku.goods_id!==product.goods_id||matches?.length!==1){result.stop_all=true;result.limitations.push('明确规格后续请求未唯一核验，保留原失败与后续结果，不重复请求或换商品。');break;}
   }
   if(sku.status!=='ok'){result.stop_all=true;result.limitations.push('默认规格未通过，保留现场并暂停批次。');break;}
   const base=sku.skus?.find(s=>s.variant_price_verified);
   if(!base){result.stop_all=true;result.limitations.push('规格返回成功但没有已核验价格，保留现场并暂停。');break;}
   if(base){verifiedSpecifications++;if(!followed)verifiedDefaults++;}
   // Select only an explicit alternate from a real map. Never fabricate a Cartesian combination.
   const alternate=(initialRows.length?initialRows:sku.skus||[]).find(s=>base&&Object.keys(s.specs||{}).length===Object.keys(base.specs).length&&Object.entries(s.specs).some(([k,v])=>v!==base.specs[k])&&s.selection_available!==false&&s.available!==false&&s.stock!==0);
   if(alternate){
    if(feasibility&&sku.safe_entry_status!=='available'){result.stop_all=true;result.limitations.push('非默认规格没有唯一安全入口，阶段受限；保留现场，不扩大测试。');break;}
    const specified=await call('pdd_read_sku',{goods_id:product.goods_id,spec_selection:alternate.specs,budget_max:200},{case:'non_default_sku',base_specs:base.specs});
    if(stopStatuses.has(specified.status)){result.stop_all=true;break;}
    if(specified.status!=='ok'){result.stop_all=true;result.limitations.push('指定规格未通过，保留现场并暂停批次。');break;}
    const matched=specified.skus?.filter(s=>s.variant_price_verified&&Object.keys(s.specs||{}).length===Object.keys(alternate.specs).length&&Object.entries(alternate.specs).every(([k,v])=>s.specs[k]===v));
    if(matched?.length!==1){result.stop_all=true;result.limitations.push('指定组合与已核验价格不唯一匹配，保留现场并暂停。');break;}
    if(matched?.length===1)verifiedAlternates++;
   }
  }
 }
 result.selection_followups=selectionFollowups;result.verified_specifications=verifiedSpecifications;
 if(feasibility){result.feasibility={verified_defaults:verifiedDefaults,verified_specifications:verifiedSpecifications,verified_non_defaults:verifiedAlternates,status:!result.stop_all&&products.length===3&&verifiedSpecifications>=1&&verifiedAlternates>=1?'pending_page_crosscheck':'limited'};if(result.feasibility.status==='limited'){result.stop_all=true;result.limitations.push('规格可行性未通过，不扩大十品类测试。');}}
 if(products.length<3)result.limitations.push('本次已加载匹配商品不足三个，不补猜商品或翻页凑数。');
 result.limitations.push('自动结果不代替页面逐字段核对与用户需求比较；预算 200 元仅为兼容性测试条件。');
 return result;
}
module.exports={categories,stopStatuses,runCategory,planSelectionFollowup};
