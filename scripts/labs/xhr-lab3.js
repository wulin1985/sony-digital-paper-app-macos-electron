// 修复验证：renderer XHR → localhost:portfwdr → 设备 8443
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { app, BrowserWindow } = require('electron');

process.env.MW_PORTFWDR_PORT_HTTP_FIRST = '58080';
process.env.MW_PORTFWDR_PORT_HTTP_LAST = '65535';
process.env.MW_PORTFWDR_PORT_HTTPS_FIRST = '58443';
process.env.MW_PORTFWDR_PORT_HTTPS_LAST = '65535';
process.env.MW_PORTFWDR_CONNECT_TIMEOUT = '3000';

const portfwdr = require(path.join(ROOT, 'node_modules/mw-port-fwdr/portfwdr.js'));

// 与真实 app main.js:60 相同的证书处理
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
    console.log('PORTS', httpPort, httpsPort);

    const win = new BrowserWindow({
      width: 400, height: 200,
      webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false }
    });

    const js = [
      "function tryXhr(url, label) {",
      "  return new Promise(resolve => {",
      "    const x = new XMLHttpRequest();",
      "    x.timeout = 15000;",
      "    x.open('GET', url, true);",
      "    x.onload = () => resolve(label + ' onload status=' + x.status + ' body=' + (x.responseText||'').slice(0,100));",
      "    x.onerror = () => resolve(label + ' onerror status=' + x.status);",
      "    x.ontimeout = () => resolve(label + ' ontimeout');",
      "    x.send();",
      "  });",
      "}",
      "(async () => {",
      "  const out = [];",
      "  out.push(await tryXhr('http://localhost:" + httpPort + "/api_version', '[1 check http]'));",
      "  out.push(await tryXhr('https://localhost:" + httpsPort + "/ping', '[2 https ping]'));",
      "  console.log('RESULTS');",
      "  out.forEach(l => console.log(l));",
      "})();"
    ].join('\n');

    const html = '<html><body><script>' + js + '</script></body></html>';
    win.webContents.on('console-message', (e, level, message) => {
      console.log('RENDERER:', message);
    });
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    setTimeout(() => { fwdr.close(); app.quit(); }, 40000);
  });
});
