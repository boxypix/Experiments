// Post-processing поверх всего 3D viewport (MapLibre + Three.js custom layers).
// Tilt-shift, motion blur (temporal), edge sharpen (SVG convolve).
(function () {
    "use strict";

    const DEFAULTS = {
        tiltShiftEnabled: false,
        tiltShiftBlurPx: 8,
        tiltShiftBand: 0.25,
        motionBlurEnabled: false,
        motionBlurAmount: 0.55,
        sharpenEnabled: false,
        sharpenAmount: 0.45
    };

    let cfg = null;
    let mapRef = null;
    let viewportEl = null;
    let motionCanvas = null;
    let motionCtx = null;
    let tiltRoot = null;
    let sharpenMatrixEl = null;
    let renderHook = null;
    let motionPrimed = false;

    function clamp(v, lo, hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    function injectStyles() {
        if (document.getElementById("geowalk-postfx-styles")) return;
        const st = document.createElement("style");
        st.id = "geowalk-postfx-styles";
        st.textContent = [
            "#map-viewport { position: absolute; inset: 0; overflow: hidden; }",
            "#map-viewport #map { position: absolute; inset: 0; width: 100%; height: 100%; }",
            "#geowalk-postfx-motion {",
            "  position: absolute; inset: 0; width: 100%; height: 100%;",
            "  pointer-events: none; display: none; z-index: 1;",
            "}",
            "#geowalk-postfx-tilt {",
            "  position: absolute; inset: 0; pointer-events: none; display: none; z-index: 2;",
            "}",
            ".geowalk-postfx-tilt-band {",
            "  position: absolute; left: 0; right: 0; pointer-events: none;",
            "  backdrop-filter: blur(var(--postfx-tilt-blur, 8px));",
            "  -webkit-backdrop-filter: blur(var(--postfx-tilt-blur, 8px));",
            "}",
            ".geowalk-postfx-tilt-band.top {",
            "  top: 0; height: var(--postfx-tilt-band, 25%);",
            "  mask-image: linear-gradient(to bottom, #000, transparent);",
            "  -webkit-mask-image: linear-gradient(to bottom, #000, transparent);",
            "}",
            ".geowalk-postfx-tilt-band.bottom {",
            "  bottom: 0; height: var(--postfx-tilt-band, 25%);",
            "  mask-image: linear-gradient(to top, #000, transparent);",
            "  -webkit-mask-image: linear-gradient(to top, #000, transparent);",
            "}"
        ].join("\n");
        document.head.appendChild(st);
    }

    function injectSvgFilter() {
        if (document.getElementById("geowalk-postfx-sharpen-k")) return;
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("aria-hidden", "true");
        svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
        svg.innerHTML = [
            "<filter id=\"geowalk-postfx-sharpen\" color-interpolation-filters=\"sRGB\">",
            "<feConvolveMatrix id=\"geowalk-postfx-sharpen-k\" order=\"3\" preserveAlpha=\"true\"",
            " kernelMatrix=\"0 0 0 0 1 0 0 0 0\"/>",
            "</filter>"
        ].join("");
        document.body.appendChild(svg);
        sharpenMatrixEl = document.getElementById("geowalk-postfx-sharpen-k");
    }

    function ensureDom() {
        const mapEl = document.getElementById("map");
        if (!mapEl) return;

        injectStyles();
        injectSvgFilter();

        if (mapEl.parentElement && mapEl.parentElement.id === "map-viewport") {
            viewportEl = mapEl.parentElement;
        } else {
            viewportEl = document.createElement("div");
            viewportEl.id = "map-viewport";
            mapEl.parentNode.insertBefore(viewportEl, mapEl);
            viewportEl.appendChild(mapEl);
        }

        if (!motionCanvas) {
            motionCanvas = document.createElement("canvas");
            motionCanvas.id = "geowalk-postfx-motion";
            viewportEl.appendChild(motionCanvas);
            motionCtx = motionCanvas.getContext("2d", { alpha: true });
        }

        if (!tiltRoot) {
            tiltRoot = document.createElement("div");
            tiltRoot.id = "geowalk-postfx-tilt";
            const top = document.createElement("div");
            top.className = "geowalk-postfx-tilt-band top";
            const bottom = document.createElement("div");
            bottom.className = "geowalk-postfx-tilt-band bottom";
            tiltRoot.appendChild(top);
            tiltRoot.appendChild(bottom);
            viewportEl.appendChild(tiltRoot);
        }
    }

    function resizeMotionCanvas() {
        if (!motionCanvas || !mapRef) return;
        const src = mapRef.getCanvas();
        if (!src) return;
        const w = src.width;
        const h = src.height;
        if (!w || !h) return;
        if (motionCanvas.width !== w || motionCanvas.height !== h) {
            motionCanvas.width = w;
            motionCanvas.height = h;
            motionPrimed = false;
        }
    }

    function updateSharpenFilter() {
        if (!viewportEl || !cfg) return;
        if (!cfg.sharpenEnabled || cfg.sharpenAmount <= 0) {
            viewportEl.style.filter = "";
            return;
        }
        const a = clamp(cfg.sharpenAmount, 0, 1);
        const c = 1 + 4 * a;
        const o = -a;
        if (sharpenMatrixEl) {
            sharpenMatrixEl.setAttribute(
                "kernelMatrix",
                "0 " + o + " 0 " + o + " " + c + " " + o + " 0 " + o + " 0"
            );
        }
        viewportEl.style.filter = "url(#geowalk-postfx-sharpen)";
    }

    function updateTiltShift() {
        if (!tiltRoot || !cfg) return;
        const on = cfg.tiltShiftEnabled && cfg.tiltShiftBlurPx > 0 && cfg.tiltShiftBand > 0;
        tiltRoot.style.display = on ? "block" : "none";
        if (!on) return;
        tiltRoot.style.setProperty("--postfx-tilt-blur", clamp(cfg.tiltShiftBlurPx, 0, 40) + "px");
        tiltRoot.style.setProperty("--postfx-tilt-band", (clamp(cfg.tiltShiftBand, 0.05, 0.45) * 100) + "%");
    }

    function updateMotionBlurVisibility() {
        if (!motionCanvas || !cfg) return;
        const on = cfg.motionBlurEnabled && cfg.motionBlurAmount > 0;
        motionCanvas.style.display = on ? "block" : "none";
        if (!on) motionPrimed = false;
    }

    function afterMapRender() {
        if (!cfg || !mapRef || !motionCanvas || !motionCtx) return;
        if (!cfg.motionBlurEnabled || cfg.motionBlurAmount <= 0) return;

        resizeMotionCanvas();
        const src = mapRef.getCanvas();
        const w = motionCanvas.width;
        const h = motionCanvas.height;
        if (!src || !w || !h) return;

        const mix = clamp(cfg.motionBlurAmount, 0.02, 0.95);

        if (!motionPrimed) {
            motionCtx.setTransform(1, 0, 0, 1, 0, 0);
            motionCtx.globalCompositeOperation = "source-over";
            motionCtx.globalAlpha = 1;
            motionCtx.clearRect(0, 0, w, h);
            motionCtx.drawImage(src, 0, 0, w, h);
            motionPrimed = true;
            return;
        }

        motionCtx.globalCompositeOperation = "source-over";
        motionCtx.globalAlpha = 1 - mix;
        motionCtx.drawImage(motionCanvas, 0, 0, w, h);
        motionCtx.globalAlpha = mix;
        motionCtx.drawImage(src, 0, 0, w, h);
        motionCtx.globalAlpha = 1;
    }

    function bindMap(m) {
        if (renderHook && mapRef) {
            try { mapRef.off("render", renderHook); } catch (e) { /* ok */ }
            try { mapRef.off("resize", resizeMotionCanvas); } catch (e) { /* ok */ }
        }
        mapRef = m;
        if (!m) return;
        renderHook = function () {
            requestAnimationFrame(afterMapRender);
        };
        m.on("render", renderHook);
        m.on("resize", resizeMotionCanvas);
    }

    function applyAll() {
        updateSharpenFilter();
        updateTiltShift();
        updateMotionBlurVisibility();
        resizeMotionCanvas();
        if (mapRef) try { mapRef.triggerRepaint(); } catch (e) { /* ok */ }
    }

    window.GeowalkPostFx = {
        setup(m, options) {
            cfg = Object.assign({}, DEFAULTS, options || cfg || {});
            ensureDom();
            bindMap(m);
            applyAll();
        },
        sync(options) {
            if (!cfg) cfg = Object.assign({}, DEFAULTS);
            if (options) {
                if (options.tiltShiftEnabled != null) cfg.tiltShiftEnabled = options.tiltShiftEnabled === true;
                if (options.tiltShiftBlurPx != null) cfg.tiltShiftBlurPx = options.tiltShiftBlurPx;
                if (options.tiltShiftBand != null) cfg.tiltShiftBand = options.tiltShiftBand;
                if (options.motionBlurEnabled != null) cfg.motionBlurEnabled = options.motionBlurEnabled === true;
                if (options.motionBlurAmount != null) cfg.motionBlurAmount = options.motionBlurAmount;
                if (options.sharpenEnabled != null) cfg.sharpenEnabled = options.sharpenEnabled === true;
                if (options.sharpenAmount != null) cfg.sharpenAmount = options.sharpenAmount;
            }
            applyAll();
        },
        teardown() {
            bindMap(null);
            cfg = null;
            motionPrimed = false;
        }
    };
})();
