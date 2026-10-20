// 终验 v3：100% 复刻修复后的真实链路
// host-rules + digitalpaper.local:portfwdr端口 + withCredentials + file:// 页面
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

// 与修复后的 main.js 相同
app.commandLine.appendSwitch('host-rules', 'MAP digitalpaper.local 127.0.0.1');

const portfwdr = require(path.join(ROOT, 'node_modules/mw-port-fwdr/portfwdr.js'));
const authctrl = require(path.join(ROOT, 'node_modules/mw-auth-ctrl/authctrl.js'));

app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  event.preventDefault();
  callback(true);
});

app.whenReady().then(() => {
  const fwdr = portfwdr.createPortFwdr();
  fwdr.start('192.168.x.x', 8080, 8443, (err) => {
    if (err) { console.log('PORTFWDR-FAIL', err.code || err.message); app.quit(); return; }
    const httpPort = fwdr.getHttpPort();
    const httpsPort = fwdr.getHttpsPort();
    // 修复后 connctrl 的真实 URL 构造
    const baseHttps = 'https://digitalpaper.local:' + httpsPort;
    const checkUrl = 'http://digitalpaper.local:' + httpPort + '/api_version';
    console.log('PORTS', httpPort, httpsPort, '| base =', baseHttps);

    const win = new BrowserWindow({
      width: 500, height: 300,
      webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false }
    });
    win.webContents.on('console-message', (ev, level, message) => {
      console.log('RENDERER:', message);
    });

    win.loadFile(path.join(__dirname, 'auth-flow-page.html')).then(async () => {
      const run = (code) => win.webContents.executeJavaScript(code).catch(e => { console.log('EXEC-ERR', e.message); return null; });
      try {
        const c = await run("(async () => { try { const r = await xhr('GET', " + JSON.stringify(checkUrl) + "); return r.status + ' ' + r.body.slice(0,40); } catch(e) { return 'ERR ' + e.message; } })()");
        console.log('STEP1-check:', c);

        const req1 = await new Promise((res) => authctrl.genAuthPrepare(baseHttps, (e, r) => res(e ? null : r)));
        const n = await run("(async () => { try { const r = await xhr('GET', " + JSON.stringify(req1.url) + "); return JSON.stringify({status: r.status}); } catch(e) { return JSON.stringify({err: e.message}); } })()");
        console.log('STEP2-nonce:', n);
        const nres = JSON.parse(n);
        if (nres.status !== 200) { console.log('!! nonce 失败'); setTimeout(()=>{fwdr.close();app.quit();},2000); return; }

        const req2 = await new Promise((res) => authctrl.genAuth(baseHttps, 200, nres, (e, r) => res(e ? null : r)));
        // 与 connctrl 完全一致：无 Content-Type（XHR 对 string 默认 text/plain，简单请求无 preflight）
        const a = await run("(async () => { try { const r = await xhr('PUT', " + JSON.stringify(req2.url) + ", " + JSON.stringify(req2.body) + "); return JSON.stringify({status: r.status}); } catch(e) { return JSON.stringify({err: e.message}); } })()");
        console.log('STEP3-putAuth:', a, '(期待 204)');

        const o = await run("(async () => { try { const r = await xhr('GET', " + JSON.stringify(baseHttps + '/system/configs/owner') + "); return r.status + ' ' + r.body.slice(0,80); } catch(e) { return 'ERR ' + e.message; } })()");
        console.log('STEP4-owner:', o, '(期待 200 "lyn")');

        const d = await run("(async () => { try { const r = await xhr('GET', " + JSON.stringify(baseHttps + '/folders') + "); return r.status + ' ' + r.body.slice(0,150); } catch(e) { return 'ERR ' + e.message; } })()");
        console.log('STEP5-folders:', d, '(期待 200)');

        const doc = await run("(async () => { try { const r = await xhr('GET', " + JSON.stringify(baseHttps + '/documents?count=5') + "); return r.status + ' ' + r.body.slice(0,200); } catch(e) { return 'ERR ' + e.message; } })()");
        console.log('STEP6-documents:', doc, '(期待 200 文档列表)');
      } catch (e) {
        console.log('FLOW-ERR', e.message);
      }
      setTimeout(() => { fwdr.close(); app.exit(0); }, 3000);
    });
    // 兜底强退：任何步骤挂起 60s 后强制退出
    setTimeout(() => { console.log('FORCE-EXIT (some step hung)'); try { fwdr.close(); } catch(e){} app.exit(1); }, 60000);
  });
});
