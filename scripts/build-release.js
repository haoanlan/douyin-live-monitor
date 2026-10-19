/**
 * 打发布包：Windows / Linux 各一份。
 *   node scripts/build-release.js
 * 产物：dist-release/douyin-live-<ver>-win.zip  ← 自带 node_modules 与本平台代理，解压即用
 *       dist-release/douyin-live-<ver>-linux.zip ← 不含二进制依赖，用 Docker 或 Node 20 LTS 安装
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));
const VER = pkg.version;
const OUT = path.join(ROOT, 'dist-release');

const FILES = [
  'web-dashboard.js',
  'monitor.js',
  'db-sqlite.js',
  'douyin-user.js',
  'feishu-send.js',
  'report-image.js',
  'sync-gift-icons.js',
  'thanks-rank.js',
  'package.json',
  'package-lock.json',
  'config.example.yaml',
  'streamers.example.json',
  'README.md'
];
const DIRS = ['lib', 'assets', 'frontend/dist'];
const SCRIPTS = [
  'reset-dashboard-password.js',
  'fetch-proxy-binary.js',
  'fetch-proxy-win.js',
  'db-checkpoint.js',
  'db-verify.js',
  'db-recover.js'
];

function cp(rel, dest) {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) {
    console.warn('  skip missing: ' + rel);
    return false;
  }
  const target = path.join(dest, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(src, target, { recursive: true });
  return true;
}

function writeLauncher(dir, plat, proxy, hasProxy) {
  if (plat === 'win') {
    fs.writeFileSync(
      path.join(dir, 'start.bat'),
      '@echo off\r\ncd /d %~dp0\r\necho Starting http://127.0.0.1:9871\r\nnode web-dashboard.js\r\npause\r\n',
      'utf8'
    );
  } else {
    fs.writeFileSync(
      path.join(dir, 'start.sh'),
      '#!/usr/bin/env bash\nset -e\ncd "$(dirname "$0")"\n[ -d node_modules ] || npm install --omit=dev\nexec node web-dashboard.js\n',
      'utf8'
    );
  }

  fs.writeFileSync(
    path.join(dir, 'HOW-TO-RUN.txt'),
    'douyin-live ' + VER + ' (' + plat + ')\n\n' +
      '1) Node.js 20.19+（Windows 包已内置 node_modules，无需 npm install）\n' +
      '2) 把 config.example.yaml 复制为 config.yaml，填入抖音 cookie\n' +
      '3) Windows: 双击 start.bat；Linux: ./start.sh\n' +
      '4) 打开 http://127.0.0.1:9871，默认账号 admin / 123456（请立刻改密）\n\n' +
      '代理二进制：' + proxy + (hasProxy ? '（已随包提供）' : '（需另外获取）') + '\n' +
      '图片报告需要 Chromium：npx playwright install chromium，或使用系统 Chrome/Edge。\n',
    'utf8'
  );
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
  const proxySrc = path.join(ROOT, proxy);
  const hasProxy = fs.existsSync(proxySrc);
  if (hasProxy) fs.copyFileSync(proxySrc, path.join(dir, proxy));
  else console.warn('  missing ' + proxy);

  // Windows 包内置 node_modules：better-sqlite3 是原生模块，Node 22 无预编译包，
  // 用户机器上 npm install 会触发本地编译（需要 VS Build Tools）→ 直接带上即可解压即用。
  if (plat === 'win') {
    const nm = path.join(ROOT, 'node_modules');
    if (fs.existsSync(nm)) {
      console.log('  bundling node_modules into ' + name + ' ...');
      fs.cpSync(nm, path.join(dir, 'node_modules'), { recursive: true });
    }
  }

  writeLauncher(dir, plat, proxy, hasProxy);

  const zip = path.join(OUT, name + '.zip');
  fs.rmSync(zip, { force: true });
  // 用 .NET ZipFile：PS5 的 Compress-Archive 会写出反斜杠条目（非标准 zip），
  // 导致 Expand-Archive / 第三方解压器解出 0 个文件 ✗
  execFileSync('powershell', ['-NoProfile', '-Command',
    'Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory("' + dir + '", "' + zip + '", [IO.Compression.CompressionLevel]::Optimal, $false)'
  ], { stdio: 'inherit' });
  console.log('OK ' + path.basename(zip) + '  ' + (fs.statSync(zip).size / 1024 / 1024).toFixed(1) + ' MB');
}
