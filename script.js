/* ================================================
 *  人工智能 · 新质生产力可视化网站 - 交互脚本
 * ================================================ */

// 全局配色
const COLORS = {
    primary: '#6366f1',
    secondary: '#14b8a6',
    accent: '#f59e0b',
    danger: '#ef4444',
    success: '#10b981',
    text: '#1a1a2e',
    textSub: '#64748b',
    border: '#e8edf2'
};

/* ========== 1. 粒子背景 ========== */
function initParticles() {
    const canvas = document.getElementById('particleCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let particles = [];
    let mouse = { x: -1000, y: -1000 };

    function resize() {
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    // 创建粒子
    const count = Math.min(120, Math.floor(canvas.width / 12));
    for (let i = 0; i < count; i++) {
        particles.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            vx: (Math.random() - 0.5) * 0.4,
            vy: (Math.random() - 0.5) * 0.4,
            r: Math.random() * 2 + 0.5,
            color: ['#6366f1', '#14b8a6', '#f59e0b', '#f87171'][Math.floor(Math.random() * 4)]
        });
    }

    canvas.addEventListener('mousemove', e => {
        const rect = canvas.getBoundingClientRect();
        mouse.x = e.clientX - rect.left;
        mouse.y = e.clientY - rect.top;
    });
    canvas.addEventListener('mouseleave', () => { mouse.x = -1000; mouse.y = -1000; });

    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particles.forEach((p, i) => {
            p.x += p.vx;
            p.y += p.vy;
            if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
            if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

            // 鼠标引力
            const dx = mouse.x - p.x;
            const dy = mouse.y - p.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 150) {
                const force = (150 - dist) / 150;
                p.x += dx * force * 0.02;
                p.y += dy * force * 0.02;
            }

            // 绘制粒子
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.globalAlpha = 0.7;
            ctx.fill();

            // 连线
            for (let j = i + 1; j < particles.length; j++) {
                const p2 = particles[j];
                const ddx = p.x - p2.x;
                const ddy = p.y - p2.y;
                const d = Math.sqrt(ddx * ddx + ddy * ddy);
                if (d < 110) {
                    ctx.beginPath();
                    ctx.moveTo(p.x, p.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.strokeStyle = p.color;
                    ctx.globalAlpha = (1 - d / 110) * 0.25;
                    ctx.lineWidth = 0.6;
                    ctx.stroke();
                }
            }
        });
        ctx.globalAlpha = 1;
        requestAnimationFrame(animate);
    }
    animate();
}

/* ========== 2. 数字滚动 ========== */
function animateCounter(el, target, duration = 2000) {
    const suffix = el.dataset.suffix || '';
    const start = 0;
    const startTime = performance.now();

    function update(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // easeOutExpo
        const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
        const value = Math.floor(start + (target - start) * eased);
        el.textContent = value.toLocaleString() + suffix;
        if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
}

function initCounters() {
    const counters = document.querySelectorAll('[data-target]');

    function fire(el) {
        if (el.dataset.animated) return;
        el.dataset.animated = '1';
        animateCounter(el, parseInt(el.dataset.target));
    }
    function inView(el) {
        const rect = el.getBoundingClientRect();
        return rect.top < window.innerHeight + 200 && rect.bottom > -100;
    }
    // 滚动兜底：任何时刻只要进入视口(含下方200px缓冲)即触发
    function check() {
        counters.forEach(el => { if (!el.dataset.animated && inView(el)) fire(el); });
    }
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    setInterval(check, 1200); // 最终兜底

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                fire(entry.target);
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.05, rootMargin: '0px 0px 200px 0px' });
    counters.forEach(c => observer.observe(c));
    setTimeout(check, 800);
}

/* ========== 3. 导航栏 ========== */
function initNavbar() {
    const navbar = document.getElementById('navbar');
    const progressBar = document.getElementById('navProgressBar');
    const links = document.querySelectorAll('.nav-links a');
    const sections = document.querySelectorAll('section[id]');

    window.addEventListener('scroll', () => {
        // 滚动样式
        navbar.classList.toggle('scrolled', window.scrollY > 50);

        // 进度条
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        const progress = (window.scrollY / docHeight) * 100;
        progressBar.style.width = progress + '%';

        // 当前段
        let current = 'hero';
        sections.forEach(sec => {
            const top = sec.offsetTop - 100;
            if (window.scrollY >= top) current = sec.id;
        });
        links.forEach(l => {
            l.classList.toggle('active', l.getAttribute('href') === '#' + current);
        });
    });
}

/* ========== 4. 市场规模图 ========== */
let marketChart;
const marketData = {
    global: {
        years: ['2015', '2017', '2019', '2021', '2023', '2025', '2027', '2029', '2030'],
        values: [50, 150, 350, 800, 2000, 4500, 7800, 11000, 13000],
        name: '全球AI市场规模',
        unit: '亿美元'
    },
    china: {
        years: ['2015', '2017', '2019', '2021', '2023', '2025', '2027', '2029', '2030'],
        values: [10, 31, 71, 153, 264, 486, 833, 1319, 1528],
        name: '中国AI市场规模',
        unit: '亿美元'
    },
    investment: {
        years: ['2015', '2017', '2019', '2021', '2023', '2025', '2027', '2029', '2030'],
        values: [80, 180, 350, 700, 1400, 2600, 4500, 7500, 9500],
        name: '全球AI投资规模',
        unit: '亿美元'
    }
};

function initMarketChart() {
    const dom = document.getElementById('marketChart');
    if (!dom) return;
    marketChart = echarts.init(dom);
    renderMarketChart('global');

    document.querySelectorAll('.ctrl-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.ctrl-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderMarketChart(btn.dataset.view);
        });
    });
}

function renderMarketChart(view) {
    const d = marketData[view];
    const option = {
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'axis',
            backgroundColor: '#ffffff',
            borderColor: COLORS.border,
            borderWidth: 1,
            textStyle: { color: COLORS.text },
            formatter: params => {
                const p = params[0];
                return `<div style="font-weight:700;margin-bottom:6px">${p.axisValue}</div>
                        <span style="color:${COLORS.accent}">●</span> ${d.name}<br/>
                        <span style="font-size:18px;font-weight:700;color:${COLORS.primary}">${p.value.toLocaleString()} ${d.unit}</span>`;
            }
        },
        grid: { left: 70, right: 50, top: 50, bottom: 60 },
        xAxis: {
            type: 'category',
            data: d.years,
            axisLine: { lineStyle: { color: COLORS.border } },
            axisLabel: { color: COLORS.textSub, fontSize: 12 },
            axisTick: { show: false }
        },
        yAxis: {
            type: 'value',
            name: d.unit,
            max: 14000,
            nameTextStyle: { color: COLORS.textSub },
            axisLine: { show: false },
            axisLabel: {
                color: COLORS.textSub,
                formatter: v => v >= 10000 ? (v / 10000) + '万' : (v >= 1000 ? (v / 1000) + 'k' : v)
            },
            splitLine: { lineStyle: { color: '#eef1f6' } }
        },
        series: [{
            name: d.name,
            type: 'line',
            data: d.values,
            smooth: true,
            symbol: 'circle',
            symbolSize: 8,
            itemStyle: {
                color: COLORS.primary,
                borderWidth: 2,
                borderColor: '#fff'
            },
            lineStyle: {
                width: 4,
                color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                    { offset: 0, color: COLORS.primary },
                    { offset: 0.5, color: COLORS.secondary },
                    { offset: 1, color: COLORS.accent }
                ])
            },
            areaStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    { offset: 0, color: 'rgba(99, 107, 241, 0.35)' },
                    { offset: 0.5, color: 'rgba(20, 184, 166, 0.18)' },
                    { offset: 1, color: 'rgba(99, 107, 241, 0)' }
                ])
            },
            emphasis: {
                itemStyle: { borderWidth: 4, shadowBlur: 20, shadowColor: COLORS.primary }
            },
            markPoint: {
                data: [
                    { type: 'max', name: '峰值' }
                ],
                symbolSize: 50,
                itemStyle: { color: COLORS.accent },
                label: { color: '#1a1a2e', fontWeight: 700 }
            },
            markLine: {
                data: [{ type: 'average', name: '均值' }],
                lineStyle: { color: COLORS.success, type: 'dashed' },
                label: { color: COLORS.success }
            },
            animationDuration: 1800,
            animationEasing: 'cubicOut'
        }]
    };
    marketChart.setOption(option, true);

    // 更新底部指标
    const last = d.values[d.values.length - 1];
    const first = d.values[0];
    const years = d.values.length - 1;
    const cagr = (Math.pow(last / first, 1 / years) - 1) * 100;
    const multi = (last / first).toFixed(0);
    const peak = last >= 10000 ? (last/10000).toFixed(1) + '万' + d.unit : (last/1000).toFixed(1) + 'k ' + d.unit;
    document.getElementById('cagrValue').textContent = cagr.toFixed(1) + '%';
    document.getElementById('multiplierValue').textContent = multi + '×';
    document.getElementById('peakValue').textContent = peak;
}

/* ========== 5. 行业雷达图 ========== */
let radarChart;
const industryData = {
    manufacturing: {
        title: '智能制造 · Industrial AI',
        desc: '通过机器视觉与边缘计算，工厂实现7×24小时无人质检；预测性维护使设备故障率下降45%；柔性生产线可在不同产品间秒级切换，重新定义"规模经济"。',
        metrics: [
            { label: '质检准确率', value: 98 },
            { label: '设备停机减少', value: 45 },
            { label: '能耗优化', value: 30 },
            { label: '产能提升', value: 45 }
        ],
        radar: [95, 88, 90, 75, 92, 85]
    },
    healthcare: {
        title: '智慧医疗 · Medical AI',
        desc: 'AI影像诊断已达到资深医生水平；药物研发周期从10年缩短至3年；基于多组学的个性化治疗方案让"精准医疗"成为现实。',
        metrics: [
            { label: '诊断准确率', value: 96 },
            { label: '研发周期缩短', value: 70 },
            { label: '误诊率降低', value: 50 },
            { label: '诊断速度', value: 85 }
        ],
        radar: [90, 95, 78, 92, 70, 80]
    },
    finance: {
        title: '智能金融 · FinAI',
        desc: 'AI风控模型可在毫秒级识别欺诈交易；智能投顾为亿万用户提供个性化资产配置；量化交易策略基于深度强化学习持续进化。',
        metrics: [
            { label: '欺诈识别率', value: 99 },
            { label: '运营成本下降', value: 50 },
            { label: '决策速度提升', value: 200 },
            { label: '风险预测精度', value: 88 }
        ],
        radar: [98, 70, 95, 85, 88, 60]
    },
    agriculture: {
        title: '智慧农业 · AgriAI',
        desc: '无人机+AI实现精准变量施肥；病虫害识别准确率达95%；卫星遥感结合AI预测产量，让"看天吃饭"变为"知天而作"。',
        metrics: [
            { label: '产量提升', value: 30 },
            { label: '农药使用减少', value: 40 },
            { label: '水资源节约', value: 35 },
            { label: '病虫害识别率', value: 95 }
        ],
        radar: [75, 65, 70, 60, 80, 95]
    },
    education: {
        title: '智能教育 · EduAI',
        desc: 'AI导师为每个学生定制学习路径，实现真正的"因材施教"；自动批改与学情分析让教师从重复劳动中解放，聚焦教学创新。',
        metrics: [
            { label: '学习效率提升', value: 60 },
            { label: '个性化程度', value: 95 },
            { label: '教师减负', value: 70 },
            { label: '覆盖学生数', value: 80 }
        ],
        radar: [70, 80, 85, 75, 65, 90]
    },
    transport: {
        title: '智慧交通 · Mobility AI',
        desc: '自动驾驶感知系统可在毫秒内处理多传感器数据；城市大脑实时优化信号灯配时，让拥堵下降30%；路径规划让物流成本降低20%。',
        metrics: [
            { label: '事故率降低', value: 70 },
            { label: '通行效率提升', value: 35 },
            { label: '能耗下降', value: 20 },
            { label: '物流成本降低', value: 25 }
        ],
        radar: [92, 75, 88, 70, 95, 65]
    }
};

const radarIndicators = [
    { name: '自动化程度', max: 100 },
    { name: '成本优化', max: 100 },
    { name: '效率提升', max: 100 },
    { name: '精度提升', max: 100 },
    { name: '创新驱动', max: 100 },
    { name: '可持续性', max: 100 }
];

/* 无 AI 时传统模式的能力基准（同维度 0-100 估分，示意） */
const noAiBaseline = {
    manufacturing: [48, 44, 45, 40, 36, 35],
    healthcare:    [42, 40, 40, 42, 30, 36],
    finance:       [50, 48, 46, 40, 38, 30],
    agriculture:   [40, 36, 38, 32, 28, 42],
    education:     [35, 32, 40, 38, 26, 40],
    transport:     [44, 40, 42, 36, 34, 28]
};

function initRadarChart() {
    const dom = document.getElementById('radarChart');
    if (!dom) return;
    radarChart = echarts.init(dom);
    renderRadar('manufacturing');

    document.querySelectorAll('.industry-item').forEach(item => {
        item.addEventListener('click', () => {
            document.querySelectorAll('.industry-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            renderRadar(item.dataset.industry);
        });
    });
}

function renderRadar(key) {
    const d = industryData[key];
    const option = {
        backgroundColor: 'transparent',
        tooltip: {
            backgroundColor: '#ffffff',
            borderColor: COLORS.border,
            borderWidth: 1,
            textStyle: { color: COLORS.text }
        },
        radar: {
            indicator: radarIndicators,
            center: ['50%', '52%'],
            radius: '70%',
            shape: 'polygon',
            splitNumber: 5,
            axisName: {
                color: COLORS.text,
                fontSize: 13,
                fontWeight: 500
            },
            splitLine: {
                lineStyle: { color: '#e8edf2' }
            },
            splitArea: {
                areaStyle: {
                    color: ['rgba(99, 107, 241, 0.03)', 'rgba(99, 107, 241, 0.06)']
                }
            },
            axisLine: { lineStyle: { color: '#d7dde6' } }
        },
        series: [{
            type: 'radar',
            data: [
                {
                    value: d.radar,
                    name: d.title,
                    symbol: 'circle',
                    symbolSize: 8,
                    itemStyle: { color: COLORS.accent, borderWidth: 2, borderColor: '#fff' },
                    lineStyle: {
                        width: 3,
                        color: COLORS.primary
                    },
                    areaStyle: {
                        color: new echarts.graphic.RadialGradient(0.5, 0.5, 1, [
                            { offset: 0, color: 'rgba(99, 107, 241, 0.3)' },
                            { offset: 1, color: 'rgba(99, 107, 241, 0.08)' }
                        ])
                    },
                    label: {
                        show: true,
                        color: COLORS.accent,
                        fontWeight: 700,
                        formatter: '{c}'
                    }
                },
                {
                    value: noAiBaseline[key],
                    name: '无 AI · 传统模式基准',
                    symbol: 'none',
                    lineStyle: {
                        width: 2,
                        color: '#94a3b8',
                        type: 'dashed'
                    },
                    areaStyle: { color: 'rgba(148, 163, 184, 0.10)' }
                }
            ],
            animationDuration: 1500
        }],
        legend: {
            data: [d.title, '无 AI · 传统模式基准'],
            bottom: 10,
            textStyle: { color: COLORS.textSub },
            itemWidth: 16,
            itemHeight: 8
        }
    };
    radarChart.setOption(option, true);
}

/* ========== 6. 全球AI气泡图 ========== */
function initGlobalChart() {
    const dom = document.getElementById('globalChart');
    if (!dom) return;
    const chart = echarts.init(dom);

    // 各国数据 [投资额, 论文数, 综合得分, 国家, 颜色]
    const C = ['#6366f1', '#14b8a6', '#f59e0b', '#f87171', '#94a3b8'];
    const countries = [
        { name: '美国', invest: 672, papers: 89500, score: 95, color: C[0] },
        { name: '中国', invest: 154, papers: 78200, score: 86, color: C[1] },
        { name: '英国', invest: 81, papers: 33100, score: 76, color: C[2] },
        { name: '日本', invest: 65, papers: 21900, score: 71, color: C[3] },
        { name: '德国', invest: 48, papers: 25600, score: 70, color: C[4] },
        { name: '法国', invest: 35, papers: 17800, score: 65, color: C[0] },
        { name: '印度', invest: 30, papers: 14200, score: 62, color: C[1] },
        { name: '加拿大', invest: 28, papers: 13100, score: 60, color: C[2] },
        { name: '韩国', invest: 25, papers: 10900, score: 58, color: C[3] },
        { name: '以色列', invest: 22, papers: 7800, score: 56, color: C[4] }
    ];

    const option = {
        backgroundColor: 'transparent',
        tooltip: {
            backgroundColor: '#ffffff',
            borderColor: COLORS.border,
            borderWidth: 1,
            textStyle: { color: COLORS.text },
            formatter: p => {
                const c = countries[p.dataIndex];
                return `<div style="font-weight:700;font-size:16px;color:${COLORS.accent}">${c.name}</div>
                        <div style="margin-top:6px">投资规模: <b style="color:${COLORS.primary}">$${c.invest}亿</b></div>
                        <div>论文数量: <b style="color:${COLORS.primary}">${c.papers.toLocaleString()}</b></div>
                        <div>综合得分: <b style="color:${COLORS.accent}">${c.score}</b></div>`;
            }
        },
        grid: { left: 70, right: 40, top: 40, bottom: 60 },
        xAxis: {
            type: 'value',
            name: '论文数量',
            nameTextStyle: { color: COLORS.textSub },
            axisLine: { lineStyle: { color: COLORS.border } },
            axisLabel: { color: COLORS.textSub, formatter: v => v >= 1000 ? (v/1000)+'k' : v },
            splitLine: { lineStyle: { color: '#eef1f6' } }
        },
        yAxis: {
            type: 'value',
            name: '投资规模(亿美元)',
            nameTextStyle: { color: COLORS.textSub },
            axisLine: { show: false },
            axisLabel: { color: COLORS.textSub },
            splitLine: { lineStyle: { color: '#eef1f6' } }
        },
        series: [{
            type: 'scatter',
            data: countries.map(c => [c.papers, c.invest, c.score, c.name]),
            symbolSize: d => d[2] * 0.9,
            itemStyle: {
                color: p => countries[p.dataIndex].color,
                opacity: 0.75,
                shadowBlur: 20,
                shadowColor: p => countries[p.dataIndex].color,
                borderColor: '#fff',
                borderWidth: 2
            },
            label: {
                show: true,
                formatter: p => countries[p.dataIndex].name,
                position: 'right',
                color: COLORS.text,
                fontSize: 13,
                fontWeight: 700
            },
            emphasis: {
                itemStyle: { opacity: 1, shadowBlur: 40 },
                label: { fontSize: 16 }
            },
            animationDuration: 1500,
            animationEasing: 'elasticOut'
        }]
    };
    chart.setOption(option);

    // 排行榜
    const ranking = document.getElementById('rankingList');
    const sorted = [...countries].sort((a, b) => b.score - a.score);
    ranking.innerHTML = sorted.map((c, i) => `
        <div class="rank-item">
            <span class="rank-num">${i+1}</span>
            <span class="rank-name">${c.name}</span>
            <span class="rank-score">${c.score}</span>
        </div>
    `).join('');
}

/* ========== 7. 桑基图(就业变革) ========== */
function initSankeyChart() {
    const dom = document.getElementById('sankeyChart');
    if (!dom) return;
    const chart = echarts.init(dom);

    const option = {
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'item',
            backgroundColor: '#ffffff',
            borderColor: COLORS.border,
            borderWidth: 1,
            textStyle: { color: COLORS.text }
        },
        series: [{
            type: 'sankey',
            left: 30, right: 130,
            top: 30, bottom: 30,
            nodeAlign: 'justify',
            nodeWidth: 18,
            nodeGap: 14,
            layoutIterations: 64,
            data: [
                { name: '传统制造业', itemStyle: { color: COLORS.danger } },
                { name: '基础数据录入', itemStyle: { color: COLORS.danger } },
                { name: '常规客服', itemStyle: { color: COLORS.danger } },
                { name: '简单翻译', itemStyle: { color: COLORS.danger } },
                { name: '初级编程', itemStyle: { color: COLORS.danger } },
                { name: '常规驾驶', itemStyle: { color: COLORS.danger } },

                { name: 'AI训练师', itemStyle: { color: COLORS.success } },
                { name: '提示工程师', itemStyle: { color: COLORS.success } },
                { name: 'AI伦理专家', itemStyle: { color: COLORS.success } },
                { name: '数据科学家', itemStyle: { color: COLORS.primary } },
                { name: '机器人运维', itemStyle: { color: COLORS.primary } },
                { name: 'AI产品经理', itemStyle: { color: COLORS.accent } },
                { name: '智能系统架构师', itemStyle: { color: COLORS.accent } }
            ],
            links: [
                // 旧→新
                { source: '传统制造业', target: '机器人运维', value: 1800 },
                { source: '传统制造业', target: 'AI产品经理', value: 600 },

                { source: '基础数据录入', target: '数据科学家', value: 1200 },
                { source: '基础数据录入', target: 'AI训练师', value: 1500 },
                { source: '基础数据录入', target: '提示工程师', value: 800 },

                { source: '常规客服', target: '提示工程师', value: 900 },
                { source: '常规客服', target: 'AI产品经理', value: 500 },

                { source: '简单翻译', target: 'AI伦理专家', value: 400 },
                { source: '简单翻译', target: '提示工程师', value: 600 },

                { source: '初级编程', target: '智能系统架构师', value: 1100 },
                { source: '初级编程', target: 'AI产品经理', value: 700 },

                { source: '常规驾驶', target: '机器人运维', value: 800 },
                { source: '常规驾驶', target: 'AI伦理专家', value: 300 }
            ],
            label: {
                color: COLORS.text,
                fontSize: 13,
                fontWeight: 500
            },
            lineStyle: {
                color: 'gradient',
                curveness: 0.55,
                opacity: 0.5
            },
            emphasis: {
                lineStyle: { opacity: 0.9, width: 2 }
            },
            animationDuration: 1500,
            animationEasing: 'cubicOut'
        }]
    };
    chart.setOption(option);
}

/* ========== 8. 算力增长图 ========== */
function initComputeChart() {
    const dom = document.getElementById('computeChart');
    if (!dom) return;
    const chart = echarts.init(dom);

    const years = ['2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026'];
    // 算力单位: EFLOPS(每秒百亿亿次浮点运算)
    const aiCompute = [20, 60, 150, 350, 800, 1800, 3800, 7500, 15000];
    const generalCompute = [180, 250, 330, 420, 530, 650, 800, 980, 1200];

    const option = {
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'axis',
            backgroundColor: '#ffffff',
            borderColor: COLORS.border,
            borderWidth: 1,
            textStyle: { color: COLORS.text },
            axisPointer: { type: 'shadow' }
        },
        legend: {
            data: ['AI算力', '通用算力'],
            textStyle: { color: COLORS.textSub },
            top: 10
        },
        grid: { left: 70, right: 30, top: 60, bottom: 50 },
        xAxis: {
            type: 'category',
            data: years,
            axisLine: { lineStyle: { color: COLORS.border } },
            axisLabel: { color: COLORS.textSub }
        },
        yAxis: {
            type: 'log',
            name: 'EFLOPS(对数)',
            nameTextStyle: { color: COLORS.textSub },
            axisLine: { show: false },
            axisLabel: { 
                color: COLORS.textSub,
                formatter: v => v >= 1000 ? (v/1000)+'k' : v
            },
            splitLine: { lineStyle: { color: '#eef1f6' } }
        },
        series: [
            {
                name: 'AI算力',
                type: 'bar',
                data: aiCompute,
                barWidth: '38%',
                itemStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: COLORS.primary },
                        { offset: 1, color: 'rgba(99, 107, 241, 0.22)' }
                    ]),
                    borderRadius: [6, 6, 0, 0]
                },
                emphasis: {
                    itemStyle: { shadowBlur: 20, shadowColor: COLORS.primary }
                }
            },
            {
                name: '通用算力',
                type: 'bar',
                data: generalCompute,
                barWidth: '38%',
                itemStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: COLORS.accent },
                        { offset: 1, color: 'rgba(245, 158, 11, 0.22)' }
                    ]),
                    borderRadius: [6, 6, 0, 0]
                }
            }
        ],
        animationDuration: 1500,
        animationDelay: idx => idx * 80
    };
    chart.setOption(option);
}

/* ========== 8.5 发展安全：供应链韧性恢复曲线 ========== */
function initSecurityChart() {
    const dom = document.getElementById('securityChart');
    if (!dom) return;
    const chart = echarts.init(dom);
    const xData = ['冲击前3月', '前2月', '前1月', '冲击当月', '+1月', '+2月', '+3月', '+4月', '+5月', '+6月', '+8月', '+10月', '+12月'];
    // 产能恢复指数(%)：冲击发生在第 4 个点
    const traditional = [100, 100, 100, 52, 55, 60, 66, 72, 77, 81, 86, 89, 91];
    const aiResilient = [100, 100, 100, 74, 82, 89, 94, 96, 98, 99, 100, 102, 103];

    chart.setOption({
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'axis',
            backgroundColor: '#ffffff',
            borderColor: COLORS.border,
            borderWidth: 1,
            textStyle: { color: COLORS.text },
            formatter: params => {
                let html = `<div style="font-weight:700;margin-bottom:6px">${params[0].axisValue}</div>`;
                params.forEach(p => {
                    html += `<span style="color:${p.color}">●</span> ${p.seriesName}：<b>${p.value}%</b><br/>`;
                });
                return html;
            }
        },
        legend: {
            data: ['传统供应链', 'AI 增强韧性链'],
            textStyle: { color: COLORS.textSub, fontSize: 13 },
            top: 6,
            itemGap: 30
        },
        grid: { left: 70, right: 40, top: 60, bottom: 60 },
        xAxis: {
            type: 'category',
            data: xData,
            boundaryGap: false,
            axisLine: { lineStyle: { color: COLORS.border } },
            axisLabel: { color: COLORS.textSub, fontSize: 11, interval: 0, rotate: 30 },
            axisTick: { show: false }
        },
        yAxis: {
            type: 'value',
            name: '产能恢复指数 (%)',
            nameTextStyle: { color: COLORS.textSub, padding: [0, 0, 0, 30] },
            min: 40, max: 110,
            axisLine: { show: false },
            axisLabel: { color: COLORS.textSub, formatter: '{value}%' },
            splitLine: { lineStyle: { color: '#eef1f6' } }
        },
        series: [
            {
                name: '传统供应链',
                type: 'line',
                data: traditional,
                smooth: true,
                symbol: 'circle',
                symbolSize: 7,
                itemStyle: { color: COLORS.danger },
                lineStyle: { width: 3, color: COLORS.danger },
                areaStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: 'rgba(244, 63, 94, 0.25)' },
                        { offset: 1, color: 'rgba(244, 63, 94, 0)' }
                    ])
                },
                markPoint: {
                    symbol: 'pin', symbolSize: 1,
                    label: { show: false },
                    data: []
                },
                animationDuration: 1800
            },
            {
                name: 'AI 增强韧性链',
                type: 'line',
                data: aiResilient,
                smooth: true,
                symbol: 'circle',
                symbolSize: 7,
                itemStyle: { color: COLORS.success },
                lineStyle: { width: 3.5, color: COLORS.success, shadowColor: COLORS.success, shadowBlur: 12 },
                areaStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: 'rgba(16, 185, 129, 0.3)' },
                        { offset: 1, color: 'rgba(16, 185, 129, 0)' }
                    ])
                },
                markArea: {
                    silent: true,
                    itemStyle: { color: 'rgba(245, 158, 11, 0.06)' },
                    label: { color: COLORS.accent, fontSize: 12, position: 'top' },
                    data: [[{ name: '冲击恢复期', xAxis: '冲击当月' }, { xAxis: '+12月' }]]
                },
                animationDuration: 2000
            }
        ],
        graphic: [
            {
                type: 'text',
                left: '36%',
                top: '58%',
                style: {
                    text: '缺口 22 个百分点',
                    fill: 'rgba(217, 119, 6, 0.9)',
                    fontSize: 13,
                    fontWeight: 700
                }
            }
        ]
    });
    return chart;
}

/* ========== 8.6 右侧叙事进度 dots ========== */
function initSideDots() {
    const dots = document.querySelectorAll('#sideDots .sd');
    if (!dots.length) return;
    const ids = Array.from(dots).map(d => d.getAttribute('href').slice(1));

    function sync() {
        let current = ids[0];
        ids.forEach(id => {
            const sec = document.getElementById(id);
            if (sec && window.scrollY >= sec.offsetTop - window.innerHeight * 0.35) current = id;
        });
        dots.forEach(d => d.classList.toggle('active', d.getAttribute('href') === '#' + current));
    }
    window.addEventListener('scroll', sync, { passive: true });
    setTimeout(sync, 600);
}

/* ========== 9. 滚动进入动画 ========== */
function initScrollAnimations() {
    // 时间线
    const items = document.querySelectorAll('.timeline-item');
    const obs = new IntersectionObserver((entries) => {
        entries.forEach(e => {
            if (e.isIntersecting) e.target.classList.add('visible');
        });
    }, { threshold: 0.05, rootMargin: '0px 0px -30px 0px' });
    items.forEach(i => obs.observe(i));

    // 进度条 bar-fill
    const bars = document.querySelectorAll('.bar-fill, .fp-bar');
    const barObs = new IntersectionObserver((entries) => {
        entries.forEach(e => {
            if (e.isIntersecting) {
                const el = e.target;
                if (el.dataset.width) el.style.width = el.dataset.width;
                else if (el.style.getPropertyValue('--w')) el.style.width = el.style.getPropertyValue('--w');
            }
        });
    }, { threshold: 0.1, rootMargin: '0px 0px -30px 0px' });
    bars.forEach(b => barObs.observe(b));

    // 5 模块叙事元素入场（章节很高，threshold 用 0，顶部进入视口下 12% 即触发）
    const revealEls = document.querySelectorAll('.reveal, .role-chapter, .sig-block, .pillar-card, .pillars-title, .triangle-caption');
    const revealObs = new IntersectionObserver((entries) => {
        entries.forEach(e => {
            if (e.isIntersecting) {
                e.target.classList.add('visible');
                revealObs.unobserve(e.target);
            }
        });
    }, { threshold: 0, rootMargin: '0px 0px -12% 0px' });
    revealEls.forEach(el => revealObs.observe(el));

    // 兜底：滚动事件触发已进入视口的元素
    function triggerVisible() {
        items.forEach(item => {
            if (!item.classList.contains('visible')) {
                const rect = item.getBoundingClientRect();
                if (rect.top < window.innerHeight - 30 && rect.bottom > 0) {
                    item.classList.add('visible');
                }
            }
        });
        bars.forEach(el => {
            const hasInlineVar = el.style.getPropertyValue('--w');
            if (el.dataset.width && !el.style.width) {
                const rect = el.getBoundingClientRect();
                if (rect.top < window.innerHeight - 30) el.style.width = el.dataset.width;
            } else if (hasInlineVar && !el.style.width) {
                const rect = el.getBoundingClientRect();
                if (rect.top < window.innerHeight - 30) el.style.width = hasInlineVar;
            }
        });
        // 叙事元素兜底：顶部进入视口 88% 线即显示
        revealEls.forEach(el => {
            if (!el.classList.contains('visible')) {
                const rect = el.getBoundingClientRect();
                if (rect.top < window.innerHeight * 0.88) el.classList.add('visible');
            }
        });
    }
    window.addEventListener('scroll', triggerVisible, { passive: true });
    setTimeout(triggerVisible, 800);
    setInterval(triggerVisible, 1500); // 最终兜底
}

/* ========== 10. 防抖resize ========== */
function initResize() {
    let timer;
    window.addEventListener('resize', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            [marketChart, radarChart].forEach(c => c && c.resize());
            document.querySelectorAll('[id$="Chart"],[id$="chart"]').forEach(d => {
                const inst = echarts.getInstanceByDom(d);
                if (inst) inst.resize();
            });
        }, 200);
    });
}

/* ================================================
 *  20261009g · 整合 2.html 可视化（亮色化）
 * ================================================ */

/* 亮色通用配置 */
const L_TOOLTIP = {
    backgroundColor: '#fff',
    borderColor: COLORS.border,
    borderWidth: 1,
    textStyle: { color: COLORS.text, fontSize: 12 },
    padding: [10, 14]
};
function lAxis(color) {
    return {
        axisLine: { lineStyle: { color: COLORS.border } },
        axisLabel: { color: COLORS.textSub, fontSize: 11.5 },
        splitLine: { lineStyle: { color: '#eef1f6', type: 'dashed' } }
    };
}

/* 11. 打字机 */
function initTyping() {
    const el = document.getElementById('heroTyping');
    if (!el) return;
    const words = ['数据 → 新的生产要素', '算力 → 新的能源', '算法 → 新的工艺', 'AI 引擎 → 千行百业'];
    let wi = 0, ci = 0, del = false;
    (function type() {
        el.textContent = words[wi].slice(0, ci);
        let delay = del ? 38 : 85;
        if (!del) {
            if (ci < words[wi].length) ci++;
            else { del = true; delay = 1800; }
        } else {
            if (ci > 0) ci--;
            else { del = false; wi = (wi + 1) % words.length; delay = 300; }
        }
        setTimeout(type, delay);
    })();
}

/* 12. 跑马灯 */
function initTicker() {
    const items = [
        ['2025 中国 AI 核心产业规模', '超 1.2 万亿元'],
        ['智能算力规模', '159 万 PFlops · 全球第二'],
        ['生成式 AI 服务备案', '748 款'],
        ['生成式 AI 用户', '5.15 亿人'],
        ['数字经济占 GDP', '43.8%'],
        ['数字经济规模', '59.2 万亿元'],
        ['AI 企业数量', '超 5300 家 · 全球占比 15%'],
        ['2030 AI 全球 GDP 增量', '15.7 万亿美元'],
        ['2030 中国 GDP 提升', '约 26%'],
        ['AI 产业规模目标（十五五末）', '10 万亿元以上'],
        ['基础层产业增速', '54%'],
        ['工业机器人装机全球占比', '超 50%']
    ];
    const t = document.getElementById('tickerTrack');
    if (!t) return;
    const half = items.map(([a, b]) => '<span class="it">' + a + ' <b>' + b + '</b></span>').join('');
    t.innerHTML = half + half;
}

/* 13. 词云 */
function initWordCloud() {
    const dom = document.getElementById('cloudChart');
    if (!dom) return;
    const chart = echarts.init(dom);
    const palette = [COLORS.primary, COLORS.secondary, COLORS.accent, COLORS.danger, COLORS.success, '#8b5cf6'];
    const words = [
        ['新质生产力', 100], ['人工智能', 92], ['全要素生产率', 80], ['高质量发展', 72], ['数据要素', 66],
        ['算力', 62], ['大模型', 58], ['智能体', 52], ['数字化转型', 50], ['新型工业化', 46],
        ['科技创新', 44], ['产业升级', 40], ['数字中国', 38], ['绿色低碳', 34], ['人才强国', 30],
        ['自主可控', 28], ['场景落地', 26], ['人机协同', 24], ['数据安全', 22], ['智能决策', 20]
    ];
    chart.setOption({
        tooltip: L_TOOLTIP,
        series: [{
            type: 'wordCloud', shape: 'circle', width: '98%', height: '94%',
            sizeRange: [13, 48], rotationRange: [-25, 25], rotationStep: 6,
            gridSize: 9, drawOutOfBound: false, shrinkToFit: true,
            textStyle: { fontWeight: 600, color: () => palette[Math.floor(Math.random() * palette.length)] },
            emphasis: { textStyle: { textShadowBlur: 8, textShadowColor: 'rgba(99,107,241,.5)' } },
            data: words.map(([name, value]) => ({ name, value }))
        }]
    });
    return chart;
}

/* 14. 备案柱线组合 */
function initModelsChart() {
    const dom = document.getElementById('modelsChart');
    if (!dom) return;
    const chart = echarts.init(dom);
    const xs = ['2024 年末', '2025 年中', '2025 年 8 月', '2025 年末'];
    const acc = [302, 433, 538, 748];
    const add = [302, 131, 105, 210];
    chart.setOption({
        tooltip: { ...L_TOOLTIP, trigger: 'axis' },
        legend: { data: ['新增备案', '累计备案'], top: 0, textStyle: { color: COLORS.textSub, fontSize: 11.5 }, icon: 'circle' },
        grid: { top: 40, left: 14, right: 20, bottom: 30, containLabel: true },
        xAxis: { type: 'category', data: xs, ...lAxis(), axisTick: { show: false } },
        yAxis: { type: 'value', name: '款', ...lAxis(), axisLine: { show: false } },
        series: [
            { name: '新增备案', type: 'bar', barWidth: 30, data: add,
                itemStyle: { borderRadius: [6, 6, 0, 0],
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: 'rgba(20,184,166,.9)' }, { offset: 1, color: 'rgba(20,184,166,.25)' }]) },
                label: { show: true, position: 'top', color: COLORS.textSub, fontSize: 11 } },
            { name: '累计备案', type: 'line', smooth: true, symbol: 'circle', symbolSize: 9, data: acc,
                lineStyle: { width: 3, color: COLORS.accent },
                itemStyle: { color: COLORS.accent, borderColor: '#fff', borderWidth: 2 },
                label: { show: true, position: 'top', color: COLORS.accent, fontSize: 12, fontWeight: 700 } }
        ]
    });
    return chart;
}

/* 15. 力导向关系网络 */
let parallelChartInstance = null;
let parallelHighlightName = null;

function initForceNetwork() {
    const dom = document.getElementById('forceChart');
    if (!dom) return;
    const chart = echarts.init(dom);
    const industries = ['智能制造', '医疗健康', '金融服务', '交通运输', '能源电力', '智慧农业', '教育科研', '文化创意'];
    const factors = ['数据', '算力', '算法', '人才'];
    /* 要素=琥珀色系 4 级深浅 · 产业=青绿(teal/cyan)色系 8 级深浅，类内拉开明度差异 */
    const FACTOR_COLORS = ['#b45309', '#d97706', '#f59e0b', '#fbbf24'];
    const IND_COLORS = ['#134e4a', '#0e7490', '#0d9488', '#0891b2', '#14b8a6', '#06b6d4', '#2dd4bf', '#67e8f9'];
    const nodes = [
        { id: 'AI', name: 'AI 引擎', category: 0, symbolSize: 72,
            itemStyle: { color: COLORS.primary, shadowBlur: 28, shadowColor: 'rgba(99,107,241,.65)' } },
        ...factors.map((f, i) => ({ id: f, name: f, category: 1, symbolSize: 46,
            itemStyle: { color: FACTOR_COLORS[i], shadowBlur: 12, shadowColor: 'rgba(217,119,6,.45)' } })),
        ...industries.map((f, i) => ({ id: f, name: f, category: 2, symbolSize: 38,
            itemStyle: { color: IND_COLORS[i] } }))
    ];
    const links = [
        { source: 'AI', target: '数据', value: 90 }, { source: 'AI', target: '算力', value: 85 },
        { source: 'AI', target: '算法', value: 92 }, { source: 'AI', target: '人才', value: 62 },
        { source: 'AI', target: '智能制造', value: 52 }, { source: 'AI', target: '医疗健康', value: 46 },
        { source: 'AI', target: '金融服务', value: 58 }, { source: 'AI', target: '交通运输', value: 44 },
        { source: 'AI', target: '能源电力', value: 31 }, { source: 'AI', target: '智慧农业', value: 22 },
        { source: 'AI', target: '教育科研', value: 38 }, { source: 'AI', target: '文化创意', value: 35 },
        { source: '数据', target: '智能制造', value: 30 }, { source: '数据', target: '智慧农业', value: 18 },
        { source: '算力', target: '能源电力', value: 20 }, { source: '算法', target: '金融服务', value: 26 },
        { source: '算法', target: '文化创意', value: 22 }, { source: '人才', target: '教育科研', value: 16 }
    ].map(l => ({ ...l, lineStyle: { width: Math.max(1.2, l.value / 20) } }));
    chart.setOption({
        tooltip: {
            backgroundColor: '#ffffff',
            borderColor: COLORS.border,
            borderWidth: 1,
            textStyle: { color: COLORS.text, fontSize: 12.5 },
            formatter: p => {
                if (p.dataType === 'edge') {
                    return p.data.source + ' → ' + p.data.target +
                        '<br/>关联强度指数 <b>' + p.data.value + '</b> <span style="color:#94a3b8">/ 100（示意）</span>';
                }
                const desc = ['AI 核心引擎 · 驱动四大要素赋能千行百业',
                              '生产要素 · AI 发挥作用的基础支撑',
                              '赋能产业 · AI 深度重构的行业场景（点击高亮下方对比）'][p.data.category];
                return '<b>' + p.data.name + '</b><br/><span style="color:#64748b">' + desc + '</span>';
            }
        },
        legend: { data: ['AI 内核', '生产要素', '赋能产业'], top: 0, textStyle: { color: COLORS.textSub, fontSize: 11.5 }, icon: 'circle' },
        animationDuration: 1200,
        series: [{
            type: 'graph', layout: 'force', roam: true, draggable: true,
            data: nodes, links: links,
            categories: [
                { name: 'AI 内核', itemStyle: { color: COLORS.primary } },
                { name: '生产要素', itemStyle: { color: '#f59e0b' } },
                { name: '赋能产业', itemStyle: { color: '#14b8a6' } }
            ],
            force: { repulsion: 380, edgeLength: [70, 150], gravity: .08, layoutAnimation: true },
            label: { show: true, position: 'bottom', color: COLORS.textSub, fontSize: 11.5, formatter: p => p.data.name },
            lineStyle: { color: 'source', opacity: .42, curveness: .18 },
            emphasis: { focus: 'adjacency', lineStyle: { opacity: .9 },
                label: { color: COLORS.text, fontWeight: 700, fontSize: 13 } },
            itemStyle: { borderColor: '#fff', borderWidth: 2 }
        }]
    });
    /* 点击产业节点 → 高亮下方平行坐标对应行业；再次点击或点空白处取消 */
    chart.on('click', p => {
        if (p.dataType === 'node' && p.data.category === 2) {
            highlightParallel(parallelHighlightName === p.data.name ? null : p.data.name);
        }
    });
    chart.getZr().on('click', e => {
        if (!e.target) highlightParallel(null);
    });
    return chart;
}

/* 16. 桑基+热力+效率/成本 tab 联动 */
const TECH = ['大模型技术', '计算机视觉', '智能语音', '机器人技术', '数据智能', '生成式 AI'];
const INDUS = ['智能制造', '医疗健康', '金融服务', '交通运输', '能源电力', '智慧农业', '教育科研', '文化创意'];
const SANKEY_LINKS = [
    ['大模型技术', '金融服务', 34], ['大模型技术', '教育科研', 26], ['大模型技术', '文化创意', 30],
    ['计算机视觉', '智能制造', 46], ['计算机视觉', '医疗健康', 32], ['计算机视觉', '交通运输', 24],
    ['智能语音', '文化创意', 18], ['智能语音', '医疗健康', 14],
    ['机器人技术', '智能制造', 38], ['机器人技术', '交通运输', 20],
    ['数据智能', '金融服务', 30], ['数据智能', '能源电力', 22], ['数据智能', '智慧农业', 16],
    ['生成式 AI', '文化创意', 40], ['生成式 AI', '教育科研', 22], ['生成式 AI', '医疗健康', 18]
];
const FUNCS = ['研发', '生产', '营销', '客服', '供应链', '管理'];
const HEAT_M = {
    '智能制造': [72, 80, 62, 40, 68, 58], '医疗健康': [62, 48, 50, 44, 38, 55],
    '金融服务': [70, 64, 72, 66, 58, 82], '交通运输': [56, 60, 58, 48, 66, 46],
    '能源电力': [52, 54, 56, 36, 50, 62], '智慧农业': [40, 44, 36, 28, 42, 32],
    '教育科研': [60, 52, 48, 56, 30, 46], '文化创意': [62, 54, 68, 64, 40, 52]
};
const PROD = { '智能制造': 45, '医疗健康': 35, '金融服务': 40, '交通运输': 38, '能源电力': 30, '智慧农业': 25, '教育科研': 28, '文化创意': 32 };
const COST = { '智能制造': 25, '医疗健康': 18, '金融服务': 20, '交通运输': 22, '能源电力': 15, '智慧农业': 12, '教育科研': 10, '文化创意': 16 };

function initTechSankeyHeat() {
    /* 桑基图 */
    const skDom = document.getElementById('techSankey');
    let skChart = null, heatChart = null, effChart = null, costChart = null;
    if (skDom) {
        skChart = echarts.init(skDom);
        /* 技术节点=indigo 系深浅 · 产业节点=teal 系深浅 */
        const TECH_COLORS = ['#312e81', '#4338ca', '#4f46e5', '#6366f1', '#818cf8', '#a5b4fc'];
        const IND_COLORS = ['#134e4a', '#115e59', '#0f766e', '#0d9488', '#14b8a6', '#2dd4bf', '#5eead4', '#99f6e4'];
        const nodes = [
            ...TECH.map((t, i) => ({ name: t, depth: 0, itemStyle: { color: TECH_COLORS[i] } })),
            ...INDUS.map((t, i) => ({ name: t, depth: 1, itemStyle: { color: IND_COLORS[i] } }))
        ];
        skChart.setOption({
            tooltip: { ...L_TOOLTIP, trigger: 'item', triggerOn: 'mousemove' },
            series: [{
                type: 'sankey', layout: 'none', nodeWidth: 16, nodeGap: 16, nodeAlign: 'left',
                data: nodes,
                links: SANKEY_LINKS.map(([s, t, v]) => ({ source: s, target: t, value: v })),
                label: { color: COLORS.text, fontSize: 11.5 },
                lineStyle: { color: 'gradient', curveness: .55, opacity: .28 },
                itemStyle: { borderWidth: 0 },
                emphasis: { focus: 'adjacency', itemStyle: { shadowBlur: 14, shadowColor: 'rgba(99,107,241,.4)' } }
            }]
        });
    }
    /* 热力图 */
    const heatDom = document.getElementById('heatChart');
    function renderHeat(focus) {
        if (!heatDom) return;
        if (!heatChart) heatChart = echarts.init(heatDom);
        const inds = focus ? [focus] : INDUS;
        const data = [];
        inds.forEach((ind, i) => FUNCS.forEach((f, j) => data.push([j, i, HEAT_M[ind][j]])));
        heatChart.setOption({
            tooltip: { ...L_TOOLTIP, position: 'top',
                formatter: p => `${focus ? focus : inds[p.value[1]]} · ${FUNCS[p.value[0]]}<br/>渗透率 <b>${p.value[2]}%</b>` },
            grid: { top: 6, left: 66, right: 16, bottom: 44, containLabel: false },
            xAxis: { type: 'category', data: FUNCS, axisLabel: { color: COLORS.textSub, fontSize: 11 }, axisTick: { show: false }, axisLine: { show: false } },
            yAxis: { type: 'category', data: inds, axisLabel: { color: COLORS.textSub, fontSize: 11 }, axisTick: { show: false }, axisLine: { show: false } },
            visualMap: { min: 15, max: 90, calculable: false, orient: 'horizontal', left: 'center', bottom: 0,
                textStyle: { color: COLORS.textSub, fontSize: 10 }, itemWidth: 12, itemHeight: 80,
                inRange: { color: ['#eef1f6', '#c7d2fe', '#a5b4fc', '#818cf8', '#6366f1', '#4f46e5'] } },
            series: [{ type: 'heatmap', data,
                label: { show: true, color: COLORS.text, fontSize: 10.5 },
                itemStyle: { borderColor: '#fff', borderWidth: 2, borderRadius: 4 },
                emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(99,107,241,.5)' } } }]
        }, true);
        heatChart.resize();
    }
    renderHeat(null);
    /* 桑基→热力联动 */
    if (skChart) {
        let focused = null;
        skChart.on('click', p => {
            if (p.dataType === 'node' && INDUS.includes(p.name)) {
                focused = (focused === p.name) ? null : p.name;
            } else focused = null;
            renderHeat(focused);
            const sub = document.getElementById('sankeySub');
            if (sub) sub.textContent = focused ? '已联动：' + focused + ' 行业六职能渗透率' : '点击桑基图产业节点 → 联动热力图';
        });
    }
    /* 效率柱 */
    const effDom = document.getElementById('effChart');
    if (effDom) {
        effChart = echarts.init(effDom);
        effChart.setOption({
            tooltip: { ...L_TOOLTIP, trigger: 'axis', axisPointer: { type: 'shadow' },
                formatter: p => p[0].name + '<br/>效率提升 <b>' + p[0].value + '%</b>' },
            grid: { top: 34, left: 14, right: 20, bottom: 30, containLabel: true },
            xAxis: { type: 'category', data: INDUS, ...lAxis(), axisTick: { show: false }, axisLabel: { interval: 0, rotate: 28, fontSize: 10.5, color: COLORS.textSub } },
            yAxis: { type: 'value', name: '%', ...lAxis(), axisLine: { show: false } },
            series: [{ type: 'bar', barWidth: 24,
                data: INDUS.map(i => PROD[i]),
                itemStyle: { borderRadius: [6, 6, 0, 0],
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: COLORS.success }, { offset: 1, color: 'rgba(16,185,129,.3)' }]) },
                label: { show: true, position: 'top', color: COLORS.textSub, fontSize: 11, formatter: '{c}%' },
                markLine: { silent: true, symbol: 'none', data: [{ yAxis: 30 }],
                    lineStyle: { color: COLORS.accent, type: 'dashed', width: 1.6 },
                    label: { formatter: '均值 30%+', color: COLORS.accent, fontSize: 11, position: 'insideEndTop' } }
            }]
        });
    }
    /* 成本柱（正值向上 · teal 色） */
    const costDom = document.getElementById('costChart');
    if (costDom) {
        costChart = echarts.init(costDom);
        costChart.setOption({
            tooltip: { ...L_TOOLTIP, trigger: 'axis', axisPointer: { type: 'shadow' },
                formatter: p => p[0].name + '<br/>成本下降 <b>' + p[0].value + '%</b>' },
            grid: { top: 34, left: 14, right: 20, bottom: 30, containLabel: true },
            xAxis: { type: 'category', data: INDUS, ...lAxis(), axisTick: { show: false }, axisLabel: { interval: 0, rotate: 28, fontSize: 10.5, color: COLORS.textSub } },
            yAxis: { type: 'value', name: '%', ...lAxis(), axisLine: { show: false }, max: 30 },
            series: [{ type: 'bar', barWidth: 24,
                data: INDUS.map(i => COST[i]),
                itemStyle: { borderRadius: [6, 6, 0, 0],
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: COLORS.secondary }, { offset: 1, color: 'rgba(20,184,166,.25)' }]) },
                label: { show: true, position: 'top', color: COLORS.secondary, fontSize: 11, fontWeight: 700, formatter: '-{c}%' }
            }]
        });
    }
    /* tab 切换 */
    document.querySelectorAll('.tab-bar .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-bar .tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('on'));
            btn.classList.add('active');
            const id = 'tab-' + btn.dataset.tab;
            const pane = document.getElementById(id);
            if (pane) pane.classList.add('on');
            setTimeout(() => {
                [skChart, heatChart, effChart, costChart].forEach(c => c && c.resize());
            }, 60);
        });
    });
    return { skChart, heatChart, effChart, costChart };
}

/* 17. 中国地图（东数西算） + fallback */
function initChinaMap() {
    const dom = document.getElementById('chinaMap');
    if (!dom) return null;
    const HUBS = [
        { name: '京津冀', value: 30, coord: [116.4, 39.9] },
        { name: '长三角', value: 32, coord: [121.47, 31.23] },
        { name: '粤港澳', value: 26, coord: [113.28, 23.13] },
        { name: '成渝', value: 20, coord: [104.07, 30.67] },
        { name: '内蒙古', value: 16, coord: [111.75, 40.84] },
        { name: '贵州', value: 12, coord: [106.63, 26.65] },
        { name: '甘肃', value: 8, coord: [103.83, 36.06] },
        { name: '宁夏', value: 6, coord: [106.23, 38.49] }
    ];
    function mapOpt() {
        return {
            tooltip: { ...L_TOOLTIP, formatter: p => {
                if (p.seriesType === 'effectScatter') return '<b>' + p.name + '</b><br/>智算规模示意：' + p.value[2] + ' 万 PFlops';
                if (p.seriesType === 'lines') return p.data.fromName + ' → ' + p.data.toName + '<br/>算力调度流';
                return p.name;
            }},
            geo: { map: 'china', roam: true, zoom: 1.15, center: [104, 36],
                itemStyle: { areaColor: '#f1f5f9', borderColor: 'rgba(99,107,241,.35)', borderWidth: 1 },
                emphasis: { itemStyle: { areaColor: '#e0e7ff' }, label: { show: false } },
                label: { show: false } },
            series: [
                { type: 'lines', coordinateSystem: 'geo', zlevel: 1,
                    effect: { show: true, period: 5, trailLength: .55, symbol: 'arrow', symbolSize: 5, color: COLORS.primary },
                    lineStyle: { color: COLORS.primary, width: 1.4, opacity: .35, curveness: .3 },
                    data: [
                        { coords: [[116.4, 39.9], [111.75, 40.84]], fromName: '京津冀', toName: '内蒙古' },
                        { coords: [[121.47, 31.23], [103.83, 36.06]], fromName: '长三角', toName: '甘肃' },
                        { coords: [[113.28, 23.13], [106.63, 26.65]], fromName: '粤港澳', toName: '贵州' },
                        { coords: [[104.07, 30.67], [106.23, 38.49]], fromName: '成渝', toName: '宁夏' }
                    ] },
                { type: 'effectScatter', coordinateSystem: 'geo', zlevel: 2,
                    rippleEffect: { brushType: 'stroke', scale: 4, period: 3.2 },
                    symbolSize: val => val[2] * 2.6,
                    label: { show: true, position: 'right', formatter: '{b}', color: COLORS.text, fontSize: 11 },
                    itemStyle: { color: COLORS.secondary, shadowBlur: 12, shadowColor: 'rgba(20,184,166,.7)' },
                    data: HUBS.map(h => ({ name: h.name, value: [...h.coord, h.value] })) }
            ]
        };
    }
    function fallbackBar() {
        const fb = document.getElementById('mapFallback');
        if (!fb) return null;
        dom.style.display = 'none';
        fb.style.display = 'block';
        const ch = echarts.init(fb);
        ch.setOption({
            tooltip: { ...L_TOOLTIP, trigger: 'axis', axisPointer: { type: 'shadow' } },
            grid: { top: 20, left: 14, right: 30, bottom: 30, containLabel: true },
            xAxis: { type: 'value', name: '万 PFlops', ...lAxis(), splitLine: { show: false }, axisLine: { show: false } },
            yAxis: { type: 'category', data: HUBS.map(h => h.name).reverse(), ...lAxis(), axisTick: { show: false }, splitLine: { show: false }, axisLine: { show: false } },
            series: [{ type: 'bar', barWidth: 16, data: HUBS.map(h => h.value).reverse(),
                label: { show: true, position: 'right', color: COLORS.textSub, fontSize: 11 },
                itemStyle: { borderRadius: [0, 6, 6, 0],
                    color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                        { offset: 0, color: COLORS.secondary }, { offset: 1, color: COLORS.primary }]) } }]
        });
        return ch;
    }
    let chart = null;
    fetch('https://cdn.jsdelivr.net/npm/echarts@4.9.0/map/json/china.json')
        .then(r => r.json())
        .then(geo => {
            echarts.registerMap('china', geo);
            chart = echarts.init(dom);
            chart.setOption(mapOpt());
        })
        .catch(() => { chart = fallbackBar(); });
    return chart;
}

/* 18. 仪表盘 */
function initGauge() {
    const dom = document.getElementById('gaugeChart');
    if (!dom) return;
    const chart = echarts.init(dom);
    chart.setOption({
        tooltip: L_TOOLTIP,
        series: [{
            type: 'gauge', startAngle: 210, endAngle: -30, min: 0, max: 200,
            radius: '95%', center: ['50%', '58%'],
            progress: { show: true, width: 16,
                itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                    { offset: 0, color: COLORS.primary }, { offset: 1, color: COLORS.secondary }]) } },
            axisLine: { lineStyle: { width: 16, color: [[1, '#eef1f6']] } },
            axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false },
            pointer: { show: true, length: '58%', width: 4, itemStyle: { color: COLORS.primary, shadowBlur: 10, shadowColor: 'rgba(99,107,241,.6)' } },
            anchor: { show: true, size: 12, itemStyle: { color: COLORS.primary } },
            title: { show: true, offsetCenter: [0, '42%'], color: COLORS.textSub, fontSize: 13, fontWeight: 500 },
            detail: { valueAnimation: true, offsetCenter: [0, 0], formatter: '{value}',
                color: COLORS.text, fontSize: 40, fontWeight: 700, fontFamily: 'Rajdhani' },
            data: [{ value: 159, name: '万 PFlops（FP16）' }]
        }],
        graphic: [
            { type: 'text', left: 'center', top: '16%', style: { text: '全球第二 · 2025 年底', fill: COLORS.textSub, fontSize: 13, fontWeight: 600 } },
            { type: 'text', left: 'center', bottom: '8%', style: { text: '八大枢纽集聚 80%+ 智算', fill: COLORS.textSub, fontSize: 11.5 } }
        ]
    });
    return chart;
}

/* 19. 平行坐标（支持力导向图点击高亮联动） */
const PARALLEL_ROWS = [
    [80, 70, 65, 45, 25], [65, 75, 60, 35, 18], [70, 85, 70, 40, 20], [60, 65, 55, 38, 22],
    [55, 60, 50, 30, 15], [40, 55, 35, 25, 12], [50, 60, 45, 28, 10], [45, 70, 50, 32, 16]
];

function initParallel() {
    const dom = document.getElementById('parallelChart');
    if (!dom) return;
    const chart = echarts.init(dom);
    chart.setOption({
        tooltip: { ...L_TOOLTIP, formatter: p => {
            const i = INDUS.indexOf(p.data.name);
            return '<b>' + p.data.name + '</b><br/>算力投入 ' + PARALLEL_ROWS[i][0] + ' · 数据规模 ' + PARALLEL_ROWS[i][1] +
                '<br/>人才密度 ' + PARALLEL_ROWS[i][2] + ' · 效率提升 ' + PARALLEL_ROWS[i][3] + '% · 成本降 ' + PARALLEL_ROWS[i][4] + '%';
        }},
        parallelAxis: [
            { dim: 0, name: '算力投入', scale: true }, { dim: 1, name: '数据规模', scale: true },
            { dim: 2, name: '人才密度', scale: true }, { dim: 3, name: '效率提升%', scale: true },
            { dim: 4, name: '成本下降%', scale: true }
        ],
        parallel: { left: 60, right: 30, top: 56, bottom: 60,
            axisName: { color: COLORS.textSub, fontSize: 11 }, axisLabel: { color: COLORS.textSub, fontSize: 10 },
            lineStyle: { color: '#e8edf2' } },
        brush: { xAxisIndex: 0, throttleType: 'debounce', throttleDelay: 120, outOfBrush: { colorAlpha: .1 } },
        series: [{ type: 'parallel', smooth: true,
            data: INDUS.map((n, i) => ({ name: n, value: PARALLEL_ROWS[i] })) }]
    });
    parallelChartInstance = chart;
    applyParallelStyles();
    return chart;
}

/* 由力导向图点击调用：高亮指定行业线，其余弱化 */
function highlightParallel(name) {
    parallelHighlightName = name;
    applyParallelStyles();
}

function applyParallelStyles() {
    if (!parallelChartInstance) return;
    const data = INDUS.map((n, i) => {
        let ls;
        if (!parallelHighlightName) {
            ls = { width: 2.4, opacity: .62, color: COLORS.primary };
        } else if (n === parallelHighlightName) {
            ls = { width: 4.4, opacity: 1, color: COLORS.accent, shadowBlur: 12, shadowColor: 'rgba(245,158,11,.55)' };
        } else {
            ls = { width: 1.2, opacity: .13, color: '#94a3b8' };
        }
        return { name: n, value: PARALLEL_ROWS[i], lineStyle: ls };
    });
    parallelChartInstance.setOption({ series: [{ data }] });
    const sub = document.getElementById('parallelSub');
    if (sub) {
        sub.textContent = parallelHighlightName
            ? '已高亮「' + parallelHighlightName + '」· 再次点击该节点或空白处取消 · 仍可拖拽框选筛选'
            : '每条线=一个行业 · 点击上方关系网络的产业节点可高亮 · 拖拽框选可筛选 · 悬停查看明细';
    }
}

/* 20. 区域 GDP 增量柱 */
function initGdpChart() {
    const dom = document.getElementById('gdpChart');
    if (!dom) return;
    const chart = echarts.init(dom);
    chart.setOption({
        tooltip: { ...L_TOOLTIP, trigger: 'axis', axisPointer: { type: 'shadow' },
            formatter: p => p[0].name + '<br/>GDP 增量 <b>' + p[0].value + ' 万亿美元</b>' },
        grid: { top: 34, left: 14, right: 20, bottom: 30, containLabel: true },
        xAxis: { type: 'category', data: ['中国', '北美', '北欧', '南欧', '其他地区'], ...lAxis(), axisTick: { show: false }, axisLine: { show: false } },
        yAxis: { type: 'value', name: '万亿美元', ...lAxis(), axisLine: { show: false } },
        series: [{
            type: 'bar', barWidth: '46%',
            data: [
                { value: 7.0, itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: COLORS.primary }, { offset: 1, color: COLORS.secondary }]) },
                  label: { show: true, position: 'top', color: COLORS.primary, fontWeight: 700, formatter: '{c}T$' } },
                { value: 3.7, itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: COLORS.secondary }, { offset: 1, color: '#8b5cf6' }]) },
                  label: { show: true, position: 'top', color: COLORS.secondary, fontWeight: 700, formatter: '{c}T$' } },
                { value: 1.8, label: { show: true, position: 'top', color: COLORS.textSub, fontWeight: 600, formatter: '{c}T$' } },
                { value: 0.7, label: { show: true, position: 'top', color: COLORS.textSub, fontWeight: 600, formatter: '{c}T$' } },
                { value: 2.5, label: { show: true, position: 'top', color: COLORS.textSub, fontWeight: 600, formatter: '{c}T$' } }
            ],
            itemStyle: { borderRadius: [6, 6, 0, 0] },
            markLine: { silent: true, symbol: 'none', data: [{ yAxis: 15.7 }],
                lineStyle: { color: COLORS.danger, type: 'dashed', width: 1.6 },
                label: { formatter: '全球合计 15.7 万亿', color: COLORS.danger, fontSize: 10.5 } }
        }]
    });
    return chart;
}

/* 21. AI 能力雷达 */
function initAIRadar() {
    const dom = document.getElementById('aiRadarChart');
    if (!dom) return;
    const chart = echarts.init(dom);
    chart.setOption({
        tooltip: L_TOOLTIP,
        legend: { data: ['AI 2020', 'AI 2024', '人类基准'], top: 0, textStyle: { color: COLORS.textSub, fontSize: 11.5 }, icon: 'circle' },
        radar: {
            indicator: [
                { name: '图像分类', max: 110 }, { name: '阅读理解', max: 110 }, { name: '数学推理', max: 110 },
                { name: '代码生成', max: 110 }, { name: '语言生成', max: 110 }, { name: '常识推理', max: 110 }
            ],
            shape: 'polygon', center: ['50%', '55%'], radius: '62%',
            axisName: { color: COLORS.text, fontSize: 11.5 },
            splitArea: { areaStyle: { color: ['rgba(99,107,241,.03)', 'rgba(99,107,241,.06)'] } },
            splitLine: { lineStyle: { color: '#e8edf2' } },
            axisLine: { lineStyle: { color: '#e8edf2' } }
        },
        series: [{
            type: 'radar', data: [
                { value: [78, 55, 28, 32, 40, 30], name: 'AI 2020',
                  areaStyle: { color: 'rgba(245,158,11,.14)' }, lineStyle: { width: 2, color: COLORS.accent }, itemStyle: { color: COLORS.accent } },
                { value: [105, 98, 72, 85, 96, 58], name: 'AI 2024',
                  areaStyle: { color: 'rgba(99,107,241,.22)' }, lineStyle: { width: 2.5, color: COLORS.primary }, itemStyle: { color: COLORS.primary } },
                { value: [100, 100, 100, 100, 100, 100], name: '人类基准',
                  lineStyle: { width: 1.5, color: COLORS.danger, type: 'dashed' }, itemStyle: { color: COLORS.danger }, symbol: 'none' }
            ]
        }]
    });
    return chart;
}

/* 22. 旭日图（三层各一色系 · 同色系深浅区分细分） */
function initSunburst() {
    const dom = document.getElementById('sunburstChart');
    if (!dom) return;
    const chart = echarts.init(dom);
    chart.setOption({
        tooltip: { ...L_TOOLTIP, formatter: p => {
            if (!p.treePathInfo) return '';
            const path = p.treePathInfo.map(n => n.name).filter(Boolean).join(' / ');
            return path + '<br/>规模：' + p.value + ' 亿元（示意细分）';
        }},
        series: [{
            type: 'sunburst', radius: ['14%', '82%'], center: ['50%', '54%'],
            data: [
                { name: 'AI 产业 9000 亿', itemStyle: { color: '#ffffff' },
                    label: { show: false },
                    children: [
                        { name: '基础层', value: 3100, itemStyle: { color: '#6366f1' },
                            children: [
                                { name: '智算基础设施', value: 1800, itemStyle: { color: '#4f46e5' } },
                                { name: 'AI 芯片', value: 900, itemStyle: { color: '#818cf8' } },
                                { name: '数据服务', value: 400, itemStyle: { color: '#a5b4fc' } }
                            ] },
                        { name: '模型框架层', value: 2500, itemStyle: { color: '#14b8a6' },
                            children: [
                                { name: '通用大模型', value: 1400, itemStyle: { color: '#0f766e' } },
                                { name: '行业模型', value: 700, itemStyle: { color: '#2dd4bf' } },
                                { name: '开源框架', value: 400, itemStyle: { color: '#5eead4' } }
                            ] },
                        { name: '应用层', value: 3400, itemStyle: { color: '#f59e0b' },
                            children: [
                                { name: '智能硬件', value: 1300, itemStyle: { color: '#d97706' } },
                                { name: '智能软件', value: 900, itemStyle: { color: '#fbbf24' } },
                                { name: '行业应用', value: 1200, itemStyle: { color: '#fcd34d' } }
                            ] }
                    ] }
            ],
            label: { color: COLORS.text, fontSize: 11, rotate: 0, minAngle: 12 },
            emphasis: { focus: 'ancestor', itemStyle: { shadowBlur: 18, shadowColor: 'rgba(99,102,241,.4)' } },
            levels: [
                {},
                {},
                { r0: '14%', r: '44%', label: { rotate: 'tangential', fontSize: 12, fontWeight: 700, color: '#fff' } },
                { r0: '44%', r: '82%', label: { fontSize: 10 } }
            ],
            itemStyle: { borderColor: '#fff', borderWidth: 2 }
        }]
    });
    return chart;
}

/* 23. 中国产业规模柱 */
function initCnScaleChart() {
    const dom = document.getElementById('cnScaleChart');
    if (!dom) return;
    const chart = echarts.init(dom);
    chart.setOption({
        tooltip: { ...L_TOOLTIP, trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: v => v + ' 亿元' },
        grid: { top: 34, left: 14, right: 20, bottom: 30, containLabel: true },
        xAxis: { type: 'category', data: ['2022', '2024', '2025E'], ...lAxis(), axisTick: { show: false }, axisLine: { show: false } },
        yAxis: { type: 'value', name: '亿元', ...lAxis(), axisLine: { show: false } },
        series: [{
            type: 'bar', barWidth: '42%',
            data: [
                { value: 5080, itemStyle: { color: 'rgba(100,116,139,.3)' }, label: { show: true, position: 'top', color: COLORS.textSub, fontSize: 11, formatter: '{c} 亿' } },
                { value: 9000, itemStyle: { color: 'rgba(100,116,139,.3)' },
                  label: { show: true, position: 'top', color: COLORS.textSub, fontWeight: 700, fontSize: 12, formatter: '超 {c} 亿' } },
                { value: 12000, itemStyle: { color: 'rgba(20,184,166,.3)', borderColor: COLORS.secondary, borderWidth: 1.5, borderType: 'dashed' },
                  label: { show: true, position: 'top', color: COLORS.secondary, fontWeight: 700, fontSize: 12, formatter: '预计 {c} 亿+' } }
            ],
            itemStyle: { borderRadius: [6, 6, 0, 0] }
        }]
    });
    return chart;
}

/* 24. 回顶按钮 */
function initBackToTop() {
    const btn = document.getElementById('backToTop');
    if (!btn) return;
    window.addEventListener('scroll', () => {
        btn.classList.toggle('show', window.scrollY > 700);
    }, { passive: true });
    btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

/* ========== 初始化 ========== */
window.addEventListener('DOMContentLoaded', () => {
    initParticles();
    initNavbar();
    initCounters();
    initMarketChart();
    initRadarChart();
    initGlobalChart();
    initSankeyChart();
    initComputeChart();
    initSecurityChart();
    initScrollAnimations();
    initSideDots();
    initResize();
    /* 20261009g · 整合 2.html 可视化 */
    initTyping();
    initTicker();
    initWordCloud();
    initModelsChart();
    initForceNetwork();
    initTechSankeyHeat();
    initChinaMap();
    initGauge();
    initParallel();
    initGdpChart();
    initAIRadar();
    initSunburst();
    initCnScaleChart();
    initBackToTop();
});
