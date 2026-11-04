'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {parseHTML}=require('linkedom'),{inspectPage}=require('../clis/pdd/_dom.cjs');
function scene(change=()=>{}) {
 const f=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/pdd-asus-spec-cta-2026-11-04.json'),'utf8'));change(f);
 const {document}=parseHTML('<html><body>'+f.html+'</body></html>');
 const d=document.querySelector('[role=dialog]');
 d.__reactFiber$fixture={return:{memoizedProps:{goods:f.goods},stateNode:{state:f.state}}};
 const e=document.querySelector('.Rrut_NDL .yK39frdi[role=button]');let clicks=0;
 e.__reactProps$fixture={onClick:function(){return {setModal:true,useData:true,buttonData:true};}};
 e.addEventListener('click',()=>{clicks++;d.hidden=false;});
 return {f,document,d,e,clicks:()=>clicks,read:(kind,args={})=>inspectPage(document,new URL('https://mobile.yangkeduo.com/goods.html?goods_id='+f.goods_id),kind,{goods_id:f.goods_id,...args})};
}
test('observed footer price CTA opens only the bound specification panel once, inspection stays read only',()=>{
 const s=scene();assert.equal(s.read('spec_entry').safe_entry_status,'available');assert.equal(s.clicks(),0);
 const r=s.read('spec_open');assert.equal(r.opened,true);assert.equal(s.clicks(),1);assert.equal(s.d.hidden,false);
 assert.equal(r.entry_kind,'footer_spec_modal');
 s.read('spec_open');assert.equal(s.clicks(),1);
});

test('real single-buy plus modal footer chooses only the unique recognized modal entry',()=>{
 const f=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/pdd-kitchen-two-footer-2026-11-04.json'),'utf8').replace(/^\uFEFF/,''));
 const {document}=parseHTML('<html><body>'+f.html+'</body></html>'),d=document.querySelector('[role=dialog]');d.hidden=true;
 d.__reactFiber$fixture={return:{memoizedProps:{goods:f.goods},stateNode:{state:f.state}}};
 const clicks=[];
 for(const e of document.querySelectorAll('.Rrut_NDL .yK39frdi[role=button]')){
  e.__reactProps$fixture={onClick:function(){return {setModal:true,useData:true,buttonData:true};}};
  e.addEventListener('click',()=>{clicks.push(e.textContent);d.hidden=false;});
 }
 document.querySelector('[aria-label="确定"]').addEventListener('click',()=>assert.fail('must never confirm'));
 const r=inspectPage(document,new URL('https://mobile.yangkeduo.com/goods.html?goods_id='+f.goods_id),'spec_open',{goods_id:f.goods_id});
 assert.equal(r.opened,true);assert.equal(r.entry_kind,'footer_spec_modal');assert.equal(clicks.length,1);assert.match(clicks[0],/免拼购买/);assert.doesNotMatch(clicks[0],/单独购买/);
});

test('two equally labelled modal controls remain ambiguous even if only one has a known handler',()=>{
 const s=scene();s.e.parentElement.appendChild(s.e.cloneNode(true));
 assert.equal(s.read('spec_entry').safe_entry_status,'ambiguous');assert.equal(s.read('spec_open').opened,false);assert.equal(s.clicks(),0);
});

test('observed bedding single group-purchase footer never opens or alters the hidden panel',()=>{
 const f=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/pdd-bedding-single-footer-2026-11-04.json'),'utf8'));
 const {document}=parseHTML('<html><body>'+f.html+'</body></html>'),d=document.querySelector('[role=dialog]');
 // The independent live evidence records dialog_count=0; page CSS is not bundled.
 d.hidden=true;d.__reactFiber$fixture={return:{memoizedProps:{goods:f.goods},stateNode:{state:f.state}}};
 let clicks=0;
 for(const e of document.querySelectorAll('[role=button]')){e.__reactProps$fixture={onClick:function(){return {setModal:true,useData:true,buttonData:true};}};e.addEventListener('click',()=>clicks++);}
 const r=inspectPage(document,new URL('https://mobile.yangkeduo.com/goods.html?goods_id='+f.goods_id),'spec_open',{goods_id:f.goods_id});
 assert.equal(r.opened,false);assert.equal(r.safe_entry_status,'missing');assert.equal(clicks,0);assert.equal(d.hidden,true);
 assert.ok(r.safe_entry_evidence.candidates.some(e=>e.text.includes('发起拼单')&&e.reasons.includes('unrecognized_footer_action')));
});

test('real dual footer preserves no-group-purchase evidence for the verified combination',()=>{
 const f=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/pdd-kitchen-two-footer-2026-11-04.json'),'utf8').replace(/^\uFEFF/,''));
 const {document}=parseHTML('<html><body>'+f.html+'</body></html>'),d=document.querySelector('[role=dialog]');d.hidden=false;
 d.__reactFiber$fixture={return:{memoizedProps:{goods:f.goods},stateNode:{state:f.state}}};
 const r=inspectPage(document,new URL('https://mobile.yangkeduo.com/goods.html?goods_id='+f.goods_id),'sku',{goods_id:f.goods_id});
 const sku=r.skus.find(s=>s.variant_price_verified);assert.ok(sku);assert.equal(sku.requires_group_purchase,false);assert.ok(sku.offer_conditions.includes('秒杀价'));
});
test('footer entry refuses wrong product, unbound handler, duplicate controls, forms and payment labels',()=>{
 for(const mutate of [s=>s.f.goods.goodsID=123,s=>delete s.e.__reactProps$fixture,s=>s.e.parentElement.appendChild(s.e.cloneNode(true)),s=>{const form=s.document.createElement('form');s.e.parentElement.appendChild(form);form.appendChild(s.e);},s=>s.e.textContent='立即支付 ¥29.9',s=>s.e.setAttribute('href','/order.html'),s=>s.d.remove()]){
  const s=scene();mutate(s);const r=s.read('spec_open');assert.equal(r.opened,false);assert.equal(s.clicks(),0);
 }
});
test('spec click is confined to one visible product-bound panel and never confirms',()=>{
 const s=scene();const args={label:'颜色',value:'星空黑 云感佩戴 三年质保 极速发货'};
 let clicks=0;s.document.querySelectorAll('[aria-label]').forEach(e=>e.addEventListener('click',()=>clicks++));
 assert.equal(s.read('spec_click',args).selected,false);s.d.hidden=false;
 assert.equal(s.read('spec_click',args).selected,true);assert.equal(clicks,1);
 assert.equal(s.read('spec_click',{...args,goods_id:'123'}).selected,false);assert.equal(clicks,1);
 const clone=s.d.cloneNode(true);s.d.parentElement.appendChild(clone);assert.equal(s.read('spec_click',args).selected,false);assert.equal(clicks,1);
});
module.exports={scene};
test('footer rejection reasons stay within the published MCP output schema',()=>{
 const allowed=require('../tools/pdd.cjs').tools.find(t=>t.name==='pdd_read_sku').outputSchema.properties.safe_entry_evidence.properties.candidates.items.properties.reasons.items.enum;
 const s=scene();delete s.e.__reactProps$fixture;
 const r=s.read('spec_entry');for(const c of r.safe_entry_evidence.candidates)for(const reason of c.reasons)assert.ok(allowed.includes(reason),reason);
});
