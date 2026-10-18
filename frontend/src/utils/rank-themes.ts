/**
 * 榜单模板的中文名（`thanks-rank.js` 里的 theme key → 可读名字）。
 *
 * 只有一个来源：场次详情的「送礼人员榜单」弹窗和「数据合并查看」的感谢榜单弹窗都用它，
 * 以前两处各抄了一份（改一个忘另一个）。
 *
 * 没覆盖到的 key 直接回落成原始 key —— 脚本以后加模板也不会显示不出来。
 */
export const RANK_THEME_LABELS: Record<string, string> = {
  classic: '经典暗紫',
  'depth-glass': '玻璃质感',
  'depth-stack': '层叠玻璃',
  'magazine-v1': '杂志封面 A',
  'magazine-v2': '杂志封面 B',
  noir: '黑白胶片',
  typegrid: '字体网格',
  cute: '可爱手绘',
  news: '报纸排版',
  ghost: '幽灵夜行',
  faces: '人像拼贴',
  ruler: '刻度尺',
  'chroma-bar': '色带',
  'chroma-tile': '色块拼贴',
  'chroma-refined': '精致色块'
}

export function rankThemeLabel(theme: string): string {
  return RANK_THEME_LABELS[theme] || theme
}
