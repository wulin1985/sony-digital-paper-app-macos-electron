/*
 * preload.js — Electron 44 compatibility shim for Digital Paper App (arm64 port)
 *
 * The legacy app (Electron 10) relies on `require('electron').remote` inside
 * renderer processes. Electron >= 14 removed the built-in remote module.
 * This preload runs before any page script and attaches @electron/remote
 * onto the renderer's `electron` module object, so all legacy call sites
 * (`electron.remote.Menu`, `electron.remote.require(...)`, etc.) keep working
 * without patching 18+ view files.
 *
 * Requires webPreferences: { sandbox: false, contextIsolation: false, preload: <this file> }
 */
'use strict';

try {
  const electron = require('electron');
  const remote = require('@electron/remote');
  if (electron && !electron.remote) {
    Object.defineProperty(electron, 'remote', {
      value: remote,
      configurable: true,
      enumerable: true,
      writable: true
    });
  }
  if (typeof process !== 'undefined') {
    process.env.DPA_PRELOAD_OK = '1';
  }
} catch (e) {
  // Surface in console instead of dying silently
  console.error('[dpa-preload] remote injection failed:', e);
}
