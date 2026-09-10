/**
 * Three.js scene — GLB models + geometry fallback + animations.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { ORGAN_DEFS, CONNECTIONS_3D, STATUS_COLORS, getOrganDef } from './organs.js';

// 当前选中器官高亮颜色（编辑模式下点选）
const SELECT_HIGHLIGHT = 0x38bdf8;

// 数值保留 3 位小数，用于导出清单
function round3(v) {
    return Math.round(v * 1000) / 1000;
}

export class OrganScene {
    constructor(canvas, viewportEl) {
        this.canvas = canvas;
        this.viewportEl = viewportEl;
        this.organGroups = {};    // {id: THREE.Group}
        this.connectionLines = {};
        this.organDefs = ORGAN_DEFS;
        this._loaded = false;
        this._editMode = false;
        this._viewLocked = false;     // 锁定视角：OrbitControls 始终禁用
        this._transformMode = 'translate';
        this._selection = null;        // 当前选中的器官 {id, group, def}
        this._scaleGesture = null;     // 等比缩放手势 {id, startY, startScale, dragging}
        this._raycaster = new THREE.Raycaster();
        this._pointer = new THREE.Vector2();
        this._transformControls = null;

        this._initScene();
        this._initLights();
        this._initControls();
        this._initTransformControls();
        this._initKeyboardControl();
        this._loadModels();   // async — draws connections after load
        this.animate();
    }

    _initScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0f1a);
        this.scene.fog = new THREE.Fog(0x0a0f1a, 7, 18);

        const aspect = this.viewportEl.clientWidth / Math.max(this.viewportEl.clientHeight, 1);
        this.camera = new THREE.PerspectiveCamera(50, aspect, 0.3, 20);
        // 相机与 target 保持原相对偏移，随心脏中心平移（默认视角对准心脏）
        this.camera.position.set(2.234, 2.35, 5.472);
        this.camera.lookAt(0, 0.2, 0);

        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
        this.renderer.setSize(this.viewportEl.clientWidth, this.viewportEl.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.2;

        this.labelRenderer = new CSS2DRenderer();
        this.labelRenderer.setSize(this.viewportEl.clientWidth, this.viewportEl.clientHeight);
        this.labelRenderer.domElement.style.position = 'absolute';
        this.labelRenderer.domElement.style.top = '0';
        this.labelRenderer.domElement.style.pointerEvents = 'none';
        this.viewportEl.appendChild(this.labelRenderer.domElement);

        // Ambient particles
        const pGeo = new THREE.BufferGeometry();
        const count = 300;
        const pos = new Float32Array(count * 3);
        for (let i = 0; i < count * 3; i++) pos[i] = (Math.random() - 0.5) * 8;
        pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        this.scene.add(new THREE.Points(pGeo, new THREE.PointsMaterial({
            color: 0x38bdf8, size: 0.008, transparent: true, opacity: 0.4,
        })));
    }

    _initLights() {
        this.scene.add(new THREE.AmbientLight(0x446688, 1.5));
        const key = new THREE.DirectionalLight(0xffffff, 4);
        key.position.set(3, 5, 5);
        this.scene.add(key);
        const fill = new THREE.DirectionalLight(0x88bbff, 1.5);
        fill.position.set(-3, 1, -3);
        this.scene.add(fill);
        const rim = new THREE.DirectionalLight(0xff8866, 0.6);
        rim.position.set(0, -1, 3);
        this.scene.add(rim);
    }

    _initControls() {
        this.controls = new OrbitControls(this.camera, this.canvas);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        // 默认视角中心锁定心脏（器官位置不动，仅对齐观察目标）
        this.controls.target.set(1.434, 2.05, 0.972);
        this.controls.minDistance = 1.5;
        this.controls.maxDistance = 8;
        this.controls.maxPolarAngle = Math.PI * 0.75;
        this.controls.update();
    }

    async _loadModels() {
        const manager = new THREE.LoadingManager();
        const overlay = document.getElementById('loading-overlay');
        const loadText = overlay?.querySelector('span');

        // Step 1: Immediately create fallback geometry for ALL organs
        // This makes the scene interactive instantly (no waiting)
        this.organDefs.forEach(def => {
            const group = new THREE.Group();
            group.position.set(...def.position);
            // 应用默认布局：rotation（欧拉角）+ groupScale（布局缩放）
            if (def.rotation) group.rotation.set(...def.rotation);
            if (def.groupScale) group.scale.setScalar(def.groupScale);
            group.add(this._makeFallbackMesh(def));

            const ringGeo = new THREE.TorusGeometry(0.55, 0.015, 16, 64);
            const ringMat = new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.4 });
            const ring = new THREE.Mesh(ringGeo, ringMat);
            ring.name = 'glow';
            group.add(ring);

            const lbl = document.createElement('div');
            lbl.textContent = def.name;
            lbl.style.cssText = 'color:#8899b4;font-size:11px;font-weight:500;text-shadow:0 0 6px rgba(0,0,0,.8);white-space:nowrap';
            const label = new CSS2DObject(lbl);
            const lo = def.labelOffset;
            label.position.set(lo[0], lo[1], lo[2]);
            group.add(label);

            this.scene.add(group);
            this.organGroups[def.id] = group;
        });

        this._createConnections();
        this._loaded = true;
        window.dispatchEvent(new CustomEvent('scene-ready'));

        // Step 2: Now load GLB models in background, swap them in when ready
        if (loadText) loadText.textContent = '加载精细模型中...';
        overlay?.classList.remove('hidden');

        manager.onProgress = (_url, loaded, total) => {
            if (loadText) loadText.textContent = `加载精细模型中... ${Math.round(loaded / total * 100)}%`;
        };
        manager.onLoad = () => {
            overlay?.classList.add('hidden');
        };

        const loader = new GLTFLoader(manager);
        const dracoLoader = new DRACOLoader(manager);
        dracoLoader.setDecoderPath('/static/vendor/three/libs/draco/');
        loader.setDRACOLoader(dracoLoader);

        // Load GLB files for organs that have them
        const glbPromises = this.organDefs
            .filter(def => def.modelPath)
            .map(def => this._swapGlbModel(loader, def));
        await Promise.all(glbPromises);

        // If onLoad didn't fire
        if (overlay) overlay.classList.add('hidden');
    }

    async _swapGlbModel(loader, def) {
        if (!def.modelPath) return;
        try {
            const gltf = await loader.loadAsync(def.modelPath);
            const group = this.organGroups[def.id];
            if (!group) return;

            // Remove old fallback mesh
            const toRemove = [];
            group.traverse(child => {
                if (child.isMesh && child.userData.organId && child.userData._isFallback !== false) {
                    toRemove.push(child);
                }
            });
            toRemove.forEach(m => {
                if (m.parent) m.parent.remove(m);
                if (m.geometry) m.geometry.dispose();
                if (m.material) m.material.dispose();
            });

            // Add GLB model
            const model = gltf.scene;
            model.scale.setScalar(def.scale);
            const box = new THREE.Box3().setFromObject(model);
            const center = new THREE.Vector3();
            box.getCenter(center);
            model.position.set(-center.x, -center.y, -center.z);

            model.traverse(child => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    child.userData.organId = def.id;
                    child.userData.baseColor = new THREE.Color(def.color);
                    child.userData.originalMaterials = child.material;
                    child.userData._isFallback = false;
                }
            });
            group.add(model);
        } catch (e) {
            console.warn(`GLB load failed for ${def.id}, keeping fallback:`, e.message);
        }
    }


    _makeFallbackMesh(def) {
        const geo = new THREE.SphereGeometry(0.4, 32, 24);
        const mat = new THREE.MeshStandardMaterial({
            color: def.color, roughness: 0.25, metalness: 0.1,
            transparent: true, opacity: 0.85,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.organId = def.id;
        mesh.userData.baseColor = new THREE.Color(def.color);
        mesh.userData.originalMaterials = mat;
        mesh.userData._isFallback = true;  // marked for swap
        return mesh;
    }

    _createConnections() {
        const matTemplate = new THREE.LineBasicMaterial({ color: 0x334466, transparent: true, opacity: 0.35 });
        CONNECTIONS_3D.forEach(([aId, bId]) => {
            const aDef = getOrganDef(aId);
            const bDef = getOrganDef(bId);
            if (!aDef || !bDef) return;
            const points = [new THREE.Vector3(...aDef.position), new THREE.Vector3(...bDef.position)];
            const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), matTemplate.clone());
            line.name = `${aId}-${bId}`;
            line.userData = { fromId: aId, toId: bId };
            this.scene.add(line);
            this.connectionLines[`${aId}-${bId}`] = line;
        });
    }

    // Recompute connection line endpoints from the CURRENT organ group positions.
    // Called after a drag so lines follow moved organs in edit mode.
    _refreshConnectionLine(key) {
        const line = this.connectionLines[key];
        if (!line) return;
        const { fromId, toId } = line.userData;
        const gA = this.organGroups[fromId];
        const gB = this.organGroups[toId];
        if (!gA || !gB) return;
        const points = [gA.position.clone(), gB.position.clone()];
        line.geometry.dispose();
        line.geometry = new THREE.BufferGeometry().setFromPoints(points);
    }

    _refreshAllConnectionLines() {
        Object.keys(this.connectionLines).forEach(key => this._refreshConnectionLine(key));
    }

    // 编辑模式拖动/键盘移动结束后派发轻量检查事件（app.js 监听后做空间检查提示）
    _dispatchMoved() {
        if (this._movedTimer) { clearTimeout(this._movedTimer); }
        this._movedTimer = setTimeout(() => {
            window.dispatchEvent(new CustomEvent('organ-layout-changed'));
        }, 300);
    }

    // --- Public API ---

    // 显示/隐藏指定器官（连接线同步隐藏，避免悬空线）
    setOrganVisible(organId, visible) {
        const group = this.organGroups[organId];
        if (!group) return;
        group.visible = !!visible;
        // 同步连接线：两端都可见才显示
        Object.keys(this.connectionLines).forEach(key => {
            const { fromId, toId } = this.connectionLines[key].userData;
            if (fromId === organId || toId === organId) {
                const gA = this.organGroups[fromId];
                const gB = this.organGroups[toId];
                this.connectionLines[key].visible = !!(gA?.visible && gB?.visible);
            }
        });
        // 若隐藏的是当前选中，取消选中（避免操作不可见对象）
        if (!visible && this._selection && this._selection.id === organId) {
            this.clearSelection();
        }
    }

    getOrganVisibility() {
        const out = {};
        Object.entries(this.organGroups).forEach(([id, group]) => {
            out[id] = group.visible;
        });
        return out;
    }

    highlightOrgan(organId, status) {
        const group = this.organGroups[organId];
        if (!group) return;
        const color = STATUS_COLORS[status] || STATUS_COLORS.normal;

        // Pulse animation on the group
        group.userData.pulseActive = true;
        group.userData.pulseColor = new THREE.Color(color);

        group.traverse(child => {
            if (child.isMesh && child.userData.organId) {
                child.material = child.material.clone?.() || child.material;
                child.material.emissive = new THREE.Color(color);
                child.material.emissiveIntensity = 0.6;
            }
            if (child.name === 'glow') {
                child.material.color.set(color);
                child.material.opacity = 0.8;
            }
        });
    }

    // ===== 局部病灶影响场（空间智能） =====
    /**
     * 放置病灶球。
     * @param {THREE.Vector3} worldPos 世界坐标
     * @param {number} radius 影响半径（场景尺度，默认 1.2）
     */
    placeLesion(worldPos, radius = 1.2) {
        this.clearLesion();
        this._lesion = {
            center: worldPos.clone(),
            radius,
            meshes: [],
            ring: null,
        };
        // 病灶球（半透明红）
        const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(0.09, 24, 24),
            new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.9 })
        );
        sphere.position.copy(worldPos);
        sphere.name = 'lesion-core';
        this.scene.add(sphere);
        this._lesion.meshes.push(sphere);
        // 影响范围环
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(radius * 0.98, radius, 40),
            new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.18, side: THREE.DoubleSide })
        );
        ring.position.copy(worldPos);
        ring.rotation.x = -Math.PI / 2;
        ring.name = 'lesion-ring';
        this.scene.add(ring);
        this._lesion.ring = ring;
        // 影响范围球（极淡，示意半径）
        const halo = new THREE.Mesh(
            new THREE.SphereGeometry(radius, 32, 24),
            new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.06, wireframe: false })
        );
        halo.position.copy(worldPos);
        halo.name = 'lesion-halo';
        this.scene.add(halo);
        this._lesion.meshes.push(halo);
    }

    clearLesion() {
        if (!this._lesion) return;
        this._lesion.meshes.forEach(m => { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); });
        if (this._lesion.ring) { this.scene.remove(this._lesion.ring); this._lesion.ring.geometry.dispose(); this._lesion.ring.material.dispose(); }
        this._lesion = null;
        // 恢复器官高亮
        this.resetLesionHighlights();
    }

    hasLesion() {
        return !!this._lesion;
    }

    getLesion() {
        return this._lesion ? { center: this._lesion.center.clone(), radius: this._lesion.radius } : null;
    }

    /** 按影响强度给器官上色（直间=红 / 高=橙 / 可能=黄）。 */
    applyLesionInfluence(results) {
        this.resetLesionHighlights();
        results.forEach(r => {
            if (r.level && r.strength > 0.02) {
                this._setOrganEmissive(r.id, new THREE.Color(r.level.color), 0.5);
            }
        });
    }

    _setOrganEmissive(organId, color, intensity) {
        const group = this.organGroups[organId];
        if (!group) return;
        group.userData._lesionColor = color.clone();
        group.traverse(child => {
            if (child.isMesh && child.userData.organId) {
                child.material = child.material.clone?.() || child.material;
                child.material.emissive = color.clone();
                child.material.emissiveIntensity = intensity;
            }
            if (child.name === 'glow') {
                child.material.color.set(color);
                child.material.opacity = 0.9;
            }
        });
    }

    resetLesionHighlights() {
        Object.keys(this.organGroups).forEach(id => {
            const group = this.organGroups[id];
            if (!group.userData?._lesionColor) return;
            group.userData._lesionColor = null;
            // 恢复为正常（无病灶时中性高亮）
            this.highlightOrgan(id, 'normal');
        });
    }

    /** 射线拾取：返回命中的器官 id 与命中点世界坐标。 */
    pickOrganAt(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        this._pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        this._pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
        this._raycaster.setFromCamera(this._pointer, this.camera);
        const groups = Object.values(this.organGroups);
        const hits = this._raycaster.intersectObjects(groups, true);
        if (hits.length > 0) {
            let group = hits[0].object;
            while (group && !(group.userData && group.userData.organId) && group.parent) {
                group = group.parent;
            }
            const organId = group.userData?.organId || this._findOrganIdByGroup(group);
            if (organId) {
                return { organId, point: hits[0].point.clone() };
            }
        }
        return null;
    }

    highlightConnection(fromId, toId, active) {
        const key1 = `${fromId}-${toId}`;
        const key2 = `${toId}-${fromId}`;
        const line = this.connectionLines[key1] || this.connectionLines[key2];
        if (line) {
            line.material.color.set(active ? 0x38bdf8 : 0x334466);
            line.material.opacity = active ? 0.9 : 0.35;
        }
    }

    highlightConnectionsForOrgan(organId, active) {
        Object.entries(this.connectionLines).forEach(([key, line]) => {
            if (key.includes(organId)) {
                line.material.color.set(active ? 0x38bdf8 : 0x334466);
                line.material.opacity = active ? 0.85 : 0.35;
            }
        });
    }

    animateConnection(fromId, toId) {
        const key1 = `${fromId}-${toId}`;
        const key2 = `${toId}-${fromId}`;
        const line = this.connectionLines[key1] || this.connectionLines[key2];
        if (!line) return;

        // Flash animation: bright blue → normal
        const start = performance.now();
        const flash = () => {
            const elapsed = performance.now() - start;
            if (elapsed > 1500) {
                line.material.color.set(0x334466);
                line.material.opacity = 0.35;
                return;
            }
            const t = elapsed / 1500;
            const brightness = 1 - t;
            line.material.color.set(
                new THREE.Color().lerpColors(
                    new THREE.Color(0x38bdf8), new THREE.Color(0x334466), t
                )
            );
            line.material.opacity = 0.35 + brightness * 0.55;
            requestAnimationFrame(flash);
        };
        flash();
    }

    setAllConnectionsDim() {
        Object.values(this.connectionLines).forEach(line => {
            line.material.color.set(0x334466);
            line.material.opacity = 0.25;
        });
    }

    resetAll() {
        this.clearSelection();
        Object.entries(this.organGroups).forEach(([id, group]) => {
            const def = getOrganDef(id);
            group.traverse(child => {
                if (child.isMesh && child.userData.organId) {
                    child.material.emissive = new THREE.Color(0x000000);
                    child.material.emissiveIntensity = 0;
                    child.material.color = child.userData.baseColor || new THREE.Color(def?.color || 0xffffff);
                }
                if (child.name === 'glow') {
                    child.material.color.set(0x22c55e);
                    child.material.opacity = 0.4;
                }
            });
            group.userData.pulseActive = false;
        });
        this.setAllConnectionsDim();
    }

    focusOrgan(organId) {
        const def = getOrganDef(organId);
        if (!def) return;
        // Smooth camera pan to face the organ
        const target = new THREE.Vector3(...def.position);
        this.controls.target.lerp(target, 0.3);
    }

    _initTransformControls() {
        this._transformControls = new TransformControls(this.camera, this.renderer.domElement);
        this._transformControls.setSize(0.9);
        this._transformControls.setTranslationSnap(0.05);
        // 拖动变换时禁用 OrbitControls，避免相机跟手打架。
        // 注意：拖完手柄后由 _syncControlsEnabled 统一恢复（不再无条件 enabled=true）
        this._transformControls.addEventListener('dragging-changed', (e) => {
            if (e.value) {
                this.controls.enabled = false;   // 拖动中：必定禁用
            } else {
                this._syncControlsEnabled();     // 拖动结束：按锁定/编辑状态恢复
            }
        });
        // 变换过程中实时刷新连接线
        this._transformControls.addEventListener('objectChange', () => {
            if (this._selection) {
                this._refreshConnectionsFor(this._selection.id);
            }
        });
        // 拖动结束（松开手柄）：触发一次空间检查事件（供 app.js 展示轻量提示）
        this._transformControls.addEventListener('dragging-changed', (e) => {
            if (!e.value) {
                this._dispatchMoved();
            }
        });
        this.scene.add(this._transformControls);
    }

    // ===== 键盘控制（编辑模式 + 选中器官时生效） =====
    // 平移：W/A/S/D（相机平面 XZ）+ Q/E（Y 上下）
    // 旋转：方向键 ↑↓←→（沿世界轴）
    // 缩放：+ / -（等比，0.1x~20x 钳制）
    // 按住 Shift 步进放大
    _initKeyboardControl() {
        this._keyDownHandler = (e) => {
            if (!this._editMode || !this._selection) return;
            // 输入框聚焦时不响应（聊天/场景输入等）
            const tag = document.activeElement?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
            // 修饰键排除
            if (e.metaKey || e.ctrlKey || e.altKey) return;

            const group = this._selection.group;
            const step = e.shiftKey ? 0.25 : 0.05;   // 平移步进
            const rotStep = e.shiftKey ? 0.15 : 0.05; // 旋转步进（弧度）
            const key = e.key.toLowerCase();
            let handled = true;

            switch (key) {
                // ---- 平移（沿相机前方/右方平面 + 世界 Y） ----
                case 'w':
                    group.position.addScaledVector(this.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize(), step);
                    break;
                case 's':
                    group.position.addScaledVector(this.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize(), -step);
                    break;
                case 'a': {
                    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).setY(0).normalize();
                    group.position.addScaledVector(right, -step);
                    break;
                }
                case 'd': {
                    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).setY(0).normalize();
                    group.position.addScaledVector(right, step);
                    break;
                }
                case 'q':
                    group.position.y -= step;
                    break;
                case 'e':
                    group.position.y += step;
                    break;
                // ---- 旋转（世界轴欧拉） ----
                case 'arrowup':
                    group.rotation.x += rotStep;
                    break;
                case 'arrowdown':
                    group.rotation.x -= rotStep;
                    break;
                case 'arrowleft':
                    group.rotation.y -= rotStep;
                    break;
                case 'arrowright':
                    group.rotation.y += rotStep;
                    break;
                // ---- 等比缩放 ----
                case '+':
                case '=':
                    this._keyboardScale(group, 1.05 + (e.shiftKey ? 0.05 : 0));
                    break;
                case '-':
                case '_':
                    this._keyboardScale(group, 1 / (1.05 + (e.shiftKey ? 0.05 : 0)));
                    break;
                default:
                    handled = false;
            }

            if (handled) {
                e.preventDefault();
                this._refreshConnectionsFor(this._selection.id);
            }
        };
        window.addEventListener('keydown', this._keyDownHandler);
        // 键盘操作结束后（松开按键）触发一次空间检查事件（节流）
        window.addEventListener('keyup', () => this._dispatchMoved());
    }

    /** 键盘等比缩放：以当前 scale 为基准乘系数，钳制 0.1~20 */
    _keyboardScale(group, factor) {
        const base = group.scale.clone();
        const target = base.multiplyScalar(factor);
        const s = THREE.MathUtils.clamp(target.x, 0.1, 20);
        group.scale.set(s, s, s);
    }

    /**
     * 锁定/解锁视角。锁定后 OrbitControls 完全禁用（旋转/缩放/平移都被冻结），
     * 即使切换到编辑模式、拖动变换手柄也不会恢复——适合精确操作模型时用。
     */
    setViewLocked(locked) {
        this._viewLocked = !!locked;
        this.viewportEl.classList.toggle('view-locked', this._viewLocked);
        this._syncControlsEnabled();
    }

    isViewLocked() {
        return this._viewLocked;
    }

    // ===== Edit Mode =====
    // 编辑模式：点击选中单个模型 → TransformControls 移动/旋转/缩放 + 导出布局

    setEditMode(enabled) {
        if (!!enabled === !!this._editMode) return;
        this._editMode = !!enabled;

        if (this._editMode) {
            this.controls.enabled = false;
            this.controls.update();
            this.viewportEl.classList.add('edit-mode');
            this.viewportEl.classList.add('edit-mode-active');
            // 编辑模式下允许标签响应点击（CSS2D 默认 pointer-events:none）
            const lbl = this.labelRenderer.domElement;
            lbl.style.pointerEvents = 'none';
            // 开启点选监听
            this.canvas.addEventListener('pointerdown', this._onPick);
        } else {
            this._endScaleGesture();
            this.clearSelection();
            this._syncControlsEnabled();   // 退出编辑模式：按锁定状态恢复
            this.viewportEl.classList.remove('edit-mode', 'edit-mode-active', 'scale-gesture');
            this.canvas.style.cursor = '';
            this.canvas.removeEventListener('pointerdown', this._onPick);
        }
    }

    isEditMode() {
        return this._editMode;
    }

    // 病灶模式：冻结相机（点击放病灶时不允许拖拽旋转）
    setLesionModeActive(on) {
        this._lesionModeActive = !!on;
        this._syncControlsEnabled();
        this.controls.update();
    }

    _syncControlsEnabled() {
        this.controls.enabled = !(this._viewLocked || this._editMode || this._lesionModeActive);
    }

    // --- 点选器官 ---
    _onPick = (event) => {
        if (!this._editMode) return;
        const rect = this.canvas.getBoundingClientRect();
        this._pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this._pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        this._raycaster.setFromCamera(this._pointer, this.camera);
        // 命中所有器官组（递归到 GLB 子网格）
        const groups = Object.values(this.organGroups);
        const hits = this._raycaster.intersectObjects(groups, true);
        if (hits.length > 0) {
            let group = hits[0].object;
            while (group && !(group.userData && group.userData.organId) && group.parent) {
                group = group.parent;
            }
            const organId = group.userData?.organId || this._findOrganIdByGroup(group);
            if (organId) {
                this.selectOrgan(organId);
                // 等比缩放模式：按住模型开始缩放手势
                if (this._transformMode === 'scale' && this._selection) {
                    this._startScaleGesture(event, organId);
                }
                return;
            }
        }
        // 点击空白 → 取消选中
        this.clearSelection();
    };

    // --- 等比缩放手势：按住模型上下拖动，整体缩放 ---
    _startScaleGesture(event, organId) {
        const group = this.organGroups[organId];
        if (!group) return;
        this._scaleGesture = {
            organId,
            startY: event.clientY,
            startScale: group.scale.clone(),
            dragging: false,
        };
        window.addEventListener('pointermove', this._onScaleGestureMove);
        window.addEventListener('pointerup', this._onScaleGestureEnd);
    }

    _onScaleGestureMove = (event) => {
        if (!this._scaleGesture) return;
        const g = this._scaleGesture;
        const group = this.organGroups[g.organId];
        if (!group) return;
        g.dragging = true;
        // 灵敏度：每 200px 拖动 ≈ 缩放 ±100%
        const dy = event.clientY - g.startY;
        const factor = 1 + dy / 200;
        // 限制范围 0.1x ~ 20x，避免缩没/炸出屏幕
        const clamped = THREE.MathUtils.clamp(g.startScale.x * factor, 0.1, 20);
        // 等比缩放：三轴同值
        const ratio = clamped / g.startScale.x;
        group.scale.set(g.startScale.x * ratio, g.startScale.y * ratio, g.startScale.z * ratio);
        this._refreshConnectionsFor(g.organId);
    };

    _onScaleGestureEnd = () => {
        window.removeEventListener('pointermove', this._onScaleGestureMove);
        window.removeEventListener('pointerup', this._onScaleGestureEnd);
        this._scaleGesture = null;
    };

    _endScaleGesture() {
        this._onScaleGestureEnd();
    }

    _findOrganIdByGroup(group) {
        for (const [id, g] of Object.entries(this.organGroups)) {
            if (g === group) return id;
        }
        return null;
    }

    selectOrgan(organId) {
        const group = this.organGroups[organId];
        if (!group) return;
        // 先恢复上一个选中
        if (this._selection && this._selection.id !== organId) {
            this._clearSelectionHighlight();
        }
        this._selection = { id: organId, group, def: getOrganDef(organId) };
        this._applySelectionHighlight();
        if (this._transformMode === 'scale') {
            // 等比缩放模式不显示分轴手柄
            this._transformControls.detach();
            this._transformControls.visible = false;
        } else {
            this._transformControls.attach(group);
        }
        window.dispatchEvent(new CustomEvent('organ-selected', {
            detail: { id: organId, name: this._selection.def?.name || organId },
        }));
    }

    clearSelection() {
        this._endScaleGesture();
        if (!this._selection) return;
        this._clearSelectionHighlight();
        this._transformControls.detach();
        this._selection = null;
        window.dispatchEvent(new CustomEvent('organ-selected', { detail: null }));
    }

    getSelection() {
        return this._selection;
    }

    _applySelectionHighlight() {
        if (!this._selection) return;
        this._selection.group.traverse(child => {
            if (child.isMesh && child.userData.organId) {
                if (!child.userData._origEmissive) {
                    child.userData._origEmissive = child.material.emissive?.clone?.() || null;
                }
                if (child.material.emissive) {
                    child.material.emissive.set(SELECT_HIGHLIGHT);
                    child.material.emissiveIntensity = 0.5;
                }
            }
        });
    }

    _clearSelectionHighlight() {
        if (!this._selection) return;
        this._selection.group.traverse(child => {
            if (child.isMesh && child.userData.organId && child.userData._origEmissive) {
                child.material.emissive?.copy(child.userData._origEmissive);
                child.material.emissiveIntensity = 0;
                delete child.userData._origEmissive;
            }
        });
    }

    // --- 变换模式 ---
    setTransformMode(mode) {
        if (!this._transformControls) return;
        if (!['translate', 'rotate', 'scale'].includes(mode)) return;
        this._transformMode = mode;
        if (mode === 'scale') {
            // 等比缩放：隐藏 TransformControls 分轴手柄，改用"按住模型上下拖"手势
            this._transformControls.detach();
            this._transformControls.visible = false;
            this.viewportEl.classList.add('scale-gesture');
            this.canvas.style.cursor = 'ns-resize';
        } else {
            this._transformControls.setMode(mode);
            this._transformControls.visible = true;
            if (this._selection) this._transformControls.attach(this._selection.group);
            this.viewportEl.classList.remove('scale-gesture');
            this.canvas.style.cursor = '';
        }
    }

    getTransformMode() {
        return this._transformMode || this._transformControls?.mode || 'translate';
    }

    // --- 连接线跟随 ---
    _refreshConnectionsFor(organId) {
        Object.keys(this.connectionLines).forEach(key => {
            const { fromId, toId } = this.connectionLines[key].userData;
            if (fromId === organId || toId === organId) this._refreshConnectionLine(key);
        });
    }

    // --- 导出位置清单 ---
    // 返回 JSON 字符串：所有器官的 id/name/position/rotation/scale
    exportLayout() {
        const organs = Object.entries(this.organGroups).map(([id, group]) => {
            const def = getOrganDef(id);
            const p = group.position;
            const r = group.rotation;
            const s = group.scale;
            return {
                id,
                name: def?.name || id,
                position: { x: round3(p.x), y: round3(p.y), z: round3(p.z) },
                rotation: { x: round3(r.x), y: round3(r.y), z: round3(r.z) },
                scale: { x: round3(s.x), y: round3(s.y), z: round3(s.z) },
            };
        });
        return JSON.stringify({
            version: 1,
            exported_at: new Date().toISOString(),
            organs,
        }, null, 2);
    }

    // 导出 CSV（简洁版，含表头）
    exportLayoutCsv() {
        const rows = [['id', 'name', 'position_x', 'position_y', 'position_z', 'rotation_x', 'rotation_y', 'rotation_z', 'scale_x', 'scale_y', 'scale_z']];
        Object.entries(this.organGroups).forEach(([id, group]) => {
            const def = getOrganDef(id);
            const p = group.position, r = group.rotation, s = group.scale;
            rows.push([id, def?.name || id,
                round3(p.x), round3(p.y), round3(p.z),
                round3(r.x), round3(r.y), round3(r.z),
                round3(s.x), round3(s.y), round3(s.z)]);
        });
        return rows.map(row => row.map(v => `"${v}"`).join(',')).join('\n');
    }

    resize() {
        const w = this.viewportEl.clientWidth;
        const h = this.viewportEl.clientHeight;
        this.camera.aspect = w / Math.max(h, 1);
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
        this.labelRenderer.setSize(w, h);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        this.controls.update();

        const t = Date.now() * 0.001;

        // Pulse effect on highlighted organs
        Object.values(this.organGroups).forEach(group => {
            if (group.userData.pulseActive) {
                const c = group.userData.pulseColor;
                const intensity = 0.3 + 0.3 * Math.sin(t * 3);
                group.traverse(child => {
                    if (child.isMesh && child.userData.organId && child.material.emissive) {
                        child.material.emissive = c;
                        child.material.emissiveIntensity = intensity;
                    }
                });
            }
            // Gentle ring rotation
            const ring = group.getObjectByName('glow');
            if (ring) ring.rotation.z += 0.002;
        });

        this.renderer.render(this.scene, this.camera);
        this.labelRenderer.render(this.scene, this.camera);
    }
}
