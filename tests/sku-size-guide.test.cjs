'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{parseHTML}=require('linkedom');
const fixture=require('./fixtures/pdd-clothing-size-guide-2026-11-04.json');
const {inspectPage}=require('../clis/pdd/_dom.cjs');
function scene(){const f=structuredClone(fixture),{document}=parseHTML('<html><body>'+f.html+'</body></html>');document.querySelector('[role=dialog]').__reactFiber$fixture={return:{memoizedProps:{goods:f.goods},stateNode:{state:f.state}}};return{f,document,read:()=>inspectPage(document,new URL('https://mobile.yangkeduo.com/goods.html?goods_id='+f.goods_id),'sku',{goods_id:f.goods_id,spec_selection:f.state.currentSelect})};}
test('observed size-guide control is not part of exact specification group name',()=>{const s=scene(),r=s.read();assert.equal(r.status,'ok');assert.deepEqual(r.spec_groups.map(g=>g.label),['颜色分类','尺码']);assert.equal(r.skus.find(v=>v.variant_price_verified).price,'5.89');});
test('size-guide extraction never removes arbitrary heading suffixes',()=>{const s=scene();s.document.querySelector('.oecDTzM9').textContent='另一个规格';const r=s.read();assert.equal(r.status,'unsupported');assert.ok(!r.skus.some(v=>v.variant_price_verified));});
test('size-guide extraction does not weaken product identity checks',()=>{const s=scene();s.f.goods.goodsID='999';const r=s.read();assert.equal(r.diagnostic,'bound_sku_state_mismatch');});
