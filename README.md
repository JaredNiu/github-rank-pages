# GitHub 开源项目榜单 · 日榜 / 周榜 / 月榜

一个**零构建、纯静态**的 GitHub 开源项目榜单站点：展示 **今日日榜 / 本周周榜 / 本月月榜**，
数据由 GitHub Actions 定时抓取并自动提交，再通过 GitHub Pages 免费托管。

- 技术栈：原生 HTML + CSS + JavaScript（无 npm、无打包器、无 CDN 依赖）
- 每个榜单稳定展示**前 100 名**
- 数据来源：[GitHub Search API](https://docs.github.com/rest/search)（主要）+ [GitHub Trending](https://github.com/trending) 页面（并入候选池）+ 每日快照做差
- 抓取脚本：Python 3 标准库实现（`scripts/fetch_rank.py` / `scripts/fetch_top100.py`），**零第三方依赖**
- 部署方式：GitHub Actions（定时更新数据 + Pages 发布），全部走 GitHub 免费额度

### 界面特性

| 特性 | 说明 |
| --- | --- |
| 极简风格 | 浅色、无重阴影、发丝级分割线、单一强调色，移动端单列自适应 |
| 三个榜单 | 日榜 / 周榜 / 月榜 Tab 切换，同步 `history.hash`（`#daily` / `#weekly` / `#monthly`） |
| 中英切换 | 右上角「中 / EN」一键切换全部界面文案，选择写入 `localStorage`；首次访问按浏览器语言自动判断 |
| 标签化 | 标签由脚本**依据仓库实际内容**（名称 / 描述 / topics / 语言）自动打，如 `AI` `大模型` `智能体` `安全` `前端`；点击标签即筛选 |
| 滚动加载 | 滚到底部时**实时拉取下一片**数据（`data/pages/<period>/N.json`，每片 6 条），到底显示总数 |
| 历史回顾 | Tab 下方一行**快照芯片**，点开即可翻看**昨日 / 上周 / 上月**以及更早的任意一期归档；芯片上直接标出相对时间（`昨日` / `3 天前` / `2 周前`） |
| 直链分享 | 每一期归档都有独立地址，如 `#daily@2026-10-08`、`#monthly@2026-09`，可直接发给别人或加书签；地址不认识时自动退回最新一期 |
| 快照标记 | 正在看归档时，右上角更新时间会带上 `快照 ·` 前缀且圆点变灰，和「实时榜单」一眼可分 |

> 不提供关键词搜索框——按设计只保留「榜单选周期 + 标签筛选 + 历史翻看」三种浏览方式。

在线访问（开启 Pages 后）：`https://<你的用户名>.github.io/<仓库名>/`

---

## 目录结构

```
github-rank-pages/
├── README.md                        # 本文件
├── index.html                       # 单页应用（Tab 切换 日榜/周榜/月榜）
├── assets/
│   ├── style.css                    # 浅色主题样式
│   └── app.js                       # 原生 JS：三榜切换 / 中英切换 / 标签筛选 / 滚动加载
├── scripts/
│   ├── fetch_rank.py                # Trending 页面抓取 + 补全 + 打标签（9~25 条）
│   └── fetch_top100.py              # Search API + 快照做差 → 前 100 名（主力脚本）
├── data/
│   ├── daily.json                   # 日榜「最新一份」前 100（供前端读取）
│   ├── weekly.json                  # 周榜「最新一份」前 100
│   ├── monthly.json                 # 月榜「最新一份」前 100
│   ├── pages/<period>/index.json    # 分页索引：总页数 / 总数 / 标签统计
│   ├── pages/<period>/N.json        # 第 N 片数据（每片 6 条），前端滚动时逐片拉取
│   ├── meta.json                    # 更新时间 / 各榜条目数 / 标签统计 / 生成器
│   ├── daily/YYYY-MM-DD.json        # 日榜归档（每天一份，前 100）
│   ├── weekly/YYYY-MM-DD.json       # 周榜归档（周一生成，前 100）
│   ├── monthly/YYYY-MM.json         # 月榜归档（每月 1 号生成，前 100）
│   ├── snapshots/YYYY-MM-DD.json    # 候选池 star 快照 {fullName: stars}，算增量用；只留最近 40 份
│   ├── revisions/<period>/*.json    # 同一天重跑时被覆盖掉的旧归档留底（永不清除）
│   ├── archive/index.json           # 归档索引：各类型有哪些期、条数、统计范围、留底份数（前端直读）
│   └── history/YYYY-MM-DD.json      # 旧版每日整榜快照（fetch_rank.py 产出）
└── .github/workflows/
    ├── update-rank.yml              # 定时任务：抓数 + 补全 + 提交 data/
    └── pages.yml                    # 部署到 GitHub Pages
```

---

## 一、创建仓库并推送

```bash
# 在本项目目录内
git init
git add .
git commit -m "feat: init github rank pages"

# 在 GitHub 上新建一个空仓库（不要勾选 README / .gitignore），假设叫 github-rank-pages
git remote add origin git@github.com:<你的用户名>/github-rank-pages.git
git branch -M main
git push -u origin main
```

> 默认分支必须是 `main`，`pages.yml` 的触发条件写死了 `branches: [main]`。

---

## 二、开启 GitHub Pages

1. 打开仓库页面 → **Settings** → 左侧 **Pages**
2. **Source** 选择 **GitHub Actions**（不是 "Deploy from a branch"）
3. 保存后回到 **Actions** 页，手动触发一次 **pages** 工作流（右上角 `Run workflow`）
4. 部署完成后，Pages 设置页顶部会出现访问地址：
   `https://<你的用户名>.github.io/github-rank-pages/`

首次推送时 `pages.yml` 会自动执行一次；之后每天 `update-rank` 抓取完成并推送数据后，
`pages` 会自动跟着跑一次重新部署。

### 为什么 `pages.yml` 除了 `push` 还要 `workflow_run`

GitHub 官方规则：**由 `GITHUB_TOKEN` 触发的事件不会再触发新的 workflow run**。
`update-rank` 用的正是 checkout 注入的 `GITHUB_TOKEN` 执行 `git push`，
所以只写 `on: push` 的话，定时任务每天都会提交新数据，但 `pages` **永远不会跑**，
线上站点会永久停在首次手动 push 的快照，而且不报任何错。
因此 `pages.yml` 额外声明了：

```yaml
workflow_run:
  workflows: ["update-rank"]
  types: [completed]
  branches: [main]
```

（若改用 PAT 或个人 ssh key 推送，则不需要这一条；当前方案是无额外密钥成本的做法。）

### 发布产物范围

`pages.yml` 采用**白名单拷贝**：`index.html`、`assets/`、`data/{daily,weekly,monthly,meta}.json`、
`data/pages/`、以及**按原路径**拷入的 `data/{daily,weekly,monthly}/` 归档目录与
`data/archive/index.json`。

> **为什么归档要发布**：历史回顾功能完全依赖这份数据——归档进不了 `_site/`，
> 线上就翻不到往日榜单（前端会拿到 404，历史行退化成「暂无归档」）。

拷贝时**保持仓库内的目录结构不变**（`data/daily/...` 在 `_site/` 里仍是 `data/daily/...`），
因此 `python3 -m http.server` 的本地预览与线上 Pages 是同构的：
本地验证过的路径，上线后依然成立。

以下**不会**发布到公网（体积大 / 无展示价值 / 属源码）：

| 路径 | 不发布的原因 |
| --- | --- |
| `README.md`、`scripts/`、`.gitignore` | 源码与文档，避免 `/scripts/fetch_top100.py` 被直接访问 |
| `data/snapshots/` | 候选池 star 快照，仅用于算增量，前端不需要 |
| `data/revisions/` | 同日重跑的旧归档留底，只作追溯用，不参与展示 |
| `data/history/` | 旧版每日整榜快照，已被 `data/{daily,weekly,monthly}/` 取代 |

拷贝之后脚本还会**三重守卫**，任何一条不满足直接 fail 掉整个部署：

```bash
# 1. 禁用目录绝不能漏进产物
for banned in snapshots revisions history; do
  [ -e "_site/data/$banned" ] && { echo "::error::$banned 不应进入发布产物"; exit 1; }
done
# 2. 归档索引必须在，否则历史功能静默失效
[ -f _site/data/archive/index.json ] || { echo "::error::归档索引缺失"; exit 1; }
# 3. 体积上限守卫
[ "$(du -sm _site | cut -f1)" -le 900 ] || { echo "::error::站点体积接近 1GB 上限"; exit 1; }
```

第 2 条是有意为之的"宁可部署失败，也不静默降级"：索引缺失时前端不会报错，
只会把历史行渲染成空白——那种坏法没人会注意到。

### 体积增长预估

| 项目 | 单份体积 | 每年份数 | 年增长 |
| --- | --- | --- | --- |
| 日榜归档 | ~116 KB | 365 | ~42 MB |
| 周榜归档 | ~116 KB | 52 | ~6 MB |
| 月榜归档 | ~116 KB | 12 | ~1.4 MB |
| **合计** | | **429** | **~50 MB / 年** |

按 900 MB 的告警线算，**约 18 年**后才需要认真的瘦身策略（届时可选的做法：
把 3 个月前的日榜归档压缩成 `gzip`、或只为最近 N 期发布 `.json` 明细而更早的只发布前 20 名）。
当前阶段**不做任何裁剪**——归档本身就是产品要展示的内容。

### 关于定时任务的权限

`update-rank.yml` 需要写权限。若你的仓库组织默认只读：

**Settings → Actions → General → Workflow permissions → 勾选 `Read and write permissions`**，保存。

---

## 三、定时任务说明

| 工作流 | 触发时机 | cron（UTC） | 北京时间 |
| --- | --- | --- | --- |
| `update-rank` | 每天定时 + 手动 | `0 0 * * *` | 每天 08:00 |
| `pages` | `main` 有 push + `update-rank` 跑完 + 手动 | — | — |

**只配一条每日 cron**，具体产出哪些榜由脚本按运行日期自行判断：

| 运行日 | 产出 | 归档文件 |
| --- | --- | --- |
| 每天 | 日榜前 100（滚动近 24 小时）+ 写候选池快照 | `data/daily/<运行日>.json` |
| 周一 | 额外产出周榜前 100（上一个完整自然周） | `data/weekly/<上周一日期>.json` |
| 每月 1 号 | 额外产出月榜前 100（上一个完整自然月） | `data/monthly/<上月 YYYY-MM>.json` |

> 不要为周一 / 每月 1 号再加单独的 cron：同一天两条 cron 会同时命中，起两次 run、
> 白耗 Search API 配额，还会多一次空提交风险。

三个窗口的口径**并不相同**，这是有意为之（对应用户要的"今天 / 上周 / 上月"）：

- **日榜**：滚动近 24 小时（截至运行时刻）。仓库年龄 ≤24h，其 star 总数即窗口内真实增量。
- **周榜 / 月榜**：上一个完整自然周 / 自然月。跑批时刻是周一、1 号的 08:00，
  因此统计会包含窗口结束后约 8 小时的增量，属可接受误差——**不要把周月榜说成"精确到秒"**。

也可手动覆盖：

```bash
python3 scripts/fetch_top100.py --periods daily,weekly,monthly   # 强制三个榜都产
python3 scripts/fetch_top100.py --date 2026-10-08                 # 当作哪天跑（补跑/测试）
python3 scripts/fetch_top100.py --rebuild-archive-index           # 只重建历史索引，不联网、不抓取
```

>`--rebuild-archive-index` 是纯本地动作（不建 API 客户端、不读 token、不联网），
>用在"手工补了一份归档 / 删了几期"之后，让前端的历史行重新对齐。详见第五节。

手动触发工作流：仓库 → **Actions** → 选择工作流 → **Run workflow**。

> GitHub 的 `schedule` 在仓库长时间无活动后可能被暂停，也可能因队列繁忙延迟几分钟执行，属正常现象。

---

## 四、前 100 名是怎么算出来的（fetch_top100.py）

GitHub Trending 页面只有 9~25 条，**永远拿不到 100 条**，所以改用
[GitHub Search API](https://docs.github.com/rest/search)：`per_page=100` 每页稳定 100 条，
返回的 item 本身就是完整 repo 对象（含 stars / forks / language / description / topics /
license / owner），**不需要再逐个调 core API 补全**。search 配额与 core 独立：
匿名 10 次/分钟，带 token 30 次/分钟（脚本按有无 token 自动选择 7s / 2.5s 间隔）。

### 两条互补的增量来源（取并集）

| 来源 | 查询 | 依据 | `growthSource` |
| --- | --- | --- | --- |
| **A 新建仓库** | `created:{start}..{end} stars:>{min}` 按 stars 降序 | 仓库年龄 < 周期长度，它的 star 总数**就等于**该周期内的真实增量，不需要历史基线，冷启动当天就能出 100 条 | `new` |
| **B 快照做差** | 候选池今日 stars − 基线日快照 stars | 覆盖老仓库的增量（例如创建于 8 月的仓库今天涨了 4640） | `snapshot` |

窗口定义（**一律用时刻级 ISO8601**，理由见下）：

| 周期 | 窗口 | 归档文件名 | 徽标文案 |
| --- | --- | --- | --- |
| 日榜 | 滚动最近 **24 小时**（截至运行时刻） | `YYYY-MM-DD` | 今日新增 |
| 周榜 | 最近 **7 个完整自然日**（周一 08:00 运行时 = 上周一 ~ 周日） | `YYYY-MM-DD` | 上周新增 |
| 月榜 | **上一个完整自然月**（每月 1 号运行时 = 上月 1 日 ~ 月末） | `YYYY-MM`（上月） | 上月新增 |

查询表达式写成 `created:{start}..{end}`（两端都是 `2026-10-07T00:00:00Z` 这类带时刻的值）。
这里有两个实测踩出来的坑，别改回去：

1. **不能用纯日期区间** `created:2026-10-07..2026-10-08`：GitHub 两端都按整天包含，
   实际是 48 小时，日榜会混入大量创建于 36 小时前、根本不属于「今日」的仓库。
   实测对比：日期区间 `total_count=328`、top1 创建于 10-07；时刻区间 `total_count=151`、top1 创建于 10-08。
2. **不能写两个 created 限定词** `created:>=X created:<=Y`：GitHub 会**静默忽略**（不报错），
   返回全库结果（实测 `total_count=4369553`，top1 是 2018 年的仓库）。

min stars 默认值：日榜 5、周榜 30、月榜 100。
- 基线：日榜取 `T-1` 快照、周榜 `T-7`、月榜 `T-30`；**找不到就取该日期之前最近的一份**，
  并在产物里用 `baselineDate` 写明实际用了哪天（不猜、不谎报）。
- 候选池（每天跑，用于写快照）：
  `stars:>2000 pushed:>T-30d`（2 页）+ `stars:>300 created:>T-90d`（2 页）
  + `stars:>1000 pushed:>T-7d`（1 页）+ 当天 Trending 日/周/月页抓到的仓库。

### 必须凑满 100 条

A + B 去重后按 `periodStars` 降序取前 100。若不足，按序降级补位：

1. 逐步降低来源 A 的 min stars 阈值（日 `5→3→1`、周 `30→10→5`、月 `100→50→20`）重新查询；
2. 仍不足则用候选池按绝对 star 数降序补满，补位条目 `growthSource="fallback"`、
   **`growthExact=false`**、`periodStars=0`（增量不可考，不硬塞一个假数字）。

**补位项一律排在末尾**：排序键是 `(是否增量可考, -periodStars, -stars, 名称)`，
所以 5 万星的补位老仓库绝不会挤在真正飙升的新项目前面。
前端对 `growthExact=false` 显示 `— 增幅待考`（灰色弱化徽标）而不是 `+0`。

始终输出 100 条；只有当全 GitHub 都没这么多数据时才按实际条数输出并打 WARN 日志。

**为什么「始终 100 条」还需要一道闸门**：`data/<period>.json` 与 `data/pages/<period>/`
由 `fetch_top100.py` 维护，但它**平时只重建日榜**（周榜仅周一、月榜仅 1 号）。而
`fetch_rank.py`（Trending 页，只有 9~25 条）是**每天**都跑的，一旦无条件覆盖，
非周一/非 1 号的日子里周榜、月榜就会被砸成 Trending 的薄数据 —— 实测首个定时任务
跑出周榜 `100→11`、月榜 `100→24`，与前端 6 条/页 × 17 页的结构直接矛盾
（前端仍会渲染，但「共 11 个项目」和无限滚动只剩 2 页）。

所以 `fetch_rank.py` 里有一道**不退化闸门**：本次抓到的条数**少于**磁盘上已有的条数时
直接跳过覆盖并打 `WARN`，保留 `fetch_top100.py` 的产物。判据是**条数**，不是质量 ——
Trending 的数据在同条数下未必更差，但「更少」一定是退化。
对应一条 A/B 回归断言：带闸门时三榜保持 `100 / 17 页`；把闸门整段删掉后
必须变成 `9/2`、`11/2`、`24/4`（后者正是线上出现过的症状），否则说明闸门没生效。

### 归档产物

| 路径 | 说明 |
| --- | --- |
| `data/daily/YYYY-MM-DD.json` | 当日前 100（每天一份） |
| `data/weekly/YYYY-MM-DD.json` | 上周前 100（周一生成，主名取**该自然周周一的日期**） |
| `data/monthly/YYYY-MM.json` | 上月前 100（每月 1 号生成；11-01 跑出 `2026-10.json` = 10 月整月） |
| `data/snapshots/YYYY-MM-DD.json` | `{"date","generatedAt","poolSize","stars":{fullName: stars}}`，只保留最近 **40** 份 |
| `data/revisions/<period>/<name>@<HHMMSS>.json` | 同日重跑的旧归档留底，见下一节 |
| `data/history/YYYY-MM-DD.json` | `fetch_rank.py` 的 Trending 整榜快照（每天一份，**永不裁剪**，体积约 58KB/天） |
| `data/archive/index.json` | 归档索引，前端直读（结构见下） |

每次产出时同步覆盖写 `data/{daily,weekly,monthly}.json` 与 `data/pages/<period>/N.json`
（每片 6 条），**现有页面不用改就自动升级成展示前 100**（月榜约 17 片）。

归档文件比"最新一份"多五个字段：`date` / `rangeStart` / `rangeEnd` / `baselineDate` / `growthStats`。

> **最近一期归档与"最新榜单"是同一次抓取的同一份内容**（两者 `updatedAt` 完全相等），
> 所以前端不会把它当成一枚历史芯片重复列出来 —— 否则点进去必然一字不差，
> 看起来就像"切换到历史期没生效"。详见第五节。

`data/archive/index.json` 是**前端形状**而不是"目录清单"，字段全部为 UI 直接可用而备：

```json
{
  "generatedAt": "2026-10-09T12:13:53+08:00",
  "types": {
    "daily": {
      "periodLabel": "近 24 小时飙升榜",
      "dir": "data/daily",
      "count": 4, "latest": "2026-10-08", "oldest": "2026-10-01",
      "files": [
        {
          "name": "2026-10-08",
          "file": "data/daily/2026-10-08.json",
          "date": "2026-10-08",
          "count": 100,
          "rangeStart": "2026-10-07T00:00:00Z",
          "rangeEnd":   "2026-10-08T00:00:00Z",
          "updatedAt":  "2026-10-09T11:13:32+08:00",
          "revisions": 0
        }
      ]
    }
  },
  "snapshots": { "dir": "data/snapshots", "count": 1, "latest": "2026-10-08", "keep": 40, "files": ["2026-10-08"] }
}
```

三个容易被写错的点：

1. **`files` 按 `name` 倒序**（新的在前）——前端直接顺序渲染芯片，不再自己排序。
2. `file` **是相对站点根的路径**（`data/daily/2026-10-08.json`），前端 `fetch(entry.file)` 直接可用，
   不需要拼接。
3. `rangeStart` / `rangeEnd` 是**原样转述归档里的 ISO 时刻**，索引层不做任何时区换算。

---

## 五、历史榜单（昨日 / 上周 / 上月）

> 需求原文：**「每次抓取的数据都需要保留下来，不能丢弃或者覆盖掉」**。
> 这一节说明这份承诺在代码里具体由什么保证。

### 一句话结论

**归档本身从来就没被删过**——`fetch_top100.py` 一直在按窗口日期写
`data/{daily,weekly,monthly}/<name>.json`，不同日期自然落在不同文件里。
所以这次要补的不是"开始做归档"，而是三件此前缺失的事：

| 缺口 | 后果 | 本次修法 |
| --- | --- | --- |
| `pages.yml` 把 `data/{daily,weekly,monthly}`、`data/archive` **显式排除**在 `_site/` 之外 | 归档在仓库里有、**浏览器里没有**，历史无从谈起 | 改为按原路径拷入发布产物（见「发布产物范围」） |
| `archive/index.json` 是"目录清单"形状（升序、无统计范围） | 前端拿到也用不了 | 重写为倒序 + `rangeStart`/`rangeEnd`/`revisions` |
| 没有任何 UI 入口 | 用户看不到 | 新增历史行 + 芯片 + 直链 |

### "不覆盖"是怎么保证的

只有一种情况会真正覆盖：**同一天跑第二次**——归档文件名由窗口日期算出，
重跑必然命中同名文件。这里做了三件事：

1. **先比对再动手**。`preserve_revision()` 把新文本与磁盘上的旧文本**逐字节比较**，
   **完全相同就什么都不做**。GitHub Actions 的重试、手动补跑这类"原样重跑"不会产生任何留底，
   不会把 `data/revisions/` 灌满重复副本。
2. **不同才留底**。确认内容变了，才把**旧**那份复制到
   `data/revisions/<period>/<name>@<HHMMSS>.json`，然后再写新内容。
3. **留底文件名防撞**。`%H%M%S` 只有秒级精度——**同一秒内的两次重跑会算出同一个文件名，
   于是第二份留底把第一份覆盖掉，"不覆盖"的保险本身成了覆盖**。
   这个缺陷是测试跑出来的（断言期望 2 份、实际 1 份），修法是
   `while os.path.exists(target)` 追加 `-1` / `-2` 序号。

```python
def preserve_revision(period, path, new_text):
    if not os.path.isfile(path):
        return None
    with open(path, "r", encoding="utf-8") as handle:
        old_text = handle.read()
    if old_text == new_text:
        return None                       # 一模一样的重跑不该产生副本
    stamp = datetime.now(TZ_BEIJING).strftime("%H%M%S")
    name = os.path.basename(path)[:-5]
    target = os.path.join(REVISION_DIR, period, "{0}@{1}.json".format(name, stamp))
    seq = 1
    while os.path.exists(target):          # 秒级时间戳不足以保证唯一
        target = os.path.join(REVISION_DIR, period, "{0}@{1}-{2}.json".format(name, stamp, seq))
        seq += 1
    ...
```

### 谁会被裁剪，谁永远不会

| 目录 | 保留策略 | 理由 |
| --- | --- | --- |
| `data/{daily,weekly,monthly}/` | **永不裁剪** | 这就是要展示的历史 |
| `data/revisions/` | **永不裁剪** | 追溯用，且只有"同日重跑且内容不同"才产生，增长极慢 |
| `data/history/` | **永不裁剪** | 旧脚本 `fetch_rank.py` 的 Trending 整榜快照，已不参与展示；约 58KB/天 |
| `data/snapshots/` | 只留最近 **40** 份 | 纯中间态，仅用于算增量，裁掉不影响任何展示 |
| `data/archive/index.json` | 每次重建 | 索引，随时可由前两者重新算出 |

`prune_snapshots()` 只遍历 `data/snapshots/`，**碰不到归档与留底**——
这条有专门的回归断言盯着（`prune_snapshots 后归档不变` / `prune_snapshots 后留底不变`）。

### 最近一期为什么不在历史行里（一次"看起来没生效"的返工）

用户反馈：**「历史的数据也需要保存下来，现在切换的时候，用的并不是历史数据」**。

排查结论（用真实数据实测，不是猜）：

- 前端链路**是好的**。点历史期后 hash 变 `#daily@2026-10-08`、徽标加 `快照 ·`、
  渲染出的 100 条与 `data/daily/2026-10-08.json` **逐条一致**（日榜、周榜都验过）；
  `data/` 下所有请求状态码 200，无控制台错误。
- 真正的原因是**结构性冗余**：`write_archive()` 与 `write_latest()` 出自**同一次抓取的同一份
  items**，两者的 `updatedAt` 完全相等。因此"最近一期归档"在结构上**永远**等于"最新榜单"。
  历史行把这枚期也当成一枚历史芯片列出来 → 点进去必然一字不差 → 看起来"切换没生效"。
- 叠加因素：`update-rank.yml` 的 cron 当时还没真正跑起来（仓库尚未推送、Pages 未开启），
  日榜归档只有 1 期，于是历史行里**唯一**那枚日期芯片恰好就是这份冗余期 —— "每期都会发生一次"
  的冗余，被放大成了"历史功能整个没用"。

**修法**：历史行与「全部归档」面板都**不再重复列出"与最新同一次抓取"的期**。判据是
「该期归档的 `updatedAt` === 该周期实时榜索引的 `updatedAt`」。

> 为什么用 `updatedAt` 而不是日期：日期只能回答"是哪一天"，而同一个窗口可能被抓过多次
> （补跑、重试、CI 重跑）。`updatedAt` 精确回答"是不是同一次抓取"。重抓过的那一期的
> `updatedAt` 变了，就会**重新出现**在历史行里 —— 这正是想要的行为。

两个实现细节值得记住：

1. 快照态下 `feed.index` 会被快照数据覆盖（见 `fetchSnapshot()`），**不能直接拿它判**。
   实时榜的 `updatedAt` 需要单独缓存（`state.liveUpdatedAt[period]`，只在 `loadIndex()` 成功分支写）。
2. 缓存为空（索引 404 / 尚未返回）时**不过滤**，退化为原行为 —— 历史行宁可多列一枚，
   也不能因为拿不到判据就把整行清空。

还有一个只有实测才会暴露的坑：**判据是异步到达的，所以重画必须由"判据变了"自己触发。**

「全部 N 期」上的 N 是**三个周期过滤后可见期数之和**（面板里列的是全部，按钮上的数字就得同口径）。
但首屏那一刻只有当前周期的 `updatedAt` 到位，周/月榜还在预取路上 —— 于是那一次渲染会把
周/月榜的同源期也算进去，数字定格成一个比面板行数大的值，**而且不会自愈**：
`loadIndex()` 的重画带着 `period === state.period` 门禁，`prefetchOthers()` 解析完又从不重画。

修法是把重画挂在判据变化上，而不是靠调用方记得重画：

```js
function recordLiveUpdatedAt(period, updatedAt) {
  if (!updatedAt) { return; }                                 // 空值不覆盖已知值
  if (state.liveUpdatedAt[period] === updatedAt) { return; }   // 没变就别白重画
  state.liveUpdatedAt[period] = updatedAt;
  repaintHistory();          // = state.history 就绪时 renderHistoryBar()
}
```

兜底点是 `loadHistoryIndex()` 的 `.then` —— 它在成功与失败两条路径上都会调 `renderHistoryBar()`，
所以"归档索引比实时榜晚到"也不会留空白。**一个触发点 + 一个兜底点，不需要第三个**：
在 `loadIndex()` 里再加一行无条件重画，反而会让上面那个缺陷被掩盖（两处触发互相兜底，
针对它的回归断言就再也红不了了）。

### 判据未知时不能说"不同源"（一次"先渲染后撤销"的返工）

判据是**异步**到达的。如果把"还不知道"当成"确认不同源"，首帧就会把判据未到的周期
当真历史渲染出来，判据一到又撤掉 —— **元素闪出再消失**。实测真实数据冷启动会闪出
「全部 3 期」约 200ms 再消失；而改之前历史行不依赖任何异步判据、首帧即终态，
所以这是本次改动**新引入**的回退。本项目已经为"抖动 / 闪动"返工过两次，这条不能留。

修法是给每个周期的判据一个状态机，**未定就干脆不画**：

| 状态 | 含义 | 渲染行为 |
| --- | --- | --- |
| `pending` | 判据还在路上 | 该周期**不参与渲染**（不出芯片、不计入 `N`、不进面板），历史行显示占位文案 |
| `done` + 有值 | 判据已定 | 按 `snap.updatedAt === 值` 过滤 |
| `done` + 无值 | 确认拿不到（索引没这个字段 / 请求失败） | **不过滤**，退化为原行为，照常展示 |
| `abandoned` | 兜底超时后放弃 | 展示同 `done` 无值；但它是**单向闸门** |

两条硬性约束：

1. **必须有兜底**。首屏起一个 3 秒定时器 (`LIVE_FALLBACK_MS`)，把仍是 `pending` 的周期落定为
   `abandoned`。否则某个索引请求挂住时，历史行会**永久停在占位态** —— 那比闪动严重得多。
   兜底覆盖的是**三条启动路径**：常规启动、深链进快照（当前周期走 `fetchSnapshot` 不走
   `loadIndex`）、以及页面内 `hashchange`。
2. **`abandoned` 之后一律不接受迟到值**。`recordLiveUpdatedAt()` 见到 `abandoned` 直接 `return`。
   否则会出现：3 秒兜底先按"拿不到"渲染出该周期的期 → 3.5 秒响应姗姗来迟 → 判据一到又把那一期撤掉。
   **>3 秒才返回的索引请求在弱网/移动端很常见**，这条路径完全可达。

于是收敛是**单调的**：任何已经画出来的芯片不会随后消失，`N` 与面板行数只增不减
（占位文案被真实芯片替换是允许的，那是既有的"占位 → 内容"模式）。

对应四条断言：*冷启动单调性探针*（~50ms 采样：快照名一旦出现就不再消失、`N` 与行数只增不减）、
*晚到反转*（3500ms 迟到不得撤销已渲染内容）、*不许改过头*（1500ms 必须被正常过滤，
防"引入放弃态就一律不过滤"）、*放弃不可复活*。

### 留底（revisions）在界面上怎么看

`data/revisions/` 存的是"同一天重跑、内容又变了"的旧版本。`archive/index.json` 的每条都带
`revisions` 计数，但这个字段此前**从未被前端使用** —— "每次抓取都不丢"因此在界面上完全不可见。
现在历史期芯片的悬停提示与「全部归档」面板的行上都会显示「含 N 次重抓留底」（`N = 0` 时不显示）。

### 前端怎么看

- **历史行**：Tab 与标签栏之间的一行芯片，`最新` 在左，越往右越旧。
  索引是倒序的，所以渲染顺序即时间倒序，不需要前端排序。
- **芯片文案语义优先**：`昨日 10-08`，不是 `10-08 昨日`。用户口中的需求是
  "查看**昨日排行**、**上周排行**、**上月排行**"，把语义做成小号浅色后缀，
  等于把最该被看见的几个字做成了附注。
- **四态等高**：`.history-bar { min-height: calc(var(--hchip-h) + 18px) }` = 4 + 26 + 14 = **44px**，
  `flex-wrap: nowrap`。**索引加载中 / 判据未定的占位 / 该周期暂无归档 / 几十个芯片**四种状态下
  高度恒为 44px，内容多少不会推动下方的榜单。
  > 这是刻意修的：历史行是异步加载的，如果高度随内容变化，索引回来的那一刻
  > 整页会往下跳——正是之前「切榜抖动」的同一类问题。
- **内联只放 4 期**：超过 `HISTORY_INLINE_MAX`(4) 期时，多一个 `全部 N 期` 按钮打开面板。
  否则这一行会退化成一条要横滑的缝——**缝就是"隐晦"**。
- **路由**：地址采用 `#<period>` 或 `#<period>@<快照名>`。
  `#daily` 看实时，`#daily@2026-10-08` 看那一期。Tab 点击、芯片点击、面板行点击、
  浏览器前进后退（`hashchange`）、以及首次带 hash 打开，**全部走同一个状态迁移函数 `applyRoute()`**，
  避免"某条入口忘了渲染历史行"这类不一致。
- **周期记忆**：每个周期各自记住自己选了哪一期。日榜留在实时、月榜停在 `2026-09`，
  来回切 Tab 不会互相冲掉。
- **快照态**：正看归档时，右上角更新时间前缀 `快照 · ` 且圆点变灰；
  列表末尾补一行 `统计范围 2026-10-07 → 2026-10-08`。
  标签筛选在快照态下同样可用，编号从 `01` 重新排。

### 入口为什么长这样（一次可发现性返工）

第一版的历史行是**裸文字 + 发丝竖线**，用户反馈"太隐晦"。诊断出来是四个叠加问题：

| 问题 | 为什么会让人看不懂 |
| --- | --- |
| 全页**唯一"可点却没有可点形状"**的东西 | Tab 有 2px 下划线、标签 chip 有 hover 与下划线、卡片有带下边框的「详情」；历史行是裸文字，那就是**面包屑的视觉语言** |
| `历史` 二字是前缀不是入口 | 11px 大写字母间距 + `--faint`(浅色 `#c4c4c4`，对白底仅 1.74:1)，和后面的芯片视觉同质，连成一句话 |
| 与下方标签栏**两行同质小字** | 两行都可点、都小、都横排，历史行被读成标签栏的说明文字 |
| 选中态只加粗 | 没有形状变化，看不出"我已经不在最新了" |

改版对照：

| | 改版前 | 改版后 |
| --- | --- | --- |
| 入口 | `历史`（11px 浅灰裸字） | 🕘 **历史**（12px 加粗 + 时钟图标） |
| 芯片 | 裸文字，靠发丝竖线分隔 | **描边胶囊**（26px，圆角），与标签 chip 同族但形状明确 |
| 选中态 | 加粗 + 变深 | **反色填充**（墨底白字 / 暗色下白底墨字） |
| 文案主次 | `10-08 昨日`（日期为主，语义为附注） | `昨日 10-08`（**语义为主**，日期用等宽小字） |
| 期数多时 | 只能在一行里横滑 | 内联 4 期 + `全部 N 期` **面板**（按周期分组、当前周期排最前） |

面板的**绝对定位**不是随手写的：它一旦参与布局，展开就会改变历史行的实际高度，
正好破坏上面那条"高度与内容无关"的约束，展开那一刻整页会被往下推。
有一条回归断言专门盯着这件事（`展开面板不改变历史行高度` / `展开面板不推动下方榜单`）。

### 自己造几期归档试试

不用等 30 天，把归档文件造出来即可。以"多出一期昨天"为例：

```bash
# 1) 复制并改名为昨天
cp data/daily/2026-10-08.json data/daily/2026-10-07.json

# 2) 把里面的窗口字段整体前移一天 —— 不改的话统计范围会自相矛盾
#    （文件名说 10-07，内容却写着 10-07T00:30 ~ 10-08T00:30）
python3 - <<'PY'
import io, json, datetime as dt
p = 'data/daily/2026-10-07.json'
d = json.load(io.open(p, encoding='utf-8'))
shift = lambda s: (dt.datetime.strptime(s, '%Y-%m-%dT%H:%M:%SZ')
                   - dt.timedelta(days=1)).strftime('%Y-%m-%dT%H:%M:%SZ')
d['date'] = '2026-10-07'
d['rangeStart'] = shift(d['rangeStart'])
d['rangeEnd'] = shift(d['rangeEnd'])
json.dump(d, io.open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
PY

# 3) 重建索引，刷新页面就能看到多出来的那枚芯片
python3 scripts/fetch_top100.py --rebuild-archive-index
```

周榜 / 月榜同理，只是文件名规则不同（周榜主名取该自然周周一的日期，月榜是 `YYYY-MM`）。

> **造出来的文件记得自己删掉**。归档是"永不覆盖"的（这正是历史功能的前提），
> 下一次真实抓取写的是**新日期**的文件，**不会**覆盖你手工造的这份——
> 留着它，页面历史里就会永远挂着一期假数据（还要占体积、还会被发布上线）。

---

## 六、本地预览与调试

页面通过 `fetch()` 读取 `data/*.json`，**必须走 HTTP 协议**，直接双击 `index.html`
（`file://`）会被浏览器 CORS 策略拦截。在项目根目录执行：

```bash
python3 -m http.server 8000
# 然后浏览器打开 http://localhost:8000
```

手动跑一次抓取（会用真实数据覆盖 `data/`）：

```bash
python3 scripts/fetch_rank.py                    # 抓取三个周期并调用 API 补全
python3 scripts/fetch_rank.py --periods daily    # 只抓日榜
python3 scripts/fetch_rank.py --no-enrich        # 不调 API，纯页面抓取（更快）
python3 scripts/fetch_rank.py --no-history       # 不写 data/history 归档
```

带 Token 可以获得 5000 次/小时的 API 限额（匿名只有 60 次/小时）：

```bash
GITHUB_TOKEN=ghp_xxx python3 scripts/fetch_rank.py
```

在 Actions 中 `GITHUB_TOKEN` 由 `${{ secrets.GITHUB_TOKEN }}` 自动注入，无需额外配置。

---

## 七、数据格式

### `data/daily.json`（weekly / monthly 结构相同）

```json
{
  "period": "daily",
  "periodLabel": "今日飙升榜",
  "updatedAt": "2026-10-08T20:30:00+08:00",
  "source": "https://github.com/trending?since=daily",
  "count": 25,
  "items": [
    {
      "rank": 1,
      "fullName": "owner/repo",
      "owner": "owner",
      "name": "repo",
      "url": "https://github.com/owner/repo",
      "description": "项目描述",
      "language": "TypeScript",
      "languageColor": "#3178c6",
      "stars": 12222,
      "ownerHomepage": "https://example.com",
      "forks": 2000,
      "periodStars": 4640,
      "periodLabel": "今日新增",
      "tags": ["agent", "ai"],
      "createdAt": "2026-04-14",
      "pushedAt": "2026-10-08",
      "topics": ["ai", "agent"],
      "license": "MIT",
      "ownerAvatar": "https://avatars.githubusercontent.com/...",
      "contributors": ["https://avatars.githubusercontent.com/..."],
      "enriched": true
    }
  ]
}
```

### `data/meta.json`

```json
{
  "updatedAt": "2026-10-08T20:30:00+08:00",
  "counts": { "daily": 9, "weekly": 11, "monthly": 24 },
  "generator": "fetch_rank.py",
  "source": "https://github.com/trending",
  "periods": ["daily", "monthly", "weekly"],
  "freshPeriods": ["daily", "monthly", "weekly"]
}
```

`updatedAt` **只在本次确实抓到新数据时才推进**；三个周期全部失败时保持上一次的值，
不会"谎报"更新时间，也不会让 `data/` 因 meta 抖动产生一次空提交。
`freshPeriods` 记录本次真正抓到数据的周期（可能少于 `periods`，例如只有日榜成功）。

### `data/pages/<period>/N.json`（前端滚动加载用）

```json
{
  "period": "daily",
  "periodLabel": "今日飙升榜",
  "updatedAt": "2026-10-08T20:30:00+08:00",
  "page": 1,
  "pageSize": 6,
  "totalPages": 2,
  "total": 9,
  "items": [ /* 与上面 items 结构完全相同 */ ]
}
```

同目录下的 `index.json` 不带 `items`，只给 `totalPages` / `total` / `tagCounts`，
前端先进它拿到标签统计与总页数，再逐片拉取 `1.json` … `N.json`。
若 `data/pages` 缺失（例如只保留了旧版产物），前端会自动回退到整份 `data/<period>.json`
并在客户端切分，功能不受影响。

### 字段说明

| 字段 | 说明 |
| --- | --- |
| `rank` | 榜单排名，由 GitHub Trending 页面顺序决定 |
| `tags` | 自动打的标签 key（见下表），最多 3 个，未命中任何规则时为空数组 |
| `periodStars` | 本周期新增 star 数（日榜 = `stars today`，周榜 = `stars this week`，月榜 = `stars this month`） |
| `periodLabel` | 周期增长量的中文标签：`今日新增` / `本周新增` / `本月新增` |
| `languageColor` | 语言对应的主题色（脚本内置常见语言配色表，未知语言为 `#8c959f`） |
| `ownerHomepage` | owner 主页（REST API 补全，可能为空串） |
| `enriched` | 是否成功通过 REST API 补全元信息；`false` 表示使用了页面抓取的降级字段 |
| `contributors` | 页面上「Built by」区域的贡献者头像 URL（最多 5 个） |

> 榜单条目数**以 GitHub Trending 页面实际返回为准**（页面通常在 9~25 条之间浮动），
> 脚本不做任何硬编码条数限制，前端也不假设固定条数。

### 标签规则

标签在 REST API 补全**之后**计算（这样才能用到 API 回传的描述与 topics），
检索范围是「仓库名 + owner + 描述 + 语言 + topics」的小写文本：

- 纯 ASCII 关键词按**词边界**匹配，避免 `chain` 命中 `ai`、`mail` 命中 `ml` 这类误伤；
- 含中文的关键词按子串匹配；
- 按 `TAG_RULES` 的顺序取前 **3** 个命中的标签；一个都没命中就是空数组，不做硬塞。

| key | 中文 | English | 典型命中词 |
| --- | --- | --- | --- |
| `llm` | 大模型 | LLM | llm / gpt / transformer / qwen / 微调 / 大模型 |
| `agent` | 智能体 | Agent | agent / multi-agent / copilot / mcp / 编排 |
| `ai` | AI | AI | ai / machine learning / neural / diffusion / 人工智能 |
| `security` | 安全 | Security | security / audit / penetration / 逆向 / 漏洞 |
| `media` | 多媒体 | Media | video / image / audio / tts / 视频 / 图像 |
| `cli` | 命令行 | CLI | cli / terminal / tui / command-line / 命令行 |
| `web` | 前端 | Web | frontend / react / vue / browser / 前端 |
| `mobile` | 移动端 | Mobile | android / ios / swift / flutter / 移动端 |
| `database` | 数据库 | Database | database / postgres / redis / orm / 数据库 |
| `devops` | 部署运维 | DevOps | docker / kubernetes / self-hosted / 部署 / 运维 |
| `game` | 游戏 | Game | game / unity / emulator / 游戏 |
| `data` | 数据 | Data | analytics / etl / crawler / 爬虫 / 可视化 |
| `devtool` | 开发工具 | Dev Tool | sdk / framework / plugin / compiler / 编辑器 |
| `docs` | 文档 | Docs | docs / tutorial / note / 笔记 / 教程 |

> 想增删标签，改 `scripts/fetch_rank.py` 的 `TAG_RULES`（脚本侧）与
> `assets/app.js` 的 `TAG_LABELS`（文案侧）即可，两处 key 一一对应。

---

## 八、健壮性设计

- **单条容错**：任一字段（描述 / 语言 / 头像 / 计数）解析失败，只会置为空值或 0，不会丢弃整条记录。
- **单榜容错**：某个周期抓取失败或解析出 0 条时，保留上一次的 `data/*.json`，**不会用空数据覆盖**。
- **不谎报更新时间**：三个周期全部失败时，`meta.json` 的 `updatedAt` 保持不变、历史归档也不重写，
  因此 `git status --porcelain data` 为空，不会产生空提交；前端也不会显示假的更新时间。
- **API 降级**：REST API 超时 / 404 / 限流时，自动降级使用页面抓取值，`enriched` 标记为 `false`。
- **退出码**：脚本恒以 `0` 退出，避免定时任务因一次网络抖动变红并中断后续部署。
- **代理**：脚本内显式 `ProxyHandler({})` 直连，不受 CI/本机代理环境变量影响。
- **并发**：API 补全为顺序执行 + 每次间隔 0.15s，不会打爆限额。
- **Search 限流自愈**（`fetch_top100.py`）：HTTP 403/429 时按 15s / 27s 退避重试最多 3 次；
  始终失败则该查询降级为空、换下一个来源，不影响其他榜。
- **快照裁剪**：`data/snapshots/` 只保留最近 40 份（按文件名日期删除更旧的），删除失败只告警不中断。
  **注意裁剪只针对快照**——归档（`data/{daily,weekly,monthly}/`）与留底（`data/revisions/`）
  **永不裁剪**，它们是展示数据本身。
- **不谎报增量**：快照做差时基线里没有的仓库直接跳过（不猜测增量）；
  降级补位的条目显式标记 `growthExact=false` 且 `periodStars=0`。
- **归档不被覆盖**：同日重跑时旧归档先转存到 `data/revisions/`，留底文件名带
  `while os.path.exists()` 序号兜底（秒级时间戳在同一秒内两次重跑会算出同名文件，
  第二份会把第一份覆盖掉——"不覆盖"的保险自己成了覆盖）。
- **历史坏了不影响主榜单**：归档索引 404 / 解析失败时，历史行渲染为空态并保持 38px 高度，
  主榜单照常显示，首屏不出现任何错误态。数据层同样有索引缺失的部署守卫（见第二节）。
- **陈旧响应不污染重置后的榜单**：每次重置榜单会自增一个 `epoch`（代际计数），
  `loadIndex` / `loadPage` / `fetchSnapshot` / `applyTag` 都在发起前记下当时的代际，
  回来时代际已变则**丢弃**。防的是"点开一期历史快照时，实时榜的翻页请求还在路上，
  回来把内容写进已经重置的 feed"——表现为条数与分页对不上、列表只有半截。
  > `epoch` 必须**基于旧值自增**再覆盖：直接赋一个新的 `newFeed()` 会让连续两次重置拿到同一代际，守卫形同虚设。

---

## 九、数据来源署名

- 榜单排序与周期增长量：**[GitHub Trending](https://github.com/trending)**（GitHub 官方页面）
- 仓库描述、star / fork 总数、语言、topics、创建与推送时间、license、owner 头像：
  **[GitHub REST API](https://docs.github.com/rest/repos/repos)** `GET /repos/{owner}/{repo}`
- 灵感参考：[github-daily-rank](https://github.com/OpenGithubs/github-daily-rank)、
  [github-weekly-rank](https://github.com/OpenGithubs/github-weekly-rank)、
  [github-monthly-rank](https://github.com/OpenGithubs/github-monthly-rank)

本项目仅做数据聚合展示，所有仓库信息版权归各自作者所有。内容受
[GitHub Terms of Service](https://docs.github.com/site-policy/github-terms/github-terms-of-service) 约束。
