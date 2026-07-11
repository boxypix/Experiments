// Модуль: оверлей визуальных эффектов поверх сцены.
// Первый эффект — вспышка рамкой (например, зелёной) при сборе пина.
// Подключение: <script src="modules/effects-overlay.js"></script>
// GeowalkEffects.init();
// GeowalkEffects.flashBorder({ color, widthPx, durationSec });
(function () {
    "use strict";

    const DEFAULTS = {
        zIndex: 30,
        borderColor: "#22e05a",
        borderWidthPx: 30,
        borderDurationSec: 1
    };

    let opts = { ...DEFAULTS };
    let root = null;
    let borderEl = null;
    let styleEl = null;
    let borderAnim = null;

    function injectStyles() {
        if (styleEl) return;
        styleEl = document.createElement("style");
        styleEl.textContent = [
            "#geowalk-effects {",
            "  position: fixed; inset: 0;",
            "  pointer-events: none; overflow: hidden;",
            "}",
            "#geowalk-effects .fx-border {",
            "  position: absolute; inset: 0;",
            "  pointer-events: none; opacity: 0;",
            "  box-shadow: inset 0 0 0 var(--fx-border-w, 30px) var(--fx-border-c, #22e05a);",
            "}"
        ].join("\n");
        document.head.appendChild(styleEl);
    }

    function ensureDom() {
        if (root) return;
        injectStyles();
        root = document.createElement("div");
        root.id = "geowalk-effects";
        root.setAttribute("aria-hidden", "true");
        root.style.zIndex = String(opts.zIndex);
        borderEl = document.createElement("div");
        borderEl.className = "fx-border";
        root.appendChild(borderEl);
        document.body.appendChild(root);
    }

    function flashBorder(o) {
        ensureDom();
        const color = (o && o.color) || opts.borderColor;
        const widthPx = (o && o.widthPx != null) ? o.widthPx : opts.borderWidthPx;
        const durationSec = (o && o.durationSec != null) ? o.durationSec : opts.borderDurationSec;
        borderEl.style.setProperty("--fx-border-c", color);
        borderEl.style.setProperty("--fx-border-w", widthPx + "px");
        if (borderAnim) { try { borderAnim.cancel(); } catch (e) {} }
        borderAnim = borderEl.animate(
            [{ opacity: 1 }, { opacity: 0 }],
            { duration: Math.max(1, durationSec * 1000), easing: "ease-out", fill: "forwards" }
        );
    }

    window.GeowalkEffects = {
        init(options) {
            opts = Object.assign({}, DEFAULTS, options || {});
            if (root) root.style.zIndex = String(opts.zIndex);
            ensureDom();
        },
        flashBorder(o) {
            flashBorder(o || {});
        },
        destroy() {
            if (borderAnim) { try { borderAnim.cancel(); } catch (e) {} borderAnim = null; }
            if (root) { root.remove(); root = null; }
            borderEl = null;
            if (styleEl) { styleEl.remove(); styleEl = null; }
        }
    };
})();
