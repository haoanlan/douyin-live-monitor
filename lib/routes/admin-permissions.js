const authGuard = require('../auth-guard');

/**
 * 菜单 / 角色 / 权限 —— **阶段二：只读接口**
 *
 * 只提供"看"的能力：菜单清单、角色清单、每个角色勾了哪些菜单和操作。
 * 没有任何写接口 —— 阶段三才打开编辑，阶段四才让这套表接管鉴权。
 *
 * 为什么先只读：这套表目前**不参与任何判断**（auth-guard.js 还是硬编码 R_SUPER）。
 * 先把数据摆出来，让用户核对"灌进去的 11 个菜单 / 2 个角色 / 8 个操作对不对"，
 * 确认无误再谈"让它生效" —— 否则一旦生效出错，就是所有人进不去或越权。
 */
module.exports = async function (pathname, query, req, res, ctx) {
  const { dbInstance, sendJSON, sendError } = ctx;

  if (!pathname.startsWith('/api/admin/')) return false;
  if (req.method !== 'GET') {
    return sendError(res, '阶段二只提供只读接口（编辑功能在阶段三）', 405);
  }

  const me = authGuard.requireSuper(req, res, dbInstance, sendError);
  if (!me) return true;

  /* 菜单清单（按 sort，树形由前端按 parent_key 组装） */
  if (pathname === '/api/admin/menus') {
    const items = dbInstance
      .prepare(
        `SELECT key, title, path, icon, parent_key AS parentKey,
                sort, visible, hidden
           FROM menu_items
          ORDER BY sort, key`
      )
      .all();
    return sendJSON(res, { items, count: items.length });
  }

  /* 角色清单 + 每个角色的菜单数/操作数（一眼看出配漏没） */
  if (pathname === '/api/admin/roles') {
    const roles = dbInstance
      .prepare(
        `SELECT r.key, r.name, r.note,
                (SELECT COUNT(*) FROM role_menus m WHERE m.role_key = r.key AND m.can_view = 1) AS menu_count,
                (SELECT COUNT(*) FROM role_actions a WHERE a.role_key = r.key) AS action_count
           FROM roles r
          ORDER BY r.key`
      )
      .all();
    return sendJSON(res, { roles, count: roles.length });
  }

  /* 某个角色的菜单勾选情况 + 全部菜单（供前端画勾选矩阵） */
  const mRole = pathname.match(/^\/api\/admin\/roles\/([^/]+)\/menus$/);
  if (mRole) {
    const roleKey = decodeURIComponent(mRole[1]);
    const role = dbInstance.prepare('SELECT key, name FROM roles WHERE key = ?').get(roleKey);
    if (!role) return sendError(res, '角色不存在', 404);

    const menus = dbInstance
      .prepare('SELECT key, title, parent_key AS parentKey, sort, hidden FROM menu_items ORDER BY sort, key')
      .all();
    const granted = new Set(
      dbInstance
        .prepare('SELECT menu_key FROM role_menus WHERE role_key = ? AND can_view = 1')
        .all(roleKey)
        .map((r) => r.menu_key)
    );
    const actions = dbInstance
      .prepare('SELECT action_key AS actionKey FROM role_actions WHERE role_key = ? ORDER BY action_key')
      .all(roleKey)
      .map((r) => r.actionKey);

    return sendJSON(res, {
      role,
      menus: menus.map((m) => ({ ...m, canView: granted.has(m.key) })),
      grantedCount: granted.size,
      actions
    });
  }

  /* 全部可选的操作（画勾选列表用；阶段二只展示，不校验） */
  if (pathname === '/api/admin/actions') {
    const actions = dbInstance
      .prepare('SELECT DISTINCT action_key AS actionKey FROM role_actions ORDER BY action_key')
      .all()
      .map((r) => r.actionKey);
    return sendJSON(res, { actions, count: actions.length });
  }

  return false;
};
