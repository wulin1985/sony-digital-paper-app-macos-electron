// 最小 Electron 实验场：主进程起 portfwdr，renderer 发真实 XHR
// 目的：复现 connctrl 的 XHR 到 https://digitalpaper.local:<port> 到底通不通
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { app, BrowserWindow } = require('electron');

// 模拟 main.js 设置的 env（portfwdr 需要）
process.env.MW_PORTFWDR_PORT_HTTP_FIRST = 58080;
process.env.MW_PORTFWDR_PORT_HTTP_LAST = 65535;
process.env.MW_PORTFWDR_PORT_HTTPS_FIRST = 58443;
process.env.MW_PORTFWDR_PORT_HTTPS_LAST = 65535;
process.env.MW_PORTFWDR_CONNECT_TIMEOUT = 3000;

const portfwdr = require(path.join(ROOT, 'node_modules/mw-port-fwdr/portfwdr.js'));

app.whenReady().then(() => {
  const fwdr = portfwdr.createPortFwdr();
  fwdr.start('192.168.x.x', 8080, 8443, (err) => {
    if (err) { console.log('PORTFWDR-FAIL', err.code || err.message); app.quit(); return; }
    const httpPort = fwdr.getHttpPort();
    const httpsPort = fwdr.getHttpsPort();
    console.log('PORTS', httpPort, httpsPort);

    const win = new BrowserWindow({
      width: 500, height: 300,
      webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false }
    });

    const js = [
      "function tryXhr(url, label) {",
      "  return new Promise(resolve => {",
      "    const x = new XMLHttpRequest();",
      "    x.timeout = 6000;",
      "    x.open('GET', url, true);",
      "    x.onload = () => resolve(label + ' onload status=' + x.status + ' body=' + (x.responseText||'').slice(0,80));",
      "    x.onerror = () => resolve(label + ' onerror status=' + x.status);",
      "    x.ontimeout = () => resolve(label + ' ontimeout');",
      "    x.send();",
      "  });",
      "}",
      "(async () => {",
      "  const out = [];",
      "  out.push(await tryXhr('http://digitalpaper.local:" + httpPort + "/api_version', '[check http digitalpaper.local:" + httpPort + "]'));",
      "  out.push(await tryXhr('https://digitalpaper.local:" + httpsPort + "/ping', '[https digitalpaper.local:" + httpsPort + "]'));",
      "  out.push(await tryXhr('https://digitalpaper.local:8443/ping', '[direct digitalpaper.local:8443]'));",
      "  out.push(await tryXhr('http://127.0.0.1:" + httpPort + "/api_version', '[fwdr 127.0.0.1:" + httpPort + "]'));",
      "  out.push(await tryXhr('http://localhost:" + httpPort + "/api_version', '[fwdr localhost:" + httpPort + "]'));",
      "  console.log('RESULTS');",
      "  out.forEach(l => console.log(l));",
      "})();"
    ].join('\n');

    const html = '<html><body><script>' + js + '</script></body></html>';
    win.webContents.on('console-message', (e, level, message) => {
      console.log('RENDERER:', message);
    });
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    setTimeout(() => { fwdr.close(); app.quit(); }, 30000);
  });
});
