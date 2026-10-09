#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""GitHub 榜单「前 100 名」抓取脚本（GitHub Search API + 快照做差）.

为什么要这个脚本:
    GitHub Trending 页面只有 9~25 条, 永远拿不到 100 条。这里改用 GitHub Search API
    (``GET /search/repositories``), ``per_page=100`` 每页稳定返回 100 条, 且返回的 item
    本身就是完整 repo 对象(含 stars/forks/language/description/topics/license/owner),
    **不需要再逐个调 core API 补全**。search 配额与 core 独立: 匿名 10 次/分钟,
    带 token 30 次/分钟。

两条互补的增量来源(取并集):
    A. 新建仓库 —— 查 ``created:{start}..{end} stars:>{min}``（**时刻级** ISO8601）按 stars 降序。
       日期级区间会让日榜变成 48 小时，两个 created 限定词会被 GitHub 静默忽略，详见 make_query。
       因为仓库年龄 < 周期长度, 它的 star 总数就等于该周期内的真实增量,
       不需要任何历史基线, 冷启动当天就能出 100 条。``growthSource="new"``。
    B. 快照做差 —— 每天把候选池的 star 数存成 ``data/snapshots/YYYY-MM-DD.json``,
       与基线日快照相减得到老仓库的增量(例如创建于 8 月的仓库今天涨了 4640)。
       ``growthSource="snapshot"``。基线缺失时该来源为空, 不报错。

凑满 100 的降级路径:
    1. 逐步降低来源 A 的 min stars 阈值(日 5→3→1 / 周 30→10→5 / 月 100→50→20)重查;
    2. 仍不足则用候选池按绝对 star 数降序补位, 补位条目 ``growthSource="fallback"``
       且 ``growthExact=false``(增量不可考, 不谎报)。

产物:
    data/daily/YYYY-MM-DD.json     今日前 100(每天一份)
    data/weekly/YYYY-MM-DD.json    上周前 100(周一生成)
    data/monthly/YYYY-MM.json      上月前 100(每月 1 号生成)
    data/snapshots/YYYY-MM-DD.json 候选池快照 {fullName: stars}
    data/archive/index.json        归档索引
    data/{daily,weekly,monthly}.json  + data/pages/<period>/N.json
        (最新一份, 供现有前端读取, 页面自动升级成展示前 100)

设计约束(沿用 fetch_rank.py 的约定):
    * 仅依赖 Python 3 标准库; 复用 fetch_rank 的 http/打标签/写 JSON/分页函数(import 复用);
    * 任何单个查询失败只降级不中断, 脚本退出码恒为 0;
    * 抓不到任何新数据时, 不得用空榜覆盖已有的 data/{daily,weekly,monthly}.json;
    * data/snapshots/ 只保留最近 40 份, 删除失败也不许让脚本失败。

用法:
    python3 scripts/fetch_top100.py                       # 按运行日期自动决定产出哪些榜
    python3 scripts/fetch_top100.py --periods daily,weekly,monthly
    python3 scripts/fetch_top100.py --date 2026-10-08     # 当作哪天跑(补跑/测试)
    python3 scripts/fetch_top100.py --top 100 --sleep 7
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

#: 保证从任意工作目录运行都能 import 同目录下的 fetch_rank
_SCRIPT_DIR: str = os.path.dirname(os.path.abspath(__file__))
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)

import fetch_rank as fr  # noqa: E402  (必须先补 sys.path 再 import)

# --------------------------------------------------------------------------------------
# 常量与配置
# --------------------------------------------------------------------------------------

DATA_DIR: str = fr.DATA_DIR
SNAPSHOT_DIR: str = os.path.join(DATA_DIR, "snapshots")
ARCHIVE_DIR: str = os.path.join(DATA_DIR, "archive")
PERIOD_DIRS: Dict[str, str] = {
    "daily": os.path.join(DATA_DIR, "daily"),
    "weekly": os.path.join(DATA_DIR, "weekly"),
    "monthly": os.path.join(DATA_DIR, "monthly"),
}

#: 同一天重跑时, 被新版覆盖掉的旧归档转存到这里, 保证「任何一次抓取结果都不丢」。
#:
#: 归档按日期命名, 跨日期天然是不同文件, 所以正常每日运行时这里始终是空的;
#: 只有「同一天跑第二次」(定时补跑、手动 retry、改配置后重跑) 才会产生留底。
#: 快照目录 data/snapshots 会裁剪到最近 40 份(它只是算增量的中间量),
#: 但**归档与留底永不裁剪** —— 它们是展示数据本身。
REVISION_DIR: str = os.path.join(DATA_DIR, "revisions")

#: 北京时区(固定偏移, 不依赖 tzdata)
TZ_BEIJING: timezone = fr.TZ_BEIJING

#: 默认榜单条数
DEFAULT_TOP_N: int = 100

#: 搜索请求间隔(秒): 匿名 10 次/分钟, 带 token 30 次/分钟
SLEEP_ANONYMOUS: float = 7.0
SLEEP_WITH_TOKEN: float = 2.5

#: 快照保留份数
SNAPSHOT_KEEP: int = 40

#: 每个周期的窗口长度、min stars 降级阶梯、归档文件名格式、展示文案
#:
#: 窗口语义（重要，见 compute_window）：
#:   * daily   —— 滚动最近 24 小时（截至运行时刻），对应「近 24 小时新增」
#:               （刻意不写「今日」：它是滚动窗口，不是自然日，写成"今日"会被误读）
#:   * weekly  —— 最近 7 个**完整自然日**（周一 08:30 运行时即「上周一 ~ 周日」），对应「上周新增」
#:   * monthly —— **上一个完整自然月**（每月 1 号运行时即「上月」），对应「上月新增」
#:
#: 窗口一律用**时刻级** ISO8601（``created:2026-10-07T00:30:00Z..2026-10-08T00:30:00Z``）。
#: 用纯日期区间（``2026-10-07..2026-10-08``）会被 GitHub 按整天包含成 48 小时；
#: 写成两个限定词（``created:>=X created:<=Y``）则会被静默忽略、返回全库。详见 make_query。
PERIOD_CONFIG: Dict[str, Dict[str, Any]] = {
    "daily": {
        "days": 1,
        "minStarsLadder": [5, 3, 1],
        "archiveNameFormat": "%Y-%m-%d",
        "boardLabel": "近 24 小时飙升榜",
        "incrementLabel": "近 24 小时新增",
    },
    "weekly": {
        "days": 7,
        "minStarsLadder": [30, 10, 5],
        "archiveNameFormat": "%Y-%m-%d",
        "boardLabel": "上周飙升榜",
        "incrementLabel": "上周新增",
    },
    "monthly": {
        "days": 30,
        "minStarsLadder": [100, 50, 20],
        "archiveNameFormat": "%Y-%m",
        "boardLabel": "上月飙升榜",
        "incrementLabel": "上月新增",
    },
}

#: 搜索 API 单次返回条数上限
SEARCH_PER_PAGE: int = 100
#: Search API 单个查询最多可取 1000 条(10 页), 取再多也没意义
SEARCH_MAX_PAGES: int = 10

#: 快照文件名格式 data/snapshots/YYYY-MM-DD.json
SNAPSHOT_NAME_RE: re.Pattern = re.compile(r"(\d{4}-\d{2}-\d{2})\.json")


# --------------------------------------------------------------------------------------
# Search API 客户端
# --------------------------------------------------------------------------------------


class SearchClient:
    """带节流与限流重试的 GitHub Search API 客户端.

    Attributes:
        token: GitHub Token, 空串表示匿名.
        sleep: 两次请求之间的最小间隔秒数.
        calls: 本次运行已发出的搜索请求数(用于日志与自检).
        failures: 本次运行失败(降级)的搜索请求数.
    """

    SEARCH_URL: str = "https://api.github.com/search/repositories"

    def __init__(self, token: str, sleep: float) -> None:
        """初始化客户端.

        Args:
            token: GitHub Token, 可为空串.
            sleep: 请求间隔秒数.
        """
        self.token: str = token or ""
        self.sleep: float = max(0.0, sleep)
        self.calls: int = 0
        self.failures: int = 0
        self._last_call: float = 0.0
        # 复用 fetch_rank 的 opener(内置 ProxyHandler({}), 强制直连)
        self._opener: urllib.request.OpenerDirector = fr.build_opener()
        self._headers: Dict[str, str] = {
            "Accept": "application/vnd.github+json",
            "User-Agent": "github-rank-pages-fetcher",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if self.token:
            self._headers["Authorization"] = "Bearer {0}".format(self.token)

    def _throttle(self) -> None:
        """保证与上一次请求之间至少间隔 self.sleep 秒."""
        elapsed: float = time.time() - self._last_call
        if self._last_call and elapsed < self.sleep:
            time.sleep(self.sleep - elapsed)
        self._last_call = time.time()

    def search(self, query: str, page: int = 1, per_page: int = SEARCH_PER_PAGE) -> Tuple[List[Dict[str, Any]], int]:
        """执行一次仓库搜索.

        Args:
            query: 搜索表达式, 例如 ``created:2026-10-07..2026-10-08 stars:>5``.
            page: 页码(1 基).
            per_page: 每页条数, 最大 100.

        Returns:
            (仓库对象列表, total_count)。失败时返回 ([], 0), 绝不抛异常。
        """
        params: Dict[str, Any] = {
            "q": query,
            "sort": "stars",
            "order": "desc",
            "per_page": per_page,
            "page": page,
        }
        url: str = self.SEARCH_URL + "?" + urllib.parse.urlencode(params)

        for attempt in range(1, 4):
            self._throttle()
            request = urllib.request.Request(url, headers=self._headers, method="GET")
            try:
                with self._opener.open(request, timeout=30) as response:
                    charset: str = response.headers.get_content_charset() or "utf-8"
                    payload: Any = json.loads(response.read().decode(charset, errors="replace"))
                self.calls += 1
                if not isinstance(payload, dict):
                    return [], 0
                items: Any = payload.get("items")
                total: Any = payload.get("total_count")
                return (
                    [item for item in items if isinstance(item, dict)] if isinstance(items, list) else [],
                    int(total) if isinstance(total, (int, float)) else 0,
                )
            except urllib.error.HTTPError as exc:
                # 403/429 = 限流(匿名 10 次/分钟); 422 = 查询表达式非法
                if exc.code in (403, 429):
                    wait_seconds: float = 12.0 * attempt + 3.0
                    fr.log(
                        "搜索限流 HTTP {0}, 等待 {1:.0f}s 后重试({2}/3): {3}".format(
                            exc.code, wait_seconds, attempt, query
                        ),
                        "WARN",
                    )
                    time.sleep(wait_seconds)
                    continue
                fr.log("搜索失败 HTTP {0}: {1}".format(exc.code, query), "WARN")
                self.failures += 1
                return [], 0
            except Exception as exc:  # noqa: BLE001 - 网络层兜底
                fr.log("搜索异常({0}/{1}) {2}: {3}".format(attempt, 3, query, exc), "WARN")
                if attempt < 3:
                    time.sleep(2.0 * attempt)
                    continue
                self.failures += 1
                return [], 0

        self.failures += 1
        return [], 0


# --------------------------------------------------------------------------------------
# 通用工具
# --------------------------------------------------------------------------------------


def dstr(value: date) -> str:
    """把 date 转成 YYYY-MM-DD 字符串."""
    return value.strftime("%Y-%m-%d")


def resolve_as_of(raw: Optional[str]) -> datetime:
    """解析"当作哪个时刻运行"(UTC, 带时区).

    窗口需要精确到时刻(见 PERIOD_CONFIG 注释), 所以这里返回的是瞬时点而不是日期。

    Args:
        raw: ``YYYY-MM-DD`` 字符串; 为空则取当前 UTC 时刻。

    Returns:
        UTC 带时区的 datetime。
    """
    if raw:
        try:
            parsed: date = datetime.strptime(raw.strip(), "%Y-%m-%d").date()
        except ValueError:
            fr.log("--date 格式非法({0}), 回退为当前时刻".format(raw), "WARN")
        else:
            # 用该日 00:30 UTC（= 北京 08:30，正是 cron 的实际触发时刻）作为瞬时点
            return datetime(parsed.year, parsed.month, parsed.day, 0, 30, 0, tzinfo=timezone.utc)
    return datetime.now(timezone.utc)


def iso_z(moment: datetime) -> str:
    """把 datetime 格式化成 GitHub Search 认识的 ISO8601 UTC 时刻(``...Z``)."""
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def compute_window(period: str, as_of: datetime) -> Dict[str, Any]:
    """计算该周期的统计窗口。

    Args:
        period: daily / weekly / monthly.
        as_of: 运行时刻(UTC).

    Returns:
        含 ``start`` / ``end`` (datetime)、``startIso`` / ``endIso`` (查询用字符串)、
        ``nameDate`` (归档文件名用的 date)、``baselineDate`` (理想基线日) 的字典。
    """
    utc: timezone = timezone.utc

    if period == "monthly":
        # 上一个完整自然月：11-01 跑 -> 10-01 ~ 10-31，文件名 2026-10
        first_of_this_month: date = as_of.date().replace(day=1)
        last_day_prev: date = first_of_this_month - timedelta(days=1)
        first_day_prev: date = last_day_prev.replace(day=1)
        start: datetime = datetime(first_day_prev.year, first_day_prev.month, first_day_prev.day,
                                   0, 0, 0, tzinfo=utc)
        end: datetime = datetime(last_day_prev.year, last_day_prev.month, last_day_prev.day,
                                 23, 59, 59, tzinfo=utc)
        name_date: date = first_day_prev
    elif period == "weekly":
        # 最近 7 个完整自然日：周一 00:30 UTC 跑 -> 上周一 00:00 ~ 周日 23:59:59
        today_midnight: datetime = datetime(as_of.year, as_of.month, as_of.day, tzinfo=utc)
        end = today_midnight - timedelta(seconds=1)
        start = today_midnight - timedelta(days=int(PERIOD_CONFIG[period]["days"]))
        name_date = as_of.date()
    else:
        # daily：滚动最近 24 小时，截至运行时刻
        start = as_of - timedelta(days=int(PERIOD_CONFIG[period]["days"]))
        end = as_of
        name_date = as_of.date()

    return {
        "start": start,
        "end": end,
        "startIso": iso_z(start),
        "endIso": iso_z(end),
        "nameDate": name_date,
        "baselineDate": start.date(),
    }


def resolve_periods(raw: Optional[str], as_of: datetime) -> List[str]:
    """决定本次要产出哪些榜.

    未显式指定时按运行日期自动判断: 日榜每天都产; 周榜只在周一; 月榜只在 1 号。
    (cron 为 UTC: ``30 0 * * 1`` = 北京周一 08:30, ``30 0 1 * *`` = 北京 1 号 08:30。)

    Args:
        raw: 逗号分隔的周期列表, 可为空.
        as_of: 本次运行"当作哪个时刻"(UTC).

    Returns:
        合法的周期 key 列表.
    """
    if raw:
        periods: List[str] = [p.strip() for p in raw.split(",") if p.strip() in PERIOD_CONFIG]
        if periods:
            return periods
        fr.log("--periods 没有合法值({0}), 回退为自动判断".format(raw), "WARN")

    # 用北京时间判断"今天是周几 / 几号", 与 cron(UTC 00:30 = 北京 08:30)对齐
    beijing: datetime = as_of.astimezone(TZ_BEIJING)
    auto: List[str] = ["daily"]
    if beijing.weekday() == 0:
        auto.append("weekly")
    if beijing.day == 1:
        auto.append("monthly")
    return auto


def repo_to_item(repo: Dict[str, Any], period: str, period_stars: int,
                 growth_source: str, growth_exact: bool) -> Optional[Dict[str, Any]]:
    """把 Search API 的 repo 对象转换成榜单条目.

    Args:
        repo: Search API 返回的仓库对象(或 trending 构造的等价字典).
        period: daily / weekly / monthly.
        period_stars: 本周期新增 star 数.
        growth_source: new / snapshot / fallback.
        growth_exact: 增量是否精确可考.

    Returns:
        条目字典; full_name 缺失时返回 None.
    """
    full_name: str = str(repo.get("full_name") or "").strip()
    if not full_name:
        owner_login: str = str((repo.get("owner") or {}).get("login") or "")
        name: str = str(repo.get("name") or "")
        if owner_login and name:
            full_name = "{0}/{1}".format(owner_login, name)
        else:
            return None

    owner_obj: Dict[str, Any] = repo.get("owner") if isinstance(repo.get("owner"), dict) else {}
    license_obj: Dict[str, Any] = repo.get("license") if isinstance(repo.get("license"), dict) else {}
    spdx: str = str(license_obj.get("spdx_id") or "")
    topics: Any = repo.get("topics")

    owner_login_final: str = str(owner_obj.get("login") or full_name.split("/")[0])
    return {
        "rank": 0,  # 排序后统一编号
        "fullName": full_name,
        "owner": owner_login_final,
        "name": str(repo.get("name") or full_name.split("/")[-1]),
        "url": str(repo.get("html_url") or "https://github.com/{0}".format(full_name)),
        "description": str(repo.get("description") or ""),
        "language": str(repo.get("language") or ""),
        "languageColor": fr.language_color(str(repo.get("language") or "")),
        "stars": int(repo.get("stargazers_count") or 0),
        "forks": int(repo.get("forks_count") or 0),
        "periodStars": int(period_stars),
        "periodLabel": PERIOD_CONFIG[period]["incrementLabel"],
        "growthSource": growth_source,
        "growthExact": bool(growth_exact),
        "createdAt": fr.to_date(repo.get("created_at")),
        "pushedAt": fr.to_date(repo.get("pushed_at")),
        "topics": [str(topic) for topic in topics][:8] if isinstance(topics, list) else [],
        "license": "" if spdx in ("NOASSERTION", "None", "") else spdx,
        "ownerAvatar": str(owner_obj.get("avatar_url") or ""),
        "ownerHomepage": str(owner_obj.get("homepage") or ""),
        # 以下字段同样由 Search API 直接返回, 不额外消耗配额, 供前端详情抽屉展示
        "homepage": str(repo.get("homepage") or ""),
        "watchers": int(repo.get("watchers_count") or repo.get("subscribers_count") or 0),
        "openIssues": int(repo.get("open_issues_count") or 0),
        "sizeKb": int(repo.get("size") or 0),
        "defaultBranch": str(repo.get("default_branch") or ""),
        "archived": bool(repo.get("archived")),
        "isFork": bool(repo.get("fork")),
        "ownerType": str(owner_obj.get("type") or ""),
        "updatedAt": fr.to_date(repo.get("updated_at")),
        "contributors": [],
        "enriched": True,
        "tags": [],  # 由 fr.apply_tags 填充
    }


def make_query(start_iso: str, end_iso: str, min_stars: int) -> str:
    """拼装来源 A 的搜索表达式.

    两个坑（都是实测踩出来的，别改回去）：
    1. 不能用**纯日期**区间 ``created:2026-10-07..2026-10-08``：GitHub 两端都按整天包含，
       实际是 10-07T00:00 ~ 10-08T23:59 共 **48 小时**，日榜会混入大量创建于 36h 前的仓库。
       （实测：日期区间 total=328、top1 创建于 10-07；时刻区间 total=151、top1 创建于 10-08）
    2. 不能写**两个** created 限定词 ``created:>=X created:<=Y``：GitHub 会静默忽略它们，
       返回全库结果（实测 total_count=4369553，top1 是 2018 年的仓库），且**不报错**。

    正确写法是**单个**带时刻的区间限定词 ``created:{start}..{end}``（实测有效）。

    Args:
        start_iso: 窗口起点(ISO8601 UTC, 形如 ``2026-10-07T14:15:27Z``).
        end_iso: 窗口终点(同上).
        min_stars: star 数下限.

    Returns:
        搜索表达式字符串.
    """
    return "created:{0}..{1} stars:>{2}".format(start_iso, end_iso, min_stars)


# --------------------------------------------------------------------------------------
# 候选池与快照
# --------------------------------------------------------------------------------------


def trending_pool_entries() -> Dict[str, Dict[str, Any]]:
    """从 GitHub Trending 日/周/月页抓取仓库, 构造成候选池条目.

    失败时只降级(返回已拿到的部分), 绝不抛异常。

    Returns:
        {fullName: 伪 repo 对象}
    """
    pool: Dict[str, Dict[str, Any]] = {}
    for period in ("daily", "weekly", "monthly"):
        try:
            items: List[Dict[str, Any]] = fr.fetch_trending(period)
        except Exception as exc:  # noqa: BLE001 - 单榜失败不影响其他来源
            fr.log("trending({0}) 抓取失败, 跳过: {1}".format(period, exc), "WARN")
            continue
        for item in items:
            full_name: str = str(item.get("fullName") or "")
            if not full_name:
                continue
            contributors: List[str] = item.get("contributors") or []
            pool[full_name] = {
                "full_name": full_name,
                "name": str(item.get("name") or ""),
                "owner": {
                    "login": str(item.get("owner") or ""),
                    "avatar_url": contributors[0] if contributors else "",
                    "homepage": "",
                },
                "html_url": str(item.get("url") or ""),
                "description": str(item.get("description") or ""),
                "language": item.get("language") or "",
                "stargazers_count": int(item.get("stars") or 0),
                "forks_count": int(item.get("forks") or 0),
                "topics": item.get("topics") or [],
                "created_at": item.get("createdAt") or "",
                "pushed_at": item.get("pushedAt") or "",
                "license": None,
                "_fromTrending": True,
            }
        fr.log("trending({0}) 并入候选池 {1} 条".format(period, len(items)))
    return pool


def build_pool(client: SearchClient, run_date: date) -> Dict[str, Dict[str, Any]]:
    """构建候选池: {fullName: repo 对象}.

    先并入 trending 页面(不消耗 search 配额), 再用三条 search 查询覆盖
    "高星且活跃"与"近期新建"两类仓库; search 结果覆盖同名条目, 保证 star 数精确。

    Args:
        client: Search 客户端.
        run_date: 本次运行日期.

    Returns:
        候选池字典(可能为空, 但绝不抛异常).
    """
    pool: Dict[str, Dict[str, Any]] = trending_pool_entries()

    queries: List[Tuple[str, int]] = [
        ("stars:>2000 pushed:>{0}".format(dstr(run_date - timedelta(days=30))), 2),
        ("stars:>300 created:>{0}".format(dstr(run_date - timedelta(days=90))), 2),
        ("stars:>1000 pushed:>{0}".format(dstr(run_date - timedelta(days=7))), 1),
    ]

    for query, pages in queries:
        for page in range(1, pages + 1):
            items, total = client.search(query, page=page)
            if not items:
                break
            for repo in items:
                full_name: str = str(repo.get("full_name") or "")
                if full_name:
                    pool[full_name] = repo
            fr.log(
                "候选池查询 page{0}: {1} -> 累计 {2} 条(total_count={3})".format(
                    page, query, len(pool), total
                )
            )
            if len(items) < SEARCH_PER_PAGE:
                break

    fr.log("候选池构建完成: {0} 条仓库".format(len(pool)))
    return pool


def load_snapshot(path: str) -> Optional[Dict[str, Any]]:
    """读取一份快照文件.

    Args:
        path: 快照文件路径.

    Returns:
        快照字典; 不存在或非法时返回 None.
    """
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as handle:
            payload: Any = json.load(handle)
        if isinstance(payload, dict) and isinstance(payload.get("stars"), dict):
            return payload
    except (OSError, ValueError) as exc:
        fr.log("快照读取失败 {0}: {1}".format(path, exc), "WARN")
    return None


def list_snapshot_dates() -> List[str]:
    """列出已有快照的日期字符串(升序)."""
    try:
        names: List[str] = os.listdir(SNAPSHOT_DIR)
    except OSError:
        return []
    dates: List[str] = []
    for name in names:
        match = SNAPSHOT_NAME_RE.fullmatch(name)
        if match:
            dates.append(match.group(1))
    return sorted(dates)


def find_baseline(target: date) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """找到不晚于 target 的最近一份快照作为基线.

    Args:
        target: 理想基线日期(日榜 T-1 / 周榜 T-7 / 月榜 T-30).

    Returns:
        (快照字典, 实际使用的基线日期字符串); 找不到时返回 (None, None).
    """
    target_str: str = dstr(target)
    candidates: List[str] = [d for d in list_snapshot_dates() if d <= target_str]
    if not candidates:
        return None, None
    chosen: str = candidates[-1]
    snapshot: Optional[Dict[str, Any]] = load_snapshot(os.path.join(SNAPSHOT_DIR, chosen + ".json"))
    if snapshot is None:
        return None, None
    return snapshot, chosen


def write_snapshot(run_date: date, pool: Dict[str, Dict[str, Any]], generated_at: str) -> Optional[str]:
    """写入当日候选池快照.

    Args:
        run_date: 快照日期.
        pool: 候选池.
        generated_at: 生成时间 ISO 字符串.

    Returns:
        快照文件路径; 写入失败返回 None.
    """
    stars: Dict[str, int] = {}
    for full_name, repo in pool.items():
        value: Any = repo.get("stargazers_count")
        if isinstance(value, (int, float)):
            stars[full_name] = int(value)
    payload: Dict[str, Any] = {
        "date": dstr(run_date),
        "generatedAt": generated_at,
        "poolSize": len(stars),
        "stars": stars,
    }
    path: str = os.path.join(SNAPSHOT_DIR, "{0}.json".format(dstr(run_date)))
    try:
        fr.write_json(path, payload)
        fr.log("写入快照 {0} (poolSize={1})".format(path, len(stars)))
        return path
    except OSError as exc:
        fr.log("快照写入失败 {0}: {1}".format(path, exc), "WARN")
        return None


def prune_snapshots(keep: int = SNAPSHOT_KEEP) -> int:
    """只保留最近 keep 份快照, 删除更旧的.

    Args:
        keep: 保留份数.

    Returns:
        实际删除的份数; 删除失败不抛异常.
    """
    dates: List[str] = list_snapshot_dates()
    if len(dates) <= keep:
        return 0
    doomed: List[str] = dates[:len(dates) - keep]
    removed: int = 0
    for name in doomed:
        try:
            os.remove(os.path.join(SNAPSHOT_DIR, name + ".json"))
            removed += 1
        except OSError as exc:
            fr.log("旧快照删除失败 {0}: {1}".format(name, exc), "WARN")
    if removed:
        fr.log("快照裁剪: 删除 {0} 份, 保留最近 {1} 份".format(removed, keep))
    return removed


# --------------------------------------------------------------------------------------
# 榜单构建
# --------------------------------------------------------------------------------------


def collect_source_a(client: SearchClient, period: str, window: Dict[str, Any],
                     top_n: int) -> Dict[str, Dict[str, Any]]:
    """来源 A: 周期内新建仓库(其 star 总数即本周期增量).

    min stars 阈值按阶梯逐步下调, 直到凑够 top_n 条或阶梯用尽。

    Args:
        client: Search 客户端.
        period: daily / weekly / monthly.
        window: :func:`compute_window` 的返回值.
        top_n: 目标条数.

    Returns:
        {fullName: 条目}
    """
    spec: Dict[str, Any] = PERIOD_CONFIG[period]
    result: Dict[str, Dict[str, Any]] = {}

    for min_stars in spec["minStarsLadder"]:
        if len(result) >= top_n:
            break
        query: str = make_query(window["startIso"], window["endIso"], int(min_stars))
        page: int = 1
        while len(result) < top_n and page <= SEARCH_MAX_PAGES:
            repos, total = client.search(query, page=page)
            if not repos:
                break
            for repo in repos:
                item: Optional[Dict[str, Any]] = repo_to_item(
                    repo, period, int(repo.get("stargazers_count") or 0), "new", True
                )
                if item:
                    result.setdefault(item["fullName"], item)
            fr.log(
                "来源A {0} (min stars>{1}) page{2}: 累计 {3} 条 (total_count={4})".format(
                    period, min_stars, page, len(result), total
                )
            )
            if len(repos) < SEARCH_PER_PAGE:
                break
            max_usable: int = min(SEARCH_MAX_PAGES, max(1, (min(total, 1000) + SEARCH_PER_PAGE - 1) // SEARCH_PER_PAGE))
            if page >= max_usable:
                break
            page += 1

    fr.log("来源A({0}) 合计 {1} 条".format(period, len(result)))
    return result


def collect_source_b(pool: Dict[str, Dict[str, Any]], period: str, window: Dict[str, Any],
                     exclude: Dict[str, Dict[str, Any]]) -> Tuple[Dict[str, Dict[str, Any]], Optional[str], bool]:
    """来源 B: 与基线快照做差, 得到老仓库的周期增量.

    Args:
        pool: 候选池.
        period: daily / weekly / monthly.
        window: :func:`compute_window` 的返回值.
        exclude: 来源 A 已收录的条目(同名的不再重复计入).

    Returns:
        ({fullName: 条目}, 实际使用的基线日期字符串或 None, 基线是否正好是理想基线日)
    """
    target: date = window["baselineDate"]
    baseline, baseline_date = find_baseline(target)
    if baseline is None:
        fr.log(
            "来源B({0}): 没有可用的基线快照(需 <= {1}), 本次该来源为空".format(period, dstr(target)),
            "WARN",
        )
        return {}, None, False

    baseline_stars: Dict[str, Any] = baseline.get("stars") or {}
    # 基线若不是理想基线日(例如昨天的快照缺失、只能用前天的), 差值实际跨了更长的时间,
    # 这时不能声称"这就是本周期的精确增量", 因此 growthExact 置 False 由调用方写入
    baseline_exact: bool = (baseline_date == dstr(target))
    result: Dict[str, Dict[str, Any]] = {}
    for full_name, repo in pool.items():
        if full_name in exclude:
            continue
        current: Any = repo.get("stargazers_count")
        if not isinstance(current, (int, float)):
            continue
        previous: Any = baseline_stars.get(full_name)
        if not isinstance(previous, (int, float)):
            continue  # 基线里没有它, 算不出增量, 不猜测
        delta: int = int(current) - int(previous)
        if delta <= 0:
            continue
        item: Optional[Dict[str, Any]] = repo_to_item(repo, period, delta, "snapshot", baseline_exact)
        if item:
            result[full_name] = item

    fr.log(
        "来源B({0}): 基线 {1}{2}, 得到 {3} 条".format(
            period,
            baseline_date,
            "" if baseline_exact else "(理想基线 {0} 缺失, 已取最近一份; 增量跨多天, growthExact=false)".format(dstr(target)),
            len(result),
        )
    )
    return result, baseline_date, baseline_exact


def fill_from_pool(pool: Dict[str, Dict[str, Any]], period: str,
                   merged: Dict[str, Dict[str, Any]], top_n: int) -> int:
    """降级补位: 用候选池按绝对 star 数降序补满 top_n.

    补位条目的周期增量不可考, 因此 periodStars 置 0、growthExact=False(不谎报)。

    Args:
        pool: 候选池.
        period: daily / weekly / monthly.
        merged: 已合并的条目字典(就地补入).
        top_n: 目标条数.

    Returns:
        本次补入的条数.
    """
    if len(merged) >= top_n:
        return 0

    ranked: List[Dict[str, Any]] = sorted(
        pool.values(),
        key=lambda repo: int(repo.get("stargazers_count") or 0),
        reverse=True,
    )
    added: int = 0
    for repo in ranked:
        if len(merged) >= top_n:
            break
        full_name: str = str(repo.get("full_name") or "")
        if not full_name or full_name in merged:
            continue
        item: Optional[Dict[str, Any]] = repo_to_item(repo, period, 0, "fallback", False)
        if item:
            merged[full_name] = item
            added += 1
    if added:
        fr.log("降级补位({0}): 从候选池补入 {1} 条 (growthExact=false)".format(period, added), "WARN")
    return added


def build_period_items(client: SearchClient, period: str, window: Dict[str, Any],
                       pool: Dict[str, Dict[str, Any]], top_n: int) -> Tuple[List[Dict[str, Any]], Optional[str], Dict[str, int]]:
    """构建一个周期的前 top_n 名.

    Args:
        client: Search 客户端.
        period: daily / weekly / monthly.
        window: :func:`compute_window` 的返回值.
        pool: 候选池.
        top_n: 目标条数.

    Returns:
        (条目列表, 实际使用的基线日期或 None, {growthSource: 条数})
    """
    source_a: Dict[str, Dict[str, Any]] = collect_source_a(client, period, window, top_n)
    source_b, baseline_date, _baseline_exact = collect_source_b(pool, period, window, source_a)

    merged: Dict[str, Dict[str, Any]] = dict(source_b)
    merged.update(source_a)  # 来源 A 精确, 同名优先
    fr.log("合并去重({0}): A={1} B={2} -> {3} 条".format(
        period, len(source_a), len(source_b), len(merged)
    ))

    exact_count: int = len(merged)
    if exact_count < top_n:
        fill_from_pool(pool, period, merged, top_n)

    # 排序：增量可考的条目按 periodStars 降序在前；补位条目(growthExact=false, periodStars=0)
    # 一律沉到末尾，避免"绝对 star 5 万的老仓库"挤在真实飙升项目前面污染榜单语义
    items: List[Dict[str, Any]] = sorted(
        merged.values(),
        key=lambda item: (
            0 if item.get("growthExact") else 1,
            -int(item.get("periodStars") or 0),
            -int(item.get("stars") or 0),
            item["fullName"],
        ),
    )[:top_n]

    growth_stats: Dict[str, int] = {}
    for index, item in enumerate(items, start=1):
        item["rank"] = index
        key: str = str(item.get("growthSource") or "unknown")
        growth_stats[key] = growth_stats.get(key, 0) + 1

    if len(items) < top_n:
        fr.log(
            "{0} 只凑到 {1}/{2} 条(降级路径已用尽), 按实际条数输出".format(period, len(items), top_n),
            "WARN",
        )
    return items, baseline_date, growth_stats


# --------------------------------------------------------------------------------------
# 产物输出
# --------------------------------------------------------------------------------------


def archive_file_name(period: str, name_date: date) -> str:
    """返回该周期归档文件的文件名(不含目录).

    月榜传入的是「上一个自然月」的 1 号, 因此文件名就是那个月的 ``YYYY-MM``。
    """
    return name_date.strftime(PERIOD_CONFIG[period]["archiveNameFormat"]) + ".json"


def serialize(payload: Any) -> str:
    """按 :func:`fetch_rank.write_json` 的同一格式序列化.

    单独抽出来是为了能在**落盘之前**把新内容与旧文件逐字节比较 ——
    只有真的不一样才需要给旧版本留底, 否则每次补跑都会堆出一份无意义的副本。

    Args:
        payload: 待序列化对象.

    Returns:
        UTF-8 JSON 文本(缩进 2, 结尾换行).
    """
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def preserve_revision(period: str, path: str, new_text: str) -> Optional[str]:
    """把即将被覆盖的旧归档转存到 data/revisions/<period>/, 返回转存路径.

    归档以日期命名, 不同日期是不同的文件, 因此**历史本身不会被覆盖**。
    唯一的覆盖场景是「同一天跑了第二次」: 新数据通常更完整, 应当就地更新,
    但旧的那一份不能凭空消失 —— 先原样转存留底, 再写新文件。

    Args:
        period: daily / weekly / monthly.
        path: 即将被写入的归档路径.
        new_text: 本次将要写入的完整文本(用于判断是否真的变了).

    Returns:
        转存后的路径; 没有旧文件、读失败、或新旧内容完全一致时返回 None.
    """
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as handle:
            old_text: str = handle.read()
    except OSError as exc:
        fr.log("读取旧归档失败, 跳过留底: {0}".format(exc), "WARN")
        return None

    if old_text == new_text:
        # 一模一样的重跑(定时补跑、手动重试)不该产生副本, 否则每次都会多一个文件
        return None

    stamp: str = datetime.now(TZ_BEIJING).strftime("%H%M%S")
    name: str = os.path.basename(path)[:-5]
    target: str = os.path.join(REVISION_DIR, period, "{0}@{1}.json".format(name, stamp))
    # 秒级时间戳不足以保证唯一：同一秒内的两次重跑会算出同一个文件名，
    # 于是第二份留底把第一份覆盖掉 —— 留底本身反而成了"覆盖"。
    # 这里加序号兜底，宁可名字长一点也不能丢。
    seq: int = 1
    while os.path.exists(target):
        target = os.path.join(
            REVISION_DIR, period, "{0}@{1}-{2}.json".format(name, stamp, seq)
        )
        seq += 1

    try:
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "w", encoding="utf-8") as handle:
            handle.write(old_text)
    except OSError as exc:
        fr.log("旧归档留底失败(继续覆盖): {0}".format(exc), "WARN")
        return None

    fr.log("归档留底 {0} -> {1}".format(path, target))
    return target


def write_archive(period: str, window: Dict[str, Any], items: List[Dict[str, Any]],
                  generated_at: str, baseline_date: Optional[str],
                  growth_stats: Dict[str, int]) -> str:
    """写入按文件夹归档的榜单文件.

    归档**只追加、不删除**: 文件名由窗口日期决定, 新的一天就是一个新文件。
    同一天重跑时会先由 :func:`preserve_revision` 给旧版本留底, 再原地更新。

    Args:
        period: daily / weekly / monthly.
        window: :func:`compute_window` 的返回值.
        items: 条目列表.
        generated_at: 生成时间.
        baseline_date: 实际使用的基线日期.
        growth_stats: 各来源条数统计.

    Returns:
        写入的文件路径.
    """
    spec: Dict[str, Any] = PERIOD_CONFIG[period]
    name_date: date = window["nameDate"]
    payload: Dict[str, Any] = {
        "period": period,
        "periodLabel": spec["boardLabel"],
        "date": name_date.strftime(spec["archiveNameFormat"]),
        "rangeStart": window["startIso"],
        "rangeEnd": window["endIso"],
        "generatedAt": generated_at,
        "baselineDate": baseline_date,
        "count": len(items),
        "source": "GitHub Search API (created range + snapshot diff)",
        "updatedAt": generated_at,
        "tagCounts": fr.tag_counts(items),
        "growthStats": growth_stats,
        "items": items,
    }
    path: str = os.path.join(PERIOD_DIRS[period], archive_file_name(period, name_date))
    text: str = serialize(payload)
    preserve_revision(period, path, text)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)
    fr.log("写入归档 {0} ({1} 条)".format(path, len(items)))
    return path


def write_latest(period: str, window: Dict[str, Any], items: List[Dict[str, Any]],
                 generated_at: str, baseline_date: Optional[str],
                 growth_stats: Dict[str, int]) -> Dict[str, Any]:
    """写入"最新"榜单 + 分页产物, 供现有前端直接读取.

    Args:
        period: daily / weekly / monthly.
        window: :func:`compute_window` 的返回值.
        items: 条目列表.
        generated_at: 生成时间.
        baseline_date: 实际使用的基线日期.
        growth_stats: 各来源条数统计.

    Returns:
        写入的榜单字典.
    """
    spec: Dict[str, Any] = PERIOD_CONFIG[period]
    name_date: date = window["nameDate"]
    board: Dict[str, Any] = fr.build_board(period, items, generated_at)
    # build_board 用的是 Trending 版本的文案(本月/本周)，这里改成本脚本的真实窗口语义
    board["periodLabel"] = spec["boardLabel"]
    board["date"] = name_date.strftime(spec["archiveNameFormat"])
    board["rangeStart"] = window["startIso"]
    board["rangeEnd"] = window["endIso"]
    board["baselineDate"] = baseline_date
    board["growthStats"] = growth_stats
    board["source"] = "GitHub Search API (created range + snapshot diff)"

    fr.write_json(os.path.join(DATA_DIR, "{0}.json".format(period)), board)
    fr.write_period_pages(period, board, generated_at)
    fr.log("写入最新榜单 {0}.json ({1} 条)".format(period, len(items)))
    return board


def count_revisions(period: str, name: str) -> int:
    """统计某份归档历史上被覆盖过几次(即留底文件个数).

    Args:
        period: daily / weekly / monthly.
        name: 归档名(不含 .json), 例如 2026-10-08 / 2026-09.

    Returns:
        留底文件个数; 目录不存在时返回 0.
    """
    directory: str = os.path.join(REVISION_DIR, period)
    try:
        names: List[str] = os.listdir(directory)
    except OSError:
        return 0
    prefix: str = name + "@"
    return sum(1 for entry in names if entry.startswith(prefix) and entry.endswith(".json"))


def write_archive_index(generated_at: str) -> None:
    """重建 data/archive/index.json —— 前端历史功能的数据源.

    输出按 **日期倒序**(最新在前)排列, 并带上统计范围, 这样前端不必再拉每一份
    归档就能把「昨日 / 上周 / 上月」这些入口渲染出来, 点开哪一天才去取哪一天的文件。

    Args:
        generated_at: 生成时间 ISO 字符串.
    """
    types: Dict[str, Any] = {}
    for period in ("daily", "weekly", "monthly"):
        directory: str = PERIOD_DIRS[period]
        files: List[Dict[str, Any]] = []
        try:
            names: List[str] = sorted(os.listdir(directory))
        except OSError:
            names = []
        for name in names:
            if not name.endswith(".json"):
                continue
            path: str = os.path.join(directory, name)
            try:
                with open(path, "r", encoding="utf-8") as handle:
                    payload: Any = json.load(handle)
            except (OSError, ValueError):
                continue
            if not isinstance(payload, dict):
                continue
            key: str = name[:-5]
            files.append({
                "name": key,
                "file": "data/{0}/{1}".format(period, name),
                "date": payload.get("date") or key,
                "count": int(payload.get("count") or 0),
                "rangeStart": payload.get("rangeStart") or "",
                "rangeEnd": payload.get("rangeEnd") or "",
                "updatedAt": payload.get("updatedAt") or payload.get("generatedAt") or "",
                "revisions": count_revisions(period, key),
            })
        # 前端要「最新在前」, 这里按名称倒序(daily/weekly 是 YYYY-MM-DD, monthly 是 YYYY-MM,
        # 两者字典序与时间序一致, 直接倒排即可)
        files.sort(key=lambda entry: str(entry.get("name") or ""), reverse=True)
        types[period] = {
            "periodLabel": PERIOD_CONFIG[period]["boardLabel"],
            "dir": "data/{0}".format(period),
            "count": len(files),
            "latest": files[0]["name"] if files else None,
            "oldest": files[-1]["name"] if files else None,
            "files": files,
        }

    snapshot_dates: List[str] = list_snapshot_dates()
    index: Dict[str, Any] = {
        "generatedAt": generated_at,
        "types": types,
        "snapshots": {
            "dir": "data/snapshots",
            "count": len(snapshot_dates),
            "latest": snapshot_dates[-1] if snapshot_dates else None,
            "keep": SNAPSHOT_KEEP,
            "files": snapshot_dates,
        },
    }
    path: str = os.path.join(ARCHIVE_DIR, "index.json")
    fr.write_json(path, index)
    fr.log("写入归档索引 {0} (daily={1} weekly={2} monthly={3})".format(
        path,
        types["daily"]["count"],
        types["weekly"]["count"],
        types["monthly"]["count"],
    ))


def update_meta(boards: Dict[str, Dict[str, Any]], fresh_periods: List[str],
                generated_at: str) -> None:
    """更新 data/meta.json(仅在本期确有数据时推进 updatedAt).

    Args:
        boards: {period: 榜单字典}
        fresh_periods: 本次真正产出数据的周期.
        generated_at: 生成时间 ISO 字符串.
    """
    if not fresh_periods:
        fr.log("本次没有产出任何榜单, meta.json 保持不变", "WARN")
        return

    path: str = os.path.join(DATA_DIR, "meta.json")
    meta: Dict[str, Any] = fr.read_existing_board(path) or {}
    if not isinstance(meta.get("counts"), dict):
        meta["counts"] = {"daily": 0, "weekly": 0, "monthly": 0}
    if not isinstance(meta.get("tagCounts"), dict):
        meta["tagCounts"] = {}

    for period in fresh_periods:
        board: Optional[Dict[str, Any]] = boards.get(period)
        if not isinstance(board, dict):
            continue
        meta["counts"][period] = int(board.get("count") or 0)
        meta["tagCounts"][period] = board.get("tagCounts", {})

    meta["updatedAt"] = generated_at
    meta["freshPeriods"] = sorted(fresh_periods)
    meta["generator"] = "fetch_top100.py"
    fr.write_json(path, meta)
    fr.log("写入 {0} (本次产出: {1})".format(path, ", ".join(sorted(fresh_periods))))


# --------------------------------------------------------------------------------------
# 入口
# --------------------------------------------------------------------------------------


def main(argv: Optional[List[str]] = None) -> int:
    """脚本入口.

    Args:
        argv: 命令行参数列表; 默认使用 sys.argv[1:].

    Returns:
        退出码; 恒为 0(任何查询失败都只降级, 不让 CI 变红并吞掉已有数据).
    """
    parser = argparse.ArgumentParser(description="抓取 GitHub 日/周/月榜前 100 名(Search API + 快照做差)")
    parser.add_argument("--periods", default="", help="逗号分隔; 不传则按运行日期自动判断")
    parser.add_argument("--date", default="", help="当作哪天运行, 格式 YYYY-MM-DD")
    parser.add_argument("--top", type=int, default=DEFAULT_TOP_N, help="榜单条数, 默认 100")
    parser.add_argument("--sleep", type=float, default=0.0, help="搜索间隔秒数; 不传则按有无 token 自动选择")
    parser.add_argument("--no-snapshot", action="store_true", help="不写候选池快照")
    parser.add_argument("--keep-snapshots", type=int, default=SNAPSHOT_KEEP, help="快照保留份数, 默认 40")
    parser.add_argument(
        "--rebuild-archive-index",
        action="store_true",
        help="只重建 data/archive/index.json 后退出(手动增删归档文件后用它, 不联网、不抓取)",
    )
    args = parser.parse_args(argv)

    if args.rebuild_archive_index:
        # 纯本地动作: 不建 SearchClient、不读 token、不联网。
        # 场景: 手工补了一份归档 / 删了几期之后, 让前端的历史行重新对上。
        fr.log("==== 只重建归档索引(不抓取) ====")
        write_archive_index(fr.now_iso())
        return 0

    token: str = os.environ.get("GITHUB_TOKEN", "") or os.environ.get("GH_TOKEN", "") or ""
    sleep: float = args.sleep if args.sleep > 0 else (SLEEP_WITH_TOKEN if token else SLEEP_ANONYMOUS)

    as_of: datetime = resolve_as_of(args.date or None)
    periods: List[str] = resolve_periods(args.periods or None, as_of)
    top_n: int = max(1, int(args.top))
    run_date: date = as_of.astimezone(TZ_BEIJING).date()

    fr.log("==== fetch_top100 开始 ====")
    fr.log("运行时刻={0} (北京 {1} 周{2}) 目标条数={3} 周期={4} 搜索间隔={5}s token={6}".format(
        iso_z(as_of),
        dstr(run_date),
        "一二三四五六日"[run_date.weekday()],
        top_n,
        ",".join(periods),
        sleep,
        "有" if token else "无(匿名 10 次/分钟)",
    ))

    generated_at: str = fr.now_iso()
    client: SearchClient = SearchClient(token, sleep)

    try:
        pool: Dict[str, Dict[str, Any]] = build_pool(client, run_date)
    except Exception as exc:  # noqa: BLE001 - 候选池失败不得中断
        fr.log("候选池构建异常: {0}".format(exc), "ERROR")
        pool = {}

    boards: Dict[str, Dict[str, Any]] = {}
    fresh_periods: List[str] = []

    for period in periods:
        window: Dict[str, Any] = compute_window(period, as_of)
        fr.log("==== 开始构建 {0} 榜前 {1} ====".format(period, top_n))
        fr.log("{0} 窗口: {1} ~ {2} (归档文件名 {3})".format(
            period, window["startIso"], window["endIso"],
            archive_file_name(period, window["nameDate"]),
        ))
        try:
            items, baseline_date, growth_stats = build_period_items(
                client, period, window, pool, top_n
            )
        except Exception as exc:  # noqa: BLE001
            fr.log("{0} 构建异常, 跳过(保留已有数据): {1}".format(period, exc), "ERROR")
            continue

        if not items:
            # 一条都没凑到: 绝不用空榜覆盖已有文件
            fr.log("{0} 本次无数据, 不覆盖已有 data/{0}.json".format(period), "WARN")
            continue

        fr.apply_tags(items)
        write_archive(period, window, items, generated_at, baseline_date, growth_stats)
        board: Dict[str, Any] = write_latest(
            period, window, items, generated_at, baseline_date, growth_stats
        )
        boards[period] = board
        fresh_periods.append(period)
        fr.log("{0} 完成: {1} 条, 来源分布 {2}".format(period, len(items), growth_stats))

    if not args.no_snapshot:
        if pool:
            write_snapshot(run_date, pool, generated_at)
            try:
                prune_snapshots(args.keep_snapshots)
            except Exception as exc:  # noqa: BLE001 - 裁剪失败不影响主流程
                fr.log("快照裁剪失败(忽略): {0}".format(exc), "WARN")
        else:
            fr.log("候选池为空, 跳过写快照(避免用空快照污染基线)", "WARN")

    # 与 meta.json 同一约定: 本次确实产出数据才重建索引, 否则文件里只有 generatedAt 在变,
    # 会让 git status 出现"假变更"并产生一次空提交
    index_path: str = os.path.join(ARCHIVE_DIR, "index.json")
    if fresh_periods or not os.path.isfile(index_path):
        try:
            write_archive_index(generated_at)
        except Exception as exc:  # noqa: BLE001
            fr.log("归档索引写入失败(忽略): {0}".format(exc), "WARN")

    update_meta(boards, fresh_periods, generated_at)

    fr.log("==== 完成 ====")
    fr.log("搜索请求 {0} 次, 失败降级 {1} 次; 产出: {2}".format(
        client.calls,
        client.failures,
        ", ".join("{0}={1}".format(p, int(boards[p].get("count") or 0)) for p in fresh_periods) or "无",
    ))
    return 0


if __name__ == "__main__":
    sys.exit(main())
