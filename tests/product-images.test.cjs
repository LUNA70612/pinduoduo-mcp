'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{parseHTML}=require('linkedom');
const {productMedia}=require('../clis/pdd/_product-media.cjs'),{imageContent}=require('../tools/product-images.cjs');
test('gallery images bind exact product, exclude reviews, strip query and reject foreign images',()=>{
 const {document}=parseHTML('<div class="tLYIg_Ju enable-select">耳机</div><div class="PPuOGFfM"><img class="txzZKbJX" src="https://img.pddpic.com/x.jpg?secret=redacted"><img class="txzZKbJX" src="https://evil.test/y.jpg"></div><section><img src="https://img.pddpic.com/review.jpg"></section>');
 const location=new URL('https://mobile.yangkeduo.com/goods.html?goods_id=123');
 assert.equal(productMedia(document,location,'999').length,0);
 assert.deepEqual(productMedia(document,location,'123').map(x=>x.url),['https://img.pddpic.com/x.jpg']);
});
test('standard MCP image content is bounded and carries attribution, not interpreted facts',async()=>{
 const data={status:'ok',goods_id:'123',_product_media:[{url:'https://img.pddpic.com/x.jpg',goods_id:'123',index:0}]};let options;
 const content=await imageContent(data,{fetchImage:async(url,opts)=>{options=opts;return new Response(Buffer.from([255,216,255,1]),{headers:{'content-type':'image/jpeg'}});}});
 assert.equal(content[1].type,'image');assert.equal(data.product_images[0].claim_type,'merchant_image_not_independent_test');assert.equal(data._product_media,undefined);assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert.equal(data.product_images[0].status,'available');
});
test('invalid, oversized or mismatched images cannot generate image content or fail normal detail',async()=>{
 for(const extra of [{url:'https://evil.test/a'},{goods_id:'999'},{url:'https://img.pddpic.com/a?token=x'}]){const data={status:'ok',goods_id:'123',_product_media:[{url:'https://img.pddpic.com/a',goods_id:'123',...extra}]};const out=await imageContent(data,{fetchImage:()=>{throw Error('must not fetch');}});assert.equal(out.length,0);assert.equal(data.status,'ok');}
 const data={status:'ok',goods_id:'123',_product_media:[{url:'https://img.pddpic.com/a',goods_id:'123'}]};assert.equal((await imageContent(data,{fetchImage:async()=>new Response('not jpeg',{headers:{'content-type':'image/jpeg'}})})).length,0);
 const oversized={status:'ok',goods_id:'123',_product_media:[{url:'https://img.pddpic.com/a',goods_id:'123'}]};assert.equal((await imageContent(oversized,{fetchImage:async()=>new Response(Buffer.alloc(524289),{headers:{'content-type':'image/jpeg'}})})).length,0);
});
test('image option is discoverable and strictly validated through MCP and CLI',()=>{
 const {definition,fromCLI}=require('../clis/pdd/_adapter.cjs'),{normalize}=require('../clis/pdd/_shared.cjs');
 assert.ok(definition('detail').args.some(a=>a.name==='include_product_images'));
 assert.equal(fromCLI('detail',{target:'123',include_product_images:'true'}).include_product_images,true);
 assert.throws(()=>normalize('detail',{goods_id:'123',include_product_images:'true'}),e=>e.code==='INVALID_ARGUMENT');
 assert.equal(require('../tools/pdd.cjs').tools.find(t=>t.name==='pdd_read_item').inputSchema.properties.include_product_images.type,'boolean');
});
