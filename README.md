# Sony Digital Paper App — macOS Apple Silicon 移植（Electron 补丁层）

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

Sony 官方 Digital Paper App（PC 版，1.4.7，Electron/x86）在 Apple Silicon Mac 上依赖 Rosetta 运行；macOS 28 将移除 Rosetta 后该 app 无法再使用。本仓库提供将官方 app 移植到 **原生 arm64 / Electron 44** 所需的**全部补丁与工具**，并附完整逆向分析文档。

> ⚠️ **版权说明**：本仓库**不包含** Sony 的任何专有代码。补丁（patch）文件、脚本、文档为本项目原创，以 Apache 2.0 授权；补丁所修改的目标文件的版权归 Sony 所有，使用者需自行获取官方 app。本项目与 Sony 无关，仅为个人设备互操作与学习用途。

## 移植解决了什么

原版（Electron 10 / Chromium 85）→ Electron 44 / Chromium 152 的兼容性问题，全部根因分析见 [PORT-NOTES.md](PORT-NOTES.md)：

| # | 问题 | 根因 | 修复（patch） |
|---|---|---|---|
| 1 | 能"连接"但所有 API 报 401/40100 | 设备 Set-Cookie 无 SameSite 属性；Chromium 86+ 默认 SameSite=Lax + 第三方 cookie 管控 → 跨站 XHR 不存不带 cookie | 主进程 cookie 中继：`webRequest.onHeadersReceived` 捕获 + `onBeforeSendHeaders` 注入（01） |
| 2 | `digitalpaper.local` 解析到设备 IP，本地端口转发不可达 | mDNS 直连设备而非本地 forwarder | `host-rules MAP digitalpaper.local 127.0.0.1`（01） |
| 3 | `TypeError: nonce must be string` 主进程崩溃 | 渲染层 remote 调用传参类型异常未防御 | genAuth nonce 类型防御（06） |
| 4 | Node ≥17 localhost 解析 ::1 而消费者用 127.0.0.1 | IPv6 优先序变更 | `dns.setDefaultResultOrder('ipv4first')`（01） |
| 5 | `electron.remote` 不存在 | Electron ≥14 移除 remote 模块 | @electron/remote 接入 + `remote-require` 拦截（01 + preload.js） |
| 6 | mdns addon（dns_sd_bindings.node）仅 x86 | 原生模块无 arm64 构建 | 纯 JS bonjour-hap 兼容 shim（files/mdns-shim） |
| 7 | 帮助菜单 null 引用 | `ev.toElement` 非标准属性在新 Chromium 可能 undefined | `ev.toElement \|\| ev.target` 防御（03） |
| 8 | 端口转发只绑 IPv4 loopback | listen 显式 127.0.0.1 | 双栈绑定（08） |

另含：手动打包独立 `.app` 的 `scripts/make-app.sh`（不依赖 electron-builder 联网下载），以及调试用的协议实验脚本 `scripts/labs/`（nonce→签名→PUT /auth 认证链 Node 复现、XHR 行为实验等）。

## 使用步骤

### 1. 获取官方 app 并解包

从 Sony 官网下载 Digital Paper App 1.4.7（macOS 版）并安装，然后：

```bash
npx asar extract "/Applications/Digital Paper App.app/Contents/Resources/app.asar" ~/dpa-src
```

### 2. 应用补丁

```bash
git clone https://github.com/wulin1985/sony-digital-paper-app-macos-electron.git
cd sony-digital-paper-app-macos-electron
./apply-patches.sh ~/dpa-src
```

脚本会：应用 8 个补丁 → 注入 `preload.js` 与 mdns shim → 移除无源码的蓝牙模块 → 替换 `package.json`。

### 3. 安装依赖并运行

```bash
cd ~/dpa-src
npm install
./run.sh            # 或 ./node_modules/.bin/electron .
```

配对密钥无需迁移：app 直接读取 `~/Library/Application Support/Sony Corporation/Digital Paper App/` 下原版生成的配对数据。

### 4.（可选）打包独立 .app

```bash
cp sony-digital-paper-app-macos-electron/scripts/make-app.sh ~/dpa-src/scripts/ 2>/dev/null || mkdir -p ~/dpa-src/scripts && cp sony-digital-paper-app-macos-electron/scripts/make-app.sh ~/dpa-src/scripts/
cd ~/dpa-src && ./scripts/make-app.sh
# 产物: dist-app/Digital Paper App.app（ad-hoc 签名，双击即用）
```

## 目录结构

```
├── apply-patches.sh      # 一键应用（patch + 新文件 + 依赖替换）
├── patches/              # 8 个补丁（按序号应用），每个 hunks 带 [arm64-port] 注释
├── files/
│   ├── preload.js        # 新增：向渲染层暴露 @electron/remote
│   └── mdns-shim/        # 新增：bonjour-hap 兼容层（替换 native mdns addon）
├── scripts/
│   ├── make-app.sh       # 手动组装独立 .app（ditto + PlistBuddy + ad-hoc 签名）
│   └── labs/             # 协议调试实验脚本（Node 直连认证链复现等）
├── package.json          # 移植版依赖声明（Electron 44 / arm64）
├── run.sh                # 启动脚本
└── PORT-NOTES.md         # 完整移植文档：根因分析 / 协议事实 / 踩坑记录
```

## 已验证

- WiFi 场景：连接 DPT-RP1，文档列表/上传/下载/删除全链路可用（真机）
- 认证链 Node 复现 + Electron 全保真复现（OWNER 200）双验证
- 打包 .app 启动冒烟通过
- 详见 [PORT-NOTES.md](PORT-NOTES.md)

## 相关项目

- [sony-digital-paper-app-macos-swift](https://github.com/wulin1985/sony-digital-paper-app-macos-swift) — 纯 Swift 原生重写版（无 Sony 代码，长期路线）

## License

本仓库原创内容（补丁、脚本、文档）以 [Apache License 2.0](LICENSE) 授权，可商用。补丁目标文件的版权归 Sony Corporation 所有。
