/* datasets.js — built-in sample datasets (one is loaded by default). */
(function (global) {
  'use strict';

  function mulberry(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pick(rnd, arr) { return arr[Math.floor(rnd() * arr.length)]; }
  function rint(rnd, a, b) { return a + Math.floor(rnd() * (b - a + 1)); }
  function round(x, d) { var m = Math.pow(10, d || 0); return Math.round(x * m) / m; }

  var IRIS = [
    '5.1,3.5,1.4,.2,setosa', '4.9,3,1.4,.2,setosa', '4.7,3.2,1.3,.2,setosa', '4.6,3.1,1.5,.2,setosa', '5,3.6,1.4,.2,setosa',
    '5.4,3.9,1.7,.4,setosa', '4.6,3.4,1.4,.3,setosa', '5,3.4,1.5,.2,setosa', '4.4,2.9,1.4,.2,setosa', '4.9,3.1,1.5,.1,setosa',
    '5.4,3.7,1.5,.2,setosa', '4.8,3.4,1.6,.2,setosa', '4.8,3,1.4,.1,setosa', '4.3,3,1.1,.1,setosa', '5.8,4,1.2,.2,setosa',
    '5.7,4.4,1.5,.4,setosa', '5.4,3.9,1.3,.4,setosa', '5.1,3.5,1.4,.3,setosa', '5.7,3.8,1.7,.3,setosa', '5.1,3.8,1.5,.3,setosa',
    '5.4,3.4,1.7,.2,setosa', '5.1,3.7,1.5,.4,setosa', '4.6,3.6,1,.2,setosa', '5.1,3.3,1.7,.5,setosa', '4.8,3.4,1.9,.2,setosa',
    '5,3,1.6,.2,setosa', '5,3.4,1.6,.4,setosa', '5.2,3.5,1.5,.2,setosa', '5.2,3.4,1.4,.2,setosa', '4.7,3.2,1.6,.2,setosa',
    '4.8,3.1,1.6,.2,setosa', '5.4,3.4,1.5,.4,setosa', '5.2,4.1,1.5,.1,setosa', '5.5,4.2,1.4,.2,setosa', '4.9,3.1,1.5,.2,setosa',
    '5,3.2,1.2,.2,setosa', '5.5,3.5,1.3,.2,setosa', '4.9,3.6,1.4,.1,setosa', '4.4,3,1.3,.2,setosa', '5.1,3.4,1.5,.2,setosa',
    '5,3.5,1.3,.3,setosa', '4.5,2.3,1.3,.3,setosa', '4.4,3.2,1.3,.2,setosa', '5,3.5,1.6,.6,setosa', '5.1,3.8,1.9,.4,setosa',
    '4.8,3,1.4,.3,setosa', '5.1,3.8,1.6,.2,setosa', '4.6,3.2,1.4,.2,setosa', '5.3,3.7,1.5,.2,setosa', '5,3.3,1.4,.2,setosa',
    '7,3.2,4.7,1.4,versicolor', '6.4,3.2,4.5,1.5,versicolor', '6.9,3.1,4.9,1.5,versicolor', '5.5,2.3,4,1.3,versicolor', '6.5,2.8,4.6,1.5,versicolor',
    '5.7,2.8,4.5,1.3,versicolor', '6.3,3.3,4.7,1.6,versicolor', '4.9,2.4,3.3,1,versicolor', '6.6,2.9,4.6,1.3,versicolor', '5.2,2.7,3.9,1.4,versicolor',
    '5,2,3.5,1,versicolor', '5.9,3,4.2,1.5,versicolor', '6,2.2,4,1,versicolor', '6.1,2.9,4.7,1.4,versicolor', '5.6,2.9,3.6,1.3,versicolor',
    '6.7,3.1,4.4,1.4,versicolor', '5.6,3,4.5,1.5,versicolor', '5.8,2.7,4.1,1,versicolor', '6.2,2.2,4.5,1.5,versicolor', '5.6,2.5,3.9,1.1,versicolor',
    '5.9,3.2,4.8,1.8,versicolor', '6.1,2.8,4,1.3,versicolor', '6.3,2.5,4.9,1.5,versicolor', '6.1,2.8,4.7,1.2,versicolor', '6.4,2.9,4.3,1.3,versicolor',
    '6.6,3,4.4,1.4,versicolor', '6.8,2.8,4.8,1.4,versicolor', '6.7,3,5,1.7,versicolor', '6,2.9,4.5,1.5,versicolor', '5.7,2.6,3.5,1,versicolor',
    '5.5,2.4,3.8,1.1,versicolor', '5.5,2.4,3.7,1,versicolor', '5.8,2.7,3.9,1.2,versicolor', '6,2.7,5.1,1.6,versicolor', '5.4,3,4.5,1.5,versicolor',
    '6,3.4,4.5,1.6,versicolor', '6.7,3.1,4.7,1.5,versicolor', '6.3,2.3,4.4,1.3,versicolor', '5.6,3,4.1,1.3,versicolor', '5.5,2.5,4,1.3,versicolor',
    '5.5,2.6,4.4,1.2,versicolor', '6.1,3,4.6,1.4,versicolor', '5.8,2.6,4,1.2,versicolor', '5,2.3,3.3,1,versicolor', '5.6,2.7,4.2,1.3,versicolor',
    '5.7,3,4.2,1.2,versicolor', '5.7,2.9,4.2,1.3,versicolor', '6.2,2.9,4.3,1.3,versicolor', '5.1,2.5,3,1.1,versicolor', '5.7,2.8,4.1,1.3,versicolor',
    '6.3,3.3,6,2.5,virginica', '5.8,2.7,5.1,1.9,virginica', '7.1,3,5.9,2.1,virginica', '6.3,2.9,5.6,1.8,virginica', '6.5,3,5.8,2.2,virginica',
    '7.6,3,6.6,2.1,virginica', '4.9,2.5,4.5,1.7,virginica', '7.3,2.9,6.3,1.8,virginica', '6.7,2.5,5.8,1.8,virginica', '7.2,3.6,6.1,2.5,virginica',
    '6.5,3.2,5.1,2,virginica', '6.4,2.7,5.3,1.9,virginica', '6.8,3,5.5,2.1,virginica', '5.7,2.5,5,2,virginica', '5.8,2.8,5.1,2.4,virginica',
    '6.4,3.2,5.3,2.3,virginica', '6.5,3,5.5,1.8,virginica', '7.7,3.8,6.7,2.2,virginica', '7.7,2.6,6.9,2.3,virginica', '6,2.2,5,1.5,virginica',
    '6.9,3.2,5.7,2.3,virginica', '5.6,2.8,4.9,2,virginica', '7.7,2.8,6.7,2,virginica', '6.3,2.7,4.9,1.8,virginica', '6.7,3.3,5.7,2.1,virginica',
    '7.2,3.2,6,1.8,virginica', '6.2,2.8,4.8,1.8,virginica', '6.1,3,4.9,1.8,virginica', '6.4,2.8,5.6,2.1,virginica', '7.2,3,5.8,1.6,virginica',
    '7.4,2.8,6.1,1.9,virginica', '7.9,3.8,6.4,2,virginica', '6.4,2.8,5.6,2.2,virginica', '6.3,2.8,5.1,1.5,virginica', '6.1,2.6,5.6,1.4,virginica',
    '7.7,3,6.1,2.3,virginica', '6.3,3.4,5.6,2.4,virginica', '6.4,3.1,5.5,1.8,virginica', '6,3,4.8,1.8,virginica', '6.9,3.1,5.4,2.1,virginica',
    '6.7,3.1,5.6,2.4,virginica', '6.9,3.1,5.1,2.3,virginica', '5.8,2.7,5.1,1.9,virginica', '6.8,3.2,5.9,2.3,virginica', '6.7,3.3,5.7,2.5,virginica',
    '6.7,3,5.2,2.3,virginica', '6.3,2.5,5,1.9,virginica', '6.5,3,5.2,2,virginica', '6.2,3.4,5.4,2.3,virginica', '5.9,3,5.1,1.8,virginica'
  ];

  /* Localised column names and category values, so that a built-in sample reads
     Chinese in 中文 mode and English in EN mode. Numbers stay byte-identical. */
  var L = {
    zh: {
      iris: { sl: '花萼长度', sw: '花萼宽度', pl: '花瓣长度', pw: '花瓣宽度', species: '品种' },
      irisSpecies: { setosa: '山鸢尾', versicolor: '变色鸢尾', virginica: '维吉尼亚鸢尾' },
      sales: {
        id: '订单编号', date: '日期', region: '地区', category: '品类', channel: '渠道',
        qty: '数量', price: '单价', discount: '折扣', revenue: '营收', profit: '利润',
        rating: '评分', returned: '退货', idPrefix: '订单-'
      },
      salesCat: { '电子产品': { price: [120, 1400], margin: [0.06, 0.18] }, '家具': { price: [90, 900], margin: [0.10, 0.26] }, '办公用品': { price: [8, 120], margin: [0.20, 0.42] }, '服饰': { price: [15, 220], margin: [0.28, 0.55] } },
      salesRegion: [['华东', 0.32], ['西南', 0.26], ['华北', 0.22], ['华南', 0.20]],
      salesChannel: ['线上', '门店', '分销'],
      pax: {
        id: '乘客编号', pclass: '舱位', sex: '性别', age: '年龄', sibsp: '同乘兄弟姐妹数', parch: '同乘父母子女数',
        fare: '票价', embarked: '登船港口', survived: '是否生还'
      },
      paxSex: { male: '男', female: '女' },
      paxPort: { S: '南安普顿', C: '瑟堡', Q: '皇后镇' }
    },
    en: {
      iris: { sl: 'sepal_length', sw: 'sepal_width', pl: 'petal_length', pw: 'petal_width', species: 'species' },
      irisSpecies: { setosa: 'setosa', versicolor: 'versicolor', virginica: 'virginica' },
      sales: {
        id: 'order_id', date: 'date', region: 'region', category: 'category', channel: 'channel',
        qty: 'quantity', price: 'unit_price', discount: 'discount', revenue: 'revenue', profit: 'profit',
        rating: 'rating', returned: 'returned', idPrefix: 'ORD-'
      },
      salesCat: { 'Electronics': { price: [120, 1400], margin: [0.06, 0.18] }, 'Furniture': { price: [90, 900], margin: [0.10, 0.26] }, 'Office': { price: [8, 120], margin: [0.20, 0.42] }, 'Apparel': { price: [15, 220], margin: [0.28, 0.55] } },
      salesRegion: [['East', 0.32], ['West', 0.26], ['North', 0.22], ['South', 0.20]],
      salesChannel: ['Online', 'Retail', 'Partner'],
      pax: {
        id: 'passenger_id', pclass: 'pclass', sex: 'sex', age: 'age', sibsp: 'sibsp', parch: 'parch',
        fare: 'fare', embarked: 'embarked', survived: 'survived'
      },
      paxSex: { male: 'male', female: 'female' },
      paxPort: { S: 'S', C: 'C', Q: 'Q' }
    }
  };
  function lab(lang) { return L[lang] || L.zh; }

  function buildIris(lang) {
    var l = lab(lang);
    var recs = IRIS.map(function (line) {
      var p = line.split(',');
      var r = {};
      r[l.iris.sl] = +p[0]; r[l.iris.sw] = +p[1]; r[l.iris.pl] = +p[2]; r[l.iris.pw] = +p[3];
      r[l.iris.species] = l.irisSpecies[p[4]] || p[4];
      return r;
    });
    return DF.DataFrame.fromRecords(recs);
  }

  function buildSales(lang) {
    var l = lab(lang), C = l.sales;
    var rnd = mulberry(20240607);
    var regionW = l.salesRegion;
    var cat = l.salesCat;
    var cats = Object.keys(cat), channels = l.salesChannel;
    var monthSeason = [0.72, 0.78, 0.95, 0.9, 0.98, 1.05, 1.02, 0.96, 1.1, 1.16, 1.34, 1.45];
    var recs = [];
    for (var i = 0; i < 340; i++) {
      var month = rint(rnd, 1, 12);
      var day = rint(rnd, 1, 28);
      var r = rnd(), region = regionW[0][0], acc = 0;
      for (var w = 0; w < regionW.length; w++) { acc += regionW[w][1]; if (r <= acc) { region = regionW[w][0]; break; } }
      var c = pick(rnd, cats), meta = cat[c];
      var channel = pick(rnd, channels);
      var qty = rint(rnd, 1, channel === channels[2] ? 18 : 9);
      var unit = round(meta.price[0] + rnd() * (meta.price[1] - meta.price[0]), 2);
      var discount = round(Math.max(0, Math.min(0.45, (rnd() - 0.55) * 0.9 + (channel === channels[0] ? 0.06 : 0))), 3);
      var revenue = round(qty * unit * (1 - discount) * monthSeason[month - 1], 2);
      var margin = meta.margin[0] + rnd() * (meta.margin[1] - meta.margin[0]) - discount * 0.35;
      var profit = round(revenue * margin, 2);
      var returned = rnd() < (channel === channels[0] ? 0.09 : 0.04);
      var sat = round(Math.max(1, Math.min(5, 4.4 + (margin - 0.25) * 2 + (rnd() - 0.5) * 1.6 - (returned ? 1 : 0))), 1);
      var rec = {};
      rec[C.id] = C.idPrefix + (10240 + i);
      rec[C.date] = '2023-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      rec[C.region] = region; rec[C.category] = c; rec[C.channel] = channel;
      rec[C.qty] = qty; rec[C.price] = unit; rec[C.discount] = discount;
      rec[C.revenue] = revenue; rec[C.profit] = profit; rec[C.rating] = sat; rec[C.returned] = returned;
      recs.push(rec);
    }
    return DF.DataFrame.fromRecords(recs);
  }

  function buildPassengers(lang) {
    var l = lab(lang), P = l.pax;
    var rnd = mulberry(917733);
    var recs = [];
    for (var i = 0; i < 240; i++) {
      var pclass = rnd() < 0.52 ? 3 : (rnd() < 0.55 ? 2 : 1);
      var sex = rnd() < 0.64 ? 'male' : 'female';
      var baseAge = pclass === 1 ? 39 : (pclass === 2 ? 30 : 24);
      var age = Math.round(baseAge + (rnd() - 0.5) * 34);
      if (age < 1) age = 1;
      var missingAge = rnd() < 0.18;
      var fare = pclass === 1 ? round(50 + rnd() * 450, 2) : (pclass === 2 ? round(12 + rnd() * 55, 2) : round(3 + rnd() * 40, 2));
      var missingFare = rnd() < 0.10;
      var port = rnd() < 0.74 ? 'S' : (rnd() < 0.6 ? 'C' : 'Q');
      var sibsp = rint(rnd, 0, 4), parch = rint(rnd, 0, 3);
      var survP = 0.22 + (sex === 'female' ? 0.42 : 0) + (pclass === 1 ? 0.22 : pclass === 2 ? 0.08 : -0.05) - sibsp * 0.03;
      var rec = {};
      rec[P.id] = 1000 + i; rec[P.pclass] = pclass; rec[P.sex] = l.paxSex[sex];
      rec[P.age] = missingAge ? null : age;
      rec[P.sibsp] = sibsp; rec[P.parch] = parch;
      rec[P.fare] = missingFare ? null : fare;
      rec[P.embarked] = l.paxPort[port];
      rec[P.survived] = rnd() < Math.max(0.04, Math.min(0.95, survP)) ? 1 : 0;
      recs.push(rec);
    }
    return DF.DataFrame.fromRecords(recs);
  }

  var DATASETS = {
    sales: {
      id: 'sales',
      name: { zh: '季度销售订单（默认）', en: 'Sales orders (default)' },
      desc: { zh: '340 条订单流水，含地区、品类、渠道、折扣与利润，适合分组、透视与相关性分析。', en: '340 order records with region, category, channel, discount and profit — ideal for grouping, pivoting and correlation.' },
      build: buildSales
    },
    iris: {
      id: 'iris',
      name: { zh: '鸢尾花 Iris', en: 'Iris flowers' },
      desc: { zh: '经典的 150 行生物测量数据，含三个鸢尾花品种的四个花部尺寸。', en: 'The classic 150-row botanical measurement set across three Iris species.' },
      build: buildIris
    },
    passengers: {
      id: 'passengers',
      name: { zh: '乘客名单（含缺失值）', en: 'Passengers (with missing values)' },
      desc: { zh: '240 条乘客记录，年龄与票价为刻意缺失，用来演示缺失值检测与填充。', en: '240 passenger records with deliberately missing age and fare to showcase missing-value handling.' },
      build: buildPassengers
    }
  };

  global.DATASETS = DATASETS;
  global.DEFAULT_DATASET = 'sales';
})(window);
