// Модуль: езда на машине (спрайт-лист: 4×600px × 2 ряда по 400px).
// Ряд 0 — обычное покрытие; ряд 1 — слой water. Кадры 0–2 — поворот сзади; кадр 3 — вид сверху.
(function () {
    "use strict";

    const SHEET = { frameWidth: 600, frameHeight: 400, frameCount: 4, rowCount: 2 };
    const WAKE_STEP_M = 3;
    const WAKE_LIFE_SEC = 1;
    const MAX_WAKE = 5;
    const M_PER_DEG_LAT = 111320;
    const DEG = Math.PI / 180;

    let wakeFx = {
        assetWidthPx: 120,
        assetHeightPx: 70,
        sizeScatterPct: 20
    };

    let wakeFxWood = {
        assetSizePx: 90,
        rotateMinDeg: -180,
        rotateMaxDeg: 180
    };

    let wakeFxSand = {
        assetSizePx: 90,
        rotateMinDeg: -180,
        rotateMaxDeg: 180
    };

    const WAKE_PROFILES = [
        { id: "water", src: "images/fx_1.png", motionKey: "onWater" },
        { id: "wood", src: "images/fx_2.png", motionKey: "onWood" },
        { id: "sand", src: "images/fx_3.png", motionKey: "onSand" }
    ];

    let opts = null;
    let root = null;
    let sprite = null;
    let fxRoot = null;
    let styleEl = null;
    let visible = false;
    let frameIndex = 0;
    let pivotX = null;
    let pivotY = null;
    let wakeSystems = [];

    function injectStyles() {
        if (styleEl) return;
        styleEl = document.createElement("style");
        styleEl.textContent = [
            "#geowalk-car {",
            "  position: fixed; left: 0; top: 0;",
            "  transform: translate(-50%, -50%);",
            "  pointer-events: none; opacity: 0; visibility: hidden;",
            "  transition: opacity 0.2s ease, visibility 0.2s ease;",
            "}",
            "#geowalk-car.visible { opacity: 1; visibility: visible; }",
            "#geowalk-car .car-sprite {",
            "  display: block;",
            "  width: var(--car-w);",
            "  height: calc(var(--car-w) * var(--car-aspect));",
            "  background-repeat: no-repeat;",
            "  background-size: calc(var(--car-w) * var(--car-frames)) calc(var(--car-w) * var(--car-aspect) * var(--car-rows));",
            "  background-position:",
            "    calc(var(--car-frame) * var(--car-w) * -1)",
            "    calc(var(--car-row) * var(--car-w) * var(--car-aspect) * -1);",
            "  will-change: background-position, transform;",
            "  transform: scaleX(var(--car-flip, 1)) rotate(var(--car-yaw, 0deg));",
            "}",
            "#geowalk-car-fx {",
            "  position: fixed; left: 0; top: 0; width: 0; height: 0;",
            "  pointer-events: none; z-index: 7; overflow: visible;",
            "}",
            "#geowalk-car-fx .car-wake {",
            "  position: fixed; left: 0; top: 0;",
            "  display: block; pointer-events: none;",
            "  object-fit: contain;",
            "  transform: translate(-50%, -50%);",
            "  will-change: left, top, opacity;",
            "}"
        ].join("\n");
        document.head.appendChild(styleEl);
    }

    function applySpriteMetrics() {
        if (!sprite || !opts) return;
        sprite.style.setProperty("--car-w", opts.widthPx + "px");
        sprite.style.setProperty("--car-aspect", String(SHEET.frameHeight / SHEET.frameWidth));
        sprite.style.setProperty("--car-frames", String(SHEET.frameCount));
        sprite.style.setProperty("--car-rows", String(SHEET.rowCount));
        sprite.style.setProperty("--car-row", "0");
        sprite.style.backgroundImage = "url(" + opts.src + ")";
    }

    function applySpriteRow(rowIndex) {
        if (!sprite) return;
        const row = Math.max(0, Math.min(SHEET.rowCount - 1, rowIndex | 0));
        sprite.style.setProperty("--car-row", String(row));
    }

    function squareWakeFx(profile) {
        if (!profile) return null;
        if (profile.id === "wood") return wakeFxWood;
        if (profile.id === "sand") return wakeFxSand;
        return null;
    }

    function wakeSizePx(profile) {
        const scatter = Math.max(0, wakeFx.sizeScatterPct) / 100;
        const factor = 1 + (Math.random() * 2 - 1) * scatter;
        const squareFx = squareWakeFx(profile);
        if (squareFx) {
            const side = squareFx.assetSizePx * factor;
            return { w: side, h: side };
        }
        return {
            w: wakeFx.assetWidthPx * factor,
            h: wakeFx.assetHeightPx * factor
        };
    }

    function applyWakeSize(el, w, h) {
        el.style.width = w + "px";
        el.style.height = h + "px";
    }

    function applyWakeTransform(slot, profile) {
        if (squareWakeFx(profile)) {
            const deg = slot.rotateDeg != null ? slot.rotateDeg : 0;
            slot.el.style.transform = "translate(-50%, -50%) rotate(" + deg + "deg)";
            return;
        }
        slot.el.style.transform = "translate(-50%, -50%)";
    }

    function randomSquareWakeRotateDeg(profile) {
        const fx = squareWakeFx(profile);
        if (!fx) return 0;
        const min = fx.rotateMinDeg;
        const max = fx.rotateMaxDeg;
        if (min >= max) return min;
        return min + Math.random() * (max - min);
    }

    function geoBehind(lng, lat, yawDeg, backM, sideM) {
        const b = (yawDeg || 0) * DEG;
        const cosLat = Math.cos(lat * DEG);
        return {
            lng: lng - (Math.sin(b) * backM + Math.cos(b) * sideM) / (M_PER_DEG_LAT * cosLat),
            lat: lat - (Math.cos(b) * backM - Math.sin(b) * sideM) / M_PER_DEG_LAT
        };
    }

    function wakeSrcFor(profile) {
        if (!profile) return "images/fx_1.png";
        if (profile.id === "water" && opts && opts.wakeSrc) return opts.wakeSrc;
        if (profile.id === "wood" && opts && opts.woodWakeSrc) return opts.woodWakeSrc;
        if (profile.id === "sand" && opts && opts.sandWakeSrc) return opts.sandWakeSrc;
        return profile.src;
    }

    function isWakeActive(profile, motion) {
        if (!motion || !profile) return false;
        return !!motion[profile.motionKey];
    }

    function ensureFxDom() {
        if (fxRoot) return;
        fxRoot = document.createElement("div");
        fxRoot.id = "geowalk-car-fx";
        fxRoot.setAttribute("aria-hidden", "true");
        document.body.appendChild(fxRoot);
        wakeSystems = WAKE_PROFILES.map(profile => {
            const pool = [];
            for (let i = 0; i < MAX_WAKE; i++) {
                const el = document.createElement("img");
                el.className = "car-wake";
                el.alt = "";
                el.src = wakeSrcFor(profile);
                el.style.display = "none";
                fxRoot.appendChild(el);
                pool.push({
                    el,
                    active: false,
                    lng: 0,
                    lat: 0,
                    age: 0,
                    widthPx: wakeFx.assetWidthPx,
                    heightPx: wakeFx.assetHeightPx,
                    rotateDeg: 0
                });
            }
            return { profile, pool, distAcc: 0 };
        });
    }

    function deactivateWake(slot) {
        slot.active = false;
        slot.age = 0;
        slot.el.style.display = "none";
    }

    function clearWakes() {
        for (const system of wakeSystems) {
            system.distAcc = 0;
            for (const slot of system.pool) deactivateWake(slot);
        }
    }

    function findWakeSlot(pool) {
        const free = pool.find(slot => !slot.active);
        if (free) return free;
        let oldest = pool[0];
        for (const slot of pool) {
            if (slot.age > oldest.age) oldest = slot;
        }
        return oldest;
    }

    function spawnWake(system, motion) {
        if (!fxRoot || !isWakeActive(system.profile, motion) || motion.lng == null || motion.lat == null) return;
        const slot = findWakeSlot(system.pool);
        const pos = geoBehind(
            motion.lng,
            motion.lat,
            motion.yaw,
            2.5 + Math.random() * 2,
            (Math.random() - 0.5) * 1.5
        );
        slot.active = true;
        slot.age = 0;
        slot.lng = pos.lng;
        slot.lat = pos.lat;
        slot.el.src = wakeSrcFor(system.profile);
        const size = wakeSizePx(system.profile);
        slot.widthPx = size.w;
        slot.heightPx = size.h;
        slot.rotateDeg = squareWakeFx(system.profile) ? randomSquareWakeRotateDeg(system.profile) : 0;
        applyWakeSize(slot.el, size.w, size.h);
        slot.el.style.opacity = "1";
        slot.el.style.display = "block";
        applyWakeTransform(slot, system.profile);
    }

    function carScreenY() {
        if (pivotY == null) return null;
        return pivotY + (opts ? opts.pivotOffsetY : 0);
    }

    function projectWake(slot, motion) {
        const project = motion && motion.projectPoint;
        if (!project) return null;
        try { return project(slot.lng, slot.lat); } catch (e) { return null; }
    }

    function updateSurfaceWake(dt, motion) {
        if (!fxRoot || !wakeSystems.length) return;
        const speed = motion && motion.speed != null ? motion.speed : 0;
        const viewMode = motion && motion.viewMode ? motion.viewMode : "chase";
        const canMove = visible && viewMode !== "topdown"
            && motion.lng != null && motion.lat != null && speed > 0.05;

        for (const system of wakeSystems) {
            const onSurface = isWakeActive(system.profile, motion);
            const canSpawn = canMove && onSurface;

            if (canSpawn) {
                system.distAcc += speed * dt;
                if (system.distAcc >= WAKE_STEP_M) {
                    system.distAcc -= WAKE_STEP_M;
                    spawnWake(system, motion);
                }
            } else if (!onSurface) {
                system.distAcc = 0;
            }

            for (const slot of system.pool) {
                if (!slot.active) continue;
                slot.age += dt;
                if (slot.age >= WAKE_LIFE_SEC) {
                    deactivateWake(slot);
                    continue;
                }
                const pt = projectWake(slot, motion);
                if (!pt) {
                    slot.el.style.display = "none";
                    continue;
                }
                const carY = carScreenY();
                if (carY != null && pt.y < carY) {
                    slot.el.style.display = "none";
                    continue;
                }
                slot.el.style.display = "block";
                slot.el.style.left = pt.x + "px";
                slot.el.style.top = pt.y + "px";
                slot.el.style.opacity = "1";
                applyWakeSize(slot.el, slot.widthPx, slot.heightPx);
                applyWakeTransform(slot, system.profile);
            }
        }
    }

    function ensureDom() {
        if (root) return;
        injectStyles();
        ensureFxDom();
        root = document.createElement("div");
        root.id = "geowalk-car";
        root.setAttribute("aria-hidden", "true");
        sprite = document.createElement("div");
        sprite.className = "car-sprite";
        root.style.zIndex = "8";
        root.appendChild(sprite);
        document.body.appendChild(root);
        applySpriteMetrics();
    }

    function applyPivotPosition() {
        if (!root || !opts || pivotX == null || pivotY == null) return;
        root.style.left = (pivotX + opts.pivotOffsetX) + "px";
        root.style.top = (pivotY + opts.pivotOffsetY) + "px";
    }

    function frameFromTurnSpeed(degPerSec) {
        const abs = Math.abs(degPerSec);
        const t1 = opts.turnThresholdDeg[0];
        const t2 = opts.turnThresholdDeg[1];
        if (abs < t1) return 0;
        if (abs < t2) return 1;
        return 2;
    }

    function sync(state) {
        if (!root) return;
        const show = !!(state && state.carMode && !state.overlayOpen);
        visible = show;
        root.classList.toggle("visible", show);
        root.setAttribute("aria-hidden", show ? "false" : "true");
        if (!show) {
            frameIndex = 0;
            pivotX = null;
            pivotY = null;
            clearWakes();
            if (sprite) {
                sprite.style.setProperty("--car-frame", "0");
                sprite.style.setProperty("--car-row", "0");
                sprite.style.setProperty("--car-flip", "1");
                sprite.style.setProperty("--car-yaw", "0deg");
            }
        }
    }

    function tick(motion) {
        if (!root || !sprite || !visible || !opts) return;
        const dt = motion && motion.dt != null ? motion.dt : 0;
        const viewMode = motion && motion.viewMode ? motion.viewMode : "chase";
        applySpriteRow(motion && motion.onWater ? 1 : 0);
        updateSurfaceWake(dt, motion);

        if (viewMode === "topdown") {
            sprite.style.setProperty("--car-frame", String(opts.topFrameIndex));
            sprite.style.setProperty("--car-flip", "1");
            sprite.style.setProperty("--car-yaw", "0deg");
            return;
        }

        const turnSpeed = motion && motion.turnSpeedDeg != null ? motion.turnSpeedDeg : 0;
        const targetFrame = frameFromTurnSpeed(turnSpeed);
        frameIndex += (targetFrame - frameIndex) * 0.22;
        const frame = Math.round(frameIndex);
        sprite.style.setProperty("--car-frame", String(frame));
        sprite.style.setProperty("--car-flip", turnSpeed < 0 ? "-1" : "1");
        sprite.style.setProperty("--car-yaw", "0deg");
    }

    window.GeowalkCarDrive = {
        init(options) {
            if (!options) return;
            opts = {
                src: options.src,
                widthPx: options.widthPx,
                turnThresholdDeg: options.turnThresholdDeg.slice(),
                pivotOffsetX: options.pivotOffsetX,
                pivotOffsetY: options.pivotOffsetY,
                topFrameIndex: options.topFrameIndex != null ? options.topFrameIndex : 3,
                wakeSrc: options.wakeSrc || "images/fx_1.png",
                woodWakeSrc: options.woodWakeSrc || "images/fx_2.png",
                sandWakeSrc: options.sandWakeSrc || "images/fx_3.png"
            };
            ensureDom();
            applySpriteMetrics();
            for (const system of wakeSystems) {
                for (const slot of system.pool) slot.el.src = wakeSrcFor(system.profile);
            }
        },
        sync(state) {
            ensureDom();
            sync(state || {});
        },
        setPivot(x, y) {
            if (!visible) return;
            pivotX = x;
            pivotY = y;
            applyPivotPosition();
        },
        tick(motion) {
            ensureDom();
            tick(motion || {});
        },
        destroy() {
            if (root) { root.remove(); root = null; }
            if (fxRoot) { fxRoot.remove(); fxRoot = null; }
            clearWakes();
            wakeSystems = [];
            sprite = null;
            opts = null;
            visible = false;
            pivotX = null;
            pivotY = null;
            if (styleEl) { styleEl.remove(); styleEl = null; }
        }
    };
})();
