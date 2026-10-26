const fs = require('fs');
const { chromium } = require('playwright');
const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find((c) => fs.existsSync(c));
const drag = async (page) => {
  for (let a = 0; a < 4; a++) {
    const box = await page.locator('.drag_verify').first().boundingBox().catch(() => null);
    if (!box) return;
    const hx = box.x + 8, hy = box.y + box.height / 2;
    await page.mouse.move(hx, hy); await page.mouse.down(); await page.waitForTimeout(110);
    for (let i = 1; i <= 24; i++) { await page.mouse.move(hx + ((box.width - 16) * i) / 24, hy, { steps: 2 }); await page.waitForTimeout(20); }
    await page.waitForTimeout(220); await page.mouse.up(); await page.waitForTimeout(900);
    if (await page.evaluate(() => /验证成功/.test(document.body.innerText))) return;
  }
};
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const errs = []; const reqs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 140)));
  page.on('request', (r) => { const u = r.url(); if (u.includes('rank-image')) reqs.push(u.replace('http://127.0.0.1:5173', '')); });
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(5000);
  if ((await page.locator('.el-input__inner').count()) >= 2) {
    await page.locator('.el-input__inner').nth(0).fill('admin');
    await page.locator('.el-input__inner').nth(1).fill('123456');
    await drag(page);
    await page.locator('button:has-text("登录")').first().click();
    await page.waitForTimeout(6000);
  }
  await page.goto('http://127.0.0.1:5173/#/douyin/detail/331', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);
  const txt = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 260));
  console.log('页面片段: ' + txt);
  console.log('JS 错误: ' + (errs.length ? errs[0] : '无 ✓'));
  console.log('rank-image 请求: ' + (reqs.length ? reqs.join(' | ') : '(页面未触发下载，正常 ✓)'))
  await page.screenshot({ path: 'team/shots/ui/detail-331.png' });
  await b.close();
})().catch(e => console.log('ERR ' + e.message));
