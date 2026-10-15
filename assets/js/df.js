/* df.js — a compact, pandas-inspired DataFrame engine (pure JavaScript, no dependencies).
   Supports the operations exposed by the visual interface: selection, filtering,
   sorting, missing-value handling, de-duplication, assignment, type casting,
   group-by aggregation, pivot tables, correlation and joins. */
(function (global) {
  'use strict';

  var S = global.Stats;

  var NA_TOKENS = { '': 1, 'na': 1, 'n/a': 1, 'nan': 1, 'null': 1, 'none': 1, 'nil': 1, '-': 1, '—': 1, '#n/a': 1 };

  function isNumericDtype(dt) { return dt === 'int64' || dt === 'float64'; }
  function isNullish(v) { return v === null || v === undefined || (typeof v === 'number' && isNaN(v)); }

  /* ---------- value parsing & type inference ---------- */

  function parseValue(raw) {
    if (typeof raw === 'number') return isNaN(raw) ? null : raw;
    if (typeof raw === 'boolean') return raw;
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'object') return raw;
    var s = String(raw).trim();
    if (s === '') return null;
    if (NA_TOKENS[s.toLowerCase()]) return null;
    if (/^[+-]?\d+$/.test(s)) {
      var n = Number(s);
      if (Number.isSafeInteger(n)) return n;
    }
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return Number(s);
    if (/^(true|false)$/i.test(s)) return s.toLowerCase() === 'true';
    return s;
  }

  function looksDate(s) {
    return typeof s === 'string' && /^\d{4}[-/]\d{1,2}([-/]\d{1,2})?([ T]\d{1,2}:\d{2}(:\d{2})?)?/.test(s) && !isNaN(Date.parse(s));
  }

  function inferType(values) {
    var hasNum = false, hasOther = false, allInt = true, allBool = true, allDate = true, n = 0;
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      if (isNullish(v)) continue;
      n++;
      if (typeof v === 'number') { hasNum = true; if (!Number.isInteger(v)) allInt = false; allBool = false; allDate = false; }
      else if (typeof v === 'boolean') { hasOther = true; allInt = false; allDate = false; hasNum = hasNum; }
      else { hasOther = true; allInt = false; allBool = false; if (!looksDate(v)) allDate = false; }
      if (typeof v !== 'boolean') allBool = false;
    }
    if (n === 0) return 'object';
    if (hasNum && !hasOther) return allInt ? 'int64' : 'float64';
    if (allBool && !hasNum) return 'bool';
    if (allDate && !hasNum) return 'datetime64';
    return 'object';
  }

  function autoIndex(n) { var a = new Array(n); for (var i = 0; i < n; i++) a[i] = i; return a; }

  /* ---------- DataFrame ---------- */

  function DataFrame(cols, index) {
    cols = cols || [];
    this._cols = [];
    this._data = {};
    this._types = {};
    for (var i = 0; i < cols.length; i++) {
      var c = cols[i];
      if (!c || c.name === undefined) continue;
      this._cols.push(c.name);
      this._data[c.name] = Array.isArray(c.values) ? c.values.slice() : [];
      this._types[c.name] = c.dtype || inferType(this._data[c.name]);
    }
    this.index = index || autoIndex(this.nrows);
  }

  Object.defineProperty(DataFrame.prototype, 'nrows', {
    get: function () { return this._cols.length ? this._data[this._cols[0]].length : 0; }
  });
  Object.defineProperty(DataFrame.prototype, 'ncols', { get: function () { return this._cols.length; } });
  Object.defineProperty(DataFrame.prototype, 'shape', {
    get: function () { return [this.nrows, this.ncols]; }
  });

  DataFrame.prototype.columns = function () { return this._cols.slice(); };
  DataFrame.prototype.dtypes = function () {
    var out = {}; for (var i = 0; i < this._cols.length; i++) out[this._cols[i]] = this._types[this._cols[i]];
    return out;
  };
  DataFrame.prototype.dtype = function (c) { return this._types[c]; };
  DataFrame.prototype.has = function (c) { return this._cols.indexOf(c) !== -1; };
  DataFrame.prototype.series = function (c) { return this._data[c] || []; };
  DataFrame.prototype.row = function (i) {
    var r = {};
    for (var k = 0; k < this._cols.length; k++) r[this._cols[k]] = this._data[this._cols[k]][i];
    return r;
  };
  DataFrame.prototype.numericColumns = function () {
    var out = [], d = this._types;
    for (var i = 0; i < this._cols.length; i++) if (isNumericDtype(d[this._cols[i]])) out.push(this._cols[i]);
    return out;
  };
  DataFrame.prototype.categoricalColumns = function () {
    var out = [], d = this._types;
    for (var i = 0; i < this._cols.length; i++) if (!isNumericDtype(d[this._cols[i]])) out.push(this._cols[i]);
    return out;
  };
  DataFrame.prototype.clone = function () {
    return new DataFrame(this._cols.map(function (c) { return { name: c, dtype: this._types[c], values: this._data[c] }; }, this), this.index.slice());
  };

  DataFrame.prototype.head = function (n) {
    n = n === undefined ? 5 : n;
    return this.take(autoIndex(Math.min(n, this.nrows)));
  };
  DataFrame.prototype.tail = function (n) {
    n = n === undefined ? 5 : n;
    var start = Math.max(0, this.nrows - n), idx = [];
    for (var i = start; i < this.nrows; i++) idx.push(i);
    return this.take(idx);
  };

  DataFrame.prototype.take = function (idx) {
    var cols = this._cols.map(function (c) {
      var src = this._data[c], vals = new Array(idx.length);
      for (var i = 0; i < idx.length; i++) vals[i] = src[idx[i]];
      return { name: c, dtype: this._types[c], values: vals };
    }, this);
    return new DataFrame(cols, idx.slice());
  };

  DataFrame.prototype.sample = function (n, seed) {
    n = Math.min(n || 5, this.nrows);
    var idx = autoIndex(this.nrows), rnd = mulberry(seed || 42);
    for (var i = idx.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)); var t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
    idx = idx.slice(0, n);
    return this.take(idx);
  };

  DataFrame.prototype.select = function (cols) {
    var keep = cols.filter(function (c) { return this.has(c); }, this);
    return this._keep(keep);
  };
  DataFrame.prototype.drop = function (cols) {
    var keep = this._cols.filter(function (c) { return cols.indexOf(c) === -1; });
    return this._keep(keep);
  };
  DataFrame.prototype._keep = function (keep) {
    return new DataFrame(keep.map(function (c) { return { name: c, dtype: this._types[c], values: this._data[c] }; }, this), this.index.slice());
  };
  DataFrame.prototype.rename = function (map) {
    var cols = this._cols.map(function (c) {
      var nn = map[c] !== undefined && map[c] !== '' ? map[c] : c;
      return { name: nn, dtype: this._types[c], values: this._data[c] };
    }, this);
    return new DataFrame(cols, this.index.slice());
  };
  DataFrame.prototype.astype = function (col, dtype) {
    var out = this.clone(); if (!out.has(col)) return out;
    var vals = out._data[col].map(function (v) { return castValue(v, dtype); });
    out._data[col] = vals; out._types[col] = inferType(vals) === dtype ? dtype : dtype;
    return out;
  };
  DataFrame.prototype.assign = function (name, values) {
    var out = this.clone();
    var arr = typeof values === 'function' ? values(out) : values;
    if (!Array.isArray(arr)) arr = new Array(out.nrows).fill(arr);
    out._data[name] = arr.slice(0, out.nrows);
    if (out._cols.indexOf(name) === -1) out._cols.push(name);
    out._types[name] = inferType(out._data[name]);
    return out;
  };
  DataFrame.prototype.filterRows = function (fn) {
    var idx = [];
    for (var i = 0; i < this.nrows; i++) if (fn(this.row(i), i)) idx.push(i);
    return this.take(idx);
  };
  DataFrame.prototype.sortValues = function (by, ascending) {
    var self = this, n = this.nrows, idx = autoIndex(n);
    var keys = (Array.isArray(by) ? by : [by]).filter(function (c) { return self.has(c); });
    if (Array.isArray(ascending)) ascending = ascending.slice();
    else ascending = keys.map(function () { return ascending !== false; });
    var typeOfKey = keys.map(function (c) { return self._types[c]; });
    idx.sort(function (a, b) {
      for (var k = 0; k < keys.length; k++) {
        var va = self._data[keys[k]][a], vb = self._data[keys[k]][b];
        var na = isNullish(va), nb = isNullish(vb);
        if (na && nb) continue;
        if (na) return 1; if (nb) return -1;            // NaNs last (pandas na_position='last')
        var cmp;
        if (isNumericDtype(typeOfKey[k])) cmp = va - vb;
        else if (typeOfKey[k] === 'bool') cmp = (va === vb) ? 0 : (va ? 1 : -1);
        else cmp = String(va).localeCompare(String(vb));
        if (cmp !== 0) return ascending[k] === false ? -cmp : cmp;
      }
      return a - b;
    });
    return this.take(idx);
  };

  DataFrame.prototype.dropna = function (opts) {
    opts = opts || {};
    var subset = (opts.subset && opts.subset.length) ? opts.subset : this._cols;
    var keep = opts.how === 'all' ? 'all' : 'any', thresh = opts.thresh;
    var self = this, idx = [];
    for (var i = 0; i < this.nrows; i++) {
      var nulls = 0;
      for (var k = 0; k < subset.length; k++) if (isNullish(self._data[subset[k]][i])) nulls++;
      var ok = thresh != null ? (subset.length - nulls) >= thresh
        : (keep === 'all' ? nulls < subset.length : nulls === 0);
      if (ok) idx.push(i);
    }
    return this.take(idx);
  };

  DataFrame.prototype.fillna = function (opts) {
    opts = opts || {};
    var cols = (opts.columns && opts.columns.length) ? opts.columns : this._cols;
    var out = this.clone(), method = opts.method;
    for (var ci = 0; ci < cols.length; ci++) {
      var c = cols[ci]; if (!out.has(c)) continue;
      var arr = out._data[c], prev = arr[0];
      if (method === 'ffill' || method === 'bfill') {
        for (var i = 0; i < arr.length; i++) {
          if (isNullish(arr[i])) arr[i] = method === 'ffill' ? (isNullish(prev) ? null : prev) : null;
          else prev = arr[i];
        }
        if (method === 'bfill') {
          var next = null;
          for (var j = arr.length - 1; j >= 0; j--) {
            if (isNullish(arr[j])) { if (next !== null) arr[j] = next; } else next = arr[j];
          }
        }
      } else {
        var val;
        if (method === 'mean') val = S.mean(S.clean(arr));
        else if (method === 'median') val = S.median(S.clean(arr));
        else if (method === 'mode') val = S.mode(S.clean(arr));
        else if (method === 'zero') val = 0;
        else val = opts.value;
        if (val === '__mean__') val = S.mean(S.clean(arr));
        else if (val === '__median__') val = S.median(S.clean(arr));
        else if (val === '__mode__') val = S.mode(S.clean(arr));
        else if (val === '__zero__') val = 0;
        if (typeof val === 'string' && opts.coerceNumeric && isNumericDtype(out._types[c])) { var f = parseFloat(val); if (!isNaN(f)) val = f; }
        for (var m = 0; m < arr.length; m++) if (isNullish(arr[m])) arr[m] = val;
      }
    }
    return out;
  };

  DataFrame.prototype.isnaCounts = function () {
    var out = {}, self = this;
    this._cols.forEach(function (c) {
      var n = 0; for (var i = 0; i < self.nrows; i++) if (isNullish(self._data[c][i])) n++;
      out[c] = n;
    });
    return out;
  };

  DataFrame.prototype.duplicated = function (subset, keep) {
    subset = (subset && subset.length) ? subset : this._cols;
    keep = keep === undefined ? 'first' : keep;
    var self = this, seen = {}, flags = new Array(this.nrows).fill(false);
    for (var i = 0; i < this.nrows; i++) {
      var key = subset.map(function (c) { return valKey(self._data[c][i]); }).join('\u0001');
      if (seen[key] !== undefined) flags[i] = true; else seen[key] = i;
    }
    return flags;
  };
  DataFrame.prototype.dropDuplicates = function (subset, keep) {
    subset = (subset && subset.length) ? subset : this._cols;
    keep = keep === undefined ? 'first' : keep;
    var self = this, seen = {}, idx = [];
    var order = autoIndex(this.nrows);
    if (keep === 'last') order.reverse();
    for (var oi = 0; oi < order.length; oi++) {
      var i = order[oi];
      var key = subset.map(function (c) { return valKey(self._data[c][i]); }).join('\u0001');
      if (seen[key] === undefined) { seen[key] = i; idx.push(i); }
    }
    idx.sort(function (a, b) { return a - b; });
    return this.take(idx);
  };
  DataFrame.prototype.uniqueValues = function (col) {
    var seen = new Set(), out = [], arr = this.series(col);
    for (var i = 0; i < arr.length; i++) { var k = (isNullish(arr[i]) ? '∅' : String(arr[i])); if (!seen.has(k)) { seen.add(k); out.push(arr[i]); } }
    return out;
  };
  DataFrame.prototype.nunique = function (col) { return this.uniqueValues(col).length; };
  DataFrame.prototype.valueCounts = function (col, opts) {
    opts = opts || {};
    var arr = this.series(col), map = new Map();
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i];
      if (isNullish(v) && opts.dropna) continue;
      var k = isNullish(v) ? '∅' : (typeof v === 'number' ? 'n:' + v : String(v));
      var e = map.get(k) || { key: isNullish(v) ? null : v, count: 0 };
      e.count++; map.set(k, e);
    }
    var rows = Array.from(map.values());
    rows.sort(function (a, b) { return opts.ascending ? a.count - b.count : b.count - a.count; });
    var total = opts.dropna ? rows.reduce(function (s, r) { return s + r.count; }, 0) : this.nrows;
    rows.forEach(function (r) { r.pct = total ? r.count / total : 0; });
    return rows;
  };

  /* ---------- group-by / aggregation ---------- */

  var AGG = {
    count: function (v) { var n = 0; for (var i = 0; i < v.length; i++) if (!isNullish(v[i])) n++; return n; },
    size: function (v) { return v.length; },
    sum: function (v) { var a = S.clean(v); return a.length ? S.sum(a) : null; },
    mean: function (v) { var a = S.clean(v); return a.length ? S.mean(a) : null; },
    median: function (v) { var a = S.clean(v); return a.length ? S.median(a) : null; },
    min: function (v) { var a = S.clean(v); return a.length ? S.min(a) : null; },
    max: function (v) { var a = S.clean(v); return a.length ? S.max(a) : null; },
    std: function (v) { var a = S.clean(v); return a.length > 1 ? S.std(a, 1) : null; },
    var: function (v) { var a = S.clean(v); return a.length > 1 ? S.variance(a, 1) : null; },
    prod: function (v) { var a = S.clean(v); return a.length ? S.prod(a) : null; },
    nunique: function (v) { var s = new Set(); for (var i = 0; i < v.length; i++) if (!isNullish(v[i])) s.add(String(v[i])); return s.size; },
    first: function (v) { for (var i = 0; i < v.length; i++) if (!isNullish(v[i])) return v[i]; return null; },
    last: function (v) { for (var i = v.length - 1; i >= 0; i--) if (!isNullish(v[i])) return v[i]; return null; },
    mode: function (v) { var a = []; for (var i = 0; i < v.length; i++) if (!isNullish(v[i])) a.push(v[i]); return a.length ? S.mode(a) : null; }
  };
  var AGG_LIST = Object.keys(AGG);

  DataFrame.prototype.groupbyAgg = function (by, specs) {
    by = Array.isArray(by) ? by.filter(function (c) { return this.has(c); }, this) : [by];
    var self = this, groups = new Map();
    for (var i = 0; i < this.nrows; i++) {
      var key = by.map(function (c) { return valKey(self._data[c][i]); }).join('\u0001');
      var g = groups.get(key);
      if (!g) { g = { keys: by.map(function (c) { return self._data[c][i]; }), rows: [] } ; groups.set(key, g); }
      g.rows.push(i);
    }
    var groupList = Array.from(groups.values());
    groupList.sort(function (a, b) {
      for (var k = 0; k < by.length; k++) {
        var va = a.keys[k], vb = b.keys[k];
        if (isNullish(va)) return 1; if (isNullish(vb)) return -1;
        var c = (typeof va === 'number' && typeof vb === 'number') ? va - vb : String(va).localeCompare(String(vb));
        if (c) return c;
      }
      return 0;
    });
    var outCols = by.map(function (c) { return { name: c, dtype: self._types[c], values: [] }; });
    var outNames = [];
    (specs || []).forEach(function (sp) {
      (sp.funcs || []).forEach(function (f) {
        if (!AGG[f]) return;
        outNames.push({ col: sp.col, fn: f });
      });
    });
    outNames.forEach(function (o, oi) {
      outCols.push({ name: o.col + ' (' + o.fn + ')', dtype: 'float64', values: [] });
    });
    var base = by.length;
    groupList.forEach(function (g) {
      for (var k = 0; k < by.length; k++) outCols[k].values.push(g.keys[k]);
      outNames.forEach(function (o, oi) {
        var v = null;
        if (o.fn === 'size') v = g.rows.length;
        else if (o.col === '__size__' || !self.has(o.col)) v = null;
        else { var arr = g.rows.map(function (r) { return self._data[o.col][r]; }); v = AGG[o.fn](arr); }
        outCols[base + oi].values.push(v);
      });
    });
    return new DataFrame(outCols);
  };

  DataFrame.prototype.pivotTable = function (opts) {
    var idxCol = opts.index, colCol = opts.columns, valCol = opts.values, fn = AGG[opts.aggfunc] ? opts.aggfunc : 'mean';
    var self = this;
    var colKeys = [], seenC = new Set();
    for (var i = 0; i < this.nrows; i++) {
      var ck = isNullish(this._data[colCol][i]) ? '∅' : String(this._data[colCol][i]);
      if (!seenC.has(ck)) { seenC.add(ck); colKeys.push(ck); }
    }
    colKeys.sort(function (a, b) { var na = parseFloat(a), nb = parseFloat(b); if (!isNaN(na) && !isNaN(nb)) return na - nb; return a.localeCompare(b); });
    var rowKeys = [], seenR = new Set(), cells = new Map();
    for (var j = 0; j < this.nrows; j++) {
      var rk = isNullish(this._data[idxCol][j]) ? '∅' : String(this._data[idxCol][j]);
      var k2 = rk + '\u0001' + (isNullish(this._data[colCol][j]) ? '∅' : String(this._data[colCol][j]));
      if (!seenR.has(rk)) { seenR.add(rk); rowKeys.push(rk); }
      if (!cells.has(k2)) cells.set(k2, []);
      cells.get(k2).push(this._data[valCol][j]);
    }
    rowKeys.sort(function (a, b) { var na = parseFloat(a), nb = parseFloat(b); if (!isNaN(na) && !isNaN(nb)) return na - nb; return a.localeCompare(b); });
    var cols = [{ name: idxCol, dtype: 'object', values: rowKeys }];
    colKeys.forEach(function (ck) {
      cols.push({
        name: ck, dtype: 'float64', values: rowKeys.map(function (rk) {
          var arr = cells.get(rk + '\u0001' + ck);
          if (!arr) return opts.fillValue !== undefined ? opts.fillValue : null;
          return AGG[fn](arr);
        })
      });
    });
    return new DataFrame(cols);
  };

  DataFrame.prototype.corr = function (method) {
    method = method || 'pearson';
    var cols = this.numericColumns(), m = [];
    var series = cols.map(function (c) { return this._data[c]; }, this);
    for (var i = 0; i < cols.length; i++) {
      m.push([]);
      for (var j = 0; j < cols.length; j++) {
        if (i === j) { m[i].push(1); continue; }
        var p = S.pair(series[i], series[j]);
        var r = method === 'spearman' ? S.spearman(p[0], p[1]) : S.pearson(p[0], p[1]);
        m[i].push(r === null ? null : Math.round(r * 1e6) / 1e6);
      }
    }
    return { labels: cols, matrix: m };
  };

  DataFrame.prototype.cov = function () { return this.corr('pearson'); };

  DataFrame.prototype.merge = function (other, opts) {
    opts = opts || {};
    var how = opts.how || 'inner';
    var lk = opts.on ? (Array.isArray(opts.on) ? opts.on : [opts.on]) : (opts.left_on ? (Array.isArray(opts.left_on) ? opts.left_on : [opts.left_on]) : []);
    var rk = opts.on ? lk : (opts.right_on ? (Array.isArray(opts.right_on) ? opts.right_on : [opts.right_on]) : lk);
    var suffixes = opts.suffixes || ['_x', '_y'];
    var self = this;
    var rightIndex = new Map();
    for (var j = 0; j < other.nrows; j++) {
      var k = rk.map(function (c) { return valKey(other._data[c][j]); }).join('\u0001');
      if (!rightIndex.has(k)) rightIndex.set(k, []);
      rightIndex.get(k).push(j);
    }
    var lCols = this._cols.filter(function (c) { return lk.indexOf(c) === -1; });
    var rCols = other._cols.filter(function (c) { return rk.indexOf(c) === -1; });
    var outCols = lk.map(function (c) { return { name: c, dtype: self._types[c], values: [] }; });
    lCols.forEach(function (c) { outCols.push({ name: pickName(c, rCols, suffixes[0]), dtype: self._types[c], values: [] }); });
    rCols.forEach(function (c) { outCols.push({ name: pickName(c, lCols, suffixes[1]), dtype: other._types[c], values: [] }); });
    function pickName(c, others, suf) { return others.indexOf(c) !== -1 ? c + suf : c; }
    function pushRow(li, ri) {
      lk.forEach(function (c, k) { outCols[k].values.push(li != null ? self._data[c][li] : (ri != null ? other._data[rk[k]][ri] : null)); });
      lCols.forEach(function (c, oi) { outCols[lk.length + oi].values.push(li != null ? self._data[c][li] : null); });
      rCols.forEach(function (c, oi) { outCols[lk.length + lCols.length + oi].values.push(ri != null ? other._data[c][ri] : null); });
    }
    var usedRight = new Set();
    for (var i = 0; i < this.nrows; i++) {
      var key = lk.map(function (c) { return valKey(self._data[c][i]); }).join('\u0001');
      var matches = rightIndex.get(key);
      if (matches && matches.length) { matches.forEach(function (ri) { usedRight.add(ri); pushRow(i, ri); }); }
      else if (how === 'left' || how === 'outer') pushRow(i, null);
    }
    if (how === 'right' || how === 'outer') {
      for (var r = 0; r < other.nrows; r++) if (!usedRight.has(r)) pushRow(null, r);
    }
    return new DataFrame(outCols);
  };

  DataFrame.prototype.info = function () {
    var d = this._types, self = this;
    return this._cols.map(function (c) {
      var arr = self._data[c], nulls = 0, uniq = new Set();
      for (var i = 0; i < arr.length; i++) { if (isNullish(arr[i])) nulls++; else uniq.add(String(arr[i])); }
      return { column: c, dtype: d[c], nonNull: arr.length - nulls, nulls: nulls, unique: uniq.size, memory: arr.length * 8 };
    });
  };
  DataFrame.prototype.memoryUsage = function () {
    var bytes = 0, self = this;
    this._cols.forEach(function (c) {
      var arr = self._data[c];
      arr.forEach(function (v) { bytes += typeof v === 'number' ? 8 : (typeof v === 'string' ? v.length * 2 + 16 : 8); });
    });
    return bytes;
  };

  DataFrame.prototype.describe = function (percentiles) {
    percentiles = percentiles || [0.25, 0.5, 0.75];
    var cols = this.numericColumns(), self = this, S_ = S;
    var labels = ['count', 'mean', 'std', 'min'].concat(percentiles.map(function (p) { return pctLabel(p); })).concat(['max']);
    var out = [{ name: 'stat', dtype: 'object', values: labels.slice() }];
    cols.forEach(function (c) {
      var a = S_.clean(self._data[c]);
      out.push({
        name: c, dtype: 'float64', values: [
          a.length, a.length ? S_.mean(a) : null, a.length > 1 ? S_.std(a, 1) : null, a.length ? S_.min(a) : null
        ].concat(percentiles.map(function (p) { return a.length ? S_.quantile(S_.sortedCopy(a), p) : null; })).concat([a.length ? S_.max(a) : null])
      });
    });
    return new DataFrame(out);
  };

  DataFrame.prototype.toRecords = function (limit) {
    var n = limit === undefined ? this.nrows : Math.min(limit, this.nrows), out = [];
    for (var i = 0; i < n; i++) {
      var r = {};
      for (var k = 0; k < this._cols.length; k++) { var v = this._data[this._cols[k]][i]; r[this._cols[k]] = isNullish(v) ? null : v; }
      out.push(r);
    }
    return out;
  };
  DataFrame.prototype.toCSV = function () {
    var esc = function (v) {
      if (isNullish(v)) return '';
      var s = String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    var lines = [this._cols.map(esc).join(',')];
    for (var i = 0; i < this.nrows; i++) {
      var row = [];
      for (var k = 0; k < this._cols.length; k++) row.push(esc(this._data[this._cols[k]][i]));
      lines.push(row.join(','));
    }
    return lines.join('\n');
  };

  function pctLabel(p) { return Math.round(p * 100) + '%'; }
  function valKey(v) { return isNullish(v) ? '\u0000∅' : (typeof v === 'number' ? 'n' + v : 's' + String(v)); }
  function castValue(v, dtype) {
    if (isNullish(v)) return null;
    if (dtype === 'float64' || dtype === 'int64') { var n = Number(v); if (isNaN(n)) return null; return dtype === 'int64' ? Math.trunc(n) : n; }
    if (dtype === 'bool') return (v === true || valKey(v) === 's' + 'true' || String(v) === '1' || String(v).toLowerCase() === 'true');
    if (dtype === 'object') return String(v);
    return v;
  }

  // deterministic PRNG for reproducible sampling
  function mulberry(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- readers ---------- */

  function parseCSV(text, opts) {
    opts = opts || {};
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM
    var delim = opts.delimiter;
    if (!delim) {
      var firstLine = text.split(/\r?\n/)[0] || '';
      var counts = [[',', (firstLine.match(/,/g) || []).length], [';', (firstLine.match(/;/g) || []).length], ['\t', (firstLine.match(/\t/g) || []).length], ['|', (firstLine.match(/\|/g) || []).length]];
      counts.sort(function (a, b) { return b[1] - a[1]; });
      delim = counts[0][1] > 0 ? counts[0][0] : ',';
    }
    var rows = [], cur = [], field = '', inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
        } else field += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === delim) { cur.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        cur.push(field); rows.push(cur); cur = []; field = '';
      } else field += ch;
    }
    if (field !== '' || cur.length) { cur.push(field); rows.push(cur); }
    rows = rows.filter(function (r) { return r.length && !(r.length === 1 && r[0].trim() === ''); });
    if (!rows.length) return new DataFrame([]);
    var header = opts.header === false ? rows[0].map(function (_, i) { return 'col_' + (i + 1); }) : rows.shift();
    var nCol = Math.max.apply(null, rows.map(function (r) { return r.length; }));
    var cols = [];
    for (var c = 0; c < nCol; c++) {
      var name = (header[c] === undefined || header[c] === '') ? 'col_' + (c + 1) : header[c].trim();
      cols.push({ name: uniqueName(name, cols.map(function (o) { return o.name; })), values: [] });
    }
    rows.forEach(function (r) {
      for (var c2 = 0; c2 < nCol; c2++) cols[c2].values.push(parseValue(r[c2]));
    });
    cols.forEach(function (o) { o.dtype = inferType(o.values); });
    return new DataFrame(cols);
  }

  function uniqueName(name, used) {
    if (used.indexOf(name) === -1) return name;
    var i = 2; while (used.indexOf(name + '_' + i) !== -1) i++;
    return name + '_' + i;
  }

  function readJSON(text) {
    var obj = typeof text === 'string' ? JSON.parse(text) : text;
    if (Array.isArray(obj)) return DataFrame.fromRecords(obj);
    if (obj && typeof obj === 'object') {
      if (Array.isArray(obj.data)) return DataFrame.fromRecords(obj.data);
      if (Array.isArray(obj.records)) return DataFrame.fromRecords(obj.records);
      if (Array.isArray(obj.rows)) {
        var cols = obj.columns || null;
        var recs = obj.rows.map(function (r) {
          if (Array.isArray(r)) { var o = {}; (cols || r.map(function (_, i) { return 'col_' + (i + 1); })).forEach(function (c, i) { o[c] = r[i]; }); return o; }
          return r;
        });
        return DataFrame.fromRecords(recs);
      }
      // columnar object
      var names = Object.keys(obj).filter(function (k) { return Array.isArray(obj[k]); });
      if (names.length) return new DataFrame(names.map(function (n) { return { name: n, values: obj[n].map(parseValue) }; }));
    }
    throw new Error('Unsupported JSON structure');
  }

  DataFrame.fromRecords = function (records, columns) {
    records = records || [];
    var names = columns && columns.length ? columns.slice() : [];
    if (!names.length) {
      records.forEach(function (r) { if (r && typeof r === 'object') Object.keys(r).forEach(function (k) { if (names.indexOf(k) === -1) names.push(k); }); });
    }
    var cols = names.map(function (n) {
      return {
        name: n,
        values: records.map(function (r) { return (r && typeof r === 'object') ? (r[n] === undefined ? null : r[n]) : null; })
      };
    });
    cols.forEach(function (o) { o.values = o.values.map(function (v) { return isNullish(v) ? null : v; }); o.dtype = inferType(o.values); });
    return new DataFrame(cols);
  };

  global.DF = {
    DataFrame: DataFrame,
    parseCSV: parseCSV,
    readJSON: readJSON,
    parseValue: parseValue,
    inferType: inferType,
    isNumericDtype: isNumericDtype,
    isNullish: isNullish,
    AGG: AGG,
    AGG_LIST: AGG_LIST
  };
})(window);
