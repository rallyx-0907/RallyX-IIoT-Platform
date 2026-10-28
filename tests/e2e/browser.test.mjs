import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import net from 'node:net';

// Real browser and real read-only Modbus source; no browser automation dependency.
const base = process.env.RALLYX_BROWSER_BASE_URL || 'http://web:8080';
const smokeOnly = process.env.RALLYX_BROWSER_SMOKE_ONLY === 'true';
const configPath = process.env.RALLYX_ENV_FILE || '.env';
const config = Object.fromEntries(readFileSync(configPath, 'utf8').split(/\r?\n/).filter(line => /^[A-Z_]+=/.test(line)).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, description, ms = 30000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (await check()) return; await pause(150); }
  throw new Error(`Timed out: ${description}`);
}

class Browser {
  id = 0; pending = new Map();
  async start() {
    this.process = spawn(process.env.CHROMIUM_PATH || 'chromium-browser', ['--headless', '--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9222', '--user-data-dir=/tmp/rallyx-browser', '--window-size=1440,1100', 'about:blank'], { stdio: 'ignore' });
    await until(async () => { try { this.targets = await (await fetch('http://127.0.0.1:9222/json')).json(); return this.targets.some(target => target.type === 'page'); } catch { return false; } }, 'Chromium startup');
    this.socket = new WebSocket(this.targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { this.socket.onopen = resolve; this.socket.onerror = reject; });
    this.socket.onmessage = event => { const response = JSON.parse(event.data); if (response.id) { const pending = this.pending.get(response.id); if (pending) { this.pending.delete(response.id); response.error ? pending.reject(new Error(response.error.message)) : pending.resolve(response.result); } } };
    await this.send('Page.enable');
    await this.send('Runtime.enable');
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
      this.pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); } });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(fn, ...args) {
    const response = await this.send('Runtime.evaluate', { expression: `(${fn.toString()})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text + ': ' + response.exceptionDetails.exception?.description);
    return response.result.value;
  }
  async text(value) { await until(() => this.eval(value => document.body.innerText.includes(value), value), `visible ${value}`); }
  async click(text, rowText = '') {
    await until(() => this.eval((text, rowText) => [...document.querySelectorAll('button')].some(button => !button.disabled && (button.textContent.trim() === text || button.getAttribute('aria-label') === text) && (!rowText || button.closest('tr')?.textContent.includes(rowText))), text, rowText), `enabled button ${text}`);
    await this.eval((text, rowText) => [...document.querySelectorAll('button')].find(button => !button.disabled && (button.textContent.trim() === text || button.getAttribute('aria-label') === text) && (!rowText || button.closest('tr')?.textContent.includes(rowText))).click(), text, rowText);
  }
  async fill(label, value, byText = false) {
    await until(() => this.eval((label, value, byText) => {
      const control = [...document.querySelectorAll('input,select,textarea')].find(element => element.getAttribute('aria-label') === label || element.closest('label')?.childNodes[0]?.textContent.trim() === label);
      return control && !control.disabled && (control.tagName !== 'SELECT' || [...control.options].some(option => byText ? option.textContent === value || option.textContent.startsWith(value + ' (') : option.value === value));
    }, label, value, byText), `ready field ${label}`);
    await this.eval((label, value, byText) => {
      const control = [...document.querySelectorAll('input,select,textarea')].find(element => element.getAttribute('aria-label') === label || element.closest('label')?.childNodes[0]?.textContent.trim() === label);
      if (!control) throw new Error(`Missing field ${label}`);
      if (byText) { const option = [...control.options].find(option => option.textContent === value || option.textContent.startsWith(value + ' (')); if (!option) throw new Error(`Missing option ${value}`); value = option.value; }
      if (control.type === 'checkbox') { if (control.checked !== value) control.click(); return; }
      const prototype = control.tagName === 'SELECT' ? HTMLSelectElement.prototype : control.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(control, value);
      control.dispatchEvent(new Event(control.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    }, label, value, byText);
  }
  async page(hash, title) {
    await this.eval(hash => { location.hash = hash; }, hash);
    await until(() => this.eval(title => [...document.querySelectorAll('h1')].some(element => element.textContent === title), title), `page ${title}`);
  }
  async screenshot(name, viewportOnly = false) {
    mkdirSync('.tools/browser-evidence', { recursive: true });
    const result = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !viewportOnly });
    writeFileSync(`.tools/browser-evidence/${name}.png`, Buffer.from(result.data, 'base64'));
  }
  close() { this.socket?.close(); this.process?.kill(); }
}

test(smokeOnly ? 'authenticated UI and API smoke without configuration writes' : 'configure local hierarchy, Modbus templates, tags, CSV and persisted dashboard through Chromium', { timeout: 300000 }, async t => {
  const browser = new Browser();
  let sourceOffset = 0;
  const sockets = new Set();
  const source = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    socket.on('data', data => {
      buffer = Buffer.concat([buffer, data]);
      while (buffer.length >= 8) {
        const length = buffer.readUInt16BE(4) + 6;
        if (buffer.length < length) return;
        const request = buffer.subarray(0, length); buffer = buffer.subarray(length);
        const unit = request[6], fn = request[7], address = request.readUInt16BE(8), count = request.readUInt16BE(10);
        let pdu;
        if (fn === 3 || fn === 4) { pdu = Buffer.alloc(2 + count * 2); pdu[0] = fn; pdu[1] = count * 2; for (let i = 0; i < count; i++) pdu.writeUInt16BE(unit * 100 + address + i + sourceOffset, 2 + i * 2); }
        else if (fn === 1 || fn === 2) { pdu = Buffer.from([fn, 1, 1]); }
        else pdu = Buffer.from([fn | 128, 1]);
        const header = Buffer.from(request.subarray(0, 7)); header.writeUInt16BE(pdu.length + 1, 4); socket.write(Buffer.concat([header, pdu]));
      }
    });
    socket.on('error', () => {});
  });
  if (!smokeOnly) await new Promise(resolve => source.listen(1502, '0.0.0.0', resolve));
  t.after(() => { browser.close(); for (const socket of sockets) socket.destroy(); if (source.listening) source.close(); });
  const stamp = Date.now();
  const site = `UI site ${stamp}`, area = `UI area ${stamp}`, asset = `UI asset ${stamp}`;
  const connection = `UI Modbus ${stamp}`, template = `UI meter ${stamp}`, deviceA = `UI meter A ${stamp}`, deviceB = `UI meter B ${stamp}`;
  try {
    await browser.start();
    await browser.send('Page.navigate', { url: base });
    await browser.text('Đăng nhập RallyX');
    assert.equal(await browser.eval(() => document.documentElement.lang), 'vi', 'first-run UI defaults to Vietnamese');
    await browser.fill('Ngôn ngữ / Language', 'en');
    await browser.text('Sign in to RallyX');
    await browser.fill('Username', config.ADMIN_USERNAME);
    await browser.fill('Password', config.ADMIN_PASSWORD);
    await browser.click('Sign in');
    await until(() => browser.eval(() => document.body.innerText.includes('Set your password') || document.body.innerText.includes('Equipment overview')), 'login');
    if (await browser.eval(() => document.body.innerText.includes('Set your password'))) {
      assert.equal(smokeOnly, false, 'read-only smoke does not change installation passwords');
      const password = randomBytes(24).toString('hex');
      await browser.fill('Current password', config.ADMIN_PASSWORD); await browser.fill('New password', password); await browser.click('Save password');
      await browser.text('Equipment overview');
      writeFileSync(configPath, readFileSync(configPath, 'utf8').replace(/^ADMIN_PASSWORD=.*$/m, `ADMIN_PASSWORD=${password}`)); config.ADMIN_PASSWORD = password;
    }
    if (smokeOnly) {
      const statuses = await browser.eval(async () => Promise.all(['/assets/tree', '/connections', '/devices', '/templates', '/tags', '/dashboard'].map(async path => (await fetch('/api/v1' + path)).status)));
      assert.ok(statuses.every(status => status === 200));
      for (const [hash, title] of [['dashboards', 'Dashboards'], ['assets', 'Assets'], ['connections', 'Connections'], ['devices', 'Devices'], ['templates', 'Templates'], ['configuration', 'Tag Configuration'], ['live', 'Live Data'], ['history', 'History & Trends'], ['rules', 'Rules'], ['alarms', 'Alarms'], ['system', 'System'], ['overview', 'Overview']]) {
        await browser.page(hash, title); await pause(200);
        assert.equal(await browser.eval(() => document.querySelectorAll('[role="alert"]').length), 0, `${title} has no API errors`);
      }
      await browser.screenshot('operating-ui');
      if (process.env.RALLYX_VI_CHECK === 'true') {
        await t.test('Vietnamese interface, persisted choice and formatted hierarchy', async () => {
          await browser.fill('Ngôn ngữ / Language', 'vi');
          for (const [hash, title] of [['dashboards', 'Bảng điều khiển'], ['overview', 'Tổng quan'], ['assets', 'Tài sản'], ['connections', 'Kết nối'], ['devices', 'Thiết bị'], ['templates', 'Mẫu thiết bị'], ['configuration', 'Cấu hình tín hiệu'], ['live', 'Dữ liệu trực tiếp'], ['history', 'Lịch sử & xu hướng'], ['rules', 'Quy tắc'], ['alarms', 'Cảnh báo'], ['system', 'Hệ thống']]) {
            await browser.page(hash, title); await pause(100);
            assert.equal(await browser.eval(() => document.querySelectorAll('[role="alert"]').length), 0, `${title} has no API errors`);
          }
          await browser.send('Page.reload'); await browser.text('Hệ thống');
          assert.equal(await browser.eval(() => document.documentElement.lang), 'vi');
          assert.equal(await browser.eval(() => localStorage.getItem('rallyx.language')), 'vi');
          await browser.page('assets', 'Tài sản'); await browser.text('CẤU TRÚC TÀI SẢN');
          await until(() => browser.eval(() => document.querySelectorAll('.hierarchy-tag').length > 0), 'configured hierarchy tags');
          const layout = await browser.eval(() => {
            const name = document.querySelector('.hierarchy-tag-name'), meta = document.querySelector('.hierarchy-tag-meta');
            return { name: getComputedStyle(name).display, meta: getComputedStyle(meta).display, separate: meta.getBoundingClientRect().top >= name.getBoundingClientRect().bottom, size: parseFloat(getComputedStyle(name).fontSize), bullets: getComputedStyle(document.querySelector('.hierarchy-tags')).listStyleType };
          });
          assert.equal(layout.name, 'block'); assert.equal(layout.meta, 'block'); assert.equal(layout.separate, true); assert.equal(layout.bullets, 'none'); assert.ok(layout.size >= 14);
          await browser.screenshot('hierarchy-vi-desktop', true);
          await browser.send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 1, mobile: false });
          await pause(150);
          assert.equal(await browser.eval(() => document.documentElement.scrollWidth > innerWidth), false, 'Vietnamese hierarchy fits narrow viewport');
          assert.notEqual(await browser.eval(() => getComputedStyle(document.querySelector('.hierarchy-panel')).display), 'none');
          await browser.screenshot('hierarchy-vi-narrow', true);
          await browser.send('Emulation.clearDeviceMetricsOverride');
          await browser.page('live', 'Dữ liệu trực tiếp'); await browser.text('Giám sát thiết bị');
          await browser.fill('Lọc theo thiết bị', config.SIMULATOR_MOTOR_DEVICE_ID || 'demo-motor-device');
          await browser.screenshot('live-vi-desktop', true);
          await browser.fill('Ngôn ngữ / Language', 'en'); await browser.text('Live Data');
          assert.equal(await browser.eval(() => document.documentElement.lang), 'en');
        });
      }
      if (process.env.RALLYX_READABILITY_CHECK === 'true') {
        await browser.page('live', 'Live Data'); await browser.text('Equipment monitor');
        await browser.fill('Filter by device', config.SIMULATOR_MOTOR_DEVICE_ID || 'demo-motor-device');
        await until(() => browser.eval(() => document.querySelectorAll('.live-reading').length > 0), 'device readings');
        const sizes = await browser.eval(() => ({ value: parseFloat(getComputedStyle(document.querySelector('.live-value strong')).fontSize), filter: parseFloat(getComputedStyle(document.querySelector('.live-toolbar label')).fontSize), body: parseFloat(getComputedStyle(document.body).fontSize) }));
        assert.ok(sizes.value >= 30 && sizes.filter >= 14 && sizes.body >= 16, JSON.stringify(sizes));
        assert.equal(await browser.eval(() => document.documentElement.scrollWidth > innerWidth), false, 'desktop live monitor fits viewport');
        await browser.screenshot('live-readable-desktop', true);
        await browser.send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 1, mobile: false });
        await pause(200);
        assert.equal(await browser.eval(() => document.documentElement.scrollWidth > innerWidth), false, 'narrow live monitor fits viewport');
        await browser.screenshot('live-readable-narrow', true);
        await browser.send('Emulation.clearDeviceMetricsOverride');
        await browser.page('devices', 'Devices');
        await until(() => browser.eval(() => !!document.querySelector('button[aria-label^="Edit "]')), 'device edit action');
        await browser.eval(() => document.querySelector('button[aria-label^="Edit "]').click());
        await browser.text('Edit device');
        const form = await browser.eval(() => {
          const fieldset = document.querySelector('fieldset');
          const buttons = [...fieldset.querySelectorAll('button')];
          return { border: getComputedStyle(fieldset).borderTopWidth, display: getComputedStyle(fieldset).display, columns: getComputedStyle(fieldset).gridTemplateColumns.split(' ').length, buttons: buttons.map(button => ({ radius: parseFloat(getComputedStyle(button).borderRadius), height: button.getBoundingClientRect().height, size: parseFloat(getComputedStyle(button).fontSize) })) };
        });
        assert.equal(form.border, '0px'); assert.equal(form.display, 'grid'); assert.ok(form.columns >= 2);
        assert.ok(form.buttons.every(button => button.radius >= 5 && button.height >= 40 && button.size >= 14), JSON.stringify(form));
        await browser.screenshot('device-form-readable', true);
        await browser.send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 1, mobile: false });
        await pause(200);
        assert.equal(await browser.eval(() => document.documentElement.scrollWidth > innerWidth), false, 'narrow device form fits viewport');
        await browser.screenshot('device-form-narrow', true);
        await browser.send('Emulation.clearDeviceMetricsOverride');
        await browser.click('Cancel');
      }
      if (process.env.RALLYX_DASHBOARD_CHECK === 'true') {
        await t.test('saved mixed dashboard renders in Vietnamese on desktop and narrow screens', async () => {
          const widgets = await browser.eval(async () => (await fetch('/api/v1/dashboard')).json());
          const boardId = widgets.find(widget => widget.type === 'level' && widget.board_id)?.board_id;
          assert.ok(boardId, 'configured mixed dashboard exists');
          await browser.page('dashboards', 'Dashboards');
          await browser.fill('Dashboard', boardId);
          await until(() => browser.eval(() => document.querySelectorAll('.dashboard-widget').length >= 4), 'mixed dashboard widgets');
          await browser.fill('Ngôn ngữ / Language', 'vi');
          await browser.text('Bảng điều khiển');
          assert.equal(await browser.eval(() => document.querySelectorAll('.dashboard-gauge.dial').length), 1);
          assert.equal(await browser.eval(() => document.querySelectorAll('.dashboard-gauge.level').length), 1);
          assert.equal(await browser.eval(() => document.documentElement.scrollWidth > innerWidth), false, 'desktop dashboard fits viewport');
          await browser.screenshot('dashboard-mixed-vi');
          await browser.send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 1, mobile: false });
          await pause(200);
          assert.equal(await browser.eval(() => document.documentElement.scrollWidth > innerWidth), false, 'narrow dashboard fits viewport');
          await browser.screenshot('dashboard-mixed-vi-narrow');
          await browser.send('Emulation.clearDeviceMetricsOverride');
          await browser.fill('Ngôn ngữ / Language', 'en');
        });
      }
      await browser.click('Sign out'); await browser.text('Sign in to RallyX');
      return;
    }
    await t.test('Site, Area and Asset configuration', async () => {
      await browser.page('assets', 'Assets'); await browser.click('+ Add site'); await browser.fill('Name', site); await browser.click('Create site'); await browser.text(site);
      await browser.click('+ Add area'); await browser.fill('Name', area); await browser.fill('Site', site, true); await browser.click('Create area'); await browser.text(area);
      await browser.click('+ Add asset'); await browser.fill('Name', asset); await browser.fill('Area', `${site} / ${area}`, true); await browser.click('Create asset'); await browser.text(asset);
    });
    await t.test('Modbus connection and six-tag template', async () => {
      await browser.page('connections', 'Connections'); await browser.click('Add connection'); await browser.fill('Connection name', connection); await browser.fill('Site', site, true); await browser.fill('Protocol', 'modbus-tcp'); await browser.fill('Host', process.env.MODBUS_TEST_HOST || 'rallyx-ui-browser'); await browser.fill('Port', '1502'); await browser.click('Save connection'); await browser.text('Connection saved.');
      await browser.page('templates', 'Templates'); await browser.click('Add template'); await browser.fill('Template name', template); await browser.fill('Protocol', 'modbus-tcp');
      for (let i = 1; i <= 6; i++) { if (i > 1) await browser.click('Add tag definition'); await browser.fill(`Tag ${i} key`, `signal_${i}`); await browser.fill(`Tag ${i} name`, `Signal ${i} ${stamp}`); await browser.fill(`Tag ${i} data type`, 'uint16'); await browser.fill(`Tag ${i} address`, String(i - 1)); }
      await browser.click('Save template'); await browser.text('Template saved. Existing devices keep their tags.');
    });
    await t.test('two independently addressed template instances', async () => {
      await browser.page('devices', 'Devices');
      for (const [name, unit] of [[deviceA, '1'], [deviceB, '2']]) {
        await browser.click('Add device'); await browser.fill('Device name', name); await browser.fill('Connection', connection, true); await browser.fill('Asset', asset, true); await browser.fill('Template', template, true); await browser.fill('Protocol device address / slave ID', unit); await browser.click('Save device'); await browser.text('Device saved.'); await browser.text(name);
      }
      await browser.page('connections', 'Connections'); await browser.click(`Test ${connection}`); await browser.text(`${connection}: connection successful.`);
    });
    const records = await browser.eval(async () => ({ devices: await (await fetch('/api/v1/devices')).json(), tags: await (await fetch('/api/v1/tags')).json() }));
    const a = records.devices.find(device => device.name === deviceA), b = records.devices.find(device => device.name === deviceB);
    assert.equal(records.tags.filter(tag => tag.device_id === a.id).length, 6); assert.equal(records.tags.filter(tag => tag.device_id === b.id).length, 6);
    const tag = records.tags.find(tag => tag.device_id === a.id && tag.key === 'signal_1');
    let runTagID;
    await t.test('manual device-owned boolean tag editor', async () => {
      await browser.page('configuration', 'Tag Configuration'); await browser.click('Add tag'); await browser.fill('Device', a.id); await browser.fill('Tag key', 'run_flag'); await browser.fill('Name', `Run flag ${stamp}`); await browser.fill('Data type', 'bool'); await browser.fill('Address / MQTT value key', '0'); await browser.fill('Function code', '1'); await browser.fill('Semantic', 'run'); await browser.click('Save tag'); await browser.text('Tag saved.');
      runTagID = await browser.eval(async id => (await (await fetch('/api/v1/tags')).json()).find(tag => tag.device_id === id && tag.key === 'run_flag').id, a.id);
    });
    await t.test('saved tag Test Read, live values and history', async () => {
      await browser.page('configuration', 'Tag Configuration'); await browser.fill('Filter signals by device', a.id); await browser.fill('Search signals', 'Signal 1'); await browser.text(`Signal 1 ${stamp}`); await browser.click(`Test read Signal 1 ${stamp}`, deviceA); await browser.text('Raw:'); await browser.text('Decoded: 100'); await browser.text('Scaled: 100');
      await browser.page('live', 'Live Data'); await browser.fill('Filter by device', b.id); await browser.text('200');
      await browser.page('history', 'History & Trends'); await browser.fill('Asset', asset, true); await browser.fill('Tag', tag.id); await until(() => browser.eval(() => !!document.querySelector('svg[aria-label="Analog telemetry trend"]')), 'recorded numeric trend');
    });
    await t.test('100-tag CSV preview and atomic import', async () => {
      await browser.page('configuration', 'Tag Configuration'); const csv = ['device,tag,address,data_type,store_history', ...Array.from({ length: 100 }, (_, i) => `${b.id},bulk_${i},${100 + i},uint16,true`)].join('\n');
      await browser.fill('CSV content', csv.replace(`${b.id},bulk_0`, 'missing_device,bulk_0')); await browser.click('Preview CSV'); await browser.text('Row 2, device:');
      assert.equal(await browser.eval(() => [...document.querySelectorAll('button')].find(button => button.textContent === 'Import CSV').disabled), true);
      await browser.fill('CSV content', csv); await browser.click('Preview CSV'); await browser.text('100 rows; 100 valid.'); await browser.click('Import CSV'); await browser.text('Imported 100 tags.');
      await browser.page('live', 'Live Data'); await browser.fill('Filter by device', b.id); await browser.text('bulk_99'); await until(() => browser.eval(() => [...document.querySelectorAll('.live-reading')].some(row => row.textContent.includes('bulk_99') && row.textContent.includes('399'))), 'imported tag telemetry', 45000);
    });
    await t.test('signal configuration scopes devices and searches a large register list', async () => {
      await browser.page('configuration', 'Tag Configuration');
      await browser.fill('Filter signals by device', b.id);
      await browser.fill('Search signals', 'bulk_99');
      await browser.text('bulk_99');
      assert.equal(await browser.eval(() => document.querySelectorAll('tbody tr').length), 1);
      assert.equal(await browser.eval(() => [...document.querySelectorAll('tbody tr')].some(row => row.textContent.includes('bulk_98'))), false);
      await browser.click('Add tag');
      assert.equal(await browser.eval(() => [...document.querySelectorAll('label')].find(label => label.firstChild?.textContent === 'Device').querySelector('select').value), b.id);
      await browser.click('Cancel');
    });
    await t.test('new tag rule activates, acknowledges and clears into history', async () => {
      const name = `UI high ${stamp}`;
      await browser.page('rules', 'Rules'); await browser.click('Add rule'); await browser.fill('Rule name', name); await browser.click('Add condition'); await browser.fill('Tag', tag.id); await browser.fill('Operand', '50'); await browser.eval(() => { const input = document.querySelector('.rule-check input'); input.click(); }); await browser.click('Test rule'); await browser.text('Test result'); await browser.click('Save rule'); await browser.text(name);
      await browser.page('alarms', 'Alarms'); await browser.text(name); await browser.fill('Filter alarms by asset', a.asset_id); await browser.click('Acknowledge'); await browser.text('Acknowledged');
      sourceOffset = -100;
      await until(() => browser.eval(name => ![...document.querySelectorAll('tbody tr')].some(row => row.textContent.includes(name)), name), 'alarm clear');
      await browser.click('History · last 24h'); await browser.text(name); await browser.text('Cleared'); sourceOffset = 0;
    });
    await t.test('pin Value and Trend widgets and retain them through browser refresh', async () => {
      await browser.page('overview', 'Overview'); await browser.fill('Pin tag', tag.id); await browser.fill('Widget title', `UI value ${stamp}`); await browser.click('Pin to Dashboard'); await browser.text(`UI value ${stamp}`);
      await browser.fill('Widget type', 'trend'); await browser.fill('Widget title', `UI trend ${stamp}`); await browser.click('Pin to Dashboard'); await browser.text(`UI trend ${stamp}`);
      await browser.fill('Pin tag', runTagID); await browser.fill('Widget type', 'status'); await browser.fill('Widget title', `UI status ${stamp}`); await browser.click('Pin to Dashboard'); await browser.text(`UI status ${stamp}`);
      await browser.send('Page.reload'); await browser.text(`UI value ${stamp}`); await browser.text(`UI trend ${stamp}`); await browser.screenshot('dashboard');
      const saved = await browser.eval(async () => (await fetch('/api/v1/dashboard')).json());
      assert.ok(saved.some(widget => widget.title === `UI value ${stamp}` && widget.tag_id === tag.id), 'pin retains the selected tag identity');
      assert.ok(saved.some(widget => widget.title === `UI status ${stamp}` && widget.tag_id === runTagID && widget.type === 'status'));
    });
    await t.test('named dashboards persist numeric gauge settings and widget edits', async () => {
      await browser.page('dashboards', 'Dashboards');
      await browser.click('Create dashboard…');
      await browser.fill('Dashboard name', `UI board ${stamp}`);
      await browser.click('Create dashboard');
      await browser.fill('Pin tag', tag.id);
      await browser.fill('Widget type', 'gauge');
      await browser.fill('Minimum', '0'); await browser.fill('Maximum', '500');
      await browser.fill('Widget title', `UI gauge ${stamp}`);
      await browser.click('Pin to Dashboard');
      await browser.text(`UI gauge ${stamp}`);
      const saved = await browser.eval(async () => (await fetch('/api/v1/dashboard')).json());
      const widget = saved.find(item => item.title === `UI gauge ${stamp}`);
      assert.ok(widget.board_id); assert.equal(widget.type, 'gauge'); assert.equal(widget.settings.max, 500);
      await browser.send('Page.reload'); await browser.text(`UI gauge ${stamp}`);
      await browser.click(`Edit UI gauge ${stamp}`);
      await browser.fill('Widget title', `UI edited gauge ${stamp}`);
      await browser.click('Save widget'); await browser.text(`UI edited gauge ${stamp}`);
      await browser.screenshot('custom-dashboard');
    });
    assert.equal(await browser.eval(() => document.querySelectorAll('[role="alert"]').length), 0);
  } catch (error) {
    if (browser.socket?.readyState === WebSocket.OPEN) { await browser.screenshot('failure').catch(() => {}); const text = await browser.eval(() => document.body.innerText).catch(() => 'Browser unavailable'); console.error(text.slice(-6000)); }
    throw error;
  }
});
