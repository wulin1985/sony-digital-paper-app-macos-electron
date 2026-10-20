// 全保真复现 v4：与真实 app 完全一致的调用路径
// renderer: @electron/remote → remote.require('mw-auth-ctrl')（主进程执行）
// XHR: responseType=json + withCredentials（与打补丁后的 connctrl 一致）
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { app, BrowserWindow } = require('electron');

process.env.MW_USER_DATA_DIR_PATH =
  '/Users/wulin/Library/Application Support/Sony Corporation/Digital Paper App/DigitalPaperApp/<workspace-id>';
process.env.MW_PORTFWDR_PORT_HTTP_FIRST = '58080';
process.env.MW_PORTFWDR_PORT_HTTP_LAST = '65535';
process.env.MW_PORTFWDR_PORT_HTTPS_FIRST = '58443';
process.env.MW_PORTFWDR_PORT_HTTPS_LAST = '65535';
process.env.MW_PORTFWDR_CONNECT_TIMEOUT = '3000';

// 与修复后的 main.js 一致
app.commandLine.appendSwitch('host-rules', 'MAP digitalpaper.local 127.0.0.1');

// 主进程捕获未捕获异常（真实 app 会崩，实验里打印后继续）
process.on('uncaughtException', (e) => {
  console.log('UNCAUGHT:', e.message);
  console.log((e.stack || '').split('\n').slice(0, 4).join('\n'));
});

const portfwdr = require(path.join(ROOT, 'node_modules/mw-port-fwdr/portfwdr.js'));

app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  event.preventDefault();
  callback(true);
});

// [arm64-port 方案 C 验证] 绕过浏览器 cookie 管理：
// onHeadersReceived 捕获设备 Set-Cookie → onBeforeSendHeaders 注入 Cookie 头
app.whenReady().then(() => {
  const { session } = require('electron');
  let deviceCookie = null;
  const isDevice = (url) => url.indexOf('digitalpaper.local') >= 0;
  const getSetCookies = (headers) => {
    if (!headers) return null;
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === 'set-cookie') return headers[k];
    }
    return null;
  };
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (isDevice(details.url)) {
      const sc = getSetCookies(details.responseHeaders);
      if (sc) {
        deviceCookie = sc.map(c => c.split(';')[0]).join('; ');
        console.log('COOKIE-CAPTURED on', details.url.slice(0, 60), '→', deviceCookie.slice(0, 40));
      }
    }
    callback({ responseHeaders: details.responseHeaders });
  });
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    if (deviceCookie && isDevice(details.url)) {
      details.requestHeaders['Cookie'] = deviceCookie;
      console.log('COOKIE-INJECT →', details.url.slice(0, 60));
    }
    callback({ requestHeaders: details.requestHeaders });
  });
});

// @electron/remote：与真实 app main.js 相同的初始化
const remoteMain = require(path.join(ROOT, 'node_modules/@electron/remote/main'));
remoteMain.initialize();
const { createRequire } = require('module');
const mainRequire = createRequire(path.join(ROOT, 'main.js'));
app.on('remote-require', function (event, webContents, moduleName) {
  try { event.returnValue = mainRequire(moduleName); }
  catch (e) { console.warn('remote-require failed:', moduleName, e.message); }
});

app.whenReady().then(() => {
  const fwdr = portfwdr.createPortFwdr();
  fwdr.start('192.168.x.x', 8080, 8443, (err) => {
    if (err) { console.log('PORTFWDR-FAIL', err.code || err.message); app.quit(); return; }
    const httpsPort = fwdr.getHttpsPort();
    const base = 'https://digitalpaper.local:' + httpsPort;
    console.log('PORT https=' + httpsPort, '| base =', base);

    const win = new BrowserWindow({
      width: 500, height: 300,
      webPreferences: {
        nodeIntegration: true, contextIsolation: false, sandbox: false,
        preload: path.join(ROOT, 'preload.js')
      }
    });
    remoteMain.enable(win.webContents);
    win.webContents.on('console-message', (ev, level, message) => {
      console.log('RENDERER:', message);
    });

    // renderer 页面：与 connctrl 完全一致的 XHR 参数与 remote 调用
    const js = [
      "const remote = require('electron').remote; // preload 注入",
      "const authctrl = remote.require('mw-auth-ctrl');",
      "const base = " + JSON.stringify(base) + ";",
      "authctrl.genAuthPrepare(base, (err, req1) => {",
      "  if (err) { console.log('prep ERR ' + err.message); return; }",
      "  console.log('prep OK url=' + req1.url);",
      "  const x = new XMLHttpRequest();",
      "  x.timeout = 60000; x.responseType = 'json'; x.withCredentials = true;",
      "  x.open(req1.method, req1.url, true);",
      "  x.onload = () => {",
      "    console.log('NONCE onload status=' + x.status +",
      "      ' responseJSON=' + JSON.stringify(x.response) +",
      "      ' typeofNonce=' + typeof (x.response && x.response.nonce));",
      "    authctrl.genAuth(base, x.status, x.response, (err2, req2) => {",
      "      if (err2) { console.log('genAuth ERR code=' + err2.code + ' msg=' + err2.message); return; }",
      "      console.log('genAuth OK → PUT');",
      "      const x2 = new XMLHttpRequest();",
      "      x2.timeout = 60000; x2.responseType = 'json'; x2.withCredentials = true;",
      "      x2.open(req2.method, req2.url, true);",
      "      x2.onload = () => {",
      "        console.log('PUT onload status=' + x2.status + ' (期待204)');",
      "        const x3 = new XMLHttpRequest();",
      "        x3.timeout = 60000; x3.responseType = 'json'; x3.withCredentials = true;",
      "        x3.open('GET', base + '/system/configs/owner', true);",
      "        x3.onload = () => console.log('OWNER ' + x3.status + ' ' + JSON.stringify(x3.response));",
      "        x3.onerror = () => console.log('OWNER onerror');",
      "        x3.ontimeout = () => console.log('OWNER timeout');",
      "        x3.send();",
      "      };",
      "      x2.onerror = () => console.log('PUT onerror');",
      "      x2.ontimeout = () => console.log('PUT timeout');",
      "      x2.send(JSON.stringify(req2.body));",
      "    });",
      "  };",
      "  x.onerror = () => console.log('NONCE onerror');",
      "  x.ontimeout = () => console.log('NONCE timeout');",
      "  x.send();",
      "});",
      "console.log('renderer-ready');"
    ].join('\n');

    const html = '<html><body><script>' + js + '</script></body></html>';
    const pagePath = '/tmp/dpa-fidelity-page.html';
    require('fs').writeFileSync(pagePath, html);
    win.loadFile(pagePath).then(() => {
      console.log('page loaded');
    });
    setTimeout(() => { console.log('FORCE-EXIT'); try { fwdr.close(); } catch(e){} app.exit(0); }, 45000);
  });
});
