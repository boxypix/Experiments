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
        boatModelUrl: "models/boat.glb",
        scale: 5.88,
        boatScale: 5.88,
        yawOffsetDeg: 90,
        boatYawOffsetDeg: 270,
        baseM: 0.35,
        boatBaseM: 0.35,
        turnLeanDeg: 30,
        turnLeanSec: 0.4,
        boatTurnLeanDeg: 24,
        boatTurnLeanSec: 0.55,
        followTerrain: true,
        terrainSampleM: 4,
        terrainPitchSec: 0.25,
        terrainPitchMaxDeg: 40
    };

    let active = false;
    let carGroup = null;
    let pitchNode = null;
    let modelPivot = null;
    let modelNodes = { car: null, boat: null };
    let activeModelKind = null;
    let activeYawOffsetDeg = 90;
    let activeBaseM = 0.35;
    let loadStarted = false;
    let lastOnWater = false;
    let turnLeanDeg = 0;
    let terrainPitchDeg = 0;
    let pendingDrop = false;
    let dropAnim = { t: 0, duration: 0.72, offsetM: 3, playing: false };
    let lastCarLiftM = 0;

    const WOOD_FX = {
        maxCount: 36,
        emitStepM: 1.1,
        backM: 2.6,
        lifeMin: 0.55,
        lifeMax: 1.25,
        popMin: 1.4,
        popMax: 3.2,
        gravity: 15,
        sizeMin: 0.08,
        sizeMax: 0.22,
        color: 0x1a3014
    };
    let woodFxGroup = null;
    let woodParticles = [];
    let woodPool = [];
    let woodDistAcc = 0;

    const WATER_FX = {
        maxCount: 28,
        emitStepM: 0.85,
        backM: 1.8,
        lifeMin: 1,
        lifeMax: 2.2,
        popMin: 7,
        popMax: 13,
        gravity: 14,
        sizeMin: 0.05,
        sizeMax: 0.14,
        color: 0x88bfcb,
        minMoveSpeed: 0.08
    };
    let waterFxGroup = null;
    let waterParticles = [];
    let waterPool = [];
    let waterDistAcc = 0;

    const WATER_WAKE = {
        maxCount: 5,
        src: "images/fx_1.png",
        emitIntervalSec: 0.1,
        backM: 1.2,
        assetPx: 120,
        sizeM: 6,
        lifeSec: 1.4,
        zLiftM: 0.06,
        color: 0xd8eeff,
        opacity: 0.55,
        startScale: 0.28,
        endScale: 1.2,
        driftSpeed: 1.5,
        rotationOffsetDeg: -90
    };
    let waterWakeGroup = null;
    let waterWakePool = [];
    let waterWakeActive = [];
    let waterWakeEmitAcc = 0;
    let waterWakeTexture = null;
    let waterWakeTextureUrl = null;
    let waterWakeTextureLoading = false;

    function getT3() { return window.GeowalkThree; }
    function getTHREE() { return window.THREE; }

    function modelParamsFor(kind) {
        if (kind === "boat") {
            return {
                scale: opts.boatScale != null ? opts.boatScale : opts.scale,
                yawOffsetDeg: opts.boatYawOffsetDeg != null ? opts.boatYawOffsetDeg : opts.yawOffsetDeg,
                baseM: opts.boatBaseM != null ? opts.boatBaseM : opts.baseM
            };
        }
        return {
            scale: opts.scale,
            yawOffsetDeg: opts.yawOffsetDeg,
            baseM: opts.baseM
        };
    }

    function applyActiveModelParams(kind) {
        const p = modelParamsFor(kind);
        activeYawOffsetDeg = p.yawOffsetDeg != null ? p.yawOffsetDeg : 0;
        activeBaseM = p.baseM != null ? p.baseM : 0.35;
    }

    function normalizeModel(root, t3, modelParams) {
        const scale = modelParams && modelParams.scale != null ? modelParams.scale : opts.scale;
        const box = new t3.Box3().setFromObject(root);
        const size = new t3.Vector3();
        box.getSize(size);
        const len = Math.max(size.x, size.y, size.z, 0.001);
        const s = scale / len;
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

    async function loadModelKind(kind, loader, t3) {
        const url = kind === "boat"
            ? (opts.boatModelUrl || "models/boat.glb")
            : (opts.modelUrl || "models/puegeot.glb");
        const gltf = await new Promise((resolve, reject) => {
            loader.load(url, resolve, undefined, reject);
        });
        const root = gltf.scene;
        root.traverse((node) => {
            if (node.isMesh) {
                node.castShadow = false;
                node.receiveShadow = false;
            }
        });
        normalizeModel(root, t3, modelParamsFor(kind));
        if (getT3() && getT3().flattenMeshMaterials) getT3().flattenMeshMaterials(root);
        root.rotation.x = Math.PI / 2;
        root.updateMatrixWorld(true);
        const boxGround = new t3.Box3().setFromObject(root);
        root.position.z -= boxGround.min.z;
        root.visible = false;
        return root;
    }

    function setActiveModelKind(kind) {
        if (!modelPivot || activeModelKind === kind) return;
        const node = modelNodes[kind];
        if (!node) {
            const fallback = kind === "boat" ? "car" : "boat";
            if (modelNodes[fallback]) kind = fallback;
            else return;
        }
        const next = modelNodes[kind];
        if (!next) return;
        while (modelPivot.children.length) modelPivot.remove(modelPivot.children[0]);
        if (modelNodes.car) modelNodes.car.visible = false;
        if (modelNodes.boat) modelNodes.boat.visible = false;
        next.visible = true;
        modelPivot.add(next);
        activeModelKind = kind;
        applyActiveModelParams(kind);
    }

    function syncModelForSurface(onWater) {
        const want = onWater ? "boat" : "car";
        if (activeModelKind === want) {
            lastOnWater = !!onWater;
            return;
        }
        if (!modelNodes[want]) return;
        setActiveModelKind(want);
        lastOnWater = !!onWater;
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
            try {
                modelNodes.car = await loadModelKind("car", loader, t3);
            } catch (e) {
                console.warn("GeowalkCar3d: не удалось загрузить машину", e && e.message ? e.message : e);
            }
            try {
                modelNodes.boat = await loadModelKind("boat", loader, t3);
            } catch (e) {
                console.warn("GeowalkCar3d: не удалось загрузить лодку", e && e.message ? e.message : e);
            }
            if (!modelNodes.car && !modelNodes.boat) throw new Error("no models loaded");

            modelPivot = new t3.Group();
            pitchNode = new t3.Group();
            pitchNode.add(modelPivot);

            carGroup = new t3.Group();
            carGroup.name = "geowalk-car-3d";
            carGroup.add(pitchNode);
            carGroup.visible = false;
            T.add(carGroup);

            const startKind = lastOnWater && modelNodes.boat ? "boat" : "car";
            setActiveModelKind(modelNodes[startKind] ? startKind : (modelNodes.car ? "car" : "boat"));
            maybeStartPendingDrop();
        } catch (e) {
            console.warn("GeowalkCar3d: не удалось загрузить модель", e && e.message ? e.message : e);
            loadStarted = false;
            modelNodes = { car: null, boat: null };
            activeModelKind = null;
        }
    }

    function onSceneReady() {
        carGroup = null;
        pitchNode = null;
        modelPivot = null;
        modelNodes = { car: null, boat: null };
        activeModelKind = null;
        loadStarted = false;
        terrainPitchDeg = 0;
        pendingDrop = false;
        dropAnim.playing = false;
        dropAnim.t = 0;
        applyActiveModelParams("car");
        ensureModel();
        clearSurfaceFx();
    }

    function clearWoodFx() {
        for (const p of woodParticles) {
            p.mesh.visible = false;
            woodPool.push(p.mesh);
        }
        woodParticles = [];
        woodDistAcc = 0;
    }

    function clearWaterFx() {
        for (const p of waterParticles) {
            p.mesh.visible = false;
            waterPool.push(p.mesh);
        }
        waterParticles = [];
        waterDistAcc = 0;
    }

    function clearWaterWake() {
        for (const w of waterWakeActive) {
            w.mesh.visible = false;
            waterWakePool.push(w.mesh);
        }
        waterWakeActive = [];
        waterWakeEmitAcc = 0;
    }

    function clearSurfaceFx() {
        clearWoodFx();
        clearWaterFx();
        clearWaterWake();
    }

    function ensureWoodFx(t3, T) {
        if (woodFxGroup) return;
        woodFxGroup = new t3.Group();
        woodFxGroup.name = "geowalk-car-3d-wood-fx";
        T.add(woodFxGroup);
        const geo = new t3.SphereGeometry(1, 6, 6);
        for (let i = 0; i < WOOD_FX.maxCount; i++) {
            const mat = new t3.MeshBasicMaterial({
                color: WOOD_FX.color,
                transparent: true,
                opacity: 0.85,
                depthWrite: false,
                depthTest: true
            });
            const mesh = new t3.Mesh(geo, mat);
            mesh.visible = false;
            woodFxGroup.add(mesh);
            woodPool.push(mesh);
        }
    }

    function ensureWaterFx(t3, T) {
        if (waterFxGroup) return;
        waterFxGroup = new t3.Group();
        waterFxGroup.name = "geowalk-car-3d-water-fx";
        T.add(waterFxGroup);
        const geo = new t3.SphereGeometry(1, 6, 6);
        for (let i = 0; i < WATER_FX.maxCount; i++) {
            const mat = new t3.MeshBasicMaterial({
                color: WATER_FX.color,
                transparent: true,
                opacity: 0.75,
                depthWrite: false,
                depthTest: true
            });
            const mesh = new t3.Mesh(geo, mat);
            mesh.visible = false;
            waterFxGroup.add(mesh);
            waterPool.push(mesh);
        }
    }

    function waterMoveSpeed(motion) {
        const fwd = motion && motion.velFwd != null ? motion.velFwd : 0;
        const strafe = motion && motion.velStrafe != null ? motion.velStrafe : 0;
        return Math.hypot(fwd, strafe);
    }

    function isWaterMotionActive(motion) {
        if (!motion || !motion.onWater) return false;
        const min = WATER_FX.minMoveSpeed != null ? WATER_FX.minMoveSpeed : 0.08;
        return waterMoveSpeed(motion) > min;
    }

    function waterWakeSrc() {
        return opts.waterWakeSrc || WATER_WAKE.src || "images/fx_1.png";
    }

    function buildWaterWakePool(t3, T) {
        if (waterWakeGroup) return;
        waterWakeGroup = new t3.Group();
        waterWakeGroup.name = "geowalk-car-3d-water-wake";
        T.add(waterWakeGroup);
        const geo = new t3.PlaneGeometry(1, 1);
        for (let i = 0; i < WATER_WAKE.maxCount; i++) {
            const matOpts = {
                transparent: true,
                opacity: WATER_WAKE.opacity,
                depthWrite: false,
                depthTest: true,
                side: t3.DoubleSide,
                color: WATER_WAKE.color
            };
            if (waterWakeTexture) {
                matOpts.map = waterWakeTexture;
                matOpts.alphaMap = waterWakeTexture;
            }
            const mesh = new t3.Mesh(geo, new t3.MeshBasicMaterial(matOpts));
            mesh.visible = false;
            waterWakeGroup.add(mesh);
            waterWakePool.push(mesh);
        }
    }

    function ensureWaterWake(t3, T) {
        if (waterWakeGroup) return;
        const src = waterWakeSrc();
        if (waterWakeTexture && waterWakeTextureUrl === src) {
            buildWaterWakePool(t3, T);
            return;
        }
        if (waterWakeTextureLoading) return;
        waterWakeTextureLoading = true;
        waterWakeTextureUrl = src;
        new t3.TextureLoader().load(
            src,
            (tex) => {
                tex.colorSpace = t3.SRGBColorSpace;
                waterWakeTexture = tex;
                waterWakeTextureLoading = false;
                buildWaterWakePool(t3, T);
            },
            undefined,
            () => {
                waterWakeTextureLoading = false;
                buildWaterWakePool(t3, T);
            }
        );
    }

    function spawnWoodParticle(T, lng, lat, bearingDeg, velFwd, velStrafe, cosLat) {
        if (!woodPool.length) return;
        const mesh = woodPool.pop();
        const dirDeg = movementBearingDeg(bearingDeg, velFwd, velStrafe);
        const b = dirDeg * DEG;
        const cos = cosLat != null && isFinite(cosLat) ? cosLat : Math.cos(lat * DEG);
        const back = WOOD_FX.backM + Math.random() * 1.1;
        const side = (Math.random() - 0.5) * 1.5;
        const dLng = (-Math.sin(b) * back + Math.cos(b) * side) / (M_PER_DEG_LAT * cos);
        const dLat = (-Math.cos(b) * back - Math.sin(b) * side) / M_PER_DEG_LAT;
        const pos = T.geoToLocal(lng + dLng, lat + dLat, activeBaseM + lastCarLiftM + 0.04 + Math.random() * 0.12);
        const s = WOOD_FX.sizeMin + Math.random() * (WOOD_FX.sizeMax - WOOD_FX.sizeMin);
        mesh.position.set(pos.x, pos.y, pos.z);
        mesh.scale.setScalar(s);
        mesh.material.color.setHex(WOOD_FX.color);
        mesh.visible = true;
        mesh.material.opacity = 0.65 + Math.random() * 0.25;
        woodParticles.push({
            mesh,
            life: 0,
            maxLife: WOOD_FX.lifeMin + Math.random() * (WOOD_FX.lifeMax - WOOD_FX.lifeMin),
            vx: (Math.random() - 0.5) * 0.35,
            vy: (Math.random() - 0.5) * 0.35,
            vz: WOOD_FX.popMin + Math.random() * (WOOD_FX.popMax - WOOD_FX.popMin),
            baseScale: s,
            groundZ: pos.z - 0.02
        });
    }

    function spawnWaterParticle(T, lng, lat, bearingDeg, velFwd, velStrafe, cosLat) {
        if (!waterPool.length) return;
        const mesh = waterPool.pop();
        const dirDeg = movementBearingDeg(bearingDeg, velFwd, velStrafe);
        const b = dirDeg * DEG;
        const cos = cosLat != null && isFinite(cosLat) ? cosLat : Math.cos(lat * DEG);
        const back = WATER_FX.backM + Math.random() * 0.9;
        const side = (Math.random() - 0.5) * 1.2;
        const dLng = (-Math.sin(b) * back + Math.cos(b) * side) / (M_PER_DEG_LAT * cos);
        const dLat = (-Math.cos(b) * back - Math.sin(b) * side) / M_PER_DEG_LAT;
        const pos = T.geoToLocal(lng + dLng, lat + dLat, activeBaseM + lastCarLiftM + 0.02 + Math.random() * 0.08);
        const s = WATER_FX.sizeMin + Math.random() * (WATER_FX.sizeMax - WATER_FX.sizeMin);
        mesh.position.set(pos.x, pos.y, pos.z);
        mesh.scale.setScalar(s);
        mesh.material.color.setHex(WATER_FX.color);
        mesh.visible = true;
        mesh.material.opacity = 0.55 + Math.random() * 0.35;
        waterParticles.push({
            mesh,
            life: 0,
            maxLife: WATER_FX.lifeMin + Math.random() * (WATER_FX.lifeMax - WATER_FX.lifeMin),
            vx: (Math.random() - 0.5) * 0.45,
            vy: (Math.random() - 0.5) * 0.45,
            vz: WATER_FX.popMin + Math.random() * (WATER_FX.popMax - WATER_FX.popMin),
            baseScale: s,
            groundZ: pos.z - 0.02
        });
    }

    function wakeCameraBearingDeg(motion, bearingDeg) {
        if (motion && motion.bearing != null && isFinite(motion.bearing)) return motion.bearing;
        if (motion && motion.yaw != null && isFinite(motion.yaw)) return motion.yaw;
        return bearingDeg != null && isFinite(bearingDeg) ? bearingDeg : 0;
    }

    function cameraBearingToRotationZ(bearingDeg) {
        const b = bearingDeg * DEG;
        // MapLibre bearing: 0° = север (+y), 90° = восток (+x).
        return Math.atan2(Math.cos(b), Math.sin(b));
    }

    function recycleOldestWaterWake() {
        if (!waterWakeActive.length) return;
        const w = waterWakeActive.shift();
        w.mesh.visible = false;
        waterWakePool.push(w.mesh);
    }

    function spawnWaterWake(T, lng, lat, motion, bearingFallback, cosLat) {
        if (!waterWakePool.length) return;
        const mesh = waterWakePool.pop();
        const bearingDeg = wakeCameraBearingDeg(motion, bearingFallback);
        const rotationRad = cameraBearingToRotationZ(bearingDeg)
            + (WATER_WAKE.rotationOffsetDeg || 0) * DEG;
        const b = bearingDeg * DEG;
        const cos = cosLat != null && isFinite(cosLat) ? cosLat : Math.cos(lat * DEG);
        const dLng = (-Math.sin(b) * WATER_WAKE.backM) / (M_PER_DEG_LAT * cos);
        const dLat = (-Math.cos(b) * WATER_WAKE.backM) / M_PER_DEG_LAT;
        const pos = T.geoToLocal(lng + dLng, lat + dLat, activeBaseM + lastCarLiftM + WATER_WAKE.zLiftM);
        mesh.position.set(pos.x, pos.y, pos.z);
        mesh.rotation.set(0, 0, rotationRad);
        const wakeScale = WATER_WAKE.sizeM * WATER_WAKE.startScale;
        mesh.scale.set(wakeScale, wakeScale, 1);
        mesh.material.opacity = WATER_WAKE.opacity;
        mesh.visible = true;
        waterWakeActive.push({
            mesh,
            life: 0,
            maxLife: WATER_WAKE.lifeSec,
            bearingDeg,
            rotationRad,
            backVx: -Math.sin(b) * WATER_WAKE.driftSpeed,
            backVy: -Math.cos(b) * WATER_WAKE.driftSpeed
        });
    }

    function updateWoodFx(motion, bearingDeg) {
        const T = getT3();
        const t3 = getTHREE();
        if (!T || !t3 || !active) return;
        ensureWoodFx(t3, T);
        const dt = motion && motion.dt != null ? motion.dt : 0;
        const onWood = !!(motion && motion.onWood);
        const speed = motion && motion.speed != null
            ? motion.speed
            : Math.hypot(motion && motion.velFwd || 0, motion && motion.velStrafe || 0);

        if (onWood && speed > 0.05 && motion && motion.lng != null && dt > 0) {
            woodDistAcc += speed * dt;
            const burst = Math.max(1, Math.min(3, Math.floor(speed / 18) + 1));
            while (woodDistAcc >= WOOD_FX.emitStepM && woodPool.length) {
                woodDistAcc -= WOOD_FX.emitStepM;
                for (let i = 0; i < burst && woodPool.length; i++) {
                    spawnWoodParticle(
                        T,
                        motion.lng,
                        motion.lat,
                        bearingDeg,
                        motion.velFwd,
                        motion.velStrafe,
                        motion.cosLat
                    );
                }
            }
        } else {
            woodDistAcc = 0;
        }

        for (let i = woodParticles.length - 1; i >= 0; i--) {
            const p = woodParticles[i];
            p.life += dt;
            if (p.life >= p.maxLife) {
                p.mesh.visible = false;
                woodPool.push(p.mesh);
                woodParticles.splice(i, 1);
                continue;
            }
            p.mesh.position.x += p.vx * dt;
            p.mesh.position.y += p.vy * dt;
            p.mesh.position.z += p.vz * dt;
            p.vz -= WOOD_FX.gravity * dt;
            p.vx *= Math.max(0, 1 - dt * 2.5);
            p.vy *= Math.max(0, 1 - dt * 2.5);
            if (p.mesh.position.z <= p.groundZ && p.vz < 0) {
                p.mesh.position.z = p.groundZ;
                p.vz = 0;
                p.life = Math.max(p.life, p.maxLife * 0.82);
            }
            const u = p.life / p.maxLife;
            p.mesh.material.opacity = (1 - u) * (1 - u) * 0.82;
            const grow = p.baseScale * (1 + u * 0.12);
            p.mesh.scale.setScalar(grow);
        }
    }

    function updateWaterFx(motion, bearingDeg) {
        const T = getT3();
        const t3 = getTHREE();
        if (!T || !t3 || !active) return;
        ensureWaterFx(t3, T);
        const dt = motion && motion.dt != null ? motion.dt : 0;
        const movingOnWater = isWaterMotionActive(motion);

        if (movingOnWater && motion && motion.lng != null && dt > 0) {
            const speed = waterMoveSpeed(motion);
            waterDistAcc += speed * dt;
            const burst = Math.max(1, Math.min(3, Math.floor(speed / 16) + 1));
            while (waterDistAcc >= WATER_FX.emitStepM && waterPool.length) {
                waterDistAcc -= WATER_FX.emitStepM;
                for (let i = 0; i < burst && waterPool.length; i++) {
                    spawnWaterParticle(
                        T,
                        motion.lng,
                        motion.lat,
                        bearingDeg,
                        motion.velFwd,
                        motion.velStrafe,
                        motion.cosLat
                    );
                }
            }
        } else {
            waterDistAcc = 0;
        }

        for (let i = waterParticles.length - 1; i >= 0; i--) {
            const p = waterParticles[i];
            p.life += dt;
            if (p.life >= p.maxLife) {
                p.mesh.visible = false;
                waterPool.push(p.mesh);
                waterParticles.splice(i, 1);
                continue;
            }
            p.mesh.position.x += p.vx * dt;
            p.mesh.position.y += p.vy * dt;
            p.mesh.position.z += p.vz * dt;
            p.vz -= WATER_FX.gravity * dt;
            p.vx *= Math.max(0, 1 - dt * 2.2);
            p.vy *= Math.max(0, 1 - dt * 2.2);
            if (p.mesh.position.z <= p.groundZ && p.vz < 0) {
                p.mesh.position.z = p.groundZ;
                p.vz = 0;
                p.life = Math.max(p.life, p.maxLife * 0.78);
            }
            const u = p.life / p.maxLife;
            p.mesh.material.opacity = (1 - u) * (1 - u) * 0.9;
            const grow = p.baseScale * (1 + u * 0.08);
            p.mesh.scale.setScalar(grow);
        }
    }

    function updateWaterWake(motion, bearingDeg) {
        const T = getT3();
        const t3 = getTHREE();
        if (!T || !t3 || !active) return;
        ensureWaterWake(t3, T);
        const dt = motion && motion.dt != null ? motion.dt : 0;
        const movingOnWater = isWaterMotionActive(motion);

        if (movingOnWater && motion && motion.lng != null && dt > 0 && waterWakeGroup) {
            waterWakeEmitAcc += dt;
            while (waterWakeEmitAcc >= WATER_WAKE.emitIntervalSec) {
                waterWakeEmitAcc -= WATER_WAKE.emitIntervalSec;
                if (!waterWakePool.length && waterWakeActive.length >= WATER_WAKE.maxCount) {
                    recycleOldestWaterWake();
                }
                if (!waterWakePool.length) break;
                spawnWaterWake(T, motion.lng, motion.lat, motion, bearingDeg, motion.cosLat);
            }
        } else {
            waterWakeEmitAcc = 0;
        }

        for (let i = waterWakeActive.length - 1; i >= 0; i--) {
            const w = waterWakeActive[i];
            w.life += dt;
            if (w.life >= w.maxLife) {
                w.mesh.visible = false;
                waterWakePool.push(w.mesh);
                waterWakeActive.splice(i, 1);
                continue;
            }
            const u = w.life / w.maxLife;
            const grow = 1 - Math.pow(1 - u, 1.65);
            w.mesh.rotation.z = w.rotationRad;
            const wakeScale = WATER_WAKE.sizeM * (
                WATER_WAKE.startScale + grow * (WATER_WAKE.endScale - WATER_WAKE.startScale)
            );
            w.mesh.scale.set(wakeScale, wakeScale, 1);
            w.mesh.position.x += w.backVx * dt;
            w.mesh.position.y += w.backVy * dt;
            w.mesh.material.opacity = WATER_WAKE.opacity * (1 - u) * (1 - u) * 0.95;
        }
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
        return Math.atan2(Math.cos(b), Math.sin(b)) + (activeYawOffsetDeg || 0) * DEG;
    }

    function leanInputFrom(turnInput, velFwd, onWater) {
        const input = Math.max(-1, Math.min(1, turnInput != null ? turnInput : 0));
        if (Math.abs(input) < 1e-4) return 0;
        const forward = velFwd != null && velFwd > 0.05;
        if (onWater) {
            // На воде крен в противоположную сторону относительно машины.
            return forward ? input : -input;
        }
        // Назад — крен как у руля; вперёд — визуальный крен в противоположную сторону.
        return forward ? -input : input;
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

    function updateTerrainPitch(lng, lat, bearingDeg, velFwd, velStrafe, cosLat, lift, onWater, dt) {
        const tau = opts.terrainPitchSec != null ? opts.terrainPitchSec : 0.25;
        const blend = dt != null && dt > 0 ? 1 - Math.exp(-dt / Math.max(0.02, tau)) : 1;
        if (onWater || !opts.followTerrain) {
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
        const alt = activeBaseM + (lift || 0);
        const ahead = T.geoToLocal(lng + dLng, lat + dLat, alt);
        const behind = T.geoToLocal(lng - dLng, lat - dLat, alt);
        const horiz = Math.hypot(ahead.x - behind.x, ahead.y - behind.y);
        let targetPitch = horiz > 1e-3 ? -Math.atan2(ahead.z - behind.z, horiz) / DEG : 0;
        const maxP = opts.terrainPitchMaxDeg != null ? opts.terrainPitchMaxDeg : 40;
        targetPitch = Math.max(-maxP, Math.min(maxP, targetPitch));
        terrainPitchDeg += (targetPitch - terrainPitchDeg) * blend;
    }

    function updateTurnLean(turnInput, velFwd, onWater, dt) {
        if (dt == null || dt <= 0) return;
        const maxLean = onWater
            ? (opts.boatTurnLeanDeg != null ? opts.boatTurnLeanDeg : opts.turnLeanDeg != null ? opts.turnLeanDeg : 30)
            : (opts.turnLeanDeg != null ? opts.turnLeanDeg : 30);
        const tau = onWater
            ? (opts.boatTurnLeanSec != null ? opts.boatTurnLeanSec : opts.turnLeanSec != null ? opts.turnLeanSec : 0.4)
            : (opts.turnLeanSec != null ? opts.turnLeanSec : 0.4);
        const input = leanInputFrom(turnInput, velFwd, onWater);
        const target = input * maxLean;
        const blend = 1 - Math.exp(-dt / Math.max(0.02, tau));
        turnLeanDeg += (target - turnLeanDeg) * blend;
    }

    function applyModelPose(bearingDeg, onWater) {
        if (onWater) {
            carGroup.rotation.set(0, 0, bearingToRotationZ(bearingDeg));
            if (pitchNode) pitchNode.rotation.set(0, 0, 0);
            if (modelPivot) modelPivot.rotation.set(0, turnLeanDeg * DEG, 0);
            return;
        }
        carGroup.rotation.set(0, 0, bearingToRotationZ(bearingDeg) + turnLeanDeg * DEG);
        if (pitchNode) pitchNode.rotation.set(terrainPitchDeg * DEG, 0, 0);
        if (modelPivot) modelPivot.rotation.set(0, 0, 0);
    }

    function place(lng, lat, bearingDeg, turnInput, velFwd, velStrafe, cosLat, onWater, dt) {
        if (!carGroup || !active) return;
        updateTurnLean(turnInput, velFwd, onWater, dt);
        const T = getT3();
        const lift = dropOffsetM(dt != null ? dt : 0);
        lastCarLiftM = lift;
        updateTerrainPitch(lng, lat, bearingDeg, velFwd, velStrafe, cosLat, lift, onWater, dt);
        const p = T.geoToLocal(lng, lat, activeBaseM + lift);
        carGroup.position.set(p.x, p.y, p.z);
        applyModelPose(bearingDeg, onWater);
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
                lastOnWater = false;
                clearSurfaceFx();
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
            const onWater = !!(motion && motion.onWater);
            syncModelForSurface(onWater);
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
                onWater,
                motion.dt
            );
            updateWoodFx(motion, bearing);
            updateWaterFx(motion, bearing);
            updateWaterWake(motion, bearing);
        },
        playDropAnim() {
            pendingDrop = true;
            if (active && carGroup) startDropAnim();
        },
        isReady() { return !!carGroup; }
    };
})();
