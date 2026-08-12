/**
 * OrganSpace v2 — Step-by-step simulation with Q&A.
 */
import { OrganScene } from './scene.js?v=15';
import { initDiseaseMode, handleDiseaseMessage, setSimStateCallback } from './disease.js';
import { OrganSpatialRegistry, LESION_LEVELS } from './spatial.js';

// --- DOM elements ---
const $ = id => document.getElementById(id);
const viewport = $('viewport');
const canvas = $('three-canvas');
const statusDot = $('status-dot');
const loadingOverlay = $('loading-overlay');

// Panel states
const panelWelcome = $('panel-welcome');
const panelStep = $('panel-step');
const panelComplete = $('panel-complete');

// Step elements
const stepProgress = $('step-progress');
const stepBadge = $('step-badge');
const stepOrganName = $('step-organ');
const stepStatus = $('step-status');
const stepExplain = $('step-explain');
const stepIndicators = $('step-indicators');
const stepChatMsgs = $('step-chat-msgs');
const stepChatInput = $('step-chat-input');
const organQuickBtns = $('organ-quick-btns');
const btnPrev = $('btn-prev');
const btnNext = $('btn-next');
const btnChatSend = $('btn-chat-send');

// Welcome elements
const scenarioInput = $('scenario-input');
const btnStart = $('btn-start');
const completeSummary = $('complete-summary');
const completeCausalMap = $('complete-causal-map');
const btnRestart = $('btn-restart');
const btnReset = $('btn-reset');

// --- Init Scene ---
// MUST add event listener BEFORE creating OrganScene,
// because _loadModels() dispatches 'scene-ready' synchronously in the constructor.
let sceneReady = false;
let spatialRegistry = null;

window.addEventListener('scene-ready', () => {
    sceneReady = true;
    btnStart.disabled = false;
    btnStart.textContent = '开始模拟';
    document.querySelectorAll('[data-scenario]').forEach(b => b.disabled = false);
});

const scene = new OrganScene(canvas, viewport);

// Edge case: if scene-ready already fired synchronously during constructor
if (scene._loaded) {
    sceneReady = true;
    btnStart.disabled = false;
    btnStart.textContent = '开始模拟';
    document.querySelectorAll('[data-scenario]').forEach(b => b.disabled = false);
}

// 空间智能：GLB 加载完成后建立器官几何注册表与邻近图
// （GLB 可能仍在异步加载，延后 1.5s 建表，加载完成后 spatial-ready 由 GLB 加载回调刷新）
function initSpatialRegistry() {
    spatialRegistry = new OrganSpatialRegistry(scene.organGroups);
    // 调试/演示句柄：答辩时可在浏览器 Console 直接检查空间计算（如 __organspace.spatial.nearestNeighbors('kidney')）
    window.__organspace = { scene, spatialRegistry };
    window.dispatchEvent(new CustomEvent('spatial-ready'));
}
window.addEventListener('spatial-ready', () => {
    // 延迟到 GLB 全部换入后刷新一次（包围盒更精确）
    setTimeout(() => {
        if (spatialRegistry) spatialRegistry.refresh();
    }, 2500);
});
setTimeout(initSpatialRegistry, 1500);

// --- State ---
let ws = null;
let currentStep = 0;
let totalSteps = 0;
let causalSteps = []; // [{step, organ_id, organ_name, status, explanation, indicators: {...}}]
let scenarioText = '';

// 后端 agent id → 前端 3D 器官 id 映射
// （后端保留系统级 agent：cardiovascular/respiratory/...；前端场景用真实器官名）
const ORGAN_ID_MAP = {
    cardiovascular: 'heart',
    respiratory: 'lung',
    hepatic: 'gallbladder',     // 肝已并入「肝与胆囊」连体模型
    renal: 'kidney',
    immune: 'spleen',
    metabolic: 'pancreas',
    // 无 3D 模型的系统（blood/coagulation/nervous）映射到 null，高亮时跳过
    blood: null,
    coagulation: null,
    nervous: null,
};
function mapOrganId(backendId) {
    return Object.prototype.hasOwnProperty.call(ORGAN_ID_MAP, backendId)
        ? ORGAN_ID_MAP[backendId]
        : backendId;
}

// --- WebSocket ---
// 同源连接：直接复用页面所在 host 与协议（https 时自动用 wss），
// 消除现场部署时端口/协议不一致导致的连接失败风险。
function connect() {
    if (ws?.readyState === WebSocket.OPEN) return;
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${protocol}://${location.host}/ws`);

    ws.onopen = () => {
        statusDot.className = 'status-dot connected';
    };

    ws.onclose = () => {
        statusDot.className = 'status-dot disconnected';
        setTimeout(connect, 3000);
    };

    ws.onmessage = (e) => {
        try {
            const msg = JSON.parse(e.data);
            console.log('[WS]', msg.type, msg);
            handleMessage(msg);
        } catch (err) {
            console.error('[WS] parse/handle error:', err);
        }
    };
}

function send(msg) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// --- Message Handler ---
// 疾病模拟消息类型（转发给 disease.js 处理）
const DISEASE_MSG_TYPES = ['disease_list', 'sim_created', 'disease_state', 'disease_log', 'intervention_applied'];

function handleMessage(msg) {
    // 疾病模拟消息优先转发
    if (DISEASE_MSG_TYPES.includes(msg.type)) {
        handleDiseaseMessage(msg, ws, scene);
        return;
    }
    switch (msg.type) {
        case 'causal_chain':
            if (window._simTimeout) { clearTimeout(window._simTimeout); window._simTimeout = null; }
            causalSteps = msg.steps || [];
            totalSteps = causalSteps.length;
            currentStep = 0;
            buildProgressDots();
            showStep(0);
            statusDot.className = 'status-dot connected';
            break;

        case 'chat_reply':
            addChatMsg('system', msg.message);
            break;

        case 'organ_reply':
            addChatMsg('organ', `🤖 ${msg.organ_name}: ${msg.message}`);
            break;

        case 'step_update':
            // Update the current step's indicators with latest data
            if (causalSteps[currentStep] && msg.state) {
                causalSteps[currentStep].indicators = msg.state.indicators;
                causalSteps[currentStep].status = msg.state.overall_status;
                renderStepContent(causalSteps[currentStep]);
            }
            break;

        case 'simulation_complete':
            showComplete(msg.summary);
            statusDot.className = 'status-dot connected';
            break;

        case 'error':
            // 疾病模拟模式下显示到警报区（可见），否则显示到因果链聊天区
            const runPanel = $('panel-disease-run');
            const cfgPanel = $('panel-disease-config');
            const inDiseaseMode = (runPanel && !runPanel.classList.contains('hidden')) ||
                                  (cfgPanel && !cfgPanel.classList.contains('hidden'));
            if (inDiseaseMode && $('sim-alerts')) {
                const div = document.createElement('div');
                div.className = 'sim-alert-item';
                div.textContent = `❌ ${msg.message}`;
                $('sim-alerts').appendChild(div);
            } else {
                addChatMsg('system', `❌ ${msg.message}`);
            }
            statusDot.className = 'status-dot connected';
            break;

        case 'status':
            statusDot.className = 'status-dot simulating';
            break;
    }
}

// --- Step Navigation ---
function showStep(idx) {
    if (idx < 0 || idx >= totalSteps) return;
    currentStep = idx;
    const step = causalSteps[idx];

    // Switch panel state
    panelWelcome.classList.add('hidden');
    panelComplete.classList.add('hidden');
    panelStep.classList.remove('hidden');

    // Render step content
    renderStepContent(step);

    // Update 3D scene（用映射后的前端器官 id）
    const sceneId = mapOrganId(step.organ_id);
    scene.setAllConnectionsDim();
    if (sceneId) {
        scene.highlightOrgan(sceneId, step.status);
        scene.highlightConnectionsForOrgan(sceneId, true);
        scene.focusOrgan(sceneId);
    }

    // Highlight this organ's connections to previously affected organs
    for (let i = 0; i < idx; i++) {
        const fromId = mapOrganId(causalSteps[i].organ_id);
        const toId = mapOrganId(step.organ_id);
        if (fromId && toId) scene.animateConnection(fromId, toId);
    }

    // Update progress dots
    updateProgressDots(idx);

    // Nav buttons
    btnPrev.disabled = idx === 0;
    btnNext.disabled = idx >= totalSteps - 1;
    btnNext.textContent = idx >= totalSteps - 1 ? '完成 →' : '下一步 →';

    // Clear chat
    stepChatMsgs.innerHTML = '';
    addChatMsg('system', `💡 当前是"${step.organ_name}"受到影响的阶段。你可以提问了解更多细节，或点击下一步继续。`);

    // Populate organ quick buttons for this step's connected organs
    updateOrganQuickBtns(step.organ_id);
}

function renderStepContent(step) {
    try {
        stepBadge.textContent = `步骤 ${currentStep + 1}/${totalSteps}`;
        stepOrganName.textContent = step.organ_name || step.organ_id || '未知';
        stepStatus.textContent = statusLabel(step.status || 'normal');
        stepStatus.className = `step-status ${step.status || 'normal'}`;
        stepExplain.textContent = step.explanation || '';

        if (step.indicators && typeof step.indicators === 'object') {
            stepIndicators.innerHTML = Object.entries(step.indicators).map(([key, ind]) => {
                if (!ind || typeof ind !== 'object') return '';
                const val = ind.value ?? ind;
                const cls = ['high','low','critical'].includes(ind.status) ? ind.status : 'normal';
                return `<div class="indicator-card">
                    <span class="ind-name">${ind.name || key}</span>
                    <span class="ind-val ${cls}">${val} ${ind.unit || ''}</span>
                </div>`;
            }).join('');
        }
    } catch (e) {
        console.error('renderStepContent error:', e);
    }
}

function statusLabel(s) {
    const map = { normal: '正常', stressed: '应激', impaired: '受损', failing: '衰竭' };
    return map[s] || s;
}

function buildProgressDots() {
    stepProgress.innerHTML = causalSteps.map((s, i) => {
        return `${i > 0 ? '<span class="step-line"></span>' : ''}
        <span class="step-dot" data-idx="${i}">${i + 1}</span>`;
    }).join('');
}

function updateProgressDots(idx) {
    stepProgress.querySelectorAll('.step-dot').forEach((dot, i) => {
        dot.classList.remove('active', 'done', 'failing');
        if (i < idx) dot.classList.add('done');
        else if (i === idx) dot.classList.add('active');
    });

    stepProgress.querySelectorAll('.step-line').forEach((line, i) => {
        line.classList.toggle('done', i < idx);
    });
}

function addChatMsg(type, text) {
    const div = document.createElement('div');
    div.className = `chat-msg ${type}`;
    div.textContent = text;
    stepChatMsgs.appendChild(div);
    stepChatMsgs.scrollTop = stepChatMsgs.scrollHeight;
}

// --- Organ Quick Buttons ---
function updateOrganQuickBtns(_currentOrganId) {
    organQuickBtns.innerHTML = causalSteps.map(s => {
        if (s.organ_id === causalSteps[currentStep]?.organ_id) return '';
        return `<button class="btn btn-sm" data-organ="${s.organ_id}">@${s.organ_name}</button>`;
    }).join('');
}

// --- Complete ---
function showComplete(summary) {
    panelStep.classList.add('hidden');
    panelComplete.classList.remove('hidden');
    completeSummary.textContent = summary;

    completeCausalMap.innerHTML = causalSteps.map((s, i) => {
        const arrow = i < causalSteps.length - 1 ? '<span class="arrow">→</span>' : '';
        return `<span class="causal-chip">${s.organ_name}${arrow}</span>`;
    }).join('');

    scene.setAllConnectionsDim();
}

// --- Event Handlers ---

// Start simulation
btnStart.addEventListener('click', () => {
    scenarioText = scenarioInput.value.trim();
    if (!scenarioText) return;
    startSimulation(scenarioText);
});

function startSimulation(text) {
    if (!sceneReady) {
        return;
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert('未连接到服务器，请确保已启动后端服务 (python server.py)');
        return;
    }
    scenarioText = text;
    panelWelcome.classList.add('hidden');
    statusDot.className = 'status-dot simulating';

    showStepLoading();
    send({ type: 'start_simulation', scenario: text });

    // Timeout: if no causal_chain arrives within 45s, show error
    if (window._simTimeout) clearTimeout(window._simTimeout);
    window._simTimeout = setTimeout(() => {
        if (!causalSteps.length) {
            panelStep.classList.add('hidden');
            panelWelcome.classList.remove('hidden');
            btnStart.disabled = false;
            btnStart.textContent = '开始模拟';
            alert('⏱ 模拟超时。请检查：\n1. 服务器是否正常运行\n2. DeepSeek API key 是否有效\n3. 网络连接是否正常');
        }
    }, 45000);
}

function showStepLoading() {
    panelStep.classList.remove('hidden');
    stepBadge.textContent = '准备中...';
    stepOrganName.textContent = '分析场景';
    stepStatus.textContent = '...';
    stepStatus.className = 'step-status';
    stepExplain.textContent = '正在分析你的场景，生成器官间因果传播链...';
    stepIndicators.innerHTML = '';
    stepChatMsgs.innerHTML = '';
    btnPrev.disabled = true;
    btnNext.disabled = true;
}

function addSystemMsg(text) {
    const div = document.createElement('div');
    div.className = 'chat-msg system';
    div.textContent = text;
    stepChatMsgs.appendChild(div);
}

// Quick scenarios
document.querySelectorAll('[data-scenario]').forEach(btn => {
    btn.addEventListener('click', () => {
        scenarioInput.value = btn.dataset.scenario;
        startSimulation(btn.dataset.scenario);
    });
});

// Next / Prev
btnNext.addEventListener('click', () => {
    if (currentStep >= totalSteps - 1) {
        // Finish — request summary
        send({ type: 'finish_simulation' });
    } else {
        showStep(currentStep + 1);
        send({ type: 'step_changed', step: currentStep });
    }
});

btnPrev.addEventListener('click', () => {
    if (currentStep > 0) {
        showStep(currentStep - 1);
    }
});

// Chat
function sendChat() {
    const text = stepChatInput.value.trim();
    if (!text) return;
    addChatMsg('user', text);
    stepChatInput.value = '';

    // Check for @organ mention
    const organMatch = text.match(/@(\S+)/);
    if (organMatch) {
        const organQuery = organMatch[1];
        // Try to find matching organ from causal steps
        const matched = causalSteps.find(s =>
            s.organ_name.includes(organQuery) || s.organ_id === organQuery
        );
        if (matched) {
            send({ type: 'ask_organ', organ_id: matched.organ_id, message: text });
            return;
        }
    }

    send({ type: 'chat', message: text, step: currentStep });
}

btnChatSend.addEventListener('click', sendChat);
stepChatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat();
});

// Organ quick buttons (delegation)
organQuickBtns.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON' && e.target.dataset.organ) {
        const organId = e.target.dataset.organ;
        addChatMsg('user', `@${organId} 你现在状态如何？`);
        send({ type: 'ask_organ', organ_id: organId, message: '你现在状态如何？受到了什么影响？' });
    }
});

// Reset
btnReset.addEventListener('click', () => {
    send({ type: 'reset' });
    scene.resetAll();
    currentStep = 0;
    totalSteps = 0;
    causalSteps = [];
    stepProgress.innerHTML = '';
    panelStep.classList.add('hidden');
    panelComplete.classList.add('hidden');
    panelWelcome.classList.remove('hidden');
});

// Edit mode toggle
const btnEditMode = $('btn-edit-mode');
const btnLockView = $('btn-lock-view');
const viewportHint = $('viewport-hint');
const editToolbar = $('edit-toolbar');
const editSelected = $('edit-selected');
const editModeBtns = document.querySelectorAll('.edit-mode-btn');

// 防御：元素可能因 HTML/JS 缓存不同步而缺失，缺失时跳过绑定，避免整个模块崩溃
// （否则 $() 返回 null → .addEventListener 抛错 → 后续所有事件绑定失效）
if (btnLockView) {
    function updateViewLockUI(locked) {
        btnLockView.classList.toggle('active', locked);
        btnLockView.setAttribute('aria-pressed', String(locked));
        btnLockView.textContent = locked ? '🔓' : '🔒';
        btnLockView.title = locked ? '已锁定视角：点击解锁' : '锁定视角：冻结相机旋转/缩放/平移';
        if (locked) {
            viewportHint.textContent = '🔒 视角已锁定（相机冻结，可自由操作模型）· 点击 🔓 解锁';
        }
    }

    // 锁定视角开关
    btnLockView.addEventListener('click', () => {
        const locked = !scene.isViewLocked();
        scene.setViewLocked(locked);
        updateViewLockUI(locked);
        // 若处于编辑模式，提示同步
        if (scene.isEditMode() && !locked) {
            updateEditModeUI(true);
        }
    });
}

function updateEditModeUI(on) {
    btnEditMode.classList.toggle('active', on);
    btnEditMode.setAttribute('aria-pressed', String(on));
    editToolbar.classList.toggle('hidden', !on);
    if (on) {
        if (scene.isViewLocked()) {
            viewportHint.textContent = '✏️ 编辑模式 + 🔒 视角锁定：点击模型操作（Esc 退出）';
        } else {
            const mode = scene.getTransformMode();
            const hints = {
                translate: '点击模型选中：拖动手柄平移，或 WASD/QE 键盘平移',
                rotate: '点击模型选中：拖动手柄旋转，或方向键键盘旋转',
                scale: '点击模型选中：上下拖动等比缩放，或 +/- 键盘缩放',
            };
            viewportHint.textContent = `✏️ 编辑模式：${hints[mode] || hints.translate}（Esc 退出）`;
        }
    } else if (!scene.isViewLocked()) {
        viewportHint.textContent = '🖱 拖拽旋转 | 滚轮缩放 | 右键平移';
    }
    if (on) btnEditMode.classList.add('pulse-once');
}

if (btnEditMode) {
    btnEditMode.addEventListener('click', () => {
        const on = !scene.isEditMode();
        scene.setEditMode(on);
        updateEditModeUI(on);
    });
}

// 选中状态变化
window.addEventListener('organ-selected', (e) => {
    if (!e.detail) {
        editSelected.textContent = '点击 3D 场景中的模型以选中';
    } else {
        editSelected.textContent = `已选中：${e.detail.name}`;
    }
});

// 变换模式切换（移动/旋转/缩放）
editModeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        editModeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        scene.setTransformMode(btn.dataset.mode);
        // 更新操作提示
        const hints = {
            translate: '✋ 移动模式：拖动手柄沿轴平移模型',
            rotate: '🔄 旋转模式：拖动手柄绕轴旋转模型',
            scale: '🔍 缩放模式：按住模型上下拖动等比缩放',
        };
        viewportHint.textContent = `✏️ 编辑模式：${hints[btn.dataset.mode] || ''}（Esc 退出）`;
    });
});

// 下载文件辅助
function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// 导出位置清单 JSON
$('btn-export-json').addEventListener('click', () => {
    if (!scene.isEditMode()) return;
    const layout = scene.exportLayout();
    downloadFile(`organspace-layout-${Date.now()}.json`, layout, 'application/json');
    editSelected.textContent = '✅ 位置清单已导出 (JSON)';
});

// 导出位置清单 CSV
$('btn-export-csv').addEventListener('click', () => {
    if (!scene.isEditMode()) return;
    const csv = scene.exportLayoutCsv();
    downloadFile(`organspace-layout-${Date.now()}.csv`, csv, 'text/csv;charset=utf-8');
    editSelected.textContent = '✅ 位置清单已导出 (CSV)';
});

// ===== 模型显示/隐藏面板 =====
const visibilityPanel = $('visibility-panel');
const visibilityList = $('visibility-list');
const btnToggleVisibility = $('btn-toggle-visibility');
const btnVisibilityClose = $('btn-visibility-close');

function buildVisibilityList() {
    const vis = scene.getOrganVisibility();
    visibilityList.innerHTML = Object.entries(vis).map(([id, shown]) => {
        const def = scene.organDefs?.find?.(d => d.id === id) || {};
        const name = def.name || id;
        const hasModel = def.modelPath ? '· 3D' : '';
        return `<label class="visibility-item" title="${hasModel ? '有真实模型' : '占位几何体'}">
            <input type="checkbox" data-organ="${id}" ${shown ? 'checked' : ''}>
            <span>${name}</span>
            <em>${hasModel}</em>
        </label>`;
    }).join('');
}

function openVisibilityPanel() {
    if (!scene.isEditMode()) return;
    buildVisibilityList();
    visibilityPanel.classList.remove('hidden');
}

function closeVisibilityPanel() {
    visibilityPanel.classList.add('hidden');
}

btnToggleVisibility.addEventListener('click', () => {
    visibilityPanel.classList.contains('hidden') ? openVisibilityPanel() : closeVisibilityPanel();
});

btnVisibilityClose.addEventListener('click', closeVisibilityPanel);

// 勾选切换（事件委托）
visibilityList.addEventListener('change', (e) => {
    if (e.target.matches('input[type="checkbox"]')) {
        const organId = e.target.dataset.organ;
        scene.setOrganVisible(organId, e.target.checked);
        // 若已选中该器官且被取消显示，状态栏同步
        if (!e.target.checked && scene.getSelection()?.id === organId) {
            editSelected.textContent = '点击 3D 场景中的模型以选中';
        }
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && scene.isEditMode()) {
        scene.setEditMode(false);
        updateEditModeUI(false);
    }
    if (e.key === 'Escape' && !visibilityPanel.classList.contains('hidden')) {
        closeVisibilityPanel();
    }
});

btnRestart.addEventListener('click', () => {
    btnReset.click();
});

// Resize
window.addEventListener('resize', () => scene.resize());

// ===== 局部病灶影响场（空间智能） =====
const btnLesionMode = $('btn-lesion-mode');
const lesionPanel = $('lesion-panel');
const lesionStatus = $('lesion-status');
const lesionList = $('lesion-list');
const btnLesionClose = $('btn-lesion-close');
const btnLesionClear = $('btn-lesion-clear');
const lesionHint = document.querySelector('.lesion-hint');

let lesionModeOn = false;

function updateLesionModeUI(on) {
    lesionModeOn = on;
    btnLesionMode.classList.toggle('active', on);
    btnLesionMode.setAttribute('aria-pressed', String(on));
    scene.setLesionModeActive(on);   // 病灶模式冻结相机：点击放病灶时不旋转视角
    if (on) {
        // 病灶模式与编辑模式互斥
        if (scene.isEditMode()) scene.setEditMode(false);
        viewportHint.textContent = '🎯 病灶模式：点击器官放置病灶球（Esc 退出）';
        canvas.style.cursor = 'crosshair';
    } else {
        viewportHint.textContent = scene.isViewLocked() ? '🔒 视角已锁定（相机冻结，可自由操作模型）· 点击 🔓 解锁' : '🖱 拖拽旋转 | 滚轮缩放 | 右键平移';
        canvas.style.cursor = '';
    }
}

function openLesionPanel() {
    lesionPanel.classList.remove('hidden');
    if (!lesionStatus.textContent.includes('📍')) {
        lesionStatus.textContent = '🎯 点击 3D 场景中的器官放置病灶';
    }
}

function closeLesionPanel() {
    lesionPanel.classList.add('hidden');
}

function computeAndShowLesion() {
    if (!spatialRegistry || !scene.hasLesion()) return;
    const lesion = scene.getLesion();
    const results = spatialRegistry.computeLesionInfluence(lesion.center, lesion.radius);

    // 3D 热力高亮
    scene.applyLesionInfluence(results);

    // 面板：最近命中器官 + 空间叙述（邻近结构 / 可能受影响）
    const hit = results[0];
    lesionStatus.innerHTML = hit
        ? `📍 病灶中心：${getOrganName(hit.id)} 表面<br><span class="lesion-sub">影响半径 ${lesion.radius.toFixed(2)}（场景尺度，非临床测量值）</span>`
        : '📍 病灶已放置';

    // 空间叙述：邻近结构（受影响的按强度排序）+ 可能受扩散影响的器官
    const affected = results.filter(r => r.level && r.strength > 0.15);
    const nearList = results.slice(0, 5);
    let narrative = '';
    if (nearList.length) {
        const nearText = nearList.slice(1).map((r, i) =>
            `${i + 1}. ${getOrganName(r.id)}，距离 ${r.distance.toFixed(2)}`
        ).join('；');
        narrative += `<div class="lesion-narrative">📐 <b>空间邻近结构：</b><br>${nearText || '（病灶位于场景边缘）'}</div>`;
    }
    if (affected.length > 1) {
        const likely = affected.slice(1).slice(0, 3).map(r => getOrganName(r.id)).join('、');
        narrative += `<div class="lesion-narrative">⚠️ <b>可能受压迫或扩散影响的器官：</b>${likely}</div>`;
    }
    lesionList.innerHTML = narrative + results.slice(0, 6).map(r => {
        const lv = r.level;
        const levelCls = lv ? lv.level : 'none';
        const levelLabel = lv ? lv.label : '超出影响范围';
        const strengthPct = Math.round(r.strength * 100);
        return `<div class="lesion-item">
            <span class="lesion-organ">${getOrganName(r.id)}</span>
            <span class="lesion-dist">距离 ${r.distance.toFixed(2)}</span>
            <span class="lesion-level ${levelCls}">${levelLabel}</span>
            <span class="lesion-strength">${strengthPct}%</span>
        </div>`;
    }).join('');
}

function getOrganName(id) {
    const def = scene.organDefs?.find?.(d => d.id === id);
    return def?.name || id;
}

btnLesionMode.addEventListener('click', () => {
    const on = !lesionModeOn;
    updateLesionModeUI(on);
    if (on) openLesionPanel();
});

// 病灶模式下点击场景放置病灶
canvas.addEventListener('pointerdown', (e) => {
    if (!lesionModeOn) return;
    const pick = scene.pickOrganAt(e.clientX, e.clientY);
    if (pick) {
        scene.placeLesion(pick.point, 1.2);
        computeAndShowLesion();
    }
});

btnLesionClose.addEventListener('click', closeLesionPanel);
btnLesionClear.addEventListener('click', () => {
    scene.clearLesion();
    lesionStatus.textContent = '未放置病灶';
    lesionList.innerHTML = '';
});

// ===== 空间合理性检查（把编辑器升级为空间智能辅助组装工具） =====
const btnSanityCheck = $('btn-sanity-check');
const sanityResults = $('sanity-results');

btnSanityCheck.addEventListener('click', () => {
    if (!spatialRegistry) {
        sanityResults.innerHTML = '<div class="sanity-empty">空间注册表未就绪，请稍候重试</div>';
        return;
    }
    const issues = spatialRegistry.checkSpatialSanity();
    if (!issues.length) {
        sanityResults.innerHTML = '<div class="sanity-item ok">✅ 未发现明显空间异常（高度/侧别/穿模均在合理范围）</div>';
        return;
    }
    sanityResults.innerHTML = issues.slice(0, 8).map(iss => {
        const cls = iss.level === 'error' ? 'bad' : 'warn';
        return `<div class="sanity-item ${cls}">${iss.level === 'error' ? '❌' : '⚠️'} ${iss.message}</div>`;
    }).join('');
});

// ===== 解剖约束自动排列（规则求解器） =====
const btnAnatomyArrange = $('btn-anatomy-arrange');
const anatomyResults = $('anatomy-results');

btnAnatomyArrange.addEventListener('click', () => {
    if (!spatialRegistry) {
        anatomyResults.innerHTML = '<div class="sanity-empty">空间注册表未就绪</div>';
        return;
    }
    const before = spatialRegistry.anatomyDeviation();
    const moves = spatialRegistry.autoArrangeAnatomically(120);
    // 刷新连接线（器官移动后连线跟随）
    scene.refreshAllConnections?.() || scene._refreshAllConnectionLines?.();
    const after = spatialRegistry.anatomyDeviation();
    const top = after.details.slice(0, 5).map(d =>
        `<div class="sanity-item warn">📍 ${d.name}：${d.desc}（偏差 ${d.deviation.toFixed(2)}）</div>`
    ).join('');
    anatomyResults.innerHTML = `
        <div class="sanity-item ok">✅ 已按解剖约束重新排列 ${moves.length} 个器官</div>
        <div class="sanity-item warn">📊 总偏差 ${before.total.toFixed(2)} → ${after.total.toFixed(2)}</div>
        ${top}`;
    // 若病灶存在，刷新影响场
    if (scene.hasLesion()) computeAndShowLesion();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lesionModeOn) {
        updateLesionModeUI(false);
        closeLesionPanel();
    }
});

// 编辑模式激活时退出病灶模式
const _origSetEditMode = scene.setEditMode.bind(scene);
scene.setEditMode = (on) => {
    if (on && lesionModeOn) updateLesionModeUI(false);
    return _origSetEditMode(on);
};

// ===== 编辑模式拖拽后自动空间检查（轻量提示条，不阻塞操作） =====
window.addEventListener('organ-layout-changed', () => {
    if (!spatialRegistry || scene.isEditMode() === false) return;
    // 只提示 error 级异常（穿模严重/左右颠倒/高度出区），避免频繁打扰
    const issues = spatialRegistry.checkSpatialSanity().filter(i => i.level === 'error');
    if (!issues.length) return;
    const toast = document.createElement('div');
    toast.className = 'space-toast';
    toast.innerHTML = `🧭 ${issues[0].message}（共 ${issues.length} 项，可在病灶面板查看详情）`;
    viewport.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
});

// ===== 疾病模拟模式初始化 =====
// 传获取 ws 的函数（调用时才取，避免 init 时 ws 还是 null）
initDiseaseMode(() => ws, scene);
// 3D 联动：疾病状态变化时，肾脏按 eGFR 健康度高亮
setSimStateCallback((state) => {
    const egfr = state.organs?.kidney?.egfr;
    if (egfr === undefined) return;
    // eGFR 决定状态色：≥90 正常 / 60-89 应激 / 30-59 受损 / <30 衰竭
    let status = 'normal';
    if (egfr < 30) status = 'failing';
    else if (egfr < 60) status = 'impaired';
    else if (egfr < 90) status = 'stressed';
    scene.highlightOrgan('kidney', status);
    scene.highlightConnectionsForOrgan('kidney', true);
});

// --- Init ---
connect();
