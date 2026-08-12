/**
 * 疾病模拟前端模块 — 多 Agent 状态演化仿真
 * 与现有因果链演示（step-by-step）并列的独立模式。
 * 数据流：创建仿真 → 时间步推进（批量）→ 状态更新（指标/曲线/警报/日志）
 */

import { OrganScene } from './scene.js';

// 复用主 app 的 WebSocket（主 app.js 里已建立连接）
// 这里通过自定义事件与主 app 通信，避免重复连接。

const $ = id => document.getElementById(id);

// 面板元素
const panelWelcome = $('panel-welcome');
const panelConfig = $('panel-disease-config');
const panelRun = $('panel-disease-run');
const btnDiseaseMode = $('btn-disease-mode');
const btnDiseaseBack = $('btn-disease-back');
const btnStartDisease = $('btn-start-disease');
const diseaseSelect = $('disease-select');
const severityBtns = document.querySelectorAll('#severity-btns .btn');
const timeStepInput = $('disease-time-step');

// 运行视图元素
const simTitle = $('sim-title');
const simTime = $('sim-time');
const simStep = $('sim-step');
const simAlerts = $('sim-alerts');
const simIndicators = $('sim-indicators');
const simLog = $('sim-log');
const simChartCanvas = $('sim-chart');

// 状态
let simId = null;
let severity = 'severe';            // 默认重度（答辩主 Demo 路径）
let autoTimer = null;
let chart = null;
let chartData = { labels: [], egfr: [], creatinine: [], potassium: [], ph: [], map: [] };
let onSimState = null; // 3D 联动回调
let getWs = null;      // 动态获取 WebSocket（避免捕获 null）
let initialState = null; // 仿真创建时的健康基线（用于基线对照）
let currentStepNum = 0;  // 当前推进到的步数
let lastTime = 0;        // 当前仿真时间
let shownAlertKeys = new Set(); // 已展示的警报 key（避免重复渲染）

// 暴露给主 app 的接口
export function setSimStateCallback(cb) { onSimState = cb; }

/** 发送消息（通过动态获取的 ws，避免 init 时 ws 还是 null） */
function wsSend(ws, payload) {
    const sock = ws || getWs?.();
    if (sock && sock.readyState === WebSocket.OPEN) {
        sock.send(JSON.stringify(payload));
    }
}

// 指标显示配置（含正常区间与恶化方向，用于基线对照）
// direction: 'high' 表示升高为恶化（肌酐/血钾…），'low' 表示降低为恶化（eGFR/pH/尿量…）
const INDICATORS = [
    { path: 'organs.kidney.egfr', name: 'eGFR', unit: 'mL/min', warn: v => v < 60, color: '#a78bfa', normal: [90, 120], direction: 'low' },
    { path: 'blood.systemic.creatinine', name: '肌酐', unit: 'mg/dL', warn: v => v > 1.3, color: '#f59e0b', normal: [0.6, 1.3], direction: 'high' },
    { path: 'blood.systemic.potassium', name: '血钾', unit: 'mmol/L', warn: v => v > 5.5, color: '#ef4444', normal: [3.5, 5.0], direction: 'high' },
    { path: 'blood.systemic.bun', name: '尿素氮', unit: 'mg/dL', warn: v => v > 20, color: '#fb923c', normal: [7, 20], direction: 'high' },
    { path: 'blood.systemic.ph', name: 'pH', unit: '', warn: v => v < 7.35, color: '#60a5fa', normal: [7.35, 7.45], direction: 'low' },
    { path: 'blood.systemic.hco3', name: 'HCO₃⁻', unit: 'mmol/L', warn: v => v < 22, color: '#34d399', normal: [22, 28], direction: 'low' },
    { path: 'blood.systemic.map', name: 'MAP', unit: 'mmHg', warn: v => v > 100, color: '#f472b6', normal: [70, 100], direction: 'high' },
    { path: 'organs.kidney.urine_output', name: '尿量', unit: '%', warn: v => v < 50, color: '#22d3ee', normal: [50, 100], direction: 'low' },
    { path: 'blood.systemic.anion_gap', name: 'AG', unit: 'mmol/L', warn: v => v > 12, color: '#c084fc', normal: [8, 12], direction: 'high' },
];

function getPath(obj, path) {
    return path.split('.').reduce((o, k) => o?.[k], obj);
}

// ===== 模式切换 =====
export function initDiseaseMode(wsGetter, scene) {
    getWs = wsGetter;  // 保存获取 ws 的函数（调用时才取，避免捕获 null）
    // 进入疾病模拟配置
    btnDiseaseMode?.addEventListener('click', () => {
        panelWelcome.classList.add('hidden');
        panelConfig.classList.remove('hidden');
        loadDiseases();
    });
    // 返回欢迎页
    btnDiseaseBack?.addEventListener('click', () => {
        panelConfig.classList.add('hidden');
        panelWelcome.classList.remove('hidden');
    });
    // 严重程度选择
    severityBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            severityBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            severity = btn.dataset.severity;
        });
    });
    // 开始仿真
    btnStartDisease?.addEventListener('click', () => {
        const diseaseId = diseaseSelect.value || 'acute_kidney_injury';
        const timeStep = parseFloat(timeStepInput.value) || 2;
        wsSend(null, {
            type: 'create_disease_sim',
            disease_id: diseaseId,
            severity,
            time_step_sec: timeStep,
        });
    });
    // 时间步控制
    $('btn-tick-1')?.addEventListener('click', () => tick(1));
    $('btn-tick-10')?.addEventListener('click', () => tick(10));
    $('btn-auto-play')?.addEventListener('click', () => toggleAutoPlay());
    $('btn-hemodialysis')?.addEventListener('click', () => applyIntervention('hemodialysis'));
    $('btn-disease-reset')?.addEventListener('click', () => resetDisease());
}

// ===== 加载疾病模板 =====
function loadDiseases() {
    wsSend(null, { type: 'list_diseases' });
}

// ===== 消息处理（主 app 转发） =====
export function handleDiseaseMessage(msg, ws, scene) {
    switch (msg.type) {
        case 'disease_list': {
            diseaseSelect.innerHTML = msg.diseases.map(d =>
                `<option value="${d.id}">${d.name} — ${d.description.slice(0, 30)}…</option>`
            ).join('');
            break;
        }
        case 'sim_created': {
            simId = msg.sim_id;
            initialState = msg.state;   // 保存健康基线（基线对照用）
            currentStepNum = 0;
            lastTime = 0;
            chartData = { labels: [], egfr: [], creatinine: [], potassium: [], ph: [], map: [] };
            shownAlertKeys = new Set();
            panelConfig.classList.add('hidden');
            panelRun.classList.remove('hidden');
            simTitle.textContent = `${msg.disease}（${msg.severity}）`;
            $('sim-interventions').innerHTML = '';
            const tb = $('sim-traces-body');
            if (tb) tb.innerHTML = '<div class="sim-trace-empty">推进时间步后，这里将展示 肾脏 → 血液 → 心血管 各 Agent 读取与修改了什么</div>';
            updateStateDisplay(msg.state, 0, 0);
            initChart();
            addLog(`✅ 仿真创建成功 sim=${simId}`, 'info');
            break;
        }
        case 'intervention_applied': {
            // 治疗干预已应用：刷新指标 + 记录治疗事件
            if (msg.state) {
                updateStateDisplay(msg.state, currentStepNum, lastTime);
            }
            if (msg.events && msg.events.length) {
                const last = msg.events[msg.events.length - 1];
                addIntervention(`🩸 ${last.name}（step ${last.step}，t=${last.time}s）—— ${last.description}`);
            }
            // 3D 联动
            if (onSimState && msg.state) onSimState(msg.state);
            break;
        }
        case 'disease_state': {
            // 批量推进返回：曲线逐点推送，指标卡只渲染最后一步（避免每步全量重建 DOM）
            const steps = msg.steps || [];
            if (steps.length) {
                const last = steps[steps.length - 1];
                for (let i = 0; i < steps.length - 1; i++) {
                    pushChartPoint(steps[i].state, steps[i].step);
                }
                updateStateDisplay(last.state, last.step, last.time);
                // Agent 执行轨迹：展示本批最后一步各 Agent 的读取/修改
                if (last.traces && last.traces.length) {
                    renderTraces(last.traces);
                }
            }
            // 警报（按 key 去重，避免每次 tick 重复渲染历史警报）
            if (msg.alerts && msg.alerts.length) {
                msg.alerts.forEach(a => {
                    const k = a.key || a.message;
                    if (!shownAlertKeys.has(k)) {
                        shownAlertKeys.add(k);
                        addAlert(a.message);
                    }
                });
            }
            // 3D 联动：肾脏高亮
            if (onSimState && steps.length) {
                const last = steps[steps.length - 1];
                onSimState(last.state);
            }
            break;
        }
        case 'disease_log': {
            // 事件日志
            break;
        }
    }
}

// ===== 推进 =====
function tick(steps) {
    if (!simId) return;
    wsSend(null, { type: 'disease_tick', sim_id: simId, steps });
}

// ===== 治疗干预（教学型） =====
function applyIntervention(iv) {
    if (!simId) return;
    wsSend(null, { type: 'disease_intervention', sim_id: simId, intervention: iv });
}

// ===== 干预事件记录 =====
function addIntervention(text) {
    const box = $('sim-interventions');
    const div = document.createElement('div');
    div.className = 'sim-intervention-item';
    div.textContent = text;
    box.appendChild(div);
    addLog(text, 'info');
}

// ===== Agent 执行轨迹面板 =====
// path → 中文显示名（复用 INDICATORS，未登记的直接用末段）
const TRACE_PATH_NAMES = {};
INDICATORS.forEach(ind => { TRACE_PATH_NAMES[ind.path] = ind.name; });
const TRACE_AGENT_ICONS = { renal: '🫘', blood: '🩸', cardiovascular: '❤️' };

function pathDisplayName(path) {
    if (TRACE_PATH_NAMES[path]) return TRACE_PATH_NAMES[path];
    const seg = path.split('.').pop();
    const map = {
        sympathetic: '交感信号', cardiac_output: '心输出量', heart_rate: '心率',
        arrhythmia_risk: '心律失常风险', urine_output: '尿量', perfusion: '肾灌注',
        anion_gap: 'AG', osmolality: '渗透压',
    };
    return map[seg] || seg;
}

function renderTraces(traces) {
    const body = $('sim-traces-body');
    if (!body) return;
    // 按 Agent 分组（保持传播顺序 renal → blood → cardiovascular）
    const order = ['renal', 'blood', 'cardiovascular'];
    const groups = {};
    traces.forEach(t => {
        if (!groups[t.agent]) groups[t.agent] = [];
        groups[t.agent].push(t);
    });
    body.innerHTML = order.filter(a => groups[a]).map(agentId => {
        const entries = groups[agentId];
        const label = entries[0].agent_label || agentId;
        const icon = TRACE_AGENT_ICONS[agentId] || '🧩';
        const rows = entries.map(t => {
            const oldV = t.old === null || t.old === undefined ? '—' : t.old;
            const newV = t.new === null || t.new === undefined ? '—' : t.new;
            const changed = String(oldV) !== String(newV);
            return `<div class="sim-trace-row">
                <span class="trace-path">${pathDisplayName(t.path)}</span>
                <span class="trace-val">${oldV} → ${changed ? `<b>${newV}</b>` : newV}</span>
                <span class="trace-reason">${t.reason || ''}</span>
            </div>`;
        }).join('');
        return `<div class="sim-trace-agent">
            <div class="sim-trace-agent-head">${icon} ${label}</div>
            ${rows}
        </div>`;
    }).join('') || '<div class="sim-trace-empty">本步无状态变更</div>';
}

// ===== 自动播放 =====
function toggleAutoPlay() {
    const btn = $('btn-auto-play');
    if (autoTimer) {
        clearInterval(autoTimer);
        autoTimer = null;
        btn.textContent = '▶ 自动播放';
        btn.classList.remove('active');
    } else {
        btn.textContent = '⏸ 暂停';
        btn.classList.add('active');
        autoTimer = setInterval(() => tick(2), 400);
    }
}

// ===== 重置 =====
function resetDisease() {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    simId = null;
    initialState = null;
    currentStepNum = 0;
    lastTime = 0;
    shownAlertKeys = new Set();
    panelRun.classList.add('hidden');
    panelConfig.classList.remove('hidden');
    simAlerts.innerHTML = '';
    simLog.innerHTML = '';
    $('sim-interventions').innerHTML = '';
    const tb = $('sim-traces-body');
    if (tb) tb.innerHTML = '<div class="sim-trace-empty">推进时间步后，这里将展示 肾脏 → 血液 → 心血管 各 Agent 读取与修改了什么</div>';
    const btn = $('btn-auto-play');
    if (btn) { btn.textContent = '▶ 自动播放'; btn.classList.remove('active'); }
}

// ===== 状态显示更新 =====
// 曲线逐点推送（批量推进时只更新曲线，不重建指标卡 DOM）
function pushChartPoint(state, step) {
    chartData.labels.push(step);
    chartData.egfr.push(getPath(state, 'organs.kidney.egfr'));
    chartData.creatinine.push(getPath(state, 'blood.systemic.creatinine'));
    chartData.potassium.push(getPath(state, 'blood.systemic.potassium'));
    chartData.ph.push(getPath(state, 'blood.systemic.ph'));
    chartData.map.push(getPath(state, 'blood.systemic.map'));
    updateChart();
}

// 完整渲染：指标卡（含基线对照）+ 曲线末点 + 步数/时间
function updateStateDisplay(state, step, time) {
    currentStepNum = step;
    lastTime = time;
    simStep.textContent = `step ${step}`;
    simTime.textContent = `t=${time}s`;
    // 指标卡片（含基线对照：初始值 / 当前值 / 变化幅度 / 正常区间）
    simIndicators.innerHTML = INDICATORS.map(ind => {
        const v = getPath(state, ind.path);
        if (v === undefined || v === null) return '';
        const num = typeof v === 'number' ? v : parseFloat(v);
        const warn = ind.warn ? ind.warn(num) : false;
        const display = ind.path.includes('ph') ? num.toFixed(2) : (num % 1 === 0 ? num : num.toFixed(1));

        // 基线对照：初始值（健康基线）与变化幅度（按指标语义上色：恶化=橙，改善=绿）
        let baselineHtml = '';
        if (initialState) {
            const initV = getPath(initialState, ind.path);
            if (initV !== undefined && initV !== null) {
                const delta = initV !== 0 ? ((num - initV) / Math.abs(initV) * 100) : 0;
                const dStr = (delta > 0 ? '+' : '') + delta.toFixed(1) + '%';
                const worsening = (ind.direction === 'high' && delta > 0) || (ind.direction === 'low' && delta < 0);
                const dCls = Math.abs(delta) > 2 ? (worsening ? 'worse' : 'better') : '';
                baselineHtml = `<span class="ind-baseline">初始 ${initV} · 变化 <em class="${dCls}">${dStr}</em></span>`;
            }
        }
        const normalRange = ind.normal ? `<span class="ind-range">正常 ${ind.normal[0]}–${ind.normal[1]}${ind.unit}</span>` : '';
        return `<div class="sim-ind-card ${warn ? 'warn' : ''}">
            <span class="ind-name">${ind.name}${normalRange}</span>
            <span class="ind-val">${display}<em>${ind.unit}</em></span>
            ${baselineHtml}
        </div>`;
    }).join('');
    // 曲线数据
    pushChartPoint(state, step);
}

// ===== 曲线 =====
function initChart() {
    if (chart) { chart.destroy(); chart = null; }
    const ctx = simChartCanvas.getContext('2d');
    // 本地 Chart.js（vendor/ 已本地化，不依赖外网 CDN）
    if (typeof Chart === 'undefined') {
        const script = document.createElement('script');
        script.src = '/static/vendor/chartjs/chart.umd.js';
        script.onload = () => createChart(ctx);
        document.head.appendChild(script);
    } else {
        createChart(ctx);
    }
}

function createChart(ctx) {
    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chartData.labels,
            datasets: [
                { label: 'eGFR', data: chartData.egfr, borderColor: '#a78bfa', yAxisID: 'y', tension: 0.3, pointRadius: 0 },
                { label: '肌酐', data: chartData.creatinine, borderColor: '#f59e0b', yAxisID: 'y1', tension: 0.3, pointRadius: 0 },
                { label: '血钾', data: chartData.potassium, borderColor: '#ef4444', yAxisID: 'y1', tension: 0.3, pointRadius: 0 },
            ],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { labels: { color: '#9aa7b8', font: { size: 11 } } } },
            scales: {
                x: { ticks: { color: '#5a6b82', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
                y: { type: 'linear', position: 'left', title: { display: true, text: 'eGFR', color: '#a78bfa' }, ticks: { color: '#a78bfa' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                y1: { type: 'linear', position: 'right', title: { display: true, text: '肌酐/钾', color: '#f59e0b' }, ticks: { color: '#f59e0b' }, grid: { drawOnChartArea: false } },
            },
        },
    });
}

function updateChart() {
    if (!chart) return;
    chart.data.labels = chartData.labels;
    chart.data.datasets[0].data = chartData.egfr;
    chart.data.datasets[1].data = chartData.creatinine;
    chart.data.datasets[2].data = chartData.potassium;
    chart.update('none');
}

// ===== 警报与日志 =====
function addAlert(message) {
    const div = document.createElement('div');
    div.className = 'sim-alert-item';
    div.textContent = message;
    simAlerts.appendChild(div);
    addLog(message, 'alert');
}

function addLog(text, type = 'info') {
    const div = document.createElement('div');
    div.className = `sim-log-item ${type}`;
    div.textContent = text;
    simLog.appendChild(div);
    simLog.scrollTop = simLog.scrollHeight;
}
