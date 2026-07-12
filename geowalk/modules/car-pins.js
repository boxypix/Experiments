// Модуль: коллекционные точки — 3D-кубики, рендерятся в Three.js слое
// (GeowalkThree) и корректно перекрываются домами/рельефом за счёт depth-теста.
// Поддерживает несколько ТИПОВ кубиков (it_green, it_orange, it_blue), у каждого
// свой цвет/размер/радиус/движение/шлейф. Кубики крутятся вокруг вертикали.
//
// GeowalkCarPins.init({ types: [...], spinDegPerSec, onCollect })
// GeowalkCarPins.setup(map)                  — (совместимость; сцена в GeowalkThree)
// GeowalkCarPins.sync({ carMode, overlayOpen })
// GeowalkCarPins.tick({ lng, lat, dt })
// GeowalkCarPins.getTypes() / setParam(typeId, key, value)
(function () {
    "use strict";

    const M_PER_DEG_LAT = 111320;
    const DEG = Math.PI / 180;

    const TYPE_DEFAULTS = {
        id: "it_green",
        color: "#C8FF00",
        enabled: false,
        count: 5,
        spawnMinM: 22,
        spawnMaxM: 95,
        hitRadiusM: 2,
        sizeM: 1,
        baseM: 0,
        spinEnabled: false,
        moveSpeedM: 0,        // скорость перемещения точки, м/с (0 = стоит на месте)
        turnMinSec: 0.5,      // мин. интервал до резкой смены направления
        turnMaxSec: 2.2,      // макс. интервал до резкой смены направления
        trailCount: 0,        // кол-во кубиков-шлейфа позади подвижной точки
        trailSpacingM: 3,     // расстояние между кубиками шлейфа, м
        trailEnabled: true    // включён ли шлейф (при trailCount > 0)
    };

    const DEFAULTS = {
        spinDegPerSec: 90,
        onCollect: null,
        types: [{ ...TYPE_DEFAULTS }]
    };

    let opts = { ...DEFAULTS };
    let types = [];
    let active = false;
    let boxGeom = null;

    function THREE() { return window.THREE; }
    function three() { return window.GeowalkThree; }

    function getBoxGeom() {
        if (!boxGeom && THREE()) boxGeom = new (THREE().BoxGeometry)(1, 1, 1);
        return boxGeom;
    }

    function normalizeType(raw) {
        const t = Object.assign({}, TYPE_DEFAULTS, raw || {});
        t.count = Math.max(1, Math.min(50, t.count | 0));
        t.pins = [];
        t.seededAround = null;
        t.material = null;
        t.meshDirty = true;
        return t;
    }

    function makePins(type) {
        type.pins = [];
        for (let i = 0; i < type.count; i++) {
            type.pins.push({
                active: false, lng: 0, lat: 0, spinDeg: Math.random() * 360,
                heading: 0, turnTimer: 0, hist: null, core: null, trail: null
            });
        }
    }

    function buildTypes(rawTypes) {
        types = (rawTypes && rawTypes.length ? rawTypes : [{ ...TYPE_DEFAULTS }]).map(r => {
            const t = normalizeType(r);
            makePins(t);
            return t;
        });
    }

    function findType(id) {
        for (const t of types) if (t.id === id) return t;
        return null;
    }

    function distM(lng1, lat1, lng2, lat2) {
        const cosLat = Math.cos(((lat1 + lat2) / 2) * DEG);
        const dLat = (lat2 - lat1) * M_PER_DEG_LAT;
        const dLng = (lng2 - lng1) * M_PER_DEG_LAT * cosLat;
        return Math.hypot(dLat, dLng);
    }

    function randomSpawn(type, lng, lat) {
        const cosLat = Math.cos(lat * DEG) || 1e-6;
        const bearing = Math.random() * Math.PI * 2;
        const dist = type.spawnMinM + Math.random() * (type.spawnMaxM - type.spawnMinM);
        return {
            lng: lng + (Math.sin(bearing) * dist) / (M_PER_DEG_LAT * cosLat),
            lat: lat + (Math.cos(bearing) * dist) / M_PER_DEG_LAT
        };
    }

    function randomTurnTimer(type) {
        return type.turnMinSec + Math.random() * Math.max(0, type.turnMaxSec - type.turnMinSec);
    }

    function spawnPin(type, slot, lng, lat) {
        const pos = randomSpawn(type, lng, lat);
        slot.active = true;
        slot.spinDeg = Math.random() * 360;
        slot.lng = pos.lng;
        slot.lat = pos.lat;
        slot.heading = Math.random() * Math.PI * 2;
        slot.turnTimer = randomTurnTimer(type);
        slot.hist = null;
    }

    // Перемещение подвижной точки (moveSpeedM > 0): прямолинейно, иногда резкая
    // смена угла; удержание в пределах spawnMaxM вокруг игрока.
    function moveSlot(type, slot, lng, lat, dt) {
        if (!(type.moveSpeedM > 0) || dt <= 0) return;
        slot.turnTimer -= dt;
        if (slot.turnTimer <= 0) {
            slot.heading = Math.random() * Math.PI * 2;
            slot.turnTimer = randomTurnTimer(type);
        }
        const step = type.moveSpeedM * dt;
        const cosLat = Math.cos(slot.lat * DEG) || 1e-6;
        slot.lat += (Math.cos(slot.heading) * step) / M_PER_DEG_LAT;
        slot.lng += (Math.sin(slot.heading) * step) / (M_PER_DEG_LAT * cosLat);
        if (distM(lng, lat, slot.lng, slot.lat) > type.spawnMaxM) {
            const east = (lng - slot.lng) * M_PER_DEG_LAT * cosLat;
            const north = (lat - slot.lat) * M_PER_DEG_LAT;
            slot.heading = Math.atan2(east, north);
        }
        if (type.trailCount > 0) {
            if (!slot.hist) slot.hist = [];
            slot.hist.push({ lng: slot.lng, lat: slot.lat });
            if (slot.hist.length > 160) slot.hist.shift();
        }
    }

    // Точка на пройденном пути на расстоянии distBack (м) позади текущей позиции.
    function pointBack(hist, distBack) {
        let acc = 0;
        for (let i = hist.length - 1; i > 0; i--) {
            const a = hist[i], b = hist[i - 1];
            const seg = distM(a.lng, a.lat, b.lng, b.lat);
            if (acc + seg >= distBack) {
                const t = (distBack - acc) / (seg || 1e-6);
                return { lng: a.lng + (b.lng - a.lng) * t, lat: a.lat + (b.lat - a.lat) * t };
            }
            acc += seg;
        }
        return { lng: hist[0].lng, lat: hist[0].lat };
    }

    function seedAll(type, lng, lat) {
        for (const slot of type.pins) spawnPin(type, slot, lng, lat);
        type.seededAround = { lng, lat };
    }

    // ---- Three.js меши -----------------------------------------------------

    function disposeTypeMeshes(type) {
        const T = three();
        for (const slot of type.pins) {
            if (slot.core) { if (T) T.remove(slot.core); slot.core = null; }
            if (slot.trail) {
                for (const m of slot.trail) { if (T) T.remove(m); }
                slot.trail = null;
            }
        }
    }

    function rebuildTypeMeshes(type) {
        const t3 = THREE();
        const T = three();
        if (!t3 || !T || !T.isReady()) return;
        disposeTypeMeshes(type);
        if (!type.material) {
            type.material = new t3.MeshBasicMaterial({
                color: new t3.Color(type.color)
            });
        } else {
            type.material.color = new t3.Color(type.color);
        }
        const geom = getBoxGeom();
        for (const slot of type.pins) {
            slot.core = new t3.Mesh(geom, type.material);
            slot.core.visible = false;
            T.add(slot.core);
            slot.trail = [];
            if (type.trailCount > 0) {
                for (let k = 0; k < type.trailCount; k++) {
                    const m = new t3.Mesh(geom, type.material);
                    m.visible = false;
                    T.add(m);
                    slot.trail.push(m);
                }
            }
        }
        type.meshDirty = false;
    }

    function placeCube(mesh, lng, lat, sizeM, baseM, spinDeg) {
        const T = three();
        const p = T.geoToLocal(lng, lat, baseM + sizeM / 2);
        mesh.position.set(p.x, p.y, p.z);
        mesh.scale.set(sizeM, sizeM, sizeM);
        mesh.rotation.z = spinDeg * DEG;
        mesh.visible = true;
    }

    function hideTypeMeshes(type) {
        for (const slot of type.pins) {
            if (slot.core) slot.core.visible = false;
            if (slot.trail) for (const m of slot.trail) m.visible = false;
        }
    }

    function tickType(type, lng, lat, dt) {
        if (!type.enabled) {
            hideTypeMeshes(type);
            return;
        }
        if (type.meshDirty) rebuildTypeMeshes(type);
        if (!type.seededAround ||
            distM(type.seededAround.lng, type.seededAround.lat, lng, lat) > type.spawnMaxM * 2.5) {
            seedAll(type, lng, lat);
        }
        const spin = type.spinEnabled ? opts.spinDegPerSec * dt : 0;
        for (const slot of type.pins) {
            if (!slot.active) continue;
            if (spin) slot.spinDeg = (slot.spinDeg + spin) % 360;
            moveSlot(type, slot, lng, lat, dt);
            // При наезде кубик мгновенно исчезает и сразу появляется новый.
            if (distM(lng, lat, slot.lng, slot.lat) <= type.hitRadiusM) {
                if (typeof opts.onCollect === "function") {
                    try { opts.onCollect(type.id, slot); } catch (e) {}
                }
                spawnPin(type, slot, lng, lat);
            }

            if (slot.core) placeCube(slot.core, slot.lng, slot.lat, type.sizeM, type.baseM, slot.spinDeg);

            // Шлейф: кубики позади вдоль пройденного пути, постепенно меньше.
            if (slot.trail && slot.trail.length) {
                const canTrail = type.trailEnabled && type.trailCount > 0 &&
                    slot.hist && slot.hist.length > 1;
                for (let k = 0; k < slot.trail.length; k++) {
                    const m = slot.trail[k];
                    if (!canTrail) { m.visible = false; continue; }
                    const p = pointBack(slot.hist, type.trailSpacingM * (k + 1));
                    const scale = Math.max(0.2, 1 - 0.28 * (k + 1));
                    placeCube(m, p.lng, p.lat, type.sizeM * scale, type.baseM, slot.spinDeg);
                }
            }
        }
    }

    function tick(motion) {
        if (!active || !THREE() || !three() || !three().isReady()) return;
        const dt = motion && motion.dt != null ? motion.dt : 0;
        const lng = motion && motion.lng;
        const lat = motion && motion.lat;
        if (lng == null || lat == null) return;
        for (const t of types) tickType(t, lng, lat, dt);
    }

    function onScene() {
        for (const t of types) t.meshDirty = true;
    }

    window.GeowalkCarPins = {
        init(options) {
            opts = Object.assign({}, DEFAULTS, options || {});
            buildTypes(options && options.types);
            if (window.GeowalkThree) GeowalkThree.onReady(onScene);
        },
        setup() {
            // Сцена управляется GeowalkThree; при пере-создании сцены onScene
            // помечает меши на перестройку. Здесь только подстраховка.
            if (window.GeowalkThree) GeowalkThree.onReady(onScene);
            for (const t of types) t.meshDirty = true;
        },
        sync(state) {
            const want = !!(state && state.carMode) && !(state && state.overlayOpen);
            active = want;
            if (!active) {
                for (const t of types) {
                    for (const slot of t.pins) slot.active = false;
                    t.seededAround = null;
                    hideTypeMeshes(t);
                }
            }
        },
        tick(motion) { tick(motion || {}); },
        reseed(lng, lat) {
            for (const t of types) {
                if (lng != null && lat != null) seedAll(t, lng, lat);
                else t.seededAround = null;
            }
        },
        getTypes() {
            return types.map(t => ({
                id: t.id,
                color: t.color,
                enabled: !!t.enabled,
                count: t.count,
                spawnMaxM: t.spawnMaxM,
                hitRadiusM: t.hitRadiusM,
                sizeM: t.sizeM,
                baseM: t.baseM,
                spinEnabled: t.spinEnabled,
                moveSpeedM: t.moveSpeedM,
                turnMinSec: t.turnMinSec,
                turnMaxSec: t.turnMaxSec,
                trailEnabled: t.trailEnabled,
                trailCount: t.trailCount,
                trailSpacingM: t.trailSpacingM
            }));
        },
        // key: enabled | count | spawnRadius | hitRadius | size | base | spin
        //    | moveSpeed | turnMin | turnMax | trailEnabled | trailCount | trailSpacing
        setParam(typeId, key, value) {
            const t = findType(typeId);
            if (!t) return;
            if (key === "enabled") {
                t.enabled = !!value;
                if (!t.enabled) {
                    hideTypeMeshes(t);
                    t.seededAround = null;
                    for (const slot of t.pins) slot.active = false;
                } else {
                    t.meshDirty = true;
                }
                return;
            }
            const v = +value;
            if (key === "count") {
                const c = Math.max(1, Math.min(50, v | 0));
                if (c === t.count) return;
                t.count = c;
                makePins(t);
                t.seededAround = null;
                t.meshDirty = true;
            } else if (key === "spawnRadius") {
                const r = Math.max(2, v || 0);
                t.spawnMaxM = r;
                if (t.spawnMinM > r - 1) t.spawnMinM = Math.max(1, r * 0.25);
                t.seededAround = null;
            } else if (key === "hitRadius") {
                t.hitRadiusM = Math.max(0.1, v || 0);
            } else if (key === "size") {
                t.sizeM = Math.max(0.1, v || 0);
            } else if (key === "base") {
                t.baseM = Math.max(0, v || 0);
            } else if (key === "spin") {
                t.spinEnabled = !!value;
            } else if (key === "moveSpeed") {
                t.moveSpeedM = Math.max(0, v || 0);
            } else if (key === "turnMin") {
                t.turnMinSec = Math.max(0.05, v || 0);
                if (t.turnMaxSec < t.turnMinSec) t.turnMaxSec = t.turnMinSec;
            } else if (key === "turnMax") {
                t.turnMaxSec = Math.max(t.turnMinSec, v || 0);
            } else if (key === "trailEnabled") {
                t.trailEnabled = !!value;
            } else if (key === "trailCount") {
                t.trailCount = Math.max(0, Math.min(10, v | 0));
                t.meshDirty = true;
            } else if (key === "trailSpacing") {
                t.trailSpacingM = Math.max(0.2, v || 0);
            }
        },
        destroy() {
            for (const t of types) disposeTypeMeshes(t);
            types = [];
            active = false;
        }
    };
})();
