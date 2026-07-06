// Модуль: коллекционные точки — настоящие 3D-кубики (fill-extrusion),
// рендерятся так же, как 3D-деревья проекта. Поддерживает несколько ТИПОВ
// кубиков (напр. it_green, it_orange), у каждого свой цвет/размер/радиус и т.д.
// Кубики крутятся вокруг вертикальной оси и корректно перекрываются
// 3D-домами/рельефом за счёт depth-теста WebGL.
//
// GeowalkCarPins.init({ types: [...], spinDegPerSec, onCollect })
// GeowalkCarPins.setup(map)                  — создать источники+слои
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
        minZoom: 10,
        onCollect: null,
        types: [{ ...TYPE_DEFAULTS }]
    };

    let opts = { ...DEFAULTS };
    let mapRef = null;
    let types = [];
    let active = false;

    function sourceIdFor(id) { return "geowalk-car-pins-" + id; }
    function layerIdFor(id) { return "geowalk-car-pins-" + id; }

    function normalizeType(raw) {
        const t = Object.assign({}, TYPE_DEFAULTS, raw || {});
        t.count = Math.max(1, Math.min(50, t.count | 0));
        t.pins = [];
        t.seededAround = null;
        t.sourceId = sourceIdFor(t.id);
        t.layerId = layerIdFor(t.id);
        return t;
    }

    function makePins(type) {
        type.pins = [];
        for (let i = 0; i < type.count; i++) {
            type.pins.push({
                active: false, lng: 0, lat: 0, spinDeg: Math.random() * 360
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
        // Не отпускаем точку дальше радиуса генерации — разворачиваем к игроку.
        if (distM(lng, lat, slot.lng, slot.lat) > type.spawnMaxM) {
            const east = (lng - slot.lng) * M_PER_DEG_LAT * cosLat;
            const north = (lat - slot.lat) * M_PER_DEG_LAT;
            slot.heading = Math.atan2(east, north);
        }
        // История пройденного пути — для шлейфа кубиков позади точки.
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

    // Квадратный footprint кубика, повёрнутый на deg вокруг центра.
    function cubePolygon(lng, lat, halfM, deg) {
        const rad = deg * DEG;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const mLng = M_PER_DEG_LAT * Math.cos(lat * DEG);
        const corners = [
            [-halfM, -halfM], [halfM, -halfM], [halfM, halfM], [-halfM, halfM]
        ];
        const ring = [];
        for (const c of corners) {
            const rx = c[0] * cos - c[1] * sin;
            const ry = c[0] * sin + c[1] * cos;
            ring.push([lng + rx / mLng, lat + ry / M_PER_DEG_LAT]);
        }
        ring.push(ring[0]);
        return [ring];
    }

    function cubeFeature(lng, lat, sizeM, deg) {
        return {
            type: "Feature",
            properties: { h: sizeM },
            geometry: {
                type: "Polygon",
                coordinates: cubePolygon(lng, lat, sizeM / 2, deg)
            }
        };
    }

    function buildFeatures(type) {
        const feats = [];
        for (const slot of type.pins) {
            if (!slot.active) continue;
            feats.push(cubeFeature(slot.lng, slot.lat, type.sizeM, slot.spinDeg));
            // Шлейф: кубики позади вдоль пройденного пути, постепенно меньше.
            if (type.trailEnabled && type.trailCount > 0 && slot.hist && slot.hist.length > 1) {
                for (let k = 1; k <= type.trailCount; k++) {
                    const p = pointBack(slot.hist, type.trailSpacingM * k);
                    const scale = Math.max(0.2, 1 - 0.28 * k);
                    feats.push(cubeFeature(p.lng, p.lat, type.sizeM * scale, slot.spinDeg));
                }
            }
        }
        return feats;
    }

    function setData(type, features) {
        if (!mapRef) return;
        try {
            const src = mapRef.getSource(type.sourceId);
            if (src) src.setData({ type: "FeatureCollection", features: features || [] });
        } catch (e) { /* стиль перезагружается */ }
    }

    function layerPaint(type) {
        return {
            "fill-extrusion-color": type.color,
            "fill-extrusion-base": type.baseM,
            "fill-extrusion-height": ["+", type.baseM, ["get", "h"]],
            "fill-extrusion-opacity": 1,
            "fill-extrusion-vertical-gradient": true
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

    function ensureLayer(type) {
        if (!mapRef) return;
        if (!mapRef.getSource(type.sourceId)) {
            mapRef.addSource(type.sourceId, {
                type: "geojson",
                data: { type: "FeatureCollection", features: [] }
            });
        }
        if (!mapRef.getLayer(type.layerId)) {
            mapRef.addLayer({
                id: type.layerId,
                type: "fill-extrusion",
                source: type.sourceId,
                minzoom: opts.minZoom,
                paint: layerPaint(type)
            }, findInsertBefore(mapRef));
        }
    }

    function ensureAllLayers() {
        for (const t of types) ensureLayer(t);
    }

    function setup(map, options) {
        mapRef = map;
        if (options && options.types) buildTypes(options.types);
        ensureAllLayers();
        if (!active) for (const t of types) setData(t, []);
    }

    function sync(state) {
        const want = !!(state && state.carMode) && !(state && state.overlayOpen);
        active = want;
        if (!active) {
            for (const t of types) {
                for (const slot of t.pins) slot.active = false;
                t.seededAround = null;
                setData(t, []);
            }
        }
    }

    function tickType(type, lng, lat, dt) {
        if (mapRef && !mapRef.getLayer(type.layerId)) ensureLayer(type);
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
        }
        setData(type, buildFeatures(type));
    }

    function tick(motion) {
        if (!mapRef || !active) return;
        const dt = motion && motion.dt != null ? motion.dt : 0;
        const lng = motion && motion.lng;
        const lat = motion && motion.lat;
        if (lng == null || lat == null) return;
        for (const t of types) tickType(t, lng, lat, dt);
    }

    window.GeowalkCarPins = {
        init(options) {
            opts = Object.assign({}, DEFAULTS, options || {});
            buildTypes(options && options.types);
        },
        setup(map, options) { setup(map, options || null); },
        sync(state) { sync(state || {}); },
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
        // key: count | spawnRadius | hitRadius | size | base | spin
        //    | moveSpeed | turnMin | turnMax | trailEnabled | trailCount | trailSpacing
        setParam(typeId, key, value) {
            const t = findType(typeId);
            if (!t) return;
            const v = +value;
            if (key === "count") {
                const c = Math.max(1, Math.min(50, v | 0));
                if (c === t.count) return;
                t.count = c;
                makePins(t);
                t.seededAround = null;
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
                if (mapRef && mapRef.getLayer(t.layerId)) {
                    try {
                        mapRef.setPaintProperty(t.layerId, "fill-extrusion-base", t.baseM);
                        mapRef.setPaintProperty(t.layerId, "fill-extrusion-height", ["+", t.baseM, ["get", "h"]]);
                    } catch (e) {}
                }
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
            } else if (key === "trailSpacing") {
                t.trailSpacingM = Math.max(0.2, v || 0);
            }
        },
        destroy() {
            if (mapRef) {
                for (const t of types) {
                    try { if (mapRef.getLayer(t.layerId)) mapRef.removeLayer(t.layerId); } catch (e) {}
                    try { if (mapRef.getSource(t.sourceId)) mapRef.removeSource(t.sourceId); } catch (e) {}
                }
            }
            types = [];
            active = false;
            mapRef = null;
        }
    };
})();
