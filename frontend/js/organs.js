/**
 * Organ definitions — 3D position, GLB model path, color, label.
 * GLB models take priority; geometry fallback if no model file.
 *
 * 说明（2026-08-05 重构）：
 *  - 只保留有真实 GLB 模型的器官 + 骨架。
 *  - 模型合并：胆囊模型实际是「肝与胆囊」连体（原 liver.glb 与 gallbladder.glb
 *    实为同一模型），小肠模型实际是「大肠与小肠」连体（原 large_intestine.glb
 *    与 small_intestine.glb 实为同一模型）→ 删除重复的 liver / large_intestine。
 *  - 命名：心脏 / 肺 / 胃 / 肾脏×2 / 脾脏 / 胰腺 / 肝与胆囊 / 大肠与小肠 / 骨骼。
 *
 * scale 语义：
 *  - scale（解剖比例）：模型内部缩放。基准 = 肝脏 ~1.5L → 1.0，
 *    scale = (器官体积 / 1.5L)^(1/3) / 模型最长边。
 *  - groupScale（布局缩放）：场景中 group 的整体缩放（编辑模式调整）。
 *    最终渲染 = scale(解剖) × groupScale(布局)。
 */
export const ORGAN_DEFS = [
    {
        id: 'heart',
        name: '心脏',
        color: 0xef4444,
        position: [1.434, 2.05, 0.972],
        rotation: [0, 0, 0],
        scale: 0.555,      // ~0.3L（解剖）
        groupScale: 0.481,
        modelPath: '/static/assets/models/heart.glb',
        labelOffset: [0, -1.0, 0],
    },
    {
        id: 'lung',
        name: '肺',
        color: 0x60a5fa,
        position: [1.398, 2.15, 0.877],
        rotation: [-3.142, -3.092, -3.142],
        scale: 1.307,      // 双肺 ~2.5L（解剖）
        groupScale: 0.505,
        modelPath: '/static/assets/models/lung.glb',
        labelOffset: [0, -1.0, 0],
    },
    {
        id: 'stomach',
        name: '胃',
        color: 0xf59e0b,
        position: [1.485, 1.8, 0.954],
        rotation: [0.1, 3.2, 0],
        scale: 0.483,      // 空胃 ~0.15L（解剖）
        groupScale: 1,
        modelPath: '/static/assets/models/stomach.glb',
        labelOffset: [0, -0.5, 0],
        draggable: true,
    },
    {
        id: 'kidney',
        name: '肾脏',
        color: 0xa78bfa,
        position: [1.262, 1.65, 0.834],
        rotation: [2.387, -0.027, -3.038],
        scale: 0.711,      // 双肾 ~0.3L（解剖）
        groupScale: 0.436,
        modelPath: '/static/assets/models/kidney.glb',
        labelOffset: [-0.5, -0.5, 0],
    },
    {
        id: 'kidney_left',
        name: '肾脏（左）',
        color: 0xa78bfa,
        position: [1.631, 1.65, 0.773],
        rotation: [0.7, 0.143, 0],
        scale: 0.711,
        groupScale: 0.416,
        modelPath: '/static/assets/models/kidney_left.glb',
        labelOffset: [-0.5, -0.5, 0],
        draggable: true,
    },
    {
        id: 'spleen',
        name: '脾脏',
        color: 0x22c55e,
        position: [1.571, 1.85, 0.875],
        rotation: [-0.045, 0.238, -1.698],
        scale: 0.422,      // ~0.15L（解剖）
        groupScale: 0.585,
        modelPath: '/static/assets/models/spleen.glb',
        labelOffset: [0, -0.5, 0],
    },
    {
        id: 'pancreas',
        name: '胰腺',
        color: 0x8b5cf6,
        position: [1.5, 1.75, 0.85],
        rotation: [-2.212, -0.354, -3.114],
        scale: 0.348,      // ~0.1L（解剖）
        groupScale: 1,
        modelPath: '/static/assets/models/pancreas.glb',
        labelOffset: [0, -0.5, 0],
    },
    {
        id: 'gallbladder',
        name: '肝与胆囊',
        color: 0x84cc16,
        position: [1.4, 1.75, 0.9],
        rotation: [0, 0, 0],
        scale: 0.972,      // 肝1.5L+胆0.05L ≈ 1.55L（解剖）
        groupScale: 0.577,
        modelPath: '/static/assets/models/gallbladder.glb',
        labelOffset: [0, -0.5, 0],
        draggable: true,
    },
    {
        id: 'small_intestine',
        name: '大肠与小肠',
        color: 0xf472b6,
        position: [1.4, 1.35, 0.85],
        rotation: [0, 0, 0],
        scale: 0.693,      // 大肠0.2L+小肠0.3L ≈ 0.5L（解剖）
        groupScale: 1.25,
        modelPath: '/static/assets/models/small_intestine.glb',
        labelOffset: [0, -0.6, 0],
        draggable: true,
    },
    {
        id: 'skeleton',
        name: '骨骼',
        color: 0xd6cfc7,
        position: [1.447, 1.05, 0.937],
        rotation: [0.057, 0.056, 0.02],
        scale: 1.346,      // 全身骨骼 ~6L（解剖）
        groupScale: 2.487,
        modelPath: '/static/assets/models/skeleton.glb',
        labelOffset: [0, -1.2, 0],
        draggable: true,
    },
];

export const CONNECTIONS_3D = [
    ['heart', 'lung'],
    ['heart', 'kidney'],
    ['kidney', 'pancreas'],
    ['heart', 'pancreas'],
    // 消化链路：胃 → 肝与胆囊 → 大肠与小肠
    ['stomach', 'gallbladder'],
    ['gallbladder', 'small_intestine'],
    ['stomach', 'small_intestine'],
    ['skeleton', 'heart'],
    ['kidney', 'kidney_left'],
    ['spleen', 'heart'],
    ['lung', 'heart'],
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
