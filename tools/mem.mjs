#!/usr/bin/env node
/**
 * memory-chain / tools / mem.mjs  —— 框架无关的记忆网关
 * 作者：鲸跃 · 2026-10-26
 *
 * 链 = 权威副本（可 diff / 可回滚 / 不锁模型）
 * 向量 = 派生物（可随时重建；本文件只做规模预演，不搬正文）
 *
 * 命令：chains / latest / index / recall / check / append / reindex
 * 根目录：DSH_HANDOFF_DIR > $DSH_HOME/handoff > ~/.dsh/handoff
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import process from 'node:process'

const 链前缀 = /^\d{4}-\d{2}-\d{2}_/
const TICK = String.fromCharCode(96)

function 根目录() {
  if (process.env.DSH_HANDOFF_DIR) return process.env.DSH_HANDOFF_DIR
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'handoff')
}

function slug(目录) {
  return String(目录).replace(/[:\\/]/g, '-')
}

function 工作区根() {
  const 根 = 根目录()
  const 本区 = path.join(根, slug(process.cwd()))
  if (fs.existsSync(本区)) return 本区
  try {
    const 候选 = fs.readdirSync(根, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== '_raw')
      .map((e) => path.join(根, e.name))
    if (候选.length === 1) return 候选[0]
  } catch (e) {}
  return 本区
}

function 读文本(p) { return fs.readFileSync(p, 'utf8') }

function 记录们(目录) {
  let 名们 = []
  try { 名们 = fs.readdirSync(目录) } catch (e) { return [] }
  return 名们
    .filter((n) => n.endsWith('.md'))
    .filter((n) => n !== 'INDEX.md')
    .filter((n) => n !== 'DECISIONS.md')
    .filter((n) => n.indexOf('_memo_') === -1)
    .filter((n) => n.indexOf('legacy-') !== 0)
    .sort()
    .map((n) => path.join(目录, n))
}

function 索引条目(索引路径) {
  const 文 = 读文本(索引路径)
  const 出 = []
  文.split(/\r?\n/).forEach((行, i) => {
    const t = 行.trim()
    if (t.indexOf('- ' + TICK) !== 0) return
    const m = /^- .(\d{4}).\s*·\s*(.*)$/.exec(t)
    if (m) 出.push({ 行号: i + 1, 时间码: m[1], 内容: m[2], 原文: 行 })
  })
  return 出
}

function 头部份数(索引路径) {
  try {
    const m = /共\s*(\d+)\s*份/.exec(读文本(索引路径))
    return m ? Number(m[1]) : null
  } catch (e) { return null }
}

function 是旁支(名, 索引路径) {
  if (/-dsh$|-qq$|-fork$/.test(名)) return true
  try { return 读文本(索引路径).indexOf('旁支链') !== -1 } catch (e) { return false }
}

function 归档条目数(目录) {
  const d = path.join(目录, '_archive')
  let 数 = 0
  try {
    for (const f of fs.readdirSync(d)) {
      if (!f.startsWith('INDEX-') || !f.endsWith('.md')) continue
      数 += 索引条目(path.join(d, f)).length
    }
  } catch (e) {}
  return 数
}

function 列链(区) {
  区 = 区 || 工作区根()
  let 目录们 = []
  try {
    目录们 = fs.readdirSync(区, { withFileTypes: true })
      .filter((e) => e.isDirectory() && 链前缀.test(e.name))
      .map((e) => path.join(区, e.name))
  } catch (e) { return [] }
  return 目录们.map((目录) => {
    const 名 = path.basename(目录)
    const 文件们 = 记录们(目录)
    const 索引路径 = path.join(目录, 'INDEX.md')
    const 索引行 = fs.existsSync(索引路径) ? 索引条目(索引路径) : []
    return {
      名: 名, 目录: 目录, 文件们: 文件们, 索引行: 索引行,
      份数: 文件们.length, 索引数: 索引行.length + 归档条目数(目录),
      最新: 文件们.length ? 文件们[文件们.length - 1] : null,
      旁支: 是旁支(名, 索引路径)
    }
  }).sort((a, b) => a.名.localeCompare(b.名))
}

function 取参(args, 名) {
  const i = args.indexOf(名)
  return i >= 0 ? args[i + 1] : ''
}

// ───────────── 命令 ─────────────

function cmdChains() {
  const 区 = 工作区根()
  const 链们 = 列链(区)
  if (!链们.length) { console.log('没有找到任何链：' + 区); return 0 }
  console.log('工作区：' + 区)
  console.log('')
  let 总份 = 0
  for (const c of 链们) {
    总份 += c.份数
    const 差 = c.份数 === c.索引数 ? '' : '  ⚠ 索引 ' + c.索引数 + ' 条'
    const 标 = c.旁支 ? '旁支' : '主线'
    console.log('  [' + 标 + '] ' + c.名 + '  ' + c.份数 + ' 份' + 差)
    if (c.最新) console.log('         最新：' + path.basename(c.最新))
  }
  console.log('')
  console.log('共 ' + 链们.length + ' 条链 / ' + 总份 + ' 份记录')
  return 0
}

function cmdLatest(args) {
  const 链名 = 取参(args, '--chain')
  const 全区 = args.indexOf('--all') >= 0
  const 链们 = 列链().filter((c) => (链名 ? c.名 === 链名 : true))
  if (!链们.length) { console.error('没有匹配的链'); return 1 }

  if (链名) {
    const c = 链们[0]
    if (!c.最新) { console.error('这条链还没有记录'); return 1 }
    console.log('链：' + c.名 + '（' + c.份数 + ' 份）')
    console.log('文件：' + c.最新)
    console.log('')
    console.log(读文本(c.最新))
    return 0
  }

  if (全区) {
    for (const c of 链们) {
      if (!c.最新) continue
      console.log('=== ' + c.名 + ' ===')
      console.log(读文本(c.最新))
      console.log('')
    }
    return 0
  }

  const 主链 = 链们.filter((c) => !c.旁支 && c.最新)
  if (!主链.length) { console.error('没有主线记录（都是旁支？加 --all）'); return 1 }
  主链.sort((a, b) => path.basename(a.最新).localeCompare(path.basename(b.最新)))
  const 选 = 主链[主链.length - 1]
  console.log('链：' + 选.名 + '（' + 选.份数 + ' 份）')
  console.log('文件：' + 选.最新)
  console.log('')
  console.log(读文本(选.最新))
  return 0
}

function cmdIndex(args) {
  const 链名 = 取参(args, '--chain')
  const 链们 = 列链().filter((c) => (链名 ? c.名 === 链名 : true))
  for (const c of 链们) {
    console.log('=== ' + c.名 + '（' + c.份数 + ' 份' + (c.旁支 ? ' · 旁支' : '') + '）===')
    for (const e of c.索引行) console.log('  ' + e.时间码 + ' · ' + e.内容)
    console.log('')
  }
  return 0
}

async function cmdRecall(args) {
  // 2026-11-06 改造：混合检索（关键词 0.55 + 向量 0.45）
  //   ① 自动拆词（"守卫 生命周期" 也能量）② 综合分排序
  //   ③ 默认只查当前链（--all 跨链）④ 默认截断（--all 全量）⑤ 无命中回退正文
  const 跨链 = args.includes('--all')
  const 链名 = 取参(args, '--chain')
  const 扫正文 = args.includes('--body')
  const 上限 = Number(取参(args, '--limit')) || 10
  let 词们 = args.filter((a) => a.indexOf('--') !== 0 && a !== 链名)
  词们 = 词们.map((w) => String(w)).join(' ').split(/\s+/).filter(Boolean)
  if (!词们.length) { console.error('用法：mem.mjs recall <关键词…> [--chain 链名] [--all] [--body] [--limit N]'); return 1 }

  const 全部链 = 列链()
  let 当前链 = 链名
  if (!当前链 && !跨链) {
    let 最新 = null
    for (const c of 全部链) {
      let t = 0
      try { t = c.最新 && fs.existsSync(c.最新) ? fs.statSync(c.最新).mtimeMs : 0 } catch (e) { t = 0 }
      if (!最新 || t > 最新.t) 最新 = { 名: c.名, t: t }
    }
    当前链 = 最新 ? 最新.名 : null
  }
  const 链们 = 全部链.filter((c) => (当前链 ? c.名 === 当前链 : true))

  const 命中 = []
  for (const c of 链们) {
    for (const e of c.索引行) {
      let 词命中 = 0
      for (const w of 词们) if (e.内容.indexOf(w) >= 0) 词命中++
      if (词命中 > 0) {
        命中.push({ 链: c.名, 时间码: e.时间码, 摘要: e.内容, 词命中: 词命中, 分: 词命中 / 词们.length })
      }
    }
  }

  let 语义 = []
  try {
    const 索引 = 读向量索引()
    if (索引.length) {
      const qv = await 算向量(词们.join(' '), 向量模型默认)
      const 打分 = 索引
        .filter((x) => 链们.some((c) => c.名 === x.链))
        .map((x) => ({ 分: 余弦(qv, x.v), x: x }))
        .filter((o) => o.分 > 0.35)
      打分.sort((a, b) => b.分 - a.分)
      语义 = 打分.slice(0, 上限)
    }
  } catch (e) { 语义 = [] }

  const 表 = new Map()
  for (const h of 命中) 表.set(h.链 + '|' + h.时间码, { ...h, 综合: 0.55 * h.分 })
  for (const o of 语义) {
    const key = o.x.链 + '|' + String(o.x.文件)
    const 旧 = 表.get(key)
    if (旧) 旧.综合 = 旧.综合 + 0.45 * o.分
    else 表.set(key, { 链: o.x.链, 时间码: o.x.文件, 摘要: o.x.前, 词命中: 0, 综合: 0.45 * o.分 })
  }
  const 结果 = [...表.values()].sort((a, b) => b.综合 - a.综合)

  if (!结果.length) {
    console.log('没有命中：' + 词们.join(' ') + (当前链 ? '（链：' + 当前链 + '）' : ''))
    if (!跨链) console.log('  想跨链搜：加 --all')
    return 0
  }

  console.log('【命中】' + 词们.join(' ') + '  共 ' + 结果.length + ' 条' +
              (当前链 ? '（链：' + 当前链 + '，--all 可跨链）' : '（全部链）'))
  const 显示 = 跨链 ? 结果 : 结果.slice(0, 上限)
  for (const h of 显示) {
    const 分 = (typeof h.综合 === 'number' ? h.综合 : 0).toFixed(2)
    console.log('  ' + 分 + '  ' + h.链 + '  ' + h.时间码 + '  ' + String(h.摘要 || '').slice(0, 88))
  }
  if (!跨链 && 结果.length > 上限) console.log('  …还有 ' + (结果.length - 上限) + ' 条（--all 看全量）')

  if (扫正文 || !结果.length) {
    const 正文层 = []
    for (const c of 链们) {
      for (const f of c.文件们) {
        let 文本 = ''
        try { 文本 = 读文本(f) } catch (e) { continue }
        let 次数 = 0
        for (const w of 词们) 次数 += 文本.split(w).length - 1
        if (次数 > 0) 正文层.push({ 链: c.名, 文件: path.basename(f), 次数: 次数 })
      }
    }
    正文层.sort((a, b) => b.次数 - a.次数)
    if (正文层.length) {
      console.log('')
      console.log('【正文命中】' + 正文层.length + ' 份')
      for (const h of 正文层.slice(0, 5)) console.log('  ' + h.链 + '  ' + h.文件 + '  出现 ' + h.次数 + ' 次')
    }
  }
  return 0
}

function cmdCheck(args) {
  const 链名 = 取参(args, '--chain')
  const 修 = args.indexOf('--fix') >= 0
  const 链们 = 列链().filter((c) => (链名 ? c.名 === 链名 : true))
  let 有问题 = 0
  for (const c of 链们) {
    const 索引路径 = path.join(c.目录, 'INDEX.md')
    const 头 = fs.existsSync(索引路径) ? 头部份数(索引路径) : null
    const 条差 = c.份数 - c.索引数
    const 头差 = 头 === null ? 0 : c.份数 - 头
    // 三态：索引行带 [blocked] / [cannot-verify] 的，都算「还没闭合」
    let 未闭 = 0
    let 判不了 = 0
    if (fs.existsSync(索引路径)) {
      for (const 行 of 读文本(索引路径).split(/\r?\n/)) {
        if (行.indexOf('[blocked]') >= 0) 未闭++
        else if (行.indexOf('[cannot-verify]') >= 0) 判不了++
      }
    }
    const 尾注 = (未闭 || 判不了) ? '  ⚠ 未闭合 ' + 未闭 + ' · 判不了 ' + 判不了 : ''
    if (条差 === 0 && 头差 === 0) { console.log('  ✅ ' + c.名 + '（' + c.份数 + ' 份）' + 尾注); continue }
    有问题++
    console.log('  ⚠ ' + c.名)
    console.log('      记录 ' + c.份数 + ' 份 / 索引条目 ' + c.索引数 + ' 条 / 头部写 ' + (头 === null ? '未写' : 头 + ' 份'))
    if (条差 !== 0) console.log('      → 差 ' + 条差 + ' 条：需要人工补摘要行（摘要不能机器生成）')
    if (未闭 || 判不了) console.log('      → 未闭合 ' + 未闭 + ' · 判不了 ' + 判不了 + '（看 INDEX 的 [blocked] / [cannot-verify]）')
    if (修 && fs.existsSync(索引路径)) {
      let 文 = 读文本(索引路径)
      if (头 !== null) 文 = 文.replace(/共\s*\d+\s*份/, '共 ' + c.份数 + ' 份')
      fs.writeFileSync(索引路径, 文, 'utf8')
      console.log('      已修正头部份数')
    }
  }
  return 有问题 ? 2 : 0
}

async function cmdAppend(args) {
  const 链名 = 取参(args, '--chain')
  const 标题 = 取参(args, '--title')
  const 标签 = 取参(args, '--tags')
  const 会话 = 取参(args, '--session')
  const 来源 = 取参(args, '--file')
  const 用stdin = args.indexOf('--stdin') >= 0
  // 2026-10-28：三态。允许说「判不了」，别逼着二选一。
  const 状态原 = (取参(args, '--status') || 'done').toLowerCase()
  const 状态 = ['done', 'blocked', 'cannot-verify'].includes(状态原) ? 状态原 : 'done'
  const 依据 = 取参(args, '--why') || ''
  if (!链名 || !标题) { console.error('用法：mem.mjs append --chain 链名 --title 标题 [--tags a,b] [--session id] [--status done|blocked|cannot-verify] [--why 依据] [--file 路径 | --stdin | --text 正文]'); return 1 }

  const 区 = 工作区根()
  const 目录 = path.join(区, 链名)
  if (!fs.existsSync(目录)) { console.error('链不存在：' + 目录); return 1 }

  let 正文 = ''
  if (来源) 正文 = 读文本(来源)
  else if (用stdin) 正文 = fs.readFileSync(0, 'utf8')
  else if (取参(args, '--text')) 正文 = String(取参(args, '--text')).replace(/\\n/g, '\n')

  const d = new Date()
  const 补 = (n) => (n < 10 ? '0' + n : String(n))
  const 日期 = d.getFullYear() + '-' + 补(d.getMonth() + 1) + '-' + 补(d.getDate())
  let 时分 = 补(d.getHours()) + 补(d.getMinutes())
  // 2026-10-26：文件名必须排序在链内最后（SKILL 硬规矩）。
  //   真实时间可能小于链里已有记录的时间码（那多半是先前手写估的时间），此时顺延 1 分钟。
  {
    const 同日 = fs.readdirSync(目录).filter((n) => n.indexOf(日期 + '_') === 0)
    let 最大 = 0
    for (const n of 同日) {
      const m = /^\d{4}-\d{2}-\d{2}_(\d{4})/.exec(n)
      if (m) 最大 = Math.max(最大, Number(m[1]))
    }
    if (最大 > 0 && Number(时分) <= 最大) {
      const 时 = Math.floor(最大 / 100), 分2 = 最大 % 100
      const 总 = 时 * 60 + 分2 + 1
      时分 = 补(Math.floor(总 / 60) % 24) + 补(总 % 60)
      console.log('注：链内已有 ' + 最大 + '，新记录顺延为 ' + 时分 + '（保证排序在最后）')
    }
  }
  const 短id = 会话 ? String(会话).replace(/^session-/, '').slice(0, 8) : 'anon'
  const 干净 = String(标题).replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40)

  let 文件 = path.join(目录, 日期 + '_' + 时分 + '_' + 干净 + '_' + 短id + '.md')
  let n = 2
  while (fs.existsSync(文件)) {
    文件 = path.join(目录, 日期 + '_' + 时分 + '_' + 干净 + '-' + n + '_' + 短id + '.md')
    n++
  }

  if (!正文.trim()) {
    正文 = '# ' + 标题 + '（' + 日期 + ' ' + 补(d.getHours()) + ':' + 补(d.getMinutes()) + '）\n\n（正文待补）\n'
  } else if (!正文.trimStart().startsWith('#')) {
    // 2026-10-29：给了 --text 但没写标题行 → 自动补，保证记录开头有可读标题
    正文 = '# ' + 标题 + '（' + 日期 + ' ' + 补(d.getHours()) + ':' + 补(d.getMinutes()) + '）\n\n' + 正文.trimStart()
  }
  // 三态写进正文头部：以后翻记录一眼看出「没干完」还是「判不了」
  {
    const 行们 = 正文.split(/\r?\n/)
    const 标 = { done: 'done', blocked: 'blocked（卡住了）', 'cannot-verify': 'cannot-verify（判不了）' }[状态]
    const 状态行 = '> **状态**：' + 标 + (依据 ? ' · 依据：' + 依据 : '')
    if (行们.length && 行们[0].startsWith('# ')) 行们.splice(1, 0, '', 状态行, '')
    else 行们.unshift(状态行, '')
    正文 = 行们.join('\n')
  }
  fs.writeFileSync(文件, 正文, 'utf8')
  console.log('已写入：' + 文件)

  const 索引路径 = path.join(目录, 'INDEX.md')
  const 链 = 列链(区).find((c) => c.名 === 链名)
  const 新份数 = 链 ? 链.份数 : 1
  const 标签串 = 标签
    ? ' ' + String(标签).split(/[,，\s]+/).filter(Boolean).map((t) => TICK + '#' + t + TICK).join(' ')
    : ''
  const 状态标 = 状态 === 'done' ? '' : ' · [' + 状态 + ']'
  const 新行 = '- ' + TICK + 时分 + TICK + ' · ' + String(标题).slice(0, 25) + ' ·' + (标签串 || ' ' + TICK + '#未标注' + TICK) + 状态标

  if (!fs.existsSync(索引路径)) {
    const 头 = '# 索引 · ' + 链名 + '\n\n**建立** ' + 日期 + ' · **共 ' + 新份数 + ' 份** · **最近更新** ' + 日期 + ' ' + 时分 + '\n\n---\n\n'
    fs.writeFileSync(索引路径, 头 + 新行 + '\n', 'utf8')
    console.log('已新建 INDEX.md 并追加条目')
    if (!args.includes('--no-vector')) await 增量建索引(文件, 向量模型默认)
    return 0
  }

  let 行们 = 读文本(索引路径).split(/\r?\n/)
  let 最后 = -1
  行们.forEach((行, i) => { if (行.trim().indexOf('- ' + TICK) === 0) 最后 = i })
  if (最后 >= 0) 行们.splice(最后 + 1, 0, 新行)
  else 行们.push(新行)
  let 文 = 行们.join('\n')
  文 = 文.replace(/共\s*\d+\s*份/, '共 ' + 新份数 + ' 份')
  文 = 文.replace(/\*\*最近更新\*\*\s*[\d\-]+\s*[\d:]*/, '**最近更新** ' + 日期 + ' ' + 时分)
  fs.writeFileSync(索引路径, 文, 'utf8')
  console.log('已追加索引行并更新头部（共 ' + 新份数 + ' 份）')
  if (!args.includes('--no-vector')) await 增量建索引(文件, 向量模型默认)
  return 0
}

// 2026-10-29：amend —— 给链里最新一份追加「补记」小节。
// 解决「小事也各开一份 → 记录过密」：同主题的补充并进上一份，不新开文件。
async function cmdAmend(args) {
  const 链名 = 取参(args, '--chain')
  const 小节 = 取参(args, '--title') || '补充'
  const 文件源 = 取参(args, '--file')
  const 直接 = 取参(args, '--text') || ''
  if (!链名) { console.error('用法：mem.mjs amend --chain 链名 [--to 记录名片段] [--title 小节标题] [--text 正文 | --file 路径]'); return 1 }
  const 区 = 工作区根()
  const 目录 = path.join(区, 链名)
  if (!fs.existsSync(目录)) { console.error('链不存在：' + 目录); return 1 }
  const 文件们 = fs.readdirSync(目录).filter((n) => n.endsWith('.md') && n !== 'INDEX.md').sort()
  if (!文件们.length) { console.error('这条链还没有记录'); return 1 }
  // 2026-10-29：--to 可指定某一份（默认最新）。用于把补充并回它真正的主题记录。
  const 指定 = 取参(args, '--to')
  let 目标名 = 文件们[文件们.length - 1]
  if (指定) {
    const 命中 = 文件们.filter((n) => n.indexOf(指定) >= 0)
    if (!命中.length) { console.error('没找到含「' + 指定 + '」的记录'); return 1 }
    if (命中.length > 1) { console.error('「' + 指定 + '」命中多份，请写长一点：\n  ' + 命中.slice(0, 5).join('\n  ')); return 1 }
    目标名 = 命中[0]
  }
  const 目标 = path.join(目录, 目标名)
  let 正文 = 文件源 ? 读文本(文件源) : String(直接).replace(/\\n/g, '\n')
  if (!String(正文).trim()) { console.error('没给正文（--text 或 --file）'); return 1 }

  const d = new Date()
  const 补 = (n) => (n < 10 ? '0' + n : String(n))
  const 时分 = 补(d.getHours()) + 补(d.getMinutes())
  const 日期 = d.getFullYear() + '-' + 补(d.getMonth() + 1) + '-' + 补(d.getDate())
  const 段 = '\n\n---\n\n## 补记 · ' + 小节 + '（' + 补(d.getHours()) + ':' + 补(d.getMinutes()) + '）\n\n' + String(正文).trim() + '\n'
  fs.appendFileSync(目标, 段, 'utf8')
  console.log('已并进：' + 目标名 + (指定 ? '（--to 指定）' : '（最新一份）'))

  const 索引路径 = path.join(目录, 'INDEX.md')
  if (fs.existsSync(索引路径)) {
    const m = /^\d{4}-\d{2}-\d{2}_(\d{4})/.exec(目标名)
    const 时分键 = m ? m[1] : ''
    const 行们 = 读文本(索引路径).split(/\r?\n/)
    let 命中 = -1
    行们.forEach((行, i) => { if (时分键 && 行.trim().indexOf('- ' + TICK + 时分键 + TICK) === 0) 命中 = i })
    if (命中 >= 0) {
      if (行们[命中].indexOf('+补记') < 0) 行们[命中] = 行们[命中] + ' · +补记'
      else 行们[命中] = 行们[命中].replace(/\+补记(\d*)/, (mm, n) => '+补记' + (Number(n || 1) + 1))
    }
    let 文 = 行们.join('\n')
    文 = 文.replace(/\*\*最近更新\*\*\s*[\d\-]+\s*[\d:]*/, '**最近更新** ' + 日期 + ' ' + 时分)
    fs.writeFileSync(索引路径, 文, 'utf8')
    console.log('索引行已标 +补记，头部时间已刷新')
  }

  if (!args.includes('--no-vector')) await 增量建索引(目标, 向量模型默认)
  return 0
}

function cmdReindex() {   // 预演（不写任何东西）；真建库用 reindex-build
  const 链们 = 列链()
  let 文件数 = 0, 字符数 = 0, 索引条 = 0
  for (const c of 链们) {
    索引条 += c.索引行.length
    for (const f of c.文件们) {
      文件数++
      try { 字符数 += 读文本(f).length } catch (e) {}
    }
  }
  const 块 = Math.ceil(字符数 / 1000)
  console.log('派生索引规模预演（不写入任何东西）')
  console.log('  记录文件 ' + 文件数 + ' 份 / ' + 字符数 + ' 字')
  console.log('  L1 索引摘要 ' + 索引条 + ' 条')
  console.log('  L2 全文切块 约 ' + 块 + ' 块（每块 1000 字）')
  console.log('')
  console.log('★ 向量是可重建的派生物，权威永远是上面的 md 文件。')
  console.log('  真要建：起 Ollama + bge-m3，对每个块调 /api/embeddings，')
  console.log('  只把 (向量, 文件路径, 起止行号) 落进 sqlite 或 jsonl —— 不搬正文。')
  return 0
}


// ───────────── 向量层（派生，可随时重建）─────────────
//
// 原则（见 handoff-system/1427）：权威永远是上面的 md；向量只是索引，
// 删了随时能重建。所以这里不做增量、不做版本迁移 —— 一次全量重算最省心。

const 向量目录名 = '_vectors'
const 向量模型默认 = 'bge-m3'
const 向量端点 = process.env.OLLAMA_HOST ? 'http://' + process.env.OLLAMA_HOST : 'http://127.0.0.1:11434'
const 块大小 = 1000
const 块重叠 = 100
const 召回默认 = 5

function 向量目录() { return path.join(工作区根(), 向量目录名) }
function 向量文件() { return path.join(向量目录(), 'index.jsonl') }
function 向量元文件() { return path.join(向量目录(), 'meta.json') }

function 读向量元() {
  try { return JSON.parse(读文本(向量元文件())) } catch (e) { return null }
}

async function 算向量(文本, 模型) {
  const r = await fetch(向量端点 + '/api/embeddings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 模型, prompt: 文本 }),
  })
  if (!r.ok) throw new Error('embeddings HTTP ' + r.status)
  const j = await r.json()
  if (!j || !Array.isArray(j.embedding)) throw new Error('embeddings 返回异常：' + JSON.stringify(j).slice(0, 120))
  return j.embedding
}

function 切块(文本) {
  const 行们 = 文本.split(/\r?\n/)
  const 块们 = []
  let 缓冲 = []
  let 起 = 1
  let 长度 = 0
  for (let i = 0; i < 行们.length; i++) {
    const 行 = 行们[i]
    if (!缓冲.length) 起 = i + 1
    缓冲.push(行)
    长度 += 行.length + 1
    if (长度 >= 块大小) {
      块们.push({ 起: 起, 止: i + 1, 文本: 缓冲.join('\n') })
      // 重叠：留最后 块重叠 字对应的若干行
      let 留 = []
      let 计 = 0
      for (let k = 缓冲.length - 1; k >= 0; k--) {
        留.unshift(缓冲[k])
        计 += 缓冲[k].length + 1
        if (计 >= 块重叠) break
      }
      缓冲 = 留
      长度 = 计
      起 = i + 2 - 留.length
    }
  }
  if (缓冲.length && 缓冲.join('').trim()) {
    块们.push({ 起: 起, 止: 行们.length, 文本: 缓冲.join('\n') })
  }
  return 块们
}

function 余弦(a, b) {
  let 点 = 0, na = 0, nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) { 点 += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  if (!na || !nb) return 0
  return 点 / Math.sqrt(na * nb)
}

async function cmdReindexBuild(args) {
  const 模型 = 取参(args, '--model') || 向量模型默认
  const 链们 = 列链()
  const 目录 = 向量目录()
  fs.mkdirSync(目录, { recursive: true })

  let 总数 = 0
  for (const c of 链们) for (const f of c.文件们) 总数++
  console.log('开始重建向量索引')
  console.log('  模型 ' + 模型 + '  端点 ' + 向量端点)
  console.log('  记录 ' + 总数 + ' 份，切块后逐块算向量…')

  const 输出 = []
  let 块数 = 0
  const 开始 = Date.now()
  for (const c of 链们) {
    for (const f of c.文件们) {
      const 文本 = 读文本(f)
      const 块们 = 切块(文本)
      for (const k of 块们) {
        let v
        try { v = await 算向量(k.文本, 模型) } catch (e) {
          console.log('  失败：' + path.basename(f) + ' 第' + k.起 + '行 — ' + String(e.message || e))
          return 1
        }
        输出.push(JSON.stringify({
          链: c.名,
          文件: path.basename(f),
          起: k.起,
          止: k.止,
          前: k.文本.replace(/\s+/g, ' ').slice(0, 120),
          v: v.map((x) => Math.round(x * 1e4) / 1e4),
        }))
        块数++
        if (块数 % 20 === 0) process.stdout.write('  …' + 块数 + ' 块\r')
      }
    }
  }
  fs.writeFileSync(向量文件(), 输出.join('\n') + '\n', 'utf8')
  const 元 = {
    模型: 模型,
    维度: JSON.parse(输出[0]).v.length,
    块数: 块数,
    记录数: 总数,
    建立于: new Date().toISOString(),
    耗时秒: Math.round((Date.now() - 开始) / 1000),
  }
  fs.writeFileSync(向量元文件(), JSON.stringify(元, null, 2), 'utf8')
  console.log('')
  console.log('完成：' + 块数 + ' 块 / ' + 元.维度 + ' 维 / 用时 ' + 元.耗时秒 + ' 秒')
  console.log('落地：' + 向量文件())
  console.log('★ 这是派生物，删掉不影响任何链记录。')
  return 0
}

// 2026-10-28：写记录后自动增量更新向量索引。
//   目的：别再出现「链里 102 份、索引只到 74 份」那种过期两天的状况。
//   原则不变：向量仍是派生物；Ollama 不在就跳过，绝不让 append 失败。
async function 增量建索引(文件, 模型) {
  const 名 = path.basename(文件)
  const 旧 = 读向量索引()
  const 旧元 = 读向量元()

  // 没有索引 / 换过模型 → 干脆全量重建
  if (!旧.length || !旧元 || 旧元.模型 !== 模型) {
    console.log('  （向量索引缺失或模型变动，改走全量重建）')
    return await cmdReindexBuild(['--model', 模型])
  }

  const 保留 = 旧.filter((r) => r.文件 !== 名)
  const 块们 = 切块(读文本(文件))
  const 新块 = []
  try {
    for (const k of 块们) {
      const v = await 算向量(k.文本, 模型)
      新块.push({
        链: path.basename(path.dirname(文件)),
        文件: 名, 起: k.起, 止: k.止,
        前: k.文本.replace(/\s+/g, ' ').slice(0, 120),
        v: v.map((x) => Math.round(x * 1e4) / 1e4),
      })
    }
  } catch (e) {
    console.log('  ！向量没更新（' + String(e.message || e) + '）—— 不影响记录本身，下次 append 会自动补')
    return 0
  }

  const 全部 = 保留.concat(新块)
  fs.writeFileSync(向量文件(), 全部.map((x) => JSON.stringify(x)).join('\n') + '\n', 'utf8')
  const 记录数 = new Set(全部.map((r) => r.文件)).size
  fs.writeFileSync(向量元文件(), JSON.stringify({
    模型, 维度: 新块.length ? 新块[0].v.length : (旧元.维度 || 0),
    块数: 全部.length, 记录数, 建立于: new Date().toISOString(), 增量: true,
  }, null, 2), 'utf8')
  console.log('  向量索引：+' + 新块.length + ' 块（共 ' + 全部.length + ' 块 / ' + 记录数 + ' 份）')
  return 0
}

function 读向量索引() {
  const f = 向量文件()
  if (!fs.existsSync(f)) return []
  const 出 = []
  for (const 行 of 读文本(f).split(/\r?\n/)) {
    const t = 行.trim()
    if (!t) continue
    try { 出.push(JSON.parse(t)) } catch (e) {}
  }
  return 出
}

async function cmdRecallSemantic(args) {
  const 查询 = 取参(args, '--query') || args.filter((a) => a.indexOf('--') !== 0)[0]
  const 模型 = 取参(args, '--model') || 向量模型默认
  const k = Number(取参(args, '--k')) || 召回默认
  if (!查询) { console.error('用法：mem.mjs recall --semantic <查询> [--k 5]'); return 1 }

  const 索引 = 读向量索引()
  if (!索引.length) { console.log('还没有向量索引，先跑：mem.mjs reindex'); return 1 }

  let qv
  try { qv = await 算向量(查询, 模型) } catch (e) {
    console.log('算查询向量失败：' + String(e.message || e) + '（Ollama 起来了吗？）')
    return 1
  }

  const 打分 = 索引.map((x) => ({ 分: 余弦(qv, x.v), x }))
  打分.sort((a, b) => b.分 - a.分)
  console.log('【语义命中】' + 查询 + '（' + 模型 + '，共 ' + 索引.length + ' 块）')
  for (const { 分, x } of 打分.slice(0, k)) {
    console.log('  ' + 分.toFixed(3) + '  ' + x.链 + '  ' + x.文件 + '  L' + x.起 + '-' + x.止)
    console.log('         ' + x.前.slice(0, 100))
  }
  console.log('')
  console.log('★ 命中是"指向"，读全文才算数：给的是文件与行号，结论在原文里。')
  return 0
}



// ───────── 写锁：同一条链同一时刻只允许一个进程整理 ─────────
// 2026-11-07：只防并发写坏文件；不校验归属（谁先拿到锁谁写）。
//   陈旧判定：持有者 pid 已死，或锁龄超过 TTL（默认 600 秒）→ 接管
function 锁路径(链目录) { return path.join(链目录, ".consolidate.lock") }

function 读锁(链目录) {
  const f = 锁路径(链目录)
  if (!fs.existsSync(f)) return null
  try { return JSON.parse(读文本(f)) } catch (e) { return { 坏锁: true } }
}

function 进程活着(pid) {
  try { process.kill(Number(pid), 0); return true } catch (e) { return false }
}

function 抢锁(链目录, who) {
  const 旧 = 读锁(链目录)
  const now = Date.now()
  if (旧) {
    const 龄 = (now - Number(旧.since_ms || 0)) / 1000
    const 活 = 旧.pid ? 进程活着(旧.pid) : false
    if (旧.坏锁) {
      // 坏锁：直接接管
    } else if (活 && 龄 < (旧.ttl_s || 600)) {
      return { ok: false, 持有者: 旧 }
    }
  }
  try {
    fs.writeFileSync(锁路径(链目录), JSON.stringify({
      pid: process.pid, who: who || "",
      since: new Date().toISOString(), since_ms: now, ttl_s: 600,
    }, null, 2), "utf8")
  } catch (e) {
    return { ok: false, 持有者: { 错误: String(e.message || e) } }
  }
  return { ok: true }
}

function 放锁(链目录) {
  try { fs.unlinkSync(锁路径(链目录)) } catch (e) {}
}

// 链归属提示（只提示不拦）：住户表在 AGENTS.md，这里只做名字对照
const 链归属 = {
  "2026-10-19_标书": "鲸墨",
  "2026-10-24_dsh-env": "跃跃",
  "2026-10-23_handoff-system": "跃跃",
  "2026-10-25_鲸渡-dsh": "鲸渡",
  "2026-10-25_鲸渡-qq": "鲸渡",
}

// ───────── 结论层：把链内记录的「关键决策」抽成 DECISIONS.md ─────────
// 2026-11-07：每条链自己整理，不跨链汇总。规则抽取，不依赖模型。
function 取小节(文本, 标题) {
  const re = new RegExp("\\*\\*" + 标题 + "\\*\\*[^\\n]*\\n([\\s\\S]*?)(?=\\n\\*\\*|\\n## |\\n# |$)")
  const m = 文本.match(re)
  return m ? m[1] : ""
}

function 取标题(文本, 文件名) {
  const h = 文本.match(/^#\s+(.+)$/m)
  if (h) return h[1].trim()
  return 文件名.replace(/^\d{4}-\d{2}-\d{2}_\d{4}_/, "").replace(/_[0-9a-f]{8}\.md$/, "").replace(/\.md$/, "")
}

function cmdConsolidate(args) {
  const 链名 = 取参(args, "--chain")
  const 试跑 = args.includes("--dry")
  const 链们 = 列链().filter((c) => (链名 ? c.名 === 链名 : true))
  if (!链们.length) { console.error("找不到链：" + (链名 || "(全部)")); return 1 }

  // 结论相似度（字符二元组 Jaccard），用于判断"后一条是否取代前一条"
  function 归一(s) {
    return String(s || "").replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase()
  }
  function 双字组(s) {
    const t = 归一(s), out = new Set()
    for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2))
    return out
  }
  function 相似度(a, b) {
    const A = 双字组(a), B = 双字组(b)
    if (!A.size || !B.size) return 0
    let 交 = 0
    for (const x of A) if (B.has(x)) 交++
    return 交 / (A.size + B.size - 交)
  }

  for (const c of 链们) {
    const 行 = []
    const 未纳入 = []
    for (const f of c.文件们) {
      let 文本 = ""
      try { 文本 = 读文本(f) } catch (e) { continue }
      const 决策段 = 取小节(文本, "关键决策")
      if (!决策段.trim()) { 未纳入.push(path.basename(f)); continue }
      const 日期 = (path.basename(f).match(/^(\d{4}-\d{2}-\d{2})/) || [null, ""])[1]
      for (const 行文 of 决策段.split(/\r?\n/)) {
        const t = 行文.trim()
        if (!t.startsWith("- ")) continue
        let 内容 = t.slice(2).replace(/\*\*/g, "").replace(/`/g, "").trim()
        if (!内容) continue
        if (内容.length > 160) 内容 = 内容.slice(0, 158) + "…"
        行.push({ 日期: 日期, 结论: 内容, 依据: path.basename(f), 状态: "生效" })
      }
    }
    行.sort((a, b) => String(b.日期).localeCompare(String(a.日期)))

    // 取代判定：更晚的记录里有相似度 ≥0.72 的结论 → 本条标"被…取代"
    let 取代数 = 0
    for (let i = 0; i < 行.length; i++) {
      for (let j = 0; j < i; j++) {
        if (String(行[j].日期) <= String(行[i].日期)) continue
        const 度 = 相似度(行[i].结论, 行[j].结论)
        if (度 >= 0.72) {
          行[i].状态 = "被 " + 行[j].依据.slice(0, 26) + " 取代"
          取代数++
          break
        }
      }
    }

    const 链目录 = path.dirname(c.最新 || c.索引路径 || ".")
    const 负责人 = 链归属[c.名]
    const 我 = 取参(args, "--as") || require("os").userInfo().username
    if (负责人 && 负责人 !== 我) {
      console.log("  注意：链 " + c.名 + " 归属于「" + 负责人 + "」，本次是「" + 我 + "」代跑")
    }
    if (!试跑) {
      const 锁 = 抢锁(链目录, 我)
      if (!锁.ok) {
        const h = 锁.持有者 || {}
        console.log("  跳过 " + c.名 + "：正被 pid " + (h.pid || "?") + "（" + (h.who || "未知") + "）占用，" + (h.since || ""))
        continue
      }
    }
    try {
      const 输出 = []
      输出.push("# " + c.名 + " · 结论层")
      输出.push("")
      输出.push("> 由 mem.mjs consolidate 生成（规则抽取「关键决策」段）；每条可回溯到链内记录。")
      输出.push("> 生成时间：" + new Date().toISOString().slice(0, 19).replace("T", " "))
      输出.push("> 状态列：「生效」= 仍是当前结论；「被 X 取代」= 后来的记录改了它（原文不删，可回溯分歧）")
      输出.push("")
      输出.push("| 日期 | 结论 | 依据 | 状态 |")
      输出.push("|---|---|---|---|")
      for (const r of 行) {
        输出.push("| " + (r.日期 || "-") + " | " + String(r.结论).replace(/\|/g, "\\|") + " | " + r.依据 + " | " + r.状态 + " |")
      }
      输出.push("")
      输出.push("（共 " + 行.length + " 条结论；其中 " + 取代数 + " 条已被更晚的记录取代）")
      输出.push("")
      if (未纳入.length) {
        输出.push("## 未纳入的记录（没有「关键决策」段）")
        输出.push("")
        输出.push("共 " + 未纳入.length + " 份。它们不是没内容，只是格式里没写这一节，规则抽不出来。")
        输出.push("")
        for (const f of 未纳入.sort()) 输出.push("- " + f)
        输出.push("")
      }

      if (试跑) {
        console.log("")
        console.log("=== " + c.名 + "（试跑，不写盘）===")
        console.log(输出.slice(0, 14).join("\n"))
        console.log("  …共 " + 行.length + " 条，未纳入 " + 未纳入.length + " 份")
      } else {
        fs.writeFileSync(path.join(链目录, "DECISIONS.md"), 输出.join("\n") + "\n", "utf8")
        console.log("  " + c.名 + " → DECISIONS.md（" + 行.length + " 条结论，" + 取代数 + " 条被取代，未纳入 " + 未纳入.length + " 份）")
      }
    } finally {
      if (!试跑) 放锁(链目录)
    }
  }
  return 0
}

// ───────── 写入前探针：这条要不要 append？还是该 amend 旧的？─────────
// 2026-11-07：append 只会往后加；不先看旧的，就会留下互相矛盾的结论。
// 这个命令只做"查"，不做"改"：把同主题的旧记录/旧结论摆出来，由写的人决定。
function cmdProbe(args) {
  const 链名 = 取参(args, "--chain")
  const 上限 = Number(取参(args, "--limit")) || 5
  let 词们 = args.filter((a) => a.indexOf("--") !== 0 && a !== 链名)
  词们 = 词们.join(" ").split(/\s+/).filter(Boolean)
  if (!词们.length) { console.error("用法：mem.mjs probe --chain 链名 <关键词…> [--limit N]"); return 1 }
  const 全部链 = 列链()
  const 链们 = 全部链.filter((c) => (链名 ? c.名 === 链名 : true))
  if (!链们.length) { console.error("找不到链：" + 链名); return 1 }

  let 有旧结论 = 0
  let 有旧记录 = 0
  for (const c of 链们) {
    const 目录 = path.dirname(c.最新 || c.索引路径 || ".")
    const 决策文件 = path.join(目录, "DECISIONS.md")
    if (fs.existsSync(决策文件)) {
      const 行们 = 读文本(决策文件).split(/\r?\n/).filter((l) => l.startsWith("| 20"))
      const 命中 = []
      for (const l of 行们) {
        let 中 = 0
        for (const w of 词们) if (l.indexOf(w) >= 0) 中++
        if (中) 命中.push({ 中: 中, l: l })
      }
      命中.sort((a, b) => b.中 - a.中)
      if (命中.length) {
        有旧结论 = 命中.length
        console.log("【已有结论】" + c.名 + " · " + path.basename(决策文件) + " 命中 " + 命中.length + " 条")
        for (const h of 命中.slice(0, 上限)) {
          const cells = h.l.replace(/^\|/, "").replace(/\|$/, "").split("|").map((x) => x.trim())
          console.log("  " + (cells[0] || "") + "  " + String(cells[1] || "").slice(0, 100))
          console.log("        依据 " + (cells[2] || "") + " · 状态 " + (cells[3] || ""))
        }
      }
    }
    const 记录命中 = []
    for (const e of c.索引行) {
      let 中 = 0
      for (const w of 词们) if (e.内容.indexOf(w) >= 0) 中++
      if (中) 记录命中.push({ 中: 中, e: e })
    }
    记录命中.sort((a, b) => b.中 - a.中)
    if (记录命中.length) {
      有旧记录 = 记录命中.length
      console.log("")
      console.log("【同主题记录】" + c.名 + " 命中 " + 记录命中.length + " 份")
      for (const h of 记录命中.slice(0, 上限)) console.log("  " + h.e.时间码 + "  " + String(h.e.内容).slice(0, 90))
    }
  }

  console.log("")
  if (有旧结论 || 有旧记录) {
    console.log("建议：同主题已有内容 —— ")
    console.log("  ·  若是【修正/推翻】旧结论 → 用 amend 改旧条，并在新条写「改为…」")
    console.log("  ·  若是【同一件事的新进展】→ append 新条，标题里带上日期线索")
    console.log("  ·  若是【完全另一件事】→ 直接 append")
  } else {
    console.log("建议：链内没有同主题内容 → 直接 append")
  }
  return 0
}


// ───────── 归档：把老条目从 INDEX.md 挪进 _archive/INDEX-YYYY-MM.md ─────────
// 2026-11-07：大链（>60 份）索引会越滚越长。原记录文件一律不动，只做索引分层。
// 搬不动的条目（对不上具体记录）留在原地，宁可不搬也不丢。
function 条目对应文件(条目, 文件们) {
  const 时分 = 条目.时间码
  const 标题 = String(条目.内容).split("·")[0].trim().slice(0, 12)
  const 候选 = 文件们.filter((f) => path.basename(f).indexOf("_" + 时分 + "_") >= 0)
  if (!候选.length) return null
  for (const f of 候选) {
    const 名 = path.basename(f)
    if (标题 && 名.indexOf(标题.slice(0, 6)) >= 0) return f
  }
  return 候选.length === 1 ? 候选[0] : null
}

function cmdArchive(args) {
  const 链名 = 取参(args, "--chain")
  const 保留 = Number(取参(args, "--keep")) || 30
  const 试跑 = args.includes("--dry")
  const 链们 = 列链().filter((c) => (链名 ? c.名 === 链名 : true))
  if (!链们.length) { console.error("找不到链：" + (链名 || "(全部)")); return 1 }

  for (const c of 链们) {
    const 索引路径 = path.join(c.目录, "INDEX.md")
    if (!索引路径 || !fs.existsSync(索引路径)) { console.log("  跳过 " + c.名 + "：没有 INDEX.md"); continue }
    const 条目们 = 索引条目(索引路径)
    if (条目们.length <= 保留) { console.log("  " + c.名 + "：" + 条目们.length + " 条 ≤ 保留 " + 保留 + "，无需归档"); continue }

    // 把每条映射到记录文件，拿到月份
    const 带月 = 条目们.map((e) => {
      const f = 条目对应文件(e, c.文件们)
      const m = f ? path.basename(f).match(/^(\d{4}-\d{2})/) : null
      return { e: e, 月: m ? m[1] : null }
    })
    const 可搬 = 带月.filter((x) => x.月)
    const 要搬 = 可搬.slice(0, Math.max(0, 条目们.length - 保留))   // 索引是按时间顺序写的，前面的最老
    if (!要搬.length) { console.log("  " + c.名 + "：条目对不上记录文件，跳过"); continue }

    const 按月 = new Map()
    for (const x of 要搬) {
      if (!按月.has(x.月)) 按月.set(x.月, [])
      按月.get(x.月).push(x.e)
    }
    const 汇总 = [...按月.entries()].map(([m, es]) => m + "（" + es.length + " 条）").join("、")
    if (试跑) {
      console.log("  [试跑] " + c.名 + "：可搬 " + 要搬.length + " 条 → " + 汇总 + "；保留最近 " + 保留 + " 条")
      continue
    }

    // 抢锁（与 consolidate 共用同一把链锁）
    const 链目录 = path.dirname(索引路径)
    const 我 = 取参(args, "--as") || require("os").userInfo().username
    const 锁 = 抢锁(链目录, 我)
    if (!锁.ok) { console.log("  跳过 " + c.名 + "：正被 pid " + (锁.持有者 || {}).pid + " 占用"); continue }
    try {
      const 归档目录 = path.join(链目录, "_archive")
      if (!fs.existsSync(归档目录)) fs.mkdirSync(归档目录)
      const 搬走 = new Set(要搬.map((x) => x.e.行号))

      for (const [月, es] of 按月.entries()) {
        const 目标 = path.join(归档目录, "INDEX-" + 月 + ".md")
        const 头 = fs.existsSync(目标) ? "" : ("# 归档索引 · " + c.名 + " · " + 月 + "\n\n> 从 INDEX.md 搬来的老条目；对应记录文件仍在原目录，未移动。\n\n")
        const 内容 = es.map((e) => e.原文).join("\n") + "\n"
        fs.appendFileSync(目标, 头 + 内容, "utf8")
      }

      // 主索引：删掉搬走的行，插入归档指引
      const 原文行们 = 读文本(索引路径).split(/\r?\n/)
      const 新行们 = []
      for (let i = 0; i < 原文行们.length; i++) {
        if (!搬走.has(i + 1)) 新行们.push(原文行们[i])
      }
      const 指引 = ["", "## 归档（老条目已移出本文件）", ""]
      for (const [月, es] of [...按月.entries()].sort()) {
        指引.push("- " + 月 + " 月 " + es.length + " 条 → `_archive/INDEX-" + 月 + ".md`")
      }
      指引.push("")
      // 插到第一个 "## " 分节之前；找不到就追加到末尾
      let 插点 = 新行们.findIndex((l) => l.startsWith("## "))
      if (插点 < 0) 插点 = 新行们.length
      新行们.splice(插点, 0, ...指引)
      fs.writeFileSync(索引路径, 新行们.join("\n") + "\n", "utf8")
      console.log("  " + c.名 + "：搬走 " + 要搬.length + " 条 → " + 汇总 + "；主索引保留 " + (条目们.length - 要搬.length) + " 条")
    } finally {
      放锁(链目录)
    }
  }
  return 0
}

// ───────────── 入口 ─────────────

const 参数 = process.argv.slice(2)
const 命令 = 参数[0]
const 余 = 参数.slice(1)
const 表 = {
  chains: cmdChains, latest: cmdLatest, index: cmdIndex, recall: cmdRecall,
  check: cmdCheck, append: cmdAppend, amend: cmdAmend, reindex: cmdReindex,
  semantic: cmdRecallSemantic, consolidate: cmdConsolidate, probe: cmdProbe, archive: cmdArchive,
  'reindex-build': cmdReindexBuild, reindexBuild: cmdReindexBuild
}
if (!命令 || !表[命令]) {
  console.log('用法：node mem.mjs <chains|latest|index|recall|probe|consolidate|archive|check|append|amend|reindex|reindex-build|semantic> [参数…]')
  console.log('根目录：' + 根目录())
  console.log('工作区：' + 工作区根())
  process.exit(命令 ? 1 : 0)
}
// 注意：部分命令是 async（向量层），必须 await 之后再交给 exit
const 结果 = await 表[命令](余)
process.exit(typeof 结果 === 'number' ? 结果 : 0)
