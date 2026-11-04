'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseHTML}=require('linkedom');
const {inspectPage}=require('../clis/pdd/_dom.cjs');
const proof=require('./fixtures/pdd-first-item-price-2026-11-04.json');
function read(label){const {document}=parseHTML('<html><body><h1 class="tLYIg_Ju enable-select"></h1><span class="uPP2olgd"></span></body></html>');document.querySelector('h1').textContent=proof.title;document.querySelector('span').textContent=label;return inspectPage(document,{href:'https://mobile.yangkeduo.com/goods.html?goods_id='+proof.goods_id},'detail',{goods_id:proof.goods_id});}
test('observed first-item display price remains conditional and not a verified SKU',()=>{const r=read(proof.detail_prices[0]);assert.equal(r.status,'ok');assert.equal(r.price,'¥8.99');assert.equal(r.price_basis,'detail_conditional');assert.equal(r.offer_conditions,'首件');assert.equal(r.variant_price_verified,false);assert.equal(r.offer_eligibility_verified,false);});
test('unobserved price prefixes and multiple amounts stay unsupported',()=>{for(const label of ['神秘价¥8.99','首件¥8.99 ¥27.99','首件¥?'])assert.equal(read(label).status,'unsupported');});
