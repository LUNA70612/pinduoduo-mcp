'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
function browser(pages) {
  let url = '';
  let document;
  let clicks = 0;
  return {
    goto: async u => { url = u; document = parseHTML(`<html><body>${pages(u)}</body></html>`).document; document.readyState = 'complete'; for (const b of document.querySelectorAll('button')) b.addEventListener('click', () => { clicks++; }); },
    evaluate: async js => vm.runInNewContext(js, { document, location: new URL(url), URL, Event: document.defaultView.Event }),
    clicks: () => clicks,
  };
}
test('write workflow refuses cart mutation when baseline is incomplete', async () => {
  const { perform } = require('../clis/pdd/_adapter.cjs');
  const page = browser(() => '<button>加入购物车</button>');
  const data = await perform('add_cart', page, { goods_id: '123', quantity: 1 }, { settle: false });
  assert.equal(data.status, 'unsupported');
  assert.equal(page.clicks(), 0);
});
test('customer send refuses another merchant before send', async () => {
  const { perform } = require('../clis/pdd/_adapter.cjs');
  const page = browser(() => '<h1 data-goods-title>商品</h1><span data-main-price>¥10</span><div data-shop-id="wrong"></div><button>联系客服</button>');
  const data = await perform('contact_seller', page, { goods_id: '123', mode: 'send', shop_id: 'expected', message: '您好' }, { settle: false });
  assert.equal(data.status, 'target_mismatch');
  assert.equal(page.clicks(), 0);
});
test('direct CLI write defaults to confirmation without touching page', async () => {
  const { execute } = require('../clis/pdd/_adapter.cjs');
  const page = { goto() { throw Error('must not navigate'); } };
  const data = await execute('add_cart', page, { goods_id: '123' });
  assert.equal(data.status, 'awaiting_confirmation');
});
test('successful add verifies the exact sku quantity delta in cart', async () => {
  const { perform } = require('../clis/pdd/_adapter.cjs');
  let added = false;
  const page = browser(url => {
    if (url.includes('cart.html')) return added ? '<div data-cart-item data-goods-id="123" data-sku-id="red"><h3>衣服</h3><span data-spec>红</span><input type="number" value="1"></div><div data-end-of-list="true"></div>' : '<div data-empty>购物车空空</div>';
    return '<h1 data-goods-title>衣服</h1><span data-main-price>¥10</span><div data-sku-complete="true"></div><div data-sku-id="red" data-specs=\'{"颜色":"红"}\' data-price="10" data-stock="3"></div><div role="dialog" data-goods-id="123"><div data-spec-group="颜色"><button data-spec-value="红" data-selected="true">红</button></div></div><input data-buy-quantity type="number" value="1"><button id="add">加入购物车</button>';
  });
  const original = page.evaluate;
  page.evaluate = async js => { const result = await original(js); if (result?.clicked) added = true; return result; };
  const data = await perform('add_cart', page, { goods_id: '123', quantity: 1, spec_selection: { 颜色: '红' } }, { settle: false });
  assert.equal(data.status, 'add_cart_confirmed');
  assert.equal(data.sku_id, 'red');
});
test('unverified send result never becomes success merely from matching body text', async () => {
  const { perform } = require('../clis/pdd/_adapter.cjs');
  const page = browser(() => '<h1 data-goods-title>商品</h1><span data-main-price>¥10</span><div data-shop-id="s1"></div><button>联系客服</button><div data-chat-shop-id="s1"><textarea></textarea><button>发送</button><p>您好</p><p data-message-direction="outgoing">您好</p></div>');
  const data = await perform('contact_seller', page, { goods_id: '123', mode: 'send', shop_id: 's1', message: '您好' }, { settle: false });
  assert.equal(data.status, 'result_unknown');
  assert.equal(page.clicks(), 2);
});
test('confirmed send requires a newly appended outgoing bubble', async () => {
  const { perform } = require('../clis/pdd/_adapter.cjs');
  const page = browser(() => '<h1 data-goods-title>商品</h1><span data-main-price>¥10</span><div data-shop-id="s1"></div><button>联系客服</button><div data-chat-shop-id="s1"><div contenteditable="true"></div><button>发送</button></div>');
  const evaluate = page.evaluate;
  page.evaluate = async js => {
    const result = await evaluate(js);
    if (result?.sent) await evaluate(`(()=>{const p=document.createElement('p');p.setAttribute('data-message-direction','outgoing');p.textContent='您好';document.querySelector('[data-chat-shop-id]').appendChild(p);return true})()`);
    return result;
  };
  const data = await perform('contact_seller', page, { goods_id: '123', mode: 'send', shop_id: 's1', message: '您好' }, { settle: false });
  assert.equal(data.status, 'sent_confirmed');
});
