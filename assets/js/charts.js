/* charts.js — ECharts wrappers. Every chart derives its colours from the CSS
   design tokens so light / dark themes stay consistent. */
(function (global) {
  'use strict';

  var FONT = "'Instrument Sans','PingFang SC','Microsoft YaHei','Noto Sans SC',system-ui,sans-serif";

  function v(name) {
    var val = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (val || '').trim();
  }

  function theme() {
    return {
      accent: v('--accent'), accent2: v('--accent2'),
      ink: v('--ink'), muted: v('--muted'), rule: v('--rule'),
      bg2: v('--bg2'), bg: v('--bg')
    };
  }

  function palette() {
    var names = ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6', '--c7', '--c8'];
    return names.map(v).filter(Boolean);
  }

  /* 顺序型热力图（透视表）用的单色阶：同一色相由浅到深取 4 个色调，而不是跨色相
     的渐变。浅色主题下四个色调都足够浅、深色主题下都足够深，因此图块上的标签字
     （浅色主题是近黑、深色主题是近白）在整条色阶上都能看清。 */
  function heatRamp() {
    var stops = ['--heat-1', '--heat-2', '--heat-3', '--heat-4'].map(v).filter(Boolean);
    return stops.length >= 2 ? stops : null;
  }

  /* Chart-internal labels ("count", "KDE", …) follow the UI language; the
     caller may still override them through the option object. */
  function lbl(key, fallback) {
    try { return (typeof window.t === 'function') ? window.t(key) : fallback; }
    catch (e) { return fallback; }
  }

  function mount(el, option) {
    if (!el) return null;
    var inst = echarts.getInstanceByDom(el);
    if (!inst) inst = echarts.init(el, null, { renderer: 'svg' });
    inst.setOption(option, true);
    return inst;
  }

  function base(t) {
    t = t || theme();
    return {
      animation: true,
      animationDuration: 480,
      color: palette(),
      textStyle: { fontFamily: FONT, color: t.ink },
      grid: { left: 8, right: 16, top: 34, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'axis', appendToBody: true,
        backgroundColor: t.bg2, borderColor: t.rule, borderWidth: 1,
        textStyle: { color: t.ink, fontFamily: FONT, fontSize: 12 },
        extraCssText: 'box-shadow:0 8px 24px rgba(0,0,0,.12);border-radius:8px;'
      },
      legend: { type: 'scroll', top: 0, textStyle: { color: t.muted, fontFamily: FONT }, icon: 'roundRect', itemWidth: 10, itemHeight: 10 }
    };
  }

  function catAxis(name, t) {
    return {
      type: 'category', name: name, nameTextStyle: { color: t.muted },
      axisLine: { lineStyle: { color: t.rule } }, axisTick: { show: false },
      axisLabel: { color: t.muted, hideOverlap: true }
    };
  }
  function valAxis(name, t) {
    return {
      type: 'value', name: name, nameTextStyle: { color: t.muted },
      splitLine: { lineStyle: { color: t.rule, type: 'dashed' } },
      axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: t.muted }
    };
  }

  var fmt = function (n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    var a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (a >= 1e4) return (n / 1e3).toFixed(1) + 'k';
    if (a >= 1) return (Math.round(n * 1000) / 1000).toString();
    return (Math.round(n * 10000) / 10000).toString();
  };

  /* 「看哪个图就只显示哪个图的横纵坐标」—— 直方图与核密度曲线叠在同一块绘图区、
     但各带一套横纵轴（柱子：底部区间轴 + 左计数轴；曲线：顶部数值轴 + 右密度轴）。
     鼠标指向哪一条系列，就只保留它自己那套坐标轴，另一套淡出；指针移出绘图区后恢复。
     淡出用「把颜色改成 transparent」而不是 show:false —— 轴文字的留白由 containLabel
     按文字尺寸算出，改颜色不改变占位，因此悬停时图形不会来回跳动。 */
  function bindAxisFocus(inst) {
    var t = theme();
    /* 一条轴可能同时挂在多条系列上（曲线本体 + 它的透明接收线），所以按
       「轴 → 该轴上的系列集合」建表，而不是只记一条系列。
       注意每次 focus 都现读 inst.getOption()：换列、切语言会以 notMerge 方式
       重设配置，绑定时抓的快照会过期，导致系列与轴的对应关系错乱。 */
    function users(ss, key) {
      var m = {};
      ss.forEach(function (s, si) { var k = s[key] || 0; (m[k] = m[k] || []).push(si); });
      return m;
    }
    function lit(map, axisIdx, idx) { return idx === null || (map[axisIdx] || []).indexOf(idx) !== -1; }
    function paint(ax, on) {
      var c = on ? t.muted : 'transparent', lc = on ? t.rule : 'transparent';
      var out = { axisLabel: { color: c }, nameTextStyle: { color: c } };
      if (ax.axisLine && ax.axisLine.show !== false) out.axisLine = { lineStyle: { color: lc } };
      if (ax.axisTick && ax.axisTick.show !== false) out.axisTick = { lineStyle: { color: lc } };
      if (ax.splitLine && ax.splitLine.show !== false) {
        var lt = (ax.splitLine.lineStyle && ax.splitLine.lineStyle.type) || 'dashed';
        out.splitLine = { lineStyle: { color: lc, type: lt } };
      }
      return out;
    }
    var cur = 'init';
    function focus(idx) {
      var o = inst.getOption();
      var xs = o.xAxis || [], ys = o.yAxis || [], ss = o.series || [];
      if (xs.length < 2 && ys.length < 2) return;
      var key = idx === null ? 'all' : String(idx);
      if (key === cur) return;      /* 指针在同一系列上移动时不重复重绘，避免坐标轴闪切 */
      cur = key;
      var xUsers = users(ss, 'xAxisIndex'), yUsers = users(ss, 'yAxisIndex');
      var patch = { xAxis: [], yAxis: [] };
      xs.forEach(function (ax, i) { patch.xAxis[i] = paint(ax, lit(xUsers, i, idx)); });
      ys.forEach(function (ax, i) { patch.yAxis[i] = paint(ax, lit(yUsers, i, idx)); });
      inst.setOption(patch, false);
    }
    inst.on('mouseover', function (p) { if (p && typeof p.seriesIndex === 'number') focus(p.seriesIndex); });
    inst.on('globalout', function () { focus(null); });
    return inst;
  }

  var Charts = {
    theme: theme, palette: palette, mount: mount, base: base, fmt: fmt,
    FONT: FONT, catAxis: catAxis, valAxis: valAxis, bindAxisFocus: bindAxisFocus,

    bar: function (o) {
      var t = theme(), b = base(t), isH = !!o.horizontal;
      var series = o.series.map(function (s, i) {
        return {
          name: s.name, type: 'bar', data: s.data,
          stack: o.stack ? 'total' : undefined,
          barMaxWidth: isH ? 18 : 34, itemStyle: { borderRadius: o.stack ? 0 : (isH ? [0, 4, 4, 0] : [4, 4, 0, 0]) },
          emphasis: { focus: 'series' }
        };
      });
      // horizontal bars put the category on the Y axis and the value on the X axis
      var xAxis = isH ? valAxis(o.valueName, t) : catAxis(o.xName, t);
      var yAxis = isH ? catAxis(o.xName, t) : valAxis(o.valueName, t);
      if (o.labels) (isH ? yAxis : xAxis).data = o.labels;
      return Object.assign(b, {
        tooltip: Object.assign(b.tooltip, { valueFormatter: function (x) { return fmt(x); } }),
        legend: o.series.length > 1 ? b.legend : { show: false },
        xAxis: xAxis,
        yAxis: yAxis,
        series: series
      });
    },

    line: function (o) {
      var t = theme(), b = base(t);
      return Object.assign(b, {
        legend: o.series.length > 1 ? b.legend : { show: false },
        tooltip: Object.assign(b.tooltip, { valueFormatter: function (x) { return fmt(x); } }),
        xAxis: o.xType === 'value' ? valAxis(o.xName, t) : catAxis(o.xName, t),
        yAxis: valAxis(o.yName, t),
        series: o.series.map(function (s) {
          return {
            name: s.name, type: 'line', data: s.data, smooth: o.smooth !== false,
            showSymbol: o.showSymbol === true || (o.series.length === 1 && (s.data || []).length < 30),
            symbolSize: 6, lineStyle: { width: 2.2 },
            areaStyle: o.area ? { opacity: 0.16 } : undefined,
            emphasis: { focus: 'series' }
          };
        })
      });
    },

    scatter: function (o) {
      var t = theme(), b = base(t);
      return Object.assign(b, {
        tooltip: {
          trigger: 'item', appendToBody: true, backgroundColor: t.bg2, borderColor: t.rule,
          textStyle: { color: t.ink, fontFamily: FONT, fontSize: 12 },
          formatter: function (p) {
            var d = p.data;
            return '<b>' + (d[3] || '') + '</b><br/>' + o.xName + ': ' + fmt(d[0]) + '<br/>' + o.yName + ': ' + fmt(d[1]);
          }
        },
        legend: o.groups && o.groups.length > 1 ? b.legend : { show: false },
        grid: Object.assign(b.grid, { top: (o.groups && o.groups.length > 1) ? 34 : 20 }),
        xAxis: valAxis(o.xName, t), yAxis: valAxis(o.yName, t),
        series: (o.groups || [{ name: null, points: o.points }]).map(function (g) {
          return {
            name: g.name || o.title || '', type: 'scatter', data: g.points,
            symbolSize: o.symbolSize || 9, opacity: 0.85,
            itemStyle: { borderColor: 'rgba(255,255,255,.6)', borderWidth: 0.5 },
            emphasis: { focus: 'series' }
          };
        })
      });
    },

    histogram: function (o) {
      var t = theme(), b = base(t);
      var bars = {
        name: o.valueName, type: 'bar', xAxisIndex: 0, yAxisIndex: 0, data: o.counts, barMaxWidth: 40,
        itemStyle: { borderRadius: [3, 3, 0, 0] }
      };
      if (o.kde && o.kde.x && o.kde.x.length) {
        /* 直方图与核密度曲线画在同一块绘图区，但各用各的横纵轴，互不共用：
           柱子 → 分箱区间（底部类目横轴）+ 计数（左纵轴）；
           曲线 → 数值（顶部数值横轴）+ 密度（右纵轴）。
           顶部数值轴的 min/max 必须正好等于首尾分箱边界，否则两条横轴的
           刻度会对不齐、曲线相对柱子发生错位。 */
        var dom = o.domain || null;
        var kdeName = o.kdeName || lbl('chart.kde', 'KDE');
        var kdeData = o.kde.x.map(function (x, i) { return [x, o.kde.y[i]]; });
        return Object.assign(b, {
          grid: { left: 8, right: 16, top: 44, bottom: 8, containLabel: true },
          legend: Object.assign(b.legend, { data: [o.valueName, kdeName] }),
          xAxis: [
            Object.assign(catAxis('', t), { data: o.labels, position: 'bottom' }),
            Object.assign(valAxis(o.xName || o.valueName, t), {
              position: 'top', min: dom ? dom[0] : null, max: dom ? dom[1] : null,
              splitLine: { show: false }
            })
          ],
          yAxis: [
            valAxis(o.countName || lbl('chart.count', 'count'), t),
            Object.assign(valAxis(o.densityName || lbl('chart.density', 'density'), t), { position: 'right', splitLine: { show: false } })
          ],
          series: [
            bars,
            {
              name: kdeName, type: 'line', xAxisIndex: 1, yAxisIndex: 1, z: 3,
              data: kdeData, smooth: true, showSymbol: false,
              lineStyle: { width: 2.4, color: t.accent2 }, itemStyle: { color: t.accent2 },
              tooltip: { show: false }
            },
            /* 曲线本身只有 2.4px 宽，鼠标几乎压不中；再叠一条加宽到 24px 的透明线专门
               接收悬停，这样「指向曲线」才能触发整套坐标轴切换。它不画任何东西、不进
               图例也不进提示框；但必须放在最上层（z 高于柱子与曲线），否则曲线从柱子
               上方穿过的那些位置——也就是峰值一带——它永远收不到指针。 */
            {
              name: '', type: 'line', xAxisIndex: 1, yAxisIndex: 1, z: 4,
              data: kdeData, smooth: true, showSymbol: false,
              lineStyle: { width: 24, opacity: 0.01 }, itemStyle: { opacity: 0 },
              emphasis: { disabled: true }, legendHoverLink: false, tooltip: { show: false }
            }
          ]
        });
      }
      return Object.assign(b, {
        legend: { show: false },
        xAxis: { type: 'category', data: o.labels, axisLabel: { color: t.muted, hideOverlap: true }, axisLine: { lineStyle: { color: t.rule } } },
        yAxis: valAxis(o.countName || lbl('chart.count', 'count'), t), series: [bars]
      });
    },

    box: function (o) {
      var t = theme(), b = base(t);
      return Object.assign(b, {
        tooltip: Object.assign(b.tooltip, { trigger: 'item' }),
        legend: { show: false },
        xAxis: catAxis(o.xName, t),
        yAxis: valAxis(o.yName, t),
        series: [{
          name: o.valueName, type: 'boxplot', data: o.boxes,
          itemStyle: { color: 'transparent', borderColor: t.accent, borderWidth: 2 },
          boxWidth: [8, 26]
        }]
      });
    },

    pie: function (o) {
      var t = theme(), b = base(t);
      return Object.assign(b, {
        tooltip: Object.assign(b.tooltip, { trigger: 'item', formatter: function (p) { return p.name + ': ' + fmt(p.value) + ' (' + p.percent + '%)'; } }),
        legend: Object.assign(b.legend, { bottom: 0, top: 'auto' }),
        series: [{
          name: o.valueName, type: 'pie', radius: ['42%', '68%'], center: ['50%', '46%'],
          avoidLabelOverlap: true, padAngle: 1.4,
          itemStyle: { borderColor: t.bg2, borderWidth: 2, borderRadius: 4 },
          label: { color: t.ink, formatter: '{b}\n{d}%' }, labelLine: { lineStyle: { color: t.rule } },
          data: o.data
        }]
      });
    },

    heatmap: function (o) {
      var t = theme(), b = base(t);
      return Object.assign(b, {
        tooltip: {
          trigger: 'item', appendToBody: true, backgroundColor: t.bg2, borderColor: t.rule,
          textStyle: { color: t.ink, fontFamily: FONT, fontSize: 12 },
          formatter: function (p) { return p.value[2] === null ? '—' : ('<b>' + p.value[2] + '</b><br/>' + o.xLabels[p.value[0]] + ' × ' + o.yLabels[p.value[1]]); }
        },
        grid: Object.assign(b.grid, { left: 8, top: 12, bottom: 40, right: 74 }),
        xAxis: Object.assign(catAxis('', t), { data: o.xLabels, splitArea: { show: false } }),
        yAxis: Object.assign(catAxis('', t), { data: o.yLabels, splitArea: { show: false } }),
        visualMap: {
          min: o.min, max: o.max, calculable: true, orient: 'vertical', right: 4, top: 'center',
          itemHeight: 140, textStyle: { color: t.muted },
          inRange: { color: o.colors || heatRamp() || [t.bg2, t.accent2, t.accent] }
        },
        series: [{
          type: 'heatmap', data: o.data, label: { show: o.showLabels !== false, color: t.ink, fontSize: 10 },
          itemStyle: { borderColor: t.bg, borderWidth: 2 }, emphasis: { itemStyle: { borderColor: t.ink } }
        }]
      });
    },

    corrHeatmap: function (o) {
      var t = theme();
      var data = [];
      for (var i = 0; i < o.labels.length; i++) for (var j = 0; j < o.labels.length; j++) data.push([i, j, o.matrix[i][j]]);
      return Charts.heatmap({
        xLabels: o.labels, yLabels: o.labels, data: data, min: -1, max: 1,
        colors: [t.accent2, t.bg2, t.accent], showLabels: o.labels.length <= 10
      });
    },

    scatterMatrix: function (o) {
      var t = theme(), b = base(t), n = o.labels.length;
      if (n < 2) return Charts.bar({ xName: '', valueName: '', series: [] });
      var size = 100 / n, gap = 3;
      var grid = [], xAxis = [], yAxis = [], series = [];
      for (var i = 0; i < n; i++) {
        for (var j = 0; j < n; j++) {
          grid.push({
            left: (j * size + 3) + '%', top: (i * size + 8) + '%',
            width: size - gap + '%', height: size - gap - 4 + '%', containLabel: false
          });
          xAxis.push({
            gridIndex: i * n + j, type: 'value', axisLabel: { show: i === n - 1, color: t.muted, fontSize: 9 },
            splitLine: { show: false }, axisLine: { show: false }, axisTick: { show: false },
            name: i === n - 1 ? o.labels[j] : '', nameLocation: 'middle', nameGap: 16,
            nameTextStyle: { color: t.muted, fontSize: 10 }
          });
          yAxis.push({
            gridIndex: i * n + j, type: 'value', axisLabel: { show: j === 0, color: t.muted, fontSize: 9 },
            splitLine: { show: false }, axisLine: { show: false }, axisTick: { show: false },
            name: j === 0 ? o.labels[i] : '', nameLocation: 'middle', nameGap: 22,
            nameTextStyle: { color: t.muted, fontSize: 10 }
          });
          var pts = [];
          for (var k = 0; k < o.rows.length; k++) {
            if (o.colors && o.rows[k][n]) pts.push([o.rows[k][j], o.rows[k][i] === undefined ? null : o.rows[k][i], o.rows[k][n]]);
            else pts.push([o.rows[k][j], o.rows[k][i], '']);
          }
          series.push({
            type: i === j ? 'bar' : 'scatter', xAxisIndex: i * n + j, yAxisIndex: i * n + j,
            data: i === j ? pts.map(function (p) { return p[0]; }) : pts,
            symbolSize: 4, opacity: 0.6, itemStyle: { color: t.accent },
            large: pts.length > 400, animation: pts.length < 1200
          });
        }
      }
      return Object.assign(b, {
        tooltip: { show: false }, legend: { show: false },
        grid: grid, xAxis: xAxis, yAxis: yAxis, series: series
      });
    },

    missingBar: function (o) {
      var t = theme(), b = base(t);
      var withMissing = o.columns.filter(function (c) { return o.counts[c] > 0; });
      var cats = withMissing.length ? withMissing : o.columns;
      return Object.assign(b, {
        legend: { show: false },
        grid: Object.assign(b.grid, { left: 8, right: 56, top: 16 }),
        tooltip: Object.assign(b.tooltip, {
          formatter: function (p) {
            var c = o.counts[p.name] || 0;
            return '<b>' + p.name + '</b><br/>' + c + ' / ' + o.total + ' (' + (o.total ? (c / o.total * 100).toFixed(1) : 0) + '%)';
          }
        }),
        xAxis: valAxis(o.axisName || lbl('chart.missing', 'missing'), t),
        yAxis: Object.assign(catAxis('', t), { data: cats }),
        series: [{
          type: 'bar', data: cats.map(function (c) { return o.counts[c]; }), barMaxWidth: 18,
          itemStyle: { color: t.accent2, borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: 'right', color: t.muted, formatter: '{c}' }
        }]
      });
    },

    donut: function (o) { return Charts.pie(o); }
  };

  global.Charts = Charts;
})(window);
