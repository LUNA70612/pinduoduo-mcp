"use strict";
// Copies the project's Pinduoduo OpenCLI adapters (clis/pdd/) into the OpenCLI
// user-clis directory (~/.opencli/clis/pdd), where OpenCLI auto-discovers them.
// Run once after `npm install`.

const fs = require("node:fs");
const path = require("node:path");

const here = __dirname;
const srcDir = path.join(here, "..", "clis", "pdd");
const home = process.env.PDD_OPENCLI_HOME || path.join(here, "..", "runtime", "home");
const destDir = path.join(home, ".opencli", "clis", "pdd");

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!/\.(js|cjs)$/.test(entry.name)) continue;
    fs.copyFileSync(path.join(src, entry.name), path.join(dest, entry.name));
    console.log("  copied", entry.name);
  }
}

try {
  if (!fs.existsSync(srcDir)) {
    console.error("源目录不存在:", srcDir);
    process.exit(1);
  }
  console.log("从", srcDir);
  console.log("复制到", destDir);
  copyDir(srcDir, destDir);
  console.log("完成。运行 `opencli pdd --help` 应列出 pdd 命令。");
} catch (e) {
  console.error("安装适配器失败:", e.message);
  process.exit(1);
}
