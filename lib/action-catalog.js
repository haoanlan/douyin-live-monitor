/**
 * 操作级权限清单（唯一来源）。
 *
 * 为什么单独一个文件：以前 `role_actions` 只塞了 8 个粗粒度 key
 * （比如 `service.restart` 一个就代表"启动/停止/重启"），
 * 角色管理页只能显示一串英文 key，也没法把「暂停」「删除」这类动作分开授权。
 *
 * 现在按**实际会改动状态的操作**拆开，一条操作一个 key：
 *   - 房间：新增 / 暂停 / 恢复 / 删除
 *   - 监控与代理：启动停止重启 / 代理配置
 *   - 数据：改礼物价格 / 补录 / 撤销补录 / 合并虚拟用户 / 删除场次
 *   - 账号与权限：账号管理 / 角色管理 / 菜单管理
 *   - 登录：扫码登录
 *
 * group 只用于前端分组显示，不影响存储。
 */
const ACTION_CATALOG = [
  { key: 'room.add', label: '新增房间', group: '房间' },
  { key: 'room.pause', label: '暂停监控', group: '房间' },
  { key: 'room.resume', label: '恢复监控', group: '房间' },
  { key: 'room.remove', label: '删除房间', group: '房间' },

  { key: 'service.start', label: '启动监控', group: '服务' },
  { key: 'service.stop', label: '停止监控', group: '服务' },
  { key: 'service.restart', label: '重启监控', group: '服务' },
  { key: 'service.proxy_restart', label: '重启代理', group: '服务' },
  { key: 'proxy_config.write', label: '修改代理配置', group: '服务' },

  { key: 'gift_price.write', label: '修改礼物价格', group: '数据' },
  { key: 'gift_price.repair', label: '重算历史单价', group: '数据' },
  { key: 'manual_gift.add', label: '补录礼物', group: '数据' },
  { key: 'manual_gift.delete', label: '撤销补录', group: '数据' },
  { key: 'manual_user.merge', label: '合并虚拟用户', group: '数据' },
  { key: 'session.delete', label: '删除场次', group: '数据' },

  { key: 'account.manage', label: '账号管理', group: '系统' },
  { key: 'role.manage', label: '角色管理', group: '系统' },
  { key: 'menu.manage', label: '菜单管理', group: '系统' },
  { key: 'notify.manage', label: '通知规则管理', group: '系统' },
  { key: 'notify.test', label: '通知测试发送', group: '系统' },

  { key: 'qrlogin.start', label: '扫码登录', group: '登录' }
];

const ACTION_KEYS = ACTION_CATALOG.map((a) => a.key);

/** 老 key → 新 key（库里已有这些值，读权限时做一次等价映射，避免升级后"权限没了"） */
const LEGACY_ACTION_ALIASES = {
  'service.restart': ['service.start', 'service.stop', 'service.restart']
};

function expandLegacyKeys(keys) {
  const out = new Set();
  for (const k of keys || []) {
    out.add(k);
    for (const alt of LEGACY_ACTION_ALIASES[k] || []) out.add(alt);
  }
  return [...out];
}

module.exports = { ACTION_CATALOG, ACTION_KEYS, LEGACY_ACTION_ALIASES, expandLegacyKeys };
