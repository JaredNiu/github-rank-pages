#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""GitHub Trending 榜单抓取与补全脚本.

功能:
    1. 抓取 https://github.com/trending?since=daily|weekly|monthly 页面;
    2. 用容错正则解析出仓库条目(条目数量以页面实际为准, 不做任何硬编码上限/下限假设);
    3. 调用 GitHub REST API 补全元信息(描述 / star / fork / 语言 / topics / 创建时间 / 推送时间 /
       license / owner 头像), API 失败时自动降级使用页面抓取到的字段;
    4. 依据仓库名 / 描述 / topics / 语言的实际内容自动打标签(ai / llm / agent / security …);
    5. 输出 data/{daily,weekly,monthly}.json、data/pages/<period>/N.json(前端无限滚动用)、
       data/meta.json 与 data/history/YYYY-MM-DD.json.

设计约束:
    * 仅依赖 Python 3 标准库(urllib / re / json / html / datetime), 零第三方依赖;
    * 任何单条记录的字段缺失、任何单个周期抓取失败, 都不得让脚本以非零状态退出,
      也不得用空数据覆盖已有的 data/*.json(避免 GitHub Actions 定时任务"吞掉"历史数据);
    * 显式关闭系统代理(ProxyHandler({})), 避免 CI/本地沙箱代理导致连接失败.

用法:
    python3 scripts/fetch_rank.py                       # 抓取三个周期并补全
    python3 scripts/fetch_rank.py --periods daily       # 仅抓日榜
    python3 scripts/fetch_rank.py --no-enrich           # 跳过 REST API 补全(纯抓取)
    python3 scripts/fetch_rank.py --no-history          # 不写历史归档
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

# --------------------------------------------------------------------------------------
# 常量与配置
# --------------------------------------------------------------------------------------

#: 脚本所在目录的父目录, 即仓库根目录
BASE_DIR: str = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR: str = os.path.join(BASE_DIR, "data")
HISTORY_DIR: str = os.path.join(DATA_DIR, "history")

#: 北京时区(固定偏移, 不依赖 tzdata)
TZ_BEIJING: timezone = timezone(timedelta(hours=8))

#: 三个榜单周期的配置
PERIOD_SPECS: Dict[str, Dict[str, str]] = {
    "daily": {
        "label": "今日飙升榜",
        "increment": "今日新增",
        "source": "https://github.com/trending?since=daily",
    },
    "weekly": {
        "label": "本周飙升榜",
        "increment": "本周新增",
        "source": "https://github.com/trending?since=weekly",
    },
    "monthly": {
        "label": "本月飙升榜",
        "increment": "本月新增",
        "source": "https://github.com/trending?since=monthly",
    },
}

#: 抓取 HTML 页面时的请求头(必须带 UA, 否则 GitHub 返回 403)
HTML_HEADERS: Dict[str, str] = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
}

#: 调用 REST API 时的请求头
API_HEADERS: Dict[str, str] = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "github-rank-pages-fetcher",
    "X-GitHub-Api-Version": "2022-11-28",
}

#: 语言 -> 主题色(与前端 style.css / app.js 中的配色表保持一致)
LANGUAGE_COLORS: Dict[str, str] = {
    "TypeScript": "#3178c6",
    "JavaScript": "#f1e05a",
    "Python": "#3572A5",
    "Java": "#b07219",
    "Go": "#00ADD8",
    "Rust": "#dea584",
    "C++": "#f34b7d",
    "C": "#555555",
    "C#": "#178600",
    "Ruby": "#701516",
    "PHP": "#4F5D95",
    "Swift": "#F05138",
    "Kotlin": "#A97BFF",
    "Dart": "#00B4AB",
    "Shell": "#89e051",
    "HTML": "#e34c26",
    "CSS": "#563d7c",
    "Vue": "#41b883",
    "Svelte": "#ff3e00",
    "Jupyter Notebook": "#DA5B0B",
    "Jupyter": "#DA5B0B",
    "Scala": "#c22d40",
    "Lua": "#000080",
    "Perl": "#0298c3",
    "R": "#198CE7",
    "Objective-C": "#438eff",
    "Elixir": "#6e4a7e",
    "Haskell": "#5e5086",
    "Zig": "#ec915c",
    "Nim": "#ffc200",
    "Solidity": "#AA6746",
    "Astro": "#ff5a03",
    "MDX": "#fcb32c",
    "TeX": "#3D6117",
    "Dockerfile": "#384d54",
    "Makefile": "#427819",
    "Vue.js": "#41b883",
}

#: 默认语言色(未知语言使用中性灰)
DEFAULT_LANGUAGE_COLOR: str = "#8c959f"

#: 前端无限滚动的分页大小: 每片多少条
PAGE_SIZE: int = 6

#: 打标签规则: (标签 key, 命中关键词列表)
#:   依据仓库名 / 描述 / topics / 语言的实际内容打标签, 不通配、不硬编码仓库名。
#:   顺序即优先级, 每个仓库最多取前 MAX_TAGS 个命中的标签。
TAG_RULES: List[Tuple[str, List[str]]] = [
    ("llm", [
        "llm", "gpt", "transformer", "language model", "large model", "qwen", "llama",
        "deepseek", "mistral", "moe", "fine-tune", "finetune", "tokenizer", "embedding",
        "quantiz", "inference engine", "大模型", "大语言模型", "模型推理", "微调",
    ]),
    ("agent", [
        "agent", "multi-agent", "autonomous", "copilot", "mcp", "tool use", "tool-use",
        "orchestrat", "workflow automation", "skills", "智能体", "自主", "编排",
    ]),
    ("ai", [
        "ai", "artificial intelligence", "machine learning", "deep learning", "neural",
        "diffusion", "prompt", "rag", "人工智能", "机器学习", "深度学习", "神经网络",
    ]),
    ("security", [
        "security", "audit", "vulnerability", "pentest", "penetration", "reverse engineer",
        "reverse-engineer", "sandbox", "malware", "exploit", "ctf", "安全", "逆向", "渗透",
        "漏洞", "审计",
    ]),
    ("media", [
        "video", "image", "audio", "voice", "speech", "tts", "stt", "music", "photo",
        "animation", "render", "camera", "字幕", "视频", "图像", "语音", "音频", "生成视频",
    ]),
    ("cli", [
        "cli", "terminal", "tui", "command-line", "command line", "tty", "zsh", "bash",
        "shell tool", "命令行",
    ]),
    ("web", [
        "web", "frontend", "front-end", "react", "vue", "svelte", "next.js", "browser",
        "css", "website", "landing page", "ui kit", "前端", "网页", "浏览器",
    ]),
    ("mobile", [
        "android", "ios", "mobile", "swift", "flutter", "react native", "apk", "移动端",
        "手机", "平板",
    ]),
    ("database", [
        "database", "sql", "postgres", "mysql", "sqlite", "redis", "mongodb", "duckdb",
        "orm", "vector db", "vector database", "数据库", "向量库",
    ]),
    ("devops", [
        "docker", "kubernetes", "k8s", "deploy", "devops", "self-hosted", "self hosted",
        "serverless", "terraform", "observability", "monitoring", "部署", "容器", "运维",
        "自建",
    ]),
    ("game", [
        "game", "unity", "godot", "emulator", "mod tool", "游戏", "模拟器",
    ]),
    ("data", [
        "data", "analytics", "etl", "dashboard", "crawler", "scrape", "scraping",
        "visualization", "数据", "分析", "爬虫", "可视化",
    ]),
    ("devtool", [
        "sdk", "library", "framework", "toolkit", "plugin", "extension", "compiler",
        "parser", "editor", "ide ", "debug", "test framework", "框架", "工具", "插件",
        "编译器", "编辑器",
    ]),
    ("docs", [
        "docs", "documentation", "note", "notes", "tutorial", "handbook", "cheat sheet",
        "roadmap", "课件", "文档", "笔记", "教程", "指南", "面试",
    ]),
]

#: 单个仓库最多打的标签数
MAX_TAGS: int = 3

# --------------------------------------------------------------------------------------
# 基础工具
# --------------------------------------------------------------------------------------


def log(message: str, level: str = "INFO") -> None:
    """向 stdout 输出一条带级别的日志.

    Args:
        message: 日志正文.
        level: 日志级别, 取值 INFO / WARN / ERROR.
    """
    print("[{0}] {1}".format(level, message), flush=True)


def build_opener() -> urllib.request.OpenerDirector:
    """构建一个显式禁用系统代理的 URL opener.

    CI 环境与本地沙箱常设置 http_proxy/https_proxy, 会导致直连 GitHub 失败;
    这里通过 ProxyHandler({}) 强制走直连。

    Returns:
        配置好的 OpenerDirector 实例.
    """
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


_OPENER: urllib.request.OpenerDirector = build_opener()


def http_get(
    url: str,
    headers: Optional[Dict[str, str]] = None,
    timeout: float = 30.0,
    retries: int = 3,
    sleep_base: float = 1.5,
) -> str:
    """执行一次带重试的 HTTP GET, 返回响应体文本.

    Args:
        url: 目标地址.
        headers: 附加请求头.
        timeout: 单次请求超时秒数.
        retries: 最大尝试次数(含首次).
        sleep_base: 退避基数秒数, 实际等待 sleep_base * attempt.

    Returns:
        解码后的响应体字符串.

    Raises:
        RuntimeError: 所有重试均失败时抛出.
    """
    request_headers: Dict[str, str] = dict(HTML_HEADERS)
    if headers:
        request_headers.update(headers)

    last_error: Optional[str] = None
    for attempt in range(1, retries + 1):
        request = urllib.request.Request(url, headers=request_headers, method="GET")
        try:
            with _OPENER.open(request, timeout=timeout) as response:
                charset: str = response.headers.get_content_charset() or "utf-8"
                body: bytes = response.read()
                return body.decode(charset, errors="replace")
        except urllib.error.HTTPError as exc:  # HTTP 4xx / 5xx
            last_error = "HTTP {0} {1}".format(exc.code, exc.reason)
        except urllib.error.URLError as exc:  # 网络层错误
            last_error = "URLError {0}".format(exc.reason)
        except Exception as exc:  # noqa: BLE001 - 兜底, 保证脚本不中断
            last_error = "{0}: {1}".format(type(exc).__name__, exc)

        if attempt < retries:
            time.sleep(sleep_base * attempt + (attempt * 0.17))

    raise RuntimeError("GET {0} 失败({1} 次尝试): {2}".format(url, retries, last_error))


def strip_tags(raw: str) -> str:
    """去除 HTML 标签并还原实体, 得到纯文本.

    Args:
        raw: 含标签的 HTML 片段.

    Returns:
        去标签、实体还原、空白折叠后的纯文本(可能为 "").
    """
    if not raw:
        return ""
    text: str = re.sub(r"<[^>]+>", " ", raw)
    text = html.unescape(text)
    # 去掉不可见字符与多空格
    text = text.replace("\u00a0", " ").replace("\u200b", "")
    return re.sub(r"\s+", " ", text).strip()


def parse_number(raw: Optional[str]) -> int:
    """把 "12,845" / "1.2k" / "3m" 这类文本解析为整数.

    Args:
        raw: 原始文本, 允许为 None 或空串.

    Returns:
        解析后的整数; 解析失败返回 0(不抛异常).
    """
    if raw is None:
        return 0
    text: str = str(raw).strip().lower().replace(",", "").replace("+", "").replace(" ", "")
    if not text:
        return 0
    multiplier: float = 1.0
    if text.endswith("k"):
        multiplier = 1000.0
        text = text[:-1]
    elif text.endswith("m"):
        multiplier = 1000000.0
        text = text[:-1]
    try:
        return int(float(text) * multiplier)
    except (TypeError, ValueError):
        return 0


def to_date(value: Optional[str]) -> str:
    """把 ISO 时间字符串裁剪为 YYYY-MM-DD.

    Args:
        value: 形如 "2026-10-08T12:34:56Z" 的时间字符串.

    Returns:
        "2026-10-08"; 入参非法时返回 "".
    """
    if not value or not isinstance(value, str):
        return ""
    return value[:10]


def now_iso() -> str:
    """返回当前北京时间(UTC+8)的 ISO 8601 字符串(带时区偏移)."""
    return datetime.now(TZ_BEIJING).replace(microsecond=0).isoformat()


def language_color(language: Optional[str]) -> str:
    """返回语言对应的主题色.

    Args:
        language: 语言名称, 允许为 None.

    Returns:
        十六进制颜色字符串.
    """
    if not language:
        return DEFAULT_LANGUAGE_COLOR
    return LANGUAGE_COLORS.get(language, DEFAULT_LANGUAGE_COLOR)


# --------------------------------------------------------------------------------------
# HTML 解析
# --------------------------------------------------------------------------------------

#: 榜单条目容器
ARTICLE_RE: re.Pattern = re.compile(
    r'<article\s[^>]*class="[^"]*Box-row[^"]*"[^>]*>(.*?)</article>',
    re.S | re.I,
)
#: owner/repo 链接(允许后接 /stargazers 等子路径)
REPO_HREF_RE: re.Pattern = re.compile(
    r'href="/([A-Za-z0-9][A-Za-z0-9._-]*)/([A-Za-z0-9][A-Za-z0-9._-]*)(?:/[^"]*)?"',
    re.I,
)
#: h2 标题(GitHub 用 h3 lh-condensed 作为仓库名容器)
H2_RE: re.Pattern = re.compile(
    r'<h2[^>]*class="[^"]*lh-condensed[^"]*"[^>]*>(.*?)</h2>', re.S | re.I
)
#: 语言
LANG_RE: re.Pattern = re.compile(
    r'<span\s[^>]*itemprop="programmingLanguage"[^>]*>(.*?)</span>', re.S | re.I
)
#: 周期增长量容器
PERIOD_RE: re.Pattern = re.compile(
    r'<span\s[^>]*class="[^"]*float-sm-right[^"]*"[^>]*>(.*?)</span>', re.S | re.I
)
#: 周期增长量中的数字 + stars
PERIOD_NUM_RE: re.Pattern = re.compile(r"([\d,]+(?:\.\d+)?k?)\s*stars", re.I)
#: 描述段落
DESC_PRIMARY_RE: re.Pattern = re.compile(
    r'<p\s[^>]*class="[^"]*color-fg-muted[^"]*"[^>]*>(.*?)</p>', re.S | re.I
)
DESC_ANY_RE: re.Pattern = re.compile(r"<p\b[^>]*>(.*?)</p>", re.S | re.I)
#: 所有 img 标签(用于提取贡献者头像)
IMG_RE: re.Pattern = re.compile(r"<img\b[^>]*>", re.S | re.I)
IMG_SRC_RE: re.Pattern = re.compile(r'src="([^"]+)"', re.I)


def extract_articles(page_html: str) -> List[str]:
    """从 trending 页面中切出所有条目块.

    Args:
        page_html: 整页 HTML.

    Returns:
        条目内部 HTML 片段列表; 页面无条目时返回空列表.
    """
    blocks: List[str] = ARTICLE_RE.findall(page_html or "")
    if blocks:
        return blocks
    # 兜底: class 属性顺序/引号风格变化时, 手工按 <article ...> ... </article> 切分
    fallback: List[str] = []
    for match in re.finditer(r"<article\b[^>]*>(.*?)</article>", page_html or "", re.S | re.I):
        if "Box-row" in match.group(0)[:200]:
            fallback.append(match.group(1))
    return fallback


def _extract_owner_name(block: str) -> Tuple[str, str]:
    """从条目块中提取 owner 与 repo 名称.

    Args:
        block: 单个 <article> 的内部 HTML.

    Returns:
        (owner, name) 元组; 提取失败返回 ("", "").
    """
    h2_match = H2_RE.search(block)
    if h2_match:
        href_match = REPO_HREF_RE.search(h2_match.group(1))
        if href_match:
            return href_match.group(1), href_match.group(2)
    # 兜底: 取块内第一个形如 /owner/repo 的链接
    for href_match in REPO_HREF_RE.finditer(block):
        owner: str = href_match.group(1)
        name: str = href_match.group(2)
        return owner, name
    return "", ""


def _extract_counter(block: str, owner: str, name: str, suffix: str) -> int:
    """提取 stargazers / forks 计数.

    Args:
        block: 条目内部 HTML.
        owner: 仓库 owner.
        name: 仓库名.
        suffix: 链接后缀, "stargazers" 或 "forks".

    Returns:
        计数值; 未取到返回 0.
    """
    if not owner or not name:
        return 0
    pattern = re.compile(
        r'href="/{0}/{1}/{2}"[^>]*>(.*?)</a>'.format(re.escape(owner), re.escape(name), suffix),
        re.S | re.I,
    )
    match = pattern.search(block)
    if not match:
        return 0
    return parse_number(strip_tags(match.group(1)))


def _extract_description(block: str) -> str:
    """提取仓库描述, 取不到返回空串(绝不抛异常)."""
    for pattern in (DESC_PRIMARY_RE, DESC_ANY_RE):
        for match in pattern.finditer(block):
            text: str = strip_tags(match.group(1))
            if not text:
                continue
            # 过滤掉明显不是描述的片段(周期增量、Built by 等)
            if "stars today" in text or "stars this" in text or text.startswith("Built by"):
                continue
            return text
    return ""


def _extract_contributors(block: str) -> List[str]:
    """提取 "Built by" 区域的贡献者头像 URL.

    Args:
        block: 条目内部 HTML.

    Returns:
        去重后的头像 URL 列表(最多 5 个).
    """
    avatars: List[str] = []
    for tag in IMG_RE.findall(block):
        if "avatar-user" not in tag and "avatar" not in tag:
            continue
        src_match = IMG_SRC_RE.search(tag)
        if not src_match:
            continue
        src: str = html.unescape(src_match.group(1))
        if "avatars.githubusercontent.com" not in src:
            continue
        if src not in avatars:
            avatars.append(src)
        if len(avatars) >= 5:
            break
    return avatars


def parse_article(block: str, period: str) -> Optional[Dict[str, Any]]:
    """解析单个 trending 条目为数据字典.

    任何字段缺失都只降级为空值, 不会丢弃整条记录, 也不会抛异常。

    Args:
        block: 单个 <article> 的内部 HTML.
        period: daily / weekly / monthly.

    Returns:
        条目字典; 连 owner/name 都取不到时返回 None.
    """
    owner, name = _extract_owner_name(block)
    if not owner or not name:
        return None

    spec: Dict[str, str] = PERIOD_SPECS.get(period, PERIOD_SPECS["daily"])

    language_match = LANG_RE.search(block)
    language: str = strip_tags(language_match.group(1)) if language_match else ""

    period_match = PERIOD_RE.search(block)
    period_text: str = strip_tags(period_match.group(1)) if period_match else ""
    period_num_match = PERIOD_NUM_RE.search(period_text) if period_text else None
    period_stars: int = parse_number(period_num_match.group(1)) if period_num_match else 0

    full_name: str = "{0}/{1}".format(owner, name)
    return {
        "rank": 0,  # 稍后按解析顺序编号
        "fullName": full_name,
        "owner": owner,
        "name": name,
        "url": "https://github.com/{0}".format(full_name),
        "description": _extract_description(block),
        "language": language,
        "languageColor": language_color(language),
        "stars": _extract_counter(block, owner, name, "stargazers"),
        "forks": _extract_counter(block, owner, name, "forks"),
        "periodStars": period_stars,
        "periodLabel": spec["increment"],
        "tags": [],  # 由 classify_tags() 在补全之后统一计算
        "createdAt": "",
        "pushedAt": "",
        "topics": [],
        "license": "",
        "ownerAvatar": "",
        "contributors": _extract_contributors(block),
        "enriched": False,
    }


def fetch_trending(period: str) -> List[Dict[str, Any]]:
    """抓取并解析一个周期的榜单.

    Args:
        period: daily / weekly / monthly.

    Returns:
        条目列表(按页面顺序, rank 从 1 开始); 失败时返回空列表.
    """
    source: str = PERIOD_SPECS[period]["source"]
    try:
        page_html: str = http_get(source, timeout=30.0, retries=3)
    except RuntimeError as exc:
        log("{0} 抓取失败: {1}".format(period, exc), "ERROR")
        return []

    log("{0} 页面抓取成功, HTML {1} 字节".format(period, len(page_html)))
    blocks: List[str] = extract_articles(page_html)
    log("{0} 解析到 {1} 个条目块".format(period, len(blocks)))

    items: List[Dict[str, Any]] = []
    for index, block in enumerate(blocks, start=1):
        try:
            item: Optional[Dict[str, Any]] = parse_article(block, period)
        except Exception as exc:  # noqa: BLE001 - 单条解析异常不得中断整体
            log("{0} 第 {1} 条解析异常, 已跳过: {2}".format(period, index, exc), "WARN")
            continue
        if item is None:
            log("{0} 第 {1} 条缺少 owner/repo, 已跳过".format(period, index), "WARN")
            continue
        item["rank"] = len(items) + 1
        items.append(item)

    return items


# --------------------------------------------------------------------------------------
# REST API 补全
# --------------------------------------------------------------------------------------


def fetch_repo_meta(owner: str, name: str, token: str, timeout: float = 20.0) -> Optional[Dict[str, Any]]:
    """调用 GitHub REST API 获取仓库元信息.

    Args:
        owner: 仓库 owner.
        name: 仓库名.
        token: GitHub Token, 可为空串(匿名调用, 60 次/小时).
        timeout: 单次超时秒数.

    Returns:
        API 返回的 JSON 字典; 失败/404/限流返回 None.
    """
    url: str = "https://api.github.com/repos/{0}/{1}".format(owner, name)
    headers: Dict[str, str] = dict(API_HEADERS)
    if token:
        headers["Authorization"] = "Bearer {0}".format(token)
    try:
        body: str = http_get(url, headers=headers, timeout=timeout, retries=2, sleep_base=1.0)
        payload: Any = json.loads(body)
        if isinstance(payload, dict):
            return payload
        return None
    except RuntimeError as exc:
        log("API 失败 {0}/{1}: {2}".format(owner, name, exc), "WARN")
        return None
    except (ValueError, TypeError) as exc:
        log("API 响应解析失败 {0}/{1}: {2}".format(owner, name, exc), "WARN")
        return None


def enrich_item(item: Dict[str, Any], meta: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """用 API 元信息补全条目; API 不可用时保留抓取值.

    Args:
        item: 抓取得到的条目字典(原地修改并返回).
        meta: REST API 返回的仓库字典, 可为 None.

    Returns:
        补全后的条目字典.
    """
    if not isinstance(meta, dict) or not meta:
        # 降级: owner 头像至少用贡献者头像兜底
        if not item.get("ownerAvatar") and item.get("contributors"):
            item["ownerAvatar"] = item["contributors"][0]
        return item

    description: str = (meta.get("description") or "").strip()
    if description:
        item["description"] = description

    stars = meta.get("stargazers_count")
    if isinstance(stars, int):
        item["stars"] = stars

    forks = meta.get("forks_count")
    if isinstance(forks, int):
        item["forks"] = forks

    language = meta.get("language")
    if language:
        item["language"] = language
        item["languageColor"] = language_color(str(language))

    topics = meta.get("topics")
    if isinstance(topics, list):
        item["topics"] = [str(topic) for topic in topics][:8]

    item["createdAt"] = to_date(meta.get("created_at"))
    item["pushedAt"] = to_date(meta.get("pushed_at"))

    license_obj = meta.get("license")
    if isinstance(license_obj, dict):
        spdx: str = str(license_obj.get("spdx_id") or "")
        item["license"] = "" if spdx in ("NOASSERTION", "None", "") else spdx

    owner_obj = meta.get("owner")
    if isinstance(owner_obj, dict):
        item["ownerAvatar"] = str(owner_obj.get("avatar_url") or "")
        item["ownerHomepage"] = str(owner_obj.get("homepage") or "")

    if not item.get("contributors") and item.get("ownerAvatar"):
        item["contributors"] = [item["ownerAvatar"]]

    item["enriched"] = True
    return item


def enrich_items(
    items: List[Dict[str, Any]],
    token: str,
    sleep_seconds: float = 0.15,
    max_items: int = 0,
) -> None:
    """顺序补全条目列表(顺序执行 + 轻微 sleep, 避免打爆 API 限额).

    Args:
        items: 条目列表(原地修改).
        token: GitHub Token.
        sleep_seconds: 每次 API 调用之间的间隔秒数.
        max_items: 最多补全条数; 0 表示不限制.
    """
    total: int = len(items) if max_items <= 0 else min(len(items), max_items)
    for index, item in enumerate(items, start=1):
        if max_items > 0 and index > max_items:
            break
        meta: Optional[Dict[str, Any]] = fetch_repo_meta(
            item.get("owner", ""), item.get("name", ""), token
        )
        enrich_item(item, meta)
        if index < total:
            time.sleep(sleep_seconds)


# --------------------------------------------------------------------------------------
# 输出
# --------------------------------------------------------------------------------------


def read_existing_board(path: str) -> Optional[Dict[str, Any]]:
    """读取已有的榜单 JSON 文件.

    Args:
        path: 文件路径.

    Returns:
        解析后的字典; 文件不存在或非法时返回 None.
    """
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as handle:
            payload: Any = json.load(handle)
        if isinstance(payload, dict):
            return payload
    except (OSError, ValueError) as exc:
        log("读取已有数据失败 {0}: {1}".format(path, exc), "WARN")
    return None


#: 可从历史数据里回填的字段(REST API 的精确值优于页面的四舍五入值)
_RESTORABLE_FIELDS: List[str] = [
    "description", "stars", "forks", "language", "languageColor", "topics",
    "createdAt", "pushedAt", "license", "ownerAvatar", "ownerHomepage", "contributors",
]


def merge_previous_enrichment(
    items: List[Dict[str, Any]], previous: Optional[Dict[str, Any]]
) -> int:
    """把上一次已补全的字段回填到本次没能补全的条目上.

    触发场景: 匿名调用(60 次/小时)或 CI 偶发限流导致本次 API 全失败。
    若不回填, 本次写入会把上一次的精确 star / 创建时间 / topics 覆盖成页面的
    四舍五入值与空串, 造成数据质量倒退。

    Args:
        items: 本次抓取到的条目列表(就地修改).
        previous: 上一次写入的榜单字典, 可为 None.

    Returns:
        被回填的条目数.
    """
    if not isinstance(previous, dict):
        return 0
    previous_items: Any = previous.get("items")
    if not isinstance(previous_items, list):
        return 0

    cache: Dict[str, Dict[str, Any]] = {}
    for old in previous_items:
        if isinstance(old, dict) and old.get("enriched") and old.get("fullName"):
            cache[str(old["fullName"])] = old

    restored: int = 0
    for item in items:
        if item.get("enriched"):
            continue
        old: Optional[Dict[str, Any]] = cache.get(str(item.get("fullName") or ""))
        if not old:
            continue
        for field in _RESTORABLE_FIELDS:
            new_value = item.get(field)
            old_value = old.get(field)
            if old_value in (None, "", [], 0):
                continue
            if new_value in (None, "", [], 0):
                item[field] = old_value
            elif field in ("stars", "forks") and isinstance(old_value, int):
                # API 的精确值优先于页面文本解析出的取整值
                item[field] = old_value
        item["restoredFromPrevious"] = True
        restored += 1

    if restored:
        log("从历史数据回填了 {0} 条的补全字段(本次 API 未覆盖到)".format(restored))
    return restored


def write_json(path: str, payload: Any) -> None:
    """把对象写成 UTF-8 缩进 JSON.

    Args:
        path: 目标文件路径(父目录不存在时自动创建).
        payload: 待写入对象.
    """
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def _keyword_hit(haystack: str, keyword: str) -> bool:
    """判断关键词是否命中检索文本.

    纯 ASCII 关键词按"词边界"匹配, 避免 chain 命中 ai、mail 命中 ml 这类误伤;
    含中文等非 ASCII 字符的关键词退化为子串匹配.

    Args:
        haystack: 已转小写的检索文本.
        keyword: 关键词(不区分大小写).

    Returns:
        是否命中.
    """
    key: str = keyword.lower()
    if re.fullmatch(r"[a-z0-9 +\-.#]+", key):
        return re.search(r"(?<![a-z0-9])" + re.escape(key) + r"(?![a-z0-9])", haystack) is not None
    return key in haystack


def classify_tags(item: Dict[str, Any]) -> List[str]:
    """依据仓库的实际内容(名称 / 描述 / topics / 语言)打标签.

    只打真正命中的标签, 命中 0 个就返回空列表(不做兜底硬塞).

    Args:
        item: 条目字典.

    Returns:
        标签 key 列表, 最多 MAX_TAGS 个, 顺序遵循 TAG_RULES 的优先级.
    """
    parts: List[str] = [
        str(item.get("name") or ""),
        str(item.get("owner") or ""),
        str(item.get("description") or ""),
        str(item.get("language") or ""),
        " ".join(str(topic) for topic in (item.get("topics") or [])),
    ]
    haystack: str = " ".join(parts).lower()

    tags: List[str] = []
    for tag_key, keywords in TAG_RULES:
        if len(tags) >= MAX_TAGS:
            break
        for keyword in keywords:
            if _keyword_hit(haystack, keyword):
                tags.append(tag_key)
                break
    return tags


def apply_tags(items: List[Dict[str, Any]]) -> None:
    """就地计算列表中每条记录的标签(补全元信息之后调用, 以便利用 topics/描述)."""
    for item in items:
        item["tags"] = classify_tags(item)


def tag_counts(items: List[Dict[str, Any]]) -> Dict[str, int]:
    """统计一个榜单里各标签的条目数(按数量降序).

    Args:
        items: 条目列表.

    Returns:
        {标签 key: 条目数}, 数量降序、同数量按 key 升序.
    """
    counter: Dict[str, int] = {}
    for item in items:
        for tag in item.get("tags") or []:
            counter[tag] = counter.get(tag, 0) + 1
    return dict(sorted(counter.items(), key=lambda kv: (-kv[1], kv[0])))


def write_period_pages(period: str, board: Dict[str, Any], updated_at: str) -> int:
    """把榜单切成固定大小的页, 供前端滚动时逐片拉取.

    产物:
        data/pages/<period>/index.json   页数/总数/标签统计
        data/pages/<period>/1.json ...   每页条目

    Args:
        period: daily / weekly / monthly.
        board: 完整榜单字典.
        updated_at: 更新时间 ISO 字符串.

    Returns:
        总页数(至少 1 页).
    """
    items: List[Dict[str, Any]] = board.get("items") or []
    total: int = len(items)
    total_pages: int = max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE)
    out_dir: str = os.path.join(DATA_DIR, "pages", period)
    os.makedirs(out_dir, exist_ok=True)

    for page in range(1, total_pages + 1):
        start: int = (page - 1) * PAGE_SIZE
        chunk: List[Dict[str, Any]] = items[start:start + PAGE_SIZE]
        write_json(
            os.path.join(out_dir, "{0}.json".format(page)),
            {
                "period": period,
                "periodLabel": board.get("periodLabel", ""),
                "updatedAt": board.get("updatedAt", updated_at),
                "page": page,
                "pageSize": PAGE_SIZE,
                "totalPages": total_pages,
                "total": total,
                "items": chunk,
            },
        )

    write_json(
        os.path.join(out_dir, "index.json"),
        {
            "period": period,
            "periodLabel": board.get("periodLabel", ""),
            "updatedAt": board.get("updatedAt", updated_at),
            "pageSize": PAGE_SIZE,
            "totalPages": total_pages,
            "total": total,
            "tagCounts": board.get("tagCounts", {}),
        },
    )

    # 清理上次留下的多余页(页数是会变的), 失败也不影响主流程
    try:
        for name in os.listdir(out_dir):
            match = re.fullmatch(r"(\d+)\.json", name)
            if not match:
                continue
            if int(match.group(1)) > total_pages:
                os.remove(os.path.join(out_dir, name))
    except OSError:
        pass

    log("{0} 分页产物写入 {1}, 共 {2} 页 / {3} 条".format(period, out_dir, total_pages, total))
    return total_pages


def build_board(period: str, items: List[Dict[str, Any]], updated_at: str) -> Dict[str, Any]:
    """组装榜单 JSON 结构.

    Args:
        period: daily / weekly / monthly.
        items: 条目列表.
        updated_at: 更新时间 ISO 字符串.

    Returns:
        榜单字典.
    """
    spec: Dict[str, str] = PERIOD_SPECS[period]
    return {
        "period": period,
        "periodLabel": spec["label"],
        "updatedAt": updated_at,
        "source": spec["source"],
        "count": len(items),
        "tagCounts": tag_counts(items),
        "items": items,
    }


def main(argv: Optional[List[str]] = None) -> int:
    """脚本入口.

    Args:
        argv: 命令行参数列表; 默认使用 sys.argv[1:].

    Returns:
        退出码; 正常恒为 0(任何单榜失败都不应让 CI 变红并吞掉已有数据).
    """
    parser = argparse.ArgumentParser(description="抓取 GitHub Trending 日/周/月榜并生成静态数据")
    parser.add_argument(
        "--periods",
        default="daily,weekly,monthly",
        help="要抓取的周期, 逗号分隔, 默认 daily,weekly,monthly",
    )
    parser.add_argument("--no-enrich", action="store_true", help="跳过 REST API 补全")
    parser.add_argument("--no-history", action="store_true", help="不写历史归档")
    parser.add_argument(
        "--sleep", type=float, default=0.15, help="API 调用间隔秒数, 默认 0.15"
    )
    parser.add_argument("--max-enrich", type=int, default=0, help="最多补全条数, 0 表示不限制")
    args = parser.parse_args(argv)

    periods: List[str] = [p.strip() for p in args.periods.split(",") if p.strip() in PERIOD_SPECS]
    if not periods:
        log("没有合法的周期参数: {0}".format(args.periods), "ERROR")
        return 0

    token: str = os.environ.get("GITHUB_TOKEN", "") or os.environ.get("GH_TOKEN", "") or ""
    updated_at: str = now_iso()
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(HISTORY_DIR, exist_ok=True)

    boards: Dict[str, Dict[str, Any]] = {}
    counts: Dict[str, int] = {"daily": 0, "weekly": 0, "monthly": 0}
    #: 本次真正抓到新数据的周期; 全部失败时不刷新 meta.updatedAt, 避免"谎报"更新时间
    fresh_periods: List[str] = []

    for period in periods:
        log("==== 开始处理 {0} 榜 ====".format(period))
        items: List[Dict[str, Any]] = fetch_trending(period)
        output_path: str = os.path.join(DATA_DIR, "{0}.json".format(period))

        if not items:
            # 抓取/解析为空: 保留上一次的数据, 绝不覆盖成空榜
            existing: Optional[Dict[str, Any]] = read_existing_board(output_path)
            if existing and isinstance(existing.get("items"), list) and existing["items"]:
                log(
                    "{0} 本次无数据, 保留已有 {1} 条记录".format(period, len(existing["items"])),
                    "WARN",
                )
                # 兼容老数据: 缺 tags 字段时补算一次, 保证标签筛选与分页产物可用
                if any("tags" not in item for item in existing["items"]):
                    apply_tags(existing["items"])
                    existing["tagCounts"] = tag_counts(existing["items"])
                    write_json(output_path, existing)
                boards[period] = existing
                counts[period] = len(existing["items"])
                write_period_pages(period, existing, updated_at)
            else:
                log("{0} 本次无数据且无历史文件, 写入空榜".format(period), "WARN")
                boards[period] = build_board(period, [], updated_at)
                counts[period] = 0
                write_json(output_path, boards[period])
                write_period_pages(period, boards[period], updated_at)
            continue

        previous_board: Optional[Dict[str, Any]] = read_existing_board(output_path)

        if not args.no_enrich:
            log("{0} 开始 REST API 补全({1} 条)".format(period, len(items)))
            enrich_items(items, token, sleep_seconds=args.sleep, max_items=args.max_enrich)
            ok_count: int = sum(1 for item in items if item.get("enriched"))
            log("{0} 补全完成: {1}/{2} 条成功".format(period, ok_count, len(items)))
            # 本次 API 未覆盖到的条目, 用上一次的补全结果兜底, 避免数据质量倒退
            merge_previous_enrichment(items, previous_board)

        # 标签必须在补全之后计算, 才能用到 API 回传的描述与 topics
        apply_tags(items)

        # ---- 不退化闸门 ----
        # Trending 页只有 9~25 条, 而 data/<period>.json 与 data/pages/<period>/
        # 由 fetch_top100.py 维护「前 100 名」。fetch_top100.py 平时**只重建日榜**
        # (周榜仅周一、月榜仅 1 号), 所以这里一旦无条件覆盖, 每天的定时任务都会把
        # 周榜/月榜砸成 Trending 的薄数据 —— 实测首个 cron 跑出 周榜 100→11、
        # 月榜 100→24, 与前端的 6 条/页 × 17 页结构矛盾(README「每个榜单稳定展示前 100 名」)。
        # 已有榜单更完整时直接跳过覆盖, 保留 fetch_top100.py 的产物。
        prev_items: List[Dict[str, Any]] = (
            previous_board.get("items") if isinstance(previous_board, dict) else None
        ) or []
        if len(prev_items) > len(items):
            log(
                "{0} 本次只抓到 {1} 条, 少于已有的 {2} 条, 跳过覆盖以保持产物不退化".format(
                    period, len(items), len(prev_items)
                ),
                "WARN",
            )
            boards[period] = previous_board
            counts[period] = len(prev_items)
            continue

        board: Dict[str, Any] = build_board(period, items, updated_at)
        write_json(output_path, board)
        write_period_pages(period, board, updated_at)
        boards[period] = board
        counts[period] = len(items)
        fresh_periods.append(period)
        log("{0} 写入 {1}, 共 {2} 条".format(period, output_path, len(items)))

    # 只更新本次实际处理过的周期, 其余沿用历史 meta
    meta_path: str = os.path.join(DATA_DIR, "meta.json")
    meta: Dict[str, Any] = read_existing_board(meta_path) or {}
    if not isinstance(meta.get("counts"), dict):
        meta["counts"] = {"daily": 0, "weekly": 0, "monthly": 0}
    meta["generator"] = "fetch_rank.py"
    meta["source"] = "https://github.com/trending"
    meta["periods"] = sorted(periods)
    if not isinstance(meta.get("tagCounts"), dict):
        meta["tagCounts"] = {}
    for period in periods:
        meta["counts"][period] = counts.get(period, 0)
        board_obj: Optional[Dict[str, Any]] = boards.get(period)
        if isinstance(board_obj, dict):
            meta["tagCounts"][period] = board_obj.get("tagCounts", {})

    if fresh_periods:
        # 确实抓到了新数据才推进 updatedAt; 否则沿用上一次的值, 避免前端显示假的更新时间,
        # 也避免 data/ 因 meta 变化产生一次空提交
        meta["updatedAt"] = updated_at
        meta["freshPeriods"] = sorted(fresh_periods)
        write_json(meta_path, meta)
        log("写入 {0} (本次抓到新数据的周期: {1})".format(meta_path, ", ".join(sorted(fresh_periods))))
    elif not os.path.isfile(meta_path):
        # 首次运行且全部失败: 仍然落一个 meta.json, 保证文件存在
        meta["updatedAt"] = updated_at
        meta["freshPeriods"] = []
        write_json(meta_path, meta)
        log("首次运行且无数据, 写入空 meta {0}".format(meta_path), "WARN")
    else:
        log("本次没有任何周期抓到新数据, {0} 保持不变(updatedAt 不刷新)".format(meta_path), "WARN")

    if fresh_periods and not args.no_history:
        snapshot_date: str = datetime.now(TZ_BEIJING).strftime("%Y-%m-%d")
        snapshot_path: str = os.path.join(HISTORY_DIR, "{0}.json".format(snapshot_date))
        existing_snapshot: Optional[Dict[str, Any]] = read_existing_board(snapshot_path) or {}
        if not isinstance(existing_snapshot, dict):
            existing_snapshot = {}
        existing_snapshot["date"] = snapshot_date
        existing_snapshot["generatedAt"] = updated_at
        if not isinstance(existing_snapshot.get("boards"), dict):
            existing_snapshot["boards"] = {}
        for period in periods:
            existing_snapshot["boards"][period] = boards.get(period, {})
        write_json(snapshot_path, existing_snapshot)
        log("写入历史归档 {0}".format(snapshot_path))

    log("全部完成. 条目数: {0}".format(
        ", ".join("{0}={1}".format(p, counts.get(p, 0)) for p in periods)
    ))
    return 0


if __name__ == "__main__":
    sys.exit(main())
