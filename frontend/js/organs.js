/**
 * Organ definitions — 3D position, GLB model path, color, label.
 * GLB models take priority; geometry fallback if no model file.
 */
export const ORGAN_DEFS = [
    {
        id: 'cardiovascular',
        name: '心血管系统',
        color: 0xef4444,
        position: [0, 0.2, 0],
        scale: 1.6,
        modelPath: '/static/assets/models/heart.glb',
        labelOffset: [0, -1.0, 0],
    },
    {
        id: 'respiratory',
        name: '呼吸系统',
        color: 0x60a5fa,
        position: [0, 1.3, -0.3],
        scale: 1.8,
        modelPath: '/static/assets/models/lung.glb',
        labelOffset: [0, -1.0, 0],
    },
    {
        id: 'hepatic',
        name: '肝脏系统',
        color: 0x92400e,
        position: [0.7, -0.1, -0.2],
        scale: 1.5,
        modelPath: '/static/assets/models/stomach.glb',
        labelOffset: [0.5, -0.5, 0],
    },
    {
        id: 'renal',
        name: '肾脏系统',
        color: 0xa78bfa,
        position: [-0.8, -0.6, -0.2],
        scale: 0.3,
        modelPath: null,  // GLB fallback: use geometry
        labelOffset: [-0.5, -0.5, 0],
    },
    {
        id: 'immune',
        name: '免疫系统',
        color: 0x22c55e,
        position: [-0.7, 0.0, 0.5],
        scale: 0.28,
        modelPath: null,
        labelOffset: [0, -0.5, 0],
    },
    {
        id: 'nervous',
        name: '神经系统',
        color: 0xfbbf24,
        position: [0, 2.6, 0],
        scale: 0.35,
        modelPath: null,
        labelOffset: [0, -0.6, 0],
    },
    {
        id: 'blood',
        name: '血液系统',
        color: 0xdc2626,
        position: [0.5, 0.9, 0.5],
        scale: 0.26,
        modelPath: null,
        labelOffset: [0.4, -0.3, 0],
    },
    {
        id: 'coagulation',
        name: '凝血系统',
        color: 0xea580c,
        position: [0.5, -0.9, 0.4],
        scale: 0.24,
        modelPath: null,
        labelOffset: [0.4, -0.3, 0],
    },
    {
        id: 'metabolic',
        name: '代谢与内分泌',
        color: 0x8b5cf6,
        position: [-0.3, -1.4, 0.1],
        scale: 0.30,
        modelPath: null,
        labelOffset: [0, -0.5, 0],
    },
];

export const CONNECTIONS_3D = [
    ['cardiovascular', 'respiratory'],
    ['respiratory', 'blood'],
    ['cardiovascular', 'renal'],
    ['renal', 'hepatic'],
    ['renal', 'metabolic'],
    ['hepatic', 'metabolic'],
    ['cardiovascular', 'metabolic'],
    ['immune', 'coagulation'],
    ['cardiovascular', 'coagulation'],
    ['immune', 'nervous'],
    ['nervous', 'cardiovascular'],
    ['blood', 'immune'],
    ['hepatic', 'coagulation'],
    ['blood', 'coagulation'],
    ['respiratory', 'nervous'],
    ['metabolic', 'nervous'],
    ['renal', 'blood'],
];

export const STATUS_COLORS = {
    normal: 0x22c55e,
    stressed: 0xeab308,
    impaired: 0xf97316,
    failing: 0xef4444,
};

export function getOrganDef(id) {
    return ORGAN_DEFS.find(o => o.id === id);
}
