// Модуль: руки от первого лица при режиме «Следовать рельефу».
// Подключение: <script src="modules/follow-terrain-hands.js"></script>
// GeowalkFollowTerrainHands.init();
// GeowalkFollowTerrainHands.sync({ followTerrain, overlayOpen });
// GeowalkFollowTerrainHands.tick({ speed, dt }); — каждый кадр из игрового цикла
(function () {
    "use strict";

    const DEFAULTS = {
        src: "images/v_hands.png",
        widthPercent: 55,
        maxWidthPx: 1000,
        zIndex: 7,
        bottomOffsetPx: -20,
        // Медленное плавное покачивание: фаза и амплитуда через сглаженную скорость
        bobRefSpeed: 20,
        bobPhaseRate: 0.22,
        bobHorizPx: 22,
        bobVertPx: 14,
        bobSpeedSmoothSec: 0.55,
        bobStrengthSmoothSec: 0.75,
        bobPosSmoothSec: 0.18,
        bobStopThreshold: 0.04
    };

    let opts = { ...DEFAULTS };
    let root = null;
    let img = null;
    let styleEl = null;
    let visible = false;
    let bobPhase = 0;
    let bobStrength = 0;
    let smoothSpeed = 0;
    let dispX = 0;
    let dispY = 0;

    function injectStyles() {
        if (styleEl) return;
        styleEl = document.createElement("style");
        styleEl.textContent = [
            "#geowalk-follow-hands {",
            "  position: absolute; left: 50%; transform: translateX(-50%);",
            "  pointer-events: none; opacity: 0; visibility: hidden;",
            "  transition: opacity 0.2s ease, visibility 0.2s ease;",
            "}",
            "#geowalk-follow-hands.visible { opacity: 1; visibility: visible; }",
            "#geowalk-follow-hands img {",
            "  display: block; height: auto; max-width: 100%;",
            "  will-change: transform;",
            "  transform: translate(0, 0);",
            "}"
        ].join("\n");
        document.head.appendChild(styleEl);
    }

    function ensureDom() {
        if (root) return;
        injectStyles();
        root = document.createElement("div");
        root.id = "geowalk-follow-hands";
        root.setAttribute("aria-hidden", "true");
        img = document.createElement("img");
        img.src = opts.src;
        img.alt = "";
        img.style.width = "min(" + opts.maxWidthPx + "px, " + opts.widthPercent + "vw)";
        root.style.zIndex = String(opts.zIndex);
        root.style.bottom = opts.bottomOffsetPx + "px";
        root.appendChild(img);
        document.body.appendChild(root);
    }

    function expBlend(dt, tauSec) {
        return 1 - Math.exp(-dt / Math.max(0.001, tauSec));
    }

    function applyBob(x, y) {
        if (!img) return;
        img.style.transform = "translate(" + x.toFixed(3) + "px, " + y.toFixed(3) + "px)";
    }

    function resetBob() {
        bobPhase = 0;
        bobStrength = 0;
        smoothSpeed = 0;
        dispX = 0;
        dispY = 0;
        applyBob(0, 0);
    }

    function sync(state) {
        if (!root) return;
        const show = !!(state && state.followTerrain && !state.overlayOpen);
        visible = show;
        root.classList.toggle("visible", show);
        root.setAttribute("aria-hidden", show ? "false" : "true");
        if (!show) resetBob();
    }

    function tick(motion) {
        if (!root || !img) return;
        if (!visible) {
            resetBob();
            return;
        }

        const speed = motion && motion.speed != null ? motion.speed : 0;
        const dt = motion && motion.dt != null ? motion.dt : 0;
        if (dt <= 0) return;

        smoothSpeed += (speed - smoothSpeed) * expBlend(dt, opts.bobSpeedSmoothSec);

        const speedNorm = Math.min(smoothSpeed / opts.bobRefSpeed, 1.2);
        const targetStrength = speedNorm > opts.bobStopThreshold ? speedNorm : 0;
        bobStrength += (targetStrength - bobStrength) * expBlend(dt, opts.bobStrengthSmoothSec);

        if (smoothSpeed > opts.bobStopThreshold) {
            bobPhase += smoothSpeed * dt * opts.bobPhaseRate;
        }

        const targetX = Math.cos(bobPhase) * opts.bobHorizPx * bobStrength;
        const targetY = Math.sin(bobPhase) * opts.bobVertPx * bobStrength;
        dispX += (targetX - dispX) * expBlend(dt, opts.bobPosSmoothSec);
        dispY += (targetY - dispY) * expBlend(dt, opts.bobPosSmoothSec);
        applyBob(dispX, dispY);
    }

    window.GeowalkFollowTerrainHands = {
        init(options) {
            opts = Object.assign({}, DEFAULTS, options || {});
            ensureDom();
            if (root) root.style.bottom = opts.bottomOffsetPx + "px";
        },
        sync(state) {
            ensureDom();
            sync(state || {});
        },
        tick(motion) {
            ensureDom();
            tick(motion || {});
        },
        destroy() {
            if (root) { root.remove(); root = null; }
            img = null;
            visible = false;
            resetBob();
            if (styleEl) { styleEl.remove(); styleEl = null; }
        }
    };
})();
