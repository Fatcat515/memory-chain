# 发版流程

![别把整个 zip 甩进仓库](assets/dont-ship-the-zip.png)

> **本项目的第一次发版事故**：v1.0.0 首发时，作者把整个 `memory-chain-v1.zip` 甩进了仓库根目录，
> 源码一个没传，README 只有两行。这张图挂在这里，是给下一位维护者（包括未来的作者）的警告。

---

## 一次发版的完整步骤

### 1. 改本地真身，不要改发布目录

```
技能真身    %USERPROFILE%\.agents\skills\memory-chain\SKILL.md
发布目录    本仓库（一份副本）
```

改完真身之后，**同步到发布目录**再提交。别反过来——发布目录不是运行中的那一份。

### 2. 上传源码，不是压缩包

```
✓ 正确：Add file → Upload files → 拖 SKILL.md / README.md / LICENSE / tools\ / assets\
✗ 错误：把 memory-chain-v1.zip 传上去
```

**GitHub 网页上传 zip 只是把它当文件存起来**，别人点进去看到一个压缩包，读不到任何东西。

### 3. 发 Release（不是"上传文件"）

Release 这个词容易误解：它**必须绑一个 tag**，本质是"给某个 commit 打标签 + 附上归档"。

```
Draft a new release
  Choose a tag     → 打 v1.1.0 → 点「Create new tag: v1.1.0 on publish」
                     （tag 留空会报：tag name can't be blank）
  Target           → main
  Release title    → memory-chain v1.1.0
  Release notes    → 见下方模板
  Attach binaries  → 拖入 zip（见第 4 步）
  Publish release
```

### 4. 附件要挂进 Assets，不是贴链接

页面上有两个容易混的东西：

| | 是什么 | 算不算资产 |
|---|---|---|
| `Source code (zip)` / `(tar.gz)` | **GitHub 自动生成**的仓库快照 | 不算，每个 Release 都有 |
| 你拖进去的 `memory-chain-v1.zip` | 真正的发布归档 | ✅ 才算 |

**判定方法**：查 API，`assets` 数组长度为 0 就是没挂上。

```
https://api.github.com/repos/<owner>/<repo>/releases/latest
→ "assets": []        ← 没挂上（Source code 不计入这里）
→ "assets": [{...}]   ← 挂上了
```

**挂的位置**：Release 编辑页**最下方**，Release notes 编辑框下面那个虚线框：

```
┌────────────────────────────────────────────┐
│  Attach binaries by dropping them here     │
│  or selecting them.                        │
└────────────────────────────────────────────┘
```

点 `selecting them` 选文件比拖拽稳。**传完必须点 `Update release` / `Publish release`**，不点等于没传。

在正文里贴 `user-attachments` 链接也能下载，但那不算资产：没有下载计数，也不会出现在 Assets 列表。

---

## 发版检查清单

```
[ ] 本地真身与发布目录的 SKILL.md 是同一份（行数一致）
[ ] 仓库根目录只有源码，没有 zip / tgz
[ ] README 版本号已更新
[ ] Release 绑了 tag（不是空）
[ ] zip 挂在 Assets 里（API 查 assets 数组非空）
[ ] Release notes 里写了「使用前先读 README 的隐私警告」
```

---

## Release notes 模板

```markdown
## 变更

- xxx

## ⚠️ 使用前

请先读 README 的「隐私与数据范围」一节 —— 本工具会读取本机 DSH 会话的原始记录（含对话全文）。
```

---

## 版本号约定

```
v1.0.x   修 bug / 改文档
v1.x.0   加功能或改规则（例如 v1.1.0 加了「便条」通道和「身份」模型）
v2.0.0   改数据结构（例如交接笔记的目录布局或字段格式变了）
```
