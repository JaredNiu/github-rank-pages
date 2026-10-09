/* ==========================================================================
 * GitHub 开源项目榜单 · 前端逻辑（原生 JS，无构建、无依赖）
 *  - 日榜 / 周榜 / 月榜 Tab 切换（同步 history hash）
 *  - 中 / 英 界面语言切换，选择写入 localStorage
 *  - 深 / 浅色主题切换，选择写入 localStorage
 *  - 标签筛选（标签由 scripts/fetch_rank.py 依据仓库实际内容生成）
 *  - 滚动到底部时实时拉取下一片数据（data/pages/<period>/N.json）
 *  - 历史归档浏览：每次抓取的榜单都留档，可按周期翻看往日快照
 *    （索引 data/archive/index.json，快照 data/<period>/<日期>.json，
 *     深链 #<period>@<快照名>，例如 #daily@2026-10-08）
 *    · 常驻一行语义芯片（最新 / 昨日 / 上周 / 上月 …），选中态反色填充
 *    · 期数多于 HISTORY_INLINE_MAX 时多一个「全部 N 期」，打开跨周期面板
 * ========================================================================== */
(function () {
  'use strict';

  var PERIODS = ['daily', 'weekly', 'monthly'];
  var DEFAULT_PERIOD = 'daily';
  var DEFAULT_PAGE_SIZE = 6;
  var LANG_KEY = 'github-rank-lang';
  var THEME_KEY = 'github-rank-theme';
  var LIGHT_CANVAS = '#ffffff';
  var DARK_CANVAS = '#0d1117';
  /* 历史归档索引：只列「有哪些天的快照」，点了哪一天才去取哪一天的文件 */
  var HISTORY_URL = 'data/archive/index.json';

  /* 每个周期「实时榜 updatedAt」这一判据的三态。
   * 历史行是否要剔除某期，取决于「该期 updatedAt 是否等于实时榜 updatedAt」。
   * 判据未知时**不能猜**：把"还不知道"当成"确认不同源"会在首帧把还没到判据的周期
   * 当成真历史渲染出来，判据一到又撤掉 —— 元素闪出再消失，比数字略慢更糟。 */
  var LIVE_PENDING = 'pending';   // 判据还在路上：该周期暂不参与渲染（不出芯片 / 不计入 N / 不进面板）
  var LIVE_DONE = 'done';         // 判据已定：有值则按值过滤；无值则退化为不过滤
  /* 兜底放弃：判据等太久（见 LIVE_FALLBACK_MS），等同"确认拿不到"，且**此后不再接受迟到值**。
   * 它与 DONE-无值 的展示效果相同（都不过滤），差别只在：ABANDONED 是一道**单向闸门** ——
   * 一旦放弃，迟到的 updatedAt 一律作废，绝不回头把已经渲染出来的期再撤掉（晚到反转）。 */
  var LIVE_ABANDONED = 'abandoned';
  /* 兜底：首屏起这么久后，把任何仍是 pending 的周期强制标记为"放弃"并落定，
   * 避免某个索引请求挂住时历史行永久停在占位态（那比闪动严重得多）。 */
  var LIVE_FALLBACK_MS = 3000;

  /* ------------------------------ 多语言文案 ------------------------------ */

  var I18N = {
    zh: {
      htmlLang: 'zh-CN',
      title: 'GitHub 开源项目榜单 · 日榜 / 周榜 / 月榜',
      brandTitle: 'GitHub 开源项目榜单',
      brandSub: '发现近 24 小时 / 上周 / 上月最值得关注的开源项目',
      tabs: { daily: '日榜', weekly: '周榜', monthly: '月榜' },
      increment: { daily: '近 24 小时新增', weekly: '上周新增', monthly: '上月新增' },
      growthUnknown: '增幅待考',
      all: '全部',
      updatedAt: '数据更新于',
      loading: '加载中…',
      createdAt: '创建于',
      pushedAt: '更新于',
      noDesc: '暂无描述',
      star: 'star',
      fork: 'fork',
      endSuffix: '已经到底了 · 共',
      endUnit: '个项目',
      errTitle: '数据加载失败',
      errHint: '请稍后重试，或到仓库中手动触发 update-rank 工作流重新抓取数据。',
      fileHint: '检测到你正通过 file:// 直接打开页面，浏览器会拦截本地 JSON 读取。请在项目根目录执行 python3 -m http.server 8000 后访问 http://localhost:8000。',
      filterEmpty: '该标签下暂无项目',
      footerSource: '数据来源：<a href="https://github.com/trending" target="_blank" rel="noopener noreferrer">GitHub Trending</a> ＋ <a href="https://docs.github.com/rest" target="_blank" rel="noopener noreferrer">GitHub REST API</a> 补全元信息',
      footerNote: '由 GitHub Actions 定时抓取并自动部署到 GitHub Pages · 每日北京时间 08:30 更新',
      detail: '详情',
      close: '关闭',
      secDesc: '完整描述',
      secTags: '标签',
      secTopics: '主题',
      secMeta: '项目信息',
      noDescFull: '该项目未填写描述',
      lbRank: '榜单排名',
      lbLanguage: '语言',
      lbStars: 'Star 总数',
      lbForks: 'Fork 数',
      lbGrowth: '周期新增',
      lbCreated: '创建时间',
      lbPushed: '最近推送',
      lbLicense: '开源协议',
      lbNoLicense: '未标注',
      lbHomepage: '主页',
      lbBranch: '默认分支',
      lbOwnerType: '归属',
      lbOwnerUser: '个人账号',
      lbOwnerOrg: '组织',
      lbUpdated: '更新时间',
      flagArchived: '已归档',
      flagFork: 'Fork',
      statStars: 'Star',
      statForks: 'Fork',
      statGrowth: '周期新增',
      statWatchers: 'Watch',
      statIssues: 'Issue',
      statSize: '体积',
      openOnGithub: '在 GitHub 打开',
      themeToDark: '切换到深色',
      themeToLight: '切换到浅色',
      historyLabel: '历史',
      historyLatest: '最新',
      historyEmpty: '暂无更早的快照',
      historyDupOnly: '暂无更早的归档',
      historyAll: '全部',
      historyAllUnit: ' 期',
      historyPopTitle: '全部归档',
      revisionNote: '含 {n} 次重抓留底',
      snapshotWord: '快照',
      rangeLabel: '统计范围',
      tipItems: '个条目',
      agoToday: '今天',
      agoYesterday: '昨日',
      agoDayBefore: '前天',
      dayAgo: '天前',
      agoLastWeek: '上周',
      weekAgo: '周前',
      agoLastMonth: '上月',
      monthAgo: '个月前'
    },
    en: {
      htmlLang: 'en',
      title: 'GitHub Trending Repos · Daily / Weekly / Monthly',
      brandTitle: 'GitHub Trending Repos',
      brandSub: 'The open-source projects worth watching in the last 24 hours, last week and last month',
      tabs: { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' },
      increment: { daily: 'last 24h', weekly: 'last week', monthly: 'last month' },
      growthUnknown: 'growth n/a',
      all: 'All',
      updatedAt: 'Updated',
      loading: 'Loading…',
      createdAt: 'Created',
      pushedAt: 'Pushed',
      noDesc: 'No description',
      star: 'stars',
      fork: 'forks',
      endSuffix: 'End of list ·',
      endUnit: 'repos',
      errTitle: 'Failed to load data',
      errHint: 'Please retry later, or trigger the update-rank workflow manually in the repository.',
      fileHint: 'You opened this page via file://, so the browser blocks local JSON reads. Run python3 -m http.server 8000 in the project root and visit http://localhost:8000.',
      filterEmpty: 'No repos under this tag',
      footerSource: 'Source: <a href="https://github.com/trending" target="_blank" rel="noopener noreferrer">GitHub Trending</a> enriched by the <a href="https://docs.github.com/rest" target="_blank" rel="noopener noreferrer">GitHub REST API</a>',
      footerNote: 'Fetched by GitHub Actions and deployed to GitHub Pages · Updated daily at 08:30 (UTC+8)',
      detail: 'Details',
      close: 'Close',
      secDesc: 'Description',
      secTags: 'Tags',
      secTopics: 'Topics',
      secMeta: 'Details',
      noDescFull: 'No description provided',
      lbRank: 'Rank',
      lbLanguage: 'Language',
      lbStars: 'Stars',
      lbForks: 'Forks',
      lbGrowth: 'Growth',
      lbCreated: 'Created',
      lbPushed: 'Last push',
      lbLicense: 'License',
      lbNoLicense: 'Not specified',
      lbHomepage: 'Homepage',
      lbBranch: 'Default branch',
      lbOwnerType: 'Owner',
      lbOwnerUser: 'User',
      lbOwnerOrg: 'Organization',
      lbUpdated: 'Updated',
      flagArchived: 'Archived',
      flagFork: 'Fork',
      statStars: 'Stars',
      statForks: 'Forks',
      statGrowth: 'Growth',
      statWatchers: 'Watchers',
      statIssues: 'Open issues',
      statSize: 'Size',
      openOnGithub: 'Open on GitHub',
      themeToDark: 'Switch to dark',
      themeToLight: 'Switch to light',
      historyLabel: 'History',
      historyLatest: 'Latest',
      historyEmpty: 'No earlier snapshots',
      historyDupOnly: 'No earlier archives',
      historyAll: 'All',
      historyAllUnit: ' snapshots',
      historyPopTitle: 'All archives',
      revisionNote: 'includes {n} re-run backup(s)',
      snapshotWord: 'Snapshot',
      rangeLabel: 'Range',
      tipItems: 'repos',
      agoToday: 'today',
      agoYesterday: 'yesterday',
      agoDayBefore: '2 days ago',
      dayAgo: 'd ago',
      agoLastWeek: 'last week',
      weekAgo: 'w ago',
      agoLastMonth: 'last month',
      monthAgo: 'mo ago'
    }
  };

  /** 标签 key -> 中英文案（与脚本 TAG_RULES 的 key 一一对应） */
  var TAG_LABELS = {
    ai: { zh: 'AI', en: 'AI' },
    llm: { zh: '大模型', en: 'LLM' },
    agent: { zh: '智能体', en: 'Agent' },
    security: { zh: '安全', en: 'Security' },
    media: { zh: '多媒体', en: 'Media' },
    cli: { zh: '命令行', en: 'CLI' },
    web: { zh: '前端', en: 'Web' },
    mobile: { zh: '移动端', en: 'Mobile' },
    database: { zh: '数据库', en: 'Database' },
    devops: { zh: '部署运维', en: 'DevOps' },
    game: { zh: '游戏', en: 'Game' },
    data: { zh: '数据', en: 'Data' },
    devtool: { zh: '开发工具', en: 'Dev Tool' },
    docs: { zh: '文档', en: 'Docs' }
  };

  var LANGUAGE_COLORS = {
    TypeScript: '#3178c6', JavaScript: '#f1e05a', Python: '#3572A5', Java: '#b07219',
    Go: '#00ADD8', Rust: '#dea584', 'C++': '#f34b7d', C: '#555555', 'C#': '#178600',
    Ruby: '#701516', PHP: '#4F5D95', Swift: '#F05138', Kotlin: '#A97BFF', Dart: '#00B4AB',
    Shell: '#89e051', HTML: '#e34c26', CSS: '#563d7c', Vue: '#41b883', Svelte: '#ff3e00',
    'Jupyter Notebook': '#DA5B0B', Scala: '#c22d40', Lua: '#000080', Perl: '#0298c3',
    R: '#198CE7', 'Objective-C': '#438eff', Elixir: '#6e4a7e', Haskell: '#5e5086',
    Zig: '#ec915c', Nim: '#ffc200', Solidity: '#AA6746', Astro: '#ff5a03', MDX: '#fcb32c'
  };
  var DEFAULT_COLOR = '#8c959f';

  var ICON = {
    star: '<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"></path></svg>',
    fork: '<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z"></path></svg>',
    flame: '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M8.5 1.5c.3 1.6-.3 2.7-1.2 3.6-.9.9-2 1.7-2 3.3a3.2 3.2 0 0 0 .6 1.9c.3-.6.5-1.2.5-1.9 0-.9-.2-1.7-.5-2.4.8.5 1.6 1.4 1.9 2.4.4-.5.7-1.2.7-2 0-1.6-.9-2.9-1.4-3.7-.5-.8-.8-1.5-.8-2.2a5.9 5.9 0 0 0-3.3 5.3c0 1.2.4 2.3 1 3.2-.1-.4-.2-.8-.2-1.2 0-1.3.6-2.4 1.4-3.3.3 1 .9 1.8 1.6 2.4-.3 1.6.2 3.2 1.5 4.3 1.8 1.5 4.4 1.4 6-.3.6-.7.9-1.6.9-2.5 0-3-2.4-5.3-5.7-5.9Z"></path></svg>',
    clock: '<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0Zm0 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm.75 3.25v3.5h2.5a.75.75 0 0 1 0 1.5H8a.75.75 0 0 1-.75-.75v-4.25a.75.75 0 0 1 1.5 0Z"></path></svg>',
    caret: '<svg class="hchip-caret" viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.6 4.5 6 7.9l3.4-3.4"/></svg>'
  };

  var dom = {
    tabs: document.getElementById('tabs'),
    board: document.getElementById('board'),
    tagBar: document.getElementById('tagBar'),
    historyBar: document.getElementById('historyBar'),
    historyPop: document.getElementById('historyPop'),
    sentinel: document.getElementById('sentinel'),
    skeletons: document.getElementById('skeletons'),
    feedEnd: document.getElementById('feedEnd'),
    updateBadge: document.getElementById('updateBadge'),
    updateTime: document.getElementById('updateTime'),
    brandTitle: document.getElementById('brandTitle'),
    brandSub: document.getElementById('brandSub'),
    footerSource: document.getElementById('footerSource'),
    footerNote: document.getElementById('footerNote'),
    langSwitch: document.getElementById('langSwitch'),
    drawer: document.getElementById('drawer'),
    drawerMask: document.getElementById('drawerMask'),
    drawerTitle: document.getElementById('drawerTitle'),
    drawerBody: document.getElementById('drawerBody'),
    drawerClose: document.getElementById('drawerClose')
  };

  var state = {
    period: DEFAULT_PERIOD,
    lang: 'zh',
    theme: 'light',
    feeds: {},        // 每个榜单各自维护已加载页与当前标签
    drawerItem: null, // 抽屉当前展示的条目（切换语言时按新语言重绘）
    lastFocus: null,  // 打开抽屉前的焦点元素，关闭后归还
    history: null,    // data/archive/index.json 的 types 段；null = 尚未拉到
    historyPromise: null,
    historyError: null,
    // 实时榜索引的 updatedAt（data/pages/<period>/index.json），每个周期一份。
    // 归档索引里某期的 updatedAt 与它相同 ⇒ 该期与「最新」出自**同一次抓取**，
    // 结构上必然逐条相同，历史行必须把它剔除，否则点进去一字不差。
    // 刻意不复用 feed.index.updatedAt：看快照时 fetchSnapshot 会把 feed.index
    // 覆盖成那一天的元信息，那时 feed.index.updatedAt 已不是实时榜的值。
    // 只经 recordLiveUpdatedAt() 写入（loadIndex 与 ensureLiveUpdatedAt 两条来源），
    // 写入值发生变化就触发一次历史行重画。
    liveUpdatedAt: { daily: null, weekly: null, monthly: null },
    // 上面那份 updatedAt 的「判据状态」——四态是 pending / done / abandoned。见 LIVE_PENDING 的说明。
    // 收敛单向：pending → done（或 → abandoned），done ↛ pending、abandoned 不复活。
    liveStatus: { daily: LIVE_PENDING, weekly: LIVE_PENDING, monthly: LIVE_PENDING },
    // 每周期最多一个在飞的「补 updatedAt」请求，保证 ensureLiveUpdatedAt 幂等、可重入
    livePromise: { daily: null, weekly: null, monthly: null },
    // 首屏兜底定时器句柄（只起一次）
    liveFallbackTimer: null
  };

  /* ------------------------------- 工具函数 ------------------------------- */

  function esc(value) {
    if (value === null || value === undefined) { return ''; }
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function t() { return I18N[state.lang] || I18N.zh; }

  /**
   * 切换深浅色主题：同步 <html data-theme>、主题色 meta 与两个开关的文案。
   * @param {string} theme 'light' | 'dark'
   * @param {boolean} [persist] 是否写入 localStorage（首屏沿用系统偏好时不写）
   */
  function setTheme(theme, persist) {
    state.theme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', state.theme);
    if (persist !== false) {
      try { localStorage.setItem(THEME_KEY, state.theme); } catch (e) { /* 隐私模式忽略 */ }
    }
    var meta = document.getElementById('themeColorMeta');
    if (meta) {
      meta.setAttribute('content', state.theme === 'dark' ? DARK_CANVAS : LIGHT_CANVAS);
    }
    paintThemeButtons();
  }

  /** 头部与抽屉内各有一个主题开关，统一刷新可访问名称与按下态 */
  function paintThemeButtons() {
    var strings = t();
    var label = state.theme === 'dark' ? strings.themeToLight : strings.themeToDark;
    var buttons = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-label', label);
      buttons[i].setAttribute('title', label);
      buttons[i].setAttribute('aria-pressed', state.theme === 'dark' ? 'true' : 'false');
    }
  }

  function fmtNumber(value) {
    var num = Number(value);
    if (!isFinite(num)) { return '0'; }
    return num.toLocaleString('en-US');
  }

  function langColor(language) {
    return language ? (LANGUAGE_COLORS[language] || DEFAULT_COLOR) : DEFAULT_COLOR;
  }

  /**
   * 人类可读的仓库体积。
   * @param {number} kb 体积（KB）
   * @returns {string} 如 "742 KB" / "12.4 MB" / "1.3 GB"；无效输入返回 ''
   */
  function fmtSize(kb) {
    var num = Number(kb);
    if (!kb || !isFinite(num) || num <= 0) { return ''; }
    if (num < 1024) { return Math.round(num) + ' KB'; }
    if (num < 1048576) { return (num / 1024).toFixed(1) + ' MB'; }
    return (num / 1048576).toFixed(1) + ' GB';
  }

  /**
   * 取 URL 的主机名：去掉协议、www. 前缀与路径 / 查询 / hash。
   * @param {string} url
   * @returns {string} 主机名；无法解析时返回 ''
   */
  function hostOf(url) {
    if (!url) { return ''; }
    try {
      var host = String(url).replace(/^[a-zA-Z][a-zA-Z0-9+.\-]*:\/\//, '');
      host = host.replace(/^www\./i, '');
      host = host.split(/[\/?#]/)[0];
      return host || '';
    } catch (e) {
      return '';
    }
  }

  /**
   * 账号归属标签。
   * @param {string} raw "User" / "Organization"
   * @returns {string} 本地化文案；其他非空值原样返回，空值返回 ''
   */
  function ownerTypeLabel(raw) {
    if (!raw) { return ''; }
    if (raw === 'User') { return t().lbOwnerUser; }
    if (raw === 'Organization') { return t().lbOwnerOrg; }
    return raw;
  }

  function tagLabel(key) {
    var entry = TAG_LABELS[key];
    if (entry) { return entry[state.lang] || entry.zh; }
    return key.charAt(0).toUpperCase() + key.slice(1);
  }

  /**
   * 相对时间描述。
   * @param {string} dateStr YYYY-MM-DD
   * @returns {string} 已按当前界面语言本地化的描述
   */
  function relativeDate(dateStr) {
    if (!dateStr) { return ''; }
    var date = new Date(dateStr + 'T00:00:00Z');
    if (isNaN(date.getTime())) { return String(dateStr); }
    var days = Math.floor((Date.now() - date.getTime()) / 86400000);
    if (state.lang === 'en') {
      if (days <= 0) { return 'today'; }
      if (days === 1) { return 'yesterday'; }
      if (days < 30) { return days + ' days ago'; }
      if (days < 365) { return Math.floor(days / 30) + ' months ago'; }
      return Math.floor(days / 365) + ' years ago';
    }
    if (days <= 0) { return '今天'; }
    if (days === 1) { return '昨天'; }
    if (days < 30) { return days + ' 天前'; }
    if (days < 365) { return Math.floor(days / 30) + ' 个月前'; }
    return Math.floor(days / 365) + ' 年前';
  }

  function formatUpdatedAt(iso) {
    if (!iso) { return t().loading; }
    var date = new Date(iso);
    if (isNaN(date.getTime())) { return String(iso); }
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    var stamp = date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
      ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
    return t().updatedAt + ' ' + stamp;
  }

  function newFeed() {
    return {
      index: null,        // data/pages/<period>/index.json
      allItems: [],       // 已从网络拉取到的条目
      filtered: null,     // 标签筛选后的条目（null 表示未筛选）
      tag: '',            // 当前榜单选中的标签（各榜独立，切榜不串台）
      rendered: 0,        // 已渲染进 DOM 的条数
      loadedPages: 0,
      totalPages: 0,
      pageSize: DEFAULT_PAGE_SIZE,
      loading: false,       // 是否有一片正在路上
      indexPromise: null,   // 进行中的索引请求，供并发调用复用
      singleFile: null,     // 整份数据（回退模式或历史快照），有它时按页在本地切
      snapshot: null,       // 当前查看的历史快照；null = 看最新榜单
      epoch: 0,             // 世代号：每次 resetFeed 自增，用于丢弃过期响应
      done: false,
      error: null
    };
  }

  function feedOf(period) {
    if (!state.feeds[period]) { state.feeds[period] = newFeed(); }
    return state.feeds[period];
  }

  /**
   * 就地清空某个榜单的加载状态，但**保留同一个对象引用**。
   *
   * 必须原地改而不是 feedOf() 换一个新对象：loadIndex / loadPage 里都闭包捕获了
   * 当时那个 feed，替换掉之后它们继续往旧对象上写，界面就再也刷不出来了。
   *
   * 同时把 epoch（世代号）自增：切换快照 / 切回最新时，上一个来源的分页请求可能
   * 还在路上，回来后会往这个已被重置的 feed 上写，把 loadedPages、allItems、
   * totalPages 搅成两份数据的混合体（表现是"切过去只渲染了 6 条，怎么滚都不再加载"）。
   * epoch 变了就让过期响应自己作废。
   *
   * epoch 必须从旧值推出来，不能在拷贝 newFeed() 时被归零 ——
   * 否则连续两次 reset 会得到同一个世代号，过期判断就失效了。
   *
   * @param {string} period 周期 key
   * @returns {Object} 同一个 feed 对象
   */
  function resetFeed(period) {
    var feed = feedOf(period);
    var epoch = (feed.epoch || 0) + 1;
    var fresh = newFeed();
    for (var key in fresh) {
      if (Object.prototype.hasOwnProperty.call(fresh, key)) { feed[key] = fresh[key]; }
    }
    feed.epoch = epoch;
    return feed;
  }

  /* -------------------------------- 数据加载 ------------------------------ */

  function fetchJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (response) {
      if (!response.ok) { throw new Error('HTTP ' + response.status); }
      return response.json();
    });
  }

  /**
   * 读取分页索引；若 data/pages 不存在（旧数据）则回退到整份榜单文件。
   * @param {string} period 周期 key
   * @returns {Promise<Object>} feed
   */
  function loadIndex(period) {
    var feed = feedOf(period);
    if (feed.index) { return Promise.resolve(feed); }
    // 同一榜单的并发调用（首屏 + 后台预取）复用同一个进行中的请求
    if (feed.indexPromise) { return feed.indexPromise; }

    var epoch = feed.epoch;
    feed.loading = true;
    if (period === state.period) { paintChrome(); }
    feed.indexPromise = fetchJson('data/pages/' + period + '/index.json')
      .then(function (index) {
        if (feed.epoch !== epoch) { return feed; }
        feed.index = index;
        feed.pageSize = index.pageSize || DEFAULT_PAGE_SIZE;
        feed.totalPages = index.totalPages || 1;
        recordLiveUpdatedAt(period, index.updatedAt);
        return feed;
      })
      .catch(function () {
        // 回退：直接用整份榜单，客户端按默认片大小切分
        return fetchJson('data/' + period + '.json').then(function (board) {
          if (feed.epoch !== epoch) { return feed; }
          var items = Array.isArray(board.items) ? board.items : [];
          feed.index = {
            period: period,
            updatedAt: board.updatedAt,
            pageSize: DEFAULT_PAGE_SIZE,
            totalPages: Math.max(1, Math.ceil(items.length / DEFAULT_PAGE_SIZE)),
            total: items.length,
            tagCounts: board.tagCounts || {}
          };
          feed.pageSize = DEFAULT_PAGE_SIZE;
          feed.totalPages = feed.index.totalPages;
          feed.singleFile = board;
          recordLiveUpdatedAt(period, feed.index.updatedAt);
          return feed;
        });
      })
      .then(function (result) {
        if (feed.epoch !== epoch) { return feed; }
        feed.indexPromise = null;
        feed.loading = false;
        // 后台预取其他榜单时不刷新当前界面。
        // 历史行**不由这里重画**：它的判据（liveUpdatedAt）一变就由 recordLiveUpdatedAt()
        // 的脏检查经 repaintHistory() 统一触发，与"是哪个周期在加载"无关。
        // 在这里补一行看似无害，但会额外引入一个"调用方记得重画"的触发点，
        // 掩盖真正的判据驱动链路，使针对该链路的变异测试失去分辨力。
        if (period === state.period) { renderTagBar(); paintChrome(); }
        return result;
      })
      .catch(function (error) {
        if (feed.epoch !== epoch) { return feed; }
        feed.indexPromise = null;
        feed.loading = false;
        feed.error = error && error.message ? error.message : String(error);
        if (period === state.period) { paintChrome(); renderBoard(); }
        return feed;
      });

    return feed.indexPromise;
  }

  /**
   * 拉取指定页（1 基）的内容并追加到已加载条目里。
   * @param {string} period 周期 key
   * @param {number} page 页码
   * @returns {Promise<boolean>} 是否拉到了新条目
   */
  function loadPage(period, page) {
    var feed = feedOf(period);
    if (feed.loading) { return Promise.resolve(false); }
    // 记住发起时的世代号：回来时若这个榜已被重置（切了快照 / 切回最新），
    // 这次结果属于上一个来源，必须整个丢掉，否则会把两份数据混进同一个 feed。
    var epoch = feed.epoch;
    feed.loading = true;
    showSkeleton(period, true);

    var task;
    if (feed.singleFile) {
      // 回退模式：从整份数据里切出这一片，仍然是一片一片地"拉取"
      task = Promise.resolve().then(function () {
        var items = Array.isArray(feed.singleFile.items) ? feed.singleFile.items : [];
        var start = (page - 1) * feed.pageSize;
        return { items: items.slice(start, start + feed.pageSize), total: items.length };
      });
    } else {
      task = fetchJson('data/pages/' + period + '/' + page + '.json');
    }

    return task.then(function (payload) {
      if (feed.epoch !== epoch) { return false; }
      feed.loading = false;
      showSkeleton(period, false);
      var items = payload && Array.isArray(payload.items) ? payload.items : [];
      feed.allItems = feed.allItems.concat(items);
      feed.loadedPages = Math.max(feed.loadedPages, page);
      if (payload && payload.totalPages) { feed.totalPages = payload.totalPages; }
      if (feed.loadedPages >= feed.totalPages) { feed.done = true; }
      // 后台预取的榜单不碰当前界面，等用户真切过去时再画
      if (period === state.period) { renderBoard(); }
      return items.length > 0;
    }).catch(function (error) {
      if (feed.epoch !== epoch) { return false; }
      feed.loading = false;
      showSkeleton(period, false);
      feed.error = error && error.message ? error.message : String(error);
      if (period === state.period) { renderBoard(); }
      return false;
    });
  }

  /**
   * 标签筛选需要完整数据集，这里把剩余页依次拉完。
   * @param {string} period 周期 key
   * @returns {Promise<void>}
   */
  function ensureAllPages(period) {
    var feed = feedOf(period);
    var chain = Promise.resolve();
    for (var page = feed.loadedPages + 1; page <= feed.totalPages; page++) {
      chain = chain.then(makePageLoader(period, page));
    }
    return chain;
  }

  function makePageLoader(period, page) {
    return function () { return loadPage(period, page); };
  }

  /**
   * 首屏稳定后，后台把其余两个榜单的索引与第一片悄悄拉下来。
   * 这样用户切榜时数据已经在内存里，switchPeriod 直接 renderBoard()，
   * 不会出现"清空 → 骨架 → 回填"的中间态 —— 那正是首屏切榜抖动与闪白的来源。
   * 预取失败不影响后续：真切过去时会重新拉一次。
   * @returns {Promise<void>}
   */
  function prefetchOthers() {
    var chain = Promise.resolve();
    PERIODS.forEach(function (period) {
      if (period === state.period) { return; }
      chain = chain.then(function () {
        var feed = feedOf(period);
        if (feed.loadedPages > 0 || feed.loading) { return null; }
        // 正在看历史快照的榜不预取：它的 allItems 属于那一天，
        // 预取最新数据会把「看快照」的状态和「最新」的内容混进同一个 feed。
        // 这种榜切过去时按需拉取即可（snapshot 分支会处理）。
        if (feed.snapshot) { return null; }
        return loadIndex(period).then(function () {
          if (feed.error) { return null; }
          return loadPage(period, 1);
        });
      });
    });
    return chain;
  }

  /**
   * 让某周期的「实时榜 updatedAt」判据从 pending 收敛到 done（**幂等、可重入**）。
   *
   * 两种触发场景：
   *   1. 首屏对**三个周期**各发一次，让判据尽快并行到位（别等 prefetchOthers 串行加载）；
   *   2. 深链到某天快照时，当前周期走 fetchSnapshot 不走 loadIndex，需要它单独补齐。
   *
   * 只读出索引里的 updatedAt 交给 recordLiveUpdatedAt()（写入 + 触发重画都在那一处）；
   * 请求成功但没值 / 请求失败，都视为"确认拿不到"，落 done（退化为不过滤）。
   *
   * 之所以另起一次请求而不是复用 loadIndex：loadIndex 会把 feed.index 覆盖成实时榜
   * 的元信息，那会把当前正在看的快照的统计范围 / 更新徽标冲掉。
   *
   * @param {string} period 周期 key
   * @returns {Promise<void>}
   */
  function ensureLiveUpdatedAt(period) {
    if (state.liveStatus[period] !== LIVE_PENDING) { return Promise.resolve(); }
    if (state.livePromise[period]) { return state.livePromise[period]; }
    state.livePromise[period] = fetchJson('data/pages/' + period + '/index.json')
      .then(function (index) {
        state.livePromise[period] = null;
        recordLiveUpdatedAt(period, index && index.updatedAt);
      })
      .catch(function () {
        state.livePromise[period] = null;
        markLiveDone(period);   // 请求失败 ⇒ 确认拿不到，别把该周期永久留在 pending
      });
    return state.livePromise[period];
  }

  /**
   * 首屏一次性把三个周期的判据都驱动起来，并起一个兜底定时器。
   *
   * 兜底：过了 LIVE_FALLBACK_MS 仍 pending 的周期一律标记为 **abandoned（放弃）** 并重画 ——
   * 万一某个索引请求挂住（既不成功也不失败），历史行才不会永久停在占位态。
   *
   * 注意这里打的是 ABANDONED 而不是 DONE：放弃是**单向闸门**，之后迟到的 updatedAt 一律作废
   * （见 recordLiveUpdatedAt 开头的拦截）。若只落 DONE，迟到的值还会改状态 → 触发重画 →
   * 把已经画出来的期再撤掉，就是"晚到反转"。展示效果上二者都是"不过滤"，但闸门语义不同。
   *
   * @returns {void}
   */
  function primeHistoryLiveState() {
    PERIODS.forEach(function (period) { ensureLiveUpdatedAt(period); });
    if (state.liveFallbackTimer) { return; }
    state.liveFallbackTimer = setTimeout(function () {
      state.liveFallbackTimer = null;
      var changed = false;
      PERIODS.forEach(function (period) {
        if (state.liveStatus[period] === LIVE_PENDING) {
          state.liveStatus[period] = LIVE_ABANDONED;   // 放弃：此后不再接受迟到值
          changed = true;
        }
      });
      if (changed) { repaintHistory(); }
    }, LIVE_FALLBACK_MS);
  }

  /* ------------------------------ 历史归档 ------------------------------ */

  /**
   * 拉一次归档索引并常驻内存。
   *
   * 索引只描述「有哪些天的快照」（一天一条，很小），点开具体某一天才去取那一天的
   * 完整文件 —— 历史功能绝不能把首屏拖慢。索引拉不到时整个历史功能降级为不可用，
   * 但**绝不影响主榜单**：state.history 置为 {} 而不是保持 null，
   * 避免每次切榜都去重试一个必然失败的请求。
   *
   * @returns {Promise<Object>} period -> {periodLabel, files: [...]}
   */
  function loadHistoryIndex() {
    if (state.history) { return Promise.resolve(state.history); }
    if (state.historyPromise) { return state.historyPromise; }
    state.historyPromise = fetchJson(HISTORY_URL)
      .then(function (doc) {
        state.historyPromise = null;
        state.history = (doc && doc.types) || {};
        renderHistoryBar();
        return state.history;
      })
      .catch(function (error) {
        state.historyPromise = null;
        state.historyError = error && error.message ? error.message : String(error);
        state.history = {};
        renderHistoryBar();
        return state.history;
      });
    return state.historyPromise;
  }

  function snapshotsOf(period) {
    var entry = state.history && state.history[period];
    return (entry && Array.isArray(entry.files)) ? entry.files : [];
  }

  function findSnapshot(period, name) {
    var list = snapshotsOf(period);
    for (var i = 0; i < list.length; i++) {
      if (list[i].name === name) { return list[i]; }
    }
    return null;
  }

  /**
   * 记下实时榜索引的 updatedAt，并把该周期从 pending 收敛到 done。
   *
   * 三个周期的判据是**陆续**到位的，而「全部 N 期」要跨三个周期求和 —— 判据未知的
   * 周期绝不能计入（否则首帧会说错话再自己纠正）。所以状态机是：pending → done。
   * done 之后值还可以变（脏检查），但如果只是值没变 / 状态没变，就不白重画。
   *
   * - 有值 ⇒ done + 记录值；
   * - 无值（成功但索引里没有 updatedAt，或请求失败走了 markLiveDone）⇒ done，退化为不过滤；
   * - 只前进不后退：done 不会再回到 pending（收敛单调）。
   *
   * **晚到反转闸门**：该周期已被兜底定时器标记为 ABANDONED ⇒ 直接 return，
   * 不改状态、不改值、不重画。放弃之后不再接受迟到值 —— 已经渲染出来的内容不得随后消失。
   *
   * 两条来源（loadIndex 与 ensureLiveUpdatedAt）都汇到这里，共用同一个触发点。
   *
   * @param {string} period 周期 key
   * @param {string} updatedAt 实时榜的更新时间；为空表示"确认拿不到"
   */
  function recordLiveUpdatedAt(period, updatedAt) {
    // 已放弃：单向闸门，迟到的判据一律作废（否则迟到的值会触发重画、把已渲染的期撤掉）。
    if (state.liveStatus[period] === LIVE_ABANDONED) { return; }
    var wasStatus = state.liveStatus[period];
    var wasValue = state.liveUpdatedAt[period];
    if (updatedAt) {
      state.liveStatus[period] = LIVE_DONE;
      state.liveUpdatedAt[period] = updatedAt;
    } else {
      state.liveStatus[period] = LIVE_DONE;   // 确认拿不到；不覆盖已有值（wasValue 原样保留）
    }
    if (state.liveStatus[period] !== wasStatus || state.liveUpdatedAt[period] !== wasValue) {
      repaintHistory();
    }
  }

  /**
   * 把某周期从 pending 落到 done（无值）——"确认拿不到"这一支。
   * 已是 done / abandoned 时不动（幂等），绝不把 abandoned 降级或复活，也不把 done 打回 pending。
   *
   * @param {string} period 周期 key
   */
  function markLiveDone(period) {
    // 只处理 pending：done 幂等、abandoned 是单向闸门，都不在此处反转。
    if (state.liveStatus[period] !== LIVE_PENDING) { return; }
    state.liveStatus[period] = LIVE_DONE;
    repaintHistory();
  }

  /**
   * 过滤判据（liveUpdatedAt）变化后重画历史行与面板。
   *
   * 归档索引还没到就跳过 —— 那时 renderHistoryBar() 只会画出"暂无快照"的空态，
   * 等 loadHistoryIndex() 回来自然会画出正确的一版，重画没有意义。
   *
   * 不递归：renderHistoryBar() 只会读 state.liveUpdatedAt，绝不调用 recordLiveUpdatedAt()。
   * 面板若正开着，renderHistoryBar() 内部会按新结果收/放它并同步 aria-expanded。
   */
  function repaintHistory() {
    if (!state.history) { return; }
    renderHistoryBar();
  }

  /**
   * 判断某期归档是否与「最新」出自同一次抓取。
   *
   * 抓取脚本的 write_archive() 与 write_latest() 消费的是**同一份 items**，
   * 于是「归档里最新的一期」与「实时榜」的 updatedAt 逐字相同、内容逐条相同。
   * 历史行若把它当一期待看的历史期列出，用户点进去必然一字不差 —— 那不是历史，
   * 只是同一份数据的第二次展示。这里把它识别出来，交给上层剔除。
   *
   * 保护规则：**正在查看的那一期永不剔除**，否则选中态会因为过滤而凭空消失
   * （正常情况下一期不可能"既与最新同源、又是正在查看的快照"，补跑 / 重抓后可能）。
   *
   * @param {string} period 周期 key
   * @param {Object} snap 归档索引里的一条
   * @returns {boolean} true = 与最新同源，应视为重复而不展示
   */
  function isLiveDuplicate(period, snap) {
    var live = state.liveUpdatedAt[period];
    if (!live || !snap || !snap.updatedAt) { return false; }
    if (snap.updatedAt !== live) { return false; }
    var feed = feedOf(period);
    if (feed.snapshot && feed.snapshot.name === snap.name) { return false; }
    return true;
  }

  /**
   * 历史行 / 「全部归档」面板实际要展示的期。
   *
   * 四态决定行为：
   *   · pending（判据还没到）→ 返回**空**：还不知道该不该剔除，就不要猜、不要先渲染，
   *     等判据到了再一次性把结果画出来（避免"元素闪出再消失"）；
   *   · done + 有值 → 按 `snap.updatedAt === value` 过滤；
   *   · done + 无值（确认拿不到）→ 返回原始列表，退化为不过滤；
   *   · abandoned（兜底放弃）→ 与"确认拿不到"同：返回原始列表，退化为不过滤。
   *     （abandoned 从未写入 liveUpdatedAt，所以走到下面 `!live` 这一支自然返回原始列表。）
   *
   * @param {string} period 周期 key
   * @returns {Array<Object>} 要展示的快照列表
   */
  function visibleSnapshotsOf(period) {
    if (state.liveStatus[period] === LIVE_PENDING) { return []; }
    var list = snapshotsOf(period);
    var live = state.liveUpdatedAt[period];
    if (!live) { return list; }
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (!isLiveDuplicate(period, list[i])) { out.push(list[i]); }
    }
    return out;
  }

  /**
   * 取 ISO 时刻的日历日期（前 10 位）。
   *
   * 刻意**不做**时区换算。归档窗口本身就是按 UTC 日历边界构造的
   * （见 scripts/fetch_top100.py 的 compute_window：周榜 = 上周一 00:00 ~ 周日 23:59:59，
   *  月榜 = 上月 1 日 00:00 ~ 月末 23:59:59），所以 UTC 日期正好就是这两个榜
   * 想表达的「覆盖了哪几天」。
   *
   * 曾经按北京时间 +8h 换算，结果 10-07T23:59:59Z 落到 10-08，周榜被显示成
   * 「10-01 → 10-08」—— 把今天也圈了进去，与「上周」自相矛盾。
   * 日榜窗口锚在北京运行时刻（08:30 = 00:30Z），两种算法同一天，所以掩盖了这个问题。
   *
   * @param {string} iso ISO8601 时刻
   * @returns {string} YYYY-MM-DD；解析不出来时返回空串
   */
  function isoDate(iso) {
    var text = String(iso || '');
    return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : '';
  }

  function monthDay(raw) {
    var text = String(raw || '');
    return text.length >= 10 ? text.slice(5, 10) : text;
  }

  /**
   * chip 上的日期文案。周榜用统计范围而不是运行日期 ——
   * 只给一个日期根本看不出覆盖的是哪一周。
   *
   * @param {string} period 周期 key
   * @param {Object} snap 索引里的一条快照
   * @returns {string} 展示文案
   */
  function snapshotLabel(period, snap) {
    if (period === 'weekly') {
      var start = monthDay(isoDate(snap.rangeStart));
      var end = monthDay(isoDate(snap.rangeEnd));
      if (start && end) { return start + '–' + end; }
    }
    if (period === 'monthly') { return String(snap.date || snap.name || ''); }
    return monthDay(snap.date || snap.name);
  }

  /**
   * 相对时间标签：昨日 / 上周 / 上月 …… 正是用户口中「昨日排行」的说法。
   *
   * @param {string} period 周期 key
   * @param {Object} snap 快照
   * @returns {string} 文案；算不出来时返回空串
   */
  function snapshotAgo(period, snap) {
    var strings = t();
    if (period === 'monthly') {
      var hit = /^(\d{4})-(\d{2})$/.exec(String(snap.date || ''));
      if (!hit) { return ''; }
      var nowMonth = new Date();
      var months = (nowMonth.getFullYear() - Number(hit[1])) * 12 +
        (nowMonth.getMonth() + 1 - Number(hit[2]));
      if (months <= 0) { return ''; }
      return months === 1 ? strings.agoLastMonth : months + strings.monthAgo;
    }

    var hit2 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(snap.date || ''));
    if (!hit2) { return ''; }
    var then = Date.UTC(Number(hit2[1]), Number(hit2[2]) - 1, Number(hit2[3]));
    var now = new Date();
    var today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    var days = Math.round((today - then) / 86400000);
    if (days < 0) { return ''; }

    if (period === 'weekly') {
      var weeks = Math.max(1, Math.round(days / 7));
      return weeks === 1 ? strings.agoLastWeek : weeks + strings.weekAgo;
    }
    if (days === 0) { return strings.agoToday; }
    if (days === 1) { return strings.agoYesterday; }
    if (days === 2) { return strings.agoDayBefore; }
    return days + strings.dayAgo;
  }

  /**
   * 「含 N 次重抓留底」文案。归档索引每条带 revisions 字段 ——
   * 同一天重跑且内容不同时，被覆盖掉的旧版本会转存到 data/revisions/<period>/，
   * 它是「任何一次抓取结果都不丢」的凭据。revisions === 0（正常每日运行）时不显示。
   *
   * @param {Object} snap 归档索引里的一条
   * @returns {string} 文案；无需展示时返回空串
   */
  function revisionNote(snap) {
    var count = Number(snap && snap.revisions) || 0;
    if (count <= 0) { return ''; }
    return t().revisionNote.replace('{n}', String(count));
  }

  /** chip 悬浮提示：统计范围 + 条数 + 生成时间 + 重抓留底（不占布局，纯 title） */
  function snapshotTitle(snap) {
    var strings = t();
    var parts = [];
    var start = isoDate(snap.rangeStart);
    var end = isoDate(snap.rangeEnd);
    if (start && end) { parts.push(strings.rangeLabel + ' ' + start + ' → ' + end); }
    if (snap.count) { parts.push(snap.count + ' ' + strings.tipItems); }
    if (snap.updatedAt) { parts.push(formatUpdatedAt(snap.updatedAt)); }
    var rev = revisionNote(snap);
    if (rev) { parts.push(rev); }
    return parts.join(' · ');
  }

  /** 历史行内联展示的最大期数 —— 再多就交给「全部」面板，免得这一行变成一条要横滑的缝 */
  var HISTORY_INLINE_MAX = 4;

  /**
   * 渲染历史归档行。
   *
   * 「索引还没到」与「这个周期一份归档都没有」都只渲染一行说明文字 ——
   * 该行高度由 CSS 的 min-height 钉死，三种状态完全等高（约束 6），
   * 因此这里可以放心地在切榜时清空重画。
   *
   * 芯片文案**语义优先**：`昨日 10-08`，不是 `10-08 昨日`。
   * 用户要的就是"昨日排行 / 上周排行"，把语义做成小号后缀等于把重点做成了附注。
   */
  function renderHistoryBar() {
    if (!dom.historyBar) { return; }
    var strings = t();
    var feed = feedOf(state.period);
    // all = 索引里的原始列表；snaps = 剔除「与最新同源」之后的可见列表。
    // 区分二者只是为了空态文案：索引里根本没有期 vs 有期但全被剔除了。
    var all = snapshotsOf(state.period);
    var snaps = visibleSnapshotsOf(state.period);

    var html = '<span class="history-label">' + ICON.clock + esc(strings.historyLabel) + '</span>';

    if (!snaps.length) {
      // 三种"这一行没有芯片"的原因，文案要分清（都只画一行说明，靠 CSS 的三态等高约束保证 44px）：
      //   · pending  → 判据还没到，不能说"暂无"，只能画占位，等判据到了再换成真芯片；
      //   · 有期但全被剔除（与最新同源）→ historyDupOnly；
      //   · 索引里一期都没有 → historyEmpty。
      if (state.liveStatus[state.period] === LIVE_PENDING) {
        html += '<span class="history-pending">' + esc(strings.loading) + '</span>';
      } else {
        var note = all.length ? strings.historyDupOnly : strings.historyEmpty;
        html += '<span class="history-empty">' + esc(note) + '</span>';
      }
      dom.historyBar.innerHTML = html;
      if (dom.historyPop) { dom.historyPop.hidden = true; }
      renderHistoryPopover();
      return;
    }

    var latestOn = feed.snapshot ? 'false' : 'true';
    html += '<button class="hchip' + (feed.snapshot ? '' : ' is-on') + '" type="button"' +
      ' data-snap="" aria-pressed="' + latestOn + '">' +
      '<span class="hchip-ago">' + esc(strings.historyLatest) + '</span></button>';

    var shown = snaps.slice(0, HISTORY_INLINE_MAX);
    for (var i = 0; i < shown.length; i++) {
      var snap = shown[i];
      var on = !!(feed.snapshot && feed.snapshot.name === snap.name);
      var ago = snapshotAgo(state.period, snap);
      var label = snapshotLabel(state.period, snap);
      html += '<button class="hchip' + (on ? ' is-on' : '') + '" type="button"' +
        ' data-snap="' + esc(snap.name) + '"' +
        ' aria-pressed="' + (on ? 'true' : 'false') + '"' +
        ' title="' + esc(snapshotTitle(snap)) + '">' +
        (ago
          ? '<span class="hchip-ago">' + esc(ago) + '</span>' +
            '<span class="hchip-date">' + esc(label) + '</span>'
          : '<span class="hchip-ago">' + esc(label) + '</span>') +
        '</button>';
    }

    // 总数跨三个周期算：面板里列的是全部（已剔除同期快照），按钮上的数字就得是同一个口径
    var total = 0;
    for (var p = 0; p < PERIODS.length; p++) { total += visibleSnapshotsOf(PERIODS[p]).length; }
    if (total > shown.length) {
      html += '<button class="hall" type="button" data-history-all="1"' +
        ' aria-haspopup="dialog" aria-expanded="false">' +
        esc(strings.historyAll) + ' ' + total + esc(strings.historyAllUnit) +
        ICON.caret + '</button>';
    }

    dom.historyBar.innerHTML = html;
    renderHistoryPopover();
    // 这一行渲染完已经没有「全部」按钮时，别把面板留在屏幕上
    if (dom.historyPop && !dom.historyBar.querySelector('.hall')) { dom.historyPop.hidden = true; }
    syncHistoryPopState();
  }

  /**
   * 渲染「全部归档」面板：按周期分组，**当前周期排最前**。
   *
   * 当前周期排最前是为了让"我刚在看的这一期"就落在面板第一屏，
   * 不用为了找它先滚面板。
   */
  function renderHistoryPopover() {
    if (!dom.historyPop) { return; }
    var strings = t();
    var order = [state.period];
    for (var k = 0; k < PERIODS.length; k++) {
      if (PERIODS[k] !== state.period) { order.push(PERIODS[k]); }
    }

    var html = '<p class="hpop-title">' + esc(strings.historyPopTitle) + '</p>';
    var any = false;

    for (var p = 0; p < order.length; p++) {
      var period = order[p];
      // 同样剔除「与最新同源」的期：面板列的是"可看的更早期"，不是磁盘上所有文件
      var list = visibleSnapshotsOf(period);
      if (!list.length) { continue; }
      any = true;
      html += '<p class="hpop-group">' + esc(strings.tabs[period]) + '</p><div class="hpop-list">';
      for (var i = 0; i < list.length; i++) {
        var snap = list[i];
        var feed = feedOf(period);
        var on = !!(feed.snapshot && feed.snapshot.name === snap.name);
        var rev = revisionNote(snap);
        html += '<button class="hrow' + (on ? ' is-on' : '') + '" type="button"' +
          ' data-period="' + esc(period) + '" data-snap="' + esc(snap.name) + '"' +
          ' aria-pressed="' + (on ? 'true' : 'false') + '"' +
          ' title="' + esc(snapshotTitle(snap)) + '">' +
          '<span class="hrow-ago">' +
            esc(snapshotAgo(period, snap) || snapshotLabel(period, snap)) + '</span>' +
          '<span class="hrow-date">' + esc(snapshotLabel(period, snap)) + '</span>' +
          (rev ? '<span class="hrow-rev">' + esc(rev) + '</span>' : '') +
          '<span class="hrow-count">' + esc(String(snap.count || 0)) + ' ' +
            esc(strings.tipItems) + '</span>' +
          '</button>';
      }
      html += '</div>';
    }

    if (!any) {
      var anyPending = false;
      var hadRaw = false;
      for (var q = 0; q < PERIODS.length; q++) {
        if (state.liveStatus[PERIODS[q]] === LIVE_PENDING) { anyPending = true; }
        if (snapshotsOf(PERIODS[q]).length) { hadRaw = true; }
      }
      if (anyPending) {
        html += '<p class="history-pending">' + esc(strings.loading) + '</p>';
      } else {
        html += '<p class="history-empty">' +
          esc(hadRaw ? strings.historyDupOnly : strings.historyEmpty) + '</p>';
      }
    }
    dom.historyPop.innerHTML = html;
  }

  /** 面板重绘后把按钮的 aria-expanded 与实际显隐对齐（语言切换会重绘两者） */
  function syncHistoryPopState() {
    if (!dom.historyBar || !dom.historyPop) { return; }
    var btn = dom.historyBar.querySelector('.hall');
    if (btn) { btn.setAttribute('aria-expanded', dom.historyPop.hidden ? 'false' : 'true'); }
  }

  /**
   * 开合「全部归档」面板。
   *
   * 面板绝对定位，开合**不改变历史行高度** —— 这是约束 6 的一部分：
   * 让它参与布局的话，展开那一刻整页都会被往下推。
   *
   * @param {boolean} open 目标状态
   */
  function setHistoryPop(open) {
    if (!dom.historyBar || !dom.historyPop) { return; }
    var btn = dom.historyBar.querySelector('.hall');
    if (!btn) { return; }                        // 没有「全部」就没有可展开的东西
    if (!open) {
      dom.historyPop.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      return;
    }
    renderHistoryPopover();
    dom.historyPop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
  }

  /**
   * 拉取并装载一份历史快照。
   *
   * 归档是整份文件（100 条约 116KB），不像实时榜那样有分页切片，所以走的是
   * feed.singleFile 这条既有的「整份数据在本地按页切」路径 —— 滚动加载、
   * 标签筛选、抽屉在这个模式下与看最新榜完全一致，不需要各写一套。
   *
   * @param {string} period 周期 key
   * @param {Object} snap 索引里的一条快照
   * @returns {Promise<void>}
   */
  function fetchSnapshot(period, snap) {
    var feed = feedOf(period);
    var epoch = feed.epoch;
    feed.loading = true;
    showSkeleton(period, true);

    return fetchJson(snap.file).then(function (board) {
      // 期间又切了别的快照 / 切回最新：这份已经过期，丢掉
      if (feed.epoch !== epoch) { return null; }
      feed.loading = false;
      showSkeleton(period, false);
      var items = Array.isArray(board.items) ? board.items : [];
      feed.singleFile = board;
      feed.pageSize = DEFAULT_PAGE_SIZE;
      feed.totalPages = Math.max(1, Math.ceil(items.length / feed.pageSize));
      feed.index = {
        period: period,
        updatedAt: board.generatedAt || board.updatedAt || snap.updatedAt || '',
        total: items.length,
        tagCounts: board.tagCounts || {},
        rangeStart: board.rangeStart || snap.rangeStart || '',
        rangeEnd: board.rangeEnd || snap.rangeEnd || ''
      };
      return loadPage(period, 1);
    }).catch(function (error) {
      if (feed.epoch !== epoch) { return null; }
      feed.loading = false;
      feed.snapshot = null;
      showSkeleton(period, false);
      feed.error = t().snapshotWord + ' ' + snap.name + ' · ' +
        (error && error.message ? error.message : String(error));
      if (period === state.period) {
        writeHash();
        renderHistoryBar();
        paintChrome();
        renderBoard();
      }
    });
  }

  /* -------------------------------- 渲染 --------------------------------- */

  function renderCard(item, index, rankOverride) {
    // 未筛选时用榜单里的原始名次；筛选后按当前结果重新从 1 编号
    var rank = rankOverride || item.rank || (index + 1);
    var rankClass = rank <= 3 ? ' top' + rank : '';
    // 编辑风的名次是等宽数字列，个位数补零才能与两位数对齐（01 / 02 … 10）
    var rankText = rank < 10 ? '0' + rank : String(rank);
    var strings = t();

    var meta = '';
    if (item.language) {
      meta += '<span class="meta-item"><span class="lang-dot" style="background:' +
        langColor(item.language) + '"></span>' + esc(item.language) + '</span>';
    }
    meta += '<span class="meta-item">' + ICON.star +
      '<span class="meta-strong">' + fmtNumber(item.stars) + '</span> ' + strings.star + '</span>';
    meta += '<span class="meta-item">' + ICON.fork +
      '<span class="meta-strong">' + fmtNumber(item.forks) + '</span> ' + strings.fork + '</span>';
    if (item.createdAt) {
      meta += '<span class="meta-item">' + ICON.clock + strings.createdAt + ' ' +
        esc(item.createdAt) + '</span>';
    }
    if (item.pushedAt) {
      meta += '<span class="meta-item">' + strings.pushedAt + ' ' +
        esc(relativeDate(item.pushedAt)) + '</span>';
    }

    var tags = Array.isArray(item.tags) ? item.tags : [];
    var tagsHtml = tags.length
      ? '<div class="card-tags">' + tags.map(function (key) {
          return '<span class="tag">' + esc(tagLabel(key)) + '</span>';
        }).join('') + '</div>'
      : '';

    var desc = item.description
      ? '<p class="card-desc">' + esc(item.description) + '</p>'
      : '<p class="card-desc is-empty">' + strings.noDesc + '</p>';

    return '' +
      '<article class="card">' +
        '<div class="card-rank' + rankClass + '">' + rankText + '</div>' +
        '<div class="card-body">' +
          '<h2 class="card-title">' +
            (item.ownerAvatar ? '<img class="repo-avatar" src="' + esc(item.ownerAvatar) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '') +
            '<a class="repo-link" href="' + esc(item.url || ('https://github.com/' + item.fullName)) +
              '" target="_blank" rel="noopener noreferrer">' +
              '<span class="repo-owner">' + esc(item.owner) + '</span>' +
              '<span class="repo-slash">/</span>' + esc(item.name) +
            '</a>' +
            // growthExact=false 表示这条是"凑满 100"的补位项，周期增幅不可考，
            // 显示"—"而不是 "+0"，避免把"不知道"显示成"零增长"
            '<span class="hot-badge' + (item.growthExact === false ? ' is-unknown' : '') + '">' +
              ICON.flame +
              (item.growthExact === false
                ? '— ' + esc(strings.growthUnknown)
                : '+' + fmtNumber(item.periodStars) + ' ' + esc(strings.increment[state.period] || '')) +
            '</span>' +
          '</h2>' +
          desc +
          tagsHtml +
          '<div class="card-meta">' + meta +
            '<button class="detail-btn" type="button" data-idx="' + index + '">' +
              esc(strings.detail) +
            '</button>' +
          '</div>' +
        '</div>' +
      '</article>';
  }

  /* ------------------------------ 详情抽屉 ------------------------------- */

  /** 取当前榜单正在展示的条目数组（与渲染时用的是同一个来源） */
  function currentSource() {
    var feed = feedOf(state.period);
    return feed.filtered || feed.allItems;
  }

  function renderDrawerBody(item) {
    var strings = t();
    var tags = Array.isArray(item.tags) ? item.tags : [];
    var topics = Array.isArray(item.topics) ? item.topics : [];
    var hasVal = function (value) {
      return value !== undefined && value !== null && value !== '';
    };

    var html = '';

    // (1) 头部：头像 + 语言 / 创建时间 / 状态标记（owner·name 已在抽屉标题里，不重复）
    html += '<div class="drawer-hero">';
    var initial = item.owner ? String(item.owner).charAt(0).toUpperCase() : '?';
    if (item.ownerAvatar) {
      html += '<img class="drawer-avatar" src="' + esc(item.ownerAvatar) +
        '" alt="" loading="lazy" referrerpolicy="no-referrer" data-initial="' + esc(initial) + '">';
    } else {
      html += '<span class="drawer-avatar is-fallback">' + esc(initial) + '</span>';
    }
    html += '<div class="drawer-hero-sub">';
    if (item.language) {
      html += '<span class="meta-item"><span class="lang-dot" style="background:' +
        langColor(item.language) + '"></span>' + esc(item.language) + '</span>';
    }
    if (item.createdAt) {
      html += '<span class="meta-item">' + ICON.clock + esc(strings.createdAt) + ' ' +
        esc(relativeDate(item.createdAt)) + '</span>';
    }
    if (item.archived) {
      html += '<span class="drawer-flag">' + esc(strings.flagArchived) + '</span>';
    }
    if (item.isFork) {
      html += '<span class="drawer-flag is-soft">' + esc(strings.flagFork) + '</span>';
    }
    html += '</div>';
    html += '</div>';

    // (2) 指标网格：Star / Fork / 周期新增 / Watch / Issue / 体积
    var growthExact = item.growthExact !== false;
    var statCell = function (value, label, extraClass) {
      return '<div class="drawer-stat' + (extraClass || '') + '">' +
        '<span class="drawer-stat-num">' + esc(value) + '</span>' +
        '<span class="drawer-stat-lb">' + esc(label) + '</span></div>';
    };
    html += '<div class="drawer-stats">';
    html += statCell(fmtNumber(item.stars), strings.statStars);
    html += statCell(fmtNumber(item.forks), strings.statForks);
    html += statCell(
      growthExact ? '+' + fmtNumber(item.periodStars) : '—',
      strings.statGrowth,
      growthExact ? ' is-accent' : ''
    );
    html += statCell(hasVal(item.watchers) ? fmtNumber(item.watchers) : '—', strings.statWatchers);
    html += statCell(hasVal(item.openIssues) ? fmtNumber(item.openIssues) : '—', strings.statIssues);
    html += statCell(fmtSize(item.sizeKb) || '—', strings.statSize);
    html += '</div>';

    // (3) 完整描述（卡片上被截断成两行，这里原样全文显示）
    html += '<section class="drawer-section">' +
      '<p class="drawer-label">' + esc(strings.secDesc) + '</p>' +
      (item.description
        ? '<p class="drawer-desc">' + esc(item.description) + '</p>'
        : '<p class="drawer-desc is-empty">' + esc(strings.noDescFull) + '</p>') +
      '</section>';

    // (4) 标签
    if (tags.length) {
      html += '<section class="drawer-section">' +
        '<p class="drawer-label">' + esc(strings.secTags) + '</p>' +
        '<div class="drawer-tags">' + tags.map(function (key) {
          return '<span class="tag">' + esc(tagLabel(key)) + '</span>';
        }).join('') + '</div></section>';
    }

    // (5) 主题
    if (topics.length) {
      html += '<section class="drawer-section">' +
        '<p class="drawer-label">' + esc(strings.secTopics) + '</p>' +
        '<div class="drawer-tags">' + topics.map(function (topic) {
          return '<span class="tag">#' + esc(topic) + '</span>';
        }).join('') + '</div></section>';
    }

    // (6) 项目信息
    var rows = '';
    var addRow = function (label, valueHtml, unknown) {
      rows += '<div class="drawer-row"><dt>' + esc(label) + '</dt><dd' +
        (unknown ? ' class="is-unknown"' : '') + '>' + valueHtml + '</dd></div>';
    };

    addRow(strings.lbRank, esc(String(item.rank || '—')));
    if (item.language) {
      addRow(strings.lbLanguage, '<span class="lang-dot" style="background:' +
        langColor(item.language) + '"></span> ' + esc(item.language));
    }
    addRow(strings.lbOwnerType, esc(ownerTypeLabel(item.ownerType)), !item.ownerType);
    if (item.homepage) {
      addRow(strings.lbHomepage, '<a class="drawer-link" href="' + esc(item.homepage) +
        '" target="_blank" rel="noopener noreferrer">' +
        esc(hostOf(item.homepage) || item.homepage) + '</a>');
    } else {
      addRow(strings.lbHomepage, esc('—'), true);
    }
    addRow(
      strings.lbBranch,
      item.defaultBranch ? '<code class="drawer-code">' + esc(item.defaultBranch) + '</code>' : esc('—'),
      !item.defaultBranch
    );
    addRow(strings.lbLicense, esc(item.license || strings.lbNoLicense), !item.license);
    addRow(strings.lbCreated, esc(item.createdAt || '—'), !item.createdAt);
    addRow(
      strings.lbPushed,
      item.pushedAt ? esc(item.pushedAt + '（' + relativeDate(item.pushedAt) + '）') : esc('—'),
      !item.pushedAt
    );
    addRow(
      strings.lbUpdated,
      item.updatedAt ? esc(item.updatedAt + '（' + relativeDate(item.updatedAt) + '）') : esc('—'),
      !item.updatedAt
    );

    html += '<section class="drawer-section">' +
      '<p class="drawer-label">' + esc(strings.secMeta) + '</p>' +
      '<dl class="drawer-list">' + rows + '</dl></section>';

    // (7) 跳转 GitHub
    var url = item.url || ('https://github.com/' + item.fullName);
    html += '<section class="drawer-section">' +
      '<a class="drawer-cta" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' +
      esc(strings.openOnGithub) + ' &#8599;</a></section>';

    return html;
  }

  /**
   * 打开详情抽屉。
   * @param {Object} item 榜单条目
   */
  function openDrawer(item) {
    if (!item || !dom.drawer) { return; }
    state.drawerItem = item;
    state.lastFocus = document.activeElement;

    var strings = t();
    dom.drawerTitle.innerHTML = '<span class="repo-owner">' + esc(item.owner) + '</span>' +
      '<span class="repo-slash">/</span>' + esc(item.name);
    dom.drawerBody.innerHTML = renderDrawerBody(item);

    dom.drawer.hidden = false;
    dom.drawerMask.hidden = false;

    // 锁滚动前量一次"滚动条消失会让可视宽度宽出多少"，再补上等宽的 padding-right，
    // 否则整页内容会横移一截（现象就是"展开详情时内容抖一下"）。
    // 注意：必须"加类前后各量一次"，而不是"加类前算 innerWidth - clientWidth"。
    // 若 html 启用了 scrollbar-gutter: stable，锁滚动前后 clientWidth 根本不变，
    // 按旧算法会误补 15px，反而把内容推歪。
    var widthBefore = document.documentElement.clientWidth;
    document.body.classList.add('drawer-open');
    var widened = document.documentElement.clientWidth - widthBefore;
    if (widened > 0) {
      document.body.style.paddingRight = widened + 'px';
    }
    if (dom.drawerClose) { dom.drawerClose.setAttribute('aria-label', strings.close); }
    if (dom.drawerClose) { dom.drawerClose.focus(); }
  }

  function closeDrawer() {
    if (!dom.drawer || dom.drawer.hidden) { return; }
    dom.drawer.hidden = true;
    dom.drawerMask.hidden = true;
    document.body.classList.remove('drawer-open');
    document.body.style.paddingRight = '';
    state.drawerItem = null;
    if (state.lastFocus && state.lastFocus.focus) {
      try { state.lastFocus.focus(); } catch (e) { /* 元素可能已被重绘移除 */ }
    }
    state.lastFocus = null;
  }

  /**
   * 把"下一片"条目追加进 DOM。
   * @returns {number} 本次新渲染的条数
   */
  function paintMore() {
    var feed = feedOf(state.period);
    var source = feed.filtered || feed.allItems;
    var end = Math.min(source.length, feed.rendered + feed.pageSize);
    if (end <= feed.rendered) { return 0; }

    var html = '';
    for (var i = feed.rendered; i < end; i++) {
      // 标签筛选后结果集是新的榜单，编号重排为 1..N
      html += renderCard(source[i], i, feed.filtered ? i + 1 : 0);
    }
    dom.board.insertAdjacentHTML('beforeend', html);
    feed.rendered = end;
    return end;
  }

  /**
   * 骨架屏是全局唯一的节点，只有"当前正在看的榜单"才允许显示它，
   * 否则后台预取其他榜时会把骨架闪到当前列表的底部。
   * @param {string} period 触发加载的榜单
   * @param {boolean} visible 是否显示
   */
  function showSkeleton(period, visible) {
    if (!dom.skeletons) { return; }
    dom.skeletons.hidden = !(visible && period === state.period);
  }

  function renderTagBar() {
    var feed = feedOf(state.period);
    var counts = (feed.index && feed.index.tagCounts) || {};
    var keys = Object.keys(counts);
    if (!keys.length) {
      dom.tagBar.innerHTML = '';
      return;
    }
    var strings = t();
    var html = '<button class="chip' + (feed.tag ? '' : ' is-on') +
      '" type="button" data-tag="">' + esc(strings.all) +
      '<span class="chip-num">' + (feed.index.total || 0) + '</span></button>';
    keys.forEach(function (key) {
      html += '<button class="chip' + (feed.tag === key ? ' is-on' : '') +
        '" type="button" data-tag="' + esc(key) + '">' + esc(tagLabel(key)) +
        '<span class="chip-num">' + counts[key] + '</span></button>';
    });
    dom.tagBar.innerHTML = html;
  }

  function renderBoard() {
    var feed = feedOf(state.period);

    if (feed.error && !feed.rendered) {
      dom.board.innerHTML = '<div class="state is-error">' +
        '<p class="state-title">' + esc(t().errTitle) + '</p>' +
        '<p class="state-desc">' + esc(feed.error) + ' · ' +
          (location.protocol === 'file:' ? esc(t().fileHint) : esc(t().errHint)) +
        '</p></div>';
      dom.feedEnd.hidden = true;
      return;
    }

    if (!feed.rendered && !(feed.filtered && feed.filtered.length)) {
      var source = feed.filtered || feed.allItems;
      if (feed.filtered && !source.length) {
        dom.board.innerHTML = '<div class="state"><p class="state-title">' +
          esc(t().filterEmpty) + '</p></div>';
        dom.feedEnd.hidden = true;
        return;
      }
      dom.board.innerHTML = '';
    }

    paintMore();

    var exhausted = feed.filtered
      ? feed.rendered >= feed.filtered.length
      : (feed.done && feed.rendered >= feed.allItems.length);
    if (exhausted) {
      var total = feed.filtered ? feed.filtered.length : feed.allItems.length;
      if (total > 0) {
        var text = t().endSuffix + ' ' + total + ' ' + t().endUnit;
        // 看历史快照时把统计范围写出来：光看日期不知道覆盖的是哪 24 小时 / 哪一周
        if (feed.snapshot && !feed.filtered && feed.index) {
          var from = isoDate(feed.index.rangeStart);
          var to = isoDate(feed.index.rangeEnd);
          if (from && to) { text += ' · ' + t().rangeLabel + ' ' + from + ' → ' + to; }
        }
        dom.feedEnd.textContent = text;
        dom.feedEnd.hidden = false;
      }
    } else {
      dom.feedEnd.hidden = true;
    }

    maybeFill();
  }

  /**
   * 视口还没被填满时继续补内容。
   *
   * IntersectionObserver 只在"相交状态发生变化"时回调：若哨兵一直停在视口内
   * （例如清掉标签筛选后列表骤减到 6 条），不会再有新事件，剩余条目就永远不渲染。
   * 这里在每次渲染后主动检查一次哨兵位置，形成"渲染 → 检查 → 再渲染"的收敛链，
   * 直到内容把哨兵顶出视口或数据全部渲染完。
   *
   * 关键：检查时若恰有一片在路上，**不能直接 return 把链掐断** ——
   * 那一刻哨兵往往也没跨过相交阈值，观察器不会补发事件，两边都不动就永久卡住
   * （实测表现为"切到某天的快照后只有 6 条，怎么滚都不再加载"，且是偶发）。
   * 正确做法是稍后重试，直到这一次加载落地。
   *
   * @param {number} [attempt] 内部重试计数，外部调用不要传
   */
  function maybeFill(attempt) {
    if (!dom.sentinel) { return; }
    if (dom.sentinel.getBoundingClientRect().top >= window.innerHeight + 320) { return; }
    var tries = attempt || 0;
    // 兜底上限：约 3 秒。防的是"加载永远不落地"这种异常，正常一轮最多重试一两次。
    if (tries > 50) { return; }
    setTimeout(function () {
      if (!dom.sentinel) { return; }
      var feed = feedOf(state.period);
      if (feed.loading) {
        // 有一片正在路上：等它落地再检查，别把收敛链丢在这一刻
        maybeFill(tries + 1);
        return;
      }
      if (dom.sentinel.getBoundingClientRect().top < window.innerHeight + 320) {
        onReachEnd();
      }
    }, 60);
  }

  /** 刷新与语言/状态相关的静态文案 */
  function paintChrome() {
    var strings = t();
    document.documentElement.lang = strings.htmlLang;
    document.title = strings.title;
    dom.brandTitle.textContent = strings.brandTitle;
    dom.brandSub.textContent = strings.brandSub;
    dom.footerSource.innerHTML = strings.footerSource;
    dom.footerNote.textContent = strings.footerNote;

    var tabs = dom.tabs ? dom.tabs.querySelectorAll('.tab') : [];
    for (var i = 0; i < tabs.length; i++) {
      var key = tabs[i].getAttribute('data-period');
      tabs[i].textContent = strings.tabs[key];
      var active = key === state.period;
      tabs[i].classList.toggle('is-active', active);
      tabs[i].setAttribute('aria-selected', active ? 'true' : 'false');
    }

    // 头部与抽屉内各有一个语言开关，统一刷新高亮
    var spans = document.querySelectorAll('[data-lang]');
    for (var j = 0; j < spans.length; j++) {
      spans[j].classList.toggle('is-on', spans[j].getAttribute('data-lang') === state.lang);
    }

    paintThemeButtons();

    var feed = feedOf(state.period);
    // 看的是历史快照时，让「数据更新于」带一个可辨识的标记，避免误以为是实时数据
    if (dom.updateBadge) {
      dom.updateBadge.classList.toggle('is-snapshot', !!feed.snapshot);
    }
    if (feed.index && feed.index.updatedAt) {
      dom.updateTime.textContent = (feed.snapshot ? strings.snapshotWord + ' · ' : '') +
        formatUpdatedAt(feed.index.updatedAt);
    } else {
      dom.updateTime.textContent = feed.error ? strings.errTitle : strings.loading;
    }
  }

  /* -------------------------------- 交互 --------------------------------- */

  /**
   * 解析地址栏 hash：`#daily` 或 `#daily@2026-10-08`（后者是历史快照深链）。
   * @returns {{period: string, snap: string}} snap 为空串表示看最新
   */
  function routeFromHash() {
    var raw = (location.hash || '').replace('#', '').trim();
    var at = raw.indexOf('@');
    var period = at === -1 ? raw : raw.slice(0, at);
    var snap = at === -1 ? '' : raw.slice(at + 1);
    try { snap = decodeURIComponent(snap); } catch (e) { /* 非法转义就按原样用 */ }
    return {
      period: PERIODS.indexOf(period) !== -1 ? period : DEFAULT_PERIOD,
      snap: snap
    };
  }

  /** 把当前「周期 + 是否在看快照」写回 hash，便于分享与刷新后保持原样 */
  function writeHash() {
    var feed = feedOf(state.period);
    var value = '#' + state.period +
      (feed.snapshot ? '@' + encodeURIComponent(feed.snapshot.name) : '');
    if (location.hash !== value) { history.replaceState(null, '', value); }
  }

  /**
   * 按「周期 + 快照」把界面迁到目标状态。切榜、点历史 chip、深链、hashchange 全走这里，
   * 保证只有一条状态迁移路径 —— 否则「先切榜再换快照」会让两个请求同时打同一个 feed，
   * 先后顺序不定，最后显示哪个纯属运气。
   *
   * @param {string} period 目标周期
   * @param {string} snapName 目标快照名；空串表示看最新
   * @param {boolean} isBoot 是否首屏（决定要不要在之后预取其他榜）
   */
  function applyRoute(period, snapName, isBoot) {
    var feed = feedOf(period);
    var currentName = feed.snapshot ? feed.snapshot.name : '';
    var wantName = snapName || '';
    if (wantName !== currentName) {
      // 指向一份不存在的快照（手改 hash、或归档被清理过）时回落看最新，而不是停在错误态
      var snap = wantName ? findSnapshot(period, wantName) : null;
      resetFeed(period);
      feed.snapshot = snap;
    }
    switchPeriod(period, true, isBoot);
  }

  function switchPeriod(period, pushHash, isBoot) {
    if (PERIODS.indexOf(period) === -1) { period = DEFAULT_PERIOD; }
    state.period = period;
    if (pushHash) { writeHash(); }
    closeDrawer();
    // 换榜/换期先把「全部归档」面板收起：面板里列的是三个周期，
    // 底下的榜单已经换了，留着它很容易点到对不上的那一行
    setHistoryPop(false);
    paintChrome();
    renderTagBar();
    renderHistoryBar();

    var feed = feedOf(period);
    // 切榜必须把列表整个重绘：board 是三个榜共用的同一个 DOM 节点。
    // 若不清空并把 rendered 归零，切回一个已渲染过的榜时 renderBoard() 只会在
    // 旧卡片后面追加，而 paintMore() 又算不出新条目，结果就是"Tab 高亮换了、
    // 内容还是上一个榜的"（含它的筛选结果与徽标文案）。
    dom.board.innerHTML = '';
    dom.feedEnd.hidden = true;
    feed.rendered = 0;

    if (feed.loadedPages > 0) {
      // 数据已在内存（首屏预取过），直接重绘，不经过"清空 → 骨架 → 回填"的中间态
      renderBoard();
      return;
    }

    var wanted = feed.snapshot;
    // 预取失败不应让这个榜永久停在错误态，切过来时重新拉一次
    feed.error = null;

    var chain;
    if (wanted) {
      // 这个榜此前停在某一天的快照上，切回来继续看那一天，而不是偷偷回落到最新
      chain = loadHistoryIndex().then(function () { return fetchSnapshot(period, wanted); });
      // 看快照的这个周期不会走 loadIndex，单拉一次索引补齐判据
      // （幂等：首屏已对三个周期都发过，这里多半是空转）。
      ensureLiveUpdatedAt(period);
    } else {
      chain = loadIndex(period).then(function () {
        if (feed.error) { return null; }
        return loadPage(period, 1);
      });
    }

    chain.then(function () {
      if (period === state.period) {
        // paintChrome 必须在这里再调一次：快照路径是在这个 then 里才把 feed.index 填上的，
        // 而「数据更新于」徽标读的就是 feed.index.updatedAt —— 漏掉这一句会永远停在"加载中…"。
        paintChrome();
        renderHistoryBar();
        renderTagBar();
      }
      // 首屏第一片到位后再预取其余两个榜，避免与首屏请求抢带宽
      if (isBoot) { prefetchOthers(); }
    });
  }

  function setLang(lang) {
    if (I18N[lang]) { state.lang = lang; }
    try { localStorage.setItem(LANG_KEY, state.lang); } catch (e) { /* 隐私模式忽略 */ }
    paintChrome();
    renderTagBar();
    renderHistoryBar();
    // 抽屉开着时跟随语言切换重绘
    if (state.drawerItem && dom.drawer && !dom.drawer.hidden) {
      dom.drawerBody.innerHTML = renderDrawerBody(state.drawerItem);
      dom.drawerClose.setAttribute('aria-label', t().close);
    }
    // 已渲染的卡片需要按新语言重绘
    var feed = feedOf(state.period);
    var renderedCount = feed.rendered;
    feed.rendered = 0;
    dom.board.innerHTML = '';
    while (feed.rendered < renderedCount) {
      if (!paintMore()) { break; }
    }
    renderBoard();
  }

  /**
   * 滚动到底部：优先拉下一片网络数据，已筛选时则渲染下一片本地结果。
   */
  function onReachEnd() {
    var feed = feedOf(state.period);
    if (feed.loading || feed.error) { return; }

    if (feed.filtered) {
      if (feed.rendered < feed.filtered.length) { renderBoard(); }
      return;
    }
    if (feed.loadedPages < feed.totalPages) {
      loadPage(state.period, feed.loadedPages + 1);
      return;
    }

    // 所有页都已拉完但本地还有没渲染的条目（例如刚清掉标签筛选），继续渲染下一片
    if (feed.rendered < feed.allItems.length) { renderBoard(); }
  }

  function applyTag(tag) {
    var feed = feedOf(state.period);
    feed.tag = tag;
    renderTagBar();

    var reset = function () {
      feed.rendered = 0;
      feed.filtered = null;
      dom.board.innerHTML = '';
      dom.feedEnd.hidden = true;
    };

    if (!tag) {
      reset();
      renderBoard();
      return;
    }

    // 拉完所有页需要好几轮请求，期间用户可能切到别的快照 —— 那时这个筛选结果已无意义
    var epoch = feed.epoch;
    ensureAllPages(state.period).then(function () {
      if (feed.epoch !== epoch) { return; }
      reset();
      feed.filtered = feed.allItems.filter(function (item) {
        return Array.isArray(item.tags) && item.tags.indexOf(tag) !== -1;
      });
      renderBoard();
    });
  }

  function bindEvents() {
    if (dom.tabs) {
      dom.tabs.addEventListener('click', function (event) {
        var button = event.target.closest ? event.target.closest('.tab') : null;
        if (!button) { return; }
        switchPeriod(button.getAttribute('data-period'), true);
      });
    }

    if (dom.tagBar) {
      dom.tagBar.addEventListener('click', function (event) {
        var chip = event.target.closest ? event.target.closest('.chip') : null;
        if (!chip) { return; }
        var next = chip.getAttribute('data-tag') || '';
        if (next === feedOf(state.period).tag) { return; }
        applyTag(next);
      });
    }

    // 历史归档：data-snap="" 表示回最新，否则是某一天的快照名
    if (dom.historyBar) {
      dom.historyBar.addEventListener('click', function (event) {
        // 「全部」只开合面板，不换榜 —— 必须先判它，否则会被下面的 .hchip 分支漏过去
        var all = event.target.closest ? event.target.closest('.hall') : null;
        if (all) { setHistoryPop(dom.historyPop.hidden); return; }

        var chip = event.target.closest ? event.target.closest('.hchip') : null;
        if (!chip) { return; }
        setHistoryPop(false);
        var name = chip.getAttribute('data-snap') || '';
        applyRoute(state.period, name, false);
      });
    }

    // 「全部归档」面板里的行是**跨周期**的：点它可能同时换榜 + 换期，
    // 所以走 applyRoute 而不是 switchPeriod，由它统一负责重置 feed 与写 hash
    if (dom.historyPop) {
      dom.historyPop.addEventListener('click', function (event) {
        var row = event.target.closest ? event.target.closest('.hrow') : null;
        if (!row) { return; }
        var period = row.getAttribute('data-period') || state.period;
        var name = row.getAttribute('data-snap') || '';
        setHistoryPop(false);
        applyRoute(period, name, false);
      });
    }

    // 语言切换走事件委托：页面头部与抽屉内部各有一个开关，共用同一套 [data-lang] 标记
    document.addEventListener('click', function (event) {
      if (!event.target || !event.target.closest) { return; }
      // 点到面板与「全部」按钮以外的地方就收起面板（判 .hall 是因为开合由上面的
      // 处理器负责，这里再收一次会让它刚展开就被关掉）
      if (dom.historyPop && !dom.historyPop.hidden &&
          !event.target.closest('.history-pop') && !event.target.closest('.hall')) {
        setHistoryPop(false);
      }
      if (event.target.closest('[data-theme-toggle]')) {
        setTheme(state.theme === 'dark' ? 'light' : 'dark');
        return;
      }
      var target = event.target.closest('[data-lang]');
      if (target) {
        setLang(target.getAttribute('data-lang'));
        return;
      }
      // 点到开关外壳或中间的 "/" 时整体切换
      if (event.target.closest('.lang-switch')) {
        setLang(state.lang === 'zh' ? 'en' : 'zh');
      }
    });

    if (dom.board) {
      dom.board.addEventListener('click', function (event) {
        var button = event.target.closest ? event.target.closest('.detail-btn') : null;
        if (!button) { return; }
        var idx = Number(button.getAttribute('data-idx'));
        openDrawer(currentSource()[idx]);
      });
    }

    // 头像降级：avatars.githubusercontent.com 在部分网络环境下不可达，加载失败时不能留下碎图。
    // 卡片里的头像直接移除（标题本身已有 owner 名），抽屉里的换成首字母占位块，
    // 与"该仓库本来就没有头像"时的形态保持一致。
    // 注意：<img> 的 error 事件不冒泡，必须挂捕获阶段才能收到。
    document.addEventListener('error', function (event) {
      var el = event.target;
      if (!el || el.tagName !== 'IMG') { return; }
      var cls = String(el.className || '');
      if (cls.indexOf('repo-avatar') === -1 && cls.indexOf('drawer-avatar') === -1) { return; }
      var parent = el.parentNode;
      if (!parent) { return; }
      if (cls.indexOf('drawer-avatar') !== -1) {
        var span = document.createElement('span');
        span.className = 'drawer-avatar is-fallback';
        span.textContent = el.getAttribute('data-initial') || '?';
        parent.replaceChild(span, el);
      } else {
        parent.removeChild(el);
      }
    }, true);

    // 用户没有手动选过主题时，跟随系统偏好实时切换
    if (window.matchMedia) {
      var darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
      var onSchemeChange = function (event) {
        var saved = null;
        try { saved = localStorage.getItem(THEME_KEY); } catch (e) { saved = null; }
        if (!saved) { setTheme(event.matches ? 'dark' : 'light', false); }
      };
      if (darkQuery.addEventListener) { darkQuery.addEventListener('change', onSchemeChange); }
      else if (darkQuery.addListener) { darkQuery.addListener(onSchemeChange); }
    }

    if (dom.drawerMask) { dom.drawerMask.addEventListener('click', closeDrawer); }
    if (dom.drawerClose) { dom.drawerClose.addEventListener('click', closeDrawer); }

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' || event.keyCode === 27) {
        // 面板开着时 Esc 先收面板并把焦点还回「全部」按钮（浮层优先于抽屉）
        if (dom.historyPop && !dom.historyPop.hidden) {
          setHistoryPop(false);
          var back = dom.historyBar && dom.historyBar.querySelector('.hall');
          if (back) { back.focus(); }
          return;
        }
        closeDrawer();
      }
    });

    window.addEventListener('hashchange', function () {
      var route = routeFromHash();
      // 索引可能还没到（用户手改 hash 直接跳到某一天），等它就位再迁移
      loadHistoryIndex().then(function () {
        applyRoute(route.period, route.snap, false);
      });
    });

    // 滚动加载：有 IntersectionObserver 就用它（只在"相交状态变化"时回调，最省）；
    // 没有的老浏览器退回滚动位置判断。
    //
    // 注意自动化测试里的坑：headless 但**不可见**的窗口下，IntersectionObserver
    // 的回调可能压根不投递，连 scroll 事件都不会产生 —— 用 window.scrollTo 去驱动
    // 无限滚动会随机卡在首片。真实浏览器不存在这个问题，所以测试要用真实滚轮事件
    // （page.mouse.wheel），别用 window.scrollTo。
    if ('IntersectionObserver' in window && dom.sentinel) {
      var observer = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting) { onReachEnd(); break; }
        }
      }, { rootMargin: '320px 0px' });
      observer.observe(dom.sentinel);
    } else {
      window.addEventListener('scroll', function () {
        if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 320) {
          onReachEnd();
        }
      });
    }
  }

  function init() {
    try {
      var saved = localStorage.getItem(LANG_KEY);
      if (saved && I18N[saved]) {
        state.lang = saved;
      } else if (navigator.language && navigator.language.toLowerCase().indexOf('zh') !== 0) {
        state.lang = 'en';
      }
    } catch (e) { /* 忽略 */ }

    // 主题已由 index.html 内联脚本在首屏绘制前定好，这里只接管状态与文案
    setTheme(document.documentElement.getAttribute('data-theme'), false);

    bindEvents();

    // 首屏就把三个周期的「实时榜 updatedAt」判据驱动起来（并行），并起兜底定时器 ——
    // 判据未定的周期历史行不参与渲染，越早定下来、历史行越快给出正确且一次到位的结果。
    primeHistoryLiveState();

    var route = routeFromHash();
    if (route.snap) {
      // 深链直接指向某一天：索引很小，等它就位再渲染，
      // 免得先画「最新」再跳成快照（那一下闪烁比等 20ms 更扎眼）
      loadHistoryIndex().then(function () {
        applyRoute(route.period, route.snap, true);
      });
    } else {
      // 第三个参数 isBoot=true：首屏第一片到位后，后台预取其余两个榜单
      switchPeriod(route.period, true, true);
      // 历史索引不进首屏关键路径：主榜单先出来，到了再把历史行补上。
      // 该行高度由 CSS 钉死，晚一点填不会引起任何跳动。
      loadHistoryIndex();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
