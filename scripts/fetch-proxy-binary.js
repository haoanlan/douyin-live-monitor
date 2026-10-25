/**
 * 下载 Go 抓取代理二进制（Windows / Linux 各一份）到项目根目录。
 *
 *   node scripts/fetch-proxy-binary.js          # 两个平台
 *   node scripts/fetch-proxy-binary.js linux    # 只要 linux
 *   node scripts/fetch-proxy-binary.js win      # 只要 windows
 *
 * 版本策略：默认取上游**最新 release**（tag / commit 从资产名里解析），
 * 避免像以前那样把 tag 写死成 v2.3.1 —— 上游一升版就 404。
 * 要固定版本时：PROXY_TAG=v2.3.2 PROXY_COMMIT=3b0c44876c2a node scripts/fetch-proxy-binary.js
 *
 * 下载走直连 → ghproxy 镜像两步回退（镜像证书可能过期，放宽校验）。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MIRROR = process.env.GH_MIRROR || 'https://ghproxy.cc/';
const REPO = 'jwwsjlm/douyinLive';
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const FIXED_TAG = process.env.PROXY_TAG || '';
const FIXED_COMMIT = process.env.PROXY_COMMIT || '';

let TAG = FIXED_TAG;
let COMMIT = FIXED_COMMIT;

function httpJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 30000, headers: { 'User-Agent': 'dyl-release-script' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error('返回不是 JSON：' + body.slice(0, 120)));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('请求超时')));
  });
}

/** 从最新 release 里解析 tag 与 commit（资产名形如 douyinLive-v2.3.2-3b0c44876c2a-linux-amd64.tar.gz） */
async function resolveLatest() {
  if (TAG && COMMIT) return { tag: TAG, commit: COMMIT };
  const rel = await httpJSON(LATEST_API);
  TAG = TAG || rel.tag_name;
  if (!COMMIT) {
    for (const a of rel.assets || []) {
      const m = String(a.name).match(/^douyinLive-(v[\d.]+)-([0-9a-f]{8,})-/);
      if (m) {
        COMMIT = m[2];
        break;
      }
    }
  }
  if (!TAG || !COMMIT) throw new Error('无法从最新 release 解析出版本号');
  return { tag: TAG, commit: COMMIT };
}

function targets() {
  return {
    linux: { asset: `douyinLive-${TAG}-${COMMIT}-linux-amd64.tar.gz`, out: 'douyinLive-linux-amd64', kind: 'tar' },
    win: { asset: `douyinLive-${TAG}-${COMMIT}-windows-amd64.zip`, out: 'douyinLive-win-amd64.exe', kind: 'zip' }
  };
}

function download(url, dest, { insecure = false } = {}) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const req = https.get(url, { timeout: 180000, rejectUnauthorized: !insecure }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        return download(res.headers.location, dest, { insecure }).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const total = Number(res.headers['content-length'] || 0);
      let got = 0;
      res.on('data', (c) => {
        got += c.length;
        if (total) process.stdout.write(`\r  下载中 ${(got / 1048576).toFixed(1)}/${(total / 1048576).toFixed(1)} MB`);
      });
      res.pipe(file);
      file.on('finish', () => {
        // 显式关闭并等待句柄释放，否则紧接着的解压会报"文件被占用"
        file.close(() => {
          process.stdout.write('\n');
          setTimeout(() => resolve(dest), 300);
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('下载超时'));
    });
  });
}

/** 带镜像回退的下载：先直连，失败换 ghproxy */
async function downloadWithFallback(assetName, dest) {
  const direct = `https://github.com/${REPO}/releases/download/${TAG}/${assetName}`;
  const mirrored = `${MIRROR}${direct}`;
  const attempts = [
    ['直连', direct, false],
    ['镜像', mirrored, true]
  ];
  for (const [label, url, insecure] of attempts) {
    try {
      console.log(`[binary] ${label} 下载 ${assetName}`);
      await download(url, dest, { insecure });
      const size = fs.statSync(dest).size;
      if (size < 1024 * 100) throw new Error(`文件过小 (${size} bytes)，可能不是有效包`);
      return { url, size, label };
    } catch (e) {
      console.log(`[binary] ${label} 失败: ${e.message}`);
    }
  }
  throw new Error(`两种方式都下载失败: ${assetName}`);
}

function extract(archive, kind, outDir, outName) {
  fs.mkdirSync(outDir, { recursive: true });
  if (kind === 'tar') {
    // Windows 10+ 自带 bsdtar
    execFileSync('tar', ['-xzf', archive, '-C', outDir], { stdio: 'inherit' });
  } else {
    execFileSync(
      'powershell',
      ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${outDir}' -Force`],
      { stdio: 'inherit' }
    );
  }
  // 归档内可执行文件名为 douyinLive / douyinLive.exe（可能带一层目录）
  const found = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/^douyinLive(\.exe)?$/i.test(e.name)) found.push(p);
    }
  };
  walk(outDir);
  if (!found.length) throw new Error(`压缩包里没找到 douyinLive 可执行文件 (${outDir})`);
  const target = path.join(ROOT, outName);
  fs.copyFileSync(found[0], target);
  try {
    fs.chmodSync(target, 0o755);
  } catch {
    /* Windows 无意义 */
  }
  return target;
}

async function main() {
  const which = (process.argv[2] || 'both').toLowerCase();
  const { tag, commit } = await resolveLatest();
  console.log(`[binary] 使用版本 ${tag} (${commit})`);
  const all = targets();
  const want = which === 'both' ? ['linux', 'win'] : [which];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dyl-proxy-'));

  for (const key of want) {
    const t = all[key];
    if (!t) {
      console.log(`未知目标: ${key}`);
      continue;
    }
    const archive = path.join(tmp, t.asset);
    const { label, size } = await downloadWithFallback(t.asset, archive);
    console.log(`[binary] 下载完成 ${(size / 1048576).toFixed(1)} MB (${label})`);
    const out = extract(archive, t.kind, path.join(tmp, key), t.out);
    console.log(`[binary] 已放置: ${path.relative(ROOT, out)}  (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`);
  }
  console.log('\n完成。');
}

main().catch((e) => {
  console.error('失败:', e.message);
  process.exitCode = 1;
});
