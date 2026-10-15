/* i18n.js — bilingual (zh / en) string table. Every visible label flows through t(). */
(function (global) {
  'use strict';

  var I18N = {
    /* ---- general ---- */
    'app.title': { zh: 'DataFrame Studio', en: 'DataFrame Studio' },
    'app.tagline': { zh: '可视化 pandas 数据分析工作台', en: 'A visual workbench for pandas-style data analysis' },
    'app.subtitle': { zh: '像 pandas 一样加载、清洗、分组与分析数据 —— 全部通过图形与交互完成。', en: 'Load, clean, group and analyse data the pandas way — done entirely through graphics and interaction.' },
    'header.dataset': { zh: '当前数据集', en: 'Dataset' },
    'header.steps': { zh: '步骤', en: 'steps' },
    'theme.toggle': { zh: '切换明 / 暗主题', en: 'Toggle light / dark' },
    'action.reset': { zh: '重置全部', en: 'Reset all' },
    'action.clear': { zh: '清空流水线', en: 'Clear pipeline' },
    'action.add': { zh: '加入流水线', en: 'Add to pipeline' },
    'action.apply': { zh: '应用', en: 'Apply' },
    'action.remove': { zh: '删除', en: 'Remove' },
    'action.download': { zh: '下载', en: 'Download' },
    'action.copy': { zh: '复制', en: 'Copy' },
    'action.copied': { zh: '已复制到剪贴板', en: 'Copied to clipboard' },
    'action.load': { zh: '载入', en: 'Load' },
    'action.close': { zh: '关闭', en: 'Close' },
    'common.column': { zh: '列', en: 'Column' },
    'common.columns': { zh: '列', en: 'Columns' },
    'common.value': { zh: '值', en: 'Value' },
    'common.none': { zh: '无', en: 'None' },
    'common.na': { zh: '缺失', en: 'missing' },
    'common.all': { zh: '全部', en: 'All' },
    'common.running': { zh: '计算中…', en: 'Computing…' },
    'status.rows': { zh: '行', en: 'rows' },
    'status.cols': { zh: '列', en: 'cols' },
    'status.memory': { zh: '内存', en: 'memory' },
    'status.nulls': { zh: '缺失单元', en: 'null cells' },
    'status.hint': { zh: '提示：先在左侧添加“转换”操作，再进入“分析”板块。', en: 'Tip: add a Transform step on the left, then open the Analyse modules.' },

    /* ---- nav ---- */
    'nav.group.data': { zh: '数据', en: 'Data' },
    'nav.group.transform': { zh: '转换', en: 'Transform' },
    'nav.group.analyze': { zh: '分析', en: 'Analyse' },
    'nav.group.io': { zh: '输入 / 输出', en: 'Import / Export' },
    'nav.source': { zh: '数据源', en: 'Data source' },
    'nav.table': { zh: '数据表', en: 'Table' },
    'nav.select': { zh: '选择列', en: 'Select columns' },
    'nav.filter': { zh: '筛选', en: 'Filter rows' },
    'nav.sort': { zh: '排序', en: 'Sort' },
    'nav.missing': { zh: '缺失值', en: 'Missing values' },
    'nav.duplicates': { zh: '去重', en: 'De-duplicate' },
    'nav.assign': { zh: '计算列', en: 'Compute column' },
    'nav.columns': { zh: '列操作', en: 'Column ops' },
    'nav.pivot': { zh: '透视表', en: 'Pivot table' },
    'nav.overview': { zh: '概览', en: 'Overview' },
    'nav.describe': { zh: '描述统计', en: 'Describe' },
    'nav.corr': { zh: '相关性', en: 'Correlation' },
    'nav.charts': { zh: '图表工坊', en: 'Chart studio' },
    'nav.export': { zh: '导出', en: 'Export' },

    'pipeline.title': { zh: '操作流水线', en: 'Pipeline' },
    'pipeline.empty': { zh: '暂无操作 · 当前显示原始数据', en: 'No steps yet · showing the raw data' },
    'pipeline.desc': { zh: '每一步都等价于一行 pandas 代码，点击可移除。', en: 'Each chip equals one line of pandas code. Click to remove.' },
    'pipeline.base': { zh: '原始数据', en: 'raw' },

    /* ---- source ---- */
    'source.title': { zh: '数据源', en: 'Data source' },
    'source.desc': { zh: '拖入文件、粘贴文本或输入网址即可载入 CSV / JSON，也可以直接使用内置示例数据。', en: 'Drop a file, paste text or fetch a URL to load CSV / JSON — or start from a built-in sample.' },
    'source.drop.title': { zh: '把数据文件拖到这里', en: 'Drop a data file here' },
    'source.drop.hint': { zh: '支持 .csv / .tsv / .txt / .json，或点击选择文件', en: '.csv / .tsv / .txt / .json — or click to browse' },
    'source.paste.title': { zh: '粘贴文本', en: 'Paste text' },
    'source.paste.ph': { zh: '在此粘贴 CSV 或 JSON 文本…', en: 'Paste CSV or JSON text here…' },
    'source.url.title': { zh: '从网址加载', en: 'Load from URL' },
    'source.url.ph': { zh: 'https://example.com/data.csv', en: 'https://example.com/data.csv' },
    'source.samples': { zh: '内置示例数据集', en: 'Built-in sample datasets' },
    'source.loading': { zh: '正在载入…', en: 'Loading…' },
    'source.err.parse': { zh: '解析失败，请检查数据格式。', en: 'Could not parse the data — please check the format.' },
    'source.err.fetch': { zh: '网络请求失败（可能受浏览器跨域限制）。', en: 'Network request failed (possibly blocked by browser CORS policy).' },
    'source.err.empty': { zh: '没有解析到任何行。', en: 'No rows were parsed.' },
    'source.info': { zh: '数据结构', en: 'Structure' },
    'source.kpi.rows': { zh: '数据行', en: 'Rows' },
    'source.kpi.cols': { zh: '字段列', en: 'Columns' },
    'source.kpi.memory': { zh: '估算内存', en: 'Est. memory' },
    'source.kpi.missing': { zh: '缺失单元', en: 'Null cells' },
    'source.preface': { zh: '预览（前 8 行）', en: 'Preview (first 8 rows)' },
    'source.dtypeMap': { zh: '列类型', en: 'Column types' },

    /* ---- table ---- */
    'table.title': { zh: '数据表', en: 'Table' },
    'table.desc': { zh: '当前流水线结果的表格视图；点击列头可查看该列的统计与分布。', en: 'Tabular view of the current pipeline result; click a header to inspect its statistics and distribution.' },
    'table.perPage': { zh: '每页行数', en: 'Rows / page' },
    'table.first': { zh: '首页', en: 'First' },
    'table.prev': { zh: '上一页', en: 'Prev' },
    'table.next': { zh: '下一页', en: 'Next' },
    'table.last': { zh: '末页', en: 'Last' },
    'table.page': { zh: '第 {a} / {b} 页', en: 'Page {a} of {b}' },
    'table.showing': { zh: '共 {n} 行', en: '{n} rows' },
    'table.columns': { zh: '列显示', en: 'Columns' },
    'table.index': { zh: '索引', en: 'index' },
    'table.null': { zh: 'NaN', en: 'NaN' },
    'table.truncated': { zh: '单元格内容较长，已折叠显示。', en: 'Long cell values are truncated.' },
    'table.sortHint': { zh: '点击列标题查看该列统计', en: 'Click a column header for its statistics' },
    'table.rowDensity': { zh: '紧凑显示', en: 'Compact rows' },

    /* ---- select columns ---- */
    'select.title': { zh: '选择列', en: 'Select columns' },
    'select.desc': { zh: '保留勾选的列，等价于 df[["a", "b", …]]。', en: 'Keep the ticked columns — equivalent to df[["a", "b", …]].' },
    'select.all': { zh: '全选', en: 'Select all' },
    'select.none': { zh: '全不选', en: 'Select none' },
    'select.invert': { zh: '反选', en: 'Invert' },
    'select.empty': { zh: '请至少选择一列。', en: 'Please select at least one column.' },

    /* ---- filter ---- */
    'filter.title': { zh: '筛选行', en: 'Filter rows' },
    'filter.desc': { zh: '用条件构造器生成布尔掩码，等价于 df[df[...]] 或 df.query(...)。', en: 'Build a boolean mask — equivalent to df[df[...]] or df.query(...).' },
    'filter.combine': { zh: '条件之间', en: 'Combine with' },
    'filter.and': { zh: '同时满足 AND', en: 'AND' },
    'filter.or': { zh: '满足其一 OR', en: 'OR' },
    'filter.add': { zh: '添加条件', en: 'Add condition' },
    'filter.remove': { zh: '移除', en: 'Remove' },
    'filter.value2': { zh: '到', en: 'to' },
    'filter.preview': { zh: '实时预览', en: 'Live preview' },
    'filter.matched': { zh: '{n} 行满足条件', en: '{n} rows match' },
    'filter.pickColumn': { zh: '请先选择列。', en: 'Please pick a column first.' },
    'filter.pickValue': { zh: '请输入比较值。', en: 'Please enter a value.' },
    'filter.op.eq': { zh: '等于 =', en: 'equals =' },
    'filter.op.ne': { zh: '不等于 ≠', en: 'not equal ≠' },
    'filter.op.gt': { zh: '大于 >', en: 'greater >' },
    'filter.op.ge': { zh: '大于等于 ≥', en: '≥' },
    'filter.op.lt': { zh: '小于 <', en: 'less <' },
    'filter.op.le': { zh: '小于等于 ≤', en: '≤' },
    'filter.op.contains': { zh: '包含', en: 'contains' },
    'filter.op.starts': { zh: '以…开头', en: 'starts with' },
    'filter.op.ends': { zh: '以…结尾', en: 'ends with' },
    'filter.op.in': { zh: '属于任一', en: 'in list' },
    'filter.op.isna': { zh: '缺失', en: 'is NaN' },
    'filter.op.notna': { zh: '非缺失', en: 'not NaN' },
    'filter.op.between': { zh: '介于区间', en: 'between' },
    'filter.valuePh': { zh: '值（用逗号分隔多个）', en: 'value (comma-separated list allowed)' },

    /* ---- sort ---- */
    'sort.title': { zh: '排序', en: 'Sort' },
    'sort.desc': { zh: '按多列排序，等价于 df.sort_values(by=[…], ascending=[…])。', en: 'Multi-key sort — equivalent to df.sort_values(by=[…], ascending=[…]).' },
    'sort.add': { zh: '添加排序键', en: 'Add sort key' },
    'sort.ascending': { zh: '升序 ↑', en: 'ascending ↑' },
    'sort.descending': { zh: '降序 ↓', en: 'descending ↓' },

    /* ---- missing ---- */
    'missing.title': { zh: '缺失值处理', en: 'Missing values' },
    'missing.desc': { zh: '检测并处理缺失：dropna() 删除或 fillna() 填充。', en: 'Detect and handle gaps: dropna() to remove, fillna() to fill.' },
    'missing.subset': { zh: '作用列', en: 'Columns' },
    'missing.action': { zh: '处理方式', en: 'Action' },
    'missing.action.drop': { zh: '删除缺失行 dropna', en: 'Drop rows (dropna)' },
    'missing.action.fill': { zh: '填充缺失 fillna', en: 'Fill values (fillna)' },
    'missing.how': { zh: '删除条件', en: 'Drop rule' },
    'missing.how.any': { zh: '任一列为空即删除', en: 'drop if any selected column is null' },
    'missing.how.all': { zh: '全部列为空才删除', en: 'drop only if all are null' },
    'missing.thresh': { zh: '至少保留非空列数', en: 'keep rows with ≥ non-null' },
    'missing.method': { zh: '填充方法', en: 'Fill method' },
    'missing.method.value': { zh: '固定值', en: 'constant' },
    'missing.method.mean': { zh: '均值 mean', en: 'mean' },
    'missing.method.median': { zh: '中位数 median', en: 'median' },
    'missing.method.mode': { zh: '众数 mode', en: 'mode' },
    'missing.method.ffill': { zh: '向后填充 ffill', en: 'forward-fill' },
    'missing.method.bfill': { zh: '向前填充 bfill', en: 'back-fill' },
    'missing.method.zero': { zh: '零值 0', en: 'zero' },
    'missing.value': { zh: '填充值', en: 'Constant value' },
    'missing.before': { zh: '处理前', en: 'Before' },
    'missing.after': { zh: '处理后', en: 'After' },
    'missing.noMissing': { zh: '当前数据没有缺失值。', en: 'No missing values in the current data.' },

    /* ---- duplicates ---- */
    'duplicates.title': { zh: '去重', en: 'De-duplicate' },
    'duplicates.desc': { zh: '按选定列判定重复行，等价于 df.drop_duplicates(subset=…, keep=…)。', en: 'Detect and drop repeated rows — df.drop_duplicates(subset=…, keep=…).' },
    'duplicates.subset': { zh: '判定列', en: 'Key columns' },
    'duplicates.keep': { zh: '保留策略', en: 'Keep' },
    'duplicates.keep.first': { zh: '保留首次出现', en: 'first occurrence' },
    'duplicates.keep.last': { zh: '保留最后出现', en: 'last occurrence' },
    'duplicates.keep.false': { zh: '全部删除', en: 'drop all duplicates' },
    'duplicates.found': { zh: '检测到 {n} 行重复', en: '{n} duplicate rows detected' },

    /* ---- assign ---- */
    'assign.title': { zh: '计算列', en: 'Compute a column' },
    'assign.desc': { zh: '新增一列，值由表达式计算，等价于 df["new"] = …。可直接引用列名（列名含空格请用 row["名 字"]）。', en: 'Add a column from an expression — df["new"] = … . Reference columns by name (use row["name"] when a name contains spaces).' },
    'assign.name': { zh: '新列名', en: 'New column name' },
    'assign.expr': { zh: '表达式', en: 'Expression' },
    'assign.hint': { zh: '示例：row["营收"] * 100 / row["数量"]　·　Math.round(row["利润"])　·　row["单价"] * 2', en: 'e.g. revenue * 100 / quantity · Math.round(profit) · row["unit price"] * 2' },
    'assign.err': { zh: '表达式无法计算：{msg}', en: 'Expression failed: {msg}' },
    'assign.exists': { zh: '列名已存在，将被覆盖。', en: 'Column already exists and will be overwritten.' },

    /* ---- column ops ---- */
    'columns.title': { zh: '列操作', en: 'Column operations' },
    'columns.desc': { zh: '重命名 rename、删除 drop、类型转换 astype。', en: 'Rename, drop and cast columns — rename / drop / astype.' },
    'columns.rename': { zh: '重命名', en: 'Rename' },
    'columns.dropTab': { zh: '删除列', en: 'Drop columns' },
    'columns.cast': { zh: '类型转换', en: 'Cast dtype' },
    'columns.newName': { zh: '新名称', en: 'New name' },
    'columns.toDtype': { zh: '目标类型', en: 'Target dtype' },
    'columns.keepNote': { zh: '结果会直接写入流水线（可作为后续步骤的输入）。', en: 'Applied directly into the pipeline for downstream steps.' },

    /* ---- pivot ---- */
    'pivot.title': { zh: '透视表', en: 'Pivot table' },
    'pivot.desc': { zh: '把行转为列并聚合，等价于 pd.pivot_table(index, columns, values, aggfunc)。', en: 'Turn rows into columns and aggregate — pd.pivot_table(index, columns, values, aggfunc).' },
    'pivot.index': { zh: '行索引 index', en: 'Rows (index)' },
    'pivot.columns': { zh: '列字段 columns', en: 'Columns field' },
    'pivot.values': { zh: '数值字段 values', en: 'Values field' },
    'pivot.aggfunc': { zh: '聚合函数 aggfunc', en: 'aggfunc' },
    'pivot.heatmapTitle': { zh: '透视热力图', en: 'Pivot heatmap' },
    'pivot.tableTitle': { zh: '透视表', en: 'Pivot table' },
    'pivot.needNumeric': { zh: '请选择数值列作为 values（「计数」可用于任意列）。', en: 'Please choose a numeric column for values (count works on any column).' },

    /* ---- overview ---- */
    'overview.title': { zh: '数据概览', en: 'Overview' },
    'overview.desc': { zh: '一屏掌握数据规模、类型分布与缺失情况。', en: 'Understand size, type distribution and missingness at a glance.' },
    'overview.kpi.rows': { zh: '行数', en: 'Rows' },
    'overview.kpi.cols': { zh: '列数', en: 'Columns' },
    'overview.kpi.numeric': { zh: '数值列', en: 'Numeric' },
    'overview.kpi.category': { zh: '类别列', en: 'Categorical' },
    'overview.kpi.missing': { zh: '缺失单元', en: 'Missing cells' },
    'overview.kpi.memory': { zh: '估算内存', en: 'Est. memory' },
    'overview.dtypeChart': { zh: '列类型分布', en: 'Column type distribution' },
    'overview.missingChart': { zh: '各列缺失数量', en: 'Missing values by column' },
    'overview.numericProfile': { zh: '数值列画像', en: 'Numeric column profiles' },
    'overview.catProfile': { zh: '类别列概览', en: 'Categorical columns' },
    'overview.completeness': { zh: '完整度', en: 'completeness' },
    'overview.missingFree': { zh: '无缺失，数据完整度 100%。', en: 'No missing values — 100% complete.' },

    /* ---- describe ---- */
    'describe.title': { zh: '描述统计', en: 'Descriptive statistics' },
    'describe.desc': { zh: 'df.describe() 汇总、单列分布剖析与分类列频数统计。', en: 'df.describe() summary, a single-column distribution profiler, and value counts for categorical columns.' },
    'describe.table': { zh: 'describe() 汇总表', en: 'describe() summary' },
    'describe.statLabel': { zh: '统计量', en: 'stat' },
    'describe.column': { zh: '剖析列', en: 'Profile column' },
    'describe.hist': { zh: '直方图 + 核密度', en: 'Histogram + KDE' },
    'describe.box': { zh: '箱线图', en: 'Box plot' },
    'describe.cdf': { zh: '累积分布', en: 'Cumulative distribution' },
    'describe.stats': { zh: '统计指标', en: 'Statistics' },
    'describe.noneNumeric': { zh: '当前数据没有数值列。', en: 'No numeric columns in the current data.' },
    'describe.outliers': { zh: '离群点', en: 'Outliers' },
    'describe.iqr': { zh: '四分位距 IQR', en: 'IQR' },
    'describe.nulls': { zh: '缺失', en: 'Missing' },
    'describe.st.nonNull': { zh: '非空数', en: 'count' },
    'describe.st.mean': { zh: '均值', en: 'mean' },
    'describe.st.std': { zh: '标准差', en: 'std' },
    'describe.st.min': { zh: '最小值', en: 'min' },
    'describe.st.q25': { zh: '25% 分位', en: '25%' },
    'describe.st.median': { zh: '中位数', en: '50%' },
    'describe.st.q75': { zh: '75% 分位', en: '75%' },
    'describe.st.max': { zh: '最大值', en: 'max' },
    'describe.st.skew': { zh: '偏度', en: 'skew' },
    'describe.st.sum': { zh: '求和', en: 'sum' },

    /* ---- counts ---- */
    'counts.title': { zh: '频数统计', en: 'Value counts' },
    'counts.column': { zh: '统计列', en: 'Column' },
    'counts.normalize': { zh: '显示占比', en: 'Show share' },
    'counts.top': { zh: '显示前 N 项', en: 'Top N' },
    'counts.chart': { zh: '频数分布', en: 'Frequency distribution' },
    'counts.value': { zh: '取值', en: 'Value' },
    'counts.count': { zh: '频数', en: 'Count' },
    'counts.share': { zh: '占比', en: 'Share' },
    'counts.unique': { zh: '不同取值 {n} 个', en: '{n} distinct values' },

    /* ---- correlation ---- */
    'corr.title': { zh: '相关性分析', en: 'Correlation analysis' },
    'corr.desc': { zh: '计算数值列之间的相关系数矩阵，并探索任意两列的散点关系。', en: 'Compute the correlation matrix across numeric columns and explore any pair as a scatter plot.' },
    'corr.method': { zh: '相关系数', en: 'Method' },
    'corr.pearson': { zh: '皮尔逊 Pearson', en: 'Pearson' },
    'corr.spearman': { zh: '斯皮尔曼 Spearman', en: 'Spearman' },
    'corr.heatmap': { zh: '相关系数热力图', en: 'Correlation heatmap' },
    'corr.scatter': { zh: '成对散点图', en: 'Pairwise scatter' },
    'corr.x': { zh: 'X 轴', en: 'X axis' },
    'corr.y': { zh: 'Y 轴', en: 'Y axis' },
    'corr.color': { zh: '着色列（可选）', en: 'Colour by (optional)' },
    'corr.matrixTable': { zh: '相关系数表', en: 'Coefficient table' },
    'corr.need2': { zh: '至少需要 2 个数值列才能计算相关性。', en: 'At least two numeric columns are required.' },
    'corr.r': { zh: '相关系数 r', en: 'r' },

    /* ---- charts ---- */
    'charts.title': { zh: '图表工坊', en: 'Chart studio' },
    'charts.desc': { zh: '把任意列组合成图表：柱状、折线、面积、箱线、直方图，并可按类别分组。', en: 'Compose any columns into a chart — bar, line, area, box, histogram — optionally split by a category.' },
    'charts.type': { zh: '图表类型', en: 'Chart type' },
    'charts.type.bar': { zh: '柱状图', en: 'Bar' },
    'charts.type.line': { zh: '折线图', en: 'Line' },
    'charts.type.area': { zh: '面积图', en: 'Area' },
    'charts.type.box': { zh: '箱线图', en: 'Box' },
    'charts.type.histogram': { zh: '直方图', en: 'Histogram' },
    'charts.x': { zh: 'X 轴 / 类别', en: 'X / category' },
    'charts.y': { zh: 'Y 轴 / 数值', en: 'Y / value' },
    'charts.agg': { zh: 'Y 聚合方式', en: 'Y aggregation' },
    'charts.group': { zh: '按列分组（可选）', en: 'Split by (optional)' },
    'charts.topN': { zh: '最多显示类别数', en: 'Max categories' },
    'charts.sort': { zh: '排序', en: 'Order' },
    'charts.sort.auto': { zh: '默认', en: 'Default' },
    'charts.sort.desc': { zh: '数值降序', en: 'Value ↓' },
    'charts.sort.asc': { zh: '数值升序', en: 'Value ↑' },
    'charts.needXY': { zh: '请选择 X 与 Y 列。', en: 'Please choose X and Y columns.' },
    'charts.preview': { zh: '图表预览', en: 'Chart preview' },

    /* ---- chart-internal axis / series labels ---- */
    'chart.count': { zh: '计数', en: 'count' },
    'chart.share': { zh: '占比', en: 'share' },
    'chart.density': { zh: '密度', en: 'density' },
    'chart.kde': { zh: '核密度曲线', en: 'KDE' },
    'chart.missing': { zh: '缺失数', en: 'missing' },
    'chart.unique': { zh: '不同取值', en: 'unique' },

    /* ---- aggregation function labels ---- */
    'agg.sum': { zh: '求和', en: 'sum' },
    'agg.mean': { zh: '均值', en: 'mean' },
    'agg.median': { zh: '中位数', en: 'median' },
    'agg.count': { zh: '计数', en: 'count' },
    'agg.min': { zh: '最小值', en: 'min' },
    'agg.max': { zh: '最大值', en: 'max' },
    'agg.std': { zh: '标准差', en: 'std' },
    'agg.nunique': { zh: '去重计数', en: 'nunique' },

    /* ---- column dtypes ---- */
    'dtype.int64': { zh: '整数', en: 'int' },
    'dtype.float64': { zh: '浮点', en: 'float' },
    'dtype.object': { zh: '文本', en: 'object' },
    'dtype.bool': { zh: '布尔', en: 'bool' },
    'dtype.datetime64': { zh: '日期', en: 'datetime' },
    'dtype.null': { zh: '空', en: 'null' },

    /* ---- boolean cell values ---- */
    'bool.true': { zh: '是', en: 'true' },
    'bool.false': { zh: '否', en: 'false' },

    /* ---- export ---- */
    'export.title': { zh: '导出结果', en: 'Export results' },
    'export.desc': { zh: '把当前流水线的最终结果保存或复制出去。', en: 'Save or copy the final result of the current pipeline.' },
    'export.csv': { zh: '下载 CSV', en: 'Download CSV' },
    'export.json': { zh: '下载 JSON', en: 'Download JSON' },
    'export.clipboard': { zh: '复制为表格文本', en: 'Copy as TSV' },
    'export.pipelineCaption': { zh: '对应 pandas 代码', en: 'Equivalent pandas code' },
    'export.note': { zh: '导出的数据已应用全部 {n} 个流水线步骤。', en: 'Exported data has all {n} pipeline steps applied.' },

    /* ---- ops labels (pipeline chips) ---- */
    'op.select': { zh: '选择列', en: 'select columns' },
    'op.filter': { zh: '筛选', en: 'filter' },
    'op.sort': { zh: '排序', en: 'sort' },
    'op.missing': { zh: '缺失值', en: 'missing' },
    'op.duplicates': { zh: '去重', en: 'drop duplicates' },
    'op.assign': { zh: '计算列', en: 'assign' },
    'op.columns': { zh: '列操作', en: 'column ops' },
    'op.pivot': { zh: '透视表', en: 'pivot' }
  };

  var lang = localStorage.getItem('dfstudio.lang') || 'zh';

  function t(key, params) {
    var e = I18N[key];
    var s = e ? (e[lang] !== undefined ? e[lang] : e.zh) : key;
    if (params) {
      s = s.replace(/\{(\w+)\}/g, function (m, k) { return params[k] !== undefined ? params[k] : m; });
    }
    return s;
  }

  function setLang(l) { lang = l; try { localStorage.setItem('dfstudio.lang', l); } catch (e) { } }
  function getLang() { return lang; }

  global.I18N = I18N;
  global.t = t;
  global.setLang = setLang;
  global.getLang = getLang;
})(window);
