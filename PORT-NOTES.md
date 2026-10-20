# Digital Paper App — Apple Silicon (arm64) 移植说明

移植基线：Sony Digital Paper App 1.4.7.01202（Electron 10.2.0 / Chromium 85, x86_64）→ **Electron 44.9.0 arm64**

## 状态（2026-10-19）

| 项目 | 状态 |
|---|---|
| 依赖树重建（npm 隔离安装+合并） | ✅ |
| 6 个 Sony 原生 addon arm64 重编 | ✅ usb_detector / usb_device_finder / usb_ethernet_finder / crypto_utils / proxy_resolver / serialport |
| sqlite3 替换（@vscode/sqlite3 → 官方 sqlite3 6.0.1, N-API） | ✅ |
| mdns 替换（dns_sd native → bonjour-hap 纯 JS 兼容层） | ✅ |
| electron.remote 兼容（@electron/remote + preload 注入） | ✅ |
| 主窗口/Explorer UI/软件更新检查/打印队列 冒烟 | ✅ 通过 |
| **WiFi 发现链路端到端（真机 DPT-RP1 @192.168.x.x）** | ✅ getDeviceList 返回完整设备（model/serial/sku/IP） |
| **WiFi 连接认证链路（renderer XHR → portfwdr → 8443）** | ✅ 2026-10-19 深夜修复 digitalpaper.local 解析问题，xhr-lab3 验证通过 |
| WiFi 真实 app 全功能操作（文档列表/传输/删除等） | ⏳ 待用户重启 app 验证 |
| USB 真机通道验证 | ⏳ 待换数据线（当前线材无法数据传输，设备从未被系统枚举） |
| electron-builder 打包 .app | ⏳ 待做 |

## 2026-10-19 晚间补丁（真机联调发现）

1. **main.js：`dns.setDefaultResultOrder('ipv4first')`**——Node 17+ 的 localhost 解析按 OS 顺序（macOS 优先 ::1），mw-port-fwdr 的本地转发监听 `localhost` 绑到 ::1，而 checker 的 HTTP 请求强制 `family:4`（127.0.0.1），导致 ECONNREFUSED、设备发现卡在 "fail: serialnumber"。原版 Electron 10（Node 12）为 IPv4 优先故无此问题。一行修复全链路通。
2. **mdns shim：`inferNetworkInterface()`**——bonjour-hap 的 service 对象没有 `networkInterface` 字段（原版 node_mdns 有），Sony discovery_proxy 依赖它推导 localIp，为空时 register() 直接丢弃设备（"localIp == empty: drop"）。已按"服务地址同 /24 网段匹配本机接口"推断兜底。
3. **mw-port-fwdr：TIME_OUT NaN 兜底**——`Number(undefined)`=NaN，新 Node 的 `setTimeout(NaN)` 抛 RangeError（旧 Node 静默当 0）。已加 `|| 3000` 默认值。

## 2026-10-19 深夜补丁（"能连接点啥都报错"根因修复）

**根因**：所有 Web API XHR 的 URL 是 `https://digitalpaper.local:<portfwdr本地端口>`。Electron 44 (Chromium) 把 `.local` 域名交给系统解析 → mDNS 返回**设备 IP**（192.168.x.x）→ 请求打到设备上不存在的本地端口（58443+）→ 全部 onerror。portfwdr 实际只监听 Mac 本机。因此连接后的每个操作都失败；"能连接"只是发现层（mDNS 设备列表）的状态展示。原版 Electron 10 时代此架构同样存疑，但已无从考证（不影响修复，见下）。

**排查手段**（可复用）：
- `scripts/auth-test.js`：Node 直连设备 8443 完整认证链（nonce→RSA-SHA256 签名→PUT /auth），验证密钥/路径/crypto 兼容性 → **204 通过**（密钥三件套、workspaceId、Node 24 crypto 全部正常）
- `scripts/xhr-lab*.js`：主进程起 portfwdr + renderer 发真实 XHR，配合 `--log-net-log` 抓 Chromium 解析行为 → 实锤 `.local` 解析到设备 IP
- 认证链真相：非 DH，而是 RSA nonce 签名（`authctrl.genAuth` → `authadpt.signNonce` RSA-SHA256 → btoa → PUT /auth 期望 204）；DH/wrap/unwrap 属于设备初始化注册（InitSetup）流程

**修复**（2 文件）：
1. **mw-conn-ctrl/connctrl.js**：`WEBAPI_BASE_URL`/`WEBAPI_CHECK_BASE_URL` 从 `digitalpaper.local` 改为 `localhost`。设备不校验 Host 头（IP 直连 204 已证实）；证书错误由 main.js 的 certificate-error handler 放行。XHR 经 localhost → portfwdr → 设备 8443 全链路打通。
2. **mw-port-fwdr/portfwdr.js**：`listen(fromPort, 'localhost')` → `listen(fromPort)`（双栈 ::+IPv4-mapped），消除 Node 17+ localhost→::1 单栈与 Chromium 解析顺序的竞态；3 处 listen 统一。

**验证**（xhr-lab3，含 certificate-error handler）：
- `http://localhost:58080/api_version` → **200** `{"value":"1.6"}`
- `https://localhost:58443/ping` → **401** `{"error_code":"40100"}`（未认证状态的预期响应，证明 TLS/证书/转发全通）

**附带发现**：shell 的 `https_proxy=127.0.0.1:50283`（沙箱代理）会污染 curl/Node 实验结果——测连通性必须 `env -u https_proxy -u http_proxy`；GUI app 不受影响（系统代理关闭）。

## 2026-10-19 深夜二段：会话 cookie 机制（"点啥都报错"真正根因）

**用户错误码破译**（`mw-error/bin/mwerrorcode` 可解码）：
- `2F-1140-9CA4` = mwCode#47 E_MW_AUTH_FAILED + **GET `/system/configs/owner`** + HTTP 401 + 设备码 40100 —— 0x9CA4=40100
- `15-0000-0000` = mwCode#21 E_MW_FATAL_ERROR（无 mwCode 的裸异常）
- 证明：auth 成功（能连接是真的），**后续 API 全部 401**

**设备会话机制**（直连实测）：
- `PUT /auth` 204 → `Set-Cookie: Credentials=...; Path=/; Domain=digitalpaper.local; Secure`
- 后续请求带该 cookie → 200（owner 返回 "lyn"）；不带 → 401 40100
- 设备 CORS：`Access-Control-Allow-Origin: null` + `Access-Control-Allow-Credentials: true`（专为 file:// 页面跨源带凭据设计）

**根因**：file:// 渲染页的 XHR 到 `https://digitalpaper.local:<port>` 是跨源请求，XHR 默认 `withCredentials=false` → 不存/不回带 Credentials cookie → 认证后所有 API 401。**原版 Electron 10 代码同样没设 withCredentials**（全代码库无此设置，谜团未解，但不影响修复）。

**修复**（4 处，均带 [arm64-port] 注释）：
1. **connctrl.js**：撤销 localhost 改动恢复 `digitalpaper.local`（cookie Domain 匹配必需）+ 4 个 XHR（check/nonce/PUT/ping）加 `withCredentials = true`
2. **main.js**：`app.commandLine.appendSwitch('host-rules', 'MAP digitalpaper.local 127.0.0.1')` —— Chromium 网络层把域名映射到 127.0.0.1，XHR → 本机 portfwdr（58443）→ 设备 8443；URL host 不变，cookie domain 匹配成立。discovery 层走主进程 Node http（checker.js pfAccess，family:4），不受影响
3. **DeviceModel.js** ×2 + **ImageCaptor/ScreenshotTaker** ×2：XHR 加 withCredentials（app/scripts 层）
4. portfwdr 双栈监听（前一段已改）保留

**验证状态**（设备待机前）：
- STEP1 check（http://digitalpaper.local:58080 → host-rules → portfwdr → 设备 8080）= 200 ✓
- STEP2 nonce（https://digitalpaper.local:58443 → portfwdr → 8443）= 200 ✓（含证书放行）
- STEP3 PUT → 设备中途休眠，未跑完（auth-test 复跑也 ECONNRESET，ping 100% 丢包——设备 WiFi 随待机断开）
- 直连链路上 PUT 204 + cookie + owner 200 "lyn" 已单独验证 ✓
- **待设备唤醒后重跑 `scripts/auth-flow-lab.js` 确认 STEP3-6**

**注意**：设备休眠后 WiFi 断开属正常（timeout_to_standby），唤醒后恢复。深夜多次认证测试后设备离线也可能是休眠到了。

**最终根因（SameSite）**：设备 Set-Cookie 无 SameSite 属性 → Chromium 86+ 默认 SameSite=Lax + 第三方 cookie 管控 → file:// 跨站 XHR 既不存也不带 Credentials cookie → 401。**原版 Electron 10 = Chromium 85，SameSite-by-default 尚未生效，所以原版能带 cookie**——"原版能用移植版不行"之谜的完整答案。补 SameSite=None 实测仍不够（第三方 cookie 管控拦截），最终采用**主进程 cookie 中继**：

**最终修复**（在前面 4 处基础上追加）：
5. **main.js**：`app.on('ready')` 注册 webRequest 双向拦截——`onHeadersReceived` 捕获设备响应的 Set-Cookie（**键名大小写不敏感匹配**，Electron 44 实测返回 `Set-Cookie` 首字母大写，用小写读不到——踩坑）；`onBeforeSendHeaders` 给所有 digitalpaper.local 请求注入 `Cookie` 头。cookie 由主进程变量维护，app 重启后走 connctrl 既有 re-auth 流程自动恢复
6. **authctrl.js**：genAuth 对 nonce 非字符串加防御回调 E_MW_AUTH_FAILED（原代码 signNonce 同步 throw → 主进程未捕获异常 → app 崩溃，即用户遇到的 `TypeError: nonce must be string` / 15-0000-0000）

**终验结果**（scripts/auth-fidelity-lab.js，与真实 app 完全同构：@electron/remote + remote.require('mw-auth-ctrl') 主进程执行 + responseType=json + withCredentials + connctrl 同款无 Content-Type PUT）：
```
NONCE 200 ✓ → PUT /auth 204 ✓ → COOKIE-CAPTURED ✓ → GET owner COOKIE-INJECT ✓ → 200 {"value":"lyn"}
```
**认证+会话+业务 API 全链路打通**。待用户重启 app 实测 Explorer 文档列表/传输。

## 全部代码改动（相对 asar 原始解包）

1. **package.json**：重写（Electron 44.9.0、@electron/remote 2.1.3、bonjour-hap 3.10.5、sqlite3 6.0.1；mw-* 树 vendored 不走 npm）
2. **main.js**（5 处，全部带 `[arm64-port]` 注释标记）：
   - 顶部：`@electron/remote/main` initialize + `web-contents-created` 全窗口 enable
   - 顶部：`remote-require` 事件拦截（`Module.createRequire` 锚定 main.js 解析——Electron ≥28 的 `require.main.paths` 为 undefined，@electron/remote 默认 walk 会断到 electron 内部模块）
   - 两处 BrowserWindow webPreferences：`sandbox: false` + `preload: preload.js`
   - `profileManagerExists`：tiny-ps 枚举失败时降级为"未运行"继续启动（原版直接 app.quit()）
3. **preload.js**（新增）：renderer 的 `electron.remote` 属性注入
4. **node_modules/mw-discovery-ctrl/node_modules/mdns**（重写）：bonjour-hap 兼容层，暴露 `tcp()/createBrowser()/serviceUp/start/stop`
5. **binding.gyp × 5**：`CLANG_CXX_LANGUAGE_STANDARD=c++20`（Electron 44 V8 头要求）+ `MACOSX_DEPLOYMENT_TARGET=11.0`（arm64 下限）
6. **usb-detector-mw/src/usb_detector.cc**：`node::AtExit` 新签名不兼容，退出钩子移除（仅做停止检测清理，非关键）
7. **删除**：bt-pairing-mw / bt-pan-mw（无源码的孤立二进制；mac 版蓝牙 PAN 在原版即为空实现 `isAvailable()=false`，行为一致）

## 重编 addon（如需重跑）

```bash
cd node_modules/<模块>
PATH="$(pwd)/../../.bin:$PATH" HOME=/tmp node-gyp rebuild \
  --arch=arm64 --target=44.9.0 --dist-url=https://electronjs.org/headers
```

## 已知事项

- **ELECTRON_RUN_AS_NODE=1** 在 WorkBuddy 环境默认存在，启动前必须 unset（run.sh 已处理）
- **--no-sandbox --disable-gpu** 仅 WorkBuddy 嵌套沙箱需要；Terminal 正常启动不需要
- WorkBuddy 沙箱内 `ps` 被拒（tiny-ps 会告警并降级，不影响使用）；真机无此问题
- ExplorerToolbarView.js:557 无设备状态下有一处 null 引用（待真机验证时确认是否原版固有）
- 蓝牙通道：原版 mac 即未实现，本 port 维持一致；如未来需要，可基于 IOBluetooth 新写

## 真机验证清单（接 DPT-RP1/CP1 后）

1. USB 插入 → CDC-ACM 串口出现 → 自动发 10 字节切换命令 → 设备重枚举为 USB 网卡 → mDNS 发现
2. WiFi：设备与 Mac 同网段 → `_digitalpaper._tcp` 发现 → digitalpaper.local:8443 连通
3. 文档列表加载 / PDF 拖入上传 / 下载到本地
4. 固件升级预检（/system/controls/update_firmware/precheck）
5. 配对密钥：沿用原 app 数据目录（未改动路径），如异常可用备份恢复：
   `dpa-analysis/backup-appdata-20261019/DigitalPaperApp/<workspace-id>/`

## 打包（已完成 2026-10-20：手动组装 .app，替代 electron-builder）

electron-builder 需联网拉取构建依赖，沙箱内不可靠。改用 `scripts/make-app.sh` 手动组装：

```bash
./scripts/make-app.sh
# 产物：dist-app/Digital Paper App.app（391M，ad-hoc 签名校验通过）
```

- 原理：复制 `node_modules/electron/dist/Electron.app` 骨架 → 主程序改名 `DigitalPaperApp` →
  PlistBuddy 改写 Info.plist（bundle id `com.sony.digitalpaperapp.arm64`，与已装原版区分；
  补 NSLocalNetworkUsageDescription + NSBonjourServices `_digitalpaper._tcp`，macOS 14+ mDNS 需要）→
  注入 `Resources/app`（项目代码 + node_modules，排除 electron dev 包 310M / .bin）→ ad-hoc 签名。
- 踩坑：
  1. electron dist 带 `com.apple.provenance` xattr，`cp -R` 报 Operation not permitted，必须用 `ditto`；
  2. 脚本内 `$VAR中文省略号` 会被 bash 当变量名一部分，须写 `${VAR}`；
  3. 沙箱内启动测试须 `env -u ELECTRON_RUN_AS_NODE` + `--no-sandbox --disable-gpu`（同 run.sh），
     否则二进制以纯 Node 模式静默退出（exit 0），极易误判为打包失败。
- 启动冒烟：15s 存活 ✅（日志仅沙箱 `ps` 受限噪音，代码已有降级防御）；Finder 直接双击启动无需任何参数。
- ExplorerToolbarView.js:557 `ev.toElement`（非标准属性，新版 Chromium 可能 undefined → null 引用）：
  两处（397/557）均已加 `ev.toElement || ev.target` 防御（[arm64-port]）。
