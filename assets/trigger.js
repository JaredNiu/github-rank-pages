/* trigger.html —— 手动触发 update-rank 工作流。
 *
 * 只在用户**点击按钮**时才访问 GitHub Actions 接口：
 *   POST /repos/<owner>/<repo>/actions/workflows/<workflow>/dispatches   （触发）
 *   GET  /repos/<owner>/<repo>/actions/workflows/<workflow>/runs          （查运行）
 * 本页完全不碰访问统计（不调 /hit/），因此打开它不计入访问量。
 *
 * 令牌只保存在用户本机的 localStorage，绝不写进仓库、也绝不发给 GitHub 以外的任何地方。
 */
(function () {
  'use strict';

  var OWNER = 'JaredNiu';
  var REPO = 'github-rank-pages';
  // workflow_id 可以直接用工作流文件名（带 .yml），比数字 id 稳定
  var WORKFLOW = 'update-rank.yml';
  var TOKEN_KEY = 'github-rank-trigger-token';
  var API = 'https://api.github.com';

  function el(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  /* ---------------- 主题切换（与主站同键，跨页保持一致） ---------------- */
  function initTheme() {
    var btn = document.querySelector('[data-theme-toggle]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var cur = (document.documentElement.getAttribute('data-theme') === 'dark') ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', cur);
      try { localStorage.setItem('github-rank-theme', cur); } catch (e) { /* 忽略 */ }
      var meta = document.getElementById('themeColorMeta');
      if (meta) meta.setAttribute('content', cur === 'dark' ? '#0d0d0d' : '#ffffff');
    });
  }

  /* ---------------- GitHub 请求 ---------------- */
  function gh(path, opts) {
    opts = opts || {};
    var ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, opts.timeout || 15000) : null;
    var headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
    if (opts.body) headers['Content-Type'] = 'application/json';

    return fetch(API + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body || undefined,
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (timer) clearTimeout(timer);
      return r;
    }, function (e) {
      if (timer) clearTimeout(timer);
      throw e;
    });
  }

  function errText(r) {
    var map = {
      401: '令牌无效或已过期，请重新生成。',
      403: '令牌权限不足（需要 Actions 写权限），或已被 GitHub 限速。',
      404: '找不到该工作流或分支，请确认仓库、分支名是否正确。'
    };
    if (map[r.status]) return map[r.status];
    return 'GitHub 返回 ' + r.status + '。';
  }

  /* ---------------- 状态渲染 ---------------- */
  var STATUS_TEXT = {
    queued: '排队中',
    waiting: '等待中',
    requested: '已请求',
    pending: '排队中',
    in_progress: '运行中'
  };
  var CONCLUSION_TEXT = {
    success: '成功',
    failure: '失败',
    cancelled: '已取消',
    skipped: '已跳过',
    timed_out: '超时',
    action_required: '需要人工处理',
    neutral: '中性',
    startup_failure: '启动失败'
  };

  function runLine(run) {
    var cls = 'queued';
    var text;
    if (run.status === 'completed') {
      cls = run.conclusion || 'success';
      text = CONCLUSION_TEXT[run.conclusion] || (run.conclusion || '完成');
    } else {
      cls = run.status;
      text = STATUS_TEXT[run.status] || run.status;
    }
    var dot = '<span class="trig-dot ' + esc(cls) + '"></span>';
    var link = run.html_url
      ? ' <a href="' + esc(run.html_url) + '" target="_blank" rel="noopener noreferrer">#' + esc(run.run_number || '') + ' 查看</a>'
      : '';
    return '<div>' + dot + esc(text) + link + '</div>';
  }

  /* ---------------- 触发并跟踪 ---------------- */
  function fire() {
    var token = (el('tok').value || '').trim();
    var ref = (el('ref').value || '').trim() || 'main';
    var status = el('status');
    var btn = el('fire');

    if (!token) {
      status.innerHTML = '<span class="bad">请先填入 GitHub 令牌。</span>';
      el('tok').focus();
      return;
    }

    // 记住 / 忘记令牌
    try {
      if (el('remember').checked) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* 隐私模式忽略 */ }

    btn.disabled = true;
    status.innerHTML = '正在触发…';

    var dispatchedAt = new Date().toISOString();

    gh('/repos/' + OWNER + '/' + REPO + '/actions/workflows/' + WORKFLOW + '/dispatches', {
      method: 'POST',
      token: token,
      body: JSON.stringify({ ref: ref }),
      timeout: 15000
    }).then(function (r) {
      if (r.status === 204) {
        status.innerHTML = '<span class="ok">已触发</span>，正在等待运行出现…';
        return findRun(token, dispatchedAt);
      }
      if (!r.ok) {
        if (r.status === 403 && r.headers.get('X-RateLimit-Remaining') === '0') {
          throw new Error('已被 GitHub 限速，请稍后再试。');
        }
        throw new Error(errText(r));
      }
      return findRun(token, dispatchedAt);
    }).then(function (run) {
      if (!run) {
        status.innerHTML = '<span class="ok">已触发</span>，但暂时没查到新运行（GitHub  indexing  有延迟）。' +
          '请稍后到 <a href="https://github.com/' + OWNER + '/' + REPO + '/actions" target="_blank" rel="noopener noreferrer">Actions 页面</a> 确认。';
        btn.disabled = false;
        return;
      }
      return trackRun(token, run);
    }).catch(function (e) {
      var msg = (e && e.name === 'AbortError') ? '请求超时，请重试。' : ((e && e.message) || '触发失败。');
      status.innerHTML = '<span class="bad">' + esc(msg) + '</span>';
      btn.disabled = false;
    });
  }

  // 触发后 run 不会立刻出现，轮询等它冒出来（最多约 30 秒）
  function findRun(token, sinceIso) {
    var path = '/repos/' + OWNER + '/' + REPO + '/actions/workflows/' + WORKFLOW + '/runs?per_page=5';
    var attempts = 0;
    function step() {
      attempts++;
      return gh(path, { token: token, timeout: 12000 }).then(function (r) {
        if (!r.ok) throw new Error(errText(r));
        return r.json();
      }).then(function (d) {
        var runs = (d && d.workflow_runs) || [];
        for (var i = 0; i < runs.length; i++) {
          if (runs[i].created_at && runs[i].created_at >= sinceIso) return runs[i];
        }
        if (attempts >= 10) return null;
        return wait(3000).then(step);
      });
    }
    return wait(2000).then(step);
  }

  // 跟踪到结束为止（最多约 8 分钟，之后交给用户去 GitHub 看）
  function trackRun(token, run) {
    var status = el('status');
    var btn = el('fire');
    status.innerHTML = '<span class="ok">已触发</span>' + runLine(run);

    var attempts = 0;
    function step() {
      attempts++;
      return gh('/repos/' + OWNER + '/' + REPO + '/actions/runs/' + run.id, {
        token: token, timeout: 12000
      }).then(function (r) {
        if (!r.ok) throw new Error(errText(r));
        return r.json();
      }).then(function (cur) {
        status.innerHTML = '<span class="ok">已触发</span>' + runLine(cur);
        if (cur.status === 'completed') {
          var ok = cur.conclusion === 'success';
          status.innerHTML += ok
            ? '<div>抓取完成，数据已提交，站点会在部署后更新。</div>'
            : '<div><span class="bad">本次运行未成功</span>，建议打开上面的链接看日志。</div>';
          btn.disabled = false;
          return;
        }
        if (attempts >= 96) { // 96 × 5s = 8 分钟
          status.innerHTML += '<div>仍在运行，不再轮询了，请到 GitHub 查看最终结果。</div>';
          btn.disabled = false;
          return;
        }
        return wait(5000).then(step);
      });
    }
    return wait(3000).then(step);
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    initTheme();

    var saved = '';
    try { saved = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { /* 忽略 */ }
    if (saved) {
      el('tok').value = saved;
      el('remember').checked = true;
    }

    el('fire').addEventListener('click', fire);

    el('forget').addEventListener('click', function () {
      try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* 忽略 */ }
      el('tok').value = '';
      el('remember').checked = false;
      el('status').innerHTML = '已清除本机保存的令牌。';
    });

    // 回车即触发
    el('tok').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') fire();
    });
    el('ref').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') fire();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
