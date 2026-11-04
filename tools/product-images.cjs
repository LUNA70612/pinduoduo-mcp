'use strict';
const {createHash}=require('node:crypto');
async function imageContent(data,{fetchImage=fetch}={}){
 const refs=data._product_media;delete data._product_media;
 const content=[];data.product_images=[];
 if(data.status!=='ok'||!Array.isArray(refs))return content;
 for(const ref of refs.slice(0,8)){
  const info={index:ref.index,goods_id:data.goods_id,source:'product_main_gallery',claim_type:'merchant_image_not_independent_test'};
  try{
   const u=new URL(ref.url);if(ref.goods_id!==data.goods_id||u.protocol!=='https:'||!u.hostname.endsWith('.pddpic.com')||u.username||u.password||u.port||u.search||u.hash)throw Error('untrusted');
   const response=await fetchImage(u.href,{redirect:'error',signal:AbortSignal.timeout(5000),credentials:'omit'});
   const mimeType=(response.headers.get('content-type')||'').split(';')[0];
   if(!response.ok||!['image/jpeg','image/png','image/webp'].includes(mimeType)||Number(response.headers.get('content-length'))>524288)throw Error('unsupported');
   const parts=[];let size=0;
   for await(const bytes of response.body){size+=bytes.length;if(size>524288)throw Error('too large');parts.push(bytes);}
   const buffer=Buffer.concat(parts);
   const valid=mimeType==='image/jpeg'?buffer[0]===255&&buffer[1]===216&&buffer[2]===255:mimeType==='image/png'?buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP';
   if(!valid)throw Error('invalid image');
   info.status='available';info.mime_type=mimeType;info.sha256=createHash('sha256').update(buffer).digest('hex');info.bytes=buffer.length;
   content.push({type:'text',text:JSON.stringify({product_image:info})},{type:'image',mimeType,data:buffer.toString('base64')});
  }catch{info.status='unavailable';}
  data.product_images.push(info);
 }
 return content;
}
module.exports={imageContent};
