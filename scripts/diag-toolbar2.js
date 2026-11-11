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
  await p.locator('.el-tabs__item:has-text("发送记录"), button:has-text("发送记录")').first().click().catch(()=>{})
  await p.waitForTimeout(1500)
  const html=await p.evaluate(()=>{
    const card=document.querySelector('.art-table-card')||document.querySelector('.el-card')
    return card ? card.innerHTML.slice(0,1500) : null
  })
  console.log(html)
  await b.close()
})().catch(e=>{console.error(e.message);process.exit(1)})
