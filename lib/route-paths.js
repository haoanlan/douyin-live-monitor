/**
 * 菜单路径一致性自检（2026-11-09）
 *
 * 为什么需要：库里的 `menu_items.path` 是**页面权限**（role_menus）的匹配依据，
 * 而前端实际能不能进页面看的是路由。两者对不上时不会报错，只会表现为
 * "点一下被弹回首页 / 菜单里勾了也没用"。这类 bug 已经撞了三次：
 *   1. 个人中心：库里 /user-center，真实路由 /douyin/account（访客进不去）
 *   2. 参数型页面：/douyin/detail/:id 从不在 menu_items 里，非超管被剪掉
 *   3. 历史遗留：早期种子里 /douyin/system/users 之类压根不存在的路径
 *
 * 这里只做**检查 + 打日志**，不改数据（自动改库风险太大，尤其是有用户手工改过路径）。
 * 启动时跑一次，对不上就在控制台明确列出来。
 *
 * 注意：新增前端页面时，要同步往 PAGE_PATHS 里加一行，否则会被报"缺菜单记录"。
 */

/** 前端真实存在的页面级路由（= router/modules/*.ts 里的 path 拼出来的完整路径） */
const PAGE_PATHS = [
  '/douyin/dashboard',
  '/douyin/rooms',
  '/douyin/sessions',
  '/douyin/trends',
  '/douyin/combined',
  '/douyin/gift-prices',
  '/douyin/search',
  '/douyin/status',
  '/douyin/notify',
  '/douyin/account',
  '/system/user',
  '/system/role',
  '/system/menu'
];

/** 目录型（分组）路由：menu_items 里出现是正常的，但不对应页面权限 */
const GROUP_PATHS = ['/douyin', '/system'];

/** 参数型路由：只能从列表点进去，本来就不该出现在菜单表里 */
const PARAM_PREFIXES = ['/douyin/detail/', '/douyin/profile/'];

function checkMenuPaths(db, opts = {}) {
  const quiet = opts.quiet === true;
  let rows;
  try {
    rows = db.prepare('SELECT key, title, path FROM menu_items').all();
  } catch {
    return { problems: [], missing: [] };
  }

  const known = new Set([...PAGE_PATHS, ...GROUP_PATHS]);
  const problems = [];
  for (const r of rows) {
    const p = String(r.path || '').trim();
    if (!p) continue;
    if (known.has(p)) continue;
    if (PARAM_PREFIXES.some((x) => p.startsWith(x))) continue;
    problems.push(`${r.key}「${r.title}」→ ${p}`);
  }

  const have = new Set(rows.map((r) => String(r.path || '').trim()));
  const missing = PAGE_PATHS.filter((p) => !have.has(p));

  if (problems.length) {
    console.warn(
      '[menu-check] 以下菜单路径在前端**不存在对应路由**（这些页面的权限勾选不会生效）：\n  ' +
        problems.join('\n  ')
    );
  }
  if (missing.length) {
    console.warn(
      '[menu-check] 以下前端页面在 menu_items 里**没有记录**（角色管理里无法勾选它们）：\n  ' +
        missing.join('\n  ')
    );
  }
  if (!problems.length && !missing.length && !quiet) {
    console.log(`[menu-check] 菜单路径与前端路由一致 ✓（${PAGE_PATHS.length} 个页面）`);
  }
  return { problems, missing };
}

module.exports = { checkMenuPaths, PAGE_PATHS, GROUP_PATHS, PARAM_PREFIXES };
