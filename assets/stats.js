/*
 * 访问统计独立页（stats.html）的逻辑。
 *
 * ⚠️ 设计铁律：本页**只读**统计（GET），**绝不**调用计数（POST /hit/）。
 *    计数服务的 /hit/ 才会让数值 +1，/get/ 只读取、不增加。
 *    因此打开本页、刷新本页都**不计入**访问量 —— 这正是用户的要求。
 *    若日后要在这里加"本页自身被查看次数"，那会自相矛盾，请勿加。
 *
 * 数据来源：
 *  1) 实时累计 / 今日：第三方计数服务 abacus 的 /get/ 接口（只读）。
 *  2) 每日明细：本仓库自带的归档文件 data/stats/visits.json（无第三方依赖，
 *     由 CI 每日抓取，随代码版本化）。
 */
(function () {
  'use strict';

  var STATS_HOST = 'https://abacus.jasoncameron.dev';
  var STATS_NS = 'jaredniu-github-rank-pages';
  var STATS_TIMEOUT_MS = 3000;
  var RECENT_URL = 'data/stats/visits.json';

  // 只读某个计数键。404 = 该键不存在 = 0 次；其它错误/超时 = 取不到（null → 显示「—」）。
  function readCounter(key) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, STATS_TIMEOUT_MS);
    return fetch(STATS_HOST + '/get/' + STATS_NS + '/' + key, {
      signal: ctrl.signal, cache: 'no-store'
    }).then(function (res) {
      clearTimeout(timer);
      if (res.status === 404) { return { ok: true, value: 0 }; }
      if (!res.ok) { return { ok: false, value: null }; }
      return res.json().then(function (j) { return { ok: true, value: j.value }; });
    }).catch(function () {
      clearTimeout(timer);
      return { ok: false, value: null };
    });
  }

  function num(v) { return (typeof v === 'number') ? String(v) : '—'; }

  // 北京时间（UTC+8）日期键，和抓取/统计口径一致。
  function beijingDateKey(d) {
    var bj = new Date(d.getTime() + 8 * 3600 * 1000);
    var m = String(bj.getUTCMonth() + 1);
    var day = String(bj.getUTCDate());
    if (m.length < 2) { m = '0' + m; }
    if (day.length < 2) { day = '0' + day; }
    return bj.getUTCFullYear() + '-' + m + '-' + day;
  }

  function setText(id, txt) {
    var el = document.getElementById(id);
    if (el) { el.textContent = txt; }
  }

  function renderSummary(live) {
    var cards = [
      { k: '累计页面访问', v: num(live.all) },
      { k: '今日页面访问（实时）', v: num(live.today) },
      { k: '累计 · 日榜被查看', v: num(live.daily) },
      { k: '累计 · 周榜被查看', v: num(live.weekly) },
      { k: '累计 · 月榜被查看', v: num(live.monthly) }
    ];
    var wrap = document.getElementById('statsCards');
    if (!wrap) { return; }
    wrap.innerHTML = cards.map(function (c) {
      return '<div class="stats-card"><div class="k">' + c.k + '</div>' +
             '<div class="v">' + c.v + '</div></div>';
    }).join('');
  }

  function renderTable(days) {
    var tbody = document.querySelector('#statsTable tbody');
    if (!tbody) { return; }
    if (!days || !days.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="color:var(--muted)">暂无归档数据</td></tr>';
      return;
    }
    days.slice().sort(function (a, b) {
      return (a.date < b.date) ? 1 : ((a.date > b.date) ? -1 : 0);
    }).forEach(function (d) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + (d.date || '') + '</td>' +
        '<td class="num">' + num(d.visits) + '</td>' +
        '<td class="num">' + num(d.daily) + '</td>' +
        '<td class="num">' + num(d.weekly) + '</td>' +
        '<td class="num">' + num(d.monthly) + '</td>';
      tbody.appendChild(tr);
    });
  }

  function loadArchive() {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, STATS_TIMEOUT_MS);
    return fetch(RECENT_URL, { signal: ctrl.signal, cache: 'no-store' })
      .then(function (res) {
        clearTimeout(timer);
        if (!res.ok) { return null; }
        return res.json();
      })
      .catch(function () { clearTimeout(timer); return null; });
  }

  function init() {
    // 主题切换（与主站同键 localStorage，跨页保持一致；不读语言，本页中文）
    var themeBtn = document.querySelector('[data-theme-toggle]');
    if (themeBtn) {
      themeBtn.addEventListener('click', function () {
        var cur = (document.documentElement.getAttribute('data-theme') === 'dark') ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', cur);
        try { localStorage.setItem('github-rank-theme', cur); } catch (e) { /* 忽略 */ }
        var meta = document.getElementById('themeColorMeta');
        if (meta) { meta.setAttribute('content', (cur === 'dark') ? '#0d1117' : '#ffffff'); }
      });
    }

    var todayKey = beijingDateKey(new Date());
    Promise.all([
      readCounter('all'),
      readCounter('d.' + todayKey),
      readCounter('all.daily'),
      readCounter('all.weekly'),
      readCounter('all.monthly')
    ]).then(function (r) {
      renderSummary({
        all: r[0].value, today: r[1].value,
        daily: r[2].value, weekly: r[3].value, monthly: r[4].value
      });
      var failed = r.filter(function (x) { return x.ok === false; }).length;
      setText('statsNote', failed > 0
        ? '实时数据读取超时或失败（显示「—」表示取不到），不影响每日明细。本页不计入访问量。'
        : '实时数据来自第三方计数服务（只读，不计入访问量）。');
    });

    loadArchive().then(function (arch) {
      if (arch && arch.days) {
        renderTable(arch.days);
        var gen = arch.generatedAt ? new Date(arch.generatedAt).toLocaleString('zh-CN') : '';
        setText('archiveNote',
          '以上为每日归档快照，由 CI 每日抓取（北京时间 08:00 更新），随代码版本化留存。' +
          (gen ? '最近一次归档：' + gen + '。' : '') +
          '「页面访问」为当日访问量；日/周/月为各榜期被查看次数（含首屏与页内切榜，故三者之和 ≥ 页面访问）。');
      } else {
        setText('archiveNote', '归档数据暂不可用，请稍后重试。');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
