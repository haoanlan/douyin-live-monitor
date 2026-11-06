const authGuard = require('../auth-guard');

/**
 * 菜单 / 角色 / 权限 接口
 *
 * 阶段二：只读（GET）
 * 阶段三：可编辑（POST/PUT/DELETE）—— **注意：编辑只写这张表，鉴权仍然是
 *   auth-guard.js 里硬编码的 `role === 'R_SUPER'`**，所以改了什么都不会立刻影响
 *   谁能访问哪个页面。真生效在阶段四，必须单独一轮 + 回滚方案。
 *
 * 安全约束（都在这个文件里守）：
 *   1. 只有超管能调（requireSuper）
 *   2. **R_SUPER 角色本身不能被改** —— 否则一次误操作就能把所有人锁在外面
 *   3. 删菜单只删表里的记录，不删代码里的路由（页面照样能直接访问）
 */
module.exports = async function (pathname, query, req, res, ctx) {
  const { dbInstance, sendJSON, sendError, bodyParse } = ctx;

  if (!pathname.startsWith('/api/admin/')) return false;

  const me = authGuard.requireSuper(req, res, dbInstance, sendError);
  if (!me) return true;

  const SUPER = 'R_SUPER';

  /* ============================ 读 ============================ */

  if (req.method === 'GET') {
    if (pathname === '/api/admin/menus') {
      const items = dbInstance
        .prepare(
          `SELECT key, title, path, icon, parent_key AS parentKey, sort, visible, hidden
             FROM menu_items ORDER BY sort, key`
        )
        .all();
      return sendJSON(res, { items, count: items.length });
    }

    if (pathname === '/api/admin/roles') {
      const roles = dbInstance
        .prepare(
          `SELECT r.key, r.name, r.note,
                  (SELECT COUNT(*) FROM role_menus m WHERE m.role_key = r.key AND m.can_view = 1) AS menu_count,
                  (SELECT COUNT(*) FROM role_actions a WHERE a.role_key = r.key) AS action_count
             FROM roles r ORDER BY r.key`
        )
        .all();
      return sendJSON(res, { roles, count: roles.length });
    }

    const mRoleGet = pathname.match(/^\/api\/admin\/roles\/([^/]+)\/menus$/);
    if (mRoleGet) {
      const roleKey = decodeURIComponent(mRoleGet[1]);
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
        actions,
        locked: roleKey === SUPER
      });
    }

    if (pathname === '/api/admin/actions') {
      const actions = dbInstance
        .prepare('SELECT DISTINCT action_key AS actionKey FROM role_actions ORDER BY action_key')
        .all()
        .map((r) => r.actionKey);
      return sendJSON(res, { actions, count: actions.length });
    }
  }

  /* ============================ 菜单：增改删 ============================ */

  if (pathname === '/api/admin/menus' && req.method === 'POST') {
    const body = (await bodyParse(req)) || {};
    const key = String(body.key || '').trim();
    const title = String(body.title || '').trim();
    if (!key || !title) return sendError(res, '缺少 key 或 title', 400);
    if (dbInstance.prepare('SELECT 1 FROM menu_items WHERE key = ?').get(key)) {
      return sendError(res, `菜单标识 ${key} 已存在`, 409);
    }
    dbInstance
      .prepare('INSERT INTO menu_items (key,title,path,icon,parent_key,sort,visible,hidden) VALUES (?,?,?,?,?,?,?,?)')
      .run(key, title, body.path || null, body.icon || null, body.parentKey || null,
           Number(body.sort) || 100, Number(body.visible) ? 1 : 0, Number(body.hidden) ? 1 : 0);
    // 新菜单默认给超管（否则超管自己也看不见）
    dbInstance.prepare('INSERT OR IGNORE INTO role_menus (role_key,menu_key,can_view) VALUES (?,?,1)').run(SUPER, key);
    return sendJSON(res, { ok: true, key });
  }

  const mMenu = pathname.match(/^\/api\/admin\/menus\/([^/]+)$/);
  if (mMenu && mMenu[1] !== 'reorder') {
    const key = decodeURIComponent(mMenu[1]);
    const row = dbInstance.prepare('SELECT key FROM menu_items WHERE key = ?').get(key);
    if (!row) return sendError(res, '菜单不存在', 404);

    if (req.method === 'PUT') {
      const body = (await bodyParse(req)) || {};
      const sets = [];
      const vals = [];
      for (const [field, col] of [
        ['title', 'title'],
        ['path', 'path'],
        ['icon', 'icon'],
        ['parentKey', 'parent_key'],
        ['sort', 'sort']
      ]) {
        if (body[field] !== undefined) { sets.push(col + ' = ?'); vals.push(body[field]); }
      }
      if (body.visible !== undefined) { sets.push('visible = ?'); vals.push(Number(body.visible) ? 1 : 0); }
      if (body.hidden !== undefined) { sets.push('hidden = ?'); vals.push(Number(body.hidden) ? 1 : 0); }
      if (!sets.length) return sendError(res, '没有要修改的字段', 400);
      vals.push(key);
      dbInstance.prepare('UPDATE menu_items SET ' + sets.join(', ') + ' WHERE key = ?').run(...vals);
      return sendJSON(res, { ok: true, key });
    }

    if (req.method === 'DELETE') {
      dbInstance.prepare('DELETE FROM menu_items WHERE key = ?').run(key);
      dbInstance.prepare('DELETE FROM role_menus WHERE menu_key = ?').run(key);
      return sendJSON(res, { ok: true, key, note: '只删了表里的菜单记录，代码里的路由还在' });
    }
  }

  /* ==================== 批量改排序（拖拽后一次提交） ==================== */

  if (pathname === '/api/admin/menus/reorder' && req.method === 'POST') {
    const body = (await bodyParse(req)) || {};
    const keys = Array.isArray(body.keys) ? body.keys : [];
    if (!keys.length) return sendError(res, '缺少 keys 数组', 400);
    const upd = dbInstance.prepare('UPDATE menu_items SET sort = ? WHERE key = ?');
    const tx = dbInstance.transaction(() => {
      keys.forEach((k, i) => upd.run((i + 1) * 10, k));
    });
    tx();
    return sendJSON(res, { ok: true, count: keys.length });
  }

  /* ==================== 角色的菜单 / 操作（整份替换） ==================== */

  const mRoleMenus = pathname.match(/^\/api\/admin\/roles\/([^/]+)\/menus$/);
  if (mRoleMenus && req.method === 'PUT') {
    const roleKey = decodeURIComponent(mRoleMenus[1]);
    if (roleKey === SUPER) return sendError(res, '超管权限不可修改（防止把自己锁在外面）', 400);
    const body = (await bodyParse(req)) || {};
    const keys = Array.isArray(body.keys) ? body.keys : [];
    const tx = dbInstance.transaction(() => {
      dbInstance.prepare('DELETE FROM role_menus WHERE role_key = ?').run(roleKey);
      const ins = dbInstance.prepare('INSERT OR IGNORE INTO role_menus (role_key,menu_key,can_view) VALUES (?,?,1)');
      for (const k of keys) ins.run(roleKey, k);
    });
    tx();
    return sendJSON(res, { ok: true, roleKey, count: keys.length });
  }

  const mRoleActions = pathname.match(/^\/api\/admin\/roles\/([^/]+)\/actions$/);
  if (mRoleActions && req.method === 'PUT') {
    const roleKey = decodeURIComponent(mRoleActions[1]);
    if (roleKey === SUPER) return sendError(res, '超管权限不可修改（防止把自己锁在外面）', 400);
    const body = (await bodyParse(req)) || {};
    const keys = Array.isArray(body.keys) ? body.keys : [];
    const tx = dbInstance.transaction(() => {
      dbInstance.prepare('DELETE FROM role_actions WHERE role_key = ?').run(roleKey);
      const ins = dbInstance.prepare('INSERT OR IGNORE INTO role_actions (role_key,action_key) VALUES (?,?)');
      for (const k of keys) ins.run(roleKey, k);
    });
    tx();
    return sendJSON(res, { ok: true, roleKey, count: keys.length });
  }

  /* ==================== 角色：新建 ==================== */

  if (pathname === '/api/admin/roles' && req.method === 'POST') {
    const body = (await bodyParse(req)) || {};
    const key = String(body.key || '').trim();
    const name = String(body.name || '').trim();
    if (!key || !name) return sendError(res, '缺少 key 或 name', 400);
    if (key === SUPER) return sendError(res, '不能新建同名超管角色', 400);
    if (dbInstance.prepare('SELECT 1 FROM roles WHERE key = ?').get(key)) {
      return sendError(res, `角色 ${key} 已存在`, 409);
    }
    dbInstance.prepare('INSERT INTO roles (key,name,note) VALUES (?,?,?)').run(key, name, body.note || null);
    return sendJSON(res, { ok: true, key });
  }

  return sendError(res, `未知接口：${req.method} ${pathname}`, 404);
};
