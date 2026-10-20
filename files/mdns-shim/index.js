/*
 * mdns — arm64 port compatibility layer (bonjour-hap backed)
 *
 * The original app used the native `node_mdns` addon (dns_sd_bindings.node,
 * x86_64 only, unmaintained). Sony's usage is narrow (see
 * mw-discovery-ctrl/lib/discovery_proxy.js):
 *
 *   const mdns = require('mdns');
 *   const browser = mdns.createBrowser(mdns.tcp('digitalpaper'));
 *   browser.on('serviceUp', function (node) {
 *     node.addresses      // array of ip strings
 *     node.fullname       // e.g. 'digitalpaper._digitalpaper._tcp.local.'
 *     node.port           // device port
 *     node.networkInterface // e.g. 'en5' (used for IPv6 scope + local ip)
 *   });
 *   browser.on('error', cb);
 *   browser.start();
 *   browser.stop();
 *
 * This module re-implements exactly that surface on top of bonjour-hap
 * (pure JS, arm64 safe). Extra legacy API (advertise etc.) is intentionally
 * not provided — nothing else in the app consumes it.
 */
'use strict';

const bonjourLib = require('bonjour-hap');

// The legacy node_mdns serviceUp payload carries `networkInterface` (e.g. 'en0'),
// which Sony's discovery_proxy uses to derive the local IP on the same link.
// bonjour-hap does not provide that field, so infer it: pick the local
// interface whose IPv4 address shares a /24 subnet with one of the service
// addresses (adequate for home/office LANs where DPT discovery runs).
function inferNetworkInterface(addresses) {
  const os = require('os');
  try {
    const interfaces = os.networkInterfaces();
    const serviceV4 = (addresses || []).filter(function (a) { return a.indexOf('.') !== -1; });
    for (const ifname of Object.keys(interfaces)) {
      for (const iface of interfaces[ifname]) {
        if (iface.family !== 'IPv4' || iface.internal) { continue; }
        const myPrefix = iface.address.split('.').slice(0, 3).join('.');
        for (const a of serviceV4) {
          if (a.split('.').slice(0, 3).join('.') === myPrefix) {
            return ifname;
          }
        }
      }
    }
  } catch (e) { /* fall through */ }
  return '';
}

function tcp(name) {
  return { name: name, protocol: 'tcp', toString: function () { return '_' + name + '._tcp'; } };
}

function udp(name) {
  return { name: name, protocol: 'udp', toString: function () { return '_' + name + '._udp'; } };
}

function createBrowser(serviceType) {
  const EventEmitter = require('events').EventEmitter;
  const emitter = new EventEmitter();

  const type = (serviceType && serviceType.name) ? serviceType.name : String(serviceType);
  let bonjourInstance = null;
  let browserRef = null;
  let started = false;

  const browser = {
    start: function () {
      if (started) { return; }
      started = true;
      try {
        bonjourInstance = bonjourLib();
        browserRef = bonjourInstance.find(
          { type: type, protocol: 'tcp' },
          function (service) {
            try {
              // legacy node_mdns 'serviceUp' payload shape
              const node = {
                addresses: service.addresses || [],
                fullname: service.name ? (service.name + '._' + type + '._tcp.local.') : undefined,
                name: service.name,
                port: service.port,
                networkInterface: service.networkInterface || inferNetworkInterface(service.addresses),
                host: service.host,
                txt: service.txt
              };
              emitter.emit('serviceUp', node);
            } catch (e) {
              emitter.emit('error', e);
            }
          }
        );
        browserRef.on('error', function (err) { emitter.emit('error', err); });
      } catch (e) {
        started = false;
        emitter.emit('error', e);
      }
    },
    stop: function () {
      try {
        if (browserRef && typeof browserRef.stop === 'function') { browserRef.stop(); }
        if (bonjourInstance && typeof bonjourInstance.destroy === 'function') { bonjourInstance.destroy(); }
      } catch (e) {
        emitter.emit('error', e);
      } finally {
        started = false;
      }
    },
    discover: function () {
      // legacy active re-discovery: restart browse
      if (started) { this.stop(); this.start(); }
    },
    on: function (ev, fn) { return emitter.on(ev, fn); },
    once: function (ev, fn) { return emitter.once(ev, fn); },
    removeListener: function (ev, fn) { return emitter.removeListener(ev, fn); }
  };

  return browser;
}

module.exports = {
  tcp: tcp,
  udp: udp,
  createBrowser: createBrowser
};
