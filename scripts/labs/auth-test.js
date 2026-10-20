// DPA 认证链端到端复现：GET /auth/nonce -> signNonce -> PUT /auth (期望 204)
'use strict';
process.env.MW_USER_DATA_DIR_PATH =
  '/Users/wulin/Library/Application Support/Sony Corporation/Digital Paper App/DigitalPaperApp/<workspace-id>';

const https = require('https');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const authctrl = require(path.join(ROOT, 'node_modules/mw-auth-ctrl/authctrl.js'));
const btoa = require(path.join(ROOT, 'node_modules/btoa'));

const HOST = process.argv[2] || '192.168.x.x';
const BASE = 'https://' + HOST + ':8443';

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      host: HOST, port: 8443, method, path,
      rejectUnauthorized: false,
      headers: payload ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      } : {}
    };
    const r = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

(async () => {
  console.log('[1] 探活 /ping ...');
  try {
    const ping = await req('GET', '/ping');
    console.log('    status:', ping.status, 'body:', ping.body.slice(0, 120));
  } catch (e) { console.log('    ping error:', e.message); }

  console.log('[2] genAuthPrepare (读 deviceid.dat) ...');
  const prep = await new Promise((res, rej) =>
    authctrl.genAuthPrepare(BASE, (e, r) => e ? rej(e) : res(r)));
  console.log('    req =', JSON.stringify(prep));

  console.log('[3] GET', prep.url.replace(BASE, ''), '...');
  const nres = await req('GET', prep.url.replace(BASE, ''));
  console.log('    status:', nres.status, 'body:', nres.body.slice(0, 200));
  let nbody;
  try { nbody = JSON.parse(nres.body); } catch (e) {
    console.log('    !! nonce 响应不是 JSON，中止');
    return;
  }

  console.log('[4] genAuth (signNonce + 组装 PUT /auth) ...');
  const areq = await new Promise((res, rej) =>
    authctrl.genAuth(BASE, nres.status, nbody, (e, r) => e ? rej(e) : res(r)));
  console.log('    PUT body keys =', Object.keys(areq.body),
    'nonce_signed(b64) len =', areq.body.nonce_signed ? areq.body.nonce_signed.length : 'N/A');

  console.log('[5] PUT /auth ...');
  const ares = await req('PUT', '/auth', areq.body);
  console.log('    status:', ares.status, 'body:', ares.body.slice(0, 200));
  console.log(ares.status === 204
    ? '\n✅ 认证成功（204）—— 认证链本身没问题，问题在 app 内其它环节'
    : '\n❌ 认证失败 —— 设备拒绝了这个 client_id/签名');
})().catch(e => {
  console.error('FATAL:', e.code || '', e.message);
  if (e.stack) console.error(e.stack.split('\n').slice(0, 4).join('\n'));
});
