param([switch]$SkipInstall)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $Root

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw '未找到 Node.js。请安装 Node.js 22 或更高版本后重试。' }
$major = [int]((node --version).TrimStart('v').Split('.')[0])
if ($major -lt 22) { throw "需要 Node.js >= 22，当前为 $major。" }

function Invoke-ProjectNpm {
    param([string[]]$NpmArgs)
    & npm.cmd @NpmArgs
    if ($LASTEXITCODE -ne 0) { throw "npm $($NpmArgs -join ' ') 失败，退出码：$LASTEXITCODE" }
}
Write-Host '非商业软件，非官方 API。安装锁定依赖并初始化项目运行目录...'
if ($SkipInstall) { Invoke-ProjectNpm -NpmArgs @('run', 'setup', '--', '--skip-install') }
else { Invoke-ProjectNpm -NpmArgs @('run', 'setup') }
Write-Host '执行本地协议与代码检查...'
Invoke-ProjectNpm -NpmArgs @('run', 'doctor')
Invoke-ProjectNpm -NpmArgs @('run', 'check')
Invoke-ProjectNpm -NpmArgs @('run', 'smoke')
Write-Host ''
Write-Host '安装完成。下一步：'
Write-Host '1. npm.cmd run browser'
Write-Host '2. 在隔离浏览器中人工扫码登录拼多多'
Write-Host '3. 将 outputs/mcp-config.generated.json 的 pinduoduo 配置复制到 MCP 客户端'
Write-Host '4. npm.cmd run bind-browser（浏览器启动后检查连接）'
