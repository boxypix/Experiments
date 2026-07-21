// Модуль: руки от первого лица при режиме «Следовать рельефу».
// Подключение: <script src="modules/follow-terrain-hands.js"></script>
// GeowalkFollowTerrainHands.init();
// GeowalkFollowTerrainHands.sync({ followTerrain, overlayOpen });
// GeowalkFollowTerrainHands.tick({ speed, dt, surfaceLayers });
(function () {
    "use strict";

    const DEFAULTS = {
        src: "images/v_hands.png",
        widthPercent: 55,
        maxWidthPx: 1000,
        zIndex: 7,
        bottomOffsetPx: -20,
        // Покачивание «∞» с постоянной угловой скоростью; при ускорении — сдвиг вниз
        bobPhaseRatePerSec: 4.4,
        bobHorizPx: 40,
        bobVertPx: 26,
        bobSpeedSmoothSec: 0.55,
        bobStrengthSmoothSec: 0.75,
        bobPosSmoothSec: 0.18,
        bobReturnSmoothSec: 0.12,
        bobStopThreshold: 0.04,
        sprintDropPercent: 25,
        sprintDropSmoothSec: 0.35,
        jumpDropSec: 1
    };

    let opts = { ...DEFAULTS };
    let root = null;
    let img = null;
    let styleEl = null;
    let visible = false;
    let bobPhase = 0;
    let bobStrength = 0;
    let smoothSpeed = 0;
    let sprintDropY = 0;
    let jumpDropTime = 0;
    let wasJumping = false;
    let dispX = 0;
    let dispY = 0;
    let activeSrc = null;

    const SURFACE_SRC_SUFFIX = [
        { layer: "water", suffix: "2" },
        { layer: "landcover_wood", suffix: "3" },
        { layer: "landcover_sand", suffix: "4" },
        { layer: "landuse_hospital", suffix: "5" },
        { layer: "landuse_school", suffix: "6" },
        { layer: "landuse_cemetery", suffix: "7" }
    ];

    function handsSrcForLayers(layers) {
        const base = opts.src;
        const hit = Array.isArray(layers) ? layers : [];
        let suffix = "";
        for (const rule of SURFACE_SRC_SUFFIX) {
            if (hit.includes(rule.layer)) {
                suffix = rule.suffix;
                break;
            }
        }
        if (!suffix) return base;
        const dot = base.lastIndexOf(".");
        if (dot <= 0) return base + suffix;
        return base.slice(0, dot) + suffix + base.slice(dot);
    }

    function applyHandsSrc(layers) {
        if (!img) return;
        const next = handsSrcForLayers(layers);
        if (next === activeSrc) return;
        activeSrc = next;
        img.src = next;
    }

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
            "}",
            "@media (max-width: 1000px) {",
            "  #geowalk-follow-hands {",
            "    left: 50%; width: 190vw; transform: translateX(-50%); bottom: 0;",
            "  }",
            "  #geowalk-follow-hands img {",
            "    width: 100% !important; max-width: none;",
            "  }",
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
        activeSrc = opts.src;
        img.src = activeSrc;
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

    function sprintDropPx() {
        const pct = Math.max(0, Math.min(100, opts.sprintDropPercent != null ? opts.sprintDropPercent : 25));
        return (window.innerHeight || 800) * (pct / 100);
    }

    function applyBob(x, y) {
        if (!img) return;
        img.style.transform = "translate(" + x.toFixed(3) + "px, " + y.toFixed(3) + "px)";
    }

    function resetBob() {
        bobPhase = 0;
        bobStrength = 0;
        smoothSpeed = 0;
        sprintDropY = 0;
        jumpDropTime = 0;
        wasJumping = false;
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
        else applyHandsSrc([]);
    }

    function tick(motion) {
        if (!root || !img) return;
        if (!visible) {
            resetBob();
            return;
        }

        applyHandsSrc(motion && motion.surfaceLayers);

        const speed = motion && motion.speed != null ? motion.speed : 0;
        const dt = motion && motion.dt != null ? motion.dt : 0;
        if (dt <= 0) return;

        const jumping = !!(motion && motion.jumping);
        const moving = speed > opts.bobStopThreshold;

        if (jumping && !wasJumping) jumpDropTime = 0;
        if (jumping) jumpDropTime += dt;
        wasJumping = jumping;
        const jumpDropping = jumping && jumpDropTime < (opts.jumpDropSec != null ? opts.jumpDropSec : 1);

        if (!moving && !jumping) {
            smoothSpeed = 0;
            bobPhase = 0;
            bobStrength = 0;
            const returnBlend = expBlend(dt, opts.bobReturnSmoothSec);
            sprintDropY += (0 - sprintDropY) * returnBlend;
            dispX += (0 - dispX) * returnBlend;
            dispY += (0 - dispY) * returnBlend;
            applyBob(dispX, dispY);
            return;
        }

        if (moving) {
            bobStrength += (1 - bobStrength) * expBlend(dt, opts.bobStrengthSmoothSec);
            bobPhase += dt * opts.bobPhaseRatePerSec;
        } else {
            bobPhase = 0;
            bobStrength = 0;
        }

        const sprinting = !!(motion && motion.sprinting);
        const targetDrop = (sprinting || jumpDropping) ? sprintDropPx() : 0;
        sprintDropY += (targetDrop - sprintDropY) * expBlend(dt, opts.sprintDropSmoothSec);

        const targetX = moving
            ? Math.sin(bobPhase) * opts.bobHorizPx * bobStrength
            : 0;
        const targetY = (moving
            ? Math.sin(2 * bobPhase) * opts.bobVertPx * 0.5 * bobStrength
            : 0) + sprintDropY;
        dispX += (targetX - dispX) * expBlend(dt, opts.bobPosSmoothSec);
        dispY += (targetY - dispY) * expBlend(dt, opts.bobPosSmoothSec);
        applyBob(dispX, dispY);
    }

    window.GeowalkFollowTerrainHands = {
        configure(options) {
            if (options) Object.assign(opts, options);
        },
        init(options) {
            opts = Object.assign({}, DEFAULTS, options || {});
            activeSrc = null;
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
