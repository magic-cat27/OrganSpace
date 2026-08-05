/**
 * Three.js scene — GLB models + geometry fallback + animations.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { ORGAN_DEFS, CONNECTIONS_3D, STATUS_COLORS, getOrganDef } from './organs.js';

export class OrganScene {
    constructor(canvas, viewportEl) {
        this.canvas = canvas;
        this.viewportEl = viewportEl;
        this.organGroups = {};    // {id: THREE.Group}
        this.connectionLines = {};
        this.organDefs = ORGAN_DEFS;
        this._loaded = false;

        this._initScene();
        this._initLights();
        this._initControls();
        this._loadModels();   // async — draws connections after load
        this.animate();
    }

    _initScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0f1a);
        this.scene.fog = new THREE.Fog(0x0a0f1a, 7, 18);

        const aspect = this.viewportEl.clientWidth / Math.max(this.viewportEl.clientHeight, 1);
        this.camera = new THREE.PerspectiveCamera(50, aspect, 0.3, 20);
        this.camera.position.set(0.8, 0.5, 4.5);
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
        this.controls.target.set(0, 0.2, 0);
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
        dracoLoader.setDecoderPath('https://unpkg.com/three@0.160.0/examples/jsm/libs/draco/');
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
            this.scene.add(line);
            this.connectionLines[`${aId}-${bId}`] = line;
        });
    }

    // --- Public API ---

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
