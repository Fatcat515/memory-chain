#!/usr/bin/env node
/**
 * memory-chain / tools / shared-memory.mjs
 * 作者：鲸跃 · 2026-10-27
 *
 * 「互通记忆」的读写层：QQ 那边（AstrBot 的鲸渡）和本机（DSH 的鲸跃）共用一份库。
 * 库就是抖音插件早就在用的 shared.sqlite —— 不另起炉灶，避免又多一个真相源。
 *
 * 只做两件事：记一条、查几条。不做删除、不做覆盖。
 */

import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'

export function 库路径() {
  const 显式 = process.env.DEEPSEEK_SHARED_MEMORY_DB
  if (显式) return 显式
  return path.join(os.homedir(), '.dsh', 'douyin-browser', 'memory', 'shared.sqlite')
}

// 和 qq-sync.mjs 一个思路：写进去之前先把可能泄密的东西抹掉
export function 洗净(值) {
  return String(值 ?? '')
    .replace(/\[CQ:[^\]\r\n]*\]/gi, '[附件或提及已隐藏]')
    .replace(/data:[^\s"'<>]+/gi, '[附件已隐藏]')
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, '***')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer ***')
    .replace(/((?:access[_-]?token|api[_-]?key|token|password|secret|cookie|authorization)\s*["']?\s*[:=：]\s*["']?)[^\s,;，；"']+/gi, '$1***')
    .replace(/\b[A-Za-z]:[\\/][^\r\n"'<>|;，；]+/g, '[本机路径已隐藏]')
}

async function 开库() {
  const { DatabaseSync } = await import('node:sqlite')
  return new DatabaseSync(库路径())
}

export async function 记一条({ text, kind = 'note', title = '', tags = [], source = 'jingdu' }) {
  const 内容 = 洗净(text).trim()
  if (!内容) throw new Error('text 不能为空')
  const 正文 = 内容.length > 4000 ? 内容.slice(0, 4000) + '…' : 内容
  const 现在 = Date.now()
  const 标签 = Array.isArray(tags) ? tags.map((t) => 洗净(t).trim()).filter(Boolean) : []
  const 外部键 = 'note:' + source + ':' + createHash('sha256').update(正文 + '|' + 现在).digest('hex').slice(0, 24)
  const 元 = JSON.stringify({ tags: 标签, via: 'memory-mcp' })

  const db = await 开库()
  try {
    db.prepare(
      'INSERT INTO memory_entries (kind, content, source, sources_json, title, metadata_json, created_at, updated_at, origin, status, external_key) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(kind, 正文, source, JSON.stringify([source]), 洗净(title), 元, 现在, 现在, 'note', 'recorded-note', 外部键)
    const 行 = db.prepare('SELECT id FROM memory_entries WHERE external_key = ?').get(外部键)
    return { id: 行 ? 行.id : null, bytes: Buffer.byteLength(正文, 'utf8') }
  } finally {
    try { db.close() } catch {}
  }
}

export async function 查几条({ query = '', limit = 10 } = {}) {
  const 数 = Math.max(1, Math.min(50, Number(limit) || 10))
  const db = await 开库()
  try {
    let 行们
    if (query && String(query).trim()) {
      const 词 = '%' + String(query).trim() + '%'
      行们 = db.prepare(
        'SELECT id, kind, source, title, content, created_at FROM memory_entries ' +
        'WHERE content LIKE ? OR title LIKE ? ORDER BY id DESC LIMIT ?'
      ).all(词, 词, 数)
    } else {
      行们 = db.prepare(
        'SELECT id, kind, source, title, content, created_at FROM memory_entries ORDER BY id DESC LIMIT ?'
      ).all(数)
    }
    return 行们.map((r) => ({
      id: r.id,
      kind: r.kind,
      source: r.source,
      title: r.title || '',
      content: String(r.content || '').slice(0, 500),
      时间: (() => { const d = new Date(Number(r.created_at || 0)); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); })(),
    }))
  } finally {
    try { db.close() } catch {}
  }
}
