/**
 * 礼物价格页的布局/回归截图（开发自用）。
 *
 * 用法：
 *   node scripts/shot-gift-prices.js                # 1440 与 1912 两个宽度
 *   FRONT=http://127.0.0.1:9871 node scripts/shot-gift-prices.js
 *   WIDTH=1912 node scripts/shot-gift-prices.js     # 只截一个宽度
 *
 * 输出：logs/gift-prices-<width>.png，并在终端打印列宽 + 实际加载的 bundle 名
 * （bundle 名对不上 = 浏览器/服务端拿了旧缓存，见 web-dashboard.js 的 index.html no-store）。
 */
const fs = require('fs')
const path = require('path')
const { chromium, devices } = require('playwright')

const FRONT = process.env.FRONT || 'http://127.0.0.1:9871'
const OUT = path.join(__dirname, '..', 'logs')
const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find((c) => fs.existsSync(c))
const WIDTHS = process.env.WIDTH ? [Number(process.env.WIDTH)] : [1440, 1912]

async function login() {
  const res = await fetch(`${FRONT}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userName: process.env.ADMIN_USER || 'admin', password: process.env.ADMIN_PASS || '123456' })
  })
  if (!res.ok) throw new Error(`登录失败 ${res.status}`)
  return res.json()
}

async function seed(ctx, auth) {
  await ctx.addInitScript((a) => {
    localStorage.setItem(
      'sys-v1.1.0-user',
      JSON.stringify({
        language: 'zh',
        isLogin: true,
        isLock: false,
        lockPassword: '',
        info: { userId: a.userId, userName: a.userName, roles: a.roles, buttons: [], avatar: '' },
        searchHistory: [],
        accessToken: a.token,
        refreshToken: a.refreshToken
      })
    )
    localStorage.setItem('sys-version', '1.1.0')
  }, auth)
}

;(async () => {
  const auth = await login()
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })

  for (const width of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 })
    await seed(ctx, auth)
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)))
    page.on('console', (m) => {
      if (m.type() !== 'error') return
      const t = m.text()
      if (/douyinpic|byteimg|iconify|unisvg|ERR_/.test(t)) return
      errs.push(t.slice(0, 160))
    })

    await page.goto(`${FRONT}/#/douyin/gift-prices`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(7000)

    const info = await page.evaluate(() => ({
      cols: [...document.querySelectorAll('.el-table__header th')].map((t) => ({
        label: t.innerText.trim(),
        w: Math.round(t.getBoundingClientRect().width)
      })),
      bundle: [...document.scripts].map((s) => s.src.split('/').pop()).find((f) => f && f.startsWith('index-')),
      rowHeight: Math.round(document.querySelector('.el-table__body tr')?.getBoundingClientRect().height || 0)
    }))
    console.log(`${width}px  ${JSON.stringify(info)}  console-errors=${errs.length}`)

    await page.screenshot({ path: path.join(OUT, `gift-prices-${width}.png`) })
    await ctx.close()
  }

  // 手机宽度也来一张，方便确认没被桌面改动弄坏
  const mobile = await browser.newContext({ ...devices['Pixel 7'] })
  await seed(mobile, auth)
  const mp = await mobile.newPage()
  await mp.goto(`${FRONT}/#/douyin/gift-prices`, { waitUntil: 'domcontentloaded' })
  await mp.waitForTimeout(7000)
  await mp.screenshot({ path: path.join(OUT, 'gift-prices-mobile.png') })

  await browser.close()
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
