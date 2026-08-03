# 本机工具链（winget）

记录为本仓库在 Windows 本机安装的开发工具，以及如何卸载。  
**VPS、域名不在本机安装范围内**（上云时再配）。

| 工具 | winget Id | 约版本 | 用途 |
|------|-----------|--------|------|
| Go | `GoLang.Go` | 1.26.x | 本地编译/运行 `relay/` |
| .NET SDK 8 | `Microsoft.DotNet.SDK.8` | 8.0.423 | 编译/运行 `agent/` |
| Docker Desktop | `Docker.DockerDesktop` | （已装或计划装） | `deploy/` 下一键起 relay + coturn |

Node.js 用于 `web/`，不在本次 winget 清单内。

---

## 安装

### 本机安装状态（2026-07-30）

| 工具 | 状态 | 说明 |
|------|------|------|
| Go 1.26.5 | 可用 | `winget` 从 go.dev 下载失败（`InternetOpenUrl` / `0x80072efd`、`0x80072ee2`）；改从 `https://golang.google.cn/dl/go1.26.5.windows-amd64.msi` 静默安装成功 |
| .NET SDK 8.0.423 | 可用 | `winget` 安装成功 |
| Docker Desktop | 已装 (4.84.0) | `winget` 安装成功；CLI 可用，引擎需启动 Docker Desktop（当前 daemon 未连上） |

在 **管理员或普通 PowerShell** 中执行（与实际使用一致）：

```powershell
winget install --id GoLang.Go -e --accept-package-agreements --accept-source-agreements
winget install --id Microsoft.DotNet.SDK.8 -e --accept-package-agreements --accept-source-agreements
winget install --id Docker.DockerDesktop -e --accept-package-agreements --accept-source-agreements
```

安装后**新开一个终端**，再验证：

```powershell
go version
dotnet --list-sdks
docker version
```

### 常见安装路径

| 工具 | 路径（简述） |
|------|----------------|
| Go | `C:\Program Files\Go\`（`bin` 需在 PATH） |
| .NET SDK | `C:\Program Files\dotnet\` |
| Docker Desktop | `C:\Program Files\Docker\Docker\` |

---

## 卸载

```powershell
winget uninstall --id GoLang.Go
winget uninstall --id Microsoft.DotNet.SDK.8
winget uninstall --id Docker.DockerDesktop
```

### 卸载后注意

- **新开终端**：旧会话里的 PATH / 命令可能仍可用或仍报错，以新窗口为准。
- **PATH 残留**：个别机器卸载后用户/系统 PATH 仍留有旧目录；可在「环境变量」里手动删掉无效项。
- **Docker**：先退出托盘图标（Quit Docker Desktop），必要时重启后再卸载；WSL/虚拟机相关组件若提示残留，按卸载向导处理。
- 卸载不影响仓库代码；需要时重新执行上方安装命令即可。
