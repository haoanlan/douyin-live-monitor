const { chromium } = require('playwright')
const FRONT='http://127.0.0.1:9871'
async function login(p){
  await p.goto(`${FRONT}/#/auth/login`,{waitUntil:'domcontentloaded'}); await p.waitForTimeout(2200)
  await p.locator('input').nth(0).fill('admin'); await p.locator('input').nth(1).fill('123456')
  const w=p.locator('.drag_verify').first(), h=p.locator('.dv_handler').first()
  const wb=await w.boundingBox(), hb=await h.boundingBox(), y=hb.y+hb.height/2
  await p.mouse.move(hb.x+hb.width/2,y); await p.mouse.down()
  for(let i=1;i<=30;i++){await p.mouse.move(hb.x+hb.width/2+((wb.x+wb.width-8-hb.x-hb.width/2)*i)/30,y);await p.waitForTimeout(10)}
  await p.mouse.up(); await p.waitForTimeout(500)
  await p.locator('button:has-text("登录")').first().click(); await p.waitForTimeout(3500)
}
;(async()=>{
  const b=await chromium.launch({executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true,args:['--no-sandbox']})
  const p=await (await b.newContext({viewport:{width:1600,height:950}})).newPage(); await login(p)
  await p.evaluate(()=>location.hash='#/douyin/notify'); await p.waitForTimeout(2800)
  // 工具栏最后一个图标（列设置）
  const icons = await p.evaluate(()=>[...document.querySelectorAll('.art-table-header button, .art-table-header [class*="icon"]')].length)
  console.log('工具栏元素数:', icons)
  const btns = await p.evaluate(()=>[...document.querySelectorAll('.el-card button, .art-table-card button')].slice(0,12).map(b=>(b.getAttribute('class')||'').slice(0,40)))
  console.log('按钮:', JSON.stringify(btns))
  // 头像 src
  const avatar = await p.evaluate(()=>{const i=document.querySelector('header img, .art-header-bar img, img[alt="avatar"]'); return i?{src:i.getAttribute('src')?.slice(0,60), w:Math.round(i.getBoundingClientRect().width), h:Math.round(i.getBoundingClientRect().height), natural:i.naturalWidth}:null})
  console.log('头像:', JSON.stringify(avatar))
  await b.close()
})().catch(e=>{console.error(e.message);process.exit(1)})
