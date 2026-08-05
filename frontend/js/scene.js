/**
 * Three.js scene — GLB models + procedural organs + blood vessel tubes.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ORGAN_DEFS, BLOOD_VESSELS, CONNECTIONS, STATUS_COLORS, getOrganDef } from './organs.js';

export class OrganScene {
    constructor(canvas, viewportEl) {
        this.canvas = canvas; this.viewportEl = viewportEl;
        this.organGroups = {}; this.vesselLines = {}; this._loaded = false;
        this._debugMode = false;
        this._initScene(); this._initLights(); this._initControls();
        this._createOrgansProcedural();  // instant display
        this._loadGlbModels();           // async upgrade
        this._initDebugPanel();
        this.animate();
    }

    _initScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0f1a);
        this.scene.fog = new THREE.Fog(0x0a0f1a, 6, 16);
        const asp = this.viewportEl.clientWidth / Math.max(this.viewportEl.clientHeight, 1);
        this.camera = new THREE.PerspectiveCamera(50, asp, 0.2, 18);
        this.camera.position.set(0.3, 0.15, 3.8);
        this.camera.lookAt(0, 0.0, 0);

        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
        this.renderer.setSize(this.viewportEl.clientWidth, this.viewportEl.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.1;

        this.labelRenderer = new CSS2DRenderer();
        this.labelRenderer.setSize(this.viewportEl.clientWidth, this.viewportEl.clientHeight);
        this.labelRenderer.domElement.style.position = 'absolute';
        this.labelRenderer.domElement.style.top = '0';
        this.labelRenderer.domElement.style.pointerEvents = 'none';
        this.viewportEl.appendChild(this.labelRenderer.domElement);

        // Subtle body outline (transparent torso silhouette)
        this._createBodyOutline();
    }

    _createBodyOutline() {
        // Simplified torso — transparent cylinder
        const torsoGeo = new THREE.CylinderGeometry(0.7, 0.55, 3.2, 32, 1, true);
        const torsoMat = new THREE.MeshBasicMaterial({
            color: 0x334466, transparent: true, opacity: 0.08,
            side: THREE.DoubleSide, depthWrite: false,
        });
        const torso = new THREE.Mesh(torsoGeo, torsoMat);
        torso.position.set(0, 0.1, -0.2);
        this.scene.add(torso);

        // Head sphere
        const headGeo = new THREE.SphereGeometry(0.38, 24, 16);
        const head = new THREE.Mesh(headGeo, torsoMat.clone());
        head.position.set(0, 2.3, 0);
        this.scene.add(head);
    }

    _initLights() {
        this.scene.add(new THREE.AmbientLight(0x334466, 1.8));
        const key = new THREE.DirectionalLight(0xffffff, 3.5);
        key.position.set(3, 4, 4);
        this.scene.add(key);
        const fill = new THREE.DirectionalLight(0x6699cc, 1.2);
        fill.position.set(-2, 1, -3);
        this.scene.add(fill);
        const rim = new THREE.DirectionalLight(0xff8866, 0.5);
        rim.position.set(0, -1, 3);
        this.scene.add(rim);
    }

    _initControls() {
        this.controls = new OrbitControls(this.camera, this.canvas);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.target.set(0, 0.05, -0.1);
        this.controls.minDistance = 1.2;
        this.controls.maxDistance = 7;
        this.controls.maxPolarAngle = Math.PI * 0.75;
        this.controls.update();
    }

    // ===== Step 1: Instant procedural organs =====

    _createOrgansProcedural() {
        ORGAN_DEFS.forEach(def => {
            const group = new THREE.Group();
            group.position.set(...def.position);

            let mesh;
            if (def.procedural === 'kidney_pair') {
                mesh = this._makeKidneyPair(def);
            } else if (def.procedural === 'liver') {
                mesh = this._makeLiverShape(def);
            } else if (def.procedural === 'brain') {
                mesh = this._makeBrainShape(def);
            } else if (def.procedural === 'spleen') {
                mesh = this._makeSpleenShape(def);
            } else if (def.procedural === 'pancreas') {
                mesh = this._makePancreasShape(def);
            } else if (def.modelPath) {
                // Will be replaced by GLB, but show placeholder
                mesh = this._makePlaceholder(def);
            } else {
                mesh = this._makePlaceholder(def);
            }
            group.add(mesh);
            group.userData._mesh = mesh;

            // Glow ring
            const ring = new THREE.Mesh(
                new THREE.TorusGeometry(0.4, 0.012, 16, 48),
                new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.35 })
            );
            ring.name = 'glow'; group.add(ring);

            // Label
            const lbl = document.createElement('div');
            lbl.textContent = def.name;
            lbl.style.cssText = 'color:#8899b4;font-size:11px;font-weight:500;text-shadow:0 0 6px rgba(0,0,0,.8);white-space:nowrap';
            const label = new CSS2DObject(lbl);
            label.position.set(...def.labelOffset);
            group.add(label);

            this.scene.add(group);
            this.organGroups[def.id] = group;
        });

        // Blood vessels
        this._createBloodVessels();
        this._loaded = true;

        // Build debug sliders
        this._buildDebugSliders();

        // Export button
        document.getElementById('btn-export-pos')?.addEventListener('click', () => this.exportPositions());

        window.dispatchEvent(new CustomEvent('scene-ready'));
    }

    // ===== Procedural shapes =====

    _makeBaseMesh(geo, color) {
        const mat = new THREE.MeshStandardMaterial({
            color, roughness: 0.35, metalness: 0.05,
            transparent: true, opacity: 0.88,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true; mesh.receiveShadow = true;
        return mesh;
    }

    _makePlaceholder(def) {
        const geo = new THREE.SphereGeometry(0.35, 28, 20);
        const mesh = this._makeBaseMesh(geo, def.color);
        mesh.userData.organId = def.id;
        mesh.userData.baseColor = new THREE.Color(def.color);
        mesh.userData._isFallback = true;
        return mesh;
    }

    _makeKidneyPair(def) {
        // Two bean shapes
        const group = new THREE.Group();
        const bean = this._beanGeometry(0.22);
        const r = this._makeBaseMesh(bean, def.color);
        r.position.set(0.35, 0, 0); r.userData.organId = def.id;
        const l = this._makeBaseMesh(bean.clone(), def.color);
        l.position.set(-0.3, -0.05, 0); l.scale.x = -1;
        group.add(r); group.add(l);
        group.userData.organId = def.id;
        group.userData.baseColor = new THREE.Color(def.color);
        group.userData._isFallback = true;
        return group;
    }

    _makeLiverShape(def) {
        const geo = new THREE.SphereGeometry(0.55, 32, 24);
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), y = pos.getY(i);
            pos.setX(i, x * 1.5);
            pos.setY(i, y * 0.7 + 0.05);
            pos.setZ(i, pos.getZ(i) * 0.5);
        }
        geo.computeVertexNormals();
        const mesh = this._makeBaseMesh(geo, def.color);
        mesh.userData.organId = def.id;
        mesh.userData.baseColor = new THREE.Color(def.color);
        mesh.userData._isFallback = true;
        return mesh;
    }

    _makeBrainShape(_def) {
        const geo = new THREE.SphereGeometry(0.4, 40, 30);
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
            const r = Math.sqrt(x*x + y*y + z*z);
            // Create convolutions with noise
            const noise = 1 + 0.06 * Math.sin(x*15) * Math.cos(y*18) * Math.sin(z*12)
                          + 0.04 * Math.sin(x*25 + y*20) * Math.cos(z*22);
            const scale = noise;
            pos.setX(i, x * scale);
            pos.setY(i, y * scale * 1.1);
            pos.setZ(i, z * scale);
        }
        geo.computeVertexNormals();
        const mesh = this._makeBaseMesh(geo, 0xfbbf24);
        mesh.userData.organId = 'nervous';
        mesh.userData.baseColor = new THREE.Color(0xfbbf24);
        mesh.userData._isFallback = true;
        return mesh;
    }

    _makeSpleenShape(def) {
        const geo = new THREE.SphereGeometry(0.25, 24, 18);
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            pos.setX(i, pos.getX(i) * 1.3);
            pos.setZ(i, pos.getZ(i) * 0.6);
        }
        geo.computeVertexNormals();
        const mesh = this._makeBaseMesh(geo, def.color);
        mesh.userData.organId = def.id;
        mesh.userData.baseColor = new THREE.Color(def.color);
        mesh.userData._isFallback = true;
        return mesh;
    }

    _makePancreasShape(def) {
        // Elongated, lumpy
        const geo = new THREE.SphereGeometry(0.22, 24, 16);
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            pos.setX(i, pos.getX(i) * 2.0);
            pos.setY(i, pos.getY(i) * 0.5);
            pos.setZ(i, pos.getZ(i) * 0.5);
        }
        geo.computeVertexNormals();
        const mesh = this._makeBaseMesh(geo, def.color);
        mesh.rotation.z = 0.3;
        mesh.userData.organId = def.id;
        mesh.userData.baseColor = new THREE.Color(def.color);
        mesh.userData._isFallback = true;
        return mesh;
    }

    _beanGeometry(radius) {
        const geo = new THREE.SphereGeometry(radius, 28, 20);
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const deform = 1 - 0.35 * Math.max(0, (x / radius + 1) / 2);
            pos.setX(i, x * deform * 1.25);
            pos.setZ(i, pos.getZ(i) * 0.65);
        }
        geo.computeVertexNormals();
        return geo;
    }

    // ===== Blood vessels =====

    _createBloodVessels() {
        BLOOD_VESSELS.forEach(v => {
            const curve = new THREE.CatmullRomCurve3(
                v.path.map(p => new THREE.Vector3(...p)), false, 'catmullrom', 0.5
            );
            const tubeGeo = new THREE.TubeGeometry(curve, 40, v.radius, 8, false);
            const tubeMat = new THREE.MeshStandardMaterial({
                color: v.color, roughness: 0.5, metalness: 0.1,
                transparent: true, opacity: 0.75, depthWrite: true,
            });
            const tube = new THREE.Mesh(tubeGeo, tubeMat);
            tube.name = `vessel-${v.name}`;
            this.scene.add(tube);
            this.vesselLines[v.name] = tube;
        });
    }

    // ===== Step 2: Async GLB replacement =====

    async _loadGlbModels() {
        const loader = new GLTFLoader();
        const glbDefs = ORGAN_DEFS.filter(d => d.modelPath);
        if (!glbDefs.length) { document.getElementById('loading-overlay')?.classList.add('hidden'); return; }

        const overlay = document.getElementById('loading-overlay');
        overlay?.classList.remove('hidden');

        for (const def of glbDefs) {
            await this._swapGlb(loader, def);
        }
        overlay?.classList.add('hidden');
    }

    async _swapGlb(loader, def) {
        try {
            const gltf = await loader.loadAsync(def.modelPath);
            const group = this.organGroups[def.id];
            if (!group) return;

            // Remove procedural mesh
            if (group.userData._mesh) {
                const m = group.userData._mesh;
                if (m.parent) m.parent.remove(m);
                m.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
            }

            // Add GLB model
            const model = gltf.scene;
            model.scale.setScalar(def.scale);
            const box = new THREE.Box3().setFromObject(model);
            const c = new THREE.Vector3(); box.getCenter(c);
            model.position.set(-c.x, -c.y, -c.z);

            model.traverse(child => {
                if (child.isMesh) {
                    child.castShadow = child.receiveShadow = true;
                    child.userData.organId = def.id;
                    child.userData.baseColor = new THREE.Color(def.color);
                    child.userData.originalMaterials = child.material;
                    child.userData._isFallback = false;
                }
            });
            group.add(model);
            group.userData._mesh = model;
        } catch (e) {
            console.warn(`GLB load failed for ${def.id}:`, e.message);
        }
    }

    // ===== Debug Panel: D key to toggle, drag organs in 3D =====

    _initDebugPanel() {
        // Create TransformControls
        this.transformCtrl = new TransformControls(this.camera, this.renderer.domElement);
        this.transformCtrl.enabled = false;
        this.transformCtrl.setMode('translate');
        this.transformCtrl.setSize(0.8);
        this.scene.add(this.transformCtrl);

        this.transformCtrl.addEventListener('dragging-changed', (e) => {
            this.controls.enabled = !e.value;
        });

        // Keyboard: D toggles debug mode
        window.addEventListener('keydown', (e) => {
            if (e.key === 'd' || e.key === 'D') {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
                this.toggleDebugMode();
            }
        });

        // Click on organ in debug mode → attach transform controls
        this.canvas.addEventListener('dblclick', (e) => {
            if (!this._debugMode) return;
            const rect = this.canvas.getBoundingClientRect();
            const mouse = new THREE.Vector2(
                ((e.clientX - rect.left) / rect.width) * 2 - 1,
                -((e.clientY - rect.top) / rect.height) * 2 + 1
            );

            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(mouse, this.camera);
            const meshes = [];
            Object.values(this.organGroups).forEach(g => {
                g.traverse(c => { if (c.isMesh && c.userData.organId) meshes.push(c); });
            });
            const hits = raycaster.intersectObjects(meshes);
            if (hits.length) {
                let obj = hits[0].object;
                while (obj && !obj.userData.organId) obj = obj.parent;
                if (obj) {
                    this.transformCtrl.attach(obj);
                    this._updateDebugSliders(obj.userData.organId);
                }
            }
        });

        this._debugPanelEl = document.getElementById('debug-panel');
        this._debugSliders = {};
    }

    toggleDebugMode() {
        this._debugMode = !this._debugMode;
        this.transformCtrl.enabled = this._debugMode;
        const panel = this._debugPanelEl;
        if (panel) {
            panel.classList.toggle('hidden', !this._debugMode);
        }
        if (!this._debugMode) {
            this.transformCtrl.detach();
        }
        console.log('Debug mode:', this._debugMode ? 'ON (double-click organ to move, use sliders to adjust)': 'OFF');
    }

    _updateDebugSliders(organId) {
        const group = this.organGroups[organId];
        if (!group) return;
        ['x','y','z'].forEach(axis => {
            const slider = document.getElementById(`debug-${organId}-${axis}`);
            if (slider) slider.value = group.position[axis].toFixed(3);
        });
    }

    _buildDebugSliders() {
        const container = document.getElementById('debug-sliders');
        if (!container) return;
        container.innerHTML = '';

        ORGAN_DEFS.forEach(def => {
            const div = document.createElement('div');
            div.className = 'debug-organ-group';
            div.innerHTML = `
                <label>${def.id.slice(0,6)}</label>
                S<input type="range" id="debug-${def.id}-s" min="0.1" max="3" step="0.05" value="${def.scale}">
                <span class="val" id="val-${def.id}-s">${def.scale.toFixed(2)}</span>
                X<input type="range" id="debug-${def.id}-x" min="-3" max="3" step="0.01" value="${def.position[0]}">
                <span class="val" id="val-${def.id}-x">${def.position[0].toFixed(2)}</span>
                Y<input type="range" id="debug-${def.id}-y" min="-3" max="3" step="0.01" value="${def.position[1]}">
                <span class="val" id="val-${def.id}-y">${def.position[1].toFixed(2)}</span>
                Z<input type="range" id="debug-${def.id}-z" min="-2" max="2" step="0.01" value="${def.position[2]}">
                <span class="val" id="val-${def.id}-z">${def.position[2].toFixed(2)}</span>
            `;
            container.appendChild(div);

            // Scale slider
            const sSlider = div.querySelector(`#debug-${def.id}-s`);
            const sVal = div.querySelector(`#val-${def.id}-s`);
            sSlider.addEventListener('input', () => {
                const v = parseFloat(sSlider.value);
                const group = this.organGroups[def.id];
                if (group) {
                    group.scale.setScalar(v);
                    // Also update the def so export works
                    def.scale = v;
                }
                if (sVal) sVal.textContent = v.toFixed(2);
            });

            // Position sliders
            ['x','y','z'].forEach(axis => {
                const slider = div.querySelector(`#debug-${def.id}-${axis}`);
                const valEl = div.querySelector(`#val-${def.id}-${axis}`);
                slider.addEventListener('input', () => {
                    const v = parseFloat(slider.value);
                    const group = this.organGroups[def.id];
                    if (group) group.position[axis] = v;
                    if (valEl) valEl.textContent = v.toFixed(2);
                });
            });
        });
    }

    exportPositions() {
        const positions = {};
        Object.entries(this.organGroups).forEach(([id, group]) => {
            positions[id] = {
                x: +group.position.x.toFixed(4),
                y: +group.position.y.toFixed(4),
                z: +group.position.z.toFixed(4),
                scale: +group.scale.x.toFixed(2),
            };
        });
        const json = JSON.stringify(positions, null, 2);
        console.log('=== ORGAN POSITIONS ===\n' + json);
        navigator.clipboard?.writeText(json);
        alert('Positions + scale copied to clipboard & logged to console.');
        return positions;
    }

    // ===== Public API =====

    highlightOrgan(organId, status) {
        const group = this.organGroups[organId];
        if (!group) return;
        const color = STATUS_COLORS[status] || STATUS_COLORS.normal;
        group.userData.pulseActive = true;
        group.userData.pulseColor = new THREE.Color(color);

        group.traverse(child => {
            if (child.isMesh && child.userData.organId && !child.name.startsWith('vessel')) {
                if (!child.material._cloned) {
                    child.material = child.material.clone();
                    child.material._cloned = true;
                }
                child.material.emissive = new THREE.Color(color);
                child.material.emissiveIntensity = 0.5;
            }
            if (child.name === 'glow') {
                child.material.color.set(color); child.material.opacity = 0.8;
            }
        });
    }

    highlightVesselPath(fromId, toId) {
        // Highlight blood vessels that connect these two organs
        const fromDef = getOrganDef(fromId);
        const toDef = getOrganDef(toId);
        if (!fromDef || !toDef) return;

        Object.values(this.vesselLines).forEach(tube => {
            // Check if vessel path passes near both organs
            const vesselPos = tube.geometry?.attributes?.position;
            if (!vesselPos) return;
            let nearFrom = false, nearTo = false;
            for (let i = 0; i < vesselPos.count; i++) {
                const p = new THREE.Vector3(vesselPos.getX(i), vesselPos.getY(i), vesselPos.getZ(i));
                if (p.distanceTo(new THREE.Vector3(...fromDef.position)) < 0.5) nearFrom = true;
                if (p.distanceTo(new THREE.Vector3(...toDef.position)) < 0.5) nearTo = true;
            }
            if (nearFrom && nearTo) {
                tube.material.color.set(0x38bdf8);
                tube.material.emissive = new THREE.Color(0x38bdf8);
                tube.material.emissiveIntensity = 0.5;
            }
        });
    }

    animateVesselFlow(fromId, toId) {
        // Pulse animation on connecting vessel
        this.highlightVesselPath(fromId, toId);
        setTimeout(() => this.resetAllVessels(), 2000);
    }

    resetAllVessels() {
        Object.values(this.vesselLines).forEach(tube => {
            tube.material.emissive = new THREE.Color(0x000000);
            tube.material.emissiveIntensity = 0;
            // Restore original color based on name
            BLOOD_VESSELS.forEach(v => {
                if (tube.name === `vessel-${v.name}`) {
                    tube.material.color.set(v.color);
                }
            });
        });
    }

    focusOrgan(organId) {
        const def = getOrganDef(organId);
        if (!def) return;
        this.controls.target.lerp(new THREE.Vector3(...def.position), 0.3);
    }

    resetAll() {
        Object.values(this.organGroups).forEach(group => {
            const def = getOrganDef(
                Object.keys(this.organGroups).find(k => this.organGroups[k] === group) || ''
            );
            group.traverse(child => {
                if (child.isMesh && child.userData.organId) {
                    child.material.emissive = new THREE.Color(0x000000);
                    child.material.emissiveIntensity = 0;
                }
                if (child.name === 'glow') {
                    child.material.color.set(0x22c55e); child.material.opacity = 0.35;
                }
            });
            group.userData.pulseActive = false;
        });
        this.resetAllVessels();
    }

    resize() {
        const w = this.viewportEl.clientWidth, h = this.viewportEl.clientHeight;
        this.camera.aspect = w / Math.max(h, 1);
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
        this.labelRenderer.setSize(w, h);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        this.controls.update();
        const t = Date.now() * 0.001;

        Object.values(this.organGroups).forEach(group => {
            if (group.userData.pulseActive) {
                const c = group.userData.pulseColor;
                const intensity = 0.25 + 0.35 * Math.sin(t * 3);
                group.traverse(child => {
                    if (child.isMesh && child.userData.organId && child.material.emissive) {
                        child.material.emissive = c;
                        child.material.emissiveIntensity = intensity;
                    }
                });
            }
            const ring = group.getObjectByName('glow');
            if (ring) ring.rotation.z += 0.002;
        });

        this.renderer.render(this.scene, this.camera);
        this.labelRenderer.render(this.scene, this.camera);
    }
}
