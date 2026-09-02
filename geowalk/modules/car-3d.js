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
        modelUrl: "models/car1.glb",
        scale: 5.88,
        yawOffsetDeg: 90,
        baseM: 0.35,
        turnLeanDeg: 30,
        turnLeanSec: 0.4,
        followTerrain: true,
        pitchPivotOffsetX: 0,
        pitchPivotOffsetY: 0,
        pitchPivotOffsetZ: 0,
        boostFireOffsetX: 0,
        boostFireOffsetY: 2.3,
        boostFireOffsetZ: 1.6,
        boostFireTiltDeg: 280,
        boostFireSizePct: 120,
        stopFlameOffsetX: 0,
        stopFlameOffsetY: 1.7,
        stopFlameOffsetZ: 2.9,
        stopFlameTiltDeg: -19,
        stopFlameAlwaysVisible: false,
        stopFlameSizePct: 200,
        driverOffsetX: 1.6,
        driverOffsetY: 1.5,
        driverOffsetZ: 2.2,
        driverRotXDeg: 99,
        driverRotYDeg: 180,
        driverRotZDeg: 0,
        driverSizePct: 220,
        talkOffsetX: 0,
        talkOffsetY: 0,
        talkOffsetZ: 5.7,
        talkFontSize: 60,
        talkSizePct: 70,
        talkRotXDeg: 0,
        talkRotYDeg: 180,
        talkRotZDeg: 0,
        terrainSampleM: 4,
        terrainPitchSec: 0.25,
        terrainPitchMaxDeg: 40
    };

    let active = false;
    let carGroup = null;
    let pitchNode = null;
    let modelPivot = null;
    let modelMount = null;
    let model = null;
    let activeYawOffsetDeg = 90;
    let activeBaseM = 0.35;
    let loadStarted = false;
    let turnLeanDeg = 0;
    let terrainPitchDeg = 0;
    let pendingDrop = false;
    let dropAnim = { t: 0, duration: 0.72, offsetM: 3, playing: false };
    let lastCarLiftM = 0;
    let launchPitch = {
        t: 0,
        duration: 1.5,
        deg: 10,
        attackSec: 0.22,
        x: 0,
        v: 0,
        playing: false,
        lastDrive: 0,
        sign: 1,
        wasBrake: false,
        slowReturn: false
    };

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

    const BOOST_FIRE = {
        src: "images/flame.png",
        backM: 2.3,
        zLiftM: 1.6,
        sizeM: 2.4,
        opacity: 0.95
    };
    let boostFireMesh = null;
    let boostFireTexture = null;

    const STOP_FLAME = {
        src: "images/flame_stop.png",
        backM: 1.7,
        zLiftM: 2.9,
        sizeM: 1.8,
        opacity: 0.95
    };
    let stopFlameMesh = null;
    let stopFlameTexture = null;

    const DRIVER_STANDS = [
        "images/driver_stand1.png",
        "images/driver_stand2.png",
        "images/driver_stand3.png",
        "images/driver_stand4.png"
    ];
    const DRIVER_STAND = {
        sizeM: 2.6,
        opacity: 1
    };
    let driverMesh = null;
    let driverTexture = null;
    let driverTextures = [];
    let driverStandIdx = 0;
    let driverStandsPreloadStarted = false;
    let driverFade = { t: 0, duration: 0.1, dir: 0 };
    let driverDrop = {
        delay: 0.16,
        delayLeft: 0,
        pending: false,
        playing: false,
        t: 0,
        duration: 0.55,
        dropM: 2.2
    };
    let lastDriverControlsActive = null;

    const DRIVER_TALK_PHRASES = [
        "So, ready to go?",
        "Ready for a ride?",
        "Had enough rest? Let's ride.",
        "Ready to hit the road?",
        "Let's go for a ride!",
        "Wanna explore?",
        "Let's see what's out there.",
        "How about somewhere new?",
        "Wanna see some new places?",
        "Let's find somewhere new.",
        "Where to next?",
        "Ready for another adventure?",
        "Let's go exploring!",
        "How about a little drive?",
        "Ready to roll?",
        "Coffee's done. Let's go!",
        "One more sip, then we ride.",
        "Where are we heading today?",
        "Let's see where the road takes us.",
        "Come on, let's ride!"
    ];
    const DRIVER_TALK = {
        src: "images/driver_talk.svg",
        canvasW: 900,
        canvasH: 300,
        textMaxW: 720,
        textCenterY: 96,
        sizeM: 5.4
    };
    let talkGroup = null;
    let talkMesh = null;
    let talkTexture = null;
    let talkCanvas = null;
    let talkCtx = null;
    let talkBgImage = null;
    let talkBgLoadStarted = false;
    let talkPhrase = "";
    let talkAnchorLng = 0;
    let talkAnchorLat = 0;
    let talkAnchorLift = 0;
    let talkAnchorBearing = 0;

    function getT3() { return window.GeowalkThree; }
    function getTHREE() { return window.THREE; }

    function modelParams() {
        return {
            scale: opts.scale,
            yawOffsetDeg: opts.yawOffsetDeg,
            baseM: opts.baseM
        };
    }

    function applyActiveModelParams() {
        const p = modelParams();
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

    function modelUrlExt(url) {
        const path = String(url || "").split("?")[0];
        const dot = path.lastIndexOf(".");
        return dot >= 0 ? path.slice(dot + 1).toLowerCase() : "";
    }

    async function loadObjectFromUrl(url) {
        const ext = modelUrlExt(url);
        if (ext === "fbx") {
            const { FBXLoader } = await import("three/addons/loaders/FBXLoader.js");
            const loader = new FBXLoader();
            return new Promise((resolve, reject) => {
                loader.load(url, resolve, undefined, reject);
            });
        }
        const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
        const loader = new GLTFLoader();
        const gltf = await new Promise((resolve, reject) => {
            loader.load(url, resolve, undefined, reject);
        });
        return gltf.scene;
    }

    async function loadModel(t3) {
        const url = opts.modelUrl || "models/car1.glb";
        const root = await loadObjectFromUrl(url);
        root.traverse((node) => {
            if (node.isMesh) {
                node.castShadow = false;
                node.receiveShadow = false;
            }
        });
        normalizeModel(root, t3, modelParams());
        if (getT3() && getT3().flattenMeshMaterials) getT3().flattenMeshMaterials(root);
        root.rotation.x = Math.PI / 2;
        root.updateMatrixWorld(true);
        const boxGround = new t3.Box3().setFromObject(root);
        root.position.z -= boxGround.min.z;
        root.visible = true;
        return root;
    }

    function isBoostFireActive(boostHeld, driveInput, handbrake) {
        const drive = driveInput != null ? driveInput : 0;
        return !!boostHeld && drive > 0.15 && !handbrake;
    }

    function boostFirePosition() {
        return {
            x: opts.boostFireOffsetX != null ? opts.boostFireOffsetX : 0,
            y: opts.boostFireOffsetY != null ? opts.boostFireOffsetY : BOOST_FIRE.backM,
            z: opts.boostFireOffsetZ != null ? opts.boostFireOffsetZ : BOOST_FIRE.zLiftM
        };
    }

    function applyBoostFireOffset() {
        if (!boostFireMesh) return;
        const p = boostFirePosition();
        boostFireMesh.position.set(p.x, p.y, p.z);
    }

    function applyBoostFireRotation() {
        if (!boostFireMesh) return;
        const tilt = opts.boostFireTiltDeg != null ? opts.boostFireTiltDeg : 280;
        boostFireMesh.rotation.x = Math.PI * 0.5 - tilt * DEG;
    }

    function fxSizeScale(pct) {
        const p = pct != null ? pct : 100;
        return Math.max(0.01, p / 100);
    }

    function applyBoostFireScale() {
        if (!boostFireMesh) return;
        const s = BOOST_FIRE.sizeM * fxSizeScale(opts.boostFireSizePct);
        const img = boostFireTexture && boostFireTexture.image;
        if (img && img.width && img.height) {
            const aspect = img.width / img.height;
            boostFireMesh.scale.set(s * aspect, s, 1);
        } else {
            boostFireMesh.scale.set(s, s, 1);
        }
    }

    function ensureBoostFireMesh(t3) {
        if (boostFireMesh || !modelMount) return;
        const mat = new t3.MeshBasicMaterial({
            transparent: true,
            opacity: BOOST_FIRE.opacity,
            depthWrite: false,
            depthTest: true,
            side: t3.DoubleSide,
            blending: t3.AdditiveBlending
        });
        boostFireMesh = new t3.Mesh(new t3.PlaneGeometry(1, 1), mat);
        boostFireMesh.name = "geowalk-car-3d-boost-fire";
        boostFireMesh.renderOrder = 3;
        boostFireMesh.visible = false;
        applyBoostFireOffset();
        applyBoostFireRotation();
        applyBoostFireScale();
        modelMount.add(boostFireMesh);
        new t3.TextureLoader().load(
            BOOST_FIRE.src,
            (tex) => {
                tex.colorSpace = t3.SRGBColorSpace;
                boostFireTexture = tex;
                mat.map = tex;
                mat.needsUpdate = true;
                applyBoostFireScale();
            },
            undefined,
            (err) => console.warn("GeowalkCar3d: flame texture", err)
        );
    }

    function updateBoostFire(boostHeld, driveInput, handbrake) {
        const t3 = getTHREE();
        if (!t3 || !modelMount) return;
        ensureBoostFireMesh(t3);
        if (!boostFireMesh) return;
        const show = isBoostFireActive(boostHeld, driveInput, handbrake);
        boostFireMesh.visible = show;
        if (!show) return;
        applyBoostFireOffset();
    }

    function isDrivingMode(velFwd, velStrafe, driveInput, speed) {
        if (speed != null && speed > 0.05) return true;
        if (Math.abs(velFwd != null ? velFwd : 0) > 0.05) return true;
        if (Math.abs(velStrafe != null ? velStrafe : 0) > 0.05) return true;
        const drive = driveInput != null ? driveInput : 0;
        return Math.abs(drive) > 0.15;
    }

    function resetParkedPose(dt) {
        const blend = dt != null && dt > 0 ? 1 - Math.exp(-dt / 0.22) : 1;
        turnLeanDeg += (0 - turnLeanDeg) * blend;
        terrainPitchDeg += (0 - terrainPitchDeg) * blend;
        if (launchPitch.playing) {
            launchPitch.x += (0 - launchPitch.x) * blend;
            launchPitch.v *= Math.max(0, 1 - blend * 1.5);
            if (Math.abs(launchPitch.x) < 0.05 && Math.abs(launchPitch.v) < 0.2) {
                resetLaunchPitch(false);
            }
        }
    }

    function driverPosition() {
        return {
            x: opts.driverOffsetX != null ? opts.driverOffsetX : 1.6,
            y: opts.driverOffsetY != null ? opts.driverOffsetY : 1.5,
            z: opts.driverOffsetZ != null ? opts.driverOffsetZ : 2.2
        };
    }

    function applyDriverOffset() {
        if (!driverMesh) return;
        const p = driverPosition();
        driverMesh.position.set(p.x, p.y, p.z);
    }

    function applyDriverRotation() {
        if (!driverMesh) return;
        const rotX = (opts.driverRotXDeg != null ? opts.driverRotXDeg : 99) * DEG;
        const rotY = (opts.driverRotYDeg != null ? opts.driverRotYDeg : 180) * DEG;
        const rotZ = (opts.driverRotZDeg != null ? opts.driverRotZDeg : 0) * DEG;
        driverMesh.rotation.set(rotX, rotY, rotZ);
    }

    function applyDriverScale() {
        if (!driverMesh) return;
        const s = DRIVER_STAND.sizeM * fxSizeScale(opts.driverSizePct);
        const img = driverTexture && driverTexture.image;
        if (img && img.width && img.height) {
            const aspect = img.width / img.height;
            driverMesh.scale.set(s * aspect, s, 1);
        } else {
            driverMesh.scale.set(s * 0.55, s, 1);
        }
    }

    function resetDriverFade() {
        driverFade.t = 0;
        driverFade.dir = 0;
    }

    function resetDriverDrop() {
        driverDrop.pending = false;
        driverDrop.playing = false;
        driverDrop.delayLeft = 0;
        driverDrop.t = 0;
    }

    function scheduleDriverFall() {
        driverDrop.pending = true;
        driverDrop.playing = false;
        driverDrop.delayLeft = driverDrop.delay;
        driverDrop.t = 0;
    }

    function startDriverFade(dir) {
        driverFade.dir = dir;
        driverFade.t = 0;
    }

    function tickDriverDrop(dt) {
        const step = dt != null && dt > 0 ? dt : 0;
        if (!driverDrop.pending && !driverDrop.playing) return 0;

        if (driverDrop.pending) {
            driverDrop.delayLeft -= step;
            if (driverDrop.delayLeft > 0) return 0;
            driverDrop.pending = false;
            driverDrop.playing = true;
            driverDrop.t = 0;
            advanceDriverStand();
        }

        if (step) driverDrop.t += step;
        const u = Math.min(1, driverDrop.t / driverDrop.duration);
        const bounce = easeOutBounce(u);
        if (u >= 1) driverDrop.playing = false;
        return driverDrop.dropM * (1 - bounce);
    }

    function advanceDriverStand() {
        driverStandIdx = (driverStandIdx + 1) % DRIVER_STANDS.length;
        applyDriverStandTexture();
    }

    function applyDriverStandTexture() {
        if (!driverMesh || !driverMesh.material) return;
        const tex = driverTextures[driverStandIdx];
        if (!tex) return;
        driverTexture = tex;
        driverMesh.material.map = tex;
        driverMesh.material.needsUpdate = true;
        applyDriverScale();
    }

    function preloadDriverStands(t3) {
        if (driverStandsPreloadStarted) return;
        driverStandsPreloadStarted = true;
        const loader = new t3.TextureLoader();
        DRIVER_STANDS.forEach((src, i) => {
            loader.load(
                src,
                (tex) => {
                    tex.colorSpace = t3.SRGBColorSpace;
                    driverTextures[i] = tex;
                    if (i === driverStandIdx) applyDriverStandTexture();
                },
                undefined,
                (err) => console.warn("GeowalkCar3d: driver texture", src, err)
            );
        });
    }

    function ensureDriverMesh(t3) {
        if (driverMesh || !modelMount) return;
        const mat = new t3.MeshBasicMaterial({
            transparent: true,
            opacity: DRIVER_STAND.opacity,
            depthWrite: true,
            depthTest: true,
            side: t3.DoubleSide
        });
        driverMesh = new t3.Mesh(new t3.PlaneGeometry(1, 1), mat);
        driverMesh.name = "geowalk-car-3d-driver";
        driverMesh.renderOrder = 2;
        driverMesh.visible = false;
        applyDriverOffset();
        applyDriverRotation();
        applyDriverScale();
        modelMount.add(driverMesh);
        preloadDriverStands(t3);
    }

    function talkBubblePosition() {
        return {
            x: opts.talkOffsetX != null ? opts.talkOffsetX : 0,
            y: opts.talkOffsetY != null ? opts.talkOffsetY : 0,
            z: opts.talkOffsetZ != null ? opts.talkOffsetZ : 5.7
        };
    }

    function talkFontSizePx() {
        return opts.talkFontSize != null ? opts.talkFontSize : 60;
    }

    function talkLineHeightPx() {
        return Math.round(talkFontSizePx() * (16 / 13));
    }

    function talkBubbleSize() {
        const w = DRIVER_TALK.sizeM * fxSizeScale(opts.talkSizePct);
        return { w, h: w / 3 };
    }

    function applyTalkBubbleWorldPosition() {
        const T = getT3();
        if (!T || !talkGroup) return;
        const off = talkBubblePosition();
        const p = T.geoToLocal(talkAnchorLng, talkAnchorLat, activeBaseM + talkAnchorLift + off.z);
        talkGroup.position.set(p.x + off.x, p.y + off.y, p.z);
    }

    function applyTalkBubbleOrientation() {
        if (!talkGroup) return;
        talkGroup.rotation.set(0, 0, bearingToRotationZ(talkAnchorBearing));
    }

    function applyTalkBubbleScale() {
        if (!talkMesh) return;
        const s = talkBubbleSize();
        talkMesh.scale.set(s.w, s.h, 1);
    }

    function applyTalkBubbleTilt() {
        if (!talkMesh) return;
        const rotX = Math.PI * 0.5 + (opts.talkRotXDeg != null ? opts.talkRotXDeg : 0) * DEG;
        const rotY = (opts.talkRotYDeg != null ? opts.talkRotYDeg : 180) * DEG;
        const rotZ = (opts.talkRotZDeg != null ? opts.talkRotZDeg : 0) * DEG;
        talkMesh.rotation.set(rotX, rotY, rotZ);
    }

    function applyTalkBubbleTransform() {
        applyTalkBubbleWorldPosition();
        applyTalkBubbleOrientation();
        applyTalkBubbleTilt();
        applyTalkBubbleScale();
    }

    function wrapTalkLines(ctx, text, maxWidth) {
        const words = String(text || "").split(/\s+/);
        const lines = [];
        let line = "";
        for (const word of words) {
            const test = line ? line + " " + word : word;
            if (ctx.measureText(test).width > maxWidth && line) {
                lines.push(line);
                line = word;
            } else {
                line = test;
            }
        }
        if (line) lines.push(line);
        return lines;
    }

    function rebuildTalkCanvas() {
        if (!talkCtx || !talkCanvas || !talkBgImage) return;
        const text = talkPhrase || DRIVER_TALK_PHRASES[0];
        const w = DRIVER_TALK.canvasW;
        const h = DRIVER_TALK.canvasH;
        talkCtx.clearRect(0, 0, w, h);
        talkCtx.drawImage(talkBgImage, 0, 0, w, h);
        talkCtx.fillStyle = "#000000";
        talkCtx.font = talkFontSizePx() + "px system-ui, -apple-system, sans-serif";
        talkCtx.textAlign = "center";
        talkCtx.textBaseline = "middle";
        const lines = wrapTalkLines(talkCtx, text, DRIVER_TALK.textMaxW);
        const lineH = talkLineHeightPx();
        const totalH = lines.length * lineH;
        let y = DRIVER_TALK.textCenterY - totalH * 0.5 + lineH * 0.5;
        for (const line of lines) {
            talkCtx.fillText(line, w * 0.5, y);
            y += lineH;
        }
        if (talkTexture) talkTexture.needsUpdate = true;
    }

    function applyTalkBubbleSettings() {
        const t3 = getTHREE();
        const T = getT3();
        if (!t3 || !T || !T.isReady()) return;
        ensureDriverTalkMesh(t3);
        if (!talkMesh) return;
        applyTalkBubbleTransform();
        if (talkBgImage) rebuildTalkCanvas();
    }

    function pickRandomTalkPhrase() {
        talkPhrase = DRIVER_TALK_PHRASES[Math.floor(Math.random() * DRIVER_TALK_PHRASES.length)];
        rebuildTalkCanvas();
    }

    function ensureTalkBgImage() {
        if (talkBgImage || talkBgLoadStarted) return;
        talkBgLoadStarted = true;
        const img = new Image();
        img.onload = () => {
            talkBgImage = img;
            applyTalkBubbleSettings();
        };
        img.onerror = (err) => console.warn("GeowalkCar3d: driver talk svg", err);
        img.src = DRIVER_TALK.src;
    }

    function ensureDriverTalkMesh(t3) {
        if (talkMesh) return;
        const T = getT3();
        if (!T || !T.isReady()) return;
        ensureTalkBgImage();
        talkCanvas = document.createElement("canvas");
        talkCanvas.width = DRIVER_TALK.canvasW;
        talkCanvas.height = DRIVER_TALK.canvasH;
        talkCtx = talkCanvas.getContext("2d");
        talkTexture = new t3.CanvasTexture(talkCanvas);
        talkTexture.colorSpace = t3.SRGBColorSpace;
        const mat = new t3.MeshBasicMaterial({
            map: talkTexture,
            transparent: true,
            opacity: 1,
            depthWrite: true,
            depthTest: true,
            side: t3.DoubleSide
        });
        talkGroup = new t3.Group();
        talkGroup.name = "geowalk-car-3d-talk";
        talkMesh = new t3.Mesh(new t3.PlaneGeometry(1, 1), mat);
        talkMesh.name = "geowalk-car-3d-driver-talk";
        talkMesh.renderOrder = 4;
        talkMesh.visible = false;
        talkMesh.rotation.set(0, 0, 0);
        talkGroup.add(talkMesh);
        T.add(talkGroup);
        applyTalkBubbleTransform();
    }

    function updateDriverTalkBubble(show, opacity, pickNewPhrase) {
        const t3 = getTHREE();
        if (!t3) return;
        ensureDriverTalkMesh(t3);
        if (!talkMesh) return;
        if (pickNewPhrase || (show && !talkPhrase)) pickRandomTalkPhrase();
        if (show && opacity > 0.01) {
            talkMesh.visible = true;
            if (talkMesh.material) talkMesh.material.opacity = opacity;
            applyTalkBubbleTransform();
        } else {
            talkMesh.visible = false;
            if (talkMesh.material) talkMesh.material.opacity = 1;
        }
    }

    function updateDriver(controlsActive, dt) {
        const t3 = getTHREE();
        if (!t3 || !modelMount) return;
        ensureDriverMesh(t3);
        if (!driverMesh) return;

        const step = dt != null && dt > 0 ? dt : 0;
        const wantShow = controlsActive === false;
        if (!wantShow && (driverDrop.pending || driverDrop.playing)) resetDriverDrop();
        const dropOffsetY = wantShow ? tickDriverDrop(step) : 0;
        const falling = wantShow && driverDrop.playing;
        let pickNewTalk = false;

        if (!falling && !driverDrop.pending && lastDriverControlsActive !== controlsActive) {
            if (wantShow && lastDriverControlsActive !== null) {
                advanceDriverStand();
                pickNewTalk = true;
            }
            if (wantShow) {
                applyDriverOffset();
                applyDriverRotation();
                applyDriverScale();
                driverMesh.visible = true;
                startDriverFade(1);
            } else if (lastDriverControlsActive !== null) {
                startDriverFade(-1);
            } else {
                driverMesh.visible = false;
                resetDriverFade();
            }
            lastDriverControlsActive = controlsActive;
        }

        if (falling) {
            driverMesh.visible = true;
            if (driverMesh.material) driverMesh.material.opacity = DRIVER_STAND.opacity;
            const p = driverPosition();
            driverMesh.position.set(p.x, p.y + dropOffsetY, p.z);
            applyDriverRotation();
            applyDriverScale();
            updateDriverTalkBubble(false, 0, false);
            return;
        }

        if (!wantShow) {
            if (driverFade.dir === -1) {
                driverFade.t += step;
                const u = Math.min(1, driverFade.t / driverFade.duration);
                const opacity = DRIVER_STAND.opacity * (1 - u);
                if (driverMesh.material) driverMesh.material.opacity = opacity;
                applyDriverOffset();
                applyDriverRotation();
                applyDriverScale();
                driverMesh.visible = true;
                updateDriverTalkBubble(true, opacity, false);
                if (u >= 1) {
                    resetDriverFade();
                    driverMesh.visible = false;
                    if (driverMesh.material) driverMesh.material.opacity = DRIVER_STAND.opacity;
                    updateDriverTalkBubble(false, 0, false);
                }
            } else {
                resetDriverFade();
                driverMesh.visible = false;
                if (driverMesh.material) driverMesh.material.opacity = DRIVER_STAND.opacity;
                updateDriverTalkBubble(false, 0, false);
            }
            return;
        }

        if (driverFade.dir !== 0) {
            driverFade.t += step;
            const u = Math.min(1, driverFade.t / driverFade.duration);
            const opacity = driverFade.dir === 1
                ? DRIVER_STAND.opacity * u
                : DRIVER_STAND.opacity * (1 - u);
            if (driverMesh.material) driverMesh.material.opacity = opacity;
            applyDriverOffset();
            applyDriverRotation();
            applyDriverScale();
            driverMesh.visible = true;
            updateDriverTalkBubble(true, opacity, pickNewTalk);
            if (u >= 1) {
                resetDriverFade();
                if (driverMesh.material) driverMesh.material.opacity = DRIVER_STAND.opacity;
            }
            return;
        }

        driverMesh.visible = true;
        if (driverMesh.material) driverMesh.material.opacity = DRIVER_STAND.opacity;
        applyDriverOffset();
        applyDriverRotation();
        applyDriverScale();
        updateDriverTalkBubble(true, DRIVER_STAND.opacity, pickNewTalk);
    }

    function isStopFlameActive(driveInput, handbrake, velFwd, controlsActive) {
        if (controlsActive === false) return true;
        if (opts.stopFlameAlwaysVisible) return true;
        if (handbrake) return true;
        const drive = driveInput != null ? driveInput : 0;
        if (drive < -0.15) return true;
        const fwd = velFwd != null ? velFwd : 0;
        return fwd < -0.05;
    }

    function stopFlamePosition() {
        return {
            x: opts.stopFlameOffsetX != null ? opts.stopFlameOffsetX : 0,
            y: opts.stopFlameOffsetY != null ? opts.stopFlameOffsetY : STOP_FLAME.backM,
            z: opts.stopFlameOffsetZ != null ? opts.stopFlameOffsetZ : STOP_FLAME.zLiftM
        };
    }

    function applyStopFlameOffset() {
        if (!stopFlameMesh) return;
        const p = stopFlamePosition();
        stopFlameMesh.position.set(p.x, p.y, p.z);
    }

    function applyStopFlameRotation() {
        if (!stopFlameMesh) return;
        const tilt = opts.stopFlameTiltDeg != null ? opts.stopFlameTiltDeg : -19;
        stopFlameMesh.rotation.x = Math.PI * 0.5 - tilt * DEG;
    }

    function applyStopFlameScale() {
        if (!stopFlameMesh) return;
        const s = STOP_FLAME.sizeM * fxSizeScale(opts.stopFlameSizePct);
        const img = stopFlameTexture && stopFlameTexture.image;
        if (img && img.width && img.height) {
            const aspect = img.width / img.height;
            stopFlameMesh.scale.set(s * aspect, s, 1);
        } else {
            stopFlameMesh.scale.set(s, s, 1);
        }
    }

    function ensureStopFlameMesh(t3) {
        if (stopFlameMesh || !modelMount) return;
        const mat = new t3.MeshBasicMaterial({
            transparent: true,
            opacity: STOP_FLAME.opacity,
            depthWrite: false,
            depthTest: true,
            side: t3.DoubleSide,
            blending: t3.AdditiveBlending
        });
        stopFlameMesh = new t3.Mesh(new t3.PlaneGeometry(1, 1), mat);
        stopFlameMesh.name = "geowalk-car-3d-stop-flame";
        stopFlameMesh.renderOrder = 3;
        stopFlameMesh.visible = false;
        applyStopFlameOffset();
        applyStopFlameRotation();
        applyStopFlameScale();
        modelMount.add(stopFlameMesh);
        new t3.TextureLoader().load(
            STOP_FLAME.src,
            (tex) => {
                tex.colorSpace = t3.SRGBColorSpace;
                stopFlameTexture = tex;
                mat.map = tex;
                mat.needsUpdate = true;
                applyStopFlameScale();
            },
            undefined,
            (err) => console.warn("GeowalkCar3d: stop flame texture", err)
        );
    }

    function updateStopFlame(driveInput, handbrake, velFwd, controlsActive) {
        const t3 = getTHREE();
        if (!t3 || !modelMount) return;
        ensureStopFlameMesh(t3);
        if (!stopFlameMesh) return;
        const show = isStopFlameActive(driveInput, handbrake, velFwd, controlsActive);
        stopFlameMesh.visible = show;
        if (!show) return;
        applyStopFlameOffset();
        applyStopFlameRotation();
    }

    function applyPitchPivotOffset() {
        if (!modelMount) return;
        const x = opts.pitchPivotOffsetX != null ? opts.pitchPivotOffsetX : 0;
        const y = opts.pitchPivotOffsetY != null ? opts.pitchPivotOffsetY : 0;
        const z = opts.pitchPivotOffsetZ != null ? opts.pitchPivotOffsetZ : 0;
        modelMount.position.set(x, y, z);
    }

    async function ensureModel() {
        if (carGroup || loadStarted) return;
        loadStarted = true;
        const T = getT3();
        const t3 = getTHREE();
        if (!T || !t3 || !T.isReady()) { loadStarted = false; return; }

        try {
            model = await loadModel(t3);
            if (!model) throw new Error("no model loaded");

            modelPivot = new t3.Group();
            modelMount = new t3.Group();
            modelMount.name = "geowalk-car-3d-model-mount";
            modelMount.add(model);
            modelPivot.add(modelMount);
            pitchNode = new t3.Group();
            pitchNode.add(modelPivot);

            carGroup = new t3.Group();
            carGroup.name = "geowalk-car-3d";
            carGroup.add(pitchNode);
            carGroup.visible = false;
            applyPitchPivotOffset();
            applyActiveModelParams();
            ensureBoostFireMesh(t3);
            applyTalkBubbleSettings();
            T.add(carGroup);
            maybeStartPendingDrop();
        } catch (e) {
            console.warn("GeowalkCar3d: не удалось загрузить модель", e && e.message ? e.message : e);
            loadStarted = false;
            model = null;
        }
    }

    function onSceneReady() {
        carGroup = null;
        pitchNode = null;
        modelPivot = null;
        modelMount = null;
        boostFireMesh = null;
        boostFireTexture = null;
        stopFlameMesh = null;
        stopFlameTexture = null;
        driverMesh = null;
        driverTexture = null;
        driverTextures = [];
        driverStandIdx = 0;
        driverStandsPreloadStarted = false;
        const T = getT3();
        if (talkGroup && T) T.remove(talkGroup);
        talkGroup = null;
        talkMesh = null;
        talkTexture = null;
        talkCanvas = null;
        talkCtx = null;
        talkBgImage = null;
        talkBgLoadStarted = false;
        talkPhrase = "";
        resetDriverFade();
        resetDriverDrop();
        lastDriverControlsActive = null;
        model = null;
        loadStarted = false;
        terrainPitchDeg = 0;
        pendingDrop = false;
        dropAnim.playing = false;
        dropAnim.t = 0;
        resetLaunchPitch(true);
        applyActiveModelParams();
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

    function clearSurfaceFx() {
        clearWoodFx();
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

    function resetLaunchPitch(clearDir) {
        launchPitch.playing = false;
        launchPitch.t = 0;
        launchPitch.x = 0;
        launchPitch.v = 0;
        launchPitch.sign = 1;
        launchPitch.wasBrake = false;
        launchPitch.slowReturn = false;
        if (clearDir) launchPitch.lastDrive = 0;
    }

    function stepLaunchSpring(dt, holdBoost) {
        if (!dt || dt <= 0) return;
        const attack = launchPitch.attackSec != null ? launchPitch.attackSec : 0.22;
        const hold = !!holdBoost;
        if (hold && launchPitch.t >= attack) launchPitch.t = attack;
        const inAttack = launchPitch.t < attack;
        const slow = !!launchPitch.slowReturn;
        const target = (inAttack || hold) ? launchPitch.sign * launchPitch.deg : 0;
        const omega = inAttack || hold ? 16 : (slow ? 4.75 : 9.5);
        const zeta = inAttack || hold ? 0.72 : (slow ? 0.34 : 0.3);
        let remain = Math.min(dt, 0.05);
        while (remain > 0) {
            const step = Math.min(remain, 1 / 120);
            const acc = (-2 * zeta * omega * launchPitch.v)
                - (omega * omega * (launchPitch.x - target));
            launchPitch.v += acc * step;
            launchPitch.x += launchPitch.v * step;
            remain -= step;
        }
        launchPitch.t += dt;
        if (hold) return;
        const settleAfter = attack + (slow ? 0.9 : 0.35);
        const maxT = (launchPitch.duration || 1.5) * (slow ? 2 : 1) + 0.4;
        const settled = launchPitch.t > settleAfter
            && Math.abs(launchPitch.x) < 0.08
            && Math.abs(launchPitch.v) < 0.6;
        if (settled || launchPitch.t >= maxT) {
            resetLaunchPitch(false);
        }
    }

    function updateLaunchPitch(velFwd, velStrafe, dt, handbrake, driveInput, boostHeld) {
        const fwd = velFwd != null ? velFwd : 0;
        const drive = driveInput > 0.15 ? 1 : driveInput < -0.15 ? -1 : 0;
        const hardBrake = !!handbrake && Math.abs(fwd) > 1.2;
        const boosting = !!boostHeld && drive === 1 && !handbrake;
        if (hardBrake && !launchPitch.wasBrake) {
            launchPitch.playing = true;
            launchPitch.t = 0;
            launchPitch.sign = fwd > 0 ? -1 : 1;
            launchPitch.slowReturn = false;
        } else if (boosting) {
            if (!launchPitch.playing) launchPitch.t = 0;
            launchPitch.playing = true;
            launchPitch.sign = 1;
            launchPitch.slowReturn = true;
        } else if (!hardBrake && drive !== 0 && drive !== launchPitch.lastDrive) {
            launchPitch.playing = true;
            launchPitch.t = 0;
            launchPitch.sign = drive;
            launchPitch.slowReturn = true;
        }
        launchPitch.lastDrive = drive;
        launchPitch.wasBrake = hardBrake;
        if (launchPitch.playing) stepLaunchSpring(dt, boosting);
    }

    function launchPitchOffsetDeg() {
        return launchPitch.x;
    }

    function bearingToRotationZ(bearingDeg) {
        const b = bearingDeg * DEG;
        // MapLibre bearing: 0° = север (+y), 90° = восток (+x).
        return Math.atan2(Math.cos(b), Math.sin(b)) + (activeYawOffsetDeg || 0) * DEG;
    }

    function leanInputFrom(turnInput, velFwd) {
        const input = Math.max(-1, Math.min(1, turnInput != null ? turnInput : 0));
        if (Math.abs(input) < 1e-4) return 0;
        const forward = velFwd != null && velFwd > 0.05;
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
        const alt = activeBaseM + (lift || 0);
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

    function applyModelPose(bearingDeg) {
        const launchX = -launchPitchOffsetDeg() * DEG;
        carGroup.rotation.set(0, 0, bearingToRotationZ(bearingDeg) + turnLeanDeg * DEG);
        if (pitchNode) pitchNode.rotation.set(terrainPitchDeg * DEG, 0, 0);
        if (modelPivot) modelPivot.rotation.set(launchX, 0, 0);
    }

    function place(lng, lat, bearingDeg, turnInput, velFwd, velStrafe, cosLat, dt, handbrake, driveInput, boostHeld, speed, controlsActive) {
        if (!carGroup || !active) return;
        const driving = isDrivingMode(velFwd, velStrafe, driveInput, speed);
        const drivingActive = driving && controlsActive !== false;
        if (drivingActive) {
            updateTurnLean(turnInput, velFwd, dt);
            updateLaunchPitch(velFwd, velStrafe, dt, handbrake, driveInput, boostHeld);
        } else {
            resetParkedPose(dt);
        }
        const T = getT3();
        const lift = dropOffsetM(dt != null ? dt : 0);
        lastCarLiftM = lift;
        if (drivingActive) {
            updateTerrainPitch(lng, lat, bearingDeg, velFwd, velStrafe, cosLat, lift, dt);
        }
        const p = T.geoToLocal(lng, lat, activeBaseM + lift);
        carGroup.position.set(p.x, p.y, p.z);
        talkAnchorLng = lng;
        talkAnchorLat = lat;
        talkAnchorLift = lift;
        talkAnchorBearing = bearingDeg != null ? bearingDeg : 0;
        applyModelPose(bearingDeg);
        updateBoostFire(boostHeld, driveInput, handbrake);
        updateStopFlame(driveInput, handbrake, velFwd, controlsActive);
        updateDriver(controlsActive, dt);
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
                resetLaunchPitch(true);
                resetDriverDrop();
                clearSurfaceFx();
                if (talkMesh) talkMesh.visible = false;
                if (carGroup) carGroup.visible = false;
            }
            if (active) {
                ensureModel();
                maybeStartPendingDrop();
            }
        },
        configure(options) {
            opts = Object.assign({}, opts, options || {});
            if (active && !carGroup) ensureModel();
            applyPitchPivotOffset();
            applyBoostFireOffset();
            applyBoostFireRotation();
            applyBoostFireScale();
            applyStopFlameOffset();
            applyStopFlameRotation();
            applyStopFlameScale();
            applyDriverOffset();
            applyDriverRotation();
            applyDriverScale();
            applyTalkBubbleSettings();
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
                motion.dt,
                !!motion.handbrake,
                motion.driveInput != null ? motion.driveInput : 0,
                !!motion.boost,
                motion.speed,
                motion.controlsActive
            );
            const drivingActive = isDrivingMode(motion.velFwd, motion.velStrafe, motion.driveInput, motion.speed)
                && motion.controlsActive !== false;
            if (drivingActive) {
                updateWoodFx(motion, bearing);
            }
        },
        playDropAnim() {
            pendingDrop = true;
            if (active && carGroup) startDropAnim();
        },
        scheduleDriverFall() {
            scheduleDriverFall();
        },
        cycleDriverStand() {
            advanceDriverStand();
        },
        isReady() { return !!carGroup; }
    };
})();
