#!/usr/bin/env node
/**
 * memory-chain / tools / memory-mcp.mjs
 * 作者：鲸跃 · 2026-10-26
 *
 * 把 mem.mjs 的读能力包成一个 MCP server（stdio，newline-delimited JSON-RPC 2.0）。
 * 目的：让任何支持 MCP 的 agent 框架（DSH / AstrBot / 别的）都能用同一份记忆，
 *      不必各自写插件、也不必给模型 shell 权限。
 *
 * 只暴露**读**与**对账**，不暴露写入 —— 写记录仍然走人（或明确执行的 append），
 * 避免模型自己往链里灌水。
 *
 * 手测：
 *   echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' | node memory-mcp.mjs
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import readline from 'node:readline'

const 本目录 = path.dirname(fileURLToPath(import.meta.url))
const MEM = path.join(本目录, 'mem.mjs')
const 服务名 = 'memory-chain'
const 版本 = '1.0.0'
const 协议默认 = '2024-11-05'

function 跑(参数) {
  const r = spawnSync(process.execPath, [MEM, ...参数], {
    encoding: 'utf8',
    env: process.env,
    cwd: process.cwd(),
    maxBuffer: 16 * 1024 * 1024,
  })
  const 文 = (r.stdout || '') + (r.stderr ? (r.stdout ? '\n' : '') + r.stderr : '')
  return { 文: 文.trim(), 码: r.status === null ? 1 : r.status }
}

const 工具表 = [
  {
    name: 'memory_recall',
    描述:
      '在「交接链」里检索过去的记录。当用户说「上次那个…」「之前怎么解决的」「我们当时怎么定的」' +
      '或者你想确认某件事以前有没有做过，就调用它。先命中索引摘要，再退回正文。',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '关键词，可空格分隔多个；中文原样传' },
        chain: { type: 'string', description: '可选：只搜某条链（先用 memory_chains 看有哪些）' },
        body: { type: 'boolean', description: 'true = 正文也展开报次数（默认只报索引命中）' },
      },
      required: ['query'],
    },
    跑: (a) => {
      const 参 = ['recall', ...String(a.query || '').split(/\s+/).filter(Boolean)]
      if (a.chain) 参.push('--chain', String(a.chain))
      if (a.body) 参.push('--body')
      return 跑(参)
    },
  },
  {
    name: 'memory_latest',
    描述:
      '「接上次」：读最新一份交接记录（默认取非旁支链里文件名最大的那份）。' +
      '当用户说「涨潮」「接上次」「继续上次」，或你需要知道最近一次的工作状态时调用。',
    schema: {
      type: 'object',
      properties: {
        chain: { type: 'string', description: '可选：指定链名' },
        all: { type: 'boolean', description: 'true = 每条链各取最新一份' },
      },
    },
    跑: (a) => {
      const 参 = ['latest']
      if (a.chain) 参.push('--chain', String(a.chain))
      if (a.all) 参.push('--all')
      return 跑(参)
    },
  },
  {
    name: 'memory_chains',
    描述: '列出所有交接链：份数、最新一份、索引是否有缺口。想知道「记忆里都有什么」时先调这个。',
    schema: { type: 'object', properties: {} },
    跑: () => 跑(['chains']),
  },
  {
    name: 'memory_index',
    描述: '只读索引摘要行（每条链一行一条目，很省 token）。适合快速浏览某条链经历过什么。',
    schema: {
      type: 'object',
      properties: { chain: { type: 'string', description: '可选：指定链名' } },
    },
    跑: (a) => {
      const 参 = ['index']
      if (a.chain) 参.push('--chain', String(a.chain))
      return 跑(参)
    },
  },
  {
    name: 'memory_check',
    描述: '对账：检查每条链的「记录数 / 索引条目数 / 头部份数」是否一致，报出缺口。写完交接后应调用。',
    schema: {
      type: 'object',
      properties: { fix: { type: 'boolean', description: 'true = 顺手把头部份数改对（不改摘要）' } },
    },
    跑: (a) => {
      const 参 = ['check']
      if (a.fix) 参.push('--fix')
      return 跑(参)
    },
  },
  {
    name: 'memory_semantic',
    描述:
      '语义检索：当你只记得「大概是什么事」而想不出准确关键词时用它（关键词检索用 memory_recall）。' +
      '例如「那个跟浏览器有关的坑」「有无关于登录被限制的」——它按意思找，不要求词面一致。' +
      '返回的是文件与行号，结论仍要去原文确认。',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '用平常话描述你想找的事，不必是关键词' },
        k: { type: 'number', description: '返回几条，默认 5' },
      },
      required: ['query'],
    },
    跑: (a) => {
      const 参 = ['semantic', String(a.query || ''), '--k', String(a.k || 5)]
      return 跑(参)
    },
  },
  {
    name: 'memory_note',
    描述:
      '往「互通记忆」记一条（QQ 那边的鲸渡、本机的鲸跃、抖音都读同一份）。' +
      '适合记：一件刚确定的事、一个待办、一条约定、一个结论。' +
      '不要记：凭据/口令/路径/别人的隐私；不要拿它当聊天记录堆。',
    schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要记的内容，一句话说清' },
        title: { type: 'string', description: '可选：短标题，方便以后一眼认出' },
        kind: { type: 'string', description: "可选：分类，默认 note（也可用 preference / todo / fact）" },
        tags: { type: 'array', items: { type: 'string' }, description: '可选：标签' },
        source: { type: 'string', description: '可选：谁记的，默认 jingdu（QQ侧）；本机写 yueyue' },
      },
      required: ['text'],
    },
    跑: async (a) => {
      const { 记一条 } = await import('./shared-memory.mjs')
      try {
        const r = await 记一条({
          text: a.text, title: a.title || '', kind: a.kind || 'note',
          tags: a.tags || [], source: a.source || 'jingdu',
        })
        return { 文: '已记下，id=' + r.id + '（来源：' + (a.source || 'jingdu') + '）', 码: 0 }
      } catch (e) {
        return { 文: '没记上：' + String(e && e.message), 码: 1 }
      }
    },
  },
  {
    name: 'memory_notes',
    描述:
      '翻「互通记忆」里最近的条目（跨端共享）。要回忆「之前谁说过什么、记过什么」时用它；' +
      '找交接链里的正式记录用 memory_recall。',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '可选：关键词，留空就列最近几条' },
        limit: { type: 'number', description: '返回几条，默认 10' },
      },
    },
    跑: async (a) => {
      const { 查几条 } = await import('./shared-memory.mjs')
      try {
        const rows = await 查几条({ query: a.query || '', limit: a.limit || 10 })
        if (!rows.length) return { 文: '（互通记忆里还没有条目）', 码: 0 }
        const 文 = rows.map((r) =>
          '#' + r.id + ' [' + r.source + '/' + r.kind + '] ' + r.时间 +
          (r.title ? ' 《' + r.title + '》' : '') + '\n    ' + r.content
        ).join('\n')
        return { 文: 文, 码: 0 }
      } catch (e) {
        return { 文: '查询失败：' + String(e && e.message), 码: 1 }
      }
    },
  },
]

function 找工具(名) {
  return 工具表.find((t) => t.name === 名) || null
}

function 回(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: id, result: result }) + '\n')
}

function 回错(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: id, error: { code: code, message: message } }) + '\n')
}

async function 处理(消息) {
  const { id, method, params } = 消息

  if (method === 'initialize') {
    const 要 = params && params.protocolVersion ? String(params.protocolVersion) : 协议默认
    回(id, {
      protocolVersion: 要,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 服务名, version: 版本 },
      instructions:
        '这是「交接链」记忆服务。要回忆过去、确认以前怎么定的，优先调 memory_recall 或 memory_latest，' +
        '不要凭印象编造。正式交接记录不在本服务内写入；随手要记的事用 memory_note。',
    })
    return
  }

  if (method === 'notifications/initialized' || method === 'initialized') return

  if (method === 'ping') { 回(id, {}); return }

  if (method === 'tools/list') {
    回(id, {
      tools: 工具表.map((t) => ({
        name: t.name,
        description: t.描述,
        inputSchema: t.schema,
      })),
    })
    return
  }

  if (method === 'tools/call') {
    const 名 = params && params.name
    const 参 = (params && params.arguments) || {}
    const t = 找工具(名)
    if (!t) { 回错(id, -32602, '没有这个工具：' + 名); return }
    try {
      const r = await t.跑(参)
      回(id, {
        content: [{ type: 'text', text: r.文 || '（空）' }],
        isError: r.码 !== 0 && r.码 !== 2,   // check 的 2 表示"有缺口"，是正常结果不是错误
      })
    } catch (e) {
      回(id, { content: [{ type: 'text', text: '执行失败：' + String(e && e.message) }], isError: true })
    }
    return
  }

  if (id !== undefined && id !== null) 回错(id, -32601, '未实现的方法：' + method)
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', (行) => {
  const t = 行.trim()
  if (!t) return
  let 消息
  try { 消息 = JSON.parse(t) } catch (e) { return }
  if (Array.isArray(消息)) { for (const m of 消息) 处理(m); return }
  void 处理(消息)
})
rl.on('close', () => process.exit(0))
