const { chromium } = require('playwright');
const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find((c) => require('fs').existsSync(c));
const drag = async (page) => {
  const box = await page.locator('.drag_verify').first().boundingBox().catch(() => null);
  if (!box) return;
  const hx = box.x + 8, hy = box.y + box.height / 2;
  await page.mouse.move(hx, hy); await page.mouse.down(); await page.waitForTimeout(110);
  for (let i = 1; i <= 24; i++) { await page.mouse.move(hx + ((box.width - 16) * i) / 24, hy, { steps: 2 }); await page.waitForTimeout(18); }
  await page.waitForTimeout(220); await page.mouse.up(); await page.waitForTimeout(800);
};
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await b.newPage({ viewport: { width: 361, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.setDefaultTimeout(25000);
  await page.goto('http://127.0.0.1:9871/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  if ((await page.locator('.el-input__inner').count()) >= 2) {
    await page.locator('.el-input__inner').nth(0).fill('admin');
    await page.locator('.el-input__inner').nth(1).fill('123456');
    await drag(page);
    await page.locator('button:has-text("登录")').first().click();
    await page.waitForTimeout(6000);
  }
  await page.goto('http://127.0.0.1:9871/#/douyin/search', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  const box = page.locator('input[placeholder="输入昵称关键词，回车查询"]');
  await box.first().fill('404');
  await box.first().press('Enter');
  await page.waitForTimeout(9000);
  const info = await page.evaluate(() => {
    const card = document.querySelector('.dy-user-card');
    const row = card && card.querySelector('.justify-between');
    const cr = card ? card.getBoundingClientRect() : { width: 0 };
    return { h: card ? Math.round(card.getBoundingClientRect().height) : 0, cardW: Math.round(cr.width), rowW: row ? Math.round(row.getBoundingClientRect().width) : 0, txt: card ? card.innerText.replace(/\n+/g, ' | ').slice(0, 56) : '' };
  });
  console.log('  卡片宽=' + info.cardW + 'px  整宽行=' + info.rowW + 'px  ' + (info.rowW >= info.cardW - 45 ? '✓ 占满' : '✗ 仍窄') + '  卡片高=' + info.h);
  console.log('  顶部=' + info.txt);
  const el = await page.locator('.dy-user-card').first().boundingBox();
  await page.screenshot({ path: 'team/shots/ui/search-card-v8.png', clip: { x: Math.max(0, el.x - 4), y: Math.max(0, el.y - 4), width: Math.min(361, el.width + 8), height: 180 } });
  await b.close();
})().catch(e => console.log('  ERR ' + e.message));
