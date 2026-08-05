/**
 * OrganSpace v2 — Step-by-step simulation with Q&A.
 */
import { OrganScene } from './scene.js';

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
btnStart.disabled = true;
btnStart.textContent = '⏳ 3D模型加载中...';
document.querySelectorAll('[data-scenario]').forEach(b => b.disabled = true);

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

// --- State ---
let ws = null;
let currentStep = 0;
let totalSteps = 0;
let causalSteps = []; // [{step, organ_id, organ_name, status, explanation, indicators: {...}}]
let scenarioText = '';

// --- WebSocket ---
function connect() {
    if (ws?.readyState === WebSocket.OPEN) return;
    ws = new WebSocket(`ws://${location.hostname}:8765/ws`);

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
function handleMessage(msg) {
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
            addChatMsg('system', `❌ ${msg.message}`);
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

    // Update 3D scene
    scene.setAllConnectionsDim();
    scene.highlightOrgan(step.organ_id, step.status);
    scene.highlightConnectionsForOrgan(step.organ_id, true);
    scene.focusOrgan(step.organ_id);

    // Highlight this organ's connections to previously affected organs
    for (let i = 0; i < idx; i++) {
        scene.animateConnection(causalSteps[i].organ_id, step.organ_id);
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

btnRestart.addEventListener('click', () => {
    btnReset.click();
});

// Resize
window.addEventListener('resize', () => scene.resize());

// --- Init ---
connect();
