#!/usr/bin/env node
// Attach to the SC26 Atlas WebView (debug build) over the Chrome DevTools Protocol.
//
//   node tools/cdp-attach.mjs                      # print the page title and URL
//   node tools/cdp-attach.mjs "AndroidBridge.appVersion()"   # also evaluate JS in the page
//
// Needs: a device/emulator with the debug APK running, adb, and playwright-core installed in a
// scratch dir outside the repo:   npm i --prefix /tmp/sc26build/pw playwright-core
//
// Environment overrides:
//   SC26_PW_DIR   dir whose node_modules holds playwright-core   (default /tmp/sc26build/pw)
//   SC26_PACKAGE  Android package to attach to                   (default io.github.bartoman.sc26atlas)
//   SC26_CDP_PORT local TCP port to forward                      (default 9222)
//   ADB           adb binary     (default $ANDROID_HOME/platform-tools/adb, else "adb" on PATH)

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const pwDir = process.env.SC26_PW_DIR || '/tmp/sc26build/pw';
const pkg = process.env.SC26_PACKAGE || 'io.github.bartoman.sc26atlas';
const port = process.env.SC26_CDP_PORT || '9222';
const sdkAdb = process.env.ANDROID_HOME && path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb');
const adbBin = process.env.ADB || (sdkAdb && existsSync(sdkAdb) ? sdkAdb : 'adb');
const expression = process.argv[2];

const fail = (message) => { console.error('cdp-attach: ' + message); process.exit(1); };
const adb = (...args) => execFileSync(adbBin, args, { encoding: 'utf8' }).trim();

let chromium;
try {
  ({ chromium } = createRequire(path.join(pwDir, 'package.json'))('playwright-core'));
} catch {
  fail(`playwright-core not found in ${pwDir}. Install it with:\n  npm i --prefix ${pwDir} playwright-core`);
}

// Each debuggable WebView process listens on the abstract socket webview_devtools_remote_<pid>.
let pid;
try {
  pid = adb('shell', 'pidof', pkg).split(/\s+/)[0];
} catch {
  pid = '';
}
if (!pid) fail(`${pkg} is not running (or no device). Start it with:\n  adb shell am start -n ${pkg}/.MainActivity`);

const sockets = adb('shell', 'cat', '/proc/net/unix');
if (!sockets.includes(`webview_devtools_remote_${pid}`)) {
  fail(`no DevTools socket for pid ${pid}. WebView debugging is only enabled in the debug build.`);
}
adb('forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`);

// noDefaults: skip Playwright's desktop-browser setup (Browser.setDownloadBehavior), which a WebView rejects.
const browser = await chromium.connectOverCDP(`http://localhost:${port}`, { noDefaults: true });
try {
  const page = browser.contexts().flatMap((context) => context.pages())[0];
  if (!page) throw new Error('connected, but the WebView has no page.');
  console.log('title: ' + (await page.title()));
  console.log('url:   ' + page.url());
  if (expression) {
    const result = await page.evaluate(expression);
    console.log('result: ' + JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error('cdp-attach: ' + String(error.message).split('\n')[0]);
  process.exitCode = 1;
} finally {
  await browser.close(); // only disconnects; the app keeps running
}
