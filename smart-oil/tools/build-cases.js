/* =========================================================
   把 41 个案例文件夹编译成内置插件脚本 assets/cases/<id>.case.js
   -------------------------------------------------------------
   背景：站点案例默认从 localStorage 导入（上传通道），GitHub Pages
   上访问者没有本地存档，看不到案例。本脚本把每个案例包
   （case.json + demo/）编译成与「上传导入」完全等价的静态插件：
     · case.json 元信息 → Cases.register({...})
     · demo/ 全部文件内联 → tabs.demo.mount 走 CaseDemoHost.create
       （page 模式 srcdoc，file:// 与 https 均可用，无需网络请求）
   运行：node tools/build-cases.js
   产物：assets/cases/<id>.case.js × 41 + index.html 的 script 标签
   ========================================================= */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'assets', 'cases');
const STAMP = '20261105b';

/* ---------- 加载 data.js（浏览器脚本，Node 里加 window shim） ---------- */
global.window = {
  localStorage: {
    getItem: function () { return null; },
    setItem: function () { },
    removeItem: function () { }
  },
  Cases: null
};
require(path.join(ROOT, 'assets', 'data.js'));
const ATLAS = global.window.ATLAS;
if (!ATLAS || !ATLAS.index || !ATLAS.index.byScene) {
  console.error('data.js 加载失败：没有 ATLAS.index.byScene');
  process.exit(1);
}
const sceneMethods = function (sceneId) {
  const sc = ATLAS.index.byScene[sceneId];
  return sc && Array.isArray(sc.methods) ? sc.methods.slice() : [];
};

/* ---------- demo 文件收集（与上传通道 packFiles 对齐，但只收 demo/） ---------- */
const MIME = {
  html: 'text/html', htm: 'text/html', js: 'text/javascript', mjs: 'text/javascript',
  css: 'text/css', json: 'application/json', geojson: 'application/json',
  svg: 'image/svg+xml', txt: 'text/plain', md: 'text/plain', csv: 'text/csv',
  xml: 'text/xml', yaml: 'text/yaml', yml: 'text/yaml',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', ico: 'image/x-icon', bmp: 'image/bmp',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
  mp4: 'video/mp4', webm: 'video/webm',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf'
};
function collectDemo(dir) {
  const demoDir = path.join(dir, 'demo');
  const out = [];
  if (!fs.existsSync(demoDir)) return out;
  (function walk(d, prefix) {
    for (const name of fs.readdirSync(d)) {
      if (name.startsWith('.')) continue;
      const full = path.join(d, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full, prefix + name + '/');
      else {
        const ext = path.extname(name).slice(1).toLowerCase();
        out.push({
          name: prefix + name,
          mime: MIME[ext] || 'application/octet-stream',
          data: fs.readFileSync(full, 'utf8')
        });
      }
    }
  })(demoDir, 'demo/');
  return out;
}

/* ---------- 背景 tab 归一化（对齐 case-upload.js toCase） ---------- */
function bgFromTemplate(b) {
  return {
    label: b.label || '专业背景',
    judge: Array.isArray(b.judge) && b.judge.length ? b.judge : null,
    lede: b.lede || '',
    sections: (b.sections || []).map(function (s, i) {
      return {
        no: s.no || (i + 1),
        en: s.en || '',
        title: s.title || '未命名段落',
        html: s.html || s.body || ''
      };
    })
  };
}
function wfFromTemplate(w) {
  return {
    label: w.label || '案例流程',
    title: w.title || '案例流程',
    lead: w.lead || [],
    stats: w.stats || null,
    steps: (w.steps || []).map(function (s) {
      const st = {
        name: s.name || '未命名步骤', role: s.role || '',
        do: s.do || '', effect: s.effect || '', trap: s.trap || ''
      };
      const fig = Array.isArray(s.fig) ? s.fig.join('') : s.fig;
      if (typeof fig === 'string' && fig.trim()) st.fig = fig;
      return st;
    }),
    metrics: w.metrics || null,
    fails: w.fails || null
  };
}

/* ---------- 射孔 4 例：场景描述 → 标准案例（只取既有事实，不编造） ---------- */
function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function bgFromScene(sc) {
  const dataHtml = (sc.data || []).map(function (row) {
    return '<p>· ' + escHtml(row[0]) + '：' + escHtml(row[1]) +
      (row[2] ? '（' + escHtml(row[2]) + '）' : '') + '</p>';
  }).join('');
  const refs = Array.isArray(sc.refs) && sc.refs.length
    ? '<p>参考方向：' + sc.refs.map(escHtml).join('、') + '。</p>' : '';
  const cross = Array.isArray(sc.cross) && sc.cross.length
    ? '<p>交叉环节：' + sc.cross.map(escHtml).join('、') + '。</p>' : '';
  return {
    label: '专业背景',
    judge: null,
    lede: sc.intro || '',
    sections: [
      { no: 1, en: 'PROBLEM', title: '当前做法与问题', html: '<p>' + escHtml(sc.problem || sc.intro || '') + '</p>' },
      { no: 2, en: 'INTERVENTION', title: 'AI 能做什么', html: '<p>' + escHtml(sc.point || '') + '</p>' },
      { no: 3, en: 'DATA', title: '需要准备什么', html: dataHtml || '<p>数据清单见场景描述。</p>' },
      {
        no: 4, en: 'DIFFICULTY', title: '难度与参考方向',
        html: '<p>难度：' + escHtml(sc.diff || '—') +
          (sc.diffWhy ? '。' + escHtml(sc.diffWhy) : '') + '</p>' + refs + cross
      }
    ]
  };
}

/* ---------- 主流程 ---------- */
const SKIP = ['assets', 'tools', '.workbuddy'];
const caseDirs = fs.readdirSync(ROOT, { withFileTypes: true })
  .filter(function (d) { return d.isDirectory() && SKIP.indexOf(d.name) < 0; })
  .map(function (d) { return d.name; })
  .sort(function (a, b) { return a.localeCompare(b, 'zh'); });

const report = [];
let errors = [];
let totalBytes = 0;

for (const dirName of caseDirs) {
  const dir = path.join(ROOT, dirName);
  const caseJsonPath = path.join(dir, 'case.json');
  let raw;
  try { raw = JSON.parse(fs.readFileSync(caseJsonPath, 'utf8')); }
  catch (e) { errors.push(dirName + ': case.json 解析失败 ' + e.message); continue; }

  const isSceneFormat = !(raw.tabs && raw.tabs.background);
  let def, sceneId, scene, methods, demoCfg;

  if (!isSceneFormat) {
    /* 标准案例包格式 */
    sceneId = raw.sceneId;
    scene = ATLAS.index.byScene[sceneId];
    methods = (Array.isArray(raw.methods) && raw.methods.length)
      ? raw.methods.slice() : sceneMethods(sceneId);
    def = {
      id: raw.id, sceneId: sceneId, title: raw.title,
      version: raw.version || '1.0.0', updated: raw.updated || '2026-11-05',
      background: bgFromTemplate(raw.tabs.background),
      workflow: raw.tabs.workflow ? wfFromTemplate(raw.tabs.workflow) : null
    };
    const d = raw.tabs.demo || {};
    demoCfg = {
      mode: d.mode || 'auto', html: d.html || 'demo/index.html',
      js: d.js || 'demo/demo.js', label: d.label || '可运行示范',
      intro: d.intro || '', height: d.height || 520
    };
  } else {
    /* 场景描述格式（射孔 p1–p4）：sceneId 即自身场景 id */
    sceneId = raw.id;
    scene = ATLAS.index.byScene[sceneId];
    methods = sceneMethods(sceneId);
    def = {
      id: raw.id, sceneId: sceneId,
      title: (scene && scene.name) || raw.name || raw.id,
      version: '1.0.0', updated: '2026-11-05',
      background: scene ? bgFromScene(scene) : null,
      workflow: null
    };
    demoCfg = {
      mode: 'auto', html: 'demo/index.html', js: 'demo/demo.js',
      label: '可运行示范', intro: (scene && scene.intro) || '', height: 520
    };
  }

  if (!def.background) { errors.push(dirName + ': 无法构造背景 tab（场景 ' + sceneId + ' 不存在于 data.js）'); continue; }
  if (!scene) { errors.push(dirName + ': sceneId ' + sceneId + ' 不在 ATLAS 里'); continue; }

  const files = collectDemo(dir);
  const hasHtml = files.some(function (f) { return /\.html?$/.test(f.name); });
  const mode = hasHtml ? 'page'
    : files.some(function (f) { return /\.(js|mjs)$/.test(f.name); }) ? 'module' : 'none';
  if (!files.some(function (f) { return f.name === (demoCfg.js || 'demo/demo.js'); })) {
    demoCfg.js = '';
  }

  const meta = { id: def.id, sceneId: def.sceneId, title: def.title };
  const tabs = { background: def.background };
  if (def.workflow) tabs.workflow = def.workflow;
  if (mode !== 'none') {
    tabs.demo = {
      label: demoCfg.label || '可运行示范',
      intro: demoCfg.intro || '',
      mode: mode,
      mount: function (root, ctx) {
        handle = window.CaseDemoHost.create(root, { files: FILES, demo: CFG, meta: META }, ctx);
      },
      unmount: function () {
        if (handle) { try { handle.destroy(); } catch (e) { } handle = null; }
      }
    };
  }

  /* 组装并写文件（FILES/CFG/META 为字面量，mount 闭包引用） */
  const filesJson = JSON.stringify(files).replace(/<\//g, '<\\/');
  const cfgJson = JSON.stringify(demoCfg).replace(/<\//g, '<\\/');
  const metaJson = JSON.stringify(meta).replace(/<\//g, '<\\/');

  /* 注册对象：数据部分序列化，demo.mount/unmount 留到代码里挂（函数无法序列化） */
  const dataDef = {
    id: def.id, sceneId: def.sceneId, title: def.title, methods: methods,
    version: def.version, updated: def.updated, status: 'ready',
    tabs: { background: tabs.background, workflow: tabs.workflow || null }
  };
  const dataJson = JSON.stringify(dataDef).replace(/<\//g, '<\\/');

  const demoBlock = mode !== 'none' ? (
    '  DEF.tabs.demo = {\n' +
    '    label: ' + JSON.stringify(demoCfg.label || '可运行示范') + ',\n' +
    '    intro: ' + JSON.stringify(demoCfg.intro || '') + ',\n' +
    '    mode: ' + JSON.stringify(mode) + ',\n' +
    '    mount: function (root, ctx) {\n' +
    '      handle = window.CaseDemoHost.create(root, { files: FILES, demo: CFG, meta: META }, ctx);\n' +
    '    },\n' +
    '    unmount: function () {\n' +
    '      if (handle) { try { handle.destroy(); } catch (e) { } handle = null; }\n' +
    '    }\n' +
    '  };\n'
  ) : '';

  const code =
    '/* =========================================================\n' +
    '   自动生成 · tools/build-cases.js · ' + STAMP + '\n' +
    '   案例：' + def.id + '（' + def.title + '）· 来源目录：' + dirName + '\n' +
    '   请勿手改；内容变化后重跑生成脚本。\n' +
    '   ========================================================= */\n' +
    '(function () {\n' +
    "  'use strict';\n" +
    '  var FILES = ' + filesJson + ';\n' +
    '  var CFG = ' + cfgJson + ';\n' +
    '  var META = ' + metaJson + ';\n' +
    '  var handle = null;\n' +
    '  var DEF = ' + dataJson + ';\n' +
    demoBlock +
    '  window.Cases.register(DEF);\n' +
    '})();\n';

  const outPath = path.join(OUT_DIR, def.id + '.case.js');
  fs.writeFileSync(outPath, code);
  const bytes = Buffer.byteLength(code);
  totalBytes += bytes;
  report.push({ dir: dirName, id: def.id, sceneId: def.sceneId, mode: mode, files: files.length, bytes: bytes });
}

/* ---------- 更新 index.html：在插件区插入 41 个 script ---------- */
const indexPath = path.join(ROOT, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
const anchor = '<!-- ↑ 新案例加在这里';
const anchorIdx = html.indexOf(anchor);
if (anchorIdx < 0) {
  errors.push('index.html 找不到插入锚点注释');
} else {
  const stamp = '?v=' + STAMP;
  const insert = report
    .map(function (r) { return '<script src="assets/cases/' + r.id + '.case.js' + stamp + '"></script>'; })
    .join('\n') + '\n';
  html = html.slice(0, anchorIdx) + insert + html.slice(anchorIdx);
  fs.writeFileSync(indexPath, html);
}

/* ---------- 汇总 ---------- */
report.sort(function (a, b) { return a.id.localeCompare(b.id); });
fs.writeFileSync(path.join(__dirname, '_tmp', 'cases-report.json'),
  JSON.stringify({ stamp: STAMP, total: report.length, bytes: totalBytes, report: report, errors: errors }, null, 2));

console.log('生成 ' + report.length + ' 个插件脚本，共 ' + (totalBytes / 1024).toFixed(1) + ' KB');
report.forEach(function (r) {
  console.log('  ' + r.id + '  [' + r.sceneId + ']  mode=' + r.mode + '  files=' + r.files + '  ' + (r.bytes / 1024).toFixed(1) + 'KB');
});
if (errors.length) {
  console.log('错误：');
  errors.forEach(function (e) { console.log('  ! ' + e); });
  process.exit(1);
}
console.log('index.html 已更新（插件区插入 ' + report.length + ' 个 script 标签）');
