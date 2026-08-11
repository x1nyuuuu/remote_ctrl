# Windows PC2 Agent 安装脚本（管理员 PowerShell）
# 用法: Set-ExecutionPolicy Bypass -Scope Process; .\windows-install-agent.ps1

$InstallDir = "C:\RemoteControl"
$RepoUrl = "https://github.com/x1nyuuuu/remote_ctrl.git"
$Branch = "cursor/remote-control-tool-5731"

Write-Host "==> 创建目录 $InstallDir"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

if (-not (Test-Path "$InstallDir\remote_ctrl")) {
    Write-Host "==> 克隆代码"
    git clone -b $Branch $RepoUrl "$InstallDir\remote_ctrl"
}

$AgentDir = "$InstallDir\remote_ctrl\remote-control\pc2-agent"
Set-Location $AgentDir

Write-Host "==> 安装 Python 依赖"
python -m pip install -r requirements.txt

if (-not (Test-Path "$InstallDir\agent.env")) {
    @"
RC_SERVER=wss://rc.yourdomain.com
RC_TOKEN=在此填入服务器Token
RC_FPS=8
"@ | Out-File -Encoding utf8 "$InstallDir\agent.env"
    Write-Host "[!] 请编辑 $InstallDir\agent.env 填入域名和 Token"
}

# 用任务计划程序实现开机自启 + 崩溃重启
$TaskName = "RemoteControlAgent"
$Python = (Get-Command python).Source
$Action = New-ScheduledTaskAction -Execute $Python -Argument "agent.py" -WorkingDirectory $AgentDir
$Trigger = New-ScheduledTaskTrigger -AtLogon
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal | Out-Null

# 注入环境变量到启动脚本
$StartScript = @"
import os
for line in open(r'$InstallDir\agent.env'):
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, v = line.split('=', 1)
        os.environ[k.strip()] = v.strip()
import runpy
runpy.run_path(r'$AgentDir\agent.py', run_name='__main__')
"@
$StartScript | Out-File -Encoding utf8 "$InstallDir\start-agent.py"

$Action2 = New-ScheduledTaskAction -Execute $Python -Argument "`"$InstallDir\start-agent.py`"" -WorkingDirectory $AgentDir
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -Action $Action2 -Trigger $Trigger -Settings $Settings -Principal $Principal | Out-Null

Write-Host "==> 启动 Agent"
Start-ScheduledTask -TaskName $TaskName

Write-Host ""
Write-Host "============================================"
Write-Host " PC2 Agent 已安装"
Write-Host " 配置: $InstallDir\agent.env"
Write-Host " 任务: 任务计划程序 -> $TaskName"
Write-Host "============================================"
