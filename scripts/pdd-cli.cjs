'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const entry = path.join(__dirname, '..', 'node_modules', '@jackwener', 'opencli', 'dist', 'src', 'main.js');
async function main() {
  let env = require('../tools/client-core.cjs').childEnv();
  const args = process.argv.slice(2), kind = args[1];
  if (args[0] === 'pdd' && ['search','detail','read_sku','browse_home','read_cart','resume','auth','add_cart','contact_seller'].includes(kind) && !args.includes('--help') && !args.includes('-h')) {
    const goods_id = ['detail','read_sku','add_cart','contact_seller'].includes(kind) ? require('../clis/pdd/_shared.cjs').goodsId(args[2]) : undefined;
    env = await require('../tools/target-selection.cjs').operationEnv(kind,{goods_id,query:args[2]},env);
  }
  const r = spawnSync(process.execPath, [entry, ...args], { stdio: 'inherit', env, timeout: 210000, cwd: path.join(__dirname, '..'), windowsHide: true });
  if (r.error) process.stderr.write(r.error.message + '\n');
  process.exitCode = r.status == null ? 1 : r.status;
}
main().catch(error => { process.stderr.write(error.message+'\n'); process.exitCode=1; });
