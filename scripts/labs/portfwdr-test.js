// 实测 portfwdr 转发链路：digitalpaper.local:<localPort> 是否可达
'use strict';
const path = require('path');
const https = require('http');
const ROOT = path.join(__dirname, '..');
const portfwdr = require(path.join(ROOT, 'node_modules/mw-port-fwdr/portfwdr.js'));

const fwdr = portfwdr.createPortFwdr();
console.log('启动 portfwdr: 192.168.x.x:8080(http) / :8443(https) ...');
fwdr.start('192.168.x.x', 8080, 8443, (err) => {
  if (err) { console.log('portfwdr start 失败:', err.code || err.message); process.exit(1); }
  const httpPort = fwdr.getHttpPort();
  const httpsPort = fwdr.getHttpsPort();
  console.log('本地端口: http=' + httpPort + ' https=' + httpsPort);

  // 1) localhost 直连 portfwdr（基准，应通）
  const net = require('net');
  const t1 = net.connect(httpsPort, '127.0.0.1', () => {
    console.log('[基准] 127.0.0.1:' + httpsPort + ' ✅ 可连（portfwdr 工作正常）');
    t1.destroy();
    step2();
  });
  t1.on('error', e => { console.log('[基准] 127.0.0.1:' + httpsPort + ' ❌ ' + e.message); step2(); });
  t1.setTimeout(3000, () => { console.log('[基准] timeout'); t1.destroy(); step2(); });

  function step2() {
    // 2) digitalpaper.local:<port> —— renderer XHR 的真实目标
    const dns = require('dns');
    dns.lookup('digitalpaper.local', { all: true }, (e, addrs) => {
      console.log('[DNS] digitalpaper.local →', e ? e.message : JSON.stringify(addrs));
      const t2 = net.connect(httpsPort, 'digitalpaper.local', () => {
        console.log('[XHR路径] digitalpaper.local:' + httpsPort + ' ✅ 可连');
        t2.destroy(); done(1);
      });
      t2.on('error', e2 => { console.log('[XHR路径] digitalpaper.local:' + httpsPort + ' ❌ ' + e2.message); done(0); });
      t2.setTimeout(3000, () => { console.log('[XHR路径] timeout'); t2.destroy(); done(0); });
    });
  }

  function done(xhrOk) {
    // 3) 完整 HTTP check（等同 connctrl 的 checkUrl）
    const req = https.get('http://digitalpaper.local:' + fwdr.getHttpPort() + '/api_version', (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        console.log('[check] GET api_version →', res.statusCode, d.slice(0, 100));
        finish();
      });
    });
    req.on('error', e => { console.log('[check] ❌', e.message); finish(); });
    req.setTimeout(4000, function () { console.log('[check] timeout'); req.destroy(); finish(); });
  }

  function finish() {
    fwdr.close();
    process.exit(0);
  }
});
