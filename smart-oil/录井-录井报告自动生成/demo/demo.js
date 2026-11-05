/* =========================================================
   录井报告自动生成 · 示范脚本（整页模式，运行在沙箱 iframe 里）
   ---------------------------------------------------------
   三屏：
   屏 1  信息抽取：结构化数据 → 报告要点
   屏 2  模板化生成：要点 → 规范报告
   屏 3  检索增强：历史报告参考 → 佐证报告
   所有计算都在浏览器里完成，纯前端。
   ========================================================= */
(function (global) {
  'use strict';

  /* =====================================================
     纯模型层（Node 可 require 做单测；浏览器里继续往下走）
     ===================================================== */
  var Model = (function () {

    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
    function mulberry32(a) {
      return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        var t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    }

    var LITHO = ['泥岩', '砂岩', '灰岩', '页岩'];

    /* -----------------------------------------------------
       合成一口井的录井数据 + 历史报告
       返回 { well, strata:[{litho,top,base,tv,gas}], history:[{name,seg,text}] }
       ----------------------------------------------------- */
    function genWell(seed) {
      var rnd = mulberry32(seed || 20261181);
      var strata = [];
      var depth = 0;
      var n = 4 + Math.floor(rnd() * 3); /* 4—6 层 */
      for (var i = 0; i < n; i++) {
        var litho = Math.floor(rnd() * 4);
        var thick = 10 + Math.floor(rnd() * 40);
        var top = depth, base = depth + thick;
        var tv = 2 + rnd() * 6;         /* 气测显示值 */
        var gas = tv > 4;                /* 油气显示 */
        strata.push({ litho: litho, top: top, base: base, tv: tv, gas: gas });
        depth = base;
      }
      var history = [
        { name: '井A-2024', seg: '砂岩段 38—64m 见良好气测显示', ref: 1 },
        { name: '井B-2023', seg: '灰岩段低气测，录井未见油气显示', ref: 0 },
        { name: '井C-2024', seg: '页岩段气测异常，综合解释为气层', ref: 1 }
      ];
      return { name: '某井', depth: depth, n: n, strata: strata, history: history };
    }

    /* -----------------------------------------------------
       信息抽取
       从结构化数据抽报告要点。mode 0 基础，1 完整（不漏显示）。
       返回 { items:[{k,v}], gasN, layerN }
       ----------------------------------------------------- */
    function extractInfo(well, mode) {
      var items = [];
      items.push({ k: '井深', v: well.depth + ' m' });
      items.push({ k: '地层数', v: well.n + ' 层' });
      var gasN = 0;
      for (var i = 0; i < well.strata.length; i++) if (well.strata[i].gas) gasN++;
      items.push({ k: '油气显示', v: gasN + ' 层' });
      var hi = well.strata[0];
      items.push({ k: '顶部岩性', v: LITHO[hi.litho] });
      var last = well.strata[well.strata.length - 1];
      items.push({ k: '底部岩性', v: LITHO[last.litho] });
      /* mode 0 模拟漏检一个显示 */
      var gasN2 = mode === 0 ? Math.max(0, gasN - 1) : gasN;
      return { items: items, gasN: gasN2, layerN: well.n };
    }

    /* -----------------------------------------------------
       模板化生成
       按模板把要点填成报告。返回 { text }（分段数组）
       ----------------------------------------------------- */
    function tplGen(ext) {
      var segs = [];
      segs.push('【井况】本井井深 ' + ext.items[0].v + '，钻揭 ' + ext.items[1].v + '。');
      segs.push('【地层】顶部为' + ext.items[3].v + '，底部为' + ext.items[4].v + '。');
      segs.push('【油气显示】录井共见油气显示 ' + ext.gasN + ' 层。');
      return { text: segs };
    }

    /* -----------------------------------------------------
       检索增强生成
       检索历史报告相关段补佐证。mode 0 不检索，1 检索。
       返回 { refs:[{name,seg}], note }
       ----------------------------------------------------- */
    function ragEnhance(well, mode) {
      if (mode === 0) return { refs: [], note: '未引用历史报告' };
      var refs = well.history.filter(function (h) { return h.ref === 1; });
      return { refs: refs, note: '已检索并引用 ' + refs.length + ' 条相关历史报告' };
    }

    return {
      clamp: clamp, mulberry32: mulberry32, LITHO: LITHO,
      genWell: genWell, extractInfo: extractInfo, tplGen: tplGen, ragEnhance: ragEnhance
    };
  })();

  /* Node 单测入口 */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Model;
    return;
  }

  /* =====================================================
     浏览器接线（沙箱 iframe 内执行）
     ===================================================== */
  var doc = document;
  var $ = function (id) { return doc.getElementById(id); };
  var M = Model;

  var state = { extractMode: 1, tplMode: 1, ragMode: 1 };
  var well = M.genWell(20261181);

  global.RemoteBridge = {
    M: M,
    genWell: M.genWell, extractInfo: M.extractInfo, tplGen: M.tplGen, ragEnhance: M.ragEnhance,
    live: function () {
      return { extractMode: state.extractMode, tplMode: state.tplMode, ragMode: state.ragMode };
    }
  };

  function num(v, d) { return v.toFixed(d == null ? 2 : d); }

  var LCOL = ['#b26a39', '#c98a2b', '#7a8a9a', '#5a4a3a'];

  /* ---------- 屏 1 渲染：信息抽取 ---------- */
  function renderExtract() {
    well = M.genWell(20261181);
    var ext = M.extractInfo(well, state.extractMode);
    var s = '';
    var x0 = 30, y0 = 30;
    s += '<text x="30" y="22" font-size="9" fill="#4d565b" font-weight="700">信息抽取：' + (state.extractMode === 0 ? '基础抽取（漏显示）' : '完整抽取（不漏显示）') + '</text>';
    var rows = ext.items.map(function (it, i) { return [it.k, it.v]; });
    var n = rows.length;
    var colW = 150, rowH = 26;
    for (var r = 0; r < n; r++) {
      var ry = y0 + r * rowH;
      s += '<rect x="' + x0 + '" y="' + ry + '" width="' + colW + '" height="' + (rowH - 5) + '" rx="4" fill="' + (r % 2 ? '#f7f6f1' : '#e7eef9') + '" stroke="#d7dce6" stroke-width="0.8"/>';
      s += '<text x="' + (x0 + 8) + '" y="' + (ry + 17) + '" font-size="8.5" fill="#2b4a72" font-weight="700">' + rows[r][0] + '</text>';
      s += '<text x="' + (x0 + colW + 12) + '" y="' + (ry + 17) + '" font-size="8.5" fill="#242b2e">' + rows[r][1] + '</text>';
    }
    $('extractChart').innerHTML = s;
    $('roGasN').textContent = ext.gasN + ' 层';
    $('roLayerN').textContent = ext.layerN + ' 层';
    $('roItems').textContent = ext.items.length + ' 项';
  }

  /* ---------- 屏 2 渲染：模板化生成 ---------- */
  function renderTpl() {
    well = M.genWell(20261181);
    var ext = M.extractInfo(well, state.extractMode);
    var tpl = M.tplGen(ext);
    var s = '';
    var x0 = 30, y0 = 30;
    s += '<text x="30" y="22" font-size="9" fill="#4d565b" font-weight="700">模板化生成：规范报告（口径统一）</text>';
    /* 模板骨架 */
    s += '<rect x="' + x0 + '" y="' + y0 + '" width="330" height="18" rx="3" fill="#e6f1ec" stroke="#b9d8cb" stroke-width="0.8"/><text x="' + (x0 + 8) + '" y="' + (y0 + 13) + '" font-size="8" fill="#22604f" font-weight="700">模板：井况 / 地层 / 油气显示</text>';
    for (var i = 0; i < tpl.text.length; i++) {
      var ty = y0 + 28 + i * 22;
      s += '<rect x="' + (x0 + 8) + '" y="' + ty + '" width="320" height="18" rx="3" fill="#fbfaf6" stroke="#e9e4d8" stroke-width="0.8"/>';
      s += '<text x="' + (x0 + 14) + '" y="' + (ty + 13) + '" font-size="8" fill="#4d565b">' + tpl.text[i] + '</text>';
    }
    $('tplChart').innerHTML = s;
    $('roSegs').textContent = tpl.text.length + ' 段';
    $('roTpl').textContent = state.tplMode === 0 ? '无模板' : '已套模板';
    /* 报告预览 */
    var prev = '';
    tpl.text.forEach(function (t) { prev += '<div class="row"><span>段落</span><b>' + t + '</b><em>ok</em></div>'; });
    var revEl = $('tplReview');
    if (revEl) revEl.innerHTML = prev;
  }

  /* ---------- 屏 3 渲染：检索增强生成 ---------- */
  function renderRag() {
    well = M.genWell(20261181);
    var ext = M.extractInfo(well, state.extractMode);
    var tpl = M.tplGen(ext);
    var rag = M.ragEnhance(well, state.ragMode);
    var s = '';
    var x0 = 30, y0 = 30;
    s += '<text x="30" y="22" font-size="9" fill="#4d565b" font-weight="700">检索增强生成：' + (state.ragMode === 0 ? '不检索历史报告' : '检索引用 ' + rag.refs.length + ' 条') + '</text>';
    /* 历史报告库 */
    s += '<text x="' + x0 + '" y="' + (y0 + 14) + '" font-size="8" fill="#79828a" font-weight="700">历史报告库</text>';
    well.history.forEach(function (h, i) {
      var hy = y0 + 22 + i * 24;
      var col = h.ref === 1 ? '#e6f1ec' : '#fbfaf6';
      var st = h.ref === 1 ? '#b9d8cb' : '#e9e4d8';
      s += '<rect x="' + x0 + '" y="' + hy + '" width="330" height="20" rx="3" fill="' + col + '" stroke="' + st + '" stroke-width="0.8"/>';
      s += '<text x="' + (x0 + 8) + '" y="' + (hy + 14) + '" font-size="7.5" fill="' + (h.ref === 1 ? '#22604f' : '#79828a') + '">' + h.name + '</text>';
      s += '<text x="' + (x0 + 96) + '" y="' + (hy + 14) + '" font-size="7.5" fill="#4d565b">' + h.seg + '</text>';
      s += '<text x="' + (x0 + 320) + '" y="' + (hy + 14) + '" text-anchor="end" font-size="7.5" fill="' + (h.ref === 1 ? '#2f7d6b' : '#9ba3a9') + '" font-weight="700">' + (h.ref === 1 ? '引用' : '不引') + '</text>';
    });
    /* 佐证报告 */
    var gy = y0 + 22 + well.history.length * 24 + 14;
    s += '<text x="' + x0 + '" y="' + gy + '" font-size="8" fill="#79828a" font-weight="700">生成报告（含佐证）</text>';
    var lines = tpl.text.concat([]);
    if (state.ragMode === 1) lines.push('【佐证】' + rag.refs.map(function (r) { return r.name + '：' + r.seg; }).join('；'));
    for (var i = 0; i < lines.length; i++) {
      var ty = gy + 12 + i * 20;
      s += '<rect x="' + (x0 + 8) + '" y="' + ty + '" width="320" height="16" rx="3" fill="#fbfaf6" stroke="#e9e4d8" stroke-width="0.8"/>';
      s += '<text x="' + (x0 + 14) + '" y="' + (ty + 12) + '" font-size="7.5" fill="#4d565b">' + lines[i] + '</text>';
    }
    $('ragChart').innerHTML = s;
    $('roRefs').textContent = rag.refs.length + ' 条';
    $('roNote').textContent = rag.note;
    /* 复核清单 */
    var rows = [
      ['要点覆盖', ext.items.length + ' 项', 'ok'],
      ['油气显示', ext.gasN + ' 层', 'ok'],
      ['检索引用', rag.refs.length + ' 条', 'ok']
    ];
    var rs = '';
    for (var r = 0; r < rows.length; r++) {
      rs += '<div class="row"><span>' + rows[r][0] + '</span><b>' + rows[r][1] + '</b><em>' + rows[r][2] + '</em></div>';
    }
    var revEl2 = $('ragReview');
    if (revEl2) revEl2.innerHTML = rs;
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    var inExtract = $('inExtract');
    if (inExtract) inExtract.addEventListener('input', function () {
      state.extractMode = parseInt(inExtract.value, 10);
      $('outExtract').textContent = state.extractMode === 0 ? '基础' : '完整';
      renderExtract(); renderTpl(); renderRag();
    });
    var inTpl = $('inTpl');
    if (inTpl) inTpl.addEventListener('input', function () {
      state.tplMode = parseInt(inTpl.value, 10);
      $('outTpl').textContent = state.tplMode === 0 ? '无模板' : '已套模板';
      renderTpl();
    });
    var inRag = $('inRag');
    if (inRag) inRag.addEventListener('input', function () {
      state.ragMode = parseInt(inRag.value, 10);
      $('outRag').textContent = state.ragMode === 0 ? '不检索' : '检索';
      renderRag();
    });
  }

  /* 抽屉上报 */
  function setupDrawer() {
    if (window.parent === window) return;
    var secs = [];
    [['sec1', '信息抽取', 'extractCtl'], ['sec2', '模板生成', 'tplCtl'], ['sec3', '检索增强', 'ragCtl']].forEach(function (s) {
      var el = $(s[2]); if (!el) return;
      secs.push({ id: s[0], title: s[1], html: el.outerHTML, top: el.offsetTop, height: el.offsetHeight });
    });
    try { parent.postMessage({ __drawer: 'init', sections: secs }, '*'); } catch (e) {}
    window.addEventListener('message', function (e) {
      if (e.source !== window.parent) return;
      var d = e.data;
      if (!d || d.__drawer !== 'control') return;
      var el = doc.querySelector('[data-ctl-id="' + d.id + '"]');
      if (!el) return;
      if (el.type === 'range') { el.value = d.value; el.dispatchEvent(new Event('input', { bubbles: true })); }
      else if (el.tagName === 'BUTTON') { el.click(); }
    });
  }

  /* ---------- 启动 ---------- */
  bind();
  renderExtract(); renderTpl(); renderRag();
  setupDrawer();

})(typeof window !== 'undefined' ? window : global);
