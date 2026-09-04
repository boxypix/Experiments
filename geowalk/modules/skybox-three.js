// Cube skybox — автономный MapLibre custom layer (под картой).
// Cubemap cross texture: horizontal (4×3) или vertical (3×4) → 6 граней BoxGeometry.
(function () {
    "use strict";

    const SKYBOX_LAYER_ID = "geowalk-skybox";

    const DEFAULTS = {
        enabled: true,
        src: "skybox/skybox1.png",
        sizeBaseM: 1000,
        sizePct: 100,
        cutoffEnabled: false,
        rotXDeg: 90,
        rotYDeg: 0,
        rotZDeg: 0
    };

    // Слоты граней в cross-атласе → порядок материалов BoxGeometry Three.js:
    // 0:+X  1:-X  2:+Y  3:-Y  4:+Z  5:-Z
    const CROSS_HORIZONTAL = {
        cols: 4,
        rows: 3,
        faces: [
            { col: 2, row: 1 }, // +X
            { col: 0, row: 1 }, // -X
            { col: 1, row: 0 }, // +Y
            { col: 1, row: 2 }, // -Y
            { col: 1, row: 1 }, // +Z
            { col: 3, row: 1 }  // -Z
        ]
    };

    const CROSS_VERTICAL = {
        cols: 3,
        rows: 4,
        faces: [
            { col: 2, row: 1 }, // +X
            { col: 0, row: 1 }, // -X
            { col: 1, row: 0 }, // +Y
            { col: 1, row: 2 }, // -Y
            { col: 1, row: 1 }, // +Z
            { col: 1, row: 3 }  // -Z
        ]
    };

    let cfg = null;
    let mapRef = null;
    let scene = null;
    let camera = null;
    let layerObj = null;
    let skyRoot = null;
    let skyMesh = null;
    let faceTextures = [];
    let ready = false;
    let playerLng = null;
    let playerLat = null;
    let cameraElevM = null;
    let playerYaw = 0;
    let cameraPitch = 83;
    let horizonClipPlane = null;

    const projLocal = { m: null, l: null, v: null, s: null };

    function t3() { return window.THREE; }

    function degToRad(deg) {
        return (deg != null && isFinite(deg) ? deg : 0) * Math.PI / 180;
    }

    function skyboxSizeMeters(c) {
        const base = c && c.sizeBaseM != null ? c.sizeBaseM : DEFAULTS.sizeBaseM;
        const pct = c && c.sizePct != null ? c.sizePct : DEFAULTS.sizePct;
        return base * Math.max(1, pct) / 100;
    }

    function setMaterialClipping(materials, enabled) {
        const mats = Array.isArray(materials) ? materials : [materials];
        for (let i = 0; i < mats.length; i++) {
            if (mats[i]) mats[i].clipping = enabled === true;
        }
    }

    function restoreMapGlState(gl) {
        gl.disable(gl.CULL_FACE);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(true);
        gl.colorMask(true, true, true, true);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    function sharedRenderer() {
        const GT = window.GeowalkThree;
        return GT && GT.getRenderer ? GT.getRenderer() : null;
    }

    function skyboxInsertBeforeId(m) {
        const layers = m.getStyle() && m.getStyle().layers;
        if (!layers || !layers.length) return undefined;
        // Под все слои MapLibre: перед первым стилевым слоем (обычно background).
        for (let i = 0; i < layers.length; i++) {
            if (layers[i].id !== SKYBOX_LAYER_ID) return layers[i].id;
        }
        return undefined;
    }

    function detectCrossLayout(img) {
        const ratio = img.width / img.height;
        if (ratio >= 1.2) return CROSS_HORIZONTAL;
        if (ratio <= 0.85) return CROSS_VERTICAL;
        const faceH = Math.floor(img.width / 4);
        if (faceH * 3 === img.height) return CROSS_HORIZONTAL;
        return CROSS_VERTICAL;
    }

    function extractFaceCanvas(img, col, row, faceSize) {
        const canvas = document.createElement("canvas");
        canvas.width = faceSize;
        canvas.height = faceSize;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(
            img,
            col * faceSize,
            row * faceSize,
            faceSize,
            faceSize,
            0,
            0,
            faceSize,
            faceSize
        );
        return canvas;
    }

    function configureFaceTexture(T, tex) {
        tex.wrapS = T.ClampToEdgeWrapping;
        tex.wrapT = T.ClampToEdgeWrapping;
        tex.minFilter = T.LinearFilter;
        tex.magFilter = T.LinearFilter;
        tex.generateMipmaps = false;
        tex.needsUpdate = true;
        if (T.SRGBColorSpace) tex.colorSpace = T.SRGBColorSpace;
    }

    function parseCrossCubemap(T, img) {
        const layout = detectCrossLayout(img);
        const faceSize = Math.floor(Math.min(img.width / layout.cols, img.height / layout.rows));
        if (faceSize <= 0) return null;

        const materials = [];
        const textures = [];

        for (let i = 0; i < layout.faces.length; i++) {
            const slot = layout.faces[i];
            const canvas = extractFaceCanvas(img, slot.col, slot.row, faceSize);
            const tex = new T.CanvasTexture(canvas);
            configureFaceTexture(T, tex);
            textures.push(tex);
            materials.push(new T.MeshBasicMaterial({
                map: tex,
                side: T.BackSide,
                depthWrite: false,
                depthTest: false,
                fog: false,
                clipping: cfg && cfg.cutoffEnabled === true
            }));
        }

        return { materials, textures, layout: layout === CROSS_HORIZONTAL ? "horizontal" : "vertical", faceSize };
    }

    function disposeFaceTextures() {
        if (!skyMesh) {
            for (const tex of faceTextures) tex.dispose();
            faceTextures = [];
            return;
        }
        const mats = skyMesh.material;
        if (Array.isArray(mats)) {
            for (const m of mats) {
                if (m.map) m.map.dispose();
                m.dispose();
            }
        } else if (mats) {
            if (mats.map) mats.map.dispose();
            mats.dispose();
        }
        faceTextures = [];
    }

    function disposeSkyMesh() {
        if (skyRoot && scene) scene.remove(skyRoot);
        disposeFaceTextures();
        if (skyMesh && skyMesh.geometry) skyMesh.geometry.dispose();
        skyRoot = null;
        skyMesh = null;
        ready = false;
    }

    function buildSkyboxMesh(parsed) {
        const T = t3();
        if (!T || !scene || !cfg || !cfg.enabled || !parsed) return;

        disposeSkyMesh();

        const sizeM = skyboxSizeMeters(cfg);
        faceTextures = parsed.textures;

        skyMesh = new T.Mesh(new T.BoxGeometry(sizeM, sizeM, sizeM), parsed.materials);
        skyMesh.frustumCulled = false;
        skyMesh.renderOrder = -1000;

        skyRoot = new T.Group();
        skyRoot.name = "geowalk-skybox-root";
        skyRoot.renderOrder = -1000;
        skyRoot.add(skyMesh);
        scene.add(skyRoot);

        applyPlacement();
        ready = true;
        if (mapRef) try { mapRef.triggerRepaint(); } catch (e) { /* ok */ }
    }

    function eyeLocalPosition() {
        if (playerLng == null || playerLat == null) return null;
        const GT = window.GeowalkThree;
        if (GT && GT.isReady && GT.isReady()) {
            const ground = GT.terrainAt(playerLng, playerLat);
            const eyeAlt = cameraElevM != null ? Math.max(0, cameraElevM - ground) : 0;
            return GT.geoToLocal(playerLng, playerLat, eyeAlt);
        }
        return { x: 0, y: 0, z: cameraElevM != null ? cameraElevM : 0 };
    }

    function applyMeshSize() {
        const T = t3();
        if (!T || !skyMesh || !cfg) return;
        const sizeM = skyboxSizeMeters(cfg);
        skyMesh.geometry.dispose();
        skyMesh.geometry = new T.BoxGeometry(sizeM, sizeM, sizeM);
    }

    function applyCutoffState(renderer) {
        if (!renderer || !cfg) return;
        const enabled = cfg.cutoffEnabled === true;
        setMaterialClipping(skyMesh && skyMesh.material, enabled);
        if (!enabled) {
            renderer.clippingPlanes = [];
            renderer.localClippingEnabled = false;
            return;
        }
        const T = t3();
        const eye = eyeLocalPosition();
        if (!T || !eye) return;
        if (!horizonClipPlane) horizonClipPlane = new T.Plane(new T.Vector3(0, 0, 1), 0);
        horizonClipPlane.set(new T.Vector3(0, 0, 1), -eye.z);
        renderer.clippingPlanes = [horizonClipPlane];
        renderer.localClippingEnabled = true;
    }

    function applyPlacement() {
        if (!skyRoot || !cfg) return;
        const eye = eyeLocalPosition();
        if (!eye) return;
        skyRoot.position.set(eye.x, eye.y, eye.z);
        skyRoot.rotation.set(
            degToRad(cfg.rotXDeg),
            degToRad(cfg.rotYDeg),
            degToRad(cfg.rotZDeg)
        );
    }

    function applyMapProjection(args) {
        const GT = window.GeowalkThree;
        const T = t3();
        if (!GT || !T || !camera || !args) return false;
        const origin = GT.getOrigin && GT.getOrigin();
        if (!origin || origin.merc == null) return false;

        if (!projLocal.m) {
            projLocal.m = new T.Matrix4();
            projLocal.l = new T.Matrix4();
            projLocal.v = new T.Vector3();
            projLocal.s = new T.Vector3();
        }

        const s = origin.scale;
        projLocal.v.set(origin.merc.x, origin.merc.y, origin.merc.z || 0);
        projLocal.s.set(s, -s, s);
        projLocal.l.makeTranslation(projLocal.v.x, projLocal.v.y, projLocal.v.z);
        projLocal.l.scale(projLocal.s);
        projLocal.m.fromArray(args.defaultProjectionData.mainMatrix);
        camera.projectionMatrix = projLocal.m.multiply(projLocal.l);
        return true;
    }

    function loadCrossCubemap() {
        const T = t3();
        if (!T || !cfg || !cfg.enabled || !scene) return;

        disposeSkyMesh();

        const img = new Image();
        img.onload = function () {
            if (!cfg || !cfg.enabled || !scene) return;
            const parsed = parseCrossCubemap(T, img);
            if (!parsed) {
                console.warn("GeowalkSkyboxThree: invalid cross cubemap", cfg.src, img.width, img.height);
                return;
            }
            buildSkyboxMesh(parsed);
        };
        img.onerror = function () {
            console.warn("GeowalkSkyboxThree: failed to load", cfg.src);
        };
        img.src = cfg.src || DEFAULTS.src;
    }

    function makeLayer() {
        return {
            id: SKYBOX_LAYER_ID,
            type: "custom",
            renderingMode: "3d",
            onAdd(m, gl) {
                mapRef = m;
                const T = t3();
                if (!T) return;
                camera = new T.Camera();
                scene = new T.Scene();
                if (cfg && cfg.enabled) loadCrossCubemap();
            },
            onRemove() {
                disposeSkyMesh();
                scene = null;
                camera = null;
            },
            render(gl, args) {
                if (!scene || !camera || !cfg || !cfg.enabled || !skyRoot) return;
                const renderer = sharedRenderer();
                if (!renderer) return;
                applyPlacement();
                if (!applyMapProjection(args)) return;
                renderer.resetState();
                applyCutoffState(renderer);
                renderer.render(scene, camera);
                renderer.clippingPlanes = [];
                renderer.localClippingEnabled = false;
                restoreMapGlState(gl);
            }
        };
    }

    function removeLayer() {
        if (!mapRef) return;
        try {
            if (mapRef.getLayer(SKYBOX_LAYER_ID)) mapRef.removeLayer(SKYBOX_LAYER_ID);
        } catch (e) { /* ok */ }
        layerObj = null;
    }

    function ensureLayer(m) {
        if (!m || !t3()) return;
        const before = skyboxInsertBeforeId(m);
        if (m.getLayer(SKYBOX_LAYER_ID)) {
            if (before && before !== SKYBOX_LAYER_ID) {
                try { m.moveLayer(SKYBOX_LAYER_ID, before); } catch (e) { /* ok */ }
            }
            return;
        }
        layerObj = makeLayer();
        if (before) m.addLayer(layerObj, before);
        else m.addLayer(layerObj);
    }

    function applyState(s) {
        if (!s) return;
        if (s.playerLng != null && isFinite(s.playerLng)) playerLng = s.playerLng;
        if (s.playerLat != null && isFinite(s.playerLat)) playerLat = s.playerLat;
        if (s.cameraElevM != null && isFinite(s.cameraElevM)) cameraElevM = s.cameraElevM;
        if (s.playerYaw != null && isFinite(s.playerYaw)) playerYaw = s.playerYaw;
        if (s.cameraPitch != null && isFinite(s.cameraPitch)) cameraPitch = s.cameraPitch;
    }

    function activate(m) {
        ensureLayer(m);
        if (scene) loadCrossCubemap();
        if (m) try { m.triggerRepaint(); } catch (e) { /* ok */ }
    }

    function deactivate() {
        disposeSkyMesh();
        removeLayer();
        if (mapRef) try { mapRef.triggerRepaint(); } catch (e) { /* ok */ }
    }

    window.GeowalkSkyboxThree = {
        setup(m, options) {
            if (m) mapRef = m;
            cfg = Object.assign({}, DEFAULTS, options || cfg || {});
            applyState(options);
            if (!cfg.enabled) {
                deactivate();
                return;
            }
            activate(mapRef);
        },
        sync(state) {
            const s = state || {};
            if (!cfg) cfg = Object.assign({}, DEFAULTS);
            const want = s.enabled != null ? s.enabled !== false : cfg.enabled !== false;
            const srcChanged = s.src != null && s.src !== cfg.src;
            const sizeChanged = (s.sizePct != null && s.sizePct !== cfg.sizePct)
                || (s.sizeBaseM != null && s.sizeBaseM !== cfg.sizeBaseM)
                || (s.sizeM != null && s.sizeM !== cfg.sizeM);
            const cutoffChanged = s.cutoffEnabled != null && s.cutoffEnabled !== cfg.cutoffEnabled;
            if (s.src != null) cfg.src = s.src;
            if (s.sizePct != null) cfg.sizePct = s.sizePct;
            if (s.sizeBaseM != null) cfg.sizeBaseM = s.sizeBaseM;
            if (s.sizeM != null) cfg.sizeM = s.sizeM;
            if (s.cutoffEnabled != null) cfg.cutoffEnabled = s.cutoffEnabled === true;
            if (s.rotXDeg != null) cfg.rotXDeg = s.rotXDeg;
            if (s.rotYDeg != null) cfg.rotYDeg = s.rotYDeg;
            if (s.rotZDeg != null) cfg.rotZDeg = s.rotZDeg;
            applyState(s);
            cfg.enabled = want;
            if (!cfg.enabled) {
                deactivate();
                return;
            }
            activate(mapRef);
            if (srcChanged) loadCrossCubemap();
            else if (sizeChanged) applyMeshSize();
            else applyPlacement();
            if (cutoffChanged && skyMesh) setMaterialClipping(skyMesh.material, cfg.cutoffEnabled === true);
        },
        tick(state) {
            if (!cfg || !cfg.enabled || !skyRoot) return false;
            applyState(state);
            applyPlacement();
            return true;
        },
        reassertLayer(m) {
            if (!cfg || !cfg.enabled) return;
            ensureLayer(m || mapRef);
        },
        regenerate(m, options) {
            const opts = Object.assign({}, cfg || DEFAULTS, options || {});
            deactivate();
            if (m) mapRef = m;
            cfg = opts;
            if (!cfg.enabled) return;
            activate(mapRef);
        },
        isActive() {
            return !!(cfg && cfg.enabled && ready && skyRoot);
        },
        teardown() {
            deactivate();
            cfg = null;
            mapRef = null;
            playerLng = null;
            playerLat = null;
            cameraElevM = null;
            playerYaw = 0;
            cameraPitch = 83;
        }
    };
})();
