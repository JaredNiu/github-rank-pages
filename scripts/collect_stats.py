#!/usr/bin/env python3
"""把访问量按天归档进仓库：data/stats/visits.json

为什么需要它
------------
前端的计数写在第三方服务上（abacus），那里只有「当前值」：没有历史、没有趋势，
也无法追溯「上周三到底来了多少人」。这个脚本在 CI 里把当天（以及前一天）的值读回来，
按天落到仓库里的 JSON —— 于是「每天有多少访问量」有了可提交、可回溯、与代码一起
版本化的记录。

口径（与前端的键一一对应）
--------------------------
  visits   当天**页面访问量**（每次加载 +1）
  daily / weekly / monthly   当天**各榜期被查看的次数**（含首屏与页内切榜）
所以三者之和 ≥ visits，这是有意的口径差，不是重复计数。
日期一律按北京时间（UTC+8）切，与定时抓取的作息一致。

三条设计约束
------------
1. **只读**。归档绝不能反过来影响真实计数，本脚本只发 GET。
2. **只增不减**。某天的值一旦记下就不再变小（同日重跑取 max）。既防第三方抖动，
   也保证「历史值」不会被后来的重跑改写掉。
3. **任何失败都退出 0**。统计挂了不能连累抓取流水线；读不到就什么都不写，
   绝不把「拿不到」写成 0。

用法
----
  python3 scripts/collect_stats.py                # 正常归档
  python3 scripts/collect_stats.py --dry-run      # 只打印，不落盘
  python3 scripts/collect_stats.py --date 2026-10-09   # 指定「今天」（补跑用）
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

HOST = "https://abacus.jasoncameron.dev"
NAMESPACE = "jaredniu-github-rank-pages"
TZ_BEIJING = timezone(timedelta(hours=8))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(ROOT, "data", "stats", "visits.json")

PERIODS = ("daily", "weekly", "monthly")
FIELDS = ("visits",) + PERIODS

#: 归档保留的天数上限。单条约 90 字节，400 天不到 40KB，纯粹是防御性上限。
KEEP_DAYS = 400
TIMEOUT = 12


def read_counter(key: str):
    """读一个计数键。键不存在（404）就是 0；其它任何失败返回 None。

    「0」与「None」必须分开：前者是确凿的零，后者是没读到 ——
    如果混在一起，弱网那天就会把一整天的真实数据写成 0。
    """
    url = f"{HOST}/get/{NAMESPACE}/{key}"
    req = urllib.request.Request(url, headers={"User-Agent": "github-rank-pages/collect-stats"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return 0
        print(f"    WARN  {key}: HTTP {exc.code}", file=sys.stderr)
        return None
    except Exception as exc:  # noqa: BLE001 - 网络层任何异常都按「没读到」处理
        print(f"    WARN  {key}: {exc}", file=sys.stderr)
        return None
    value = body.get("value") if isinstance(body, dict) else None
    return value if isinstance(value, int) else None


def collect_day(day: str):
    """读某一天的全部计数；整天的键一个都没读到就返回 None。"""
    fresh = {
        "visits": read_counter(f"d.{day}"),
        **{p: read_counter(f"d.{day}.{p}") for p in PERIODS},
    }
    if all(fresh[f] is None for f in FIELDS):
        return None
    # 单个字段读失败时不写 None，留给下一次运行补（merge 会跳过 None）
    return {k: v for k, v in fresh.items() if v is not None}


def merge_day(entry: dict, fresh: dict) -> dict:
    """只增不减地合并某一天：已记下的历史值永远不会被后来的小值改写"""
    entry = dict(entry)
    for field in FIELDS:
        value = fresh.get(field)
        if value is None:
            continue
        old = entry.get(field)
        entry[field] = value if not isinstance(old, int) else max(old, value)
    return entry


def load_existing() -> dict:
    if not os.path.exists(OUT_PATH):
        return {}
    try:
        with open(OUT_PATH, encoding="utf-8") as fh:
            body = json.load(fh)
    except (OSError, ValueError) as exc:
        print(f"  WARN  现有 {OUT_PATH} 无法解析（{exc}），本次将重建", file=sys.stderr)
        return {}
    days = body.get("days") if isinstance(body, dict) else None
    if not isinstance(days, list):
        return {}
    return {d["date"]: d for d in days if isinstance(d, dict) and isinstance(d.get("date"), str)}


def main() -> int:
    parser = argparse.ArgumentParser(description="把访问量按天归档进仓库")
    parser.add_argument("--date", help="把哪一天当作「今天」（北京时间，YYYY-MM-DD）")
    parser.add_argument("--dry-run", action="store_true", help="只打印结果，不写文件")
    args = parser.parse_args()

    if args.date:
        try:
            today = datetime.strptime(args.date, "%Y-%m-%d").date()
        except ValueError:
            print(f"::error::--date 需要 YYYY-MM-DD，收到 {args.date!r}", file=sys.stderr)
            return 0
    else:
        today = datetime.now(TZ_BEIJING).date()
    yesterday = today - timedelta(days=1)

    print(f"访问统计归档 · 命名空间 {NAMESPACE} · 目标日期 {today} / {yesterday}")

    merged = load_existing()
    wrote_any = False

    for day in (yesterday.isoformat(), today.isoformat()):
        fresh = collect_day(day)
        # 全部键都是 0（或没读到）说明那天根本没有计数键 —— 通常意味着「那时还没有计数」，
        # 而不是「那天真的零访问」。写一行 0 会凭空造出一条假记录，所以跳过不写。
        if fresh is None or not any(isinstance(v, int) and v > 0 for v in fresh.values()):
            print(f"  [{day}] 没有计数（键不存在或全为 0），跳过 —— 不写 0")
            continue
        before = merged.get(day, {})
        after = merge_day(before, fresh)
        changed = after != before
        merged[day] = after
        wrote_any = wrote_any or changed
        print(
            f"  [{day}] 读到 {fresh} → 归档 访问={after.get('visits')} "
            f"日={after.get('daily')} 周={after.get('weekly')} 月={after.get('monthly')}"
            + ("" if changed else "   （无变化）")
        )

    days = [merged[k] for k in sorted(merged.keys())][-KEEP_DAYS:]
    out = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "provider": "abacus.jasoncameron.dev",
        "namespace": NAMESPACE,
        "note": (
            "visits 是当天页面访问量；daily/weekly/monthly 是各榜期被查看的次数"
            "（含首屏与页内切榜，故三者之和 ≥ visits）。日期按北京时间（UTC+8）切。"
        ),
        "days": days,
    }

    if args.dry_run:
        print("--dry-run，未写文件。将要写入的内容：")
        print(json.dumps(out, ensure_ascii=False, indent=2)[:1200])
        return 0

    if not wrote_any:
        print("本次没有任何新数据，不写文件（避免产生一次空提交）")
        return 0

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(f"已写入 {os.path.relpath(OUT_PATH, ROOT)}：{len(days)} 天")
    return 0


if __name__ == "__main__":
    # 统计是旁路：任何异常都不允许把抓取流水线弄红
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"WARN 访问统计归档失败（已忽略，不影响抓取）：{exc}", file=sys.stderr)
        sys.exit(0)
