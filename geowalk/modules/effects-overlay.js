// Модуль: оверлей визуальных эффектов поверх сцены.
// Первый эффект — вспышка рамкой (например, зелёной) при сборе пина.
// Подключение: <script src="modules/effects-overlay.js"></script>
// GeowalkEffects.init();
// GeowalkEffects.flashBorder({ color, widthPx, durationSec });
// GeowalkEffects.flashSavePinBorder({ color, widthPx, durationSec });
(function () {
    "use strict";

    const DEFAULTS = {
        zIndex: 30,
        borderColor: "#22e05a",
        borderWidthPx: 30,
        borderDurationSec: 1,
        savePinBorderColor: "#9DFF00",
        savePinBorderWidthPx: 30,
        savePinBorderDurationSec: 1
    };

    let opts = { ...DEFAULTS };
    let root = null;
    let borderEl = null;
    let savePinBorderEl = null;
    let styleEl = null;
    let borderAnim = null;
    let savePinBorderAnim = null;

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
        savePinBorderEl = document.createElement("div");
        savePinBorderEl.className = "fx-border";
        root.appendChild(savePinBorderEl);
        document.body.appendChild(root);
    }

    function flashBorderEl(el, o, defaults) {
        ensureDom();
        if (!el) return null;
        const color = (o && o.color) || defaults.color;
        const widthPx = (o && o.widthPx != null) ? o.widthPx : defaults.widthPx;
        const durationSec = (o && o.durationSec != null) ? o.durationSec : defaults.durationSec;
        el.style.setProperty("--fx-border-c", color);
        el.style.setProperty("--fx-border-w", widthPx + "px");
        return el.animate(
            [{ opacity: 1 }, { opacity: 0 }],
            { duration: Math.max(1, durationSec * 1000), easing: "ease-out", fill: "forwards" }
        );
    }

    function flashBorder(o) {
        if (borderAnim) { try { borderAnim.cancel(); } catch (e) {} }
        borderAnim = flashBorderEl(borderEl, o, {
            color: opts.borderColor,
            widthPx: opts.borderWidthPx,
            durationSec: opts.borderDurationSec
        });
    }

    function flashSavePinBorder(o) {
        if (savePinBorderAnim) { try { savePinBorderAnim.cancel(); } catch (e) {} }
        savePinBorderAnim = flashBorderEl(savePinBorderEl, o, {
            color: opts.savePinBorderColor,
            widthPx: opts.savePinBorderWidthPx,
            durationSec: opts.savePinBorderDurationSec
        });
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
        flashSavePinBorder(o) {
            flashSavePinBorder(o || {});
        },
        destroy() {
            if (borderAnim) { try { borderAnim.cancel(); } catch (e) {} borderAnim = null; }
            if (savePinBorderAnim) { try { savePinBorderAnim.cancel(); } catch (e) {} savePinBorderAnim = null; }
            if (root) { root.remove(); root = null; }
            borderEl = null;
            savePinBorderEl = null;
            if (styleEl) { styleEl.remove(); styleEl = null; }
        }
    };
})();
