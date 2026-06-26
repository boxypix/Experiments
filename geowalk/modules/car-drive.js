// Модуль: езда на машине (спрайт-лист car_0.png: 4×600px).
// Кадры 0–2 — поворот сзади; кадр 3 — вид сверху (режим камеры topdown).
(function () {
    "use strict";

    const SHEET = { frameWidth: 600, frameHeight: 400, frameCount: 4 };

    let opts = null;
    let root = null;
    let sprite = null;
    let styleEl = null;
    let visible = false;
    let frameIndex = 0;
    let pivotX = null;
    let pivotY = null;

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
            "  background-size: calc(var(--car-w) * var(--car-frames)) 100%;",
            "  background-position: calc(var(--car-frame) * var(--car-w) * -1) 0;",
            "  will-change: background-position, transform;",
            "  transform: scaleX(var(--car-flip, 1)) rotate(var(--car-yaw, 0deg));",
            "}"
        ].join("\n");
        document.head.appendChild(styleEl);
    }

    function applySpriteMetrics() {
        if (!sprite || !opts) return;
        sprite.style.setProperty("--car-w", opts.widthPx + "px");
        sprite.style.setProperty("--car-aspect", String(SHEET.frameHeight / SHEET.frameWidth));
        sprite.style.setProperty("--car-frames", String(SHEET.frameCount));
        sprite.style.backgroundImage = "url(" + opts.src + ")";
    }

    function ensureDom() {
        if (root) return;
        injectStyles();
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
            if (sprite) {
                sprite.style.setProperty("--car-frame", "0");
                sprite.style.setProperty("--car-flip", "1");
                sprite.style.setProperty("--car-yaw", "0deg");
            }
        }
    }

    function tick(motion) {
        if (!root || !sprite || !visible || !opts) return;
        const viewMode = motion && motion.viewMode ? motion.viewMode : "chase";

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
                topFrameIndex: options.topFrameIndex != null ? options.topFrameIndex : 3
            };
            ensureDom();
            applySpriteMetrics();
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
            sprite = null;
            opts = null;
            visible = false;
            pivotX = null;
            pivotY = null;
            if (styleEl) { styleEl.remove(); styleEl = null; }
        }
    };
})();
