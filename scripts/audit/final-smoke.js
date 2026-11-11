const { chromium, devices } = require('playwright')
const FRONT = 'http://127.0.0.1:9871'
const ROUTES = ['#/douyin/dashboard','#/douyin/rooms','#/douyin/sessions?hostId=65209552987','#/douyin/trends','#/douyin/combined','#/douyin/notify','#/douyin/status','#/douyin/detail/303']
async function login(p) {
  await p.goto(`${FRONT}/#/auth/login`, { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(2500)
  await p.locator('input').nth(0).fill('admin'); await p.locator('input').nth(1).fill('123456')
  const wrap = p.locator('.drag_verify').first(); const handler = p.locator('.dv_handler').first()
  const wb = await wrap.boundingBox(); const hb = await handler.boundingBox(); const y = hb.y + hb.height/2
  await p.mouse.move(hb.x+hb.width/2, y); await p.mouse.down()
  for (let i=1;i<=30;i++){ await p.mouse.move(hb.x+hb.width/2+((wb.x+wb.width-8-hb.x-hb.width/2)*i)/30, y); await p.waitForTimeout(12) }
  await p.mouse.up(); await p.waitForTimeout(600)
  await p.locator('button:has-text("登录")').first().click(); await p.waitForTimeout(4500)
}
;(async () => {
  const b = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--no-sandbox'] })
  for (const vp of [{ w: 1600, h: 950, name: '桌面' }, { w: 385, h: 835, name: '手机' }]) {
    const ctx = await b.newContext({ ...(vp.name === '手机' ? devices['Pixel 7'] : {}), viewport: { width: vp.w, height: vp.h } })
    const p = await ctx.newPage()
    const errs = []
    let where = ''
    p.on('pageerror', e => errs.push(`[${where}] ${String(e).slice(0,110)}`))
    p.on('console', m => { if (m.type()==='error') errs.push(`[${where}] ${m.text().slice(0,110)}`) })
    p.on('response', r => { if (r.url().includes('/api/') && r.status()>=400) errs.push(`[${where}] http ${r.status()} ${r.url().replace(FRONT,'')}`) })
    await login(p)
    for (const r of ROUTES) {
      where = r
      await p.evaluate(h => (location.hash = h), r)
      await p.waitForTimeout(2600)
      const cards = await p.evaluate(() => document.querySelectorAll('.art-card, .art-table-card').length)
      if (cards === 0) errs.push(`[${where}] 0 cards`)
    }
    // 入场动画检查：animation-name 应该只有 dy-rise-in
    await p.evaluate(() => (location.hash = '#/douyin/trends'))
    await p.waitForTimeout(900)
    const anim = await p.evaluate(() => {
      const el = document.querySelector('.douyin-page > *')
      return el ? getComputedStyle(el).animationName : null
    })
    console.log(`${vp.name}: 错误 ${errs.length} 个；入场 animation-name = ${anim}`)
    errs.slice(0,4).forEach(e => console.log('   -', e))
    await ctx.close()
  }
  await b.close()
})().catch(e => { console.error(e.message); process.exit(1) })
