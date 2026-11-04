'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
// Explicit allowlist: personal state, account data and local evidence never enter releases.
const entries = ['server.cjs', 'package.json', 'package-lock.json', '.npmrc', '.editorconfig', '.gitattributes', '.gitignore', 'Install.ps1', 'mcp-config.example.json', 'README.md', 'USAGE.md', 'AI-INSTALL.md', 'CAPABILITIES.md', 'TESTING.md', 'DEV.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'LICENSE', 'LICENSING.md', 'NOTICE', 'THIRD-PARTY-NOTICES.md', 'tools', 'scripts', 'clis', 'tests', 'third-party', 'http', '.github'];
const localDirectories = new Set(['.git', '.cache', 'node_modules', 'runtime', 'state', 'work', 'outputs', 'logs', 'private', '__pycache__']);
function localArtifact(relative) {
  const parts = relative.replaceAll('\\', '/').split('/');
  const name = parts.at(-1);
  return parts.some(part => localDirectories.has(part.toLowerCase())) ||
    /^(?:\.env(?:\..*)?|mcp-config(?:\.generated)?\.json|codex-mcp\.generated\.toml|browser-config\.json|cookies?(?:-journal)?|login data(?:-journal)?)$/i.test(name) ||
    /\.(?:log|tmp|bak|zip|dpapi|pem|key|pfx|pyc)$/i.test(name) || /\.local\.json$/i.test(name);
}
function copySource(sourceRoot, destination) {
  const manifest = [];
  function copy(relative) {
    const source = path.join(sourceRoot, relative), target = path.join(destination, relative);
    const info = fs.lstatSync(source);
    if (info.isSymbolicLink()) throw Error(`发布源文件不允许符号链接：${relative}`);
    if (localArtifact(relative)) return;
    if (info.isDirectory()) { for (const name of fs.readdirSync(source).sort()) copy(path.join(relative, name)); return; }
    if (!info.isFile()) throw Error(`发布源不是普通文件：${relative}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    manifest.push({ path: relative.replaceAll('\\', '/'), sha256: createHash('sha256').update(fs.readFileSync(target)).digest('hex') });
  }
  for (const relative of entries) copy(relative);
  fs.writeFileSync(path.join(destination, 'MANIFEST.sha256'), manifest.map(item => `${item.sha256}  ${item.path}`).join('\n') + '\n');
  return manifest;
}
function committedSource(files) {
  const git = args => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw Error('源码与提交不一致或无法读取 Git；请先提交交付文件，再重新打包。');
    return result.stdout;
  };
  const commit = git(['rev-parse', 'HEAD']).trim();
  git(['diff', '--quiet', 'HEAD', '--', ...entries]);
  const tracked = git(['ls-tree', '-rz', '--name-only', 'HEAD']).split('\0').filter(Boolean);
  const expected = new Set(tracked.filter(file => entries.includes(file.split('/')[0]) && !localArtifact(file)));
  if (files.length !== expected.size || files.some(file => !expected.delete(file.path)) || expected.size) throw Error('源码清单与提交文件不完整对应，未生成压缩包。');
  return commit;
}
function releaseNotes(report) {
  return '# Windows 只读推荐预览版\n\n非商业软件，非官方 API。以 LICENSE/NOTICE 为准，第三方依赖保留各自许可。\n\n'+
    '使用 Install.ps1 安装，人工扫码登录后接入支持 stdio MCP 的 AI 客户端；无需额外模型 API Key。保留10工具和3推荐模板，写能力默认关闭。\n\n'+
    `发布证据：${report.categories_passed}类读取样本、${report.non_default_goods}个不同商品非默认规格、${report.recommendations_passed}类有条件比较及用户人工核对通过。证据摘要：${report.review_digest}。历史证据按变更影响分析继承，不宣称全部在当前版本重新测试。\n\n`+
    '已支持页面可读取具体规格与参考价；缺安全入口、禁用选项、身份或价格不一致时明确停止。优惠资格、运费、实测性能及营养资料缺失时返回未知，不承诺最终到手价、商品质量或所有页面模板兼容。\n\n'+
    '旧鞋禁用选项、旧家纺缺入口、历史售罄与缺价未覆盖限制保留。首页、购物车和客服不属于本轮搜索推荐验收；豆包及WorkBuddy未实测。\n\n'+
    '固定 OpenCLI 2.0.2，已记录的依赖审计告警未通过强制升级处理，本包不标记稳定版。\n\n源码文件哈希见 MANIFEST.sha256；安装后运行 npm test、npm run check、npm run smoke。个人profile、Cookie、运行证据和私人配置不随包分发。\n';
}
function release() {
  const report=require('../tools/release-gate.cjs').verifyReleaseGate(root);
  const version = require('../package.json').version;
  const name = `pinduoduo-mcp-${version}-windows-readonly-preview-${Date.now()}`;
  const directory = path.join(root, 'outputs', name);
  const files = copySource(root, directory);
  const commit = committedSource(files);
  fs.writeFileSync(path.join(directory, 'RELEASE-NOTES.md'),releaseNotes(report));
  fs.writeFileSync(path.join(directory, 'SOURCE-INFO.json'), JSON.stringify({ source_commit: commit, generated_at: new Date().toISOString(), source_files: files.length, review_digest: report.review_digest, evidence_scope: 'Historical accepted evidence is inherited by change impact; current scoped review is documented separately.', source_worktree_clean: true }, null, 2) + '\n');
  for (const file of ['RELEASE-NOTES.md', 'SOURCE-INFO.json']) {
    const digest = createHash('sha256').update(fs.readFileSync(path.join(directory, file))).digest('hex');
    fs.appendFileSync(path.join(directory, 'MANIFEST.sha256'), `${digest}  ${file}\n`);
  }
  const zip = `${directory}.zip`;
  const escapedDirectory = directory.replaceAll("'", "''"), escapedZip = zip.replaceAll("'", "''");
  // .NET ZIP works without loading .psm1 modules blocked by restricted PS policy.
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${escapedDirectory}', '${escapedZip}', [System.IO.Compression.CompressionLevel]::Optimal, $true)`], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw Error(result.stderr || '压缩源码包失败。');
  console.log(JSON.stringify({ status: 'ok', directory, zip, source_commit: commit, source_files: files.length, generated_files: 2, sha256: createHash('sha256').update(fs.readFileSync(zip)).digest('hex'), note: '非商业软件，非官方 API；只读预览版，未上传或发布到外部平台。' }, null, 2));
}
if (require.main === module) { try { release(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { copySource,releaseNotes };
