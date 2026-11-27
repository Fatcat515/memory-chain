#!/usr/bin/env node
/**
 * memory-chain / tools / read-session.mjs
 * 作者：鲸跃 · 2026-10-24
 *
 * 读取 DSH 会话原始记录（多帧 zstd 压缩的 jsonl），按来源分类，
 * 供「从别的会话继承记忆」时做有依据的压缩 —— 而不是靠 @ 快照的裁剪文本。
 *
 * 零第三方依赖（只用 node:fs / node:path / node:zlib）。
 *
 * 用法：
 *   node read-session.mjs list   [--home <DSH_HOME>] [--out <file>]
 *   node read-session.mjs schema <session-file> [--out <file>]
 *   node read-session.mjs dump   <session-file> [--out <file>] [--max <n>] [--all]
 *
 * 关键事实（已在 DSH 0.2.0-rc.2 / session.v4 上验证）：
 *   - 会话文件是「多帧 zstd」：每次追加一个独立 frame，
 *     所以 zstdDecompressSync 直接解只拿到第一条记录，必须按 magic 切帧。
 *   - 记录形如 { type, seq, time, data, surfaceOp }，文本在 data 里。
 *   - ★ user/message 里约一半是「系统注入」（time-context / runtime-context /
 *     skill-catalog / tool-jobs / user-approval …），只有 data.source.kind === 'user'
 *     才是用户真正打的字。压缩时必须只信后者，否则会产出「用户从没说过的话」。
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]); // zstd frame magic
const FILE_NAME = 'session.v4.jsonl.zstd';

// ---------- zstd 多帧解码 ----------

function findFrames(buf) {
  const starts = [];
  let i = 0;
  for (;;) {
    const idx = buf.indexOf(MAGIC, i);
    if (idx === -1) break;
    starts.push(idx);
    i = idx + 4;
  }
  return starts;
}

/** 解压全部分帧；对 magic 误判（压缩数据内部偶然出现 magic）做一次合并重试。 */
function decodeAll(buf) {
  const starts = findFrames(buf);
  let text = '';
  let ok = 0;
  let fail = 0;
  for (let j = 0; j < starts.length; j++) {
    const end = j + 1 < starts.length ? starts[j + 1] : buf.length;
    try {
      text += zlib.zstdDecompressSync(buf.subarray(starts[j], end)).toString('utf8');
      ok += 1;
    } catch {
      const end2 = j + 2 < starts.length ? starts[j + 2] : buf.length;
      try {
        text += zlib.zstdDecompressSync(buf.subarray(starts[j], end2)).toString('utf8');
        ok += 1;
        j += 1;
      } catch {
        fail += 1;
      }
    }
  }
  return { text, frames: starts.length, ok, fail };
}

/** 只解压第一帧（很小），用于 list 时读会话元数据。 */
function decodeFirstFrame(buf) {
  const starts = findFrames(buf);
  if (starts.length === 0) return '';
  const end = starts.length > 1 ? starts[1] : buf.length;
  try {
    return zlib.zstdDecompressSync(buf.subarray(0, end)).toString('utf8');
  } catch {
    return '';
  }
}

// ---------- 记录解析 ----------

function parseRecords(text) {
  const recs = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      recs.push(JSON.parse(line));
    } catch {
      /* 容忍坏行 */
    }
  }
  return recs;
}

/** 通用文本提取：结构随版本可能变，所以按常见字段递归找，而不是写死路径。 */
function deepText(value, depth = 0) {
  if (depth > 6 || value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((v) => deepText(v, depth + 1)).filter(Boolean).join('\n');
  }
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    for (const key of ['content', 'parts', 'message', 'body', 'output', 'result']) {
      if (value[key] != null) {
        const t = deepText(value[key], depth + 1);
        if (t) return t;
      }
    }
  }
  return '';
}

const typeOf = (r) => (typeof r.type === 'string' ? r.type : '(no-type)');
const kindOf = (r) => {
  const k = r.data && r.data.source && r.data.source.kind;
  return typeof k === 'string' ? k : '(no-source)';
};
const textOf = (r) => deepText(r.data).replace(/\s+/g, ' ').trim();

/**
 * assistant/message 的 data.message.content 是 parts 数组，混着三类：
 *   {type:'text'}       最终可见回复  ← 交接时要的
 *   {type:'reasoning'}  思考过程      ← 默认丢弃（技能原则：不记过程）
 *   {type:'tool-call'}  工具调用      ← 单独成段
 * 不分这三类的话，会把思考过程当成"我的回复"记进笔记。
 */
function partsOf(r) {
  const msg = (r.data && r.data.message) || {};
  const content = Array.isArray(msg.content) ? msg.content : [];
  const texts = [];
  const reasonings = [];
  const toolCalls = [];
  for (const p of content) {
    if (!p || typeof p !== 'object') continue;
    if (p.type === 'text' && typeof p.text === 'string') texts.push(p.text);
    else if (p.type === 'reasoning' && typeof p.text === 'string') reasonings.push(p.text);
    else if (p.type === 'tool-call') toolCalls.push(String(p.name || p.toolName || '?'));
  }
  if (texts.length === 0 && typeof msg.content === 'string') texts.push(msg.content);
  return {
    texts: texts.join('\n').trim(),
    reasonings: reasonings.join('\n').trim(),
    toolCalls,
  };
}

function toolCallLine(r) {
  const d = r.data || {};
  const name = d.name || d.tool || d.toolName || (d.call && d.call.name) || '?';
  const args = d.input || d.arguments || d.args || d.params || (d.call && d.call.input) || {};
  let a = '';
  try {
    a = JSON.stringify(args);
  } catch {
    a = String(args);
  }
  return String(name) + '(' + a.slice(0, 220) + ')';
}

// ---------- 子命令：list ----------

function findSessionFiles(home) {
  const root = path.join(home, 'sessions');
  const out = [];
  if (!fs.existsSync(root)) return out;
  for (const ws of fs.readdirSync(root)) {
    const wsDir = path.join(root, ws);
    if (!fs.statSync(wsDir).isDirectory()) continue;
    for (const sid of fs.readdirSync(wsDir)) {
      const dir = path.join(wsDir, sid);
      let st;
      try {
        st = fs.statSync(dir);
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;
      const file = path.join(dir, FILE_NAME);
      if (!fs.existsSync(file)) continue;
      out.push({ workspace: ws, sessionDir: sid, file });
    }
  }
  return out;
}

/** mtime 一律按本地时区格式化 —— toISOString() 会给 UTC，交接笔记里会看错时间。 */
function fmtLocal(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' '
    + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
  );
}

function cmdList(home) {
  const lines = [];
  const rows = [];
  for (const item of findSessionFiles(home)) {
    const st = fs.statSync(item.file);
    let meta = {};
    try {
      const head = decodeFirstFrame(fs.readFileSync(item.file));
      const first = parseRecords(head).find((r) => typeOf(r) === 'session');
      if (first) meta = first;
    } catch {
      /* 忽略 */
    }
    rows.push({
      id: meta.id || item.sessionDir,
      mtime: st.mtimeMs,
      sizeBytes: st.size,
      cwd: meta.cwd || '',
      preset: meta.agentPreset || '',
      workspace: item.workspace,
      file: item.file,
    });
  }
  rows.sort((a, b) => b.mtime - a.mtime);
  lines.push('会话总数=' + rows.length + '（按最后修改时间倒序）');
  lines.push('');
  for (const r of rows) {
    lines.push(
      [
        r.id,
        'size=' + r.sizeBytes,
        'mtime=' + fmtLocal(r.mtime),
        r.preset ? 'preset=' + r.preset : '',
      ]
        .filter(Boolean)
        .join('  '),
    );
    lines.push('    cwd=' + r.cwd);
    lines.push('    file=' + r.file);
  }
  return lines.join('\n');
}

// ---------- 子命令：schema ----------

function cmdSchema(file) {
  const recs = parseRecords(decodeAll(fs.readFileSync(file)).text);
  const seen = new Map();
  for (const r of recs) {
    const t = typeOf(r);
    if (!seen.has(t)) seen.set(t, r);
  }
  const lines = ['记录总数=' + recs.length, '不同类型数=' + seen.size, ''];
  for (const [t, sample] of [...seen.entries()].sort()) {
    lines.push('[' + t + '] 顶层字段: ' + Object.keys(sample).join(','));
    if (sample.data && typeof sample.data === 'object') {
      lines.push('    data 字段: ' + Object.keys(sample.data).join(','));
    }
    lines.push('    样本: ' + JSON.stringify(sample).slice(0, 260));
    lines.push('');
  }
  return lines.join('\n');
}

// ---------- 子命令：dump ----------

function cmdDump(file, maxPerSection, keepAll) {
  const buf = fs.readFileSync(file);
  const dec = decodeAll(buf);
  const recs = parseRecords(dec.text);

  const byType = new Map();
  for (const r of recs) byType.set(typeOf(r), (byType.get(typeOf(r)) || 0) + 1);

  const users = recs.filter((r) => typeOf(r) === 'user/message');
  const humans = users.filter((r) => kindOf(r) === 'user');
  const injected = users.filter((r) => kindOf(r) !== 'user');
  const assistants = recs.filter((r) => typeOf(r) === 'assistant/message');
  const calls = recs.filter((r) => typeOf(r) === 'tool/call');
  const results = recs.filter((r) => typeOf(r) === 'tool/result');

  const byKind = new Map();
  for (const r of users) byKind.set(kindOf(r), (byKind.get(kindOf(r)) || 0) + 1);

  const L = [];
  L.push('# 会话原始记录读取报告');
  L.push('file=' + file);
  L.push('size_bytes=' + buf.length);
  L.push('zstd_frames=' + dec.frames + ' frames_ok=' + dec.ok + ' frames_fail=' + dec.fail);
  L.push('records=' + recs.length);
  L.push('');
  L.push('## 记录类型分布');
  for (const [t, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) L.push('  ' + t + ' = ' + n);
  L.push('');
  L.push('## user/message 按 data.source.kind 分组');
  for (const [k, n] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) {
    L.push('  [' + k + '] = ' + n + (k === 'user' ? '   <-- 真人输入，压缩时只信这一类' : '   (系统注入，丢弃)'));
  }
  L.push('');
  L.push('★ 真人输入 ' + humans.length + ' 条，系统注入 ' + injected.length + ' 条（占 user/message 的 '
    + (users.length ? Math.round((injected.length / users.length) * 100) : 0) + '%）');
  L.push('');

  const cap = keepAll ? Number.MAX_SAFE_INTEGER : maxPerSection;
  L.push('## ① 真人输入（source.kind === "user"）— 全文保留，' + humans.length + ' 条');
  humans.slice(0, cap).forEach((r) => {
    L.push('[seq ' + (r.seq ?? '?') + '] ' + textOf(r));
  });
  if (humans.length > cap) L.push('...（还有 ' + (humans.length - cap) + ' 条，用 --all 或 --max 调整）');
  L.push('');

  L.push('## ② 我的可见回复（assistant/message 的 text 部分；思考与工具调用已剔除）— ' + assistants.length + ' 条，每条截断 ' + (keepAll ? '不截断' : '400 字'));
  let shownReplies = 0;
  assistants.slice(0, cap).forEach((r) => {
    const t = partsOf(r).texts.replace(/\s+/g, ' ').trim();
    if (!t) return;
    shownReplies += 1;
    L.push('[seq ' + (r.seq ?? '?') + '] ' + (keepAll ? t : t.slice(0, 400)));
  });
  if (shownReplies === 0) L.push('（没有可见文本回复）');
  if (assistants.length > cap) L.push('...（本次只扫了前 ' + cap + ' 条，共 ' + assistants.length + ' 条）');
  L.push('');

  L.push('## ③ 工具调用摘要（tool/call）— ' + calls.length + ' 条，' + (keepAll ? '全部' : '前 ' + cap + ' 条'));
  calls.slice(0, cap).forEach((r) => {
    L.push('[seq ' + (r.seq ?? '?') + '] ' + toolCallLine(r));
  });
  if (calls.length > cap) L.push('...（还有 ' + (calls.length - cap) + ' 条）');
  L.push('');

  L.push('## ④ 工具结果（tool/result）— ' + results.length + ' 条，只列前 ' + Math.min(cap, 20) + ' 条首行');
  results.slice(0, Math.min(cap, 20)).forEach((r) => {
    L.push('[seq ' + (r.seq ?? '?') + '] ' + textOf(r).slice(0, 200));
  });
  L.push('');

  L.push('## ⑤ 被丢弃的系统注入 — 分类与示例（证明它们不是用户说的话）');
  const shown = new Map();
  for (const r of injected) {
    const k = kindOf(r);
    if (!shown.has(k)) shown.set(k, []);
    if (shown.get(k).length < 2) shown.get(k).push(textOf(r).slice(0, 110));
  }
  for (const [k, samples] of shown) {
    L.push('  [' + k + '] x' + byKind.get(k));
    for (const s of samples) L.push('      * ' + s);
  }
  L.push('');

  const reasoned = assistants.filter((r) => partsOf(r).reasonings);
  L.push('## ⑥ 思考过程（reasoning）— ' + reasoned.length + ' 条记录含思考内容');
  if (keepAll) {
    reasoned.slice(0, cap).forEach((r) => {
      L.push('[seq ' + (r.seq ?? '?') + '] ' + partsOf(r).reasonings.replace(/\s+/g, ' ').slice(0, 700));
    });
  } else {
    L.push('（默认不展开：技能原则是不记过程。只在需要判断「当时为什么这么定」时用 --all 取用。）');
  }

  return L.join('\n');
}

// ---------- 入口 ----------

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = argv[++i];
    else if (a === '--home') opts.home = argv[++i];
    else if (a === '--max') opts.max = Number(argv[++i]);
    else if (a === '--all') opts.all = true;
    else opts._.push(a);
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cmd = opts._[0];
  const home = opts.home || process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh');
  let text = '';

  if (cmd === 'list') {
    text = cmdList(home);
  } else if (cmd === 'schema' || cmd === 'dump') {
    const file = opts._[1];
    if (!file) throw new Error('缺少会话文件路径（可先用 list 子命令找到）');
    if (!fs.existsSync(file)) throw new Error('文件不存在: ' + file);
    text = cmd === 'schema' ? cmdSchema(file) : cmdDump(file, opts.max || 60, Boolean(opts.all));
  } else {
    text = [
      '用法：',
      '  node read-session.mjs list   [--home <DSH_HOME>] [--out <file>]',
      '  node read-session.mjs schema <session-file> [--out <file>]',
      '  node read-session.mjs dump   <session-file> [--out <file>] [--max <n>] [--all]',
      '',
      'DSH_HOME 默认取环境变量 DSH_HOME，否则 ~/.dsh。',
    ].join('\n');
  }

  // Windows 控制台常为 GBK，中文直接打到 stdout 会乱码 —— 建议一律用 --out 落 UTF-8 文件再读。
  if (opts.out) {
    fs.writeFileSync(opts.out, text, 'utf8');
    process.stdout.write('written=' + opts.out + '\n');
  } else {
    process.stdout.write(text + '\n');
  }
}

try {
  main();
} catch (error) {
  process.stderr.write('ERROR: ' + (error && error.message ? error.message : String(error)) + '\n');
  process.exitCode = 1;
}
