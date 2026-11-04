'use strict';
// Select an existing page; never create targets or change the saved binding.
function selectPage(targets, kind, input = {}) {
  const pages = targets.filter(t => { try { const u = new URL(t.url); return t.type === 'page' && u.origin === 'https://mobile.yangkeduo.com' && t.webSocketDebuggerUrl; } catch { return false; } });
  const score = t => {
    const u = new URL(t.url);
    if (['detail','read_sku','add_cart','contact_seller'].includes(kind)) return u.pathname === '/goods.html' && u.searchParams.getAll('goods_id').length === 1 && u.searchParams.get('goods_id') === input.goods_id ? 100 : u.pathname === '/search_result.html' ? 30 : u.pathname === '/goods.html' ? 20 : -10;
    if (kind === 'search') return u.pathname === '/search_result.html' ? (u.searchParams.get('search_key') === input.query ? 100 : 30) : -10;
    if (kind === 'auth') return u.pathname === '/login.html' ? 100 : -10;
    if (kind === 'resume') return u.pathname === '/personal.html' ? 100 : u.pathname === '/login.html' ? -20 : 0;
    if (kind === 'read_cart') return u.pathname === '/cart.html' ? 100 : -10;
    return u.pathname === '/' ? 100 : u.pathname === '/login.html' ? -20 : 0;
  };
  return pages.map((page,index) => ({page,index,score:score(page)})).sort((a,b) => b.score-a.score || a.index-b.index)[0]?.page;
}
async function operationEnv(kind, input, env, fetcher = fetch) {
  try {
    const response = await fetcher(`${env.OPENCLI_CDP_ENDPOINT}/json`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw Error('CDP target list failed');
    const pages = await response.json();
    if (!Array.isArray(pages)) throw Error('invalid targets');
    const selected = input.target_id ? pages.find(t=>t.id===input.target_id&&t.type==='page'&&t.webSocketDebuggerUrl&&new URL(t.url).origin==='https://mobile.yangkeduo.com') : selectPage(pages, kind, input);
    if (!selected) throw Object.assign(Error('当前浏览器没有拼多多页面，请人工打开；不会自动更换浏览器或新建登录环境。'), {code:'BROWSER_TARGET_MISSING'});
    return { ...env, OPENCLI_CDP_TARGET: selected.url, PDD_TARGET_ID:selected.id || '' };
  } catch (error) {
    if (error.code === 'BROWSER_TARGET_MISSING') throw error;
    throw Object.assign(Error('现有 CDP 会话不可连接；请检查当前浏览器，不会自动重建会话。'), {code:'BROWSER_DISCONNECTED'});
  }
}
module.exports = { selectPage, operationEnv };
