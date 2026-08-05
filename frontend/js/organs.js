/**
 * Organ definitions with GLB model paths.
 * Positions are approximate — adjust via the debug panel (press D key).
 */
export const ORGAN_DEFS = [
    {
        id: 'cardiovascular',
        name: '心血管',
        color: 0xef4444,
        position: [0, 0, 0],
        scale: 1.0,
        modelPath: '/static/assets/models/heart.glb',
        labelOffset: [0, -0.6, 0],
    },
    {
        id: 'respiratory',
        name: '呼吸系统',
        color: 0x60a5fa,
        position: [0, 0.3, -0.3],
        scale: 1.0,
        modelPath: '/static/assets/models/lung.glb',
        labelOffset: [0, -0.6, 0],
    },
    {
        id: 'hepatic',
        name: '肝脏',
        color: 0x92400e,
        position: [0.3, -0.7, 0],
        scale: 1.0,
        modelPath: '/static/assets/models/liver.glb',
        labelOffset: [0, -0.5, 0],
    },
    {
        id: 'metabolic',
        name: '胃/代谢',
        color: 0x8b5cf6,
        position: [-0.3, -0.4, 0.1],
        scale: 1.0,
        modelPath: '/static/assets/models/stomach.glb',
        labelOffset: [0, -0.4, 0],
    },
    {
        id: 'immune',
        name: '免疫(脾)',
        color: 0x22c55e,
        position: [-0.6, -0.3, -0.2],
        scale: 1.0,
        modelPath: '/static/assets/models/spleen.glb',
        labelOffset: [0, -0.3, 0],
    },
    {
        id: 'renal',
        name: '肾脏',
        color: 0xa78bfa,
        position: [-0.4, -1.0, -0.3],
        scale: 0.5,
        modelPath: null,
        labelOffset: [0, -0.4, 0],
    },
    {
        id: 'nervous',
        name: '神经(脑)',
        color: 0xfbbf24,
        position: [0, 2.2, 0],
        scale: 0.6,
        modelPath: null,
        labelOffset: [0, -0.5, 0],
    },
    {
        id: 'coagulation',
        name: '凝血/胰腺',
        color: 0xea580c,
        position: [0.3, -0.8, 0.1],
        scale: 0.5,
        modelPath: null,
        labelOffset: [0, -0.3, 0],
    },
    {
        id: 'blood',
        name: '血液系统',
        color: 0xdc2626,
        position: [0, 0, 0],
        scale: 0.1,
        modelPath: null,
        labelOffset: [0, 10, 0],
    },
];

// Blood vessels — aorta, vena cava, pulmonary, renal, hepatic, etc.
export const BLOOD_VESSELS = [
    { name: '主动脉', path: [[0,-0.4,0.05],[0,0.3,0.05],[0,0.45,0.0],[-0.05,0.4,-0.05],[-0.1,0.1,-0.1],[-0.15,-0.5,-0.15],[-0.15,-1.1,-0.15]], color: 0xcc2222, radius: 0.035 },
    { name: '上腔静脉', path: [[0.05,0.4,-0.05],[0.05,0.1,-0.05],[0.04,-0.05,0.0]], color: 0x3344cc, radius: 0.035 },
    { name: '下腔静脉', path: [[0.04,-0.05,0.0],[0.06,-0.4,-0.05],[0.08,-0.8,-0.08],[0.08,-1.2,-0.08]], color: 0x3344cc, radius: 0.035 },
    { name: '肺动脉右', path: [[0,0.3,0.08],[0.2,0.35,0.05],[0.3,0.3,0.0]], color: 0x4466cc, radius: 0.025 },
    { name: '肺动脉左', path: [[0,0.3,0.08],[-0.1,0.35,0.05],[-0.2,0.3,0.0]], color: 0x4466cc, radius: 0.025 },
    { name: '肾动脉右', path: [[-0.12,-0.8,-0.15],[0.05,-0.8,-0.2],[0.2,-0.85,-0.25]], color: 0xcc2222, radius: 0.018 },
    { name: '肾动脉左', path: [[-0.12,-0.8,-0.15],[-0.2,-0.85,-0.2],[-0.3,-0.9,-0.25]], color: 0xcc2222, radius: 0.018 },
    { name: '肝动脉', path: [[-0.12,-0.5,-0.15],[0.0,-0.55,-0.1],[0.15,-0.6,-0.05]], color: 0xcc2222, radius: 0.016 },
    { name: '门静脉', path: [[-0.25,-0.45,0.1],[-0.05,-0.55,0.08],[0.15,-0.6,0.02]], color: 0x8866cc, radius: 0.018 },
    { name: '颈动脉', path: [[0,0.45,0.03],[0,1.2,0.05],[0,1.8,0.05]], color: 0xcc2222, radius: 0.02 },
    { name: '脾动脉', path: [[-0.12,-0.5,-0.12],[-0.3,-0.45,-0.15],[-0.45,-0.4,-0.18]], color: 0xcc2222, radius: 0.014 },
];

export const CONNECTIONS = [
    { a: 'cardiovascular', b: 'respiratory', relation: '心肺循环' },
    { a: 'cardiovascular', b: 'renal', relation: '肾灌注/RAAS' },
    { a: 'cardiovascular', b: 'hepatic', relation: '肝血供' },
    { a: 'cardiovascular', b: 'nervous', relation: '脑灌注/自主神经' },
    { a: 'cardiovascular', b: 'metabolic', relation: '激素/营养输送' },
    { a: 'cardiovascular', b: 'coagulation', relation: '血流/血栓' },
    { a: 'respiratory', b: 'blood', relation: '气体交换' },
    { a: 'renal', b: 'hepatic', relation: '肝肾综合征' },
    { a: 'renal', b: 'metabolic', relation: '电解质/酸碱/EPO' },
    { a: 'renal', b: 'blood', relation: 'EPO→红细胞' },
    { a: 'hepatic', b: 'metabolic', relation: '糖脂代谢/合成' },
    { a: 'hepatic', b: 'coagulation', relation: '凝血因子合成' },
    { a: 'immune', b: 'coagulation', relation: '炎症→凝血' },
    { a: 'immune', b: 'nervous', relation: '神经免疫轴' },
    { a: 'immune', b: 'blood', relation: '白细胞生成' },
    { a: 'blood', b: 'coagulation', relation: '血小板/凝血因子' },
    { a: 'metabolic', b: 'nervous', relation: '下丘脑-垂体轴' },
    { a: 'respiratory', b: 'nervous', relation: '呼吸中枢调控' },
];

export const STATUS_COLORS = { normal: 0x22c55e, stressed: 0xeab308, impaired: 0xf97316, failing: 0xef4444 };
export function getOrganDef(id) { return ORGAN_DEFS.find(o => o.id === id); }
