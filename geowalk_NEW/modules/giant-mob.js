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
        enabled: false,
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

    let opts = { ...DEFAULTS };
    let styleEl = null;
    let root = null;
    let els = [];
    let instances = [];      // { lng, lat }
    let seededAround = null;

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

    let cubeMeshes = [];
    let cubeMat = null;
    let cubeGeom = null;

    function ensureCubeMeshes(n) {
        const T = window.GeowalkThree;
        const t3 = window.THREE;
        if (!T || !t3 || !T.isReady()) return;
        while (cubeMeshes.length < n) {
            if (!cubeGeom) cubeGeom = new t3.BoxGeometry(1, 1, 1);
            if (!cubeMat) {
                const c = opts.cubeColor;
                cubeMat = new t3.MeshStandardMaterial({
                    color: new t3.Color(c[0] / 255, c[1] / 255, c[2] / 255),
                    roughness: 0.6, transparent: true, opacity: 1
                });
            }
            const m = new t3.Mesh(cubeGeom, cubeMat);
            m.visible = false;
            T.add(m);
            cubeMeshes.push(m);
        }
        while (cubeMeshes.length > n) {
            const m = cubeMeshes.pop();
            T.remove(m);
        }
    }

    function hideCubeMeshes() {
        for (const m of cubeMeshes) m.visible = false;
    }

    function placeCubeMesh(mesh, lng, lat, op) {
        const T = window.GeowalkThree;
        if (!T) return;
        const s = opts.cubeSizeM;
        const p = T.geoToLocal(lng, lat, s / 2);
        mesh.position.set(p.x, p.y, p.z);
        mesh.scale.set(s, s, s);
        mesh.material.opacity = op;
        mesh.visible = true;
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
        if (!opts.enabled) { hideAll(); hideCubeMeshes(); return; }

        const lng = motion && motion.lng;
        const lat = motion && motion.lat;
        const project = motion && motion.projectPoint;
        if (lng == null || lat == null || typeof project !== "function") { hideAll(); hideCubeMeshes(); return; }

        ensureCubeMeshes(opts.cubeEnabled ? instances.length : 0);

        // Пере-генерация при выходе за радиус появления.
        if (!seededAround || instances.length !== (opts.count | 0) ||
            distM(seededAround.lng, seededAround.lat, lng, lat) > opts.spawnRadiusM) {
            seedAll(lng, lat);
        }

        const camBearing = motion.bearing != null ? motion.bearing : 0;
        const cosLat = Math.cos(lat * DEG) || 1e-6;
        const span = Math.max(1e-3, opts.fadeStartM - opts.fadeEndM);
        hideCubeMeshes();

        for (let i = 0; i < instances.length; i++) {
            const inst = instances[i];
            const img = els[i];

            const d = distM(lng, lat, inst.lng, inst.lat);
            const distOpacity = Math.max(0, Math.min(1, (opts.fadeStartM - d) / span));

            if (opts.cubeEnabled && distOpacity > 0 && cubeMeshes[i]) {
                placeCubeMesh(cubeMeshes[i], inst.lng, inst.lat, distOpacity);
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
    }

    window.GeowalkGiantMob = {
        init(options) {
            opts = Object.assign({}, DEFAULTS, options || {});
            seededAround = null;
            ensurePool(opts.enabled ? Math.max(0, opts.count | 0) : 0);
            for (const img of els) if (img.getAttribute("src") !== opts.src) img.src = opts.src;
        },
        setup() {
            if (window.GeowalkThree) GeowalkThree.onReady(() => ensureCubeMeshes(opts.count));
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
            for (const m of cubeMeshes) {
                if (window.GeowalkThree) GeowalkThree.remove(m);
            }
            cubeMeshes = [];
            if (root) { root.remove(); root = null; }
            if (styleEl) { styleEl.remove(); styleEl = null; }
            instances = [];
            seededAround = null;
        }
    };
})();
