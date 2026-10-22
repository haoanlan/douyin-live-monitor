/**
 * 抖音扫码登录 —— 用真浏览器窗口登录后自动取回 web 端 Cookie。
 *
 * ## 为什么必须弹一个"可见"的浏览器窗口
 * 这几天实测下来，三条路只有最后一条能走通：
 *
 *   1) 直接打 passport 接口（`login.douyin.com/passport/web/get_qrcode`）：
 *      `{"data":{"error_code":4031,"description":"…存在安全风险…已阻止此次访问"}}`；
 *      先请求 `ttwid/check/` 也过不去：`{"status_code":1002,"message":"check not pass"}`；
 *      `sso.douyin.com/get_qrcode` 直接返回反爬 HTML 页。
 *   2) 无头浏览器（含 `--headless=new`）：风控直接拦住，**连 get_qrcode 都不发**，二维码不出现。
 *   3) **有头真窗口 + 持久化 profile + 伪装自动化特征**：二维码正常渲染，
 *      `check_qrconnect` 开始轮询 —— 也就是下面这套。
 *
 * 抖音要的是真人环境的 JS 风险指纹与无感验证（Go 代理为此背了 485KB 的 webmssdk.js），
 * 自动化无头过不去，所以**扫码那一下必须由人完成**，这个模块负责其余全部环节。
 *
 * ## 流程
 *   起窗口 → 打开抖音 → 先看 profile 里有没有登录态（有就直接读）→
 *   没有就点开登录弹窗、等二维码、把二维码截图给前端 →
 *   读 `check_qrconnect` 返回码给出"已扫码待确认" → 轮询 cookie 直到出现 `sessionid` →
 *   拼好 Cookie 串校验后写入 config.yaml 的 cookie.douyin → 关窗口。
 */
const fs = require('fs');
const path = require('path');

/** 独立 profile：不碰用户日常浏览器的登录态，而且下次多数情况还是登录态 */
const PROFILE_DIR_NAME = '.qrlogin-profile';
/** 一次登录会话最长存活时间 */
const SESSION_TTL_MS = 5 * 60 * 1000;
/** 保存成功后窗口再留一会儿，让用户看到结果 */
const CLOSE_AFTER_SAVE_MS = 1500;

/** @type {Map<string, any>} id → session */
const sessions = new Map();

/**
 * 清理上一次崩溃留下的 Chromium profile 锁。
 *
 * 为什么需要：launchPersistentContext 用的是**固定目录** .qrlogin-profile，Chrome 会在里面放
 * SingletonLock / SingletonCookie / SingletonSocket 三个文件。进程被 kill、容器重建、
 * 或者上一次启动中途失败，这些锁都会留下；下一次启动时 Chrome 认为"已有实例在运行"，
 * **立刻退出**，而 Playwright 只会对外报一句
 *   browserType.launchPersistentContext: Target page, context or browser has been closed
 * 完全不提 profile —— 这就是最难查的那类故障。
 *
 * 安全性：SingletonLock 是 `主机名-PID` 的软链，只有它指向的 PID **确实不存在**时才删，
 * 避免把正在运行的浏览器锁删掉。
 *
 * @returns {boolean} 是否真的清理了残留锁
 */
function clearStaleProfileLock(profileDir) {
  const lockPath = path.join(profileDir, 'SingletonLock');
  let stale = false;
  try {
    const target = String(fs.readlinkSync(lockPath));
    const pid = parseInt(target.split('-').pop(), 10);
    if (!Number.isFinite(pid) || pid <= 0) {
      stale = true; // 锁内容坏掉，按残留处理
    } else {
      try {
        process.kill(pid, 0); // 进程还活着 → 不删
      } catch (e) {
        if (e.code === 'ESRCH') stale = true;
      }
    }
  } catch (e) {
    // 没有锁文件（ENOENT）：正常情况，什么都不用做
    return false;
  }
  if (!stale) return false;
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try {
      fs.unlinkSync(path.join(profileDir, name));
    } catch {
      /* 不存在就跳过 */
    }
  }
  return true;
}

/**
 * 启动失败时把"真正的原因"拼进错误信息里。
 *
 * Playwright 对 launchPersistentContext 的失败只会给一句 "…has been closed"，
 * 而实际原因可能是 DISPLAY 没接上、Xvfb 只是残留 socket、缺系统库、profile 属主不对。
 * 这里一次性把这些环境事实打出来，省得下次还要人工一条条排查。
 */
function describeLaunchEnv(profileDir, binPath) {
  const facts = [];
  facts.push(`DISPLAY=${process.env.DISPLAY || '(未设置)'}`);
  try {
    facts.push(`X11 socket=${fs.existsSync('/tmp/.X11-unix/X99') ? '有 X99' : '无 X99'}`);
  } catch {
    facts.push('X11 socket=无法检测');
  }
  try {
    const st = fs.statSync(binPath);
    facts.push(`chrome 可执行位=${st.mode & 0o111 ? '有' : '无'}`);
  } catch {
    facts.push('chrome=不存在');
  }
  try {
    const lock = fs.readlinkSync(path.join(profileDir, 'SingletonLock'));
    facts.push(`profile 锁=${lock}（存在说明上实例没退干净）`);
  } catch {
    /* 没锁是正常的，不输出 */
  }
  return facts.join(' · ');
}

/**
 * 确保 DISPLAY 指向的 X 服务真的在（有头模式必须）。
 *
 * 为什么需要：容器里 `DISPLAY=:99` 往往只是**环境变量**，Xvfb 进程在重建容器后就没了，
 * 只剩一个残留 socket 文件 —— 浏览器启动会直接退出，而报错只说 "has been closed"。
 * 这里发现 socket 不存在时**自己把 Xvfb 拉起来**（不需要用户去改启动命令）；
 * 拉不起来就把原因说清楚（Xvfb 没装 / DISPLAY 格式不对）。
 *
 * @returns {Promise<{ok: boolean, started?: boolean, reason?: string}>}
 */
async function ensureDisplay() {
  /*
   * 没设 DISPLAY 时**默认 :99**：这样 1Panel 启动命令只写 `node web-dashboard.js`
   * （不带任何 export）也能扫码 —— 否则用户还得记住加环境变量。
   * 写回 process.env，保证后面 spawn Xvfb / 启动 chrome 都继承到同一个值。
   */
  const disp = String(process.env.DISPLAY || ':99').trim();
  process.env.DISPLAY = disp;
  const m = /^:(\d+)(\.\d+)?$/.exec(disp);
  if (!m) {
    // host:0 这种远程 X 无法在本机检查，交给浏览器自己判断
    return { ok: true };
  }
  const socket = `/tmp/.X11-unix/X${m[1]}`;
  if (fs.existsSync(socket)) return { ok: true, started: false };
  // socket 不在 → 可能是残留（Xvfb 已死）或压根没起
  try {
    const { spawn } = require('child_process');
    const child = spawn('Xvfb', [disp, '-screen', '0', '1280x900x24', '-nolisten', 'tcp'], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 200));
      if (fs.existsSync(socket)) {
        console.warn(`[qrlogin] 检测到 ${disp} 没有 X 服务，已自动启动 Xvfb`);
        return { ok: true, started: true };
      }
    }
    return { ok: false, reason: `已尝试启动 Xvfb ${disp}，但 3 秒内没有出现 ${socket}` };
  } catch (e) {
    return { ok: false, reason: `Xvfb 启动失败（${e.message}）—— 容器里可能没装 xvfb：apt-get install -y xvfb` };
  }
}

/** 找一个可用的真浏览器（Playwright 自带的 chromium 也认，但有头模式下真 Chrome 更稳） */
function resolveBrowser() {
  const explicit = process.env.DOUYIN_LOGIN_BROWSER || process.env.CHROME_PATH;
  /*
   * 候选按平台给：以前 Windows 路径写死排在最前面，Linux 上虽然会被 existsSync 过滤掉，
   * 但报错/日志里会误导人（"找不到 C:\Program Files..."），也像是平台不支持。
   */
  const byPlatform =
    process.platform === 'win32'
      ? [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
        ]
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium'
          ]
        : [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser'
          ];
  const candidates = [explicit, ...byPlatform].filter(Boolean);
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  try {
    const { chromium } = require('playwright');
    const p = chromium.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * 反自动化特征。**这几个补丁是二维码能不能出来的关键**：
 * 只加 --disable-blink-features=AutomationControlled 还不够，navigator.webdriver
 * 仍然是 true，抖音的无感验证（rmc-nocaptcha）会直接把 get_qrcode 拦掉。
 */
function stealthScript() {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {}, app: {} };
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
  try {
    const origQuery = window.navigator.permissions && window.navigator.permissions.query;
    if (origQuery) {
      window.navigator.permissions.query = (p) =>
        p && p.name === 'notifications' ? Promise.resolve({ state: 'denied' }) : origQuery(p);
    }
  } catch {
    /* ignore */
  }
  try {
    const gp = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (p) {
      if (p === 37445) return 'Intel Inc.';
      if (p === 37446) return 'Intel Iris OpenGL Engine';
      return gp.apply(this, [p]);
    };
  } catch {
    /* ignore */
  }
}

/** 把浏览器 cookie 拼成 `k=v; k=v` 的请求头串（只取抖音域，同名的取后出现的） */
function buildCookieString(cookies) {
  const map = new Map();
  for (const c of cookies) {
    const domain = String(c.domain || '');
    if (!/douyin\.com$/i.test(domain.replace(/^\./, ''))) continue;
    if (!c.name) continue;
    map.set(c.name, c.value);
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

/** 关键 cookie 是否齐了：sessionid 才是"登录态" */
function hasLoginCookie(cookies) {
  return cookies.some((c) => c.name === 'sessionid' && c.value);
}

/** 找二维码图：登录弹窗里那张 ≥120px 的 data-uri 图片 */
async function captureQr(page) {
  return page.evaluate(() => {
    const box = [...document.querySelectorAll('div')].find((d) => {
      const t = (d.textContent || '').trim();
      const r = d.getBoundingClientRect();
      return /扫码登录/.test(t) && r.width > 150 && r.width < 520;
    });
    if (!box) return null;
    const img = [...box.querySelectorAll('img')].find((i) => i.naturalWidth >= 120);
    if (!img) return null;
    const r = img.getBoundingClientRect();
    if (r.width < 80) return null;
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  });
}

function publicState(s) {
  return {
    id: s.id,
    state: s.state,
    message: s.message,
    qr: s.qr,
    startedAt: s.startedAt,
    updatedAt: s.updatedAt,
    scannedAt: s.scannedAt || null,
    savedAt: s.savedAt || null,
    error: s.error || '',
    browser: s.browser || ''
  };
}

/** 结束会话：关窗口 + 清定时器 */
async function closeSession(id, keepState = false) {
  const s = sessions.get(id);
  if (!s) return;
  if (s.timer) clearInterval(s.timer);
  if (s.ttl) clearTimeout(s.ttl);
  try {
    await s.ctx.close();
  } catch {
    /* 用户可能已经手动关了窗口 */
  }
  if (!keepState) sessions.delete(id);
}

/** 启动一次扫码登录会话 */
async function startSession({ root, onSaved }) {
  // 已有进行中的会话就直接复用，避免开出两个窗口；
  // 但先确认那个窗口还活着（用户可能手动关了，或者仪表盘被重启过）
  for (const s of [...sessions.values()]) {
    if (['saved', 'error', 'cancelled', 'timeout'].includes(s.state)) continue;
    let alive = false;
    try {
      alive = Boolean(s.ctx && s.ctx.pages() && s.ctx.pages().length >= 0);
    } catch {
      alive = false;
    }
    if (alive) return { ok: true, reused: true, ...publicState(s) };
    await closeSession(s.id);
  }
  const binPath = resolveBrowser();
  if (!binPath) {
    return {
      ok: false,
      error:
        '找不到可用的浏览器（Chrome / Edge）。可设环境变量 DOUYIN_LOGIN_BROWSER 指向浏览器可执行文件'
    };
  }
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (e) {
    return { ok: false, error: `未安装 playwright：${e.message}` };
  }

  const id = `qr${Date.now().toString(36)}`;
  const profileDir = path.join(root, PROFILE_DIR_NAME);
  fs.mkdirSync(profileDir, { recursive: true });

  const session = {
    id,
    state: 'starting',
    message: '正在打开登录窗口…',
    qr: null,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    scannedAt: null,
    savedAt: null,
    error: '',
    browser: binPath,
    lastQrStatus: null,
    ctx: null,
    page: null,
    timer: null,
    ttl: null
  };
  sessions.set(id, session);

  try {
    // 有头模式必须有真正的 X 服务：DISPLAY 只是个环境变量，Xvfb 可能已经没了
    if (process.env.DOUYIN_LOGIN_HEADLESS !== '1') {
      const x = await ensureDisplay();
      if (!x.ok) {
        session.state = 'error';
        session.message = '启动登录窗口失败';
        session.error = `X 服务不可用：${x.reason}`;
        await closeSession(id, true);
        return { ok: false, error: session.error, ...publicState(session) };
      }
    }
    // 先清掉上次崩溃留下的 profile 锁：Chrome 会认为"已有实例在运行"并立刻退出，
    // Playwright 只会报 "has been closed"，从报错里完全看不出是 profile 的问题。
    if (clearStaleProfileLock(profileDir)) {
      console.warn('[qrlogin] 检测到上次残留的 profile 锁，已清理');
    }
    const launchOptions = {
      executablePath: binPath,
      // 默认有头：作者实测无头会被风控挡住（连 get_qrcode 都不发，二维码不出现）。
      // 但无头能省掉服务器上的 Xvfb，所以留一个开关：
      //   DOUYIN_LOGIN_HEADLESS=1 → 强制无头（需自行验证抖音是否还放行）
      headless: process.env.DOUYIN_LOGIN_HEADLESS === '1',
      viewport: { width: 1180, height: 860 },
      locale: 'zh-CN',
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        // 容器里 /dev/shm 通常只有 64MB，Chrome 启动会因共享内存不足直接退出
        // （表现就是 "Target page, context or browser has been closed"）。这两个参数是容器里的标配。
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--no-zygote'
      ]
    };
    let ctx;
    try {
      ctx = await chromium.launchPersistentContext(profileDir, launchOptions);
    } catch (firstErr) {
      const msg = String((firstErr && firstErr.message) || firstErr);
      // 这句报错的真实原因通常在 profile 锁 / Xvfb / 缺系统库上：清锁重试一次再决定
      if (/has been closed|Failed to launch|Singleton/i.test(msg)) {
        clearStaleProfileLock(profileDir);
        console.warn(`[qrlogin] 启动失败：${msg.slice(0, 120)}；清理 profile 锁后重试一次`);
        ctx = await chromium.launchPersistentContext(profileDir, launchOptions);
      } else {
        throw firstErr;
      }
    }
    await ctx.addInitScript(stealthScript);
    session.ctx = ctx;
    const page = ctx.pages()[0] || (await ctx.newPage());
    session.page = page;

    // 读 check_qrconnect 的状态码：1=未扫码 2=已扫码待确认 3=确认成功
    page.on('response', async (r) => {
      if (!/check_qrconnect/i.test(r.url())) return;
      try {
        const j = JSON.parse(await r.text());
        const st = j?.data?.status;
        session.lastQrStatus = st;
        if (st === 2 && !session.scannedAt) {
          session.scannedAt = Date.now();
          session.state = 'scanned';
          session.message = '已扫码，请在手机上确认登录';
          session.updatedAt = Date.now();
        }
      } catch {
        /* 非 JSON 就忽略 */
      }
    });

    session.state = 'loading';
    session.message = '正在打开抖音…';
    await page.goto('https://www.douyin.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3000);

    // profile 里已经有登录态就直接用，不用再扫
    const existing = await ctx.cookies('https://www.douyin.com');
    if (hasLoginCookie(existing)) {
      return await finishSave(session, existing, onSaved);
    }

    // 点开登录弹窗
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('div,span,button,a')].find((e) =>
        ['登录', '登录/注册', '立即登录'].includes((e.textContent || '').trim())
      );
      el?.click();
    });
    session.state = 'waiting';
    session.message = '正在获取二维码…';
    session.updatedAt = Date.now();

    // 轮询：抓二维码 + 等 sessionid
    const grabQr = async () => {
      try {
        /*
         * 优先直接读 DOM 里的二维码图。
         *
         * 实测抖音把二维码渲染成 <img src="data:image/png;base64,...">（约 178×178），
         * 直接取 src 拿到的就是**原图**：不受页面缩放/DPR/滚动影响，也不会有
         * 「几何推断偏了 → 截到半张或糊掉」这类问题。
         * 读不到时再退回下面「captureQr() + clip 截图」的老办法兜底。
         */
        try {
          const dataUrl = await session.page.evaluate(() => {
            const img = [...document.querySelectorAll('img')].find((el) => {
              const r = el.getBoundingClientRect();
              return (
                (el.currentSrc || el.src || '').startsWith('data:image/') &&
                Math.abs(r.width - r.height) <= 8 &&
                r.width >= 100 &&
                r.width <= 400
              );
            });
            return img ? img.currentSrc || img.src : null;
          });
          if (dataUrl) {
            session.qr = dataUrl;
            session.updatedAt = Date.now();
            return true;
          }
        } catch {
          /* 取不到就继续走截图兜底 */
        }

        const clip = await captureQr(session.page);
        if (clip) {
          const buf = await session.page.screenshot({ clip });
          session.qr = `data:image/png;base64,${buf.toString('base64')}`;
          session.updatedAt = Date.now();
          return true;
        }
        // 抓不到二维码时打一行诊断，方便判断是"没弹窗"还是"被风控挡住"
        if (Date.now() - (session.lastDiagAt || 0) > 8000) {
          session.lastDiagAt = Date.now();
          const diag = await session.page
            .evaluate(() => {
              const box = [...document.querySelectorAll('div')].find((d) => {
                const t = (d.textContent || '').trim();
                const r = d.getBoundingClientRect();
                return /扫码登录/.test(t) && r.width > 150 && r.width < 520;
              });
              return {
                url: location.href.slice(0, 60),
                modal: !!box,
                maxImg: Math.max(0, ...[...document.querySelectorAll('img')].map((i) => i.naturalWidth)),
                text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 70)
              };
            })
            .catch(() => null);
          if (!diag) {
            /*
             * 页面被关掉 ≠ "抓不到二维码"。
             * 原来这里也打「还没抓到二维码: {"url":"(页面已关闭)"}」，
             * 用户实测看到这行以为又出了新问题 —— 实际只是首次启动失败后重试时旧页面已关闭。
             */
            session.pageClosed = true;
            console.warn('[qrlogin] 登录页已被关闭，停止等待二维码');
          } else {
            console.log('[qrlogin] 还没抓到二维码:', JSON.stringify(diag));
          }
        }
      } catch {
        /* 窗口被关掉 / 页面切换中 */
      }
      return false;
    };

    /*
     * 等二维码出来再返回给前端。
     * 实测：打开抖音 → 落到精选页 → 点登录 → 弹窗 → 画出二维码，整条链路 5~15 秒，
     * 若一启动就返回，抽屉里会先空着十几秒（用户以为坏了）。
     */
    const qrDeadline = Date.now() + 25000;
    while (Date.now() < qrDeadline) {
      if (await grabQr()) break;
      // 页面已经关了就别再空转 25 秒（见 grabQr 里 pageClosed 的说明）
      if (session.pageClosed) break;
      await page.waitForTimeout(700);
    }
    session.message = session.qr ? '等待扫码' : '没拿到二维码，请查看弹出的浏览器窗口';
    session.updatedAt = Date.now();

    session.timer = setInterval(async () => {
      if (['saved', 'error', 'cancelled', 'timeout'].includes(session.state)) return;
      try {
        const cookies = await session.ctx.cookies('https://www.douyin.com');
        if (hasLoginCookie(cookies)) {
          await finishSave(session, cookies, onSaved);
          return;
        }
        if (!session.qr) await grabQr();
        // 二维码过期时页面会提示，重新抓一张（页面会自动换新码）
        const gone = await session.page
          .evaluate(() => /二维码已失效|已过期|点击刷新|重新获取/.test(document.body.innerText || ''))
          .catch(() => false);
        if (gone) {
          session.qr = null;
          session.state = 'waiting';
          session.message = '二维码已过期，正在刷新…';
          session.updatedAt = Date.now();
          await session.page.waitForTimeout(800);
          await grabQr();
        }
      } catch (e) {
        session.state = 'error';
        session.error = `窗口已关闭或页面异常：${String(e.message || e).slice(0, 120)}`;
        session.message = '登录窗口已关闭';
        session.updatedAt = Date.now();
        await closeSession(session.id, true);
      }
    }, 1500);

    session.ttl = setTimeout(async () => {
      if (['saved', 'error', 'cancelled'].includes(session.state)) return;
      session.state = 'timeout';
      session.message = '等待超时（5 分钟），请重新发起';
      session.updatedAt = Date.now();
      await closeSession(session.id, true);
    }, SESSION_TTL_MS);

    return { ok: true, ...publicState(session) };
  } catch (e) {
    session.state = 'error';
    const raw = String((e && e.message) || e);
    /*
     * 千万不能整体截断。Playwright 的报错结构是：
     *   browserType.launchPersistentContext: Target page, context or browser has been closed
     *   Browser logs:
     *   <launching> /path/chrome --disable-…
     *   [pid=123][err] <真正的死因>          ← 这行才是关键
     * 原来 slice(0,200) 正好把它切掉，等于把唯一的线索删了。
     */
    const errLines = raw
      .split('\n')
      .filter((l) =>
        /\[err\]|not found|Permission denied|Missing X server|error while loading|failed to launch|cannot open shared object|No such file/i.test(
          l
        )
      )
      .map((l) => l.trim());
    const head = raw.split('\n')[0].slice(0, 200);
    const tail = errLines.join(' | ').slice(0, 600);
    session.error = `${head}${tail ? '；浏览器日志：' + tail : ''}（${describeLaunchEnv(profileDir, binPath)}）`;
    // 完整原文只进服务端日志，方便整段贴出来排查
    console.error(`[qrlogin] 启动失败（完整报错）：\n${raw}`);
    session.message = '启动登录窗口失败';
    await closeSession(id, true);
    return { ok: false, error: session.error, ...publicState(session) };
  }
}

/** 拿到登录态后的收尾：校验 → 写 config.yaml → 关窗口 */
async function finishSave(session, cookies, onSaved) {
  if (session.state === 'saved') return { ok: true, ...publicState(session) };
  const cookieString = buildCookieString(cookies);
  let result = { ok: true };
  try {
    result = (await onSaved(cookieString)) || { ok: true };
  } catch (e) {
    result = { ok: false, error: String(e.message || e) };
  }
  session.qr = null;
  if (!result.ok) {
    session.state = 'error';
    session.error = result.error || '写入配置失败';
    session.message = '已登录，但写入 config.yaml 失败';
  } else {
    session.state = 'saved';
    session.savedAt = Date.now();
    session.message = result.message || '登录成功，Cookie 已写入 config.yaml';
  }
  session.updatedAt = Date.now();
  setTimeout(() => closeSession(session.id, true), CLOSE_AFTER_SAVE_MS);
  return { ok: true, ...publicState(session) };
}

function getStatus(id) {
  const s = sessions.get(id);
  if (!s) return { ok: false, error: '登录会话不存在或已结束' };
  return { ok: true, ...publicState(s) };
}

async function cancelSession(id) {
  const s = sessions.get(id);
  if (!s) return { ok: true, message: '会话已结束' };
  s.state = 'cancelled';
  s.message = '已取消';
  s.updatedAt = Date.now();
  await closeSession(id);
  return { ok: true, message: '已取消扫码登录' };
}

/** 进程退出时尽量关掉窗口，别留下孤立浏览器 */
async function closeAll() {
  for (const id of [...sessions.keys()]) await closeSession(id);
}

module.exports = {
  startSession,
  getStatus,
  cancelSession,
  closeAll,
  resolveBrowser,
  buildCookieString,
  hasLoginCookie,
  PROFILE_DIR_NAME
};
