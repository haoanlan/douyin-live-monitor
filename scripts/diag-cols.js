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
  // 点最后一个图标（列设置）
  await p.locator('#art-table-header .el-dropdown').last().click()
  await p.waitForTimeout(800)
  const dump=await p.evaluate(()=>{
    const pop=[...document.querySelectorAll('.el-popper')].filter(e=>e.offsetParent!==null)
    return pop.map(e=>({cls:e.className.slice(0,60), html:e.innerHTML.slice(0,400), h:Math.round(e.getBoundingClientRect().height)}))
  })
  console.log(JSON.stringify(dump,null,1).slice(0,1500))
  await b.close()
})().catch(e=>{console.error(e.message);process.exit(1)})
