// 3D-машинка на карте MapLibre (слой GeowalkThree) — режим «3dmove» / ралли.
//
// GeowalkCar3d.init({ modelUrl, scale, yawOffsetDeg, baseM })
// GeowalkCar3d.sync({ active })
// GeowalkCar3d.tick({ lng, lat, bearing, dt })
(function () {
    "use strict";

    const DEG = Math.PI / 180;
    const M_PER_DEG_LAT = 111320;

    let opts = {
        modelUrl: "models/puegeot.glb",
        scale: 8.4,
        yawOffsetDeg: 90,
        baseM: 0.35,
        turnLeanDeg: 30,
        turnLeanSec: 0.4,
        followTerrain: true,
        terrainSampleM: 4,
        terrainPitchSec: 0.25,
        terrainPitchMaxDeg: 40
    };

    let active = false;
    let carGroup = null;
    let pitchNode = null;
    let modelPivot = null;
    let loadStarted = false;
    let turnLeanDeg = 0;
    let terrainPitchDeg = 0;
    let pendingDrop = false;
    let dropAnim = { t: 0, duration: 0.72, offsetM: 3, playing: false };

    function getT3() { return window.GeowalkThree; }
    function getTHREE() { return window.THREE; }

    function normalizeModel(root, t3) {
        const box = new t3.Box3().setFromObject(root);
        const size = new t3.Vector3();
        box.getSize(size);
        const len = Math.max(size.x, size.y, size.z, 0.001);
        const s = opts.scale / len;
        root.scale.setScalar(s);
        root.updateMatrixWorld(true);
        const box2 = new t3.Box3().setFromObject(root);
        const center = new t3.Vector3();
        box2.getCenter(center);
        root.position.sub(center);
        root.updateMatrixWorld(true);
        const box3 = new t3.Box3().setFromObject(root);
        root.position.z -= box3.min.z;
    }

    async function ensureModel() {
        if (carGroup || loadStarted) return;
        loadStarted = true;
        const T = getT3();
        const t3 = getTHREE();
        if (!T || !t3 || !T.isReady()) { loadStarted = false; return; }

        try {
            const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
            const loader = new GLTFLoader();
            const gltf = await new Promise((resolve, reject) => {
                loader.load(opts.modelUrl, resolve, undefined, reject);
            });

            modelPivot = new t3.Group();
            const root = gltf.scene;
            root.traverse((node) => {
                if (node.isMesh) {
                    node.castShadow = false;
                    node.receiveShadow = false;
                }
            });
            normalizeModel(root, t3);
            root.rotation.x = Math.PI / 2;
            root.updateMatrixWorld(true);
            const boxGround = new t3.Box3().setFromObject(root);
            root.position.z -= boxGround.min.z;
            modelPivot.add(root);

            pitchNode = new t3.Group();
            pitchNode.add(modelPivot);

            carGroup = new t3.Group();
            carGroup.name = "geowalk-car-3d";
            carGroup.add(pitchNode);
            carGroup.visible = false;
            T.add(carGroup);
            maybeStartPendingDrop();
        } catch (e) {
            console.warn("GeowalkCar3d: не удалось загрузить модель", e && e.message ? e.message : e);
            loadStarted = false;
        }
    }

    function onSceneReady() {
        carGroup = null;
        pitchNode = null;
        modelPivot = null;
        loadStarted = false;
        terrainPitchDeg = 0;
        pendingDrop = false;
        dropAnim.playing = false;
        dropAnim.t = 0;
        ensureModel();
    }

    function easeOutBounce(t) {
        const n1 = 7.5625;
        const d1 = 2.75;
        if (t < 1 / d1) return n1 * t * t;
        if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
        if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
        return n1 * (t -= 2.625 / d1) * t + 0.984375;
    }

    function startDropAnim() {
        pendingDrop = false;
        dropAnim.t = 0;
        dropAnim.playing = true;
    }

    function maybeStartPendingDrop() {
        if (!pendingDrop || !active || !carGroup) return;
        startDropAnim();
    }

    function dropOffsetM(dt) {
        if (!dropAnim.playing) return 0;
        if (dt) dropAnim.t += dt;
        const u = Math.min(1, dropAnim.t / dropAnim.duration);
        const bounce = easeOutBounce(u);
        if (u >= 1) dropAnim.playing = false;
        return dropAnim.offsetM * (1 - bounce);
    }

    function bearingToRotationZ(bearingDeg) {
        const b = bearingDeg * DEG;
        // MapLibre bearing: 0° = север (+y), 90° = восток (+x).
        return Math.atan2(Math.cos(b), Math.sin(b)) + (opts.yawOffsetDeg || 0) * DEG;
    }

    function leanInputFrom(turnInput, velFwd) {
        const input = Math.max(-1, Math.min(1, turnInput != null ? turnInput : 0));
        if (Math.abs(input) < 1e-4) return 0;
        // Назад — крен как у руля; вперёд — визуальный крен в противоположную сторону.
        if (velFwd != null && velFwd > 0.05) return -input;
        return input;
    }

    function movementBearingDeg(bearingDeg, velFwd, velStrafe) {
        const fwd = velFwd != null ? velFwd : 0;
        const strafe = velStrafe != null ? velStrafe : 0;
        const speed = Math.hypot(fwd, strafe);
        if (speed < 0.05) return bearingDeg != null ? bearingDeg : 0;
        const b = bearingDeg * DEG;
        const east = fwd * Math.sin(b) + strafe * Math.cos(b);
        const north = fwd * Math.cos(b) - strafe * Math.sin(b);
        return (Math.atan2(east, north) / DEG + 360) % 360;
    }

    function updateTerrainPitch(lng, lat, bearingDeg, velFwd, velStrafe, cosLat, lift, dt) {
        const tau = opts.terrainPitchSec != null ? opts.terrainPitchSec : 0.25;
        const blend = dt != null && dt > 0 ? 1 - Math.exp(-dt / Math.max(0.02, tau)) : 1;
        if (!opts.followTerrain) {
            terrainPitchDeg += (0 - terrainPitchDeg) * blend;
            return;
        }
        const T = getT3();
        if (!T) return;
        const sampleM = opts.terrainSampleM != null ? opts.terrainSampleM : 4;
        const dirDeg = movementBearingDeg(bearingDeg, velFwd, velStrafe);
        const b = dirDeg * DEG;
        const cos = cosLat != null && isFinite(cosLat) ? cosLat : Math.cos(lat * DEG);
        const dLng = (Math.sin(b) * sampleM) / (M_PER_DEG_LAT * cos);
        const dLat = (Math.cos(b) * sampleM) / M_PER_DEG_LAT;
        const alt = opts.baseM + (lift || 0);
        const ahead = T.geoToLocal(lng + dLng, lat + dLat, alt);
        const behind = T.geoToLocal(lng - dLng, lat - dLat, alt);
        const horiz = Math.hypot(ahead.x - behind.x, ahead.y - behind.y);
        let targetPitch = horiz > 1e-3 ? -Math.atan2(ahead.z - behind.z, horiz) / DEG : 0;
        const maxP = opts.terrainPitchMaxDeg != null ? opts.terrainPitchMaxDeg : 40;
        targetPitch = Math.max(-maxP, Math.min(maxP, targetPitch));
        terrainPitchDeg += (targetPitch - terrainPitchDeg) * blend;
    }

    function updateTurnLean(turnInput, velFwd, dt) {
        if (dt == null || dt <= 0) return;
        const maxLean = opts.turnLeanDeg != null ? opts.turnLeanDeg : 30;
        const tau = opts.turnLeanSec != null ? opts.turnLeanSec : 0.4;
        const input = leanInputFrom(turnInput, velFwd);
        const target = input * maxLean;
        const blend = 1 - Math.exp(-dt / Math.max(0.02, tau));
        turnLeanDeg += (target - turnLeanDeg) * blend;
    }

    function place(lng, lat, bearingDeg, turnInput, velFwd, velStrafe, cosLat, dt) {
        if (!carGroup || !active) return;
        updateTurnLean(turnInput, velFwd, dt);
        const T = getT3();
        const lift = dropOffsetM(dt != null ? dt : 0);
        updateTerrainPitch(lng, lat, bearingDeg, velFwd, velStrafe, cosLat, lift, dt);
        const p = T.geoToLocal(lng, lat, opts.baseM + lift);
        carGroup.position.set(p.x, p.y, p.z);
        carGroup.rotation.set(0, 0, bearingToRotationZ(bearingDeg) + turnLeanDeg * DEG);
        if (pitchNode) pitchNode.rotation.set(terrainPitchDeg * DEG, 0, 0);
        carGroup.visible = true;
    }

    window.GeowalkCar3d = {
        init(options) {
            opts = Object.assign({}, opts, options || {});
            const old = document.getElementById("geowalk-car-3d-viewport");
            if (old && old.parentNode) old.parentNode.removeChild(old);
            if (getT3()) getT3().onReady(onSceneReady);
        },
        sync(state) {
            const wasActive = active;
            active = !!(state && state.active);
            if (active && !wasActive) pendingDrop = true;
            if (!active) {
                turnLeanDeg = 0;
                terrainPitchDeg = 0;
                pendingDrop = false;
                dropAnim.playing = false;
                dropAnim.t = 0;
                if (carGroup) carGroup.visible = false;
            }
            if (active) {
                ensureModel();
                maybeStartPendingDrop();
            }
        },
        configure(options) {
            opts = Object.assign({}, opts, options || {});
        },
        tick(motion) {
            if (!active) return;
            if (!carGroup) {
                ensureModel();
                return;
            }
            maybeStartPendingDrop();
            if (!motion || motion.lng == null || motion.lat == null) return;
            const bearing = motion.bearing != null ? motion.bearing
                : (motion.yaw != null ? motion.yaw : 0);
            const turnInput = motion.turnInput != null ? motion.turnInput : 0;
            place(
                motion.lng,
                motion.lat,
                bearing,
                turnInput,
                motion.velFwd,
                motion.velStrafe,
                motion.cosLat,
                motion.dt
            );
        },
        playDropAnim() {
            pendingDrop = true;
            if (active && carGroup) startDropAnim();
        },
        isReady() { return !!carGroup; }
    };
})();
