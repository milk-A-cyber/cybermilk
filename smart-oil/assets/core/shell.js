/* =========================================================
   应用外壳 Shell
   ---------------------------------------------------------
   职责：路由、页面骨架、导航、把案例挂到场景页上。
   不含任何具体案例的业务内容 —— 那些都在 assets/cases/*.js
   ========================================================= */

(function (global) {
  'use strict';

  var A = global.ATLAS;
  var M = A.methods;
  var K = global.K;
  var esc = K.esc, pad = K.pad, rich = K.rich;

  var view = document.getElementById('view');
  var mounted = null;          // 当前挂载中的示范，切页时调用其 unmount
  var mountedKey = '';

  /* =========================================================
     一、路由
     ========================================================= */
  function parseHash() {
    var h = location.hash.replace(/^#/, '') || '/';
    var qi = h.indexOf('?'), qs = '';
    if (qi >= 0) { qs = h.slice(qi + 1); h = h.slice(0, qi); }
    var q = {};
    qs.split('&').forEach(function (kv) {
      if (!kv) return;
      var p = kv.split('=');
      q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
    });
    return { parts: h.split('/').filter(Boolean), q: q };
  }

  function go(hash) { location.hash = hash; }

  /* file:// 协议下部分浏览器会拒绝 replaceState，失败时静默降级 */
  function setHashQuiet(hash) {
    try { history.replaceState(null, '', hash); }
    catch (e) { /* 忽略：地址栏不同步不影响功能 */ }
  }

  /* =========================================================
     二、公共片段
     ========================================================= */
  function header() {
    var r = parseHash();
    var cur = r.parts[0] || 'home';
    function on(k) { return cur === k ? ' on' : ''; }
    return '<header class="hdr"><div class="hdr-in">' +
      '<a class="brand" href="#/">' +
      '<span class="brand-mark">' +
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round">' +
      '<path d="M3 17l5-6 4 3 4-6 5 4"/><circle cx="8" cy="11" r="1.6" fill="#fff" stroke="none"/>' +
      '</svg></span>' +
      '<span class="brand-txt"><b>智能化可能性地图</b><span>Petro × AI Atlas</span></span></a>' +
      '<nav class="nav">' +
      '<a class="nav-keep' + on('home') + '" href="#/">总览</a>' +
      '<a class="nav-keep' + on('chain') + '" href="#/chain">作业链</a>' +
      '<a class="nav-keep' + on('cases') + '" href="#/cases">案例库</a>' +
      '<a class="nav-keep' + on('guide') + '" href="#/guide">接入指南</a>' +
      '<a class="nav-keep' + on('admin') + '" href="#/admin">' + (Admin.loggedIn() ? '管理后台' : '管理') + '</a>' +
      '<button class="nav-add" data-import>＋ 添加案例</button>' +
      '</nav></div></header>';
  }

  function footer() {
    var s = Cases.stats();
    return '<footer class="ftr"><div class="wrap"><div class="ftr-in">' +
      '<div class="ftr-col" style="max-width:30ch">' +
      '<h5>关于</h5><p>' + esc(A.meta.title) + '</p>' +
      '<p style="margin-top:8px;color:var(--ink-4)">' + esc(A.meta.version) + ' · 更新于 ' + esc(A.meta.updated) + '</p></div>' +
      '<div class="ftr-col"><h5>地图</h5>' +
      '<a href="#/">总览</a><a href="#/chain">作业链</a><a href="#/method/cv">按方法反查</a></div>' +
      '<div class="ftr-col"><h5>系统</h5>' +
      '<a href="#/cases">案例库（' + s.registered + ' 个已接入）</a>' +
      '<a href="#/guide">接入新案例</a></div>' +
      '<div class="ftr-col"><h5>参与</h5>' +
      '<p>发现问题或想补一个场景？</p>' +
      '<a href="mailto:' + esc(A.meta.email) + '">' + esc(A.meta.email) + '</a></div>' +
      '</div>' +
      '<div class="ftr-bot"><span>场景数据：' + A.allScenes.length + ' 个 · 环节：' + A.stages.length + ' 个</span>' +
      '<span>纯静态 · 无后端 · 可离线运行</span></div>' +
      '</div></footer>';
  }

  function crumb(items) {
    return '<nav class="crumb">' + items.map(function (it, i) {
      var last = i === items.length - 1;
      return (i ? '<span class="sep">/</span>' : '') +
        (last ? '<span class="cur">' + esc(it[1]) + '</span>' : '<a href="' + it[0] + '">' + esc(it[1]) + '</a>');
    }).join('') + '</nav>';
  }

  function methodChip(k) {
    var ck = (M[k] && (M[k].colorKey || k)) || 'cv';
    return '<span class="mtag" data-m="' + ck + '"><b>' + M[k].abbr + '</b>' + esc(M[k].name) + '</span>';
  }

  function caseChip(k) {  /* 案例 methods 标签（小号） */
    var m = M[k];
    if (!m) return '';
    var ck = m.colorKey || k;
    return '<span class="mtag sm" data-m="' + ck + '"><b>' + esc(m.abbr) + '</b>' + esc(m.name) + '</span>';
  }

  function stageBar(stageId) {
    var counts = A.countByStageMethod()[stageId];
    var keys = Object.keys(counts).filter(function (k) { return counts[k] > 0; });
    if (!keys.length) return '<div class="step-bar"><i class="empty"></i></div>';
    return '<div class="step-bar">' + keys.map(function (k) {
      var ck = (M[k] && (M[k].colorKey || k)) || 'cv';
      return '<i style="flex:' + counts[k] + ';background:var(--c-' + ck + ')"></i>';
    }).join('') + '</div>';
  }

  /* =========================================================
     三、十三环节场景图
     ---------------------------------------------------------
     一整幅油田场景：左端勘探，中部一口井（井架 + 井筒剖面，建井六个
     环节都钉在这口井上），右侧采油与集输，最右炼厂。
     13 个环节按真实空间位置排布，而不是排成一行图标。
     ========================================================= */
  var SCENE_ART = {
    /* 01 地质勘察：露头剖面 + 三脚架经纬仪 + 标杆 */
    geology: '<path class="fs-rock" d="M48 205q17-34 41-21t25 21z"/>' +
      '<path class="fs-rock-line" d="M58 205q14-17 32-9"/><path class="fs-rock-line" d="M72 205q11-10 23-4"/>' +
      '<path class="fs-dev" d="M118 126 92 203M118 126 144 203M118 126V203"/>' +
      '<g class="fs-scope">' +
      '<rect class="fs-solid" x="105" y="102" width="27" height="16" rx="2"/>' +
      '<path class="fs-dev" d="M132 106h9v7h-9"/>' +
      '</g>' +
      '<path class="fs-scan" d="M146 111 192 140"/>' +
      '<path class="fs-detail" d="M109 99h19"/>' +
      '<path class="fs-dev" d="M118 126V120"/>' +
      '<path class="fs-dev" d="M158 203V150"/><path class="fs-detail" d="M152 164h12M152 180h12"/>',

    /* 02 物探：可控震源车 + 检波器 + 地下波前 */
    seismic: '<path class="fs-solid" d="M176 168h64v28h-64z"/>' +
      '<path class="fs-dev" d="M176 196h92"/>' +
      '<path class="fs-solid" d="M240 176h28v20h-28z"/>' +
      '<path class="fs-detail" d="M245 180h13v9h-13z"/>' +
      '<circle class="fs-solid" cx="194" cy="196" r="9"/><circle class="fs-detail" cx="194" cy="196" r="3.4"/>' +
      '<circle class="fs-solid" cx="262" cy="196" r="9"/><circle class="fs-detail" cx="262" cy="196" r="3.4"/>' +
      '<path class="fs-solid" d="M212 196h22v7h-22z"/>' +
      '<path class="fs-dev" d="M185 158h17v10h-17z"/>' +
      '<path class="fs-wave" d="M184 236q40 38 80 0"/>' +
      '<path class="fs-wave" style="animation-delay:-1.4s" d="M168 258q56 50 112 0"/>' +
      '<path class="fs-wave" style="animation-delay:-2.8s" d="M152 282q72 62 144 0"/>' +
      '<path class="fs-dev" d="M296 199h6v6h-6zM306 199h6v6h-6z"/>',

    /* 03 钻井：四腿塔式井架 + 天车 + 钻台 */
    drilling: '<path class="fs-dev" d="M356 56 314 203M374 56 416 203"/>' +
      '<path class="fs-dev" d="M340 92H390M330 128H400M320 164H410"/>' +
      '<path class="fs-detail" d="M340 92 400 128M390 92 330 128"/>' +
      '<path class="fs-detail" d="M330 128 410 164M400 128 320 164"/>' +
      '<path class="fs-dev" d="M365 58V166"/>' +
      '<g class="fs-travel">' +
      '<rect class="fs-solid" x="351" y="46" width="28" height="9" rx="1.5"/>' +
      '<rect class="fs-solid" x="355" y="158" width="20" height="6" rx="1"/>' +
      '</g>' +
      '<path class="fs-dev" d="M312 203H418"/>' +
      '<rect class="fs-solid" x="318" y="192" width="96" height="11" rx="1"/>' +
      '<path class="fs-dev" d="M322 168H408"/>',

    /* 04 录井：井场板房 + 泥浆导管 */
    mudlogging: '<path class="fs-dev" d="M410 199H428"/>' +
      '<rect class="fs-solid" x="428" y="160" width="76" height="45"/>' +
      '<path class="fs-dev" d="M424 160H508"/>' +
      '<path class="fs-detail" d="M482 160V148M477 148h10"/>' +
      '<path class="fs-steam" d="M487 146q5-6 0-12"/>' +
      '<rect class="fs-detail fs-screen" x="440" y="172" width="19" height="15"/>' +
      '<path class="fs-dev" d="M482 205v-19h14v19"/>' +
      '<rect class="fs-detail fs-screen" x="464" y="190" width="12" height="11" style="animation-delay:-1.1s"/>',

    /* 05 测井：井筒内仪器串 + 电缆 */
    welllog: '<path class="fs-dev" d="M365 205V262"/>' +
      '<g class="fs-tool">' +
      '<rect class="fs-solid" x="348" y="262" width="34" height="40" rx="5"/>' +
      '<path class="fs-detail" d="M354 273H376M354 281H376M354 289H370"/>' +
      '</g>' +
      '<circle class="fs-ping" cx="365" cy="306" r="3"/>',

    /* 06 固井：套管外的水泥环 */
    cementing: '<path class="fs-cement" d="M337 210h8v227h-8z"/>' +
      '<path class="fs-cement" d="M385 210h8v227h-8z"/>' +
      '<path class="fs-flow-in" d="M383 432V216" style="stroke-dasharray:4 10;opacity:.45"/>',

    /* 07 完井：井口采油树 */
    completion: '<path class="fs-dev" d="M344 172V190M386 172V190"/>' +
      '<path class="fs-dev" d="M331 178H399"/>' +
      '<circle class="fs-solid" cx="331" cy="178" r="3.6"/><circle class="fs-solid" cx="399" cy="178" r="3.6"/>' +
      '<path class="fs-detail" d="M357 178V190M373 178V190"/>' +
      '<rect class="fs-wellhead" x="331" y="190" width="68" height="16" rx="2"/>' +
      '<circle class="fs-ping" cx="399" cy="170" r="2.6" style="animation-delay:-.9s"/>',

    /* 08 射孔：油层段射孔枪 + 弹道 + 闪爆 */
    perforation: '<path class="fs-solid" d="M358 392h14v42h-14z"/>' +
      '<path class="fs-dev" d="M337 400h-9M393 400h9M337 426h-9M393 426h9"/>' +
      '<path class="fs-dev" d="M328 400 313 402M402 400 417 402M328 426 313 428M402 426 417 428"/>' +
      '<circle class="fs-burst" cx="313" cy="402" r="4"/>' +
      '<circle class="fs-burst" cx="417" cy="402" r="4" style="animation-delay:-.95s"/>' +
      '<circle class="fs-burst" cx="313" cy="428" r="4" style="animation-delay:-1.9s"/>' +
      '<circle class="fs-burst" cx="417" cy="428" r="4" style="animation-delay:-2.85s"/>',

    /* 09 采油：游梁式抽油机 */
    production: '<path class="fs-dev" d="M546 205H668"/>' +
      '<rect class="fs-solid" x="588" y="197" width="70" height="8" rx="1"/>' +
      '<path class="fs-dev" d="M594 205 622 130M650 205 622 130"/>' +
      '<path class="fs-detail" d="M602 178H642M606 156H638"/>' +
      '<path class="fs-dev" d="M600 205H646"/>' +
      '<g class="fs-beam">' +
      '<path class="fs-dev" d="M556 128H648"/>' +
      '<path class="fs-solid" d="M556 113a15 15 0 0 0 0 30"/>' +
      '<circle class="fs-solid" cx="622" cy="128" r="4.5"/>' +
      '<path class="fs-dev" d="M556 143V198"/>' +
      '</g>' +
      '<path class="fs-solid" d="M543 198h18v7h-18z"/>' +
      '<path class="fs-dev" d="M646 128V174"/>' +
      '<circle class="fs-dev" cx="645" cy="180" r="6"/>' +
      '<rect class="fs-solid" x="634" y="173" width="23" height="13" rx="3"/>' +
      '<rect class="fs-solid" x="656" y="188" width="13" height="17" rx="2"/>' +
      '<circle class="fs-drop-up" cx="536" cy="190" r="1.8"/>',

    /* 10 修井：车装修井机 + 桅杆 + 大钩 */
    workover: '<path class="fs-dev" d="M676 205H764"/>' +
      '<path class="fs-solid" d="M680 178h56v20h-56z"/>' +
      '<path class="fs-solid" d="M736 182h24v18h-24z"/>' +
      '<path class="fs-detail" d="M740 186h15v9h-15z"/>' +
      '<circle class="fs-solid" cx="692" cy="200" r="7"/><circle class="fs-detail" cx="692" cy="200" r="2.6"/>' +
      '<circle class="fs-solid" cx="750" cy="200" r="7"/><circle class="fs-detail" cx="750" cy="200" r="2.6"/>' +
      '<path class="fs-dev" d="M685 198 693 104M715 198 707 104"/>' +
      '<path class="fs-detail" d="M689 150H711M691 126H709"/>' +
      '<path class="fs-dev" d="M690 104H710"/>' +
      '<g class="fs-hook">' +
      '<path class="fs-dev" d="M700 104V130"/>' +
      '<path class="fs-dev" d="M696 130H704"/>' +
      '<path class="fs-dev" d="M698 130v6a2.6 2.6 0 1 0 5 0v-6"/>' +
      '</g>' +
      '<path class="fs-detail" d="M700 139V198"/>' +
      '<path class="fs-detail" d="M696 198h16"/>',

    /* 11 增采：注入站房 + 注入泵 + 注入井 */
    eor: '<rect class="fs-solid" x="772" y="164" width="48" height="41"/>' +
      '<path class="fs-dev" d="M766 166 796 151 826 166"/>' +
      '<path class="fs-detail" d="M806 152V142M801 142h10"/>' +
      '<rect class="fs-detail" x="779" y="174" width="14" height="11"/>' +
      '<path class="fs-dev" d="M796 205v-16h12v16"/>' +
      '<rect class="fs-solid" x="828" y="184" width="16" height="21" rx="2"/>' +
      '<path class="fs-dev" d="M836 184V176"/>' +
      '<path class="fs-dev" d="M844 190H856"/>' +
      '<rect class="fs-solid" x="856" y="190" width="26" height="10" rx="1.5"/>' +
      '<path class="fs-dev" d="M863 205V456M875 205V456"/>' +
      '<path class="fs-flow-in" d="M869 218V444"/>' +
      '<path class="fs-dev" d="M869 442V458"/>' +
      '<path class="fs-dev" d="M860 450 869 458 878 450"/>' +
      '<path class="fs-detail" d="M863 272h-8M875 342h8M863 402h-8"/>' +
      '<circle class="fs-bubble" cx="866" cy="420" r="1.8"/>' +
      '<circle class="fs-bubble" cx="872" cy="430" r="1.4" style="animation-delay:-2.2s"/>',

    /* 12 运输：拱顶储罐 + 梯子 + 外输管线 */
    transport: '<path class="fs-solid" d="M892 150q20-24 42 0v49a6 6 0 0 1-6 6h-30a6 6 0 0 1-6-6z"/>' +
      '<path class="fs-detail" d="M892 172h42M892 190h42"/>' +
      '<path class="fs-level" d="M896 182q5-2.5 10 0t10 0t10 0t10 0"/>' +
      '<path class="fs-detail" d="M902 205v-44M908 205v-44"/>' +
      '<path class="fs-solid" d="M944 164q17-20 34 0v35a5 5 0 0 1-5 5h-24a5 5 0 0 1-5-5z"/>' +
      '<path class="fs-detail" d="M944 182h34"/>' +
      '<path class="fs-level" d="M948 192q5-2.5 10 0t10 0t10 0t6 0" style="animation-delay:-2.4s"/>' +
      '<path class="fs-detail" d="M952 205v-32M957 205v-32"/>',

    /* 13 加工：炼厂塔群 + 烟囱 + 火炬 */
    refining: '<rect class="fs-solid" x="1012" y="132" width="25" height="73" rx="2"/>' +
      '<path class="fs-dev" d="M1012 132q12.5-11 25 0"/>' +
      '<rect class="fs-solid" x="1044" y="94" width="27" height="111" rx="2"/>' +
      '<path class="fs-dev" d="M1044 94q13.5-12 27 0"/>' +
      '<rect class="fs-solid" x="1078" y="138" width="22" height="67" rx="2"/>' +
      '<path class="fs-dev" d="M1078 138q11-9 22 0"/>' +
      '<rect class="fs-solid" x="1106" y="76" width="13" height="129" rx="2"/>' +
      '<path class="fs-dev" d="M1104 76h17"/>' +
      '<path class="fs-detail" d="M1037 152h10M1068 152h9M1097 152h9M1044 120h27M1044 142h27M1053 168h9"/>' +
      '<path class="fs-detail" d="M1057 94V62M1052 68h11M1012 158h25M1078 162h22"/>' +
      '<circle class="fs-lamp" cx="1006" cy="146" r="1.6"/>' +
      '<circle class="fs-lamp" cx="1098" cy="150" r="1.4" style="animation-delay:-1.6s"/>' +
      '<circle class="fs-lamp" cx="1030" cy="188" r="1.3" style="animation-delay:-3.1s"/>' +
      '<path class="fs-dev" d="M1132 205V126"/><path class="fs-dev" d="M1126 126h12"/>' +
      '<ellipse class="fs-glow" cx="1132" cy="116" rx="8" ry="5"/>' +
      '<path class="fs-fire" d="M1132 126q-9-10-4-21q2 6 5 8q3-9 2-14q9 12 3 20q-2 4-6 7z"/>' +
      '<path class="fs-fire-in" d="M1131 124q-4-6 0-12q4 4 2 9z"/>' +
      '<path class="fs-steam" d="M1112 68q7-8 0-15t6-12"/>' +
      '<path class="fs-steam" d="M1057 60q6-7 0-13t5-11" style="animation-delay:-1.3s"/>'
  };

  /* 标签：x/y 为文字基线，ta 为对齐；lead 为引线；ax/ay 为锚点；hit 为点击热区 */
  var SCENE_LABEL = [
    { id: 'geology',     x: 100,  y: 84,  ta: 'middle', lead: 'M100 90V96',       ax: 100, ay: 98,  hit: [40, 88, 128, 120], sx: 112, sr: 56 },
    { id: 'seismic',     x: 236,  y: 134, ta: 'middle', lead: 'M236 140V152',     ax: 236, ay: 154, hit: [128, 150, 192, 160], sx: 224, sr: 54 },
    { id: 'drilling',    x: 365,  y: 36,  ta: 'middle', lead: 'M365 40V44',       ax: 365, ay: 45,  hit: [306, 44, 124, 162], sx: 365, sr: 54 },
    { id: 'mudlogging',  x: 466,  y: 138, ta: 'middle', lead: 'M466 144V156',     ax: 466, ay: 157, hit: [420, 136, 92, 70], sx: 466, sr: 42 },
    { id: 'welllog',     x: 408,  y: 284, ta: 'start',  lead: 'M402 280H396',     ax: 393, ay: 280, hit: [330, 250, 70, 60] },
    { id: 'completion',  x: 424,  y: 232, ta: 'start',  lead: 'M418 228 404 208', ax: 402, ay: 206, hit: [324, 158, 86, 56] },
    { id: 'cementing',   x: 412,  y: 344, ta: 'start',  lead: 'M406 340H399',     ax: 396, ay: 340, hit: [384, 322, 24, 56] },
    { id: 'perforation', x: 300,  y: 376, ta: 'end',    lead: 'M306 380 330 394', ax: 334, ay: 398, hit: [306, 364, 62, 92] },
    { id: 'production',  x: 596,  y: 114, ta: 'middle', lead: 'M596 120V128',     ax: 596, ay: 130, hit: [538, 114, 140, 94], sx: 606, sr: 58 },
    { id: 'workover',    x: 700,  y: 88,  ta: 'middle', lead: 'M700 94V100',      ax: 700, ay: 102, hit: [672, 96, 96, 112], sx: 722, sr: 44 },
    { id: 'eor',         x: 798,  y: 146, ta: 'middle', lead: 'M798 152V160',     ax: 798, ay: 162, hit: [764, 132, 122, 356], sx: 806, sr: 46 },
    { id: 'transport',   x: 920,  y: 130, ta: 'middle', lead: 'M920 136V144',     ax: 920, ay: 146, hit: [886, 122, 98, 86], sx: 935, sr: 48 },
    { id: 'refining',    x: 1066, y: 56,  ta: 'middle', lead: 'M1066 62V68',      ax: 1066, ay: 70,  hit: [1008, 58, 152, 150], sx: 1076, sr: 60 }
  ];

  function flowMapHTML() {
    var byId = {};
    A.stages.forEach(function (st) { byId[st.id] = st; });

    var items = SCENE_LABEL.map(function (L) {
      var st = byId[L.id];
      if (!st) return '';
      return '<a class="fs-item" data-stage="' + st.id + '" href="#/stage/' + st.id + '">' +
        '<title>' + esc(st.name) + ' · ' + st.scenes.length + ' 个场景</title>' +
        '<rect class="fs-hit" x="' + L.hit[0] + '" y="' + L.hit[1] + '" width="' + L.hit[2] + '" height="' + L.hit[3] + '"/>' +
        (L.sr ? '<ellipse class="fs-shadow" cx="' + L.sx + '" cy="208" rx="' + L.sr + '" ry="3.2"/>' : '') +
        SCENE_ART[L.id] +
        '<path class="fs-lead" d="' + L.lead + '"/>' +
        '<circle class="fs-anchor" cx="' + L.ax + '" cy="' + L.ay + '" r="2.4"/>' +
        '<text class="fs-label" x="' + L.x + '" y="' + L.y + '" text-anchor="' + L.ta + '"' +
        ' style="transform-origin:' + L.x + 'px ' + L.y + 'px">' +
        '<tspan class="fs-no">' + pad(st.idx) + '</tspan> ' + esc(st.name) + '</text>' +
        '</a>';
    }).join('');

    var n = A.stages.length;

    return '<div class="flowmap" data-flowmap>' +
      '<div class="flowmap-scroll">' +
      '<svg viewBox="0 0 1160 560" role="img" aria-label="石油从勘探到加工的 ' + n + ' 个作业环节场景图">' +
      '<defs>' +
      '<linearGradient id="fsSky" x1="0" y1="0" x2="0" y2="1">' +
      '<stop class="fs-sky-a" offset="0"/><stop class="fs-sky-b" offset="1"/></linearGradient>' +
      '<linearGradient id="fsHaze" x1="0" y1="0" x2="0" y2="1">' +
      '<stop class="fs-haze-a" offset="0"/><stop class="fs-haze-b" offset="1"/></linearGradient>' +
      '<pattern id="fsCem" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
      '<line x1="0" y1="0" x2="0" y2="3" class="fs-hatch"/></pattern>' +
      '<pattern id="fsDots" width="17" height="17" patternUnits="userSpaceOnUse">' +
      '<circle cx="4" cy="5" r="1.05" class="fs-dot"/><circle cx="12" cy="13" r=".85" class="fs-dot"/></pattern>' +
      '<pattern id="fsGrit" width="22" height="15" patternUnits="userSpaceOnUse">' +
      '<circle cx="4" cy="5" r="1.5" class="fs-grit"/><circle cx="14" cy="11" r="1" class="fs-grit"/></pattern>' +
      '<pattern id="fsHatchL" width="11" height="11" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
      '<line x1="0" y1="0" x2="0" y2="11" class="fs-hatch-l"/></pattern>' +
      '</defs>' +

      /* 天空：日、云、远山 */
      '<rect class="fs-sky" x="0" y="0" width="1160" height="205" fill="url(#fsSky)"/>' +
      '<circle class="fs-sun-ring" cx="252" cy="40" r="30"/>' +
      '<circle class="fs-sun" cx="252" cy="40" r="19"/>' +
      '<path class="fs-cloud" style="animation-duration:34s" d="M448 62q2-11 13-11 5-9 16-6t9 9q12-1 13 8z"/>' +
      '<path class="fs-cloud" style="animation-duration:46s;animation-delay:-12s" d="M700 38q2-9 11-9 4-8 13-5t8 8q10-1 11 6z"/>' +
      '<path class="fs-cloud" style="animation-duration:29s;animation-delay:-6s" d="M846 52q2-9 11-9 4-8 13-5t8 8q10-1 11 6z"/>' +
      '<rect class="fs-haze" x="0" y="120" width="1160" height="85" fill="url(#fsHaze)"/>' +
      '<path class="fs-bird" d="M320 92q5-5 10 0M330 92q5-5 10 0M348 100q4-4 8 0M356 100q4-4 8 0"/>' +
      '<path class="fs-bird" style="animation-delay:-1.7s" d="M932 78q4-4 8 0M940 78q4-4 8 0"/>' +
      '<path class="fs-hill-b" d="M0 189Q88 148 176 170Q264 194 352 164Q440 138 528 168Q616 196 704 166Q792 140 880 170Q968 198 1056 168Q1120 150 1160 176V205H0Z"/>' +
      '<path class="fs-hill-f" d="M0 201Q120 185 240 199Q360 211 480 197Q600 177 720 197Q840 213 960 195Q1080 177 1160 195V205H0Z"/>' +

      /* 地表 */
      '<path class="fs-grass" d="M136 205l3-7M144 205l2-5M152 205l3-6M196 205l3-6M203 205l2-4' +
      'M520 205l3-7M528 205l2-5M700 205l3-6M707 205l2-4M968 205l3-6M975 205l2-4' +
      'M1128 205l3-6M1135 205l2-4"/>' +
      '<rect class="fs-topsoil" x="0" y="205" width="1160" height="7"/>' +
      '<path class="fs-ground" d="M0 205H1160"/>' +

      /* 地下：四套地层 + 岩性纹理 + 层名注记 */
      '<rect class="fs-l1" x="0" y="205" width="1160" height="73"/>' +
      '<rect class="fs-l1t" x="0" y="205" width="1160" height="73" fill="url(#fsDots)"/>' +
      '<rect class="fs-l2" x="0" y="278" width="1160" height="74"/>' +
      '<rect class="fs-l2t" x="0" y="278" width="1160" height="74" fill="url(#fsHatchL)"/>' +
      '<rect class="fs-l3" x="0" y="352" width="1160" height="100"/>' +
      '<rect class="fs-l3t" x="0" y="352" width="1160" height="100" fill="url(#fsGrit)"/>' +
      '<rect class="fs-l4" x="0" y="452" width="1160" height="108"/>' +
      '<rect class="fs-l4t" x="0" y="452" width="1160" height="108" fill="url(#fsHatchL)"/>' +
      '<path class="fs-layer" d="M0 278q290 5 580 0t580 0"/>' +
      '<path class="fs-layer" d="M0 352q290-5 580 0t580 0"/>' +
      '<path class="fs-layer" d="M0 452q290 4 580 0t580 0"/>' +
      '<text class="fs-stratum" x="56" y="248">第四系松散层</text>' +
      '<text class="fs-stratum" x="56" y="320">泥岩层</text>' +
      '<text class="fs-stratum" x="56" y="404">砂岩储层</text>' +
      '<text class="fs-stratum" x="56" y="506">致密层</text>' +
      '<path class="fs-strata" d="M344 248h44M722 234h44M928 252h34M1038 240h28"/>' +
      '<path class="fs-strata" d="M420 312h44M560 332h40M902 310h36M212 268h30"/>' +
      '<path class="fs-strata" d="M432 528h44M792 496h46M1002 516h34M640 540h40"/>' +

      /* 深度标尺 */
      '<g class="fs-scale">' +
      '<path class="fs-scale-line" d="M44 205V560"/>' +
      '<path class="fs-tick" d="M39 205h5M37 293.8h7M37 382.5h7M37 471.3h7"/>' +
      '<text class="fs-depth" x="33" y="201" text-anchor="end">0</text>' +
      '<text class="fs-depth" x="52" y="201">m</text>' +
      '<text class="fs-depth" x="33" y="297" text-anchor="end">500</text>' +
      '<text class="fs-depth" x="33" y="386" text-anchor="end">1000</text>' +
      '<text class="fs-depth" x="33" y="475" text-anchor="end">1500</text>' +
      '</g>' +

      /* 油藏透镜体 + 盖层 */
      '<ellipse class="fs-oil" cx="572" cy="414" rx="302" ry="33"/>' +
      '<ellipse class="fs-oil-hi" cx="470" cy="404" rx="118" ry="10"/>' +
      '<ellipse class="fs-oil-hi" cx="756" cy="424" rx="88" ry="8"/>' +
      '<path class="fs-oil-bed" d="M320 410q120-5 240 0M520 428q120-5 240 0"/>' +
      '<path class="fs-oil-cap" d="M280 374Q572 351 868 374"/>' +
      '<circle class="fs-drop" cx="300" cy="418" r="2.2"/><circle class="fs-drop-up" cx="392" cy="409" r="1.9"/>' +
      '<circle class="fs-drop" cx="470" cy="427" r="2.4"/><circle class="fs-drop-up" cx="556" cy="406" r="2" style="animation-delay:-2.4s"/>' +
      '<circle class="fs-drop" cx="648" cy="424" r="2.2"/><circle class="fs-drop-up" cx="726" cy="411" r="1.9" style="animation-delay:-4.1s"/>' +
      '<circle class="fs-drop" cx="808" cy="423" r="2.2"/><circle class="fs-drop-up" cx="864" cy="412" r="1.9" style="animation-delay:-5.6s"/>' +

      /* 井筒剖面：井壁 / 套管 / 管内油流 */
      '<rect class="fs-bore" x="345" y="205" width="40" height="232"/>' +
      '<path class="fs-hole" d="M337 205V437M393 205V437M337 437H393"/>' +
      '<path class="fs-casing" d="M345 214V437M385 214V437"/>' +
      '<path class="fs-flow-in" d="M365 432V262"/>' +

      /* 外输管线（在装置之后被遮挡，形成前后景） */
      '<path class="fs-pipe" d="M646 198H1014"/>' +
      '<path class="fs-flow" d="M648 200.5H1012"/>' +
      '<path class="fs-pipe" d="M646 203H1014"/>' +

      items +
      '</svg></div>' +

      '<div class="flowmap-bar">' +
      '<button type="button" class="fmb-btn" data-flow-play><i class="fmb-ic"></i>' +
      '<span data-flow-play-tx>自动巡览 ' + n + ' 环节</span></button>' +
      '<div class="fmb-read"><b data-flow-name>整幅场景</b>' +
      '<span data-flow-meta>从地表勘探到炼厂加工 · 点任一装置进入场景清单</span></div>' +
      '<div class="fmb-track"><i data-flow-bar></i></div>' +
      '<span class="fmb-count" data-flow-count>00 / ' + pad(n) + '</span>' +
      '</div>' +
      '<div class="chain-hint">按工序从左到右：地表勘探 → 打井 → 采油 → 集输 → 炼厂；井架下方是井筒剖面，建井的四个环节都发生在这口井里 · 点任一环节进入场景清单</div>' +
      '</div>';
  }

  /* =========================================================
     三·B、全景图交互：自动巡览（镜头推近 + 逐环节讲解）
     ========================================================= */
  var FLOW_VB = { w: 1160, h: 560 };

  function flowFocus(L, st) {
    /* 取景范围 = 装置热区 ∪ 标签包围盒，四周再留一点余量 */
    var tw = ((st && st.name ? st.name.length : 3) * 13) + 26;
    var lx = L.ta === 'middle' ? L.x - tw / 2 : (L.ta === 'end' ? L.x - tw : L.x);
    var pad = 16;
    var left = Math.min(L.hit[0], lx) - pad;
    var right = Math.max(L.hit[0] + L.hit[2], lx + tw) + pad;
    var top = Math.min(L.hit[1], L.y - 15) - pad;
    var bot = Math.max(L.hit[1] + L.hit[3], L.y + 6) + pad;

    var ratio = FLOW_VB.w / FLOW_VB.h;
    var w = Math.max(right - left, (bot - top) * ratio);
    w = Math.round(Math.min(700, Math.max(520, w)));
    var h = Math.round(w / ratio);

    var x = Math.round(Math.max(0, Math.min(FLOW_VB.w - w, (left + right) / 2 - w / 2)));
    var y = Math.round((top + bot) / 2 - h / 2);
    if (y > top) y = Math.round(top);          /* 标签在上方的，优先保住标签 */
    y = Math.round(Math.max(0, Math.min(FLOW_VB.h - h, y)));
    return { x: x, y: y, w: w, h: h };
  }

  function bindFlowMap(root) {
    var box = root.querySelector('[data-flowmap]');
    if (!box) return;
    var svg = box.querySelector('svg');
    if (!svg) return;

    var items = [].slice.call(box.querySelectorAll('.fs-item'));
    var btn = box.querySelector('[data-flow-play]');
    var btnTx = box.querySelector('[data-flow-play-tx]');
    var nameEl = box.querySelector('[data-flow-name]');
    var metaEl = box.querySelector('[data-flow-meta]');
    var barEl = box.querySelector('[data-flow-bar]');
    var cntEl = box.querySelector('[data-flow-count]');

    var byId = {};
    items.forEach(function (a) { byId[a.getAttribute('data-stage')] = a; });
    var route = SCENE_LABEL.filter(function (L) { return byId[L.id]; });
    var total = route.length;

    var full = { x: 0, y: 0, w: FLOW_VB.w, h: FLOW_VB.h };
    var cam = { x: 0, y: 0, w: FLOW_VB.w, h: FLOW_VB.h };
    var tgt = { x: 0, y: 0, w: FLOW_VB.w, h: FLOW_VB.h };
    var raf = 0, timer = 0, idx = -1, playing = false, paused = false;

    function apply() {
      svg.setAttribute('viewBox',
        cam.x.toFixed(1) + ' ' + cam.y.toFixed(1) + ' ' + cam.w.toFixed(1) + ' ' + cam.h.toFixed(1));
      svg.style.setProperty('--k', (FLOW_VB.w / cam.w).toFixed(4));
    }

    function step() {
      raf = 0;
      if (!svg.isConnected) return;
      var moved = false;
      ['x', 'y', 'w', 'h'].forEach(function (k) {
        var d = tgt[k] - cam[k];
        if (Math.abs(d) > 0.3) { cam[k] += d * 0.17; moved = true; }
        else cam[k] = tgt[k];
      });
      apply();
      if (moved) raf = requestAnimationFrame(step);
    }

    function to(t) {
      tgt = t;
      if (!raf) raf = requestAnimationFrame(step);
    }

    function setActive(i) {
      items.forEach(function (a) {
        var on = idx >= 0 && a === byId[route[idx].id];
        a.classList.toggle('is-on', on);
        a.classList.toggle('is-dim', idx >= 0 && !on);
      });
    }

    function caption(i) {
      if (i < 0) {
        nameEl.textContent = '整幅场景';
        metaEl.textContent = '从地表勘探到炼厂加工 · 点任一装置进入场景清单';
        cntEl.textContent = '00 / ' + pad(total);
        barEl.style.width = '0%';
        return;
      }
      var L = route[i];
      var st = A.index.byStage[L.id];
      nameEl.textContent = pad(st.idx) + ' ' + st.name;
      metaEl.textContent = st.en + ' · ' + st.scenes.length + ' 个场景 · 点图进入清单';
      cntEl.textContent = pad(i + 1) + ' / ' + pad(total);
      barEl.style.width = ((i + 1) / total * 100).toFixed(1) + '%';
    }

    function stopAll() {
      if (timer) { clearTimeout(timer); timer = 0; }
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      playing = false;
      paused = false;
      btn.classList.remove('is-on');
      btnTx.textContent = '自动巡览 ' + total + ' 环节';
    }

    function reset() {
      stopAll();
      idx = -1;
      setActive(-1);
      caption(-1);
      box.classList.remove('is-touring');
      to(full);
    }

    function visit(i) {
      idx = i;
      setActive(i);
      caption(i);
      to(flowFocus(route[i], A.index.byStage[route[i].id]));
      box.classList.add('is-touring');
    }

    function nextStop() {
      timer = 0;
      if (!playing || !svg.isConnected) return;
      if (idx + 1 >= total) { reset(); return; }
      visit(idx + 1);
      timer = setTimeout(nextStop, 2600);
    }

    btn.addEventListener('click', function () {
      if (playing) {                    /* 暂停 */
        if (timer) { clearTimeout(timer); timer = 0; }
        playing = false; paused = true;
        btn.classList.remove('is-on');
        btnTx.textContent = '继续';
        return;
      }
      if (paused && idx >= 0) {         /* 接着播 */
        playing = true; paused = false;
        btn.classList.add('is-on');
        btnTx.textContent = '暂停巡览';
        timer = setTimeout(nextStop, 600);
        return;
      }
      playing = true; paused = false;
      btn.classList.add('is-on');
      btnTx.textContent = '暂停巡览';
      nextStop();
    });

    reset();
  }

  /* =========================================================
     四、首页
     ========================================================= */
  function homeHTML() {
    var s = A.stats();
    var cs = Cases.stats();
    var total = A.allScenes.length;
    var keys = Object.keys(M);

    /* ---- 速览卡里的三块图：难度分段条、覆盖点阵、方法横条 ---- */
    var diffRows = [['低', s.diff.低, 'low'], ['中', s.diff.中, 'mid'], ['高', s.diff.高, 'high']];
    var diffBar = diffRows.map(function (d) {
      return '<i class="d-' + d[2] + '" style="width:' + (d[1] / total * 100).toFixed(2) + '%"></i>';
    }).join('');
    var diffLeg = diffRows.map(function (d) {
      return '<span class="dleg"><i class="d-' + d[2] + '"></i>' + d[0] + '<b>' + d[1] + '</b></span>';
    }).join('');

    var coverPct = total ? Math.round(cs.coveredScenes / total * 100) : 0;
    var waffle = '';
    for (var wi = 0; wi < total; wi++) {
      waffle += '<i' + (wi < cs.coveredScenes ? ' class="on"' : '') + '></i>';
    }

    var maxM = keys.reduce(function (a, k) {
      return Math.max(a, (A.index.byMethod[k] || []).length);
    }, 1);
    var mrows = keys.map(function (k) {
      var n = (A.index.byMethod[k] || []).length;
      var c = 'var(--c-' + (M[k].colorKey || k) + ')';
      return '<a class="mth-r" href="#/method/' + k + '">' +
        '<span class="mth-k">' + M[k].abbr + '</span>' +
        '<span class="mth-b"><i style="width:' + (n / maxM * 100).toFixed(1) + '%;background:' + c + '"></i></span>' +
        '<b>' + n + '</b></a>';
    }).join('');

    var kpis = [
      ['#/chain', A.stages.length, '作业环节'],
      ['#/chain', total, '候选场景'],
      ['#/cases', cs.registered, '已接入案例'],
      ['#/cases', cs.withDemo, '可运行示范']
    ].map(function (x) {
      return '<a class="kpi" href="' + x[0] + '"><b>' + x[1] + '</b><span>' + x[2] + '</span></a>';
    }).join('');

    var chain = A.stages.map(function (st) {
      return '<a class="step" href="#/stage/' + st.id + '">' +
        '<div class="step-idx">' + pad(st.idx) + '</div>' +
        '<div class="step-name">' + esc(st.name) + '</div>' +
        '<div class="step-n">' + st.scenes.length + '<span>场景</span></div>' +
        stageBar(st.id) + '</a>';
    }).join('');

    var mcards = Object.keys(M).map(function (k) {
      return '<a class="mcard" data-m="' + (M[k].colorKey || k) + '" href="#/method/' + k + '">' +
        '<div class="abbr"><b>' + M[k].abbr + '</b><span>' + esc(M[k].signal) + '</span></div>' +
        '<div class="nm">' + esc(M[k].name) + '</div>' +
        '<div class="ds">' + esc(M[k].desc) + '</div>' +
        '<div class="cnt"><b>' + (A.index.byMethod[k] || []).length + '</b>个场景</div></a>';
    }).join('');

    return '<main>' +
      '<section class="hero"><div class="wrap"><div class="hero-grid">' +

      '<div class="hero-main">' +
      '<div class="hero-top">' +
      '<span class="hero-badge">' + esc(A.meta.version) + ' · ' + total + ' 个候选场景</span>' +
      '<span class="hero-badge alt">案例系统 · ' + cs.registered + ' 个已接入</span>' +
      '</div>' +
      '<h1>石油勘探开发的<em>智能化</em><br>可能性地图</h1>' +
      '<p class="hero-lead">把整条作业链拆成 ' + total + ' 个候选场景，逐个说明：哪一步能被算法替掉、需要准备什么数据、难在哪里。带「可运行」标记的场景，可以直接在浏览器里跑一遍，看算法在什么条件下失效。</p>' +
      '<div class="hero-note"><div>' +
      '<p><b>这不是一个展示页，而是一个可扩展的系统。</b>场景元数据、案例内容、可运行示范三者分离；新增案例只需写一个插件文件并注册，外壳、导航、检索路径都会自动接上。</p>' +
      '</div></div>' +
      '<div class="hero-acts">' +
      '<a class="btn primary" href="#/chain">浏览完整作业链 <span class="ar">→</span></a>' +
      '<a class="btn" href="#/scene/w1?tab=demo">看一个可运行示范</a>' +
      '</div>' +
      '</div>' +

      '<aside class="spec">' +
      '<div class="spec-h"><span class="mono">AT A GLANCE · 速览</span><span class="mono">' + esc(A.meta.version) + '</span></div>' +

      '<div class="spec-kpi">' + kpis + '</div>' +

      '<div class="spec-sec">' +
      '<div class="spec-t"><span>难度分布</span><span class="mono">共 ' + total + ' 个</span></div>' +
      '<div class="diff-bar" title="低 ' + s.diff.低 + ' · 中 ' + s.diff.中 + ' · 高 ' + s.diff.高 + '">' + diffBar + '</div>' +
      '<div class="diff-leg">' + diffLeg + '</div>' +
      '</div>' +

      '<div class="spec-sec">' +
      '<div class="spec-t"><span>案例覆盖场景</span><span class="mono">' + cs.coveredScenes + ' / ' + total + '</span></div>' +
      '<div class="cov">' +
      '<div class="cov-waffle">' + waffle + '</div>' +
      '<div class="cov-txt"><b>' + coverPct + '%</b>' +
      '<span>' + (cs.coveredScenes ? '已有 ' + cs.coveredScenes + ' 个场景能点进去看案例' : '还没有场景接入案例') +
      '，还有 ' + (total - cs.coveredScenes) + ' 个待补</span></div>' +
      '</div>' +
      '</div>' +

      '<div class="spec-sec">' +
      '<div class="spec-t"><span class="mono">方法构成 · BY METHOD</span><span class="mono">单位：场景</span></div>' +
      '<div class="mth">' + mrows + '</div>' +
      '</div>' +

      '<div class="spec-f"><span>数据截至 2026-10</span><span>教学用途</span></div>' +
      '</aside>' +

      '</div></div></section>' +

      /* 一张图看懂 13 环节 */
      '<section class="section"><div class="wrap">' +
      '<div class="sec-head">' +
      '<div class="sec-rail"><span class="sec-num">01</span><span class="kicker">THE WHOLE CHAIN · 全链条</span>' +
      '<span class="r"><a class="btn sm ghost" href="#/chain">文字版清单 →</a></span></div>' +
      '<h2>一张图：石油从地下到成品，要走 ' + A.stages.length + ' 个环节</h2>' +
      '<p>从左到右就是作业顺序：先在野外认识地下、放炮探构造，再把井打到油层、固好井壁、射开油层，装上游梁式抽油机把油抽上来；油经管线进罐区，最后送进炼厂。01–08 全在跟地下打交道，直到第 9 步才真正见油。</p>' +
      '</div>' +
      flowMapHTML() +
      '</div></section>' +

      /* 按环节找 */
      '<section class="section"><div class="wrap">' +
      '<div class="sec-head">' +
      '<div class="sec-rail"><span class="sec-num">02</span><span class="kicker">BY STAGE</span>' +
      '<span class="r"><a class="btn sm ghost" href="#/chain">完整链条 →</a></span></div>' +
      '<h2>按环节找：我现在站在哪一步</h2>' +
      '<p>沿着作业链从左到右，每个节点下方的色条表示该环节可用的方法构成。点进去是该环节的场景清单。</p>' +
      '</div>' +
      '<div class="chain-wrap"><div class="chain-scroll"><div class="chain">' + chain + '</div></div>' +
      '<div class="chain-hint">← 横向滚动查看全部 ' + A.stages.length + ' 个环节</div></div>' +
      '</div></section>' +

      /* 按方法找 */
      '<section class="section"><div class="wrap">' +
      '<div class="sec-head">' +
      '<div class="sec-rail"><span class="sec-num">03</span><span class="kicker">BY METHOD</span></div>' +
      '<h2>按方法找：我手上有一套什么技术</h2>' +
      '<p>如果你已经有一支做 CV 或时序的团队，更自然的问法是「这套技术在这行能干什么」。点进去是跨环节的场景清单。</p>' +
      '</div>' +
      '<div class="methods">' + mcards + '</div>' +
      '</div></section>' +

      /* 矩阵 */
      '<section class="section"><div class="wrap">' +
      '<div class="sec-head">' +
      '<div class="sec-rail"><span class="sec-num">04</span><span class="kicker">MATRIX</span></div>' +
      '<h2>方法 × 环节：哪里已经被占满，哪里还是空白</h2>' +
      '<p>行列交点上的数字是该环节里用到该方法的地点数量。点格子直接带筛选条件跳到环节页。</p>' +
      '</div>' +
      matrixHTML() +
      '</div></section>' +

      /* 系统构成 */
      '<section class="section"><div class="wrap">' +
      '<div class="sec-head">' +
      '<div class="sec-rail"><span class="sec-num">05</span><span class="kicker clay">SYSTEM</span>' +
      '<span class="r"><a class="btn primary sm" href="#/guide">接入指南 →</a></span></div>' +
      '<h2>这个系统由三层组成</h2>' +
      '<p>新增一个案例，只动第二层的一个文件，外加 index.html 里一行 script 标签。</p>' +
      '</div>' +
      '<div class="fields">' +
      '<div class="field"><div class="fx">01 · DATA LAYER · assets/data.js</div>' +
      '<h4>场景元数据</h4>' +
      '<p>13 个环节、' + total + ' 个场景的名称、方法标签、难度、数据条件。这一层<b>不含任何案例实现</b>，只是一张可检索的表。</p></div>' +
      '<div class="field"><div class="fx">02 · CASE LAYER · assets/cases/*.js</div>' +
      '<h4>案例插件</h4>' +
      '<p>每个案例一个文件，调用 <b>Cases.register()</b> 声明自己绑定的场景、三块内容与可选的 demo 挂载函数。互不引用、可单独删除。</p></div>' +
      '<div class="field"><div class="fx">03 · SHELL · assets/core/*</div>' +
      '<h4>外壳与组件</h4>' +
      '<p>路由、导航、检索路径、标签/表格/四段式等组件，以及设计令牌。所有案例共用同一套版式，改一次全站生效。</p></div>' +
      '</div>' +
      '<div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">' +
      '<a class="btn" href="#/cases">查看案例库与校验结果 →</a>' +
      '<a class="btn ghost" href="#/guide">看怎么添加下一个案例</a></div>' +
      '</div></section>' +
      '</main>';
  }

  function matrixHTML() {
    var counts = A.countByStageMethod();
    var keys = Object.keys(M);
    var head = '<tr><th>环节</th>' + keys.map(function (k) {
      return '<th>' + M[k].abbr + '</th>';
    }).join('') + '<th>合计</th></tr>';

    var body = A.stages.map(function (st) {
      var c = counts[st.id];
      var rowTotal = st.scenes.length;
      return '<tr><th><i>' + pad(st.idx) + '</i>' + esc(st.name) + '</th>' +
        keys.map(function (k) {
          var n = c[k] || 0;
          return '<td class="' + (n ? '' : 'zero') + '"><a href="#/stage/' + st.id + '?m=' + k + '">' + (n || '·') + '</a></td>';
        }).join('') +
        '<td><a href="#/stage/' + st.id + '" style="color:var(--ink-3)">' + rowTotal + '</a></td></tr>';
    }).join('');

    var foot = '<tr><th>合计</th>' + keys.map(function (k) {
      return '<td>' + (A.index.byMethod[k] || []).length + '</td>';
    }).join('') + '<td>' + A.allScenes.length + '</td></tr>';

    return '<div class="matrix-wrap"><table class="matrix"><thead>' + head + '</thead><tbody>' + body +
      '</tbody><tfoot>' + foot + '</tfoot></table></div>';
  }

  /* =========================================================
     四、链条总览页
     ========================================================= */
  function chainHTML() {
    var rows = A.stages.map(function (st) {
      var top = st.scenes.slice(0, 5).map(function (s) { return s.name; }).join('、');
      return '<a class="scene-row" href="#/stage/' + st.id + '" style="grid-template-columns:52px 1fr auto">' +
        '<div class="sr-n" style="padding-top:9px">' + pad(st.idx) + '</div>' +
        '<div><div class="sr-name">' + esc(st.name) +
        '<span class="mono" style="font-size:9.5px;color:var(--ink-4);letter-spacing:.14em">' + esc(st.en).toUpperCase() + '</span>' +
        '<span class="arrow">→</span></div>' +
        '<div class="sr-point">' + esc(st.blurb) + '</div>' +
        '<div class="sr-meta">' + st.scenes.slice(0, 3).map(function (s) { return methodChip(s.methods[0]); }).join('') +
        '<span class="tag" style="margin-left:4px">' + esc(top) + (st.scenes.length > 5 ? '…' : '') + '</span></div></div>' +
        '<div class="sr-right"><span class="mono" style="font-size:19px;color:var(--ink-2)">' + st.scenes.length + '</span>' +
        '<span class="small muted">场景</span></div></a>';
    }).join('');

    return '<main class="wrap">' +
      crumb([['#/', '总览'], ['#/chain', '作业链']]) +
      '<div class="page-head"><div class="ph-top"><div>' +
      '<div class="ph-idx">CHAIN · ' + A.stages.length + ' 个环节</div>' +
      '<h1>从地质勘察到加工的全链条</h1>' +
      '<p class="blurb">上游到下游按作业顺序排列。每个环节标注可智能化的场景数量与方法构成，点进去看清单。</p>' +
      '</div><div class="ph-stat">' +
      '<div><div class="n">' + A.stages.length + '</div><div class="l">环节</div></div>' +
      '<div><div class="n">' + A.allScenes.length + '</div><div class="l">场景</div></div>' +
      '</div></div></div>' +
      '<div class="scenes">' + rows + '</div></main>';
  }

  /* =========================================================
     五、环节页
     ========================================================= */
  function stageHTML(st, q) {
    var counts = {};
    st.scenes.forEach(function (s) { counts[s.diff] = (counts[s.diff] || 0) + 1; });
    var mFilter = q.m || '';
    var dFilter = q.d || '';

    var methodKeys = Object.keys(M).filter(function (k) {
      return st.scenes.some(function (s) { return s.methods.indexOf(k) >= 0; });
    });
    var methBtns = ['<button class="chip' + (mFilter ? '' : ' on') + '" data-f="m" data-v="">全部方法</button>'].concat(
      methodKeys.map(function (k) {
        return '<button class="chip' + (mFilter === k ? ' on' : '') + '" data-f="m" data-v="' + k + '" data-m="' + k + '">' + M[k].abbr + ' ' + esc(M[k].name) + '</button>';
      })).join('');

    var diffBtns = ['<button class="chip' + (dFilter ? '' : ' on') + '" data-f="d" data-v="">全部难度</button>'].concat(
      ['低', '中', '高'].map(function (d) {
        return '<button class="chip' + (dFilter === d ? ' on' : '') + '" data-f="d" data-v="' + d + '">' + d + '</button>';
      })).join('');

    var list = st.scenes.map(function (sc) {
      var cn = Cases.bySceneAll(sc.id).length;
      return '<a class="scene-row' + (sc.status === 'ext' ? ' is-ext' : '') + '" href="#/scene/' + sc.id + '" data-m="' + sc.methods.join(' ') + '" data-d="' + sc.diff + '">' +
        '<div class="sr-n">' + esc(sc.id.toUpperCase()) + '</div>' +
        '<div><div class="sr-name">' + esc(sc.name) +
        (cn ? '<span class="badge-ready">已接入案例' + (cn > 1 ? ' ×' + cn : '') + '</span>' : '') +
        '<span class="arrow">→</span></div>' +
        '<div class="sr-point">' + esc(sc.point) + '</div>' +
        '<div class="sr-meta">' + sc.methods.map(function (k) {
          var ck = (M[k] && (M[k].colorKey || k)) || 'cv';
          return '<span class="mtag" data-m="' + ck + '"><b>' + M[k].abbr + '</b>' + esc(M[k].name) + '</span>';
        }).join('') + '</div></div>' +
        '<div class="sr-right"><span class="dtag" data-d="' + sc.diff + '">难度 ' + sc.diff + '</span>' +
        (sc.demo ? '<span class="badge-wip" style="border-style:solid;color:var(--jade-d);background:var(--jade-l);border-color:rgba(47,125,107,.2)">可运行</span>' : '') +
        '</div></a>';
    }).join('');

    var idx = A.stages.indexOf(st);
    var prev = A.stages[idx - 1], next = A.stages[idx + 1];

    return '<main class="wrap">' +
      crumb([['#/', '总览'], ['#/chain', '作业链'], ['#/stage/' + st.id, st.name]]) +
      '<div class="page-head"><div class="ph-top"><div>' +
      '<div class="ph-idx">' + pad(st.idx) + ' / ' + pad(A.stages.length) + '</div>' +
      '<h1>' + esc(st.name) + '环节的可智能化场景<span class="en">' + esc(st.en) + '</span></h1>' +
      '<p class="blurb">' + esc(st.blurb) + '</p></div>' +
      '<div class="ph-stat">' +
      '<div><div class="n">' + st.scenes.length + '</div><div class="l">场景</div></div>' +
      '<div><div class="n">' + (counts.低 || 0) + '</div><div class="l">低难度</div></div>' +
      '<div><div class="n">' + (counts.高 || 0) + '</div><div class="l">高难度</div></div>' +
      '</div></div></div>' +

      '<div class="filters"><span class="lbl">方法</span>' + methBtns +
      '<span class="divider"></span><span class="lbl">难度</span>' + diffBtns +
      '<span class="count" id="f-count">' + st.scenes.length + ' 个场景</span></div>' +
      '<div class="scenes" id="scene-list">' + list + '</div>' +
      '<div class="pager">' +
      (prev ? '<a href="#/stage/' + prev.id + '" class="prev"><span class="dir">← 上一环节</span><span class="nm">' + pad(prev.idx) + ' ' + esc(prev.name) + '</span></a>' : '') +
      (next ? '<a href="#/stage/' + next.id + '" class="next"><span class="dir">下一环节 →</span><span class="nm">' + pad(next.idx) + ' ' + esc(next.name) + '</span></a>' : '') +
      '</div></main>';
  }

  function bindFilters(root) {
    var listEl = root.querySelector('#scene-list');
    if (!listEl) return;
    var st = { m: '', d: '' };
    var chips = root.querySelectorAll('.filters .chip');
    [].forEach.call(chips, function (c) {
      if (c.classList.contains('on')) st[c.dataset.f] = c.dataset.v;
    });

    function apply() {
      var n = 0;
      [].forEach.call(listEl.children, function (row) {
        var ms = (row.dataset.m || '').split(' ');
        var okM = !st.m || ms.indexOf(st.m) >= 0;
        var okD = !st.d || row.dataset.d === st.d;
        var show = okM && okD;
        row.style.display = show ? '' : 'none';
        if (show) n++;
      });
      var cnt = root.querySelector('#f-count');
      if (cnt) cnt.textContent = n + ' 个场景';
      if (!n) {
        if (!listEl.querySelector('.filter-empty')) {
          var d = document.createElement('div');
          d.className = 'empty filter-empty';
          d.innerHTML = '<b>没有符合条件的场景</b>换个筛选条件试试。';
          listEl.appendChild(d);
        }
      } else {
        var e = listEl.querySelector('.filter-empty');
        if (e) e.remove();
      }
    }

    [].forEach.call(chips, function (c) {
      c.addEventListener('click', function () {
        var f = c.dataset.f;
        st[f] = c.dataset.v;
        [].forEach.call(chips, function (x) {
          if (x.dataset.f === f) x.classList.toggle('on', x === c);
        });
        apply();
        var hash = '#/stage/' + parseHash().parts[1] + (st.m ? '?m=' + st.m + (st.d ? '&d=' + st.d : '') : (st.d ? '?d=' + st.d : ''));
        setHashQuiet(hash);
      });
    });
    apply();
  }

  /* =========================================================
     六、方法反查页
     ========================================================= */
  function methodHTML(key) {
    if (!M[key]) return '<main class="wrap"><div class="empty"><b>没有这个方法类别</b></div></main>';
    var all = A.index.byMethod[key] || [];
    var hitStages = A.stages.filter(function (st) {
      return st.scenes.some(function (s) { return s.methods.indexOf(key) >= 0; });
    });
    var groups = hitStages.map(function (st) {
      var rows = st.scenes.filter(function (s) { return s.methods.indexOf(key) >= 0; }).map(function (sc) {
        var c = Cases.byScene(sc.id);
        return '<a class="mrow" href="#/scene/' + sc.id + '">' +
          '<div><div class="nm">' + esc(sc.name) + (c ? '<span class="badge-ready">案例</span>' : '') + '</div>' +
          '<div class="pt">' + esc(sc.point) + '</div></div>' +
          '<div class="rt"><span class="dtag" data-d="' + sc.diff + '">' + sc.diff + '</span><span class="mono" style="font-size:10px;color:var(--ink-4)">→</span></div></a>';
      }).join('');
      return '<div class="method-group"><div class="mg-head">' +
        '<span class="idx">' + pad(st.idx) + '</span><h3>' + esc(st.name) + '</h3>' +
        '<span class="cnt">' + st.scenes.filter(function (s) { return s.methods.indexOf(key) >= 0; }).length + ' 个</span></div>' +
        '<div class="mg-list">' + rows + '</div></div>';
    }).join('');

    return '<main class="wrap">' +
      crumb([['#/', '总览'], ['#/method/' + key, M[key].name]]) +
      '<div class="page-head"><div class="ph-top"><div>' +
      '<div class="ph-idx">METHOD · ' + M[key].abbr + '</div>' +
      '<h1>' + esc(M[key].name) + '在石油勘探开发中的可应用场景<span class="en">' + esc(M[key].signal) + '</span></h1>' +
      '<p class="blurb">' + esc(M[key].desc) + '</p></div>' +
      '<div class="ph-stat"><div><div class="n">' + all.length + '</div><div class="l">场景</div></div>' +
      '<div><div class="n">' + hitStages.length + '</div><div class="l">跨环节</div></div></div>' +
      '</div></div>' +
      '<div style="padding:6px 0 10px">' + groups + '</div>' +
      '<div class="pager"><a href="#/" class="prev"><span class="dir">← 返回</span><span class="nm">总览</span></a></div></main>';
  }

  /* =========================================================
     七、场景详情页（案例自动挂载）
     ========================================================= */
  function sceneHTML(sc, q) {
    var st = A.index.byStage[sc.stageId];
    var allCases = Cases.bySceneAll(sc.id);
    /* 当前展示哪个案例：?case= 指定，默认第一个 */
    var c = allCases.filter(function (x) { return x.id === q.case; })[0] || allCases[0] || null;

    var caseSwitch = '';
    if (allCases.length > 1) {
      caseSwitch = '<div class="case-switch"><span class="cs-lbl">本场景共有 ' + allCases.length +
        ' 个案例，当前展示</span>' + allCases.map(function (x) {
          var on = c && x.id === c.id;
          return '<button class="chip' + (on ? ' on' : '') + '" data-case="' + esc(x.id) + '">' +
            esc(x.title || x.id) + '</button>';
        }).join('') + '</div>';
    }

    var tabs = [];
    if (c) {
      if (c.tabs.background) tabs.push({ key: 'bg', num: '01', name: c.tabs.background.label || '专业背景' });
      if (c.tabs.workflow) tabs.push({ key: 'flow', num: '02', name: c.tabs.workflow.label || '案例流程' });
      if (c.tabs.demo) tabs.push({ key: 'demo', num: '03', name: c.tabs.demo.label || '可运行示范' });
    }

    var tabBtns = tabs.map(function (t, i) {
      return '<button class="tab' + (i === 0 ? ' on' : '') + '" data-tab="' + t.key + '">' +
        '<span class="num">' + t.num + '</span>' + esc(t.name) + '</button>';
    }).join('');

    var panels = '';
    if (c) {
      if (c.tabs.background) panels += '<div class="panel on" data-panel="bg">' + renderBackground(sc, c) + '</div>';
      if (c.tabs.workflow) panels += '<div class="panel" data-panel="flow">' + renderWorkflow(sc, c) + '</div>';
      if (c.tabs.demo) panels += '<div class="panel" data-panel="demo">' + renderDemoShell(sc, c) + '</div>';
    }

    var cBadge = allCases.length
      ? '<span class="badge-ready">案例 ' + esc(c.id) + ' · v' + esc(c.version || '—') + '</span>' +
        (allCases.length > 1 ? '<span class="tag">共 ' + allCases.length + ' 个案例</span>' : '')
      : '<span class="badge-wip">未接入案例</span>';

    var head = '<div class="detail-head">' +
      '<div class="dh-kicker">' +
      '<a class="tag" href="#/stage/' + st.id + '">环节 ' + pad(st.idx) + ' · ' + esc(st.name) + '</a>' +
      sc.methods.map(function (k) {
        var ck = (M[k] && (M[k].colorKey || k)) || 'cv';
        return '<span class="mtag" data-m="' + ck + '"><b>' + M[k].abbr + '</b>' + esc(M[k].name) + '</span>';
      }).join('') +
      cBadge +
      '</div>' +
      '<h1 class="dh-title">' + esc(sc.name) + '</h1>' +
      '<p class="dh-sub">' + esc(sc.intro) + '</p>' +
      '<div class="dh-tags">' + K.dtag(sc.diff) +
      (sc.status === 'ext' ? '<span class="badge-wip">待扩展</span>' : '') +
      '<span class="tag"><span class="dot" style="color:var(--ink-4)"></span>' + esc(sc.id.toUpperCase()) + '</span>' +
      '</div></div>';

    var body = c
      ? caseSwitch + '<div class="tabs" id="tabs">' + tabBtns + '</div>' + panels
      : pendingHTML(sc);

    return '<main class="wrap">' +
      crumb([['#/', '总览'], ['#/chain', '作业链'], ['#/stage/' + st.id, st.name], ['#/scene/' + sc.id, sc.name]]) +
      head + body + relatedHTML(sc) + '</main>';
  }

  /* ---- 有案例：三块内容由案例提供，这里只套版式 ---- */
  function renderBackground(sc, c) {
    var b = c.tabs.background;
    var out = '';
    if (b.judge) out += K.judge(b.judge);
    if (b.lede) out += '<div class="lede-block"><span class="kicker plain">专业场景介绍</span><p>' + rich(b.lede) + '</p></div>';
    (b.sections || []).forEach(function (s, i) {
      out += K.sec4(i + 1, s.en || '', s.title, s.html || s.body || '');
    });
    return out;
  }

  /* ---- 正文降噪：长段落折进「展开全文」，内容一字不删 ---- */
  function foldParas(container, keep, minCount) {
    if (!container) return;
    var ps = [].filter.call(container.children, function (el) { return el.tagName === 'P'; });
    if (ps.length < (minCount || keep + 1)) return;
    var hidden = ps.slice(keep);
    var d = document.createElement('details');
    d.className = 'deep';
    var s = document.createElement('summary');
    s.textContent = '展开全文 · 还有 ' + hidden.length + ' 段';
    var box = document.createElement('div');
    box.className = 'deep-body';
    d.appendChild(s);
    d.appendChild(box);
    container.insertBefore(d, hidden[0]);
    hidden.forEach(function (el) { box.appendChild(el); });
  }
  function condensePanels(root) {
    [].forEach.call(root.querySelectorAll('.panel[data-panel="bg"] .sec4-body'), function (b) {
      foldParas(b, 1, 3);
    });
    [].forEach.call(root.querySelectorAll('.panel[data-panel="flow"] .case-lead > div'), function (b) {
      foldParas(b, 1, 2);
    });
  }

  function renderWorkflow(sc, c) {
    var w = c.tabs.workflow;
    var out = '<div class="case-lead"><div>' +
      '<span class="kicker clay">CASE WALKTHROUGH</span>' +
      '<h3 style="margin-top:10px">' + esc(w.title || '案例流程') + '</h3>' +
      (w.lead || []).map(function (p) { return '<p>' + rich(p) + '</p>'; }).join('') +
      '</div>' + (w.stats ? K.cells(w.stats) : '') + '</div>';

    out += K.pipeline(w.steps || []);

    if (w.metrics) {
      out += K.sec4(0, 'METRICS', w.metrics.title || '怎么算"做对了"', w.metrics.html || '');
    }
    if (w.fails) {
      out += '<div class="sec4"><div class="sn">FAIL<span>MODES</span></div><div class="sec4-body">' +
        '<h3>这类任务通常死在哪</h3>' +
        '<p>下面这些失败模式在同类项目里反复出现。它们多半不是模型能力问题，而是任务定义与数据规范问题。</p>' +
        K.fails(w.fails) + '</div></div>';
    }
    return out;
  }

  function renderDemoShell(sc, c) {
    return '<div id="case-demo-root"></div>';
  }

  /* ---- 无案例：展示速览 + 接入引导 ---- */
  function pendingHTML(sc) {
    var dataRows = sc.data.map(function (d) { return [d[0], d[1], d[2]]; });
    return '<div style="padding-top:8px">' +
      '<div class="sec4" style="border-top:0">' +
      '<div class="sn">01<span>PROBLEM</span></div><div class="sec4-body">' +
      '<h3>业务问题</h3><p>' + esc(sc.problem) + '</p></div></div>' +
      '<div class="sec4"><div class="sn">02<span>INTERVENTION</span></div><div class="sec4-body">' +
      '<h3>AI 介入点</h3><p>' + esc(sc.point) + '</p></div></div>' +
      '<div class="sec4"><div class="sn">03<span>DATA</span></div><div class="sec4-body">' +
      '<h3>数据条件</h3>' + K.dtable(['数据类型', '规模 / 规格', '标注要求'], dataRows) + '</div></div>' +
      '<div class="sec4"><div class="sn">04<span>DIFFICULTY</span></div><div class="sec4-body">' +
      '<h3>技术难度与参考方向</h3>' +
      '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:4px">' + K.dtag(sc.diff) +
      '<span class="small muted">' + esc(sc.diffWhy) + '</span></div>' + K.meter(sc.diff) +
      K.refs(sc.refs, '#/method/' + sc.methods[0]) +
      '</div></div>' +

      '<div class="pending"><div class="pending-top"><span class="badge-wip">案例待接入</span>' +
      '<h3>这个场景还没有配套案例</h3></div>' +
      '<p>它的元数据（问题、介入点、数据条件、难度）已经在地图里，但还没有写成可讲解、可运行的具体案例。案例是按插件方式接入的：写一个文件声明三块内容，注册后这个页面就会自动出现 tab 与示范。</p>' +
      '<div class="pending-lines"><div class="pending-line"></div><div class="pending-line"></div><div class="pending-line"></div></div>' +
      '<div class="pending-actions">' +
      '<button class="btn primary" data-import data-scene="' + esc(sc.id) + '">＋ 为这个场景添加案例</button>' +
      '<a class="btn" href="#/cases">看已接入的案例</a>' +
      '<a class="btn ghost" href="#/guide">看接入说明</a>' +
      '</div></div></div>';
  }

  function relatedHTML(sc) {
    var sameStage = A.index.byStage[sc.stageId].scenes.filter(function (s) { return s.id !== sc.id; }).slice(0, 4);
    var sameMethod = (A.index.byMethod[sc.methods[0]] || []).filter(function (s) { return s.id !== sc.id; }).slice(0, 4);
    return '<div class="related"><div class="sec-head" style="margin-bottom:0;border-top:0;padding-top:0"><div>' +
      '<span class="kicker">RELATED</span><h2 style="font-size:18px;margin-top:8px">相关场景</h2></div></div>' +
      '<div class="rel-grid">' +
      '<div class="rel-col"><h5>同环节 · ' + esc(A.index.byStage[sc.stageId].name) + '</h5>' +
      sameStage.map(function (s) {
        return '<a class="rel-item" href="#/scene/' + s.id + '"><span class="nm">' + esc(s.name) + '</span><span class="go">→</span></a>';
      }).join('') + '</div>' +
      '<div class="rel-col"><h5>同方法 · ' + esc(M[sc.methods[0]].name) + '</h5>' +
      sameMethod.map(function (s) {
        return '<a class="rel-item" href="#/scene/' + s.id + '"><span class="nm">' + esc(s.name) + '</span><span class="go">' + esc(s.stageName) + ' →</span></a>';
      }).join('') + '</div></div>' +
      '<div style="margin-top:18px;display:flex;gap:9px;flex-wrap:wrap">' +
      '<a class="btn" href="#/stage/' + sc.stageId + '">← 返回' + esc(sc.stageName) + '环节</a>' +
      '<a class="btn ghost" href="#/">返回总览</a></div></div>';
  }

  /* ---- tab 交互与示范挂载 ---- */
  function bindTabs(sc, c) {
    var tabsEl = document.getElementById('tabs');
    if (!tabsEl) return;

    function activate(key, scroll) {
      [].forEach.call(tabsEl.children, function (b) {
        b.classList.toggle('on', b.dataset.tab === key);
      });
      [].forEach.call(document.querySelectorAll('.panel'), function (p) {
        p.classList.toggle('on', p.dataset.panel === key);
      });
      if (key === 'demo') mountDemo(sc, c);
      /* 切 tab 不触发 scroll：抽屉靠这一下重新判定，切走就收、切回就按当前位置弹 */
      if (window.CaseDemoHost && window.CaseDemoHost.refresh) window.CaseDemoHost.refresh();
      if (scroll) {
        var y = tabsEl.getBoundingClientRect().top + window.scrollY - 62;
        window.scrollTo({ top: y, behavior: 'smooth' });
      }
    }

    tabsEl.addEventListener('click', function (e) {
      var b = e.target.closest('.tab');
      if (!b) return;
      activate(b.dataset.tab, true);
      setHashQuiet('#/scene/' + sc.id + '?tab=' + b.dataset.tab);
    });

    var want = { 1: 'bg', 2: 'flow', 3: 'demo' }[parseHash().q.tab] || parseHash().q.tab;
    if (want && tabsEl.querySelector('[data-tab="' + want + '"]')) activate(want, false);

    bindChecklist();
  }

  function mountDemo(sc, c) {
    var d = c.tabs.demo;
    if (!d || typeof d.mount !== 'function') return;
    var key = c.id;
    if (mountedKey === key) return;
    var root = document.getElementById('case-demo-root');
    if (!root) return;
    if (mounted && mounted.unmount) { try { mounted.unmount(); } catch (e) { } }
    root.innerHTML = '';
    mounted = d;
    mountedKey = key;
    try {
      d.mount(root, { scene: sc, kase: c, K: K, atlas: A });
    } catch (err) {
      root.innerHTML = '<div class="callout warn"><span class="ci">错误</span><span>示范挂载失败：' +
        esc(err.message) + '。检查 <b>' + esc(c.id) + '</b> 的 tabs.demo.mount。</span></div>';
      console.error('[case:' + c.id + '] demo mount failed', err);
    }
  }

  function bindChecklist() {
    var items = document.querySelectorAll('.cl-item');
    if (!items.length) return;
    var total = items.length;
    var fill = document.getElementById('cl-fill');
    var txt = document.getElementById('cl-txt');

    function sync() {
      var n = document.querySelectorAll('.cl-item.done').length;
      if (fill) fill.style.width = (n / total * 100) + '%';
      if (txt) txt.textContent = n + ' / ' + total;
    }
    [].forEach.call(items, function (it) {
      it.addEventListener('click', function () {
        it.classList.toggle('done');
        sync();
      });
    });
    sync();
  }

  /* =========================================================
     八、案例库控制台
     ========================================================= */
  function casesHTML() {
    var list = Cases.list();
    var checks = Cases.validateAll();
    var s = Cases.stats();
    var pending = A.allScenes.filter(function (sc) { return !Cases.bySceneAll(sc.id).length; });

    var rows = list.map(function (c) {
      var sc = A.index.byScene[c.sceneId];
      var ck = checks[c.id] || [];
      var errs = ck.filter(function (x) { return x.level === 'error'; }).length;
      var warns = ck.filter(function (x) { return x.level === 'warn'; }).length;
      var state = errs ? '<span class="bad-mark">✕ ' + errs + ' 项错误</span>'
        : warns ? '<span class="mono" style="font-size:11.5px;color:var(--warn)">! ' + warns + ' 项提醒</span>'
          : '<span class="ok-mark">✓ 通过</span>';
      var tabFlags = ['background', 'workflow', 'demo'].map(function (k) {
        return '<span class="' + (c.tabs[k] ? 'ok-mark' : 'dim-mark') + '" title="' + k + '">' + (c.tabs[k] ? '●' : '○') + '</span>';
      }).join(' ');
      var mChips = (c.methods || []).map(caseChip).join('') || '<span class="dim-mark">继承场景</span>';

      return '<tr><td class="pick"><input type="checkbox" class="case-pick" value="' + esc(c.id) + '" aria-label="选择 ' + esc(c.id) + '"></td>' +
        '<td class="id">' + esc(c.id) + '</td>' +
        '<td><div class="nm">' + esc(c.title || sc && sc.name) +
        (c.imported ? '<span class="badge-local">本地导入</span>' : '') + '</div>' +
        '<div class="sc">' + (sc ? esc(sc.stageName) + ' / ' + esc(sc.name) : '⚠ sceneId 未匹配') + '</div></td>' +
        '<td>' + mChips + '</td>' +
        '<td class="sc">' + esc(c.version || '—') + '</td>' +
        '<td class="sc">' + esc(c.updated || '—') + '</td>' +
        '<td style="letter-spacing:.16em">' + tabFlags + '</td>' +
        '<td>' + state + '</td>' +
        '<td>' + (sc ? '<a class="btn sm ghost" href="#/scene/' + sc.id + '?case=' + esc(c.id) + '">打开 →</a>' : '—') +
        '<a href="#" class="link-remove" data-remove-case="' + esc(c.id) + '" title="' +
        (c.imported ? '从本机移除这份上传的案例包' : '从站点删除这个插件案例（文件保留，可恢复）') + '">' +
        (c.imported ? '移除' : '删除') + '</a>' +
        '</td></tr>';
    }).join('');

    /* 被删除（隐藏）的插件案例——可恢复 */
    var blocked = (global.CaseImport && global.CaseImport.blockedList ? global.CaseImport.blockedList() : [])
      .filter(function (id) { return !Cases.get(id); });
    var blockedBlock = '';
    if (blocked.length) {
      blockedBlock =
        '<div class="blocked-box">' +
        '<div class="bb-h"><span class="kicker clay">HIDDEN</span>' +
        '<b>已删除的插件案例（' + blocked.length + '）</b>' +
        '<span class="bb-sub">.js 文件仍在磁盘上，恢复后重新加载页面即可回到上表</span>' +
        '<span style="flex:1"></span>' +
        '<button class="btn sm ghost" id="bb-restore-all">全部恢复</button></div>' +
        '<div class="bb-list">' + blocked.map(function (id) {
          return '<span class="bb-item"><span class="mono">' + esc(id) + '</span>' +
            '<a href="#" class="link-remove" data-restore-case="' + esc(id) + '">恢复</a></span>';
        }).join('') + '</div></div>';
    }

    var detail = list.map(function (c) {
      var ck = checks[c.id] || [];
      return '<details style="margin-top:10px;border:1px solid var(--line);border-radius:8px;background:var(--card)">' +
        '<summary style="padding:10px 14px;cursor:pointer;font-size:12.5px;font-weight:600">' +
        esc(c.id) + ' 的校验明细 <span class="mono" style="font-weight:400;color:var(--ink-4);font-size:10.5px">' +
        ck.length + ' 条</span></summary>' +
        '<div style="padding:0 14px 12px"><table class="contract"><tbody>' +
        ck.map(function (x) {
          var mark = x.level === 'ok' ? '<span class="ok-mark">✓</span>'
            : x.level === 'warn' ? '<span style="color:var(--warn);font-family:var(--mono);font-size:11.5px">!</span>'
              : '<span class="bad-mark">✕</span>';
          return '<tr><td style="width:22px">' + mark + '</td>' +
            '<td style="font-family:var(--sans)">' + esc(x.label) + '</td>' +
            '<td style="color:var(--ink-4);font-size:11.5px">' + esc(x.detail) + '</td></tr>';
        }).join('') + '</tbody></table></div></details>';
    }).join('');

    return '<main class="wrap">' +
      crumb([['#/', '总览'], ['#/cases', '案例库']]) +
      '<div class="page-head"><div class="ph-top"><div>' +
      '<div class="ph-idx">CASE REGISTRY</div>' +
      '<h1>案例库与接入状态</h1>' +
      '<p class="blurb">系统在启动时扫描所有已加载的案例插件，按契约做静态校验。任何一项报错都会在这里列出来，不会静默失败。</p>' +
      '</div><div class="ph-stat">' +
      '<div><div class="n">' + s.registered + '</div><div class="l">已注册</div></div>' +
      '<div><div class="n">' + s.withDemo + '</div><div class="l">含示范</div></div>' +
      '<div><div class="n">' + pending.length + '</div><div class="l">待接入</div></div>' +
      '</div></div></div>' +

      '<div class="console-bar">' +
      '<span class="num">' + s.coveredScenes + '<small>/' + s.totalScenes + '</small></span>' +
      '<span class="lbl">个场景已有案例实现（共 ' + s.registered + ' 个案例）</span><span class="sp"></span>' +
      '<button class="btn sm primary" data-import>＋ 添加案例</button>' +
      '<button class="btn sm" data-import-batch title="一次选中多个案例文件夹或压缩包">＋ 批量导入</button>' +
      '<button class="btn sm ghost" id="rerun">重新校验</button></div>' +

      '<div class="pick-bar" id="pick-bar" hidden>' +
      '<span class="pb-n"><b id="pick-n">0</b> 个案例已选中</span>' +
      '<span class="pb-sub">上传的会删掉本机存档；内置/插件案例只是隐藏，可在下方「已隐藏」区恢复</span>' +
      '<span style="flex:1"></span>' +
      '<button class="btn sm ghost" id="pick-none">取消选择</button>' +
      '<button class="btn sm danger" id="pick-del">删除选中</button>' +
      '</div>' +

      '<div class="matrix-wrap" style="box-shadow:var(--sh-1)">' +
      '<table class="sys-table"><thead><tr>' +
      '<th class="pick"><input type="checkbox" id="case-all" aria-label="全选案例"></th>' +
      '<th>案例 id</th><th>绑定场景</th><th>涉及技术</th><th>版本</th><th>更新</th><th>三块内容</th><th>校验</th><th></th>' +
      '</tr></thead><tbody>' + (rows || '<tr><td colspan="9" class="empty">还没有任何案例注册</td></tr>') + '</tbody></table></div>' +
      '<p class="small muted" style="margin-top:9px">三块内容依次为 background / workflow / demo，● 已提供、○ 未提供。技术标签可在导入时勾选，不选则继承场景；同一个场景支持挂多个案例，场景页顶部会出现切换器。删除上传案例会清掉本机存档；删除插件案例只是隐藏，文件不动，可随时恢复。</p>' +

      blockedBlock +

      '<div style="margin-top:26px">' + detail + '</div>' +

      '<div class="section" style="padding:44px 0 56px">' +
      '<div class="sec-head"><div><span class="kicker">BACKLOG</span>' +
      '<h2 style="margin-top:10px">还有 ' + pending.length + ' 个场景等待接入</h2>' +
      '<p>下面这些场景已有元数据，缺的是案例实现。接入一个大约需要「一份专业背景 + 一条流程 + 一个能跑的最小示范」。</p>' +
      '</div></div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:7px">' +
      pending.slice(0, 24).map(function (sc) {
        return '<a class="tag" href="#/scene/' + sc.id + '">' + esc(sc.name) + '</a>';
      }).join('') +
      (pending.length > 24 ? '<span class="tag">… 另有 ' + (pending.length - 24) + ' 个</span>' : '') +
      '</div></div></main>';
  }

  /* 案例库：勾选 + 批量删除 + 批量恢复
     全部走事件委托到行内控件，重渲染后自动重建，不需要额外的状态清理。 */
  function bindCasePick(root) {
    var all = root.querySelector('#case-all');
    var boxes = [].slice.call(root.querySelectorAll('.case-pick'));
    var bar = root.querySelector('#pick-bar');
    var nEl = root.querySelector('#pick-n');
    var delBtn = root.querySelector('#pick-del');
    if (!boxes.length) return;

    function picked() {
      return boxes.filter(function (b) { return b.checked; }).map(function (b) { return b.value; });
    }

    function sync() {
      var n = picked().length;
      if (bar) bar.hidden = !n;
      if (nEl) nEl.textContent = n;
      if (all) {
        all.checked = n > 0 && n === boxes.length;
        all.indeterminate = n > 0 && n < boxes.length;
      }
      boxes.forEach(function (b) {
        var tr = b.closest('tr');
        if (tr) tr.classList.toggle('is-picked', b.checked);
      });
    }

    boxes.forEach(function (b) { b.addEventListener('change', sync); });

    if (all) {
      all.addEventListener('change', function () {
        boxes.forEach(function (b) { b.checked = all.checked; });
        sync();
      });
    }

    var none = root.querySelector('#pick-none');
    if (none) {
      none.addEventListener('click', function () {
        boxes.forEach(function (b) { b.checked = false; });
        sync();
      });
    }

    if (delBtn) {
      delBtn.addEventListener('click', function () {
        var ids = picked();
        if (!ids.length) return;
        /* 一次确认、一次重渲染，都在 removeMany 里 */
        global.CaseImport.removeMany(ids);
      });
    }

    var bbAll = root.querySelector('#bb-restore-all');
    if (bbAll) {
      bbAll.addEventListener('click', function () {
        var ids = [].slice.call(root.querySelectorAll('[data-restore-case]')).map(function (a) {
          return a.getAttribute('data-restore-case');
        });
        if (!ids.length) return;
        if (!global.confirm('恢复 ' + ids.length + ' 个被隐藏的插件案例？\n页面会重新加载一次。')) return;
        global.CaseImport.restoreMany(ids);
      });
    }

    sync();
  }

  /* =========================================================
     九、接入指南
     ========================================================= */
  function guideHTML() {
    var fileTree = K.tree([
      '<b>项目根目录</b>',
      '├── index.html                <span class="cm">← 新增案例时加一行 script</span>',
      '├── assets/',
      '│   ├── data.js               <span class="cm">场景元数据（13 环节 / 61 场景）</span>',
      '│   ├── core/                 <span class="cm">外壳，一般不用动</span>',
      '│   │   ├── tokens.css        <span class="cm">颜色 / 字号 / 圆角</span>',
      '│   │   ├── layout.css        <span class="cm">导航 / 页头 / 页脚</span>',
      '│   │   ├── ui.css            <span class="cm">卡片 / 表格 / 四段式 / 示范</span>',
      '│   │   ├── registry.js       <span class="cm">Cases.register 契约与校验</span>',
      '│   │   ├── kit.js            <span class="cm">K.sec4 / K.figure / K.code…</span>',
      '│   │   ├── case-demo-host.js <span class="cm">示范宿主：iframe 整页 / Shadow DOM 模块</span>',
      '│   │   ├── case-upload.js    <span class="cm">案例包导入：校验 / 打包 / 落库</span>',
      '│   │   └── shell.js          <span class="cm">路由与页面</span>',
      '│   └── cases/                <span class="dir">← 案例都放这里</span>',
      '│       ├── welllog-layer.case.js   <span class="new">测井分层（示例）</span>',
      '│       ├── welllog-layer.demo.js   <span class="new">它的可运行示范</span>',
      '│       ├── _template.case.js       <span class="new">插件模板，复制它开始</span>',
      '│       └── _template.case.json     <span class="new">清单模板（完整包请用弹窗里下载的 zip）</span>',
      '└── docs/',
      '    └── 如何添加新案例.md      <span class="cm">本页的离线版</span>'
    ]);

    var sample = [
      "Cases.register({",
      "  id: 'logging-mud-loss',          // 必填，kebab-case，全局唯一",
      "  sceneId: 'd3',                    // 必填，data.js 里已有的场景 id",
      "  title: '钻井液漏失层位识别',",
      "  status: 'ready',                  // ready | draft",
      "  version: '1.0.0',",
      "  updated: '2026-10-22',",
      "",
      "  tabs: {",
      "    // ① 专业背景：四段式，返回 HTML 字符串",
      "    background: {",
      "      label: '专业背景',",
      "      judge: [",
      "        { label: '任务', value: '序列分割' },",
      "        { label: '数据', value: '随钻曲线 + 漏失记录' }",
      "      ],",
      "      lede: '一句话说明这个场景到底在做什么。',",
      "      sections: [",
      "        { no: 1, en: 'PROBLEM', title: '当前做法与问题',",
      "          html: '<p>……</p>' + K.figure(svgManual(), 1, '图注') },",
      "        { no: 2, en: 'INTERVENTION', title: 'AI 能做什么', html: '……' },",
      "        { no: 3, en: 'DATA', title: '你需要准备什么',",
      "          html: K.checklist([['随钻曲线', '1 s 采样'], ['漏失记录', '人工登记']]) },",
      "        { no: 4, en: 'DIFFICULTY', title: '技术难度与参考方向', html: '……' }",
      "      ]",
      "    },",
      "",
      "    // ② 案例流程：一条真实项目走过的路",
      "    workflow: {",
      "      label: '案例流程',",
      "      title: '某某区块 18 口井的漏失识别',",
      "      lead: ['项目目标不是做模型，而是把漏失层位定位时间压到 10 分钟。'],",
      "      stats: [['样本井', '18 口'], ['目标准确率', '85%']],",
      "      steps: [",
      "        { name: '数据对齐', do: '……', role: '工程环节',",
      "          effect: '……', trap: '……' }",
      "      ],",
      "      fails: [{ name: '标签滞后', why: '……' }]",
      "    },",
      "",
      "    // ③ 可运行示范（可选）：给一个 DOM 容器就能跑",
      "    demo: {",
      "      label: '可运行示范',",
      "      mount: function (root, ctx) {",
      "        root.innerHTML = '<div>……</div>';",
      "        // ctx.scene / ctx.kase / ctx.K / ctx.atlas 都可直接用",
      "      },",
      "      unmount: function () { /* 清理定时器、事件监听 */ }",
      "    }",
      "  }",
      "});"
    ].join('\n');

    var fields = [
      ['id', '必填', '全局唯一标识，kebab-case。会显示在场景页头部与控制台里。'],
      ['sceneId', '必填', '绑定到 data.js 中的某个场景 id。校验会检查它是否存在。'],
      ['title', '必填', '案例标题，通常与场景名一致或更具体。'],
      ['status', '建议', 'ready = 可用于教学；draft = 内容未定稿，控制台标黄。'],
      ['version', '建议', '语义化版本，改了内容就升一格。'],
      ['updated', '建议', '最后更新日期，方便判断内容是否过期。'],
      ['tabs.background', '必填', '对象。judge（30 秒判断）/ lede（导语）/ sections（四段式数组）。'],
      ['tabs.background.sections[]', '必填', '每段 { no, en, title, html }。建议恰好四段，与全站一致。'],
      ['tabs.workflow', '建议', '对象。title / lead[] / stats[] / steps[] / fails[] / metrics。'],
      ['tabs.workflow.steps[]', '建议', '每步 { name, do, role, effect, trap, fig }。role 渲染成小标签；fig 放内联 SVG 示意图（每步都该有）。'],
      ['tabs.demo', '可选', '对象。mount(root, ctx) 必填；unmount() 用于清理。'],
      ['tabs.demo.label', '可选', '第三个 tab 的显示名，默认「可运行示范」。']
    ].map(function (r) {
      var req = r[1] === '必填' ? '<span class="req">必填</span>'
        : r[1] === '建议' ? '<span class="opt">建议</span>' : '<span class="opt">可选</span>';
      return '<tr><td>' + esc(r[0]) + '</td><td>' + req + '</td><td>' + rich(r[2]) + '</td></tr>';
    }).join('');

    return '<main class="wrap">' +
      crumb([['#/', '总览'], ['#/guide', '接入指南']]) +
      '<div class="page-head"><div class="ph-top"><div>' +
      '<div class="ph-idx">EXTENDING</div>' +
      '<h1>怎么把这个系统扩成你自己的案例集</h1>' +
      '<p class="blurb">两条路：不写代码就上传案例包；需要真实算法示范时才写插件。两条路走完，效果一样——场景页自动长出 tab，检索路径自动收录。</p>' +
      '</div></div></div>' +

      /* ---- 方式 A：上传案例包 ---- */
      '<div class="sec-head" style="margin-top:4px">' +
      '<div class="sec-rail"><span class="sec-num">A</span><span class="kicker">UPLOAD PACKAGE · 推荐</span>' +
      '<span class="r"><span class="tag">不需要改任何文件</span></span></div>' +
      '<h2>上传一个案例包，三步接进去</h2>' +
      '<p>下载模板（zip，含一个能跑的示范页）→ 改清单、替换演示内容 → 把整个文件夹拖回网站。系统逐项检查格式，通过后当场出现在站点里。</p>' +
      '</div>' +

      '<div class="upcard">' +
      '<div class="upcard-l">' +
      '<h4>案例包是什么</h4>' +
      '<p>是一个<b>文件夹</b>：一份 JSON 清单 + 任意演示文件。清单写名称、所属场景和两块正文（专业背景 / 案例流程）；' +
      '示范可以是一个完整的 <b>index.html</b>、配套的 <b>demo.js</b> / <b>demo.css</b>，以及图片、JSON 数据等素材。</p>' +
      '<p>拖进弹窗时会整个读进浏览器——<b>html 自动内联 css 与 js、图片自动转成内嵌资源</b>，所以不需要服务器，双击 index.html 也能跑。</p>' +
      '<p>示范页跑在 <b>sandbox iframe</b> 里，你可以随便写样式和脚本，不会污染主站；只有 demo.js 没有 html 时，脚本会挂进 <b>Shadow DOM</b>，样式同样隔离。</p>' +
      '<div class="upcard-acts">' +
      '<button class="btn primary" data-import>＋ 打开「添加案例」</button>' +
      '<button class="btn" data-dl-template>↓ 下载案例包模板（.zip）</button>' +
      '</div>' +
      '<div class="upcard-note">模板解压后就是一个可直接运行的完整包：清单 + 示范页 + 样式 + 脚本，改完整个文件夹拖回去即可。' +
      '上传的案例保存在本机浏览器（localStorage），换电脑需重新上传；要永久发布给所有人，用下面的方式 B。</div>' +
      '</div>' +
      '<div class="upcard-r">' +
      '<table class="contract"><thead><tr><th>文件 / 字段</th><th>级别</th><th>说明</th></tr></thead><tbody>' +
      [
        ['case.json', '必填', '清单。建议就用这个名字，放在包根目录'],
        ['demo/index.html', '可选', '整页示范。自动内联 css/js，图片相对路径自动替换'],
        ['demo/demo.css', '可选', '示范页样式，只在沙箱里生效'],
        ['demo/demo.js', '可选', '示范脚本；无 html 时走模块模式，需导出 mount'],
        ['id', '必填', '小写字母 / 数字 / 连字符，全站唯一'],
        ['sceneId', '必填', '绑定场景，等于选定分类（环节 + 方法自动带出）'],
        ['title', '必填', '案例名称，页头与列表都用它'],
        ['tabs.background.sections[]', '必填', '每段 { title, html }；建议四段'],
        ['tabs.background.judge', '可选', '「30 秒判断」四格 { label, value, desc }'],
        ['tabs.workflow.steps[]', '可选', '每步 { name, do, effect, trap, fig }；fig 是该步的示意图（内联 SVG）'],
        ['tabs.demo.mode', '可选', 'auto（默认）/ page / module / builtin，一般不用写'],
        ['tabs.demo.builtin', '可选', '复用某个已有案例的示范（填它的 id）']
      ].map(function (r) {
        var req = r[1] === '必填' ? '<span class="req">必填</span>' : '<span class="opt">可选</span>';
        return '<tr><td>' + esc(r[0]) + '</td><td>' + req + '</td><td>' + rich(r[2]) + '</td></tr>';
      }).join('') +
      '</tbody></table>' +
      '</div>' +
      '</div>' +

      /* ---- 方式 B：插件 ---- */
      '<div class="sec-head" style="margin-top:26px">' +
      '<div class="sec-rail"><span class="sec-num">B</span><span class="kicker">PLUGIN · 需要真实示范时</span></div>' +
      '<h2>写一个案例插件</h2>' +
      '<p>要放真实的算法示范（可交互的曲线、可拖的参数），就用插件。下面三步走完即可。</p>' +
      '</div>' +

      '<div class="gsteps">' +
      '<div class="gstep"><div class="gn">1</div><div>' +
      '<h3>复制模板，改三处</h3>' +
      '<p>把 <b>assets/cases/_template.case.js</b> 复制成 <b>你的案例.case.js</b>，然后只改三处：<b>id</b>、<b>sceneId</b>、以及三个 tab 里的内容。</p>' +
      '<p>id 用 kebab-case，保证唯一；sceneId 必须是 <b>assets/data.js</b> 里已经存在的场景 id（比如 <b>w1</b> 是测井分层）。如果这个场景还不存在，先在 data.js 的对应环节 scenes 数组里加一条元数据。</p>' +
      '</div></div>' +

      '<div class="gstep"><div class="gn">2</div><div>' +
      '<h3>在 index.html 里挂上去</h3>' +
      '<p>找到页面底部的脚本区，在你的案例文件后面加一行：</p>' +
      K.code('<script src="assets/cases/你的案例.case.js"><' + '/script>', { file: 'index.html', note: '加在 shell.js 之前' }) +
      '<p>加载顺序是：data.js → registry.js → kit.js → 案例 → shell.js。案例必须在 shell.js 之前注册完，否则首屏渲染时找不到它。</p>' +
      '</div></div>' +

      '<div class="gstep"><div class="gn">3</div><div>' +
      '<h3>打开控制台看校验结果</h3>' +
      '<p>刷新页面，进 <a href="#/cases" style="color:var(--jade-d);font-weight:600">案例库</a>。系统会自动检查：id 是否规范、sceneId 是否存在、三段内容是否齐全、demo.mount 是否为函数、场景与案例的 demo 标记是否一致。</p>' +
      '<p>全绿就说明接入完成 —— 场景页的 tab、面包屑、相关场景、方法反查页里的条目都会自动出现，不需要改任何其它文件。</p>' +
      '</div></div>' +
      '</div>' +

      '<div class="section tight">' +
      '<div class="sec-head"><div><span class="kicker">STRUCTURE</span>' +
      '<h2 style="margin-top:8px">文件在哪</h2></div></div>' + fileTree + '</div>' +

      '<div class="section tight">' +
      '<div class="sec-head"><div><span class="kicker">CONTRACT</span>' +
      '<h2 style="margin-top:8px">契约字段</h2>' +
      '<p>只有标「必填」的字段缺失会报错，其余缺失只是控制台里的一条提醒。</p></div></div>' +
      '<div class="matrix-wrap"><table class="contract"><thead><tr><th>字段</th><th>级别</th><th>说明</th></tr></thead><tbody>' +
      fields + '</tbody></table></div></div>' +

      '<div class="section tight">' +
      '<div class="sec-head"><div><span class="kicker">EXAMPLE</span>' +
      '<h2 style="margin-top:8px">一个完整的案例声明</h2>' +
      '<p>这是最小可用的骨架，把省略号换成你的内容即可。</p></div></div>' +
      K.code(sample, { file: 'assets/cases/your-case.case.js' }) +
      '</div>' +

      '<div class="section tight">' +
      '<div class="sec-head"><div><span class="kicker">KIT</span>' +
      '<h2 style="margin-top:8px">内容怎么写：工具箱</h2>' +
      '<p>不要在案例里写 CSS 类名，用这些函数生成结构，版式改动会全站同步。</p></div></div>' +
      K.dtable(['函数', '用途'], [
        ['K.sec4(no, en, title, html)', '四段式中的一段，带编号与英文小标'],
        ['K.figure(svg, no, caption)', '插图 + 图注，图注支持 **粗体**'],
        ['K.judge([{label,value,desc}])', '页面顶部那排"30 秒判断"格子'],
        ['K.checklist(items)', '可勾选的数据准备清单，items 为 [名称, 规格, 标注要求]'],
        ['K.dtable(head, rows)', '普通数据表格'],
        ['K.pipeline(steps)', '带编号的流程步骤，每步可写效果与坑；steps[].fig 可给该步配示意图'],
        ['K.fails([{name, why}])', '失败模式四宫格'],
        ['K.cells([[标签, 值]])', '流程页右侧的指标格'],
        ['K.meter(diff)', '三段式难度条'],
        ['K.refs([...], href)', '参考方向胶囊'],
        ['K.callout(text, "warn")', '提示条'],
        ['K.code(str, {file})', '代码块，带语法着色']
      ]) +
      K.callout('文本里可以直接用 **粗体** 与 `等宽` 两种标记，所有函数都会自动转义 HTML，不需要手动防注入。') +
      K.callout('想让每一步都配一张图？在步骤里加 `fig` 字段（原始 SVG 字符串或 SVG 数组），会渲染在步骤文字下方。' +
        '想让模型内部「动起来」？在示范包里放 `aflow.js` + `aflow.css` + `flow.js`，用 AFlow 引擎把前向过程拆成若干阶段逐帧播放——' +
        '现有 6 个案例包都这么做，引擎源码见 `demo/aflow.js`。', 'warn') +
      '</div>' +

      '<div class="section tight">' +
      '<div class="sec-head"><div><span class="kicker">PITFALLS</span>' +
      '<h2 style="margin-top:8px">四个常踩的坑</h2></div></div>' +
      '<div class="fails" style="grid-template-columns:1fr 1fr">' +
      '<div class="fail"><div class="fi">PITFALL 01</div><h5>script 顺序放反</h5><p>案例写在 shell.js 后面，页面已经渲染完了才注册，控制台里能看到但场景页没有 tab。案例脚本必须在 shell.js 之前。</p></div>' +
      '<div class="fail"><div class="fi">PITFALL 02</div><h5>sceneId 拼错</h5><p>id 区分大小写。写错不会报 JS 错误，只是这个案例永远不出现。控制台的"绑定场景"列会显示 ⚠。</p></div>' +
      '<div class="fail"><div class="fi">PITFALL 03</div><h5>demo 里没有清理</h5><p>用 setInterval / addEventListener 的示范要在 unmount 里清掉，否则切换场景后老定时器还在跑。</p></div>' +
      '<div class="fail"><div class="fi">PITFALL 04</div><h5>把样式写死在案例里</h5><p>内联颜色会让案例在改配色时掉队。颜色一律用 var(--jade) 这类令牌，或干脆用 K.* 生成。</p></div>' +
      '</div></div>' +

      '<div class="pending" style="margin-top:36px"><div class="pending-top">' +
      '<span class="badge-ready">下一步</span><h3>从最简单的案例开始</h3></div>' +
      '<p>如果还没有想好做什么，先挑一个 <b>数据现成、任务边界清晰</b> 的场景：把四段式写满、流程写三步、示范可以先不做。一个只有 80 行内容的案例，也比一个空着的场景有用。</p>' +
      '<div class="pending-actions">' +
      '<a class="btn primary" href="#/cases">看当前案例库 →</a>' +
      '<a class="btn" href="#/scene/w1">对照测井分层的写法</a></div></div>' +
      '</main>';
  }

  /* =========================================================
     十、调度
     ========================================================= */
  function unmountCurrent() {
    if (mounted && mounted.unmount) {
      try { mounted.unmount(); } catch (e) { }
    }
    mounted = null;
    mountedKey = '';
  }

  function render() {
    var r = parseHash();
    var p = r.parts;
    unmountCurrent();
    window.scrollTo(0, 0);

    var html;
    if (!p.length) html = homeHTML();
    else if (p[0] === 'chain') html = chainHTML();
    else if (p[0] === 'cases') html = casesHTML();
    else if (p[0] === 'guide') html = guideHTML();
    else if (p[0] === 'admin') html = global.Admin ? global.Admin.route(p, r.q) : notFound('管理模块未加载');
    else if (p[0] === 'stage') {
      var st = A.index.byStage[p[1]];
      html = st ? stageHTML(st, r.q) : notFound('没有这个环节');
    } else if (p[0] === 'method') {
      html = methodHTML(p[1]);
    } else if (p[0] === 'scene') {
      var sc = A.index.byScene[p[1]];
      html = sc ? sceneHTML(sc, r.q) : notFound('没有这个场景');
    } else html = notFound('页面不存在');

    view.innerHTML = header() + html + footer();
    condensePanels(view);

    // 页面级交互
    if (!p.length) bindFlowMap(view);
    if (p[0] === 'stage') bindFilters(view);
    if (p[0] === 'scene') {
      var sc2 = A.index.byScene[p[1]];
      var all2 = sc2 && Cases.bySceneAll(sc2.id);
      var c2 = all2 && all2.filter(function (x) { return x.id === r.q.case; })[0] || (all2 && all2[0]) || null;
      if (c2) bindTabs(sc2, c2);
      /* 多案例切换器 */
      [].forEach.call(view.querySelectorAll('.case-switch [data-case]'), function (b) {
        b.addEventListener('click', function () {
          var tab = parseHash().q.tab;
          go('#/scene/' + sc2.id + '?case=' + b.dataset.case + (tab ? '&tab=' + tab : ''));
        });
      });
    }
    if (p[0] === 'cases') {
      var rb = document.getElementById('rerun');
      if (rb) rb.addEventListener('click', render);
      bindCasePick(view);
    }
    if (p[0] === 'admin' && global.Admin) global.Admin.bind(view);
    document.title = pageTitle(p) + ' · 智能化可能性地图';
  }

  function pageTitle(p) {
    if (!p.length) return '总览';
    if (p[0] === 'scene') { var s = A.index.byScene[p[1]]; return s ? s.name : '场景'; }
    if (p[0] === 'stage') { var t = A.index.byStage[p[1]]; return t ? t.name : '环节'; }
    if (p[0] === 'method') return M[p[1]] ? M[p[1]].name : '方法';
    if (p[0] === 'admin') return global.Admin && global.Admin.loggedIn() ? '管理后台' : '管理员登录';
    return { chain: '作业链', cases: '案例库', guide: '接入指南' }[p[0]] || '地图';
  }

  function notFound(msg) {
    return '<main class="wrap"><div class="empty" style="padding:120px 0"><b>' + esc(msg) + '</b>' +
      '检查地址，或<a href="#/" style="color:var(--jade-d)">回到总览</a>。</div></main>';
  }

  window.addEventListener('hashchange', render);
  render();

  // 启动自检：把注册阶段的异常打到控制台，便于排查
  var probs = Cases.problems();
  if (probs.length) console.warn('[case registry]', probs);

})(window);
