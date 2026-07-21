// 3dsky — горизонтальная плоскость с тайловым паттерном в GeowalkThree.
(function () {
    "use strict";

    const DEFAULTS = {
        enabled: true,
        src: "images/cloud.png",
        altM: 1800,
        sizeM: 12000,
        repeat: 3.5,
        opacity: 0.92,
        driftSpeed: 0.012,
        animEnabled: true,
        topDownHidePitchDeg: 50
    };

    let cfg = null;
    let map = null;
    let skyRoot = null;
    let skyPlane = null;
    let texture = null;
    let driftU = 0;
    let driftV = 0;
    let lastPlayerLocalX = null;
    let lastPlayerLocalY = null;
    let playerLng = null;
    let playerLat = null;
    let playerLiftM = 0;
    let cameraPitch = 90;
    let cameraElevM = null;
    let skyAbsZM = null;
    let skyAbsAltM = null;
    let readyHook = null;
    let ready = false;

    function t3() { return window.THREE; }

    function three() { return window.GeowalkThree; }

    function makeFallbackTexture(T) {
        const c = document.createElement("canvas");
        c.width = 256;
        c.height = 256;
        const ctx = c.getContext("2d");
        ctx.clearRect(0, 0, 256, 256);
        for (let i = 0; i < 14; i++) {
            const x = Math.random() * 256;
            const y = Math.random() * 256;
            const r = 35 + Math.random() * 55;
            const g = ctx.createRadialGradient(x, y, 0, x, y, r);
            g.addColorStop(0, "rgba(255,255,255,0.92)");
            g.addColorStop(0.45, "rgba(255,255,255,0.45)");
            g.addColorStop(1, "rgba(255,255,255,0)");
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }
        const tex = new T.CanvasTexture(c);
        tex.wrapS = T.RepeatWrapping;
        tex.wrapT = T.RepeatWrapping;
        tex.needsUpdate = true;
        return tex;
    }

    function applyTextureWrap(tex) {
        if (!tex) return;
        const T = t3();
        tex.wrapS = T.RepeatWrapping;
        tex.wrapT = T.RepeatWrapping;
        tex.needsUpdate = true;
    }

    function planeMaterial(T, tex) {
        return new T.MeshBasicMaterial({
            map: tex,
            transparent: true,
            opacity: cfg.opacity,
            depthWrite: false,
            depthTest: true,
            side: T.DoubleSide,
            fog: false
        });
    }

    function applyPlayerState(s) {
        if (!s) return;
        if (s.playerLng != null && isFinite(s.playerLng)) playerLng = s.playerLng;
        if (s.playerLat != null && isFinite(s.playerLat)) playerLat = s.playerLat;
        if (s.playerLiftM != null && isFinite(s.playerLiftM)) playerLiftM = Math.max(0, s.playerLiftM);
        if (s.cameraPitch != null && isFinite(s.cameraPitch)) cameraPitch = s.cameraPitch;
        if (s.cameraElevM != null && isFinite(s.cameraElevM)) cameraElevM = s.cameraElevM;
    }

    function updateSkyPlaneVisibility(GT) {
        if (!skyPlane) return;
        const hidePitch = cfg && cfg.topDownHidePitchDeg != null ? cfg.topDownHidePitchDeg : 50;
        let hide = cameraPitch < hidePitch;
        if (!hide && cameraElevM != null && playerLng != null && playerLat != null) {
            const skyZ = resolveSkyAbsZM(GT) + playerLiftM;
            hide = cameraElevM > skyZ + 20 && cameraPitch < hidePitch + 20;
        }
        skyPlane.visible = !hide;
    }

    function resetSkyHeight() {
        skyAbsZM = null;
        skyAbsAltM = null;
    }

    function resolveSkyAbsZM(GT) {
        const altM = cfg && cfg.altM != null ? cfg.altM : 1800;
        if (skyAbsZM != null && skyAbsAltM === altM) return skyAbsZM;
        let ground = 0;
        if (playerLng != null && playerLat != null) {
            ground = GT.terrainAt(playerLng, playerLat);
        } else {
            const o = GT.getOrigin();
            if (o && o.lng != null) ground = GT.terrainAt(o.lng, o.lat);
        }
        skyAbsZM = ground + altM;
        skyAbsAltM = altM;
        return skyAbsZM;
    }

    function applySkyPlacement(s, opts) {
        applyPlayerState(s);
        const GT = three();
        if (!GT || !skyRoot || playerLng == null || playerLat == null) return;

        const o = opts || {};
        if (o.recalcHeight) resetSkyHeight();
        if ((s && s.originShifted) || o.resetFollow) resetPlayerFollow();

        const local = GT.geoToLocal(playerLng, playerLat, 0);
        skyRoot.position.set(local.x, local.y, 0);
        if (skyPlane) {
            skyPlane.position.set(0, 0, resolveSkyAbsZM(GT) + playerLiftM);
        }

        if (!o.skipDrift && cfg.animEnabled !== false && lastPlayerLocalX != null && lastPlayerLocalY != null) {
            const dx = local.x - lastPlayerLocalX;
            const dy = local.y - lastPlayerLocalY;
            if (Math.abs(dx) > 1e-4 || Math.abs(dy) > 1e-4) {
                const sizeM = cfg.sizeM > 0 ? cfg.sizeM : 12000;
                driftU += dx / sizeM;
                driftV += dy / sizeM;
                updatePlaneTextureOffset();
            }
        }

        lastPlayerLocalX = local.x;
        lastPlayerLocalY = local.y;
        updateSkyPlaneVisibility(GT);
    }

    function detachSkyRoot() {
        const T = three();
        if (skyRoot && T) T.remove(skyRoot);
    }

    function disposeSkyRoot() {
        detachSkyRoot();
        if (!skyRoot) return;
        skyRoot.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (obj.material.map && obj.material.map !== texture) obj.material.map.dispose();
                obj.material.dispose();
            }
        });
        skyRoot = null;
        skyPlane = null;
    }

    function disposeTexture() {
        if (texture) {
            texture.dispose();
            texture = null;
        }
    }

    function updatePlaneTextureOffset() {
        if (!skyPlane || !skyPlane.material || !skyPlane.material.map) return;
        skyPlane.material.map.offset.set(driftU, driftV);
    }

    function resetPlayerFollow() {
        lastPlayerLocalX = null;
        lastPlayerLocalY = null;
    }

    function buildSkyPlane() {
        const T = t3();
        const GT = three();
        if (!T || !GT || !GT.isReady() || !cfg || !cfg.enabled || !texture) return;

        disposeSkyRoot();

        const sizeM = cfg.sizeM > 0 ? cfg.sizeM : 12000;
        const rep = cfg.repeat > 0 ? cfg.repeat : 3.5;
        const planeTex = texture.clone();
        applyTextureWrap(planeTex);
        planeTex.repeat.set(rep, rep);
        planeTex.offset.set(driftU, driftV);

        skyPlane = new T.Mesh(new T.PlaneGeometry(1, 1), planeMaterial(T, planeTex));
        skyPlane.scale.set(sizeM, sizeM, 1);
        skyPlane.renderOrder = -50;

        skyRoot = new T.Group();
        skyRoot.name = "geowalk-3dsky";
        skyRoot.renderOrder = -50;
        skyRoot.add(skyPlane);

        GT.add(skyRoot);
        applySkyPlacement(null, { resetFollow: true, skipDrift: true, recalcHeight: true });
        ready = true;
        if (map) try { map.triggerRepaint(); } catch (e) { /* ok */ }
    }

    function buildSceneContent() {
        const T = t3();
        const GT = three();
        if (!T || !GT || !cfg || !cfg.enabled) return;

        disposeSkyRoot();
        disposeTexture();
        texture = makeFallbackTexture(T);
        buildSkyPlane();

        const loader = new T.TextureLoader();
        loader.load(
            cfg.src,
            (loaded) => {
                if (!cfg || !cfg.enabled) return;
                if (texture && texture !== loaded) texture.dispose();
                texture = loaded;
                applyTextureWrap(texture);
                buildSkyPlane();
            },
            undefined,
            () => console.warn("Geowalk3dSky: не удалось загрузить", cfg.src)
        );
    }

    function removeLegacyLayers() {
        if (!map) return;
        ["geowalk-3dsky", "geowalk-clouds"].forEach((id) => {
            if (map.getLayer(id)) {
                try { map.removeLayer(id); } catch (e) { /* ok */ }
            }
        });
    }

    function bindHooks() {
        const GT = three();
        if (!GT) return;
        if (!readyHook) {
            readyHook = function () {
                if (cfg && cfg.enabled) buildSceneContent();
            };
            GT.onReady(readyHook);
        }
        if (GT.isReady() && cfg && cfg.enabled) buildSceneContent();
    }

    function unbindHooks() {
        readyHook = null;
    }

    window.Geowalk3dSky = {
        setup(m, options) {
            if (m) map = m;
            removeLegacyLayers();
            cfg = Object.assign({}, DEFAULTS, options || cfg || {});
            applyPlayerState(options);
            if (!cfg.enabled) {
                disposeSkyRoot();
                disposeTexture();
                unbindHooks();
                ready = false;
                return;
            }
            bindHooks();
        },
        sync(state) {
            const s = state || {};
            if (!cfg) cfg = Object.assign({}, DEFAULTS);
            const want = s.enabled != null ? s.enabled !== false : cfg.enabled !== false;
            if (s.src != null) cfg.src = s.src;
            if (s.altM != null) cfg.altM = s.altM;
            if (s.sizeM != null) cfg.sizeM = s.sizeM;
            if (s.repeat != null) cfg.repeat = s.repeat;
            if (s.opacity != null) cfg.opacity = s.opacity;
            if (s.driftSpeed != null) cfg.driftSpeed = s.driftSpeed;
            if (s.animEnabled != null) cfg.animEnabled = s.animEnabled !== false;
            applyPlayerState(s);
            if (s.altM != null) resetSkyHeight();
            cfg.enabled = want;
            removeLegacyLayers();
            if (!want) {
                disposeSkyRoot();
                disposeTexture();
                unbindHooks();
                ready = false;
                return;
            }
            bindHooks();
            if (three() && three().isReady()) buildSceneContent();
        },
        tick(state) {
            if (!cfg || !cfg.enabled || !skyRoot) return;
            const s = state || {};
            applySkyPlacement(s);
            const d = s.dt != null ? s.dt : 0;
            if (d > 0 && cfg.animEnabled !== false && cfg.driftSpeed > 0) {
                driftU += cfg.driftSpeed * d;
                driftV += cfg.driftSpeed * 0.35 * d;
                updatePlaneTextureOffset();
            }
        },
        isReady() { return ready && !!skyRoot; },
        recalcHeight(state) {
            if (!cfg || !cfg.enabled) return;
            applyPlayerState(state);
            resetSkyHeight();
            driftU = 0;
            driftV = 0;
            resetPlayerFollow();
            if (skyRoot) {
                applySkyPlacement(state, { skipDrift: true, recalcHeight: true, resetFollow: true });
                updatePlaneTextureOffset();
            }
        },
        teardown() {
            disposeSkyRoot();
            disposeTexture();
            unbindHooks();
            removeLegacyLayers();
            cfg = null;
            map = null;
            playerLng = null;
            playerLat = null;
            playerLiftM = 0;
            resetSkyHeight();
            driftU = 0;
            driftV = 0;
            resetPlayerFollow();
            ready = false;
        }
    };
})();
