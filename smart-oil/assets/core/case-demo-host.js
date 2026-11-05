/* =========================================================
   案例示范宿主 Case Demo Host
   ---------------------------------------------------------
   把「案例包里的示范文件」渲染成可交互的页面。两种模式：

   page    —— 包里有 index.html
              整页放进 sandbox iframe，样式/脚本完全隔离，
              写多复杂都不会污染主站。
   module  —— 包里有 demo.js 但没有 html
              挂进 Shadow DOM 并执行 demo.js，导出的 mount(root, api)
              往里画东西；上传的 CSS 也注入 Shadow DOM，不外泄。

   所有文件都转成 data URL 内联，因此 file:// 直接打开也能跑，
   不依赖本地服务器、不发起任何网络请求。

   对外接口：
     CaseDemoHost.create(container, pkg, ctx) -> { mode, destroy() }
     CaseDemoHost.resolveMode(pkg) -> 'page' | 'module' | 'none'
     pkg = { files:[{name,size,mime,enc,data}], demo:{mode,html,js,height} }
   ========================================================= */

(function (global) {
  'use strict';

  var MIME = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon', bmp: 'image/bmp',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
    mp4: 'video/mp4', webm: 'video/webm',
    woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
    json: 'application/json', csv: 'text/csv', txt: 'text/plain', pdf: 'application/pdf'
  };

  var TEXT_EXT = ['json', 'js', 'mjs', 'css', 'html', 'htm', 'svg', 'txt', 'csv', 'tsv', 'md', 'xml', 'yaml', 'yml', 'geojson'];

  /* Shadow DOM 里要继承的设计令牌 */
  var TOKENS = ['--paper', '--paper-2', '--paper-3', '--card', '--card-soft',
    '--line', '--line-2', '--line-3', '--ink', '--ink-2', '--ink-3', '--ink-4', '--ink-inv',
    '--jade', '--jade-d', '--jade-l', '--clay', '--clay-d', '--clay-l',
    '--ok', '--ok-bg', '--warn', '--warn-bg', '--bad', '--bad-bg',
    '--sans', '--mono', '--r-s', '--r-m', '--r-l', '--sh-1', '--sh-2'];

  var BASE_CSS =
    '.cd-box{display:block;font-family:var(--sans,system-ui,sans-serif);' +
    'font-size:13px;line-height:1.72;color:var(--ink,#242b2e);padding:2px 0 6px}' +
    '.cd-err{border:1px solid var(--bad,#b05a51);background:var(--bad-bg,#f9e9e5);' +
    'color:var(--bad,#b05a51);border-radius:8px;padding:11px 13px;font-size:12px;line-height:1.7}' +
    '.cd-err b{display:block;margin-bottom:4px;font-size:12.5px}' +
    '.cd-err code{font-family:var(--mono,monospace);background:rgba(0,0,0,.05);padding:1px 4px;border-radius:3px}';

  var seq = 0;

  /* ---------------- 小工具 ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function extOf(name) {
    var m = /\.([a-z0-9]+)$/i.exec(String(name).split('?')[0].split('#')[0]);
    return m ? m[1].toLowerCase() : '';
  }
  function baseOf(name) { return String(name).split('/').pop(); }
  function isCss(n) { return extOf(n) === 'css'; }
  function isJs(n) { var e = extOf(n); return e === 'js' || e === 'mjs'; }
  function isHtml(n) { var e = extOf(n); return e === 'html' || e === 'htm'; }
  function isText(n) { return TEXT_EXT.indexOf(extOf(n)) >= 0; }
  function mimeOf(n) { return MIME[extOf(n)] || (isText(n) ? 'text/plain' : 'application/octet-stream'); }

  function findFile(files, ref) {
    if (!ref || !files) return null;
    var r = String(ref).replace(/^\.\//, '').split('?')[0].split('#')[0];
    var i, hit = null;
    for (i = 0; i < files.length; i++) if (files[i].name === r) return files[i];
    var bn = baseOf(r).toLowerCase();
    for (i = 0; i < files.length; i++) if (baseOf(files[i].name).toLowerCase() === bn) return files[i];
    return hit;
  }
  function firstExt(files, test) {
    for (var i = 0; i < (files || []).length; i++) if (test(files[i].name)) return files[i];
    return null;
  }

  /* 文件 → 可直接放进 src/href/url() 的地址 */
  function urlOf(f) {
    if (!f) return '';
    if (f.enc === 'dataurl') return f.data;
    return 'data:' + (f.mime || mimeOf(f.name)) + ';charset=utf-8,' + encodeURIComponent(f.data);
  }

  /* ---------------- 模式判定 ---------------- */
  function resolveMode(pkg) {
    var d = (pkg && pkg.demo) || {};
    var files = (pkg && pkg.files) || [];
    var mode = d.mode || 'auto';
    if (mode === 'builtin' || mode === 'page' || mode === 'module') return mode;
    if (findFile(files, d.html) || firstExt(files, isHtml)) return 'page';
    if (findFile(files, d.js) || firstExt(files, isJs)) return 'module';
    return 'none';
  }

  /* ---------------- page 模式：拼一份自包含 HTML ---------------- */
  function cssText(css, map, files) {
    return String(css)
      .replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, function (all, q, ref) {
        if (/^(data:|https?:|\/\/)/i.test(ref)) return all;
        var f = findFile(files, ref);
        return f ? 'url("' + map[f.name] + '")' : all;
      })
      .replace(/<\/style/gi, '<\\/style');
  }
  function jsText(js) {
    return String(js).replace(/<\/script/gi, '<\\/script');
  }

  function buildPageDoc(pkg, token) {
    var files = pkg.files || [];
    var d = pkg.demo || {};
    var htmlFile = findFile(files, d.html) || firstExt(files, isHtml);
    var html = htmlFile ? String(htmlFile.data)
      : '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><p>包里没有 HTML 文件。</p></body></html>';

    /* 资源表只收"素材"（图片、JSON 等），html/css/js 本身不进去，避免体积翻倍 */
    var map = {};
    files.forEach(function (f) {
      if (isHtml(f.name) || isJs(f.name) || isCss(f.name)) return;
      map[f.name] = urlOf(f);
      if (!map[baseOf(f.name)]) map[baseOf(f.name)] = urlOf(f);
    });

    var used = {};

    /* 1. <link rel=stylesheet> → <style> */
    html = html.replace(/<link\b[^>]*>/gi, function (tag) {
      if (!/stylesheet/i.test(tag)) return tag;
      var m = /href\s*=\s*["']([^"']+)["']/i.exec(tag);
      var f = m && findFile(files, m[1]);
      if (!f || !isCss(f.name)) return tag;
      used[f.name] = 1;
      return '<style data-src="' + esc(m[1]) + '">' + cssText(f.data, map, files) + '</style>';
    });

    /* 2. <script src> → 内联 */
    html = html.replace(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script\s*>/gi, function (tag, src) {
      var f = findFile(files, src);
      if (!f || !isJs(f.name)) return tag;
      used[f.name] = 1;
      return '<script data-src="' + esc(src) + '">' + jsText(f.data) + '</script' + '>';
    });

    /* 3. 其它资源引用 → data URL */
    html = html.replace(/\b(src|href|poster)\s*=\s*["']([^"']+)["']/gi, function (all, attr, ref) {
      if (/^(data:|https?:|mailto:|tel:|#|\/\/)/i.test(ref)) return all;
      var f = findFile(files, ref);
      if (!f || isHtml(f.name) || isJs(f.name) || isCss(f.name)) return all;
      return attr + '="' + map[f.name] + '"';
    });

    /* 4. 未被引用的 css / js 追加到末尾 */
    var tail = '';
    files.forEach(function (f) {
      if (used[f.name] || !isCss(f.name)) return;
      used[f.name] = 1;
      tail += '<style data-src="' + esc(f.name) + '">' + cssText(f.data, map, files) + '</style>';
    });
    files.forEach(function (f) {
      if (used[f.name] || !isJs(f.name)) return;
      used[f.name] = 1;
      tail += '<script data-src="' + esc(f.name) + '">' + jsText(f.data) + '</script' + '>';
    });

    /* 5. 注入资源表与高度上报 */
    var assetsJson = JSON.stringify(map).replace(/</g, '\\u003c');
    var head =
      '<script>window.__ASSETS__=' + assetsJson + ';' +
      'window.caseAsset=function(n){return window.__ASSETS__[n]||""};' +
      '(function(){var last=-1;function send(){' +
      'var h=Math.max(document.body?document.body.scrollHeight:0,document.documentElement.scrollHeight);' +
      'h=Math.min(h,16000);if(Math.abs(h-last)>2){last=h;' +
      'try{parent.postMessage({__caseDemo:"' + token + '",h:h},"*")}catch(e){}}}' +
      'document.addEventListener("DOMContentLoaded",send);window.addEventListener("load",send);' +
      'try{if(window.ResizeObserver){new ResizeObserver(send).observe(document.documentElement)}}catch(e){}' +
      'var n=0,t=setInterval(function(){send();if(++n>40)clearInterval(t)},400);' +
      '})();</script' + '>';

    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head[^>]*>/i, function (m) { return m + head; });
    } else if (/<html[^>]*>/i.test(html)) {
      html = html.replace(/<html[^>]*>/i, function (m) { return m + '<head><meta charset="utf-8">' + head + '</head>'; });
    } else {
      html = '<!DOCTYPE html><html><head><meta charset="utf-8">' + head + '</head><body>' + html + '</body></html>';
    }

    if (tail) {
      if (/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, tail + '</body>');
      else html += tail;
    }
    return html;
  }

  function createPage(host, pkg, ctx) {
    var token = 'cd' + (++seq) + Date.now().toString(36);
    var minH = Math.max(220, Number(pkg.demo && pkg.demo.height) || 520);

    var frame = document.createElement('iframe');
    frame.className = 'cd-iframe';
    frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals allow-popups allow-downloads');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('title', (pkg.meta && pkg.meta.title ? pkg.meta.title : '案例示范') + '（沙箱）');
    frame.style.height = minH + 'px';
    frame.srcdoc = buildPageDoc(pkg, token);
    host.appendChild(frame);

    function onMsg(e) {
      if (e.source !== frame.contentWindow) return;
      var d = e.data;
      if (!d) return;
      if (d.__caseDemo === token) {
        var h = Math.min(17000, Math.max(minH, Number(d.h) + 2));
        frame.style.height = h + 'px';
        onGDScroll();
      } else if (d.__drawer === 'init') {
        ensureGD();
        /* 找到已有的 entry 并更新（demo 会重发几次以修正位置和内容） */
        var found = null;
        for (var gi = 0; gi < gdEntries.length; gi++) {
          if (gdEntries[gi].frame === frame) { found = gdEntries[gi]; break; }
        }
        if (found) {
          /* 如果当前激活的段落 HTML 变了，重新渲染 */
          if (found.currentId) {
            var newSec = null;
            for (var ni = 0; ni < (d.sections || []).length; ni++) {
              if (d.sections[ni].id === found.currentId) { newSec = d.sections[ni]; break; }
            }
            if (newSec) {
              var oldSec = null;
              for (var oi = 0; oi < found.sections.length; oi++) {
                if (found.sections[oi].id === found.currentId) { oldSec = found.sections[oi]; break; }
              }
              if (oldSec && oldSec.html !== newSec.html) {
                paintGDBody(newSec.html, newSec.title);
                found.lastHtml = newSec.html;
              }
            }
          }
          found.sections = d.sections || [];
        } else {
          gdEntries.push({ frame: frame, sections: d.sections || [], currentId: null });
        }
        onGDScroll();
      }
    }
    global.addEventListener('message', onMsg);

    return {
      mode: 'page',
      destroy: function () {
        global.removeEventListener('message', onMsg);
        var idx = gdEntries.indexOf(gdEntries.find(function(e){ return e.frame === frame; }));
        if (idx >= 0) gdEntries.splice(idx, 1);
        frame.remove();
        onGDScroll();
      }
    };
  }

  /* ---------------- module 模式：Shadow DOM + demo.js ---------------- */
  function tokenCss() {
    var cs = global.getComputedStyle(document.documentElement);
    var out = ':host{';
    TOKENS.forEach(function (t) {
      var v = cs.getPropertyValue(t);
      if (v) out += t + ':' + v.trim() + ';';
    });
    return out + '}';
  }

  function errBox(box, title, detail) {
    var d = document.createElement('div');
    d.className = 'cd-err';
    d.innerHTML = '<b>' + esc(title) + '</b>' + esc(detail || '');
    box.appendChild(d);
  }

  function createModule(host, pkg, ctx) {
    var files = pkg.files || [];
    var d = pkg.demo || {};
    var shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

    var style = document.createElement('style');
    style.textContent = tokenCss() + '\n' + BASE_CSS + '\n' +
      files.filter(function (f) { return isCss(f.name); }).map(function (f) { return String(f.data); }).join('\n');
    shadow.appendChild(style);

    var box = document.createElement('div');
    box.className = 'cd-box';
    shadow.appendChild(box);

    var cleanups = [];
    var api = {
      asset: function (name) { return urlOf(findFile(files, name)); },
      readText: function (name) {
        var f = findFile(files, name);
        return Promise.resolve(f && f.enc === 'text' ? f.data : '');
      },
      list: function () { return files.map(function (f) { return f.name; }); },
      scene: (ctx && ctx.scene) || null,
      kase: (ctx && ctx.kase) || null,
      onDestroy: function (fn) { if (typeof fn === 'function') cleanups.push(fn); },
      height: function (px) { if (px) host.style.minHeight = Number(px) + 'px'; }
    };

    var jsFile = findFile(files, d.js) || firstExt(files, isJs);
    var live = null;

    if (!jsFile) {
      errBox(box, '没有找到 demo.js', '把示范脚本命名为 demo.js 放进包里，或改用 index.html 整页模式。');
    } else {
      var code = String(jsFile.data);
      var mod = { exports: {} };
      var fn = null;
      try {
        fn = new Function('module', 'exports', 'api', 'root', 'console', code + '\n;return module.exports;');
      } catch (e) {
        errBox(box, 'demo.js 有语法错误（第 ' + (e.lineNumber || '?') + ' 行附近）', e.message);
      }
      if (fn) {
        try { delete global.__CASE_MOUNT__; } catch (e) { global.__CASE_MOUNT__ = null; }
        var out = null;
        try {
          out = fn(mod, mod.exports, api, box, global.console) || mod.exports;
        } catch (e) {
          errBox(box, 'demo.js 在加载阶段抛出异常', e.message);
        }
        if (out) {
          var cand = (typeof out.mount === 'function') ? out
            : (out.default && typeof out.default.mount === 'function') ? out.default
              : (typeof global.__CASE_MOUNT__ === 'function') ? { mount: global.__CASE_MOUNT__ }
                : null;
          if (!cand) {
            errBox(box, 'demo.js 没有导出 mount',
              '支持三种写法：module.exports={mount(root,api){}}、exports.mount=function(root,api){}、window.__CASE_MOUNT__=function(root,api){}。');
          } else {
            try {
              live = cand.mount(box, api) || cand;
            } catch (e) {
              errBox(box, 'mount() 执行失败', e.message);
            }
          }
        }
      }
    }

    return {
      mode: 'module',
      destroy: function () {
        try { if (live && typeof live.unmount === 'function') live.unmount(); } catch (e) { }
        cleanups.forEach(function (fn) { try { fn(); } catch (e) { } });
        try { if (shadow.host === host) host.innerHTML = ''; } catch (e) { }
      }
    };
  }

  /* ---------------- 全局控件抽屉（主页面右侧） ---------------- */
  var gd = null;
  var gdEntries = []; // {frame, sections, currentId}
  var gdActiveFrame = null;

  function ensureGD() {
    if (gd) return;
    gd = document.createElement('aside');
    gd.id = 'cd-gd';
    gd.innerHTML = '<div class="cd-gd-head"><span class="cd-gd-tag">交互控件</span><span class="cd-gd-title"></span></div><div class="cd-gd-body"></div>';
    var st = document.createElement('style');
    st.textContent = [
      '#cd-gd{position:fixed;right:0;top:70px;width:268px;max-height:calc(100vh - 120px);',
      'overflow-y:auto;background:#fff;border:1px solid #e9e4d8;border-radius:10px;',
      'box-shadow:0 6px 24px -8px rgba(0,0,0,.15);z-index:90;',
      'transform:translateX(-100%);opacity:0;pointer-events:none;',
      'transition:transform .3s ease,opacity .3s ease;font-size:13px;}',
      '#cd-gd.open{transform:translateX(0);opacity:1;pointer-events:auto;}',
      '.cd-gd-head{display:flex;align-items:center;gap:8px;font-weight:600;',
      'padding:8px 12px;border-bottom:1px solid #eee;position:sticky;top:0;background:#fff;}',
      '.cd-gd-tag{font-size:11px;color:#888;font-weight:400;flex:none;white-space:nowrap;}',
      '.cd-gd-title{font-size:12px;color:#666;flex:1;min-width:0;white-space:nowrap;',
      'overflow:hidden;text-overflow:ellipsis;}',
      '.cd-gd-body{padding:10px 12px;}',
      '.cd-gd-body .sl{margin:10px 0;}',
      '.cd-gd-body .sl>label{display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;}',
      '.cd-gd-body input[type=range]{width:100%;margin:0;}',
      /* 主站 ui.css 里那套 .ctl（横向 flex + 112px 细滑杆）会漏进抽屉，
         把案例自带的控件块压成竖条，这里按 id 提权覆盖回块级排版 */
      '#cd-gd .cd-gd-body .ctl{display:block;align-items:initial;gap:0;font-size:12.5px;color:#4d565b;width:auto;}',
      '#cd-gd .cd-gd-body .ctl label{font-family:inherit;font-size:12.5px;letter-spacing:0;color:#4d565b;white-space:normal;}',
      '#cd-gd .cd-gd-body .ctl input[type=range]{-webkit-appearance:auto;appearance:auto;width:100%;height:22px;',
      'margin:0;padding:0;background:transparent;border:0;border-radius:0;box-shadow:none;accent-color:#2b8a67;}',
      '#cd-gd .cd-gd-body .ctl input[type=range]::-webkit-slider-thumb{-webkit-appearance:auto;appearance:auto;',
      'width:auto;height:auto;margin:0;border:0;border-radius:0;background:initial;box-shadow:none;}',
      '#cd-gd .cd-gd-body .sl{margin:0 0 12px;}',
      '#cd-gd .cd-gd-body .sl label{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;}',
      '#cd-gd .cd-gd-body .sl output{font-family:ui-monospace,monospace;font-size:12.5px;color:#2b8a67;font-weight:600;}',
      /* 阈值滑杆（.tau-sl）与独立按钮，案例自带样式在抽屉里不生效，这里补一份 */
      '#cd-gd .cd-gd-body .tau-sl{display:flex;align-items:center;gap:8px;margin:8px 0 0;',
      'padding:6px 8px;background:#f7f6f1;border-radius:8px;}',
      '#cd-gd .cd-gd-body .tau-sl label{display:flex;align-items:center;gap:6px;font-size:12px;color:#4d565b;white-space:nowrap;}',
      '#cd-gd .cd-gd-body .tau-sl input[type=range]{-webkit-appearance:auto;appearance:auto;flex:1;width:auto;height:20px;',
      'margin:0;padding:0;background:transparent;border:0;accent-color:#b26a39;}',
      '#cd-gd .cd-gd-body .tau-sl output{font-family:ui-monospace,monospace;font-size:12.5px;font-weight:700;color:#b05a51;}',
      '#cd-gd .cd-gd-body>button,#cd-gd .cd-gd-body>.ctl>button{margin-top:8px;}',
      '.cd-gd-body .chk{display:flex;align-items:center;gap:6px;margin:6px 0;font-size:12px;cursor:pointer;}',
      '.cd-gd-body .btns{display:flex;flex-wrap:wrap;gap:4px;margin:8px 0;}',
      '.cd-gd-body .btns button{padding:4px 10px;font-size:12px;border:1px solid #ddd;',
      'border-radius:6px;background:#f5f5f5;cursor:pointer;}',
      '.cd-gd-body .btns button.active,.cd-gd-body .btns button.on{background:#2b8a67;color:#fff;border-color:#2b8a67;}',
      '.cd-gd-body button{padding:4px 10px;font-size:12px;border:1px solid #ddd;',
      'border-radius:6px;background:#f5f5f5;cursor:pointer;}',
      '.cd-gd-body .presets{margin:8px 0;}',
      '.cd-gd-body .presets .lb{display:block;font-size:11px;color:#888;margin-bottom:3px;}',
      '.cd-gd-body .presets .p{display:flex;gap:4px;flex-wrap:wrap;}',
      '.cd-gd-body .presets .p button{padding:3px 8px;font-size:11px;border:1px solid #ddd;',
      'border-radius:5px;background:#f5f5f5;cursor:pointer;}',
      '.cd-gd-body .presets .p button.active{background:#2b8a67;color:#fff;border-color:#2b8a67;}',
      '.cd-gd-body .presets .pbtn{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;',
      'font-size:11px;border:1px solid #ddd;border-radius:5px;background:#f5f5f5;cursor:pointer;',
      'margin:0 4px 4px 0;}',
      '.cd-gd-body .presets .pbtn.on{background:#2b8a67;color:#fff;border-color:#2b8a67;}',
      '.cd-gd-body .presets .pbtn .dot{width:6px;height:6px;border-radius:50%;display:inline-block;flex:none;}',
      /* 「来自 实验 N」分组：别的实验里能改动当前图的控件 */
      '#cd-gd .cd-gd-body .gdb{margin:12px 0 0;padding-top:8px;border-top:1px dashed #e6e1d4;}',
      '#cd-gd .cd-gd-body .gdb>summary{cursor:pointer;font-size:11px;color:#8a8f95;line-height:1.7;',
      'list-style:none;outline:none;user-select:none;}',
      '#cd-gd .cd-gd-body .gdb>summary::-webkit-details-marker{display:none;}',
      '#cd-gd .cd-gd-body .gdb>summary::before{content:"▸ ";color:#c9c2b0;}',
      '#cd-gd .cd-gd-body .gdb[open]>summary::before{content:"▾ ";}',
      '#cd-gd .cd-gd-body .gdb[open]>summary{margin-bottom:4px;}',
      '@media (max-width:760px){#cd-gd{width:calc(100vw - 20px);right:10px;top:auto;bottom:10px;max-height:45vh;}}'
    ].join('');
    document.head.appendChild(st);
    document.body.appendChild(gd);

    var body = gd.querySelector('.cd-gd-body');
    body.addEventListener('input', function(e){
      var el = e.target;
      if (!gdActiveFrame) return;
      var cid = el.getAttribute('data-ctl-id') || el.id;
      if (!cid) return;
      var val = el.type === 'checkbox' ? el.checked : parseFloat(el.value);
      try { gdActiveFrame.contentWindow.postMessage({__drawer:'control', id:cid, value:val}, '*'); } catch(e){}
      if (el.type === 'range') {
        var box = el.closest('.sl') || el.closest('.tau-sl');
        var out = box && box.querySelector('output');
        if (out) out.textContent = el.closest('.tau-sl') ? Number(el.value).toFixed(2) : el.value;
      }
    });
    body.addEventListener('change', function(e){
      var el = e.target;
      if (!gdActiveFrame) return;
      var cid = el.getAttribute('data-ctl-id') || el.id;
      if (!cid) return;
      var val = el.type === 'checkbox' ? el.checked : el.value;
      try { gdActiveFrame.contentWindow.postMessage({__drawer:'control', id:cid, value:val}, '*'); } catch(e){}
    });
    body.addEventListener('click', function(e){
      var btn = e.target.closest('button');
      if (!btn || !gdActiveFrame) return;
      var cid = btn.getAttribute('data-ctl-id') || btn.id || '';
      try { gdActiveFrame.contentWindow.postMessage({__drawer:'control', id:cid, value:'click', label:btn.textContent.trim()}, '*'); } catch(e){}
    });

    global.addEventListener('scroll', onGDScroll, {passive:true});
    global.addEventListener('resize', onGDScroll);
  }

  /* 视口焦点：取 46% 高（上面的固定导航遮掉一截，真实注视点在中间偏上）。
     旧判据是「段落与视口有 20px 重叠就算当前段」，滚到「AI 三问」时下面第一个实验
     刚露个边，抽屉就弹出来了——三问那一段根本不需要控件。 */
  var GD_PIVOT = 0.46;
  /* 焦点没落在任何段里（段间空隙、页头、三问）时，段落要占住视口一半才接管 */
  var GD_MIN_COVER = 0.5;

  function onGDScroll() {
    if (!gd) return;
    /* 视图重建后旧 iframe 可能已经不在文档里，先清掉，否则会一直算到死数据 */
    for (var g0 = gdEntries.length - 1; g0 >= 0; g0--) {
      if (!gdEntries[g0].frame.isConnected) gdEntries.splice(g0, 1);
    }
    var vh = global.innerHeight;
    var pivot = vh * GD_PIVOT;
    var hitFrame = null, hitId = null;                 /* 焦点命中的段，优先 */
    var coverFrame = null, coverId = null, coverBest = 0;

    for (var e = 0; e < gdEntries.length; e++) {
      var entry = gdEntries[e];
      var rect = entry.frame.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= vh) continue;   /* 整个 iframe 不在视口里 */
      for (var i = 0; i < entry.sections.length; i++) {
        var sec = entry.sections[i];
        var top = rect.top + sec.top;
        var bottom = top + sec.height;
        var vis = Math.min(bottom, vh) - Math.max(top, 0);
        if (vis <= 2) continue;
        if (top <= pivot && bottom >= pivot) { hitFrame = entry.frame; hitId = sec.id; }
        var cover = vis / vh;
        if (cover > coverBest) { coverBest = cover; coverFrame = entry.frame; coverId = sec.id; }
      }
    }

    if (hitFrame && hitId) { showGDSection(hitFrame, hitId); return; }
    if (coverFrame && coverBest >= GD_MIN_COVER) { showGDSection(coverFrame, coverId); return; }
    if (gd.classList.contains('open')) hideGD();
  }

  /* 重绘抽屉正文。案例会按「影响面」把别的实验的控件也塞进来，
     这些分组是可折叠的：重绘时要保留用户已经展开的那些。 */
  function paintGDBody(html, title) {
    var body = gd.querySelector('.cd-gd-body');
    var opened = {};
    Array.prototype.forEach.call(body.querySelectorAll('.gdb'), function (d) {
      if (!d.open) return;
      var sm = d.querySelector('summary');
      if (sm) opened[sm.textContent.trim()] = 1;
    });
    body.innerHTML = html;
    if (title != null) gd.querySelector('.cd-gd-title').textContent = title;
    var keys = Object.keys(opened);
    if (keys.length) {
      Array.prototype.forEach.call(body.querySelectorAll('.gdb'), function (d) {
        var sm = d.querySelector('summary');
        if (sm && opened[sm.textContent.trim()]) d.open = true;
      });
    }
  }

  function showGDSection(frame, secId) {
    var entry = null;
    for (var i = 0; i < gdEntries.length; i++) {
      if (gdEntries[i].frame === frame) { entry = gdEntries[i]; break; }
    }
    if (!entry) return;
    var sec = null;
    for (var j = 0; j < entry.sections.length; j++) {
      if (entry.sections[j].id === secId) { sec = entry.sections[j]; break; }
    }
    if (!sec) return;
    /* 这一段明确没有控件（比如「AI 三问」）：直接收起，别留着上一段的控件 */
    if (!sec.html) { hideGD(); return; }
    /* 只在「换段」或「demo 重发了新 HTML」时重绘。
       否则拖动滑杆时只要页面滚一下，抽屉就会被旧快照重置回原位。 */
    if (entry.currentId !== secId || entry.lastHtml !== sec.html) {
      paintGDBody(sec.html, sec.title);
      entry.lastHtml = sec.html;
    }
    entry.currentId = secId;
    gdActiveFrame = frame;
    gd.classList.add('open');
    startGDWatch();
  }

  /* 抽屉开着时每 320ms 复核一次：切 tab（panel 被 display:none）、路由换页、
     案例内部异步换图导致高度变化，都不会触发 scroll 事件，靠这一手兜住。 */
  var gdTimer = 0;
  function startGDWatch() {
    if (gdTimer) return;
    gdTimer = global.setInterval(function () {
      if (!gd || !gd.classList.contains('open')) { global.clearInterval(gdTimer); gdTimer = 0; return; }
      onGDScroll();
    }, 320);
  }

  function hideGD() {
    gd.classList.remove('open');
    gdActiveFrame = null;
    for (var i = 0; i < gdEntries.length; i++) {
      gdEntries[i].currentId = null;
    }
  }

  /* ---------------- 入口 ---------------- */
  function create(container, pkg, ctx) {
    if (!container) return { mode: 'none', destroy: function () { } };
    container.innerHTML = '';
    var mode = resolveMode(pkg);
    if (mode === 'page') return createPage(container, pkg, ctx);
    if (mode === 'module') return createModule(container, pkg, ctx);
    return { mode: 'none', destroy: function () { } };
  }

  global.CaseDemoHost = {
    create: create,
    resolveMode: resolveMode,
    buildPageDoc: buildPageDoc,
    findFile: findFile,
    isText: isText,
    mimeOf: mimeOf,
    refresh: function () { try { onGDScroll(); } catch (e) { } },
    _ensureGD: ensureGD,
    _gdEntries: gdEntries
  };

})(window);
