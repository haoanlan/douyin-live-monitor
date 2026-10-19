/**
 * 打发布包（临时版，验通后再落地为 scripts/build-release.js）
 *   node scripts/tmp-pack.cjs
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));
const VER = pkg.version;
const OUT = path.join(ROOT, 'dist-release');

const FILES = [
  'web-dashboard.js', 'monitor.js', 'db-sqlite.js', 'douyin-user.js',
  'feishu-send.js', 'report-image.js', 'sync-gift-icons.js',
  'thanks-rank.js', 'thanks-rank-diamonds.js',
  'package.json', 'package-lock.json',
  'config.example.yaml', 'streamers.example.json', 'README.md'
];
const DIRS = ['lib', 'assets', 'frontend/dist'];
const SCRIPTS = [
  'reset-dashboard-password.js', 'fetch-proxy-binary.js', 'fetch-proxy-win.js',
  'db-checkpoint.js', 'db-verify.js', 'db-recover.js'
];

function cp(rel, dest) {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) { console.warn('  skip missing: ' + rel); return false; }
  const t = path.join(dest, rel);
  fs.mkdirSync(path.dirname(t), { recursive: true });
  fs.cpSync(src, t, { recursive: true });
  return true;
}

fs.mkdirSync(OUT, { recursive: true });

for (const plat of ['win', 'linux']) {
  const name = 'douyin-live-' + VER + '-' + plat;
  const dir = path.join(OUT, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  for (const f of FILES) cp(f, dir);
  for (const d of DIRS) cp(d, dir);
  for (const s of SCRIPTS) cp(path.join('scripts', s), dir);

  const proxy = plat === 'win' ? 'douyinLive-win-amd64.exe' : 'douyinLive-linux-amd64';
  const ps = path.join(ROOT, proxy);
  const hasProxy = fs.existsSync(ps);
  if (hasProxy) fs.copyFileSync(ps, path.join(dir, proxy));
  else console.warn('  ⚠ missing ' + proxy);

  if (plat === 'win') {
    fs.writeFileSync(path.join(dir, 'start.bat'),
      '@echo off\r\ncd /d %~dp0\r\nif not exist node_modules (\r\n  echo Installing dependencies, first run only...\r\n  call npm install --omit=dev\r\n)\r\necho Starting http://127.0.0.1:9871\r\nnode web-dashboard.js\r\npause\r\n', 'utf8');
  } else {
    fs.writeFileSync(path.join(dir, 'start.sh'),
      '#!/usr/bin/env bash\nset -e\ncd "$(dirname "$0")"\n[ -d node_modules ] || npm install --omit=dev\nexec node web-dashboard.js\n', 'utf8');
  }

  fs.writeFileSync(path.join(dir, 'HOW-TO-RUN.txt'),
    'douyin-live ' + VER + ' (' + name + ')\n\n' +
    '1) Node.js 20.19+\n' +
    '2) cp config.example.yaml config.yaml，填入抖音 cookie\n' +
    '3) ./start.sh（Linux）或 start.bat（Windows）；首次会自动 npm install\n' +
    '4) 打开 http://127.0.0.1:9871 ，默认 admin / 123456（立刻改密）\n\n' +
    '代理二进制：' + proxy + (hasProxy ? '（已随包提供）' : '（缺失，需另外下载）') + '\n' +
    '图片报告需要 Chromium：npx playwright install chromium，或使用系统 Chrome/Edge。\n', 'utf8');

  const zip = path.join(OUT, name + '.zip');
  fs.rmSync(zip, { force: true });
  execFileSync('powershell', ['-NoProfile', '-Command',
    'Compress-Archive -Path "' + dir + '\\*" -DestinationPath "' + zip + '" -Force'], { stdio: 'inherit' });
  console.log('✓ ' + path.basename(zip) + '  ' + (fs.statSync(zip).size / 1024 / 1024).toFixed(1) + ' MB');
}
