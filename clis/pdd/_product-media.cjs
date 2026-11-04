'use strict';
// Read only the observed main product gallery, never reviews or account sections.
function productMedia(document,location,goodsId){
 const u=new URL(location.href);
 if(u.origin!=='https://mobile.yangkeduo.com'||u.pathname!=='/goods.html'||u.searchParams.getAll('goods_id').length!==1||u.searchParams.get('goods_id')!==goodsId||document.querySelectorAll('.tLYIg_Ju.enable-select').length!==1)return [];
 const urls=[];
 for(const image of document.querySelectorAll('.PPuOGFfM img.txzZKbJX')){
  try{const source=new URL(image.currentSrc||image.getAttribute('src')||'');
   if(source.protocol!=='https:'||!source.hostname.endsWith('.pddpic.com')||source.username||source.password||source.port)continue;
   // Strip query/fragment; only the public CDN object is requested.
   const url=source.origin+source.pathname;if(!urls.includes(url))urls.push(url);
  }catch{}
  if(urls.length===8)break;
 }
 return urls.map((url,index)=>({url,index,goods_id:goodsId,source:'product_main_gallery',claim_type:'merchant_image_not_independent_test'}));
}
module.exports={productMedia};
