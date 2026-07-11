// Модуль: спрайт-моб it_sprite1 — квадратные билборд-спрайты, стоящие в мире.
// Спавнятся в радиусе spawnRadiusM метров от игрока, всегда «смотрят» на камеру,
// нижней точкой стоят на земле и масштабируются от расстояния (перспектива):
// вблизи огромные, вдали маленькие. Проецируются через map.project (как машина).
// Если игрок покидает радиус появления — спрайты пере-генерируются заново
// вокруг новой позиции (как кубики it_green / it_orange).
//
// GeowalkGiantMob.init({ src, spawnRadiusM, count, sizeM, enabled })
// GeowalkGiantMob.tick({ lng, lat, bearing, projectPoint })
// GeowalkGiantMob.getParams() / setParam(key, value)
(function () {
    "use strict";

    const M_PER_DEG_LAT = 111320;
    const DEG = Math.PI / 180;

    const DEFAULTS = {
        id: "it_sprite1",
        src: "images/mo_1a.png",
        spawnMinM: 120,        // ближе этого не спавним, чтобы не «в лицо»
        spawnRadiusM: 1000,
        count: 1,
        sizeM: 120,            // ширина = высота (квадратный спрайт), в метрах
        enabled: true,
        minScreenPx: 4,
        maxScreenPx: 6000,
        minApproachFactor: 0.35,   // нижний предел уменьшения при приближении
        approachPow: 1.35,         // 1 = без эффекта, 2 = сильное сжатие вблизи
        fadeStartM: 300,           // дальше — невидим (opacity 0)
        fadeEndM: 200,             // ближе — полностью видим (opacity 1)
        nearHideM: 3,              // 0..nearHideM м — спрайт полностью прозрачен
        nearShowM: 8,              // к этой дистанции снова полностью видим
        fadeSideFullFrac: 0,       // |смещение от центра|/полуширина: полностью непрозрачен в центре
        fadeSideZeroFrac: 0.7,     // 0.7 = граница 15% ширины от края экрана → opacity 0
        behindThresholdDeg: 100,
        cubeEnabled: true,         // белый куб-основание под спрайтом
        cubeSizeM: 3,              // куб 3×3×3 м
        cubeColor: [255, 255, 255] // rgb белого куба
    };

    const CUBE_SOURCE = "geowalk-sprite1-cubes";
    const CUBE_LAYER = "geowalk-sprite1-cubes";

    let opts = { ...DEFAULTS };
    let styleEl = null;
    let root = null;
    let els = [];
    let instances = [];      // { lng, lat }
    let seededAround = null;
    let mapRef = null;

    function injectStyles() {
        if (styleEl) return;
        styleEl = document.createElement("style");
        styleEl.textContent = [
            "#geowalk-sprite1 { position: fixed; left: 0; top: 0; width: 0; height: 0;",
            "  pointer-events: none; z-index: 6; overflow: visible; }",
            "#geowalk-sprite1 .gw-sprite1 {",
            "  position: fixed; left: 0; top: 0;",
            "  transform: translate(-50%, -100%); transform-origin: 50% 100%;",
            "  pointer-events: none; display: none;",
            "  will-change: left, top, width, height;",
            "}"
        ].join("\n");
        document.head.appendChild(styleEl);
    }

    function ensureRoot() {
        if (root) return;
        injectStyles();
        root = document.createElement("div");
        root.id = "geowalk-sprite1";
        root.setAttribute("aria-hidden", "true");
        document.body.appendChild(root);
    }

    function ensurePool(n) {
        ensureRoot();
        while (els.length < n) {
            const img = document.createElement("img");
            img.className = "gw-sprite1";
            img.alt = "";
            img.decoding = "async";
            img.src = opts.src;
            root.appendChild(img);
            els.push(img);
        }
        while (els.length > n) {
            const img = els.pop();
            img.remove();
        }
    }

    function distM(lng1, lat1, lng2, lat2) {
        const cosLat = Math.cos(((lat1 + lat2) / 2) * DEG);
        const dLat = (lat2 - lat1) * M_PER_DEG_LAT;
        const dLng = (lng2 - lng1) * M_PER_DEG_LAT * cosLat;
        return Math.hypot(dLat, dLng);
    }

    function randomSpawn(lng, lat) {
        const cosLat = Math.cos(lat * DEG) || 1e-6;
        const bearing = Math.random() * Math.PI * 2;
        const dist = opts.spawnMinM + Math.random() * Math.max(0, opts.spawnRadiusM - opts.spawnMinM);
        return {
            lng: lng + (Math.sin(bearing) * dist) / (M_PER_DEG_LAT * cosLat),
            lat: lat + (Math.cos(bearing) * dist) / M_PER_DEG_LAT
        };
    }

    function seedAll(lng, lat) {
        instances = [];
        const n = Math.max(0, opts.count | 0);
        for (let i = 0; i < n; i++) instances.push(randomSpawn(lng, lat));
        seededAround = { lng, lat };
    }

    function normDeg(d) {
        while (d > 180) d -= 360;
        while (d < -180) d += 360;
        return d;
    }

    function hideAll() {
        for (const img of els) img.style.display = "none";
    }

    // Квадратный footprint куба-основания под спрайтом.
    function cubePolygon(lng, lat, halfM) {
        const mLng = M_PER_DEG_LAT * Math.cos(lat * DEG) || 1e-6;
        const dLng = halfM / mLng;
        const dLat = halfM / M_PER_DEG_LAT;
        const ring = [
            [lng - dLng, lat - dLat],
            [lng + dLng, lat - dLat],
            [lng + dLng, lat + dLat],
            [lng - dLng, lat + dLat]
        ];
        ring.push(ring[0]);
        return [ring];
    }

    function cubeFeature(lng, lat, op) {
        return {
            type: "Feature",
            properties: { h: opts.cubeSizeM, op: op },
            geometry: { type: "Polygon", coordinates: cubePolygon(lng, lat, opts.cubeSizeM / 2) }
        };
    }

    function findInsertBefore(map) {
        const layers = map.getStyle() && map.getStyle().layers;
        if (!layers) return undefined;
        for (let i = 0; i < layers.length; i++) {
            if (layers[i].type === "symbol") return layers[i].id;
        }
        return undefined;
    }

    function ensureCubeLayer() {
        if (!mapRef) return;
        if (!mapRef.getSource(CUBE_SOURCE)) {
            mapRef.addSource(CUBE_SOURCE, {
                type: "geojson",
                data: { type: "FeatureCollection", features: [] }
            });
        }
        if (!mapRef.getLayer(CUBE_LAYER)) {
            const c = opts.cubeColor;
            mapRef.addLayer({
                id: CUBE_LAYER,
                type: "fill-extrusion",
                source: CUBE_SOURCE,
                paint: {
                    // Прозрачность per-cube — через alpha цвета (data-driven "op").
                    "fill-extrusion-color": ["rgba", c[0], c[1], c[2], ["get", "op"]],
                    "fill-extrusion-base": 0,
                    "fill-extrusion-height": ["get", "h"],
                    "fill-extrusion-opacity": 1
                }
            }, findInsertBefore(mapRef));
        }
    }

    function setCubeData(features) {
        if (!mapRef) return;
        try {
            const src = mapRef.getSource(CUBE_SOURCE);
            if (src) src.setData({ type: "FeatureCollection", features: features || [] });
        } catch (e) { /* стиль перезагружается */ }
    }

    // Пиксели на метр в точке основания — среднее по двум ортам.
    function pixelsPerMeter(project, lng, lat) {
        const cosLat = Math.cos(lat * DEG) || 1e-6;
        const dM = 5;
        const p0 = project(lng, lat);
        const pe = project(lng + dM / (M_PER_DEG_LAT * cosLat), lat);
        const pn = project(lng, lat + dM / M_PER_DEG_LAT);
        if (!p0 || !pe || !pn) return null;
        const de = Math.hypot(pe.x - p0.x, pe.y - p0.y);
        const dn = Math.hypot(pn.x - p0.x, pn.y - p0.y);
        return { base: p0, pxPerM: (de + dn) / (2 * dM) };
    }

    function tick(motion) {
        ensurePool(opts.enabled ? Math.max(0, opts.count | 0) : 0);
        if (!opts.enabled) { hideAll(); setCubeData([]); return; }

        const lng = motion && motion.lng;
        const lat = motion && motion.lat;
        const project = motion && motion.projectPoint;
        if (lng == null || lat == null || typeof project !== "function") { hideAll(); setCubeData([]); return; }

        // Пере-генерация при выходе за радиус появления.
        if (!seededAround || instances.length !== (opts.count | 0) ||
            distM(seededAround.lng, seededAround.lat, lng, lat) > opts.spawnRadiusM) {
            seedAll(lng, lat);
        }

        const camBearing = motion.bearing != null ? motion.bearing : 0;
        const cosLat = Math.cos(lat * DEG) || 1e-6;
        const span = Math.max(1e-3, opts.fadeStartM - opts.fadeEndM);
        const cubeFeats = [];

        for (let i = 0; i < instances.length; i++) {
            const inst = instances[i];
            const img = els[i];

            const d = distM(lng, lat, inst.lng, inst.lat);
            // Проявление из прозрачности: дальше fadeStartM — невидим,
            // между fadeStartM и fadeEndM плавно проявляется, ближе — полностью виден.
            const distOpacity = Math.max(0, Math.min(1, (opts.fadeStartM - d) / span));

            // Куб-основание проявляется на той же дистанции, что и спрайт.
            if (opts.cubeEnabled && distOpacity > 0) {
                cubeFeats.push(cubeFeature(inst.lng, inst.lat, distOpacity));
            }

            if (!img) continue;

            const east = (inst.lng - lng) * M_PER_DEG_LAT * cosLat;
            const north = (inst.lat - lat) * M_PER_DEG_LAT;
            const bearingToInst = Math.atan2(east, north) / DEG;
            const relBearing = Math.abs(normDeg(bearingToInst - camBearing));
            // Только отсечение того, что позади камеры; края экрана гасит плавный
            // боковой fade ниже (до границы 15% ширины).
            if (relBearing > opts.behindThresholdDeg) { img.style.display = "none"; continue; }
            if (distOpacity <= 0) { img.style.display = "none"; continue; }

            const m = pixelsPerMeter(project, inst.lng, inst.lat);
            if (!m || !isFinite(m.pxPerM) || m.pxPerM <= 0) { img.style.display = "none"; continue; }

            // Лёгкая инверсия перспективы: чем ближе игрок, тем немного МЕНЬШЕ
            // спрайт. Показатель approachPow чуть больше 1 — эффект едва заметный,
            // как иллюзия перспективы, а не резкое сжатие.
            const t = Math.max(0, Math.min(1, d / (opts.spawnRadiusM || 1)));
            const approach = Math.max(opts.minApproachFactor, Math.pow(t, opts.approachPow));

            let side = opts.sizeM * m.pxPerM * approach;
            side = Math.max(opts.minScreenPx, Math.min(opts.maxScreenPx, side));

            // Боковое проявление: у центра экрана полностью видим, к краю —
            // уходит в прозрачность; на границе 15% ширины от края уже 0.
            const halfW = (window.innerWidth || 1) / 2;
            const nx = Math.abs(m.base.x - halfW) / (halfW || 1);
            const sideSpan = Math.max(1e-3, opts.fadeSideZeroFrac - opts.fadeSideFullFrac);
            const sideOpacity = Math.max(0, Math.min(1, (opts.fadeSideZeroFrac - nx) / sideSpan));

            // Ближняя зона: 0..nearHideM м — спрайт прозрачен, затем плавно проявляется.
            const nearSpan = Math.max(1e-3, opts.nearShowM - opts.nearHideM);
            const nearOpacity = Math.max(0, Math.min(1, (d - opts.nearHideM) / nearSpan));

            const finalOpacity = distOpacity * sideOpacity * nearOpacity;
            if (finalOpacity <= 0) { img.style.display = "none"; continue; }

            img.style.width = side + "px";
            img.style.height = side + "px";
            img.style.left = m.base.x + "px";
            img.style.top = m.base.y + "px";
            img.style.opacity = String(finalOpacity);
            img.style.display = "block";
        }

        setCubeData(cubeFeats);
    }

    window.GeowalkGiantMob = {
        init(options) {
            opts = Object.assign({}, DEFAULTS, options || {});
            seededAround = null;
            ensurePool(opts.enabled ? Math.max(0, opts.count | 0) : 0);
            for (const img of els) if (img.getAttribute("src") !== opts.src) img.src = opts.src;
        },
        setup(map) {
            mapRef = map;
            ensureCubeLayer();
        },
        tick(motion) { tick(motion || {}); },
        reseed(lng, lat) {
            if (lng != null && lat != null) seedAll(lng, lat);
            else seededAround = null;
        },
        // Минимальная дистанция (м) до ближайшего инстанса it_sprite1.
        nearestDistM(lng, lat) {
            if (!opts.enabled || lng == null || lat == null) return Infinity;
            let min = Infinity;
            for (const inst of instances) {
                const d = distM(lng, lat, inst.lng, inst.lat);
                if (d < min) min = d;
            }
            return min;
        },
        getParams() {
            return {
                id: opts.id,
                enabled: !!opts.enabled,
                spawnRadiusM: opts.spawnRadiusM,
                count: opts.count,
                sizeM: opts.sizeM
            };
        },
        // key: enabled | spawnRadius | count | size
        setParam(key, value) {
            if (key === "enabled") {
                opts.enabled = !!value;
                if (!opts.enabled) hideAll();
            } else if (key === "spawnRadius") {
                opts.spawnRadiusM = Math.max(10, +value || 0);
                seededAround = null;
            } else if (key === "count") {
                opts.count = Math.max(0, Math.min(50, (+value) | 0));
                seededAround = null;
            } else if (key === "size") {
                opts.sizeM = Math.max(1, +value || 0);
            }
        },
        destroy() {
            for (const img of els) img.remove();
            els = [];
            if (root) { root.remove(); root = null; }
            if (styleEl) { styleEl.remove(); styleEl = null; }
            if (mapRef) {
                try { if (mapRef.getLayer(CUBE_LAYER)) mapRef.removeLayer(CUBE_LAYER); } catch (e) {}
                try { if (mapRef.getSource(CUBE_SOURCE)) mapRef.removeSource(CUBE_SOURCE); } catch (e) {}
            }
            mapRef = null;
            instances = [];
            seededAround = null;
        }
    };
})();
