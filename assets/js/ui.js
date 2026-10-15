/* ui.js — application shell: state, pipeline, views and interaction. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  /* ---------------- formatting helpers ---------------- */

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtNum(v) {
    if (v === null || v === undefined) return '—';
    var n = Number(v);
    if (!isFinite(n)) return '—';
    if (Number.isInteger(n)) return String(n);
    if (Math.abs(n) < 1e-6 && n !== 0) return n.toExponential(2);
    return String(Number(n.toFixed(4)));
  }
  function fmtBytes(b) {
    if (!b) return '0 B';
    var u = ['B', 'KB', 'MB', 'GB'], i = 0, x = b;
    while (x >= 1024 && i < u.length - 1) { x /= 1024; i++; }
    return (i === 0 ? x : x.toFixed(1)) + ' ' + u[i];
  }
  function fmtInt(n) { return n == null ? '—' : Number(n).toLocaleString('en-US'); }

  function dtypeClass(dt) {
    if (dt === 'int64' || dt === 'float64') return 'dt-num';
    if (dt === 'bool') return 'dt-bool';
    if (dt === 'datetime64') return 'dt-date';
    if (!dt) return 'dt-null';
    return 'dt-obj';
  }
  function dtypeLabel(dt) {
    var k = 'dtype.' + (dt || 'null');
    return window.I18N[k] ? t(k) : (dt || 'null');
  }
  function typeTag(dt) { return '<span class="tag ' + dtypeClass(dt) + '">' + esc(dtypeLabel(dt)) + '</span>'; }
  function aggLabel(f) {
    var k = 'agg.' + f;
    return window.I18N[k] ? t(k) : f;
  }
  /* pandas' describe() labels its rows count/mean/std/min/… — translate those
     labels for display; the statistics themselves are untouched. */
  function describeLocalized(df) {
    var d = df.describe();
    var map = { count: t('agg.count'), mean: t('agg.mean'), std: t('agg.std'), min: t('agg.min'), max: t('agg.max') };
    var cols = [{
      name: t('describe.statLabel'), dtype: 'object',
      values: d.series('stat').map(function (v) { return map[v] === undefined ? v : map[v]; })
    }];
    d.columns().forEach(function (c) {
      if (c !== 'stat') cols.push({ name: c, dtype: d.dtype(c), values: d.series(c) });
    });
    return new DF.DataFrame(cols);
  }

  function cellHTML(v, dt) {
    if (v === null || v === undefined) return '<td class="cell-null">' + esc(t('table.null')) + '</td>';
    if (typeof v === 'number') return '<td class="num">' + esc(fmtNum(v)) + '</td>';
    if (typeof v === 'boolean') return '<td>' + esc(t(v ? 'bool.true' : 'bool.false')) + '</td>';
    var s = String(v);
    return '<td title="' + esc(s) + '">' + esc(s.length > 60 ? s.slice(0, 60) + '…' : s) + '</td>';
  }

  /* ---------------- icons (used inside JS-rendered markup) ---------------- */

  var ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    download: '<path d="M12 4v11M12 15l-4-4M12 15l4-4M5 19h14"/>',
    copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M15 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
    sortAsc: '<path d="M7 19V5M7 5l-3 3M7 5l3 3"/>',
    sortDesc: '<path d="M7 5v14M7 19l-3-3M7 19l3-3"/>',
    wand: '<path d="M15 4l5 5M13 6l5 5-9 9-5-5z"/><path d="M6 15l3 3"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
    code: '<path d="M9 8l-4 4 4 4M15 8l4 4-4 4"/>',
    lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v16M16 4v16"/>'
  };
  function ic(name, size) {
    return '<svg viewBox="0 0 24 24" width="' + (size || 15) + '" height="' + (size || 15) + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg>';
  }

  /* ---------------- state ---------------- */

  var OP_TYPES = ['select', 'filter', 'sort', 'missing', 'duplicates', 'assign', 'columns', 'pivot'];

  var state = {
    base: null,
    baseId: null,
    baseLabel: { zh: '—', en: '—' },
    baseIsSample: true,
    pipeline: [],
    current: null,
    pipelineError: null,
    view: 'source',
    page: 1,
    pageSize: 25,
    dense: false,
    visibleCols: null
  };

  var ui = {
    select: { cols: null },
    filter: { logic: 'and', conds: [] },
    sort: { keys: [] },
    missing: { subset: null, action: 'drop', how: 'any', method: 'mean', value: '' },
    duplicates: { subset: null, keep: 'first' },
    assign: { name: '', expr: '' },
    columns: { tab: 'rename', renameFrom: '', renameTo: '', dropCols: null, castCol: '', castTo: 'float64' },
    pivot: { index: '', columns: '', values: '', aggfunc: 'mean' },
    describe: { col: '' },
    counts: { col: '', normalize: false, top: 12 },
    corr: { method: 'pearson', x: '', y: '', color: '' },
    charts: { type: 'bar', x: '', y: '', agg: 'sum', group: '', top: 20, sort: 'desc' },
    table: { colsOpen: false }
  };

  var viewCharts = [];
  var opSeq = 0;

  function allCols() { return state.current ? state.current.columns() : []; }
  function numericCols() { return state.current ? state.current.numericColumns() : []; }
  function categoricalCols() {
    if (!state.current) return [];
    return state.current.columns().filter(function (c) { return state.current.dtype(c) !== 'float64' && state.current.dtype(c) !== 'int64'; });
  }
  // low-cardinality columns make far better default keys than id-like columns
  function preferredCats() {
    var df = state.current; if (!df) return [];
    var arr = [];
    df.columns().forEach(function (c) {
      var dt = df.dtype(c);
      if (dt === 'float64' || dt === 'int64') return;
      var u = df.nunique(c);
      if (u >= 2 && u <= 30) arr.push({ c: c, u: u, bool: dt === 'bool' });
    });
    arr.sort(function (a, b) { return (a.bool - b.bool) || (a.u - b.u); });
    return arr.map(function (o) { return o.c; });
  }
  function bestCat(fallback) { var p = preferredCats(); return p[0] || fallback || ''; }

  /* ---------------- chart helpers ---------------- */

  function setChart(id, option, boxId) {
    var el = $(id); if (!el) return null;
    var inst = echarts.getInstanceByDom(el);
    if (!inst) { inst = Charts.mount(el, option); viewCharts.push(inst); }
    else inst.setOption(option, true);
    return inst;
  }
  function disposeCharts() {
    viewCharts.forEach(function (c) { try { c.dispose(); } catch (e) { } });
    viewCharts = [];
  }
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { viewCharts.forEach(function (c) { try { c.resize(); } catch (e) { } }); }, 140);
  });

  /* ---------------- generic markup helpers ---------------- */

  function card(title, body, tools, cls) {
    var hasHead = title !== null || tools;
    var head = hasHead ? '<div class="card-head">' + (title !== null ? '<h3>' + title + '</h3>' : '') + (tools ? '<div class="card-tools">' + tools + '</div>' : '') + '</div>' : '';
    return '<section class="card ' + (cls || '') + ' rise">' + head + body + '</section>';
  }
  function field(label, control, hint) {
    return '<div class="field"><label>' + label + '</label>' + control + (hint ? '<div class="hint">' + hint + '</div>' : '') + '</div>';
  }
  function optionList(options, selected) {
    return options.map(function (o) {
      var val = typeof o === 'string' ? o : o.v;
      var lab = typeof o === 'string' ? o : o.label;
      return '<option value="' + esc(val) + '"' + (String(val) === String(selected) ? ' selected' : '') + '>' + esc(lab) + '</option>';
    }).join('');
  }
  function ctlSelect(id, options, selected) {
    return '<select class="ctl" id="' + id + '">' + optionList(options, selected) + '</select>';
  }
  function colSelect(id, cols, selected, allowEmpty) {
    var opts = allowEmpty ? [{ v: '', label: '(' + t('common.none') + ')' }] : [];
    cols.forEach(function (c) { opts.push({ v: c, label: c }); });
    return ctlSelect(id, opts, selected);
  }
  function checkGrid(items, active) {
    active = active || [];
    return '<div class="check-grid">' + items.map(function (c) {
      var on = active.indexOf(c) !== -1;
      return '<label class="check' + (on ? ' on' : '') + '"><input type="checkbox" value="' + esc(c) + '"' + (on ? ' checked' : '') + '><span class="ctext">' + esc(c) + '</span></label>';
    }).join('') + '</div>';
  }
  function emptyBox(title, sub) {
    return '<div class="empty"><div class="big">◍</div><div class="e-title">' + esc(title) + '</div>' + (sub ? '<div class="e-sub">' + esc(sub) + '</div>' : '') + '</div>';
  }

  function dataTable(df, opts) {
    opts = opts || {};
    var cols = opts.cols || df.columns();
    if (!cols.length) return emptyBox(t('common.none'), '');
    var types = df.dtypes();
    var start = opts.start || 0;
    var limit = opts.limit === undefined ? df.nrows : opts.limit;
    var end = Math.min(df.nrows, start + limit);
    var head = '<thead><tr>';
    if (opts.index !== false) head += '<th class="idx-cell">' + esc(opts.indexLabel || t('table.index')) + '</th>';
    cols.forEach(function (c) {
      var ind = opts.sortMark && opts.sortMark[c];
      head += '<th' + (opts.sortable ? ' class="sortable" data-col="' + esc(c) + '"' : '') + '><span class="th-inner">' + esc(c) + typeTag(types[c]) +
        (ind ? '<span class="sort-ind">' + (ind === 'asc' ? '▲' : '▼') + '</span>' : '') + '</span></th>';
    });
    head += '</tr></thead>';
    var body = '<tbody>';
    for (var i = start; i < end; i++) {
      body += '<tr>';
      if (opts.index !== false) body += '<td class="idx-cell">' + (df.index[i] !== undefined ? df.index[i] : i) + '</td>';
      for (var k = 0; k < cols.length; k++) body += cellHTML(df.series(cols[k])[i], types[cols[k]]);
      body += '</tr>';
    }
    body += '</tbody>';
    return '<div class="table-wrap"><table class="data' + (state.dense ? ' compact' : '') + '">' + head + body + '</table></div>';
  }

  /* ---------------- operation implementations ---------------- */

  function evalColumn(df, expr) {
    var reserved = { 'this': 1, 'function': 1, 'return': 1, 'var': 1, 'let': 1, 'const': 1, 'new': 1, 'typeof': 1, 'in': 1, 'instanceof': 1, 'delete': 1, 'void': 1, 'do': 1, 'if': 1, 'else': 1, 'for': 1, 'while': 1, 'class': 1, 'row': 1, 'df': 1, 'Math': 1 };
    var valid = df.columns().filter(function (c) { return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(c) && !reserved[c]; });
    var fn;
    try {
      fn = new Function('row', valid.join(','), 'return (' + expr + ');');
    } catch (e) { throw new Error(e.message); }
    var out = [];
    for (var i = 0; i < df.nrows; i++) {
      var row = df.row(i);
      var args = valid.map(function (c) { return df.series(c)[i]; });
      var v = fn.apply(null, [row].concat(args));
      if (typeof v === 'number' && !isFinite(v)) v = null;
      out.push(v === undefined ? null : v);
    }
    return out;
  }

  function isNull(v) { return v === null || v === undefined; }

  function cmpStr(a, b) { return String(a).localeCompare(String(b)); }
  function asNum(v) { if (v === null || v === undefined || v === '') return NaN; return Number(v); }

  function condFn(c, dtype) {
    var numeric = dtype === 'int64' || dtype === 'float64';
    var v1 = c.value, v2 = c.value2;
    return function (row) {
      var v = row[c.col];
      switch (c.op) {
        case 'isna': return isNull(v);
        case 'notna': return !isNull(v);
        case 'eq': if (isNull(v)) return false; return numeric ? asNum(v) === asNum(v1) : String(v).toLowerCase() === String(v1).toLowerCase();
        case 'ne': if (isNull(v)) return true; return numeric ? asNum(v) !== asNum(v1) : String(v).toLowerCase() !== String(v1).toLowerCase();
      }
      if (isNull(v)) return false;
      var a = numeric ? asNum(v) : v;
      var b = numeric ? asNum(v1) : v1;
      switch (c.op) {
        case 'gt': return numeric ? a > b : cmpStr(a, b) > 0;
        case 'ge': return numeric ? a >= b : cmpStr(a, b) >= 0;
        case 'lt': return numeric ? a < b : cmpStr(a, b) < 0;
        case 'le': return numeric ? a <= b : cmpStr(a, b) <= 0;
        case 'between': { var lo = numeric ? asNum(v1) : v1, hi = numeric ? asNum(v2 === '' ? v1 : v2) : (v2 === '' ? v1 : v2);
          return numeric ? (a >= lo && a <= hi) : (cmpStr(a, lo) >= 0 && cmpStr(a, hi) <= 0); }
        case 'contains': return String(v).toLowerCase().indexOf(String(v1).toLowerCase()) !== -1;
        case 'starts': return String(v).toLowerCase().indexOf(String(v1).toLowerCase()) === 0;
        case 'ends': { var s = String(v).toLowerCase(), t2 = String(v1).toLowerCase(); return s.slice(-t2.length) === t2; }
        case 'in': return String(v1).split(',').map(function (x) { return x.trim().toLowerCase(); }).indexOf(String(v).toLowerCase()) !== -1;
      }
      return true;
    };
  }

  function buildPredicate(conds, logic, dtypes) {
    var valid = conds.filter(function (c) { return c.col; });
    if (!valid.length) return function () { return true; };
    var fns = valid.map(function (c) { return condFn(c, dtypes[c.col]); });
    return function (row) {
      if (logic === 'or') {
        for (var i = 0; i < fns.length; i++) if (fns[i](row)) return true;
        return false;
      }
      for (var j = 0; j < fns.length; j++) if (!fns[j](row)) return false;
      return true;
    };
  }

  function applyColumnOps(df, p) {
    if (p.mode === 'rename') return p.from && p.to ? df.rename(renameMap(p.from, p.to)) : df;
    if (p.mode === 'drop') return (p.cols && p.cols.length) ? df.drop(p.cols) : df;
    if (p.mode === 'cast') {
      if (!p.col || !df.has(p.col)) return df;
      var m = {}; m[p.col] = p.to; return df.astype(p.col, p.to);
    }
    return df;
  }
  function renameMap(from, to) { var m = {}; m[from] = to; return m; }

  function applyOp(df, op) {
    var p = op.params;
    switch (op.type) {
      case 'select': return df.select(p.cols);
      case 'filter': return df.filterRows(buildPredicate(p.conds, p.logic, df.dtypes()));
      case 'sort': return df.sortValues(p.keys.map(function (k) { return k.col; }), p.keys.map(function (k) { return k.asc; }));
      case 'missing':
        return p.action === 'drop'
          ? df.dropna({ subset: p.subset, how: p.how, thresh: p.thresh })
          : df.fillna({ columns: p.subset, method: p.method, value: p.value });
      case 'duplicates': return df.dropDuplicates(p.subset, p.keep);
      case 'assign': return df.assign(p.name, evalColumn(df, p.expr));
      case 'columns': return applyColumnOps(df, p);
      case 'pivot': return df.pivotTable(p);
    }
    return df;
  }

  /* ---------------- pandas code generation ---------------- */

  var OPS = { eq: '==', ne: '!=', gt: '>', ge: '>=', lt: '<', le: '<=', contains: 'contains', starts: 'starts', ends: 'ends', in: 'in', isna: 'isna', notna: 'notna', between: 'between' };

  function opCode(op) {
    var p = op.params, py = function (s) { return '"' + String(s).replace(/"/g, '\\"') + '"'; };
    var lst = function (a) { return '[' + a.map(py).join(', ') + ']'; };
    switch (op.type) {
      case 'select': return 'df = df[' + lst(p.cols) + ']';
      case 'filter': {
        var parts = p.conds.filter(function (c) { return c.col; }).map(function (c) {
          var col = 'df[' + py(c.col) + ']';
          switch (c.op) {
            case 'isna': return col + '.isna()';
            case 'notna': return col + '.notna()';
            case 'contains': return col + '.str.contains(' + py(c.value) + ')';
            case 'starts': return col + '.str.startswith(' + py(c.value) + ')';
            case 'ends': return col + '.str.endswith(' + py(c.value) + ')';
            case 'in': return col + '.isin([' + String(c.value).split(',').map(function (s) { return py(s.trim()); }).join(', ') + '])';
            case 'between': return col + '.between(' + py(c.value) + ', ' + py(c.value2 || c.value) + ')';
            return col + ' ' + OPS[c.op] + ' ' + py(c.value);
          }
        });
        var join = p.logic === 'or' ? ' | ' : ' & ';
        return 'df = df[' + (parts.length ? '(' + parts.join(join) + ')' : 'True') + ']';
      }
      case 'sort': return 'df = df.sort_values(by=' + lst(p.keys.map(function (k) { return k.col; })) + ', ascending=' + JSON.stringify(p.keys.map(function (k) { return !!k.asc; })).replace(/true/g, 'True').replace(/false/g, 'False') + ')';
      case 'missing':
        return p.action === 'drop'
          ? 'df = df.dropna(subset=' + lst(p.subset || []) + ', how=' + py(p.how) + ')'
          : 'df = df.fillna(' + (p.method === 'value' ? py(p.value) : (p.method === 'zero' ? '0' : py(p.method))) + ')';
      case 'duplicates': return 'df = df.drop_duplicates(subset=' + lst(p.subset || []) + ', keep=' + (p.keep === 'false' ? 'False' : py(p.keep)) + ')';
      case 'assign': return 'df[' + py(p.name) + '] = ' + (p.expr || '…');
      case 'columns':
        if (p.mode === 'rename') return 'df = df.rename(columns={' + py(p.from) + ': ' + py(p.to) + '})';
        if (p.mode === 'drop') return 'df = df.drop(columns=' + lst(p.cols || []) + ')';
        return 'df = df.astype({' + py(p.col) + ': ' + py(p.to) + '})';
      case 'pivot': return 'df = pd.pivot_table(df, index=' + py(p.index) + ', columns=' + py(p.columns) + ', values=' + py(p.values) + ', aggfunc=' + py(p.aggfunc) + ')';
    }
    return '';
  }

  function opLabel(op) {
    var p = op.params;
    switch (op.type) {
      case 'select': return t('op.select') + ' · ' + (p.cols || []).length;
      case 'filter': return t('op.filter') + ' · ' + (p.conds || []).length;
      case 'sort': return t('op.sort') + ' · ' + (p.keys || []).map(function (k) { return k.col + (k.asc ? '↑' : '↓'); }).join(', ');
      case 'missing': return t('op.missing') + ' · ' + t('missing.action.' + p.action);
      case 'duplicates': return t('op.duplicates') + ' · ' + (p.subset || []).length;
      case 'assign': return t('op.assign') + ' · ' + p.name;
      case 'columns': return t('op.columns') + ' · ' + p.mode;
      case 'pivot': return t('op.pivot') + ' · ' + p.index + '×' + p.columns;
    }
    return op.type;
  }

  /* ---------------- pipeline & chrome ---------------- */

  function recompute() {
    var df = state.base, err = null;
    for (var i = 0; i < state.pipeline.length; i++) {
      var op = state.pipeline[i];
      try { df = applyOp(df, op); op.error = null; }
      catch (e) { op.error = String((e && e.message) || e); err = { i: i, msg: op.error }; break; }
    }
    state.current = df;
    state.pipelineError = err;
    state.visibleCols = null;
    state.page = 1;
  }

  function addOp(type, params) {
    state.pipeline.push({ id: 'op' + (++opSeq), type: type, params: params });
    recompute();
    location.hash = '#table';
    go('table');
  }

  function removeOp(id) {
    state.pipeline = state.pipeline.filter(function (o) { return o.id !== id; });
    recompute();
    render();
  }

  function renderPipeline() {
    var box = $('pipeline-chips');
    $('pipeline-base').textContent = t('pipeline.base') + ' · ' + state.baseLabel[getLang()];
    if (!state.pipeline.length) {
      box.innerHTML = '<span class="pipeline-empty">' + esc(t('pipeline.empty')) + '</span>';
      $('btn-clear-pipeline').hidden = true;
      return;
    }
    $('btn-clear-pipeline').hidden = false;
    box.innerHTML = state.pipeline.map(function (op, i) {
      return '<span class="pipeline-chip" data-op="' + op.id + '"' + (op.error ? ' style="border-color:var(--danger)"' : '') + '>' +
        '<span class="idx">' + (i + 1) + '</span>' + esc(opLabel(op)) +
        '<button class="x" data-remove="' + op.id + '" title="' + esc(t('action.remove')) + '">×</button></span>' +
        (i < state.pipeline.length - 1 ? '<span class="pipeline-arrow">›</span>' : '');
    }).join('');
    box.querySelectorAll('[data-remove]').forEach(function (b) {
      b.addEventListener('click', function () { removeOp(b.getAttribute('data-remove')); });
    });
  }

  function renderNavBadges() {
    document.querySelectorAll('[data-badge]').forEach(function (el) {
      var type = el.getAttribute('data-badge');
      var n = 0;
      if (OP_TYPES.indexOf(type) !== -1) n = state.pipeline.filter(function (o) { return o.type === type; }).length;
      if (n > 0) { el.textContent = n; el.hidden = false; } else el.hidden = true;
    });
  }

  function renderStatus() {
    var df = state.current, bar = $('status-bar');
    if (!df) { bar.innerHTML = ''; return; }
    var info = df.info();
    var nulls = 0;
    info.forEach(function (r) { nulls += r.nulls; });
    bar.innerHTML =
      '<span>' + esc(t('status.rows')) + ' <b>' + fmtInt(df.nrows) + '</b></span>' +
      '<span>' + esc(t('status.cols')) + ' <b>' + fmtInt(df.ncols) + '</b></span>' +
      '<span>' + esc(t('status.nulls')) + ' <b>' + fmtInt(nulls) + '</b></span>' +
      '<span>' + esc(t('status.memory')) + ' <b>' + fmtBytes(df.memoryUsage()) + '</b></span>' +
      '<span class="spacer"></span>' +
      '<span>' + esc(t('status.hint')) + '</span>';
    // header pill
    $('pill-name').textContent = state.baseLabel[getLang()];
    $('pill-meta').textContent = df.nrows + ' × ' + df.ncols +
      (state.pipeline.length ? ' · ' + state.pipeline.length + ' ' + t('header.steps') : '');
  }

  function refreshBadgesAndPipeline() { renderPipeline(); renderNavBadges(); renderStatus(); }

  /* ---------------- navigation ---------------- */

  function go(view) {
    state.view = view;
    document.querySelectorAll('.nav-item').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === view);
    });
    render();
  }

  function render() {
    disposeCharts();
    refreshBadgesAndPipeline();
    var root = $('view-root');
    var fn = VIEWS[state.view] || VIEWS.source;
    root.scrollTop = 0;
    root.innerHTML = '';
    fn(root);
  }

  /* ---------------- shared view fragments ---------------- */

  function head(titleKey, descKey, extra) {
    return '<div class="view-head"><div><h2>' + esc(t(titleKey)) + '</h2><div class="sub">' + esc(t(descKey)) + '</div></div>' + (extra ? '<div class="head-extra">' + extra + '</div>' : '') + '</div>';
  }
  function errBanner() {
    if (!state.pipelineError) return '';
    return '<div class="banner err">' + esc(t('assign.err', { msg: state.pipelineError.msg })) + '</div>';
  }

  /* ================================================================
     VIEW: source
     ================================================================ */
  function renderSource(root) {
    var df = state.current;
    var info = df.info(), nulls = 0;
    info.forEach(function (r) { nulls += r.nulls; });
    var kpis = '<div class="kpi-grid rise">' +
      kpi(t('source.kpi.rows'), fmtInt(df.nrows)) +
      kpi(t('source.kpi.cols'), fmtInt(df.ncols)) +
      kpi(t('source.kpi.memory'), fmtBytes(df.memoryUsage())) +
      kpi(t('source.kpi.missing'), fmtInt(nulls), null, nulls ? 'accent' : '') +
      '</div>';

    var load = card(t('source.title'),
      '<div class="dropzone" id="dropzone">' +
      '<div class="dz-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M12 4L7.5 8.5M12 4l4.5 4.5"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg></div>' +
      '<div class="dz-title">' + esc(t('source.drop.title')) + '</div>' +
      '<div class="dz-hint">' + esc(t('source.drop.hint')) + '</div></div>' +
      '<div class="dz-or">' + esc(t('source.paste.title')) + '</div>' +
      '<textarea class="ctl" id="paste-area" placeholder="' + esc(t('source.paste.ph')) + '"></textarea>' +
      '<div class="row" style="margin-top:8px"><button class="btn small" id="btn-paste">' + ic('check') + esc(t('action.load')) + '</button></div>' +
      '<div class="dz-or">URL</div>' +
      '<div class="row"><input class="ctl grow" id="url-input" placeholder="' + esc(t('source.url.ph')) + '"><button class="btn small" id="btn-url">' + esc(t('action.load')) + '</button></div>' +
      '<div id="load-msg"></div>',
      '<button class="btn small ghost" id="btn-browse">' + ic('plus') + esc(t('action.load')) + '</button>');

    var samples = card(t('source.samples'),
      '<div class="grid cols-3" style="gap:12px">' + Object.keys(DATASETS).map(function (id) {
        var d = DATASETS[id];
        return '<button class="sample-card' + (state.baseIsSample && state.baseId === id ? ' active' : '') + '" data-sample="' + id + '">' +
          '<span class="s-name">' + esc(d.name[getLang()]) + (state.baseIsSample && state.baseId === id ? '<span class="s-sample-badge">✓</span>' : '') + '</span>' +
          '<span class="s-desc">' + esc(d.desc[getLang()]) + '</span></button>';
      }).join('') + '</div>');

    var structure = card(t('source.info'),
      '<div class="pill-row" style="margin-bottom:14px">' + info.map(function (r) {
        return '<span class="pill">' + esc(r.column) + ' ' + typeTag(r.dtype) + '</span>';
      }).join('') + '</div>' +
      dataTable(df, { limit: 8, indexLabel: t('table.index') }),
      '<span class="sub">' + esc(t('source.preface')) + '</span>');

    root.innerHTML = '<div class="view-inner">' +
      head('source.title', 'source.desc') +
      kpis +
      '<div class="grid cols-2" style="margin-top:16px">' + load + samples + '</div>' +
      '<div style="margin-top:16px">' + structure + '</div>' +
      '</div>';

    var dz = $('dropzone');
    dz.addEventListener('click', function () { $('file-input').click(); });
    $('btn-browse').addEventListener('click', function () { $('file-input').click(); });
    dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('drag'); });
    dz.addEventListener('dragleave', function () { dz.classList.remove('drag'); });
    dz.addEventListener('drop', function (e) {
      e.preventDefault(); dz.classList.remove('drag');
      if (e.dataTransfer.files && e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0]);
    });
    $('btn-paste').addEventListener('click', function () { loadText($('paste-area').value, 'pasted-data'); });
    $('btn-url').addEventListener('click', function () {
      var url = $('url-input').value.trim();
      if (!url) return;
      loadURL(url);
    });
    root.querySelectorAll('[data-sample]').forEach(function (b) {
      b.addEventListener('click', function () { loadSample(b.getAttribute('data-sample')); });
    });
  }
  function kpi(label, value, foot, accent) {
    return '<div class="kpi' + (accent ? ' ' + accent : '') + '"><div class="k-label">' + esc(label) + '</div><div class="k-value">' + value + '</div>' + (foot ? '<div class="k-foot">' + foot + '</div>' : '') + '</div>';
  }

  function loadMsg(html, cls) { var el = $('load-msg'); if (el) el.innerHTML = '<div class="banner ' + (cls || 'warn') + '" style="margin-top:12px">' + html + '</div>'; }
  function toast(msg, err) {
    var el = $('toast');
    el.textContent = msg;
    el.className = 'toast show' + (err ? ' err' : '');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.className = 'toast'; }, 2200);
  }

  function setBase(df, label, isSample, id) {
    state.base = df; state.baseLabel = label; state.baseIsSample = !!isSample; state.baseId = id || null;
    state.pipeline = []; state.pipelineError = null;
    state.visibleCols = null; state.page = 1;
    Object.keys(ui).forEach(function (k) {
      if (k === 'filter' || k === 'sort') ui[k] = Object.assign({}, ui[k]);
    });
    ui.select.cols = null; ui.missing.subset = null; ui.duplicates.subset = null;
    recompute(); render();
  }
  function loadSample(id) {
    var d = DATASETS[id];
    setBase(d.build(getLang()), d.name, true, id);
    toast(d.name[getLang()]);
    go('overview');
  }
  function parseAny(text, name) {
    if (/\.json$/i.test(name || '') || /^\s*[\[{]/.test(text)) {
      try { return DF.readJSON(text); } catch (e) { return DF.parseCSV(text); }
    }
    return DF.parseCSV(text);
  }
  function loadText(text, name) {
    if (!text || !text.trim()) { loadMsg(esc(t('source.err.empty')), 'err'); return; }
    try {
      var df = parseAny(text, name);
      if (!df.nrows && !df.ncols) { loadMsg(esc(t('source.err.empty')), 'err'); return; }
      setBase(df, { zh: name || 'data', en: name || 'data' }, false, null);
      toast((name || 'data') + ' · ' + df.nrows + ' × ' + df.ncols);
      go('overview');
    } catch (e) { loadMsg(esc(t('source.err.parse') + ' (' + e.message + ')'), 'err'); }
  }
  function loadFile(file) {
    var reader = new FileReader();
    reader.onload = function () { loadText(String(reader.result), file.name); };
    reader.onerror = function () { loadMsg(esc(t('source.err.parse')), 'err'); };
    reader.readAsText(file);
  }
  function loadURL(url) {
    loadMsg('<div class="spinner" style="width:20px;height:20px;margin:0 8px 0 0;display:inline-block;vertical-align:middle"></div>' + esc(t('source.loading')), 'ok');
    fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (txt) {
      var name = url.split('/').pop().split('?')[0] || 'remote-data';
      loadText(txt, name);
    }).catch(function () { loadMsg(esc(t('source.err.fetch')), 'err'); });
  }

  /* ================================================================
     VIEW: table
     ================================================================ */
  function renderTable(root) {
    var df = state.current;
    if (!df.ncols) { root.innerHTML = '<div class="view-inner">' + head('table.title', 'table.desc') + emptyBox(t('common.none')) + '</div>'; return; }
    var cols = state.visibleCols || df.columns();
    var totalPages = Math.max(1, Math.ceil(df.nrows / state.pageSize));
    if (state.page > totalPages) state.page = totalPages;
    var start = (state.page - 1) * state.pageSize;
    var tools =
      '<button class="btn small' + (state.dense ? ' primary' : '') + '" id="btn-dense">' + esc(t('table.rowDensity')) + '</button>' +
      '<button class="btn small" id="btn-cols">' + ic('film') + esc(t('table.columns')) + ' (' + cols.length + '/' + df.ncols + ')</button>' +
      '<button class="btn small" id="btn-csv">' + ic('download') + 'CSV</button>';

    var pager = '<div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:10px;margin-top:14px">' +
      '<div class="row"><span class="sub" style="color:var(--muted);font-size:12px">' + esc(t('table.perPage')) + '</span>' +
      '<select class="ctl" id="page-size" style="width:auto">' + optionList([10, 25, 50, 100, 200].map(function (n) { return { v: n, label: n }; }), state.pageSize) + '</select>' +
      '<span style="font-size:12px;color:var(--muted)">' + esc(t('table.showing', { n: fmtInt(df.nrows) })) + '</span></div>' +
      '<div class="row"><button class="btn small" id="pg-first">' + esc(t('table.first')) + '</button>' +
      '<button class="btn small" id="pg-prev">' + esc(t('table.prev')) + '</button>' +
      '<span style="font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums">' + esc(t('table.page', { a: state.page, b: totalPages })) + '</span>' +
      '<button class="btn small" id="pg-next">' + esc(t('table.next')) + '</button>' +
      '<button class="btn small" id="pg-last">' + esc(t('table.last')) + '</button></div></div>';

    root.innerHTML = '<div class="view-inner">' + errBanner() +
      head('table.title', 'table.desc') +
      card(null, dataTable(df, { cols: cols, start: start, limit: state.pageSize, sortable: true }) + pager, tools) +
      '<div id="cols-panel"></div></div>';

    $('btn-dense').addEventListener('click', function () { state.dense = !state.dense; render(); });
    $('btn-cols').addEventListener('click', function () { colsPanel(df); });
    $('btn-csv').addEventListener('click', function () { download(state.baseId ? state.baseId + '-filtered.csv' : 'dataframe.csv', df.toCSV()); });
    $('page-size').addEventListener('change', function () { state.pageSize = +this.value; state.page = 1; render(); });
    $('pg-first').addEventListener('click', function () { state.page = 1; render(); });
    $('pg-prev').addEventListener('click', function () { state.page = Math.max(1, state.page - 1); render(); });
    $('pg-next').addEventListener('click', function () { state.page = Math.min(totalPages, state.page + 1); render(); });
    $('pg-last').addEventListener('click', function () { state.page = totalPages; render(); });
    root.querySelectorAll('th.sortable').forEach(function (th) {
      th.addEventListener('click', function () { columnModal(th.getAttribute('data-col')); });
    });
  }

  function colsPanel(df) {
    var panel = $('cols-panel');
    if (panel._open) { panel.innerHTML = ''; panel._open = false; return; }
    var cur = state.visibleCols || df.columns();
    panel._open = true;
    panel.innerHTML = '<div style="margin-top:16px">' + card(t('table.columns'),
      checkGrid(df.columns(), cur) +
      '<div class="row" style="margin-top:12px"><button class="btn small" id="cp-all">' + esc(t('select.all')) + '</button>' +
      '<button class="btn small" id="cp-none">' + esc(t('select.none')) + '</button>' +
      '<button class="btn small primary" id="cp-apply">' + esc(t('action.apply')) + '</button></div>') + '</div>';
    $('cp-all').addEventListener('click', function () { panel.querySelectorAll('input').forEach(function (i) { i.checked = true; i.parentElement.classList.add('on'); }); });
    $('cp-none').addEventListener('click', function () { panel.querySelectorAll('input').forEach(function (i) { i.checked = false; i.parentElement.classList.remove('on'); }); });
    panel.querySelectorAll('input').forEach(function (i) {
      i.addEventListener('change', function () { i.parentElement.classList.toggle('on', i.checked); });
    });
    $('cp-apply').addEventListener('click', function () {
      var sel = Array.prototype.slice.call(panel.querySelectorAll('input:checked')).map(function (i) { return i.value; });
      state.visibleCols = sel.length ? sel : df.columns();
      render();
    });
  }

  function openModal(html) {
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = '<div class="modal rise">' + html + '</div>';
    document.body.appendChild(back);
    back.addEventListener('click', function (e) { if (e.target === back) close(); });
    function close() {
      var insts = back.querySelectorAll('.chart-box').length;
      // dispose any charts created inside the modal
      (back._charts || []).forEach(function (c) { try { c.dispose(); } catch (e) { } });
      back.remove();
    }
    back.close = close;
    return back;
  }

  function columnModal(col) {
    var df = state.current, dt = df.dtype(col), vals = df.series(col);
    var clean = Stats.clean(vals), nulls = vals.length - clean.length;
    var kind = (dt === 'int64' || dt === 'float64') ? 'num' : 'cat';
    var vc = df.valueCounts(col, { dropna: false }).slice(0, 12);
    var back = openModal(
      '<div class="card-head"><h3>' + esc(col) + ' ' + typeTag(dt) + '</h3><div class="card-tools"><button class="btn small" id="m-sort-asc">' + esc(t('sort.ascending')) + '</button><button class="btn small" id="m-sort-desc">' + esc(t('sort.descending')) + '</button><button class="btn small ghost" id="m-close">' + esc(t('action.close')) + '</button></div></div>' +
      '<div class="grid cols-2" style="gap:14px"><div>' +
      statLine(t('describe.st.nonNull'), fmtInt(vals.length - nulls)) +
      statLine(t('describe.nulls'), fmtInt(nulls) + ' (' + (vals.length ? (nulls / vals.length * 100).toFixed(1) : 0) + '%)') +
      statLine(t('chart.unique'), fmtInt(df.nunique(col))) +
      (kind === 'num' ?
        statLine(t('describe.st.mean'), fmtNum(Stats.mean(clean))) +
        statLine(t('describe.st.std'), fmtNum(Stats.std(clean, 1))) +
        statLine(t('describe.st.min'), fmtNum(Stats.min(clean))) +
        statLine(t('describe.st.median'), fmtNum(Stats.median(clean))) +
        statLine(t('describe.st.max'), fmtNum(Stats.max(clean))) +
        statLine(t('describe.st.skew'), fmtNum(Stats.skew(clean)))
        : '') +
      '</div><div><div class="chart-box short" id="modal-chart"></div></div></div>'
    );
    back._charts = [];
    if (kind === 'num') {
      var h = Stats.histogram(clean, Stats.binCount(clean.length));
      var labels = h.counts.map(function (_, i) { return fmtNum(h.edges[i]); });
      back._charts.push(Charts.mount($('modal-chart'), Charts.histogram({ labels: labels, counts: h.counts, valueName: col })));
    } else {
      back._charts.push(Charts.mount($('modal-chart'), Charts.bar({
        xName: '', valueName: t('chart.count'), horizontal: true,
        labels: vc.map(function (r) { return r.key === null ? '∅' : String(r.key); }).reverse(),
        series: [{ name: t('chart.count'), data: vc.map(function (r) { return r.count; }).reverse() }]
      })));
    }
    $('m-close').addEventListener('click', back.close);
    $('m-sort-asc').addEventListener('click', function () { back.close(); addOp('sort', { keys: [{ col: col, asc: true }] }); });
    $('m-sort-desc').addEventListener('click', function () { back.close(); addOp('sort', { keys: [{ col: col, asc: false }] }); });
  }
  function statLine(k, v) { return '<div class="stat-line"><span class="sl-k">' + esc(k) + '</span><span class="sl-v">' + esc(v) + '</span></div>'; }

  /* ================================================================
     VIEW: select columns
     ================================================================ */
  function renderSelect(root) {
    var cols = allCols();
    if (ui.select.cols === null) ui.select.cols = cols.slice();
    var active = ui.select.cols.filter(function (c) { return cols.indexOf(c) !== -1; });
    root.innerHTML = '<div class="view-inner">' + head('select.title', 'select.desc') +
      '<div class="split">' +
      card(t('select.title'),
        checkGrid(cols, active) +
        '<div class="row" style="margin-top:12px"><button class="btn small" id="s-all">' + esc(t('select.all')) + '</button>' +
        '<button class="btn small" id="s-none">' + esc(t('select.none')) + '</button>' +
        '<button class="btn small" id="s-inv">' + esc(t('select.invert')) + '</button></div>' +
        '<div class="row" style="margin-top:14px"><button class="btn primary" id="s-add">' + ic('plus') + esc(t('action.add')) + '</button></div>') +
      card(t('source.preface'), '<div id="s-preview"></div>') +
      '</div></div>';

    function sel() { return Array.prototype.slice.call(root.querySelectorAll('.check-grid input:checked')).map(function (i) { return i.value; }); }
    function update() {
      var s = sel();
      $('s-preview').innerHTML = s.length ? dataTable(state.current.select(s), { limit: 6 }) : emptyBox(t('select.empty'));
    }
    root.querySelectorAll('.check-grid input').forEach(function (i) {
      i.addEventListener('change', function () { i.parentElement.classList.toggle('on', i.checked); update(); });
    });
    $('s-all').addEventListener('click', function () { setAll(true); });
    $('s-none').addEventListener('click', function () { setAll(false); });
    $('s-inv').addEventListener('click', function () {
      root.querySelectorAll('.check-grid input').forEach(function (i) { i.checked = !i.checked; i.parentElement.classList.toggle('on', i.checked); });
      update();
    });
    function setAll(v) { root.querySelectorAll('.check-grid input').forEach(function (i) { i.checked = v; i.parentElement.classList.toggle('on', v); }); update(); }
    $('s-add').addEventListener('click', function () {
      var s = sel();
      if (!s.length) { toast(t('select.empty'), true); return; }
      ui.select.cols = s; addOp('select', { cols: s });
    });
    update();
  }

  /* ================================================================
     VIEW: filter
     ================================================================ */
  function renderFilter(root) {
    var cols = allCols(), dtypes = state.current.dtypes();
    var ops = ['eq', 'ne', 'gt', 'ge', 'lt', 'le', 'between', 'contains', 'starts', 'ends', 'in', 'isna', 'notna'];
    if (!ui.filter.conds.length) ui.filter.conds = [{ col: cols[0] || '', op: 'eq', value: '', value2: '' }];

    function condRow(c, idx) {
      return '<div class="cond-row" data-idx="' + idx + '">' +
        colSelect('c-col-' + idx, cols, c.col, false) +
        ctlSelect('c-op-' + idx, ops.map(function (o) { return { v: o, label: t('filter.op.' + o) }; }), c.op) +
        '<input class="ctl" id="c-val-' + idx + '" placeholder="' + esc(t('filter.valuePh')) + '" value="' + esc(c.value) + '">' +
        '<button class="x-btn" data-del="' + idx + '">' + ic('x', 14) + '</button></div>';
    }
    function rebuildConds() {
      $('cond-list').innerHTML = ui.filter.conds.map(condRow).join('');
      wireConds();
    }
    function wireConds() {
      root.querySelectorAll('.cond-row').forEach(function (r) {
        var idx = +r.getAttribute('data-idx');
        r.querySelector('select[id^="c-col"]').addEventListener('change', function () { ui.filter.conds[idx].col = this.value; update(); });
        r.querySelector('select[id^="c-op"]').addEventListener('change', function () { ui.filter.conds[idx].op = this.value; update(); });
        r.querySelector('input[id^="c-val"]').addEventListener('input', function () { ui.filter.conds[idx].value = this.value; update(); });
        r.querySelector('[data-del]').addEventListener('click', function () {
          ui.filter.conds.splice(idx, 1);
          if (!ui.filter.conds.length) ui.filter.conds.push({ col: cols[0] || '', op: 'eq', value: '', value2: '' });
          rebuildConds(); update();
        });
      });
    }
    function update() {
      var dtypesNow = state.current.dtypes();
      var pred = buildPredicate(ui.filter.conds, ui.filter.logic, dtypesNow);
      var res = state.current.filterRows(pred);
      $('f-count').innerHTML = '<b>' + esc(t('filter.matched', { n: fmtInt(res.nrows) })) + '</b> / ' + fmtInt(state.current.nrows);
      $('f-preview').innerHTML = dataTable(res, { limit: 60 });
    }

    root.innerHTML = '<div class="view-inner">' + head('filter.title', 'filter.desc') +
      '<div class="split wide-left">' +
      card(t('filter.title'),
        '<div class="field"><label>' + esc(t('filter.combine')) + '</label>' +
        '<div class="btn-group" id="f-logic"><button data-v="and" class="' + (ui.filter.logic === 'and' ? 'active' : '') + '">' + esc(t('filter.and')) + '</button>' +
        '<button data-v="or" class="' + (ui.filter.logic === 'or' ? 'active' : '') + '">' + esc(t('filter.or')) + '</button></div></div>' +
        '<div class="cond-list" id="cond-list"></div>' +
        '<div class="row" style="margin-top:12px"><button class="btn small" id="f-add">' + ic('plus') + esc(t('filter.add')) + '</button>' +
        '<button class="btn primary" id="f-apply" style="margin-left:auto">' + ic('plus') + esc(t('action.add')) + '</button></div>') +
      card(t('filter.preview'),
        '<div id="f-count" style="margin-bottom:10px;font-size:13px"></div><div id="f-preview"></div>') +
      '</div></div>';

    rebuildConds();
    root.querySelectorAll('#f-logic button').forEach(function (b) {
      b.addEventListener('click', function () {
        ui.filter.logic = b.getAttribute('data-v');
        root.querySelectorAll('#f-logic button').forEach(function (x) { x.classList.toggle('active', x === b); });
        update();
      });
    });
    $('f-add').addEventListener('click', function () { ui.filter.conds.push({ col: cols[0] || '', op: 'eq', value: '', value2: '' }); rebuildConds(); });
    $('f-apply').addEventListener('click', function () {
      var conds = [];
      root.querySelectorAll('.cond-row').forEach(function (r) {
        var col = r.querySelector('select[id^="c-col"]').value;
        var op = r.querySelector('select[id^="c-op"]').value;
        var val = r.querySelector('input[id^="c-val"]').value;
        if (col) conds.push({ col: col, op: op, value: val, value2: '' });
      });
      if (!conds.length) { toast(t('filter.pickColumn'), true); return; }
      addOp('filter', { conds: conds, logic: ui.filter.logic });
    });
    update();
  }

  /* ================================================================
     VIEW: sort
     ================================================================ */
  function renderSort(root) {
    var cols = allCols();
    if (!ui.sort.keys.length) ui.sort.keys = [{ col: cols[0] || '', asc: false }];
    function rebuild() {
      $('sort-keys').innerHTML = ui.sort.keys.map(function (k, i) {
        return '<div class="cond-row" data-idx="' + i + '" style="grid-template-columns:1fr auto auto">' +
          colSelect('k-col-' + i, cols, k.col, false) +
          '<button class="btn small" data-asc="' + i + '">' + (k.asc ? t('sort.ascending') : t('sort.descending')) + '</button>' +
          '<button class="x-btn" data-del="' + i + '">' + ic('x', 14) + '</button></div>';
      }).join('');
      wire();
      update();
    }
    function wire() {
      root.querySelectorAll('#sort-keys .cond-row').forEach(function (r) {
        var i = +r.getAttribute('data-idx');
        r.querySelector('select').addEventListener('change', function () { ui.sort.keys[i].col = this.value; update(); });
        r.querySelector('[data-asc]').addEventListener('click', function () { ui.sort.keys[i].asc = !ui.sort.keys[i].asc; rebuild(); });
        r.querySelector('[data-del]').addEventListener('click', function () { ui.sort.keys.splice(i, 1); if (!ui.sort.keys.length) ui.sort.keys.push({ col: cols[0] || '', asc: true }); rebuild(); });
      });
    }
    function update() {
      var keys = ui.sort.keys.filter(function (k) { return k.col; });
      if (!keys.length) { $('so-preview').innerHTML = emptyBox(t('common.none')); return; }
      var res = state.current.sortValues(keys.map(function (k) { return k.col; }), keys.map(function (k) { return k.asc; }));
      var marks = {}; keys.forEach(function (k) { marks[k.col] = k.asc ? 'asc' : 'desc'; });
      $('so-preview').innerHTML = dataTable(res, { limit: 40, sortMark: marks });
    }
    root.innerHTML = '<div class="view-inner">' + head('sort.title', 'sort.desc') +
      '<div class="split">' +
      card(t('sort.title'), '<div class="cond-list" id="sort-keys"></div>' +
        '<div class="row" style="margin-top:12px"><button class="btn small" id="so-add">' + ic('plus') + esc(t('sort.add')) + '</button>' +
        '<button class="btn primary" id="so-apply" style="margin-left:auto">' + ic('plus') + esc(t('action.add')) + '</button></div>') +
      card(t('filter.preview'), '<div id="so-preview"></div>') +
      '</div></div>';
    $('so-add').addEventListener('click', function () { ui.sort.keys.push({ col: cols[0] || '', asc: true }); rebuild(); });
    $('so-apply').addEventListener('click', function () {
      var keys = ui.sort.keys.filter(function (k) { return k.col; });
      if (!keys.length) { toast(t('filter.pickColumn'), true); return; }
      addOp('sort', { keys: JSON.parse(JSON.stringify(keys)) });
    });
    rebuild();
  }

  /* ================================================================
     VIEW: missing
     ================================================================ */
  function renderMissing(root) {
    var df = state.current;
    var counts = df.isnaCounts(), total = df.nrows;
    if (ui.missing.subset === null) ui.missing.subset = df.columns().slice();
    var subset = ui.missing.subset.filter(function (c) { return df.has(c); });
    var anyMissing = Object.keys(counts).some(function (c) { return counts[c] > 0; });

    var chartHTML = anyMissing
      ? '<div class="chart-box short" id="m-chart"></div>'
      : '<div class="banner ok">' + esc(t('missing.noMissing')) + '</div>';

    root.innerHTML = '<div class="view-inner">' + head('missing.title', 'missing.desc') +
      card(t('overview.missingChart'), chartHTML) +
      '<div class="split" style="margin-top:16px">' +
      card(t('missing.title'),
        '<div class="field"><label>' + esc(t('missing.subset')) + '</label>' + checkGrid(df.columns(), subset) + '</div>' +
        '<div class="field"><label>' + esc(t('missing.action')) + '</label>' +
        ctlSelect('m-action', [{ v: 'drop', label: t('missing.action.drop') }, { v: 'fill', label: t('missing.action.fill') }], ui.missing.action) + '</div>' +
        '<div id="m-extra"></div>' +
        '<div class="row" style="margin-top:14px"><button class="btn primary" id="m-apply">' + ic('plus') + esc(t('action.add')) + '</button></div>') +
      card(t('missing.after'), '<div id="m-preview"></div>') +
      '</div></div>';

    function extraFields() {
      if (ui.missing.action === 'drop') {
        return field(t('missing.how'), ctlSelect('m-how', [{ v: 'any', label: t('missing.how.any') }, { v: 'all', label: t('missing.how.all') }], ui.missing.how));
      }
      return field(t('missing.method'),
        ctlSelect('m-method', ['value', 'mean', 'median', 'mode', 'ffill', 'bfill', 'zero'].map(function (m) { return { v: m, label: t('missing.method.' + m) }; }), ui.missing.method)) +
        (ui.missing.method === 'value' ? field(t('missing.value'), '<input class="ctl" id="m-value" value="' + esc(ui.missing.value) + '">') : '');
    }
    function update() {
      subset = Array.prototype.slice.call(root.querySelectorAll('.check-grid input:checked')).map(function (i) { return i.value; });
      var res;
      if (ui.missing.action === 'drop') res = df.dropna({ subset: subset, how: ui.missing.how });
      else res = df.fillna({ columns: subset, method: ui.missing.method, value: ui.missing.value });
      var rc = res.isnaCounts(), before = 0, after = 0;
      subset.forEach(function (c) { before += counts[c]; after += rc[c]; });
      $('m-preview').innerHTML =
        '<div class="pill-row" style="margin-bottom:10px">' +
        '<span class="pill">' + esc(t('missing.before')) + ': ' + fmtInt(before) + '</span>' +
        '<span class="pill alt">' + esc(t('missing.after')) + ': ' + fmtInt(after) + '</span>' +
        '<span class="pill">' + res.nrows + ' × ' + res.ncols + '</span></div>' +
        dataTable(res, { limit: 25 });
    }
    $('m-extra').innerHTML = extraFields();
    function wireExtra() {
      var a = $('m-action');
      if (a) a.addEventListener('change', function () { ui.missing.action = this.value; $('m-extra').innerHTML = extraFields(); wireExtra(); update(); });
      var h = $('m-how');
      if (h) h.addEventListener('change', function () { ui.missing.how = this.value; update(); });
      var m = $('m-method');
      if (m) m.addEventListener('change', function () { ui.missing.method = this.value; $('m-extra').innerHTML = extraFields(); wireExtra(); update(); });
      var v = $('m-value');
      if (v) v.addEventListener('input', function () { ui.missing.value = this.value; update(); });
    }
    root.querySelectorAll('.check-grid input').forEach(function (i) {
      i.addEventListener('change', function () { i.parentElement.classList.toggle('on', i.checked); update(); });
    });
    wireExtra();
    if (anyMissing) {
      setChart('m-chart', Charts.missingBar({ columns: df.columns(), counts: counts, total: total }));
    }
    update();
  }

  /* ================================================================
     VIEW: duplicates
     ================================================================ */
  function renderDuplicates(root) {
    var df = state.current;
    if (ui.duplicates.subset === null) ui.duplicates.subset = df.columns().slice();
    var subset = ui.duplicates.subset.filter(function (c) { return df.has(c); });
    root.innerHTML = '<div class="view-inner">' + head('duplicates.title', 'duplicates.desc') +
      '<div class="split">' +
      card(t('duplicates.title'),
        '<div class="field"><label>' + esc(t('duplicates.subset')) + '</label>' + checkGrid(df.columns(), subset) + '</div>' +
        '<div class="field"><label>' + esc(t('duplicates.keep')) + '</label>' +
        ctlSelect('d-keep', ['first', 'last', 'false'].map(function (k) { return { v: k, label: t('duplicates.keep.' + k) }; }), ui.duplicates.keep) + '</div>' +
        '<div class="row" style="margin-top:14px"><button class="btn primary" id="d-apply">' + ic('plus') + esc(t('action.add')) + '</button></div>') +
      card(t('filter.preview'), '<div id="d-preview"></div>') +
      '</div></div>';

    function update() {
      subset = Array.prototype.slice.call(root.querySelectorAll('.check-grid input:checked')).map(function (i) { return i.value; });
      var flags = df.duplicated(subset.length ? subset : null, ui.duplicates.keep === 'false' ? 'first' : ui.duplicates.keep);
      var nDup = flags.filter(Boolean).length;
      var res = df.dropDuplicates(subset.length ? subset : null, ui.duplicates.keep === 'false' ? false : ui.duplicates.keep);
      $('d-preview').innerHTML =
        '<div class="banner ' + (nDup ? 'warn' : 'ok') + '">' + esc(t('duplicates.found', { n: fmtInt(nDup) })) + ' → ' + res.nrows + ' × ' + res.ncols + '</div>' +
        dataTable(res, { limit: 25 });
    }
    root.querySelectorAll('.check-grid input').forEach(function (i) {
      i.addEventListener('change', function () { i.parentElement.classList.toggle('on', i.checked); update(); });
    });
    $('d-keep').addEventListener('change', function () { ui.duplicates.keep = this.value; update(); });
    $('d-apply').addEventListener('click', function () {
      subset = Array.prototype.slice.call(root.querySelectorAll('.check-grid input:checked')).map(function (i) { return i.value; });
      addOp('duplicates', { subset: subset, keep: ui.duplicates.keep });
    });
    update();
  }

  /* ================================================================
     VIEW: assign
     ================================================================ */
  function renderAssign(root) {
    var df = state.current;
    var namePh = ui.assign.name || 'new_col';
    var exists = df.has(namePh);
    root.innerHTML = '<div class="view-inner">' + head('assign.title', 'assign.desc') +
      '<div class="split">' +
      card(t('assign.title'),
        field(t('assign.name'), '<input class="ctl" id="a-name" value="' + esc(namePh) + '">', exists ? t('assign.exists') : '') +
        field(t('assign.expr'), '<input class="ctl mono" id="a-expr" value="' + esc(ui.assign.expr) + '" placeholder="' + esc(t('assign.hint')) + '">') +
        '<div class="pill-row" style="margin:10px 0 14px">' + numericCols().slice(0, 10).map(function (c) { return '<span class="pill">' + esc(c) + '</span>'; }).join('') + '</div>' +
        '<div id="a-msg"></div>' +
        '<div class="row" style="margin-top:12px"><button class="btn primary" id="a-apply">' + ic('plus') + esc(t('action.add')) + '</button></div>') +
      card(t('filter.preview'), '<div id="a-preview">' + dataTable(df, { limit: 10 }) + '</div>') +
      '</div></div>';

    function update() {
      var nm = $('a-name').value, expr = $('a-expr').value;
      ui.assign.name = nm; ui.assign.expr = expr;
      if (!expr.trim()) { $('a-msg').innerHTML = ''; return; }
      try {
        var vals = evalColumn(df, expr);
        var test = df.assign(nm || 'new_col', vals);
        $('a-msg').innerHTML = '<div class="banner ok">✓ ' + esc(nm || 'new_col') + ' = ' + esc(expr) + ' (' + test.dtype(nm || 'new_col') + ')</div>';
        var cols = [].concat(df.columns().slice(0, 6), [nm || 'new_col']);
        $('a-preview').innerHTML = dataTable(test, { cols: cols, limit: 10 });
      } catch (e) {
        $('a-msg').innerHTML = '<div class="banner err">' + esc(t('assign.err', { msg: e.message })) + '</div>';
      }
    }
    $('a-name').addEventListener('input', update);
    $('a-expr').addEventListener('input', update);
    $('a-apply').addEventListener('click', function () {
      var nm = $('a-name').value.trim(), expr = $('a-expr').value.trim();
      if (!nm) { toast(t('assign.name'), true); return; }
      if (!expr) { toast(t('assign.expr'), true); return; }
      try { evalColumn(df, expr); } catch (e) { toast(t('assign.err', { msg: e.message }), true); return; }
      addOp('assign', { name: nm, expr: expr });
    });
    update();
  }

  /* ================================================================
     VIEW: column ops
     ================================================================ */
  function renderColumns(root) {
    var df = state.current, cols = df.columns();
    if (!ui.columns.renameFrom) ui.columns.renameFrom = cols[0] || '';
    if (ui.columns.dropCols === null) ui.columns.dropCols = [];
    if (!ui.columns.castCol) ui.columns.castCol = cols[0] || '';
    var dtypes = ['float64', 'int64', 'object', 'bool'];
    root.innerHTML = '<div class="view-inner">' + head('columns.title', 'columns.desc') +
      '<div class="grid cols-3">' +
      card(t('columns.rename'),
        field(t('common.column'), colSelect('r-from', cols, ui.columns.renameFrom, false)) +
        field(t('columns.newName'), '<input class="ctl" id="r-to" value="' + esc(ui.columns.renameTo) + '">') +
        '<button class="btn primary" id="r-apply" style="margin-top:12px">' + ic('plus') + esc(t('action.add')) + '</button>') +
      card(t('columns.dropTab'),
        checkGrid(cols, ui.columns.dropCols) +
        '<button class="btn primary" id="dr-apply" style="margin-top:12px">' + ic('plus') + esc(t('action.add')) + '</button>') +
      card(t('columns.cast'),
        field(t('common.column'), colSelect('c-col', cols, ui.columns.castCol, false)) +
        field(t('columns.toDtype'), ctlSelect('c-to', dtypes.map(function (d) { return { v: d, label: dtypeLabel(d) + ' (' + d + ')' }; }), ui.columns.castTo)) +
        '<button class="btn primary" id="c-apply" style="margin-top:12px">' + ic('plus') + esc(t('action.add')) + '</button>') +
      '</div>' +
      card(t('columns.keepNote'), '<div class="pill-row">' + df.columns().map(function (c) { return '<span class="pill">' + esc(c) + ' ' + typeTag(df.dtype(c)) + '</span>'; }).join('') + '</div>') +
      '</div>';

    $('r-apply').addEventListener('click', function () {
      var from = $('r-from').value, toRaw = $('r-to').value.trim();
      if (!toRaw) { toast(t('columns.newName'), true); return; }
      addOp('columns', { mode: 'rename', from: from, to: toRaw });
    });
    $('dr-apply').addEventListener('click', function () {
      var s = Array.prototype.slice.call(root.querySelectorAll('.check-grid input:checked')).map(function (i) { return i.value; });
      if (!s.length) { toast(t('select.empty'), true); return; }
      addOp('columns', { mode: 'drop', cols: s });
    });
    $('c-apply').addEventListener('click', function () {
      addOp('columns', { mode: 'cast', col: $('c-col').value, to: $('c-to').value });
    });
    root.querySelectorAll('.check-grid input').forEach(function (i) { i.addEventListener('change', function () { i.parentElement.classList.toggle('on', i.checked); }); });
  }

  /* ================================================================
     VIEW: pivot
     ================================================================ */
  function renderPivot(root) {
    var df = state.current, cols = df.columns(), nums = df.numericColumns(), cats = categoricalCols();
    var pref = preferredCats();
    // numeric columns first, then the rest — non-numeric values are only valid with 计数/count
    var allCols = nums.concat(cols.filter(function (c) { return nums.indexOf(c) === -1; }));
    if (!ui.pivot.index) ui.pivot.index = pref[0] || cats[0] || cols[0] || '';
    if (!ui.pivot.columns) ui.pivot.columns = (pref[1] || pref[0] || cats[0] || cols[0]);
    if (!ui.pivot.values) ui.pivot.values = nums[0] || cols[0] || '';
    function numeric(v) { return nums.indexOf(v) !== -1 || ui.pivot.aggfunc === 'count'; }
    function update() {
      var p = { index: ui.pivot.index, columns: ui.pivot.columns, values: ui.pivot.values, aggfunc: ui.pivot.aggfunc };
      if (!p.index || !p.columns || !p.values) { $('p-out').innerHTML = emptyBox(t('pivot.needNumeric')); return; }
      if (!numeric(p.values)) { $('p-out').innerHTML = '<div class="banner warn">' + esc(t('pivot.needNumeric')) + '</div>'; $('p-heat').innerHTML = ''; return; }
      var res = df.pivotTable(p);
      $('p-out').innerHTML = dataTable(res, { limit: 60 });
      var xLabels = res.columns().slice(1);
      var yLabels = res.series(p.index).map(function (v) { return v === null ? '∅' : String(v); });
      var data = [];
      for (var i = 0; i < res.nrows; i++) {
        for (var j = 1; j < res.ncols; j++) {
          var v = res.series(res.columns()[j])[i];
          if (v !== null && v !== undefined) data.push([j - 1, i, +v.toFixed ? +v.toFixed(3) : v]);
        }
      }
      var vals = data.map(function (d) { return d[2]; });
      setChart('p-heat', Charts.heatmap({
        xLabels: xLabels, yLabels: yLabels, data: data,
        min: vals.length ? Math.min.apply(null, vals) : 0,
        max: vals.length ? Math.max.apply(null, vals) : 1,
        showLabels: res.nrows <= 12 && xLabels.length <= 12
      }));
    }
    root.innerHTML = '<div class="view-inner">' + head('pivot.title', 'pivot.desc') +
      '<div class="split">' +
      card(t('pivot.title'),
        field(t('pivot.index'), colSelect('pv-index', cols, ui.pivot.index, false)) +
        field(t('pivot.columns'), colSelect('pv-columns', cols, ui.pivot.columns, false)) +
        field(t('pivot.values'), colSelect('pv-values', allCols, ui.pivot.values, false)) +
        field(t('pivot.aggfunc'), ctlSelect('pv-agg', ['mean', 'sum', 'count', 'median', 'min', 'max'].map(function (f) { return { v: f, label: aggLabel(f) }; }), ui.pivot.aggfunc)) +
        '<div class="row" style="margin-top:14px"><button class="btn primary" id="pv-apply">' + ic('plus') + esc(t('action.add')) + '</button></div>') +
      card(t('pivot.heatmapTitle'), '<div class="chart-box" id="p-heat"></div>') +
      '</div>' +
      '<div style="margin-top:16px">' + card(t('pivot.tableTitle'), '<div id="p-out"></div>') + '</div>' +
      '</div>';
    $('pv-index').addEventListener('change', function () { ui.pivot.index = this.value; update(); });
    $('pv-columns').addEventListener('change', function () { ui.pivot.columns = this.value; update(); });
    $('pv-values').addEventListener('change', function () {
      ui.pivot.values = this.value;
      // a non-numeric column can only be counted — switch aggfunc instead of refusing
      if (nums.indexOf(this.value) === -1 && ui.pivot.aggfunc !== 'count') {
        ui.pivot.aggfunc = 'count';
        $('pv-agg').value = 'count';
      }
      update();
    });
    $('pv-agg').addEventListener('change', function () { ui.pivot.aggfunc = this.value; update(); });
    $('pv-apply').addEventListener('click', function () {
      if (!numeric(ui.pivot.values)) { toast(t('pivot.needNumeric'), true); return; }
      addOp('pivot', JSON.parse(JSON.stringify(ui.pivot)));
    });
    update();
  }

  /* ================================================================
     VIEW: overview
     ================================================================ */
  function renderOverview(root) {
    var df = state.current;
    if (!df.ncols) { root.innerHTML = '<div class="view-inner">' + head('overview.title', 'overview.desc') + emptyBox(t('common.none')) + '</div>'; return; }
    var info = df.info(), nums = df.numericColumns(), cats = df.categoricalColumns();
    var nulls = 0; info.forEach(function (r) { nulls += r.nulls; });
    var typeCounts = {};
    info.forEach(function (r) { typeCounts[r.dtype] = (typeCounts[r.dtype] || 0) + 1; });

    var kpis = '<div class="kpi-grid rise">' +
      kpi(t('overview.kpi.rows'), fmtInt(df.nrows)) +
      kpi(t('overview.kpi.cols'), fmtInt(df.ncols)) +
      kpi(t('overview.kpi.numeric'), fmtInt(nums.length)) +
      kpi(t('overview.kpi.category'), fmtInt(cats.length)) +
      kpi(t('overview.kpi.missing'), fmtInt(nulls), nulls ? ((nulls / (df.nrows * df.ncols) * 100).toFixed(1) + '%') : '0%', nulls ? 'accent' : '') +
      kpi(t('overview.kpi.memory'), fmtBytes(df.memoryUsage())) +
      '</div>';

    var profiles = nums.slice(0, 6).map(function (c, i) {
      var vals = Stats.clean(df.series(c));
      var s = Stats.summarize(df.series(c));
      return '<div class="card rise" style="padding:14px"><div class="row" style="justify-content:space-between"><b style="font-size:13px">' + esc(c) + '</b>' + typeTag(df.dtype(c)) + '</div>' +
        '<div class="chart-box" id="ov-mini-' + i + '" style="min-height:96px;margin:6px 0"></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 12px">' +
        statLine(t('describe.st.mean'), fmtNum(s.mean)) + statLine(t('describe.st.std'), fmtNum(s.std)) +
        statLine(t('describe.st.min'), fmtNum(s.min)) + statLine(t('describe.st.max'), fmtNum(s.max)) + '</div></div>';
    }).join('');

    var catList = cats.length ? '<div class="pill-row">' + cats.map(function (c) {
      var u = df.nunique(c);
      return '<span class="pill">' + esc(c) + ' ' + typeTag(df.dtype(c)) + ' · ' + fmtInt(u) + '</span>';
    }).join('') + '</div>' : emptyBox(t('common.none'));

    root.innerHTML = '<div class="view-inner">' + errBanner() + head('overview.title', 'overview.desc') +
      kpis +
      '<div class="grid cols-2" style="margin-top:16px">' +
      card(t('overview.dtypeChart'), '<div class="chart-box short" id="ov-dtype"></div>') +
      card(t('overview.missingChart'), nulls ? '<div class="chart-box short" id="ov-missing"></div>' : '<div class="banner ok">' + esc(t('overview.missingFree')) + '</div>') +
      '</div>' +
      (nums.length ? '<div style="margin-top:16px">' + card(t('overview.numericProfile'), '<div class="grid cols-3" style="gap:12px">' + profiles + '</div>') + '</div>' : '') +
      '<div style="margin-top:16px">' + card(t('overview.catProfile'), catList) + '</div>' +
      '</div>';

    var th = Charts.theme();
    setChart('ov-dtype', Charts.bar({
      xName: '', valueName: t('chart.count'), horizontal: true,
      labels: Object.keys(typeCounts).map(dtypeLabel),
      series: [{ name: t('chart.count'), data: Object.keys(typeCounts).map(function (k) { return typeCounts[k]; }) }]
    }));
    if (nulls) setChart('ov-missing', Charts.missingBar({ columns: df.columns(), counts: df.isnaCounts(), total: df.nrows }));

    nums.slice(0, 6).forEach(function (c, i) {
      var vals = Stats.clean(df.series(c));
      var h = Stats.histogram(vals, Stats.binCount(vals.length));
      setChart('ov-mini-' + i, {
        animation: false, grid: { left: 2, right: 2, top: 4, bottom: 4, containLabel: false },
        tooltip: { trigger: 'axis', appendToBody: true, backgroundColor: th.bg2, borderColor: th.rule, textStyle: { color: th.ink, fontFamily: Charts.FONT, fontSize: 11 } },
        xAxis: { type: 'category', data: h.counts.map(function (_, k) { return fmtNum(h.edges[k]); }), axisLabel: { show: false }, axisLine: { show: false }, axisTick: { show: false } },
        yAxis: { type: 'value', axisLabel: { show: false }, splitLine: { show: false }, axisLine: { show: false }, axisTick: { show: false } },
        series: [{ type: 'bar', data: h.counts, barMaxWidth: 10, itemStyle: { borderRadius: [2, 2, 0, 0] } }]
      });
    });
  }

  /* ================================================================
     VIEW: describe —— 数值列描述统计 + 分类列频数统计
     ================================================================ */
  function renderDescribe(root) {
    var df = state.current, nums = df.numericColumns(), cols = df.columns();
    var hasNums = nums.length > 0;
    if (hasNums && nums.indexOf(ui.describe.col) === -1) ui.describe.col = nums[0];
    if (cols.indexOf(ui.counts.col) === -1) ui.counts.col = bestCat(categoricalCols()[0] || cols[0]);

    root.innerHTML = '<div class="view-inner">' + head('describe.title', 'describe.desc') +
      (hasNums
        ? card(t('describe.table'), dataTable(describeLocalized(df), { index: false, limit: 20, indexLabel: '' }), typeTag('float64')) +
        '<div class="grid cols-2" style="margin-top:16px">' +
        card(t('describe.column'),
          field(t('describe.column'), colSelect('de-col', nums, ui.describe.col, false)) +
          '<div id="de-stats"></div>') +
        card(t('describe.hist'), '<div class="chart-box" id="de-hist"></div>') +
        '</div>' +
        '<div class="grid cols-2" style="margin-top:16px">' +
        card(t('describe.box'), '<div class="chart-box short" id="de-box"></div>') +
        card(t('describe.cdf'), '<div class="chart-box short" id="de-cdf"></div>') +
        '</div>'
        : emptyBox(t('describe.noneNumeric'))) +
      '<div class="grid cols-2" style="margin-top:16px">' +
      card(t('counts.title'),
        field(t('counts.column'), colSelect('vc-col', cols, ui.counts.col, false)) +
        field(t('counts.top'), '<input class="ctl" type="range" min="5" max="30" value="' + ui.counts.top + '" id="vc-top">') +
        '<label class="check' + (ui.counts.normalize ? ' on' : '') + '" id="vc-norm-l"><input type="checkbox"' + (ui.counts.normalize ? ' checked' : '') + '><span class="ctext">' + esc(t('counts.normalize')) + '</span></label>' +
        '<div id="vc-meta" style="margin-top:12px"></div>') +
      card(t('counts.chart'), '<div class="chart-box" id="vc-chart"></div>') +
      '</div>' +
      '<div style="margin-top:16px">' + card(t('filter.preview'), '<div id="vc-table"></div>') + '</div>' +
      '</div>';

    function updateNumeric() {
      var c = ui.describe.col, vals = df.series(c), clean = Stats.clean(vals);
      var s = Stats.summarize(vals), bx = Stats.boxStats(clean);
      $('de-stats').innerHTML =
        statLine(t('describe.st.nonNull'), fmtInt(clean.length) + ' / ' + fmtInt(vals.length)) +
        statLine(t('describe.st.mean'), fmtNum(s.mean)) +
        statLine(t('describe.st.std'), fmtNum(s.std)) +
        statLine(t('describe.st.min'), fmtNum(s.min)) +
        statLine(t('describe.st.q25'), fmtNum(bx ? bx.q1 : null)) +
        statLine(t('describe.st.median'), fmtNum(s.median)) +
        statLine(t('describe.st.q75'), fmtNum(bx ? bx.q3 : null)) +
        statLine(t('describe.st.max'), fmtNum(s.max)) +
        statLine(t('describe.st.skew'), fmtNum(s.skew)) +
        statLine(t('describe.st.sum'), fmtNum(s.sum)) +
        statLine(t('describe.iqr'), fmtNum(bx ? bx.iqr : null)) +
        statLine(t('describe.outliers'), fmtInt(bx ? bx.outliers.length : 0));

      var h = Stats.histogram(clean, Stats.binCount(clean.length));
      var kd = Stats.kde(clean, 70);
      var hInst = setChart('de-hist', Charts.histogram({
        labels: h.counts.map(function (_, i) { return fmtNum(h.edges[i]); }),
        counts: h.counts, valueName: c,
        domain: [h.edges[0], h.edges[h.edges.length - 1]],
        kde: kd ? { x: kd.x, y: kd.y } : null
      }));
      /* 指向柱子只留「区间 + 计数」轴，指向曲线只留「数值 + 密度」轴 */
      if (hInst && kd && !hInst._axisFocusBound) { Charts.bindAxisFocus(hInst); hInst._axisFocusBound = true; }
      setChart('de-box', Charts.box({ xName: '', yName: c, valueName: c, boxes: [[bx ? bx.min : 0, bx ? bx.q1 : 0, bx ? bx.median : 0, bx ? bx.q3 : 0, bx ? bx.max : 0]] }));
      var boxEl = $('de-box'); if (boxEl) { var i2 = echarts.getInstanceByDom(boxEl); if (i2) i2.setOption({ xAxis: { data: [c] } }); }

      // CDF
      var sorted = Stats.sortedCopy(clean), pts = [];
      for (var i = 0; i < sorted.length; i++) pts.push([sorted[i], (i + 1) / sorted.length * 100]);
      setChart('de-cdf', {
        animation: true, grid: { left: 8, right: 16, top: 20, bottom: 8, containLabel: true },
        tooltip: { trigger: 'axis', appendToBody: true, backgroundColor: Charts.theme().bg2, borderColor: Charts.theme().rule, textStyle: { color: Charts.theme().ink, fontFamily: Charts.FONT, fontSize: 12 }, formatter: function (p) { return Charts.fmt(p[0].value[0]) + ' → ' + p[0].value[1].toFixed(1) + '%'; } },
        xAxis: Charts.valAxis(c, Charts.theme()), yAxis: Charts.valAxis('%', Charts.theme()),
        series: [{ type: 'line', data: pts, showSymbol: false, smooth: true, lineStyle: { width: 2.4 }, areaStyle: { opacity: .14 } }]
      });
    }
    function updateCounts() {
      var rows = df.valueCounts(ui.counts.col, { normalize: ui.counts.normalize, dropna: true });
      var top = rows.slice(0, ui.counts.top);
      $('vc-meta').innerHTML = '<div class="banner ok">' + esc(t('counts.unique', { n: fmtInt(rows.length) })) + '</div>';
      setChart('vc-chart', Charts.pie({
        valueName: ui.counts.normalize ? t('chart.share') : t('chart.count'),
        data: top.map(function (r) {
          return { name: r.key === null ? '∅' : String(r.key), value: ui.counts.normalize ? +(r.pct * 100).toFixed(2) : r.count };
        })
      }));
      var head2 = '<div class="table-wrap"><table class="data"><thead><tr><th>' + esc(t('counts.value')) + '</th><th>' + esc(t('counts.count')) + '</th><th>' + esc(t('counts.share')) + '</th><th></th></tr></thead><tbody>' +
        rows.slice(0, 60).map(function (r) {
          return '<tr><td>' + esc(r.key === null ? '∅' : String(r.key)) + '</td><td class="num">' + fmtInt(r.count) + '</td><td class="num">' + (r.pct * 100).toFixed(2) + '%</td>' +
            '<td style="width:130px"><div class="bar-line"><i style="width:' + (r.pct * 100).toFixed(1) + '%"></i></div></td></tr>';
        }).join('') + '</tbody></table></div>';
      $('vc-table').innerHTML = head2;
    }
    if (hasNums) {
      $('de-col').addEventListener('change', function () { ui.describe.col = this.value; updateNumeric(); });
      updateNumeric();
    }
    $('vc-col').addEventListener('change', function () { ui.counts.col = this.value; updateCounts(); });
    $('vc-top').addEventListener('input', function () { ui.counts.top = +this.value; updateCounts(); });
    $('vc-norm-l').addEventListener('change', function (e) {
      ui.counts.normalize = $('vc-norm-l').querySelector('input').checked;
      $('vc-norm-l').classList.toggle('on', ui.counts.normalize);
      updateCounts();
    });
    updateCounts();
  }

  /* ================================================================
     VIEW: correlation
     ================================================================ */
  function renderCorr(root) {
    var df = state.current, nums = df.numericColumns();
    if (nums.length < 2) { root.innerHTML = '<div class="view-inner">' + head('corr.title', 'corr.desc') + emptyBox(t('corr.need2')) + '</div>'; return; }
    if (nums.indexOf(ui.corr.x) === -1) ui.corr.x = nums[0];
    if (nums.indexOf(ui.corr.y) === -1) ui.corr.y = nums[1] || nums[0];
    var corr = df.corr(ui.corr.method);

    var table = '<div class="table-wrap"><table class="data"><thead><tr><th></th>' + corr.labels.map(function (l) { return '<th>' + esc(l) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      corr.labels.map(function (rowL, i) {
        return '<tr><td class="idx-cell">' + esc(rowL) + '</td>' + corr.labels.map(function (_, j) {
          var v = corr.matrix[i][j];
          var strong = Math.abs(v) > 0.5 && i !== j;
          return '<td class="num"' + (strong ? ' style="color:var(--accent);font-weight:700"' : '') + '>' + (v === null ? '—' : fmtNum(v)) + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';

    root.innerHTML = '<div class="view-inner">' + head('corr.title', 'corr.desc') +
      card(t('corr.heatmap'), '<div class="chart-box" id="co-heat" style="min-height:380px;max-width:720px;margin:0 auto"></div>',
        '<div class="btn-group" id="co-method"><button data-v="pearson" class="' + (ui.corr.method === 'pearson' ? 'active' : '') + '">' + esc(t('corr.pearson')) + '</button><button data-v="spearman" class="' + (ui.corr.method === 'spearman' ? 'active' : '') + '">' + esc(t('corr.spearman')) + '</button></div>') +
      card(t('corr.matrixTable'), table) +
      card(t('corr.scatter'),
        '<div class="row" style="flex-wrap:wrap;gap:12px;margin-bottom:14px">' +
        '<div class="field" style="margin:0"><label>' + esc(t('corr.x')) + '</label><div style="width:180px">' + colSelect('co-x', nums, ui.corr.x, false) + '</div></div>' +
        '<div class="field" style="margin:0"><label>' + esc(t('corr.y')) + '</label><div style="width:180px">' + colSelect('co-y', nums, ui.corr.y, false) + '</div></div>' +
        '<div class="field" style="margin:0"><label>' + esc(t('corr.color')) + '</label><div style="width:180px">' + colSelect('co-color', categoricalCols(), ui.corr.color, true) + '</div></div>' +
        '<div class="grow" style="text-align:right"><span class="pill alt" id="co-r"></span></div></div>' +
        '<div class="chart-box" id="co-scatter"></div>') +
      '</div>';

    setChart('co-heat', Charts.corrHeatmap({ labels: corr.labels, matrix: corr.matrix }));

    function scatterUpdate() {
      var x = ui.corr.x, y = ui.corr.y, colorCol = ui.corr.color;
      var data = df.series(x), dataY = df.series(y);
      var groups = null;
      if (colorCol) {
        var map = {};
        for (var i = 0; i < df.nrows; i++) {
          if (data[i] === null || dataY[i] === null) continue;
          var key = df.series(colorCol)[i] === null ? '∅' : String(df.series(colorCol)[i]);
          if (!map[key]) map[key] = [];
          map[key].push([data[i], dataY[i], 0, key]);
        }
        groups = Object.keys(map).map(function (k) { return { name: k, points: map[k] }; });
        $('co-color').parentElement;
      } else {
        var pts = [];
        for (var j = 0; j < df.nrows; j++) if (data[j] !== null && dataY[j] !== null) pts.push([data[j], dataY[j], 0, '']);
        groups = [{ name: null, points: pts }];
      }
      setChart('co-scatter', Charts.scatter({ xName: x, yName: y, groups: groups, title: x + ' × ' + y }));
      var p = Stats.pair(data, dataY);
      var r = ui.corr.method === 'spearman' ? Stats.spearman(p[0], p[1]) : Stats.pearson(p[0], p[1]);
      $('co-r').textContent = t('corr.r') + ' = ' + (r === null ? '—' : fmtNum(r)) + ' · n = ' + p[0].length;
    }
    scatterUpdate();

    root.querySelectorAll('#co-method button').forEach(function (b) {
      b.addEventListener('click', function () {
        ui.corr.method = b.getAttribute('data-v');
        root.querySelectorAll('#co-method button').forEach(function (x) { x.classList.toggle('active', x === b); });
        var c2 = df.corr(ui.corr.method);
        setChart('co-heat', Charts.corrHeatmap({ labels: c2.labels, matrix: c2.matrix }));
        scatterUpdate();
      });
    });
    $('co-x').addEventListener('change', function () { ui.corr.x = this.value; scatterUpdate(); });
    $('co-y').addEventListener('change', function () { ui.corr.y = this.value; scatterUpdate(); });
    $('co-color').addEventListener('change', function () { ui.corr.color = this.value; scatterUpdate(); });
  }

  /* ================================================================
     VIEW: chart studio
     ================================================================ */
  function renderCharts(root) {
    var df = state.current, cols = df.columns(), nums = df.numericColumns(), cats = categoricalCols();
    var types = ['bar', 'line', 'area', 'box', 'histogram'];
    if (cols.indexOf(ui.charts.x) === -1) ui.charts.x = bestCat(cats[0] || cols[0]);
    if (nums.indexOf(ui.charts.y) === -1) ui.charts.y = nums[0] || cols[0];
    var aggs = ['sum', 'mean', 'median', 'count', 'max', 'min', 'nunique'];

    root.innerHTML = '<div class="view-inner">' + head('charts.title', 'charts.desc') +
      '<div class="btn-group" id="ch-type" style="margin-bottom:16px;flex-wrap:wrap">' + types.map(function (tp) {
        return '<button data-v="' + tp + '" class="' + (ui.charts.type === tp ? 'active' : '') + '">' + esc(t('charts.type.' + tp)) + '</button>';
      }).join('') + '</div>' +
      '<div class="split wide-left">' +
      card(t('charts.title'),
        '<div class="grid cols-2" style="gap:12px">' +
        field(t('charts.x'), colSelect('ch-x', cols, ui.charts.x, false)) +
        field(t('charts.y'), colSelect('ch-y', cols, ui.charts.y, false)) +
        '</div>' +
        field(t('charts.agg'), ctlSelect('ch-agg', aggs.map(function (a) { return { v: a, label: aggLabel(a) }; }), ui.charts.agg)) +
        field(t('charts.group'), colSelect('ch-group', cats, ui.charts.group, true)) +
        '<div class="row" style="gap:12px">' +
        '<div class="grow">' + field(t('charts.topN'), '<input class="ctl" type="range" min="5" max="40" value="' + (ui.charts.top > 40 ? 40 : ui.charts.top) + '" id="ch-top">') + '</div>' +
        '<div class="grow">' + field(t('charts.sort'), ctlSelect('ch-sort', [{ v: 'auto', label: t('charts.sort.auto') }, { v: 'desc', label: t('charts.sort.desc') }, { v: 'asc', label: t('charts.sort.asc') }], ui.charts.sort)) + '</div>' +
        '</div>' +
        '<div class="mono-block" id="ch-code" style="margin-top:6px"></div>' +
        '<div class="row" style="margin-top:12px"><button class="btn primary" id="ch-add">' + ic('plus') + esc(t('action.add')) + '</button></div>') +
      card(t('charts.preview'), '<div class="chart-box" id="ch-chart" style="min-height:460px"></div>') +
      '</div></div>';

    function aggregate(vals, fn) { var f = DF.AGG[fn] || DF.AGG.mean; return f(vals); }

    function buildMatrix(xCol, yCol, groupCol, agg, top, sortMode) {
      var xs = df.series(xCol), ys = yCol ? df.series(yCol) : null, gs = groupCol ? df.series(groupCol) : null;
      var cats = [], ci = new Map(), gn = [], gi = new Map(), cells = new Map();
      for (var i = 0; i < df.nrows; i++) {
        var cv = xs[i], ck = (cv === null || cv === undefined) ? '∅' : String(cv);
        if (!ci.has(ck)) { ci.set(ck, cats.length); cats.push(ck); }
        var a = ci.get(ck), b = 0, gname = '';
        if (gs) {
          var gv = gs[i]; gname = (gv === null || gv === undefined) ? '∅' : String(gv);
          if (!gi.has(gname)) { gi.set(gname, gn.length); gn.push(gname); }
          b = gi.get(gname);
        }
        var key = a + '|' + b;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(ys ? ys[i] : 1);
      }
      var nG = gs ? Math.max(1, gn.length) : 1;
      var gnames = gs ? gn : [''];
      var values = [];
      for (var a2 = 0; a2 < cats.length; a2++) {
        values.push([]);
        for (var b2 = 0; b2 < nG; b2++) {
          var arr = cells.get(a2 + '|' + b2);
          values[a2].push(arr ? aggregate(arr, agg) : null);
        }
      }
      var metric = cats.map(function (_, a3) {
        var s = 0;
        for (var b3 = 0; b3 < nG; b3++) { var v = values[a3][b3]; if (v !== null && isFinite(v)) s += v; }
        return s;
      });
      var order = cats.map(function (_, i2) { return i2; });
      if (sortMode === 'desc') order.sort(function (p, q) { return metric[q] - metric[p]; });
      else if (sortMode === 'asc') order.sort(function (p, q) { return metric[p] - metric[q]; });
      if (top) order = order.slice(0, top);
      return {
        cats: order.map(function (i3) { return cats[i3]; }),
        gnames: gnames,
        values: order.map(function (i4) { return values[i4]; }),
        metric: order.map(function (i5) { return metric[i5]; })
      };
    }

    function update() {
      var type = ui.charts.type, x = ui.charts.x, y = ui.charts.y, group = ui.charts.group;
      var ylabelRaw = ui.charts.agg === 'count' ? 'count' : (y || 'count');
      var ylabel = ui.charts.agg === 'count' ? t('chart.count') : (y || t('chart.count'));
      var code = '';
      if (type === 'box') {
        var catsB = [], seenB = {};
        var xb = df.series(x), yb = df.series(y);
        for (var ib = 0; ib < df.nrows; ib++) { var cb = xb[ib] === null ? '∅' : String(xb[ib]); if (!seenB[cb]) { seenB[cb] = 1; catsB.push(cb); } }
        catsB = catsB.slice(0, ui.charts.top);
        var boxes = catsB.map(function (cb2) {
          var arrB = [];
          for (var kb = 0; kb < df.nrows; kb++) if ((xb[kb] === null ? '∅' : String(xb[kb])) === cb2 && yb[kb] !== null) arrB.push(yb[kb]);
          var bs = Stats.boxStats(arrB);
          return bs ? [bs.min, bs.q1, bs.median, bs.q3, bs.max] : [0, 0, 0, 0, 0];
        });
        var optB = Charts.box({ xName: x, yName: y, valueName: y, boxes: boxes });
        optB.xAxis.data = catsB;
        setChart('ch-chart', optB);
        code = 'df.boxplot(column="' + y + '", by="' + x + '")';
      } else if (type === 'histogram') {
        var clean = Stats.clean(df.series(y));
        var h = Stats.histogram(clean, Stats.binCount(clean.length));
        var labels = h.counts.map(function (_, i2) { return fmtNum(h.edges[i2]); });
        if (group) {
          var gcol2 = df.series(group), gvals = {}, gorder = [];
          for (var ih = 0; ih < df.nrows; ih++) { var gk = gcol2[ih] === null ? '∅' : String(gcol2[ih]); if (!gvals[gk]) { gvals[gk] = new Array(h.counts.length).fill(0); gorder.push(gk); } }
          for (var ih2 = 0; ih2 < df.nrows; ih2++) {
            var vv = df.series(y)[ih2]; if (vv === null || !isFinite(vv)) continue;
            var bi = Math.floor((vv - h.edges[0]) / ((h.edges[h.edges.length - 1] - h.edges[0]) / h.counts.length));
            if (bi < 0) bi = 0; if (bi >= h.counts.length) bi = h.counts.length - 1;
            var gk2 = gcol2[ih2] === null ? '∅' : String(gcol2[ih2]);
            gvals[gk2][bi]++;
          }
          var optH = Charts.bar({ xName: y, valueName: t('chart.count'), stack: true, series: gorder.map(function (g3) { return { name: g3, data: gvals[g3] }; }) });
          optH.xAxis.data = labels;
          setChart('ch-chart', optH);
        } else {
          setChart('ch-chart', Charts.histogram({ labels: labels, counts: h.counts, valueName: y }));
        }
        code = 'df["' + y + '"].plot.hist(bins=' + h.counts.length + ')';
      } else {
        var m = buildMatrix(x, y, group, ui.charts.agg, ui.charts.top, ui.charts.sort);
        var series = group
          ? m.gnames.map(function (g4, gi2) { return { name: g4, data: m.values.map(function (row) { return row[gi2]; }) }; })
          : [{ name: ylabel, data: m.metric }];
        var opt = (type === 'bar')
          ? Charts.bar({ xName: x, valueName: ylabel, series: series })
          : Charts.line({ xName: x, yName: ylabel, series: series, area: type === 'area' });
        opt.xAxis.data = m.cats;
        setChart('ch-chart', opt);
        code = 'df.groupby("' + x + '")["' + ylabelRaw + '"].' + (ui.charts.agg === 'mean' ? 'mean' : ui.charts.agg === 'count' ? 'size' : ui.charts.agg) + '().plot(kind="' + (type === 'bar' ? 'bar' : 'line') + '")';
      }
      var codeEl = $('ch-code');
      if (codeEl) codeEl.textContent = code;
    }

    /* 箱线图的分箱五数概括直接由原始值算出，中间没有「聚合」这一步，
       所以选中箱线图时把「Y 聚合方式」置灰不可选，免得给出一个按了没反应的控件。 */
    function syncAggEnabled() {
      var el = $('ch-agg');
      if (el) el.disabled = (ui.charts.type === 'box');
    }

    root.querySelectorAll('#ch-type button').forEach(function (b) {
      b.addEventListener('click', function () {
        ui.charts.type = b.getAttribute('data-v');
        root.querySelectorAll('#ch-type button').forEach(function (x2) { x2.classList.toggle('active', x2 === b); });
        syncAggEnabled();
        update();
      });
    });
    $('ch-x').addEventListener('change', function () { ui.charts.x = this.value; update(); });
    $('ch-y').addEventListener('change', function () { ui.charts.y = this.value; update(); });
    $('ch-agg').addEventListener('change', function () { ui.charts.agg = this.value; update(); });
    $('ch-group').addEventListener('change', function () { ui.charts.group = this.value; update(); });
    $('ch-top').addEventListener('input', function () { ui.charts.top = +this.value; update(); });
    $('ch-sort').addEventListener('change', function () { ui.charts.sort = this.value; update(); });
    $('ch-add').addEventListener('click', function () {
      var nm = 'chart_' + ui.charts.type;
      // charts are exploratory: they do not mutate the frame, so we log them as no-op steps with the code
      toast($('ch-code').textContent.slice(0, 60));
    });
    syncAggEnabled();
    update();
  }

  /* ================================================================
     VIEW: export
     ================================================================ */
  function renderExport(root) {
    var df = state.current;
    var code = 'import pandas as pd\n\ndf = pd.read_csv("data.csv")';
    state.pipeline.forEach(function (op) { var c = opCode(op); if (c) code += '\n' + c; });

    root.innerHTML = '<div class="view-inner">' + head('export.title', 'export.desc') +
      '<div class="kpi-grid rise">' +
      kpi(t('overview.kpi.rows'), fmtInt(df.nrows)) +
      kpi(t('overview.kpi.cols'), fmtInt(df.ncols)) +
      kpi(t('header.steps'), fmtInt(state.pipeline.length)) +
      kpi(t('source.kpi.memory'), fmtBytes(df.memoryUsage())) +
      '</div>' +
      '<div class="grid cols-2" style="margin-top:16px">' +
      card(t('export.title'),
        '<div class="banner ok">' + esc(t('export.note', { n: state.pipeline.length })) + '</div>' +
        '<div class="row" style="flex-wrap:wrap;gap:10px">' +
        '<button class="btn primary" id="ex-csv">' + ic('download') + esc(t('export.csv')) + '</button>' +
        '<button class="btn" id="ex-json">' + ic('download') + esc(t('export.json')) + '</button>' +
        '<button class="btn" id="ex-copy">' + ic('copy') + esc(t('export.clipboard')) + '</button>' +
        '</div>' +
        '<div style="margin-top:16px">' + dataTable(df, { limit: 10 }) + '</div>') +
      card(t('export.pipelineCaption'),
        '<div class="mono-block">' + esc(code) + '</div>' +
        '<div class="row" style="margin-top:12px"><button class="btn small" id="ex-copy-code">' + ic('copy') + esc(t('action.copy')) + '</button></div>') +
      '</div></div>';

    $('ex-csv').addEventListener('click', function () { download('dataframe.csv', df.toCSV()); });
    $('ex-json').addEventListener('click', function () { download('dataframe.json', JSON.stringify(df.toRecords(), null, 2)); });
    $('ex-copy').addEventListener('click', function () { copyText(df.toCSV()); });
    $('ex-copy-code').addEventListener('click', function () { copyText(code); });
  }

  /* ---------------- io helpers ---------------- */
  function download(filename, text) {
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 400);
    toast(filename);
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(t('action.copied')); }, function () { fallbackCopy(text); });
    } else fallbackCopy(text);
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast(t('action.copied')); } catch (e) { toast('copy failed', true); }
    ta.remove();
  }

  /* ---------------- views registry ---------------- */

  var VIEWS = {
    source: renderSource,
    table: renderTable,
    select: renderSelect,
    filter: renderFilter,
    sort: renderSort,
    missing: renderMissing,
    duplicates: renderDuplicates,
    assign: renderAssign,
    columns: renderColumns,
    overview: renderOverview,
    pivot: renderPivot,
    describe: renderDescribe,
    corr: renderCorr,
    charts: renderCharts,
    export: renderExport
  };

  /* ---------------- i18n / theme chrome ---------------- */

  function applyStatic() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    document.querySelectorAll('[data-i18n-title]').forEach(function (el) { el.title = t(el.getAttribute('data-i18n-title')); });
    document.title = t('app.title') + ' · ' + t('app.tagline');
  }
  function updateThemeIcon() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    var icon = $('theme-icon');
    if (!icon) return;
    icon.innerHTML = dark
      ? '<path d="M20 14.5A8 8 0 0 1 9.5 4 8.2 8.2 0 1 0 20 14.5z"/>'
      : '<circle cx="12" cy="12" r="4.2"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
  }
  function setTheme(mode) {
    document.documentElement.setAttribute('data-theme', mode);
    try { localStorage.setItem('dfstudio.theme', mode); } catch (e) { }
    updateThemeIcon();
  }

  /* ---------------- boot ---------------- */

  function init() {
    try { setTheme(localStorage.getItem('dfstudio.theme') || 'light'); } catch (e) { setTheme('light'); }
    applyStatic();
    document.documentElement.lang = getLang() === 'zh' ? 'zh' : 'en';

    document.querySelectorAll('#lang-switch button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-lang') === getLang());
      b.addEventListener('click', function () {
        setLang(b.getAttribute('data-lang'));
        document.documentElement.lang = getLang() === 'zh' ? 'zh' : 'en';
        document.querySelectorAll('#lang-switch button').forEach(function (x) { x.classList.toggle('active', x === b); });
        applyStatic();
        // A built-in sample stores its own localised column names, so it is rebuilt
        // in the new language. Data loaded from a file keeps whatever names it has.
        if (state.baseIsSample && state.baseId && DATASETS[state.baseId]) {
          var d = DATASETS[state.baseId];
          setBase(d.build(getLang()), d.name, true, state.baseId);
        } else render();
      });
    });
    $('btn-theme').addEventListener('click', function () {
      setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
      render();
    });
    $('btn-reset').addEventListener('click', function () {
      if (state.baseIsSample && state.baseId) loadSample(state.baseId);
      else { state.pipeline = []; recompute(); render(); toast(t('action.clear')); }
    });
    $('btn-clear-pipeline').addEventListener('click', function () {
      state.pipeline = []; recompute(); render();
    });
    document.querySelectorAll('.nav-item').forEach(function (b) {
      b.addEventListener('click', function () { go(b.getAttribute('data-view')); });
    });
    $('file-input').addEventListener('change', function () {
      if (this.files && this.files[0]) loadFile(this.files[0]);
      this.value = '';
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { var m = document.querySelector('.modal-back'); if (m && m.close) m.close(); }
    });

    loadSample(DEFAULT_DATASET);
    go('source');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
