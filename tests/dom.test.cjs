'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseHTML } = require('linkedom');
function read(html, kind, args = {}, url = 'https://mobile.yangkeduo.com/goods.html?goods_id=123') {
  const { inspectPage } = require('../clis/pdd/_dom.cjs');
  const { document } = parseHTML(`<html><head><title>测试商品</title></head><body>${html}</body></html>`);
  return inspectPage(document, new URL(url), kind, args);
}
test('anonymous homepage navigation labels are not login evidence', () => {
  const s = read('<nav>个人中心 我的订单</nav><div class="user avatar"></div>', 'session');
  assert.equal(s.logged_in, false);
  assert.equal(s.status, 'session_unknown');
});
test('authenticated logout control is positive evidence', () => {
  assert.equal(read('<button>退出登录</button>', 'session').logged_in, true);
});

test('personal server user state must match visible profile before confirming login', () => {
  const { inspectPage } = require('../clis/pdd/_dom.cjs');
  const { document } = parseHTML('<html><body><section class="personal-section"><div class="userInfoBox"><img class="avatar" src="https://avatar3.pddpic.com/test.png"><span class="nickname">测试用户</span></div></section></body></html>');
  const location = new URL('https://mobile.yangkeduo.com/personal.html');
  const store = { isServerRendered: true, isFinishInitLoading: true, userInfo: { uid: '123456', nickname: '测试用户', avatar: 'https://avatar3.pddpic.com/test.png' } };
  document.defaultView.rawData = { stores: { store } };
  assert.equal(inspectPage(document, location, 'session').logged_in, true);
  assert.equal(inspectPage(document, location, 'session').evidence, 'personal_server_profile_matches_dom');
  store.userInfo.uid = '';
  assert.equal(inspectPage(document, location, 'session').logged_in, false);
  store.userInfo.uid = '123456'; store.userInfo.nickname = '不同用户';
  assert.equal(inspectPage(document, location, 'session').logged_in, false);
  store.userInfo.nickname = '测试用户';
  assert.equal(inspectPage(document, new URL('https://mobile.yangkeduo.com/'), 'session').logged_in, false);
  document.defaultView.rawData = undefined;
});

test('real personal profile wrapper and quoted nickname count as login evidence', () => {
  const { inspectPage } = require('../clis/pdd/_dom.cjs');
  const { document } = parseHTML('<html><body><section class="personal-section"><div class="profile-wrapper"><div class="avatar"></div><p class="nickname">“测试用户”</p></div></section></body></html>');
  document.defaultView.rawData = { stores: { store: { isServerRendered: true, isFinishInitLoading: true, userInfo: { uid: '123', nickname: '测试用户', avatar: 'https://avatar.test/a.png' } } } };
  const result = inspectPage(document, new URL('https://mobile.yangkeduo.com/personal.html'), 'session');
  assert.equal(result.logged_in, true);
  assert.equal(result.evidence, 'personal_server_profile_matches_dom');
});
test('login wall and captcha are distinguished from session unknown', () => {
  assert.equal(read('<input placeholder="手机号"><button>发送验证码</button>', 'session').status, 'auth_required');
  assert.equal(read('<div>请完成滑块验证</div>', 'session').status, 'verification_required');
});
test('catalog preserves structured card title and flags incomplete visibility', () => {
  const data = read('<article data-goods-card><a href="/goods.html?goods_id=123"><h3>蓝牙耳机</h3><span data-price>¥19.90</span></a></article>', 'catalog', { limit: 1 });
  assert.equal(data.results[0].title, '蓝牙耳机');
  assert.equal(data.results[0].price, '¥19.90');
  assert.equal(data.truncated, true);
});

function realSearchFixture(transform = () => {}) {
  const fs = require('node:fs');
  const path = require('node:path');
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/pdd-search-2026-11-03.json'), 'utf8').replace(/^\uFEFF/, ''));
  const { document } = parseHTML(`<html><body>${fixture.cards.map(c => c.html).join('')}</body></html>`);
  const cards = Array.from(document.querySelectorAll('._3glhOBhU'));
  cards.forEach((element, i) => {
    const goods = structuredClone(fixture.cards[i].goods);
    element.__reactProps$fixture = { children: { props: { goods } } };
    transform(element, goods);
  });
  return require('../clis/pdd/_dom.cjs').inspectPage(document, new URL('https://mobile.yangkeduo.com/search_result.html?search_key=100%E5%85%83%20%E8%80%B3%E6%9C%BA'), 'catalog', { limit: 20 });
}

test('real React search cards bind canonical goods IDs to split DOM coupon prices', () => {
  const result = realSearchFixture();
  assert.equal(result.status, 'ok');
  assert.equal(result.count, 2);
  const oppo = result.results.find(r => r.goods_id === '960369474830');
  assert.match(oppo.title, /OPPO Enco Air4i/);
  assert.equal(oppo.price, '¥71.9');
  assert.equal(oppo.price_basis, 'list_coupon');
  assert.equal(oppo.shop_id, '765098381');
  assert.ok(oppo.tags.includes('正品发票'));
  assert.equal(oppo.title_source, 'bound_component_state');
  assert.equal(result.truncated, true);
});

test('observed split decimal text is removed from price conditions while coupon labels remain',()=>{
 for(const [label,bound,expected] of [['¥ 9 .89','9.89',null],['券后 ¥ 29 .9','29.9','券后'],['¥ 68','68',null]]){
  const result=realSearchFixture((e,g)=>{e.querySelector('._3_U04GgA').textContent=label;g.priceInfo=bound;});
  assert.equal(result.status,'ok');for(const item of result.results){assert.equal(item.price,`¥${bound}`);assert.equal(item.price_conditions,expected);}
 }
});

test('explicit group label on bound search card remains conditional for exclusion',()=>{
 const result=realSearchFixture((element,goods)=>{element.querySelector('._3_U04GgA').textContent='多人团价 ¥ 20';goods.priceInfo='20';});
 assert.equal(result.status,'ok');
 for(const item of result.results){assert.equal(item.price_basis,'list_conditional');assert.equal(item.price_conditions,'多人团价');}
 const filtered=require('../clis/pdd/_comparison.cjs').filterCatalog(result,{exclude_group_purchase:true});
 assert.equal(filtered.status,'empty');assert.equal(filtered.excluded_count,result.results.length);
});

test('React fallback refuses mismatched product links, price evidence, or images', () => {
  assert.equal(realSearchFixture((e, g) => { g.linkURL = 'goods.html?goods_id=999'; }).status, 'unsupported');
  assert.equal(realSearchFixture((e, g) => { g.priceInfo = '0.01'; }).status, 'unsupported');
  assert.equal(realSearchFixture((e, g) => { g.imgUrl = 'https://img.pddpic.com/other.png'; }).status, 'unsupported');
});

test('React fallback needs bound card state and never uses a guessed product ID', () => {
  assert.equal(realSearchFixture(e => { delete e.__reactProps$fixture; }).status, 'unsupported');
  assert.equal(realSearchFixture((e, g) => { g.goodsID = 'abc123'; }).status, 'unsupported');
});

test('real detail separates the present price from a timed coupon offer', () => {
  const fs = require('node:fs');
  const fixture = JSON.parse(fs.readFileSync(require('node:path').join(__dirname, 'fixtures/pdd-detail-2026-11-03.json'), 'utf8').replace(/^\uFEFF/, ''));
  const url = `https://mobile.yangkeduo.com/goods.html?goods_id=${fixture.goods_id}&uin=redacted_fixture`;
  const data = read(fixture.html, 'detail', { goods_id: fixture.goods_id }, url);
  assert.equal(data.status, 'ok');
  assert.match(data.title, /OPPO Enco Air4i/);
  assert.equal(data.price, '¥76.9');
  assert.match(data.coupon_offer, /08:00.*71\.9/);
  assert.equal(data.shop, '本分智能数码专营店');
  assert.equal(data.variant_price_verified, false);
  assert.ok(data.service_claims.includes('7天无理由退货'));
  assert.match(data.product_attributes_text, /型号\s*Enco Air4i/);
  assert.equal(data.url, `https://mobile.yangkeduo.com/goods.html?goods_id=${fixture.goods_id}`);
  assert.equal(read(fixture.html, 'detail', { goods_id: '999' }, url).status, 'target_mismatch');
  assert.equal(read(fixture.html.replace(/class="uPP2olgd"/g, 'class="unknown-price"'), 'detail', { goods_id: fixture.goods_id }, url).status, 'unsupported');
});
test('missing DOM structure is not a normal empty list', () => {
  assert.equal(read('<p>广告与推荐</p>', 'catalog').status, 'unsupported');
  assert.equal(read('<div data-empty>暂无相关商品</div>', 'catalog').status, 'empty');
});

test('observed search busy screen is a service error rather than an empty catalog', () => {
  const result = read('<main><p>系统繁忙</p><p>请稍后再试</p><div>刷新</div></main>', 'catalog');
  assert.equal(result.status, 'service_unavailable');
  assert.equal(result.code, 'SERVICE_UNAVAILABLE');
  assert.equal(result.results, undefined);
});
test('cart keeps two variants of the same goods and reads real controls', () => {
  const html = '<div data-cart-item data-goods-id="123" data-sku-id="red"><h3>衣服</h3><span data-spec>红色 M</span><input type="number" value="2"><input type="checkbox" checked></div><div data-cart-item data-goods-id="123" data-sku-id="blue"><h3>衣服</h3><span data-spec>蓝色 L</span><input type="number" value="1"><input type="checkbox"></div>';
  const data = read(html, 'cart');
  assert.equal(data.items.length, 2);
  assert.equal(data.items[0].qty, 2);
  assert.equal(data.items[0].checked, true);
  assert.equal(data.items[1].checked, false);
  assert.equal(data.truncated, true);
});
test('unbound prices never become invented SKU variants', () => {
  const data = read('<div>¥9.9 ¥19.9 库存99</div>', 'sku', { goods_id: '123' });
  assert.equal(data.status, 'unsupported');
  assert.deepEqual(data.skus, []);
});
test('SKU records preserve explicit variant-to-price relationships', () => {
  const data = read('<div data-sku-id="r" data-specs=\'{"颜色":"红"}\' data-price="19.9" data-stock="3"></div>', 'sku', { goods_id: '123' });
  assert.deepEqual(data.skus[0].specs, { 颜色: '红' });
  assert.equal(data.skus[0].price, '19.9');
  assert.equal(data.skus[0].stock, 3);
});
test('add cart never clicks immediate buy or group buttons', () => {
  const data = read('<button>立即购买</button><button>开团</button>', 'cart_click', { goods_id: '123', spec_selection: {} });
  assert.equal(data.clicked, false);
  assert.equal(data.status, 'unsupported');
});
test('ambiguous cart buttons are refused', () => {
  const data = read('<button>加入购物车</button><button>加入购物车</button>', 'cart_click', { goods_id: '123', spec_selection: {} });
  assert.equal(data.clicked, false);
});
test('wrong or missing chat shop identity blocks sending', () => {
  const data = read('<div data-chat-shop-id="other"><textarea></textarea><button>发送</button></div>', 'chat_send', { shop_id: 'expected', message: '您好' });
  assert.equal(data.sent, false);
  assert.equal(data.status, 'target_mismatch');
});
test('message verification counts only new outgoing bubbles', () => {
  const data = read('<div data-chat-shop-id="s1"><p data-message-direction="outgoing">您好</p></div>', 'chat', { shop_id: 's1' });
  assert.deepEqual(data.messages, ['您好']);
  assert.equal(data.outgoing_count, 1);
});
test('add cart requires a verified quantity control even for quantity one', () => {
  const data = read('<button>加入购物车</button>', 'cart_click', { goods_id: '123', quantity: 1 });
  assert.equal(data.clicked, false);
});
test('hidden ancestor cannot expose a clickable cart button', () => {
  const data = read('<div hidden><input data-buy-quantity type="number" value="1"><button>加入购物车</button></div>', 'cart_click', { goods_id: '123', quantity: 1 });
  assert.equal(data.clicked, false);
});
test('cart reads live quantity and checked properties, not stale HTML attributes', () => {
  const { inspectPage } = require('../clis/pdd/_dom.cjs');
  const { document } = parseHTML('<html><body><div data-cart-item data-goods-id="123"><input type="number" value="1"><input type="checkbox" checked></div></body></html>');
  document.querySelector('input[type="number"]').value = '4';
  document.querySelector('input[type="checkbox"]').checked = false;
  const data = inspectPage(document, new URL('https://mobile.yangkeduo.com/cart.html'), 'cart');
  assert.equal(data.items[0].qty, 4);
  assert.equal(data.items[0].checked, false);
});
test('redirected foreign pages cannot provide login evidence or actions', () => {
  const data = read('<button>退出登录</button>', 'session', {}, 'https://evil.test/');
  assert.equal(data.logged_in, false);
  assert.equal(data.status, 'unsupported');
});
test('mixed checkbox state is unknown rather than unchecked', () => {
  const data = read('<div data-cart-item data-goods-id="123"><div role="checkbox" aria-checked="mixed"></div></div>', 'cart');
  assert.equal(data.items[0].checked, null);
});
test('outgoing message evidence normalizes rendered line breaks consistently', () => {
  const data = read('<div data-chat-shop-id="s1"><p data-message-direction="outgoing">您好\n请问库存</p></div>', 'chat', { shop_id: 's1', message: '您好\n请问库存' });
  assert.equal(data.outgoing_count, 1);
});
