/**
 * 空间智能模块 — 让三维几何数据参与判断，而不只是展示。
 *
 * 功能：
 *  1. 器官空间语义注册表：GLB 加载后自动计算包围盒 / 几何中心 / 尺寸 / 近似体积 / 主轴；
 *  2. 空间邻近图：中心距离、包围盒相交、最近邻（区别于功能关系图 CONNECTIONS_3D）；
 *  3. 局部病灶影响场：点击放置病灶球，按器官表面到病灶的距离做衰减计算，
 *     输出影响强度（红=直接病灶 / 橙=高风险邻近 / 黄=可能受影响）与邻近器官列表。
 *
 * 设计约束（答辩口径）：
 *  - 距离为归一化空间距离（相对场景尺度），不伪装成临床测量值。
 */

import * as THREE from 'three';

// 影响强度分级（距离衰减）
export const LESION_LEVELS = [
    { max: 0.35, label: '直接病灶', color: '#ef4444', level: 'direct' },
    { max: 0.65, label: '高风险邻近', color: '#f97316', level: 'high' },
    { max: 1.0, label: '可能受影响', color: '#eab308', level: 'possible' },
];

// 距离衰减函数：r ∈ [0,1]（相对影响半径），1 = 最强，0 = 无影响
export function falloff(r, sharpness = 2.2) {
    return Math.max(0, 1 - Math.pow(r, sharpness));
}

export class OrganSpatialRegistry {
    /**
     * @param {Object} organGroups  scene.organGroups（id → THREE.Group）
     */
    constructor(organGroups) {
        this.organGroups = organGroups;
        this.entries = {};        // id → {center, box, size, volume, axes}
        this.proximity = {};      // id → [{id, distance, normalized}]
        this.maxDist = 1;         // 场景最大中心距（归一化基准）
        this._recompute();
    }

    /** 遍历所有器官，提取包围盒/中心/尺寸/体积/主轴。 */
    _recompute() {
        const ids = Object.keys(this.organGroups);
        const tmpBox = new THREE.Box3();
        const tmpCenter = new THREE.Vector3();

        ids.forEach(id => {
            const group = this.organGroups[id];
            if (!group) return;
            const box = new THREE.Box3().setFromObject(group);
            box.getCenter(tmpCenter);
            const size = new THREE.Vector3();
            box.getSize(size);

            // 包围盒近似体积（归一化：以最大器官体积为 1）
            const volume = Math.max(size.x * size.y * size.z, 1e-6);

            this.entries[id] = {
                center: tmpCenter.clone(),
                box: box.clone(),
                size: size.clone(),
                volume,
                // 主轴：最长轴方向（粗略，供空间语义使用）
                mainAxis: size.x >= size.y && size.x >= size.z ? 'x'
                        : (size.y >= size.z ? 'y' : 'z'),
            };
        });

        // 两两距离矩阵 → 邻近图
        const dists = [];
        ids.forEach((a, i) => {
            for (let j = i + 1; j < ids.length; j++) {
                const b = ids[j];
                if (!this.entries[a] || !this.entries[b]) continue;
                const d = this.entries[a].center.distanceTo(this.entries[b].center);
                dists.push({ a, b, d });
            }
        });
        this.maxDist = Math.max(...dists.map(x => x.d), 1e-6);

        // 归一化距离 + 包围盒相交标记
        this.proximity = {};
        ids.forEach(id => (this.proximity[id] = []));
        dists.forEach(({ a, b, d }) => {
            const norm = d / this.maxDist;
            const intersects = this.entries[a].box.intersectsBox(this.entries[b].box);
            this.proximity[a].push({ id: b, distance: d, normalized: norm, intersects });
            this.proximity[b].push({ id: a, distance: d, normalized: norm, intersects });
        });

        // 按距离排序
        Object.keys(this.proximity).forEach(id => {
            this.proximity[id].sort((x, y) => x.distance - y.distance);
        });
    }

    /** 场景几何就绪后可刷新（GLB 加载完成后调用）。 */
    refresh() {
        this._recompute();
    }

    /** 某个器官的最近邻（排除自身）。 */
    nearestNeighbors(organId, k = 4) {
        return (this.proximity[organId] || []).slice(0, k);
    }

    /** 两器官中心距离。 */
    distanceBetween(a, b) {
        const ea = this.entries[a], eb = this.entries[b];
        if (!ea || !eb) return null;
        return ea.center.distanceTo(eb.center);
    }

    /** 病灶影响：对每个器官计算表面-病灶距离 → 影响强度。 */
    computeLesionInfluence(lesionCenter, radius) {
        const out = [];
        Object.entries(this.entries).forEach(([id, e]) => {
            // 用器官中心到病灶中心的距离近似表面距离（教学简化）
            const dist = e.center.distanceTo(lesionCenter);
            const r = radius > 0 ? dist / radius : 2;   // >1 表示超出影响半径
            const strength = falloff(Math.min(r, 1));
            let level = null;
            if (r <= 1) {
                level = LESION_LEVELS.find(l => r <= l.max) || LESION_LEVELS[LESION_LEVELS.length - 1];
            }
            out.push({ id, distance: dist, normalized: r, strength, level });
        });
        out.sort((a, b) => a.distance - b.distance);
        return out;
    }

    // ==================== 空间合理性检查 ====================
    // 依据意见书第二部分第 6 节：左右轴判断 / 高度区间 / 中心距离 / 包围盒相交 /
    // 与骨架锚点偏差。把编辑器从"纯拖拽"升级为"空间智能辅助组装"。

    /**
     * 对当前布局做空间合理性检查。
     * @returns {Array<{level:'error'|'warn', organ:string, message:string}>}
     */
    checkSpatialSanity() {
        const issues = [];
        const skeleton = this.entries['skeleton'];
        const bodyCenter = skeleton ? skeleton.center : new THREE.Vector3(0, 1.2, 0.8);
        const bodySize = skeleton ? skeleton.size.clone() : new THREE.Vector3(1.5, 2.4, 0.8);

        // 解剖先验（语义注册表的一部分）：各器官应处的人体区域与侧别
        const ANATOMY = {
            heart:        { region: 'chest',  side: 'left',  relY: 0.55 },  // 胸腔中心偏左
            lung:         { region: 'chest',  side: 'left',  relY: 0.60 },
            kidney:       { region: 'abdomen', side: 'right', relY: 0.45 },
            kidney_left:  { region: 'abdomen', side: 'left',  relY: 0.45 },
            liver:        { region: 'abdomen', side: 'right', relY: 0.45 },
            gallbladder:  { region: 'abdomen', side: 'right', relY: 0.45 },  // 肝与胆囊连体
            spleen:       { region: 'abdomen', side: 'left',  relY: 0.48 },
            stomach:      { region: 'abdomen', side: 'left',  relY: 0.42 },
            pancreas:     { region: 'abdomen', side: 'center', relY: 0.44 },
            small_intestine: { region: 'abdomen', side: 'center', relY: 0.30 },
            skeleton:     { region: 'body', side: 'center', relY: 0.5 },
        };

        Object.entries(this.entries).forEach(([id, e]) => {
            if (id === 'skeleton') return;   // 骨架是参照物
            const a = ANATOMY[id];
            if (!a) return;
            const name = this._organName(id);
            const rel = e.center.clone().sub(bodyCenter);
            // relY 统一约定：相对骨架中心，中心=0.5、顶部≈1.0、底部≈0（与排列/偏差计算一致）
            const relY = rel.y / Math.max(bodySize.y, 0.1) + 0.5;

            // 1. 高度区间（相对骨架）：胸腔器官应在上半身，腹部器官在中下部
            const regionY = a.region === 'chest' ? 0.62 : 0.42;
            const yDev = Math.abs(relY - regionY);
            if (yDev > 0.22) {
                issues.push({
                    level: yDev > 0.35 ? 'error' : 'warn',
                    organ: name,
                    message: yDev > 0.35
                        ? `高度异常：${name} 位于胸腔/腹腔区域外（relY=${relY.toFixed(2)}）`
                        : `高度偏离：${name} 偏离其体区参考高度（relY=${relY.toFixed(2)}）`,
                });
            }

            // 2. 左右侧判断（相对身体中轴）：心脏偏左但不应到身体右侧
            if (a.side === 'left' && rel.x > 0.5) {
                issues.push({ level: 'error', organ: name, message: `左右异常：${name} 应位于身体左侧，当前偏右` });
            }
            if (a.side === 'right' && rel.x < -0.5) {
                issues.push({ level: 'error', organ: name, message: `左右异常：${name} 应位于身体右侧，当前偏左` });
            }
        });

        // 3. 包围盒相交检查：除连体模型外，正常器官不应大面积穿模
        const ids = Object.keys(this.entries);
        ids.forEach((a, i) => {
            for (let j = i + 1; j < ids.length; j++) {
                const b = ids[j];
                if (a === 'skeleton' || b === 'skeleton') continue;   // 骨架允许被器官"放置"其上
                const ea = this.entries[a], eb = this.entries[b];
                if (!ea || !eb) continue;
                // 连体模型豁免（模型本身一体）
                const conjoined = (a === 'gallbladder' && b === 'small_intestine') || (b === 'gallbladder' && a === 'small_intestine');
                if (conjoined) continue;
                if (ea.box.intersectsBox(eb.box)) {
                    const ov = this._intersectVolume(ea.box, eb.box);
                    const volA = ea.volume, volB = eb.volume;
                    const ratio = Math.min(ov / Math.max(volA, volB), 1);
                    if (ratio > 0.3) {
                        issues.push({
                            level: 'error',
                            organ: `${this._organName(a)} 与 ${this._organName(b)}`,
                            message: `穿模严重：${this._organName(a)} 与 ${this._organName(b)} 重叠约 ${(ratio * 100).toFixed(0)}%`,
                        });
                    } else if (ratio > 0.1) {
                        issues.push({
                            level: 'warn',
                            organ: `${this._organName(a)} 与 ${this._organName(b)}`,
                            message: `穿模提示：${this._organName(a)} 与 ${this._organName(b)} 有 ${(ratio * 100).toFixed(0)}% 重叠`,
                        });
                    }
                }
            }
        });

        return issues;
    }

    _intersectVolume(boxA, boxB) {
        const min = new THREE.Vector3(
            Math.max(boxA.min.x, boxB.min.x),
            Math.max(boxA.min.y, boxB.min.y),
            Math.max(boxA.min.z, boxB.min.z)
        );
        const max = new THREE.Vector3(
            Math.min(boxA.max.x, boxB.max.x),
            Math.min(boxA.max.y, boxB.max.y),
            Math.min(boxA.max.z, boxB.max.z)
        );
        const sizeX = Math.max(0, max.x - min.x);
        const sizeY = Math.max(0, max.y - min.y);
        const sizeZ = Math.max(0, max.z - min.z);
        return sizeX * sizeY * sizeZ;
    }

    _organName(id) {
        const names = {
            heart: '心脏', lung: '肺', stomach: '胃', kidney: '肾脏',
            kidney_left: '左肾', spleen: '脾脏', pancreas: '胰腺',
            gallbladder: '肝与胆囊', small_intestine: '大肠与小肠', skeleton: '骨骼',
        };
        return names[id] || id;
    }

    // ==================== 解剖约束自动组装（规则求解器） ====================
    // 依据意见书第二部分第 2 节：用简单规则求解器/迭代调整器替代纯手动坐标。
    // 约束以「相对骨架锚点 + 器官间相对关系」表达，最小化加权偏差（位置/侧别/距离/穿模）。

    // 解剖锚点模板（相对骨架包围盒中心，场景尺度）
    static ANATOMY_TEMPLATE = {
        heart:         { side: 'left',  relY: 0.62, offsetX: -0.10, offsetZ: 0.00, desc: '胸腔中心偏左、双肺之间、膈肌上方' },
        lung:          { side: 'left',  relY: 0.64, offsetX: -0.30, offsetZ: 0.00, desc: '胸腔两侧，覆盖心脏' },
        stomach:       { side: 'left',  relY: 0.40, offsetX: 0.15,  offsetZ: 0.05, desc: '左上腹，胃底贴膈肌' },
        kidney:        { side: 'right', relY: 0.44, offsetX: 0.28,  offsetZ: 0.12, desc: '右侧腹膜后，脊柱右侧' },
        kidney_left:   { side: 'left',  relY: 0.44, offsetX: -0.28, offsetZ: 0.12, desc: '左侧腹膜后，脊柱左侧' },
        spleen:        { side: 'left',  relY: 0.47, offsetX: -0.42, offsetZ: 0.10, desc: '左上腹，胃左上方' },
        pancreas:      { side: 'center', relY: 0.42, offsetX: 0.00, offsetZ: 0.10, desc: '腹膜后横位，位于胃后方' },
        gallbladder:   { side: 'right', relY: 0.44, offsetX: 0.38,  offsetZ: -0.08, desc: '右上腹，肝右叶下方' },
        small_intestine: { side: 'center', relY: 0.30, offsetX: 0.00, offsetZ: 0.00, desc: '中下腹，围绕脐周' },
    };

    /** 计算当前布局相对解剖模板的总偏差（加权）。越小越接近解剖合理布局。 */
    anatomyDeviation() {
        const skeleton = this.entries['skeleton'];
        if (!skeleton) return { total: 0, details: [] };
        const base = skeleton.center.clone();
        const bodyY = Math.max(skeleton.size.y, 0.1);

        const details = [];
        let total = 0;
        Object.entries(OrganSpatialRegistry.ANATOMY_TEMPLATE).forEach(([id, tpl]) => {
            const e = this.entries[id];
            if (!e) return;
            const rel = e.center.clone().sub(base);
            // relY 统一约定：相对骨架中心（中心=0.5，顶≈1.0，底≈0）——与排列/检查一致
            const relY = rel.y / bodyY + 0.5;
            // 1. 高度偏差
            const dY = Math.abs(relY - tpl.relY);
            // 2. 侧别偏差（场景 x 轴：负=左，正=右）
            const sign = tpl.side === 'left' ? -1 : (tpl.side === 'right' ? 1 : 0);
            const dX = sign !== 0 ? Math.abs(rel.x - sign * Math.abs(tpl.offsetX)) : Math.abs(rel.x);
            // 3. 前后偏差
            const dZ = Math.abs(rel.z - tpl.offsetZ);
            const dev = dY * 1.0 + dX * 0.8 + dZ * 0.4;
            total += dev;
            details.push({ id, name: this._organName(id), deviation: dev, desc: tpl.desc });
        });
        details.sort((a, b) => b.deviation - a.deviation);
        return { total, details };
    }

    /**
     * 迭代求解：把器官调整到解剖约束的目标位置。
     * @param {number} iterations 迭代次数
     * @returns {Array<{id, from, to}>} 发生移动的器官
     */
    autoArrangeAnatomically(iterations = 120) {
        const skeleton = this.entries['skeleton'];
        if (!skeleton) return [];
        const base = skeleton.center.clone();
        const bodyY = Math.max(skeleton.size.y, 0.1);
        const TPL = OrganSpatialRegistry.ANATOMY_TEMPLATE;

        // 目标位置（直接由模板计算，一次到位；迭代仅做轻微扰动规避穿模）
        const moves = [];
        Object.entries(TPL).forEach(([id, tpl]) => {
            const group = this.organGroups[id];
            if (!group) return;
            const e = this.entries[id];
            const sign = tpl.side === 'left' ? -1 : (tpl.side === 'right' ? 1 : 0);
            const target = new THREE.Vector3(
                base.x + (sign !== 0 ? sign * Math.abs(tpl.offsetX) : 0),
                // relY 统一约定：中心=0.5、顶≈1.0、底≈0（与 anatomyDeviation/checkSpatialSanity 一致）
                base.y + (tpl.relY - 0.5) * bodyY,
                base.z + tpl.offsetZ
            );
            const from = e.center.clone();
            moves.push({ id, name: this._organName(id), from, to: target });
            // 增量移动：让器官几何中心精确落在 target（保留原 rotation/scale）
            const delta = target.clone().sub(e.center);
            group.position.add(delta);
        });

        // 轻量防穿模迭代：若两器官中心过近（< 各自包围盒尺寸和的一半），推开
        for (let iter = 0; iter < Math.min(iterations, 60); iter++) {
            let moved = false;
            const ids = Object.keys(this.organGroups).filter(id => id !== 'skeleton');
            for (let i = 0; i < ids.length; i++) {
                for (let j = i + 1; j < ids.length; j++) {
                    const a = ids[i], b = ids[j];
                    const ga = this.organGroups[a], gb = this.organGroups[b];
                    if (!ga || !gb) continue;
                    const da = this.entries[a], db = this.entries[b];
                    if (!da || !db) continue;
                    const minDist = (da.size.length() + db.size.length()) * 0.22;
                    const cur = da.center.clone();
                    const diff = cur.clone().sub(db.center);
                    const dist = diff.length();
                    if (dist < minDist && dist > 1e-4) {
                        const push = diff.normalize().multiplyScalar((minDist - dist) * 0.5);
                        ga.position.add(push);
                        moved = true;
                    }
                }
            }
            this._recompute();   // 刷新包围盒（迭代内位置变化）
            if (!moved) break;
        }
        this._recompute();
        return moves.map(m => ({
            id: m.id, name: m.name,
            from: { x: m.from.x, y: m.from.y, z: m.from.z },
            to: { x: m.to.x, y: m.to.y, z: m.to.z },
        }));
    }
}
