// Лес GeoWalk: случайные кубы (fill-extrusion) в wood; кэш + инкрементальная генерация.
(function () {
    "use strict";

    const M_PER_DEG_LAT = 111320;
    const DEG = Math.PI / 180;
    const SOURCE_ID = "geowalk-wood-blobs";
    const LAYER_ID = "geowalk-wood-blobs";

    const DEFAULTS = {
        enabled: true,
        terrainOn: true,
        density: 2,
        extrusionBaseM: 1,
        fillLayerId: "landcover_wood",
        vectorSource: "openmaptiles",
        sourceLayer: "landcover",
        woodClass: "wood",
        extrusionColor: "#1B2B10",
        radiusM: 1140,
        minZoom: 10,
        gridCellM: 52,
        spawnChanceBase: 0.62,
        sizeMinM: 2.0,
        sizeMaxM: 8.0,
        heightScaleMin: 0.5,
        heightScaleMax: 1.5,
        positionJitter: 0.9,
        rotationStepDeg: 15,
        maxCount: 850,
        cellsPerPass: 40,
        woodQueryMoveM: 180,
        flushMinIntervalMs: 120,
        rebuildDebounceMs: 100
    };

    let mapRef = null;
    let cfg = null;
    let lastOptions = null;
    let active = false;
    let rebuildTimer = null;
    let terrainOn = false;
    const boundMaps = new WeakSet();
    let playerLng = null;
    let playerLat = null;
    let lastCellIx = null;
    let lastCellIy = null;
    let lastZoomBucket = -1;
    let dirty = false;
    let lastFlushCount = -1;
    let lastFlushAt = 0;
    /** @type {Map<string, { feature: object|null, lng: number, lat: number }>} */
    let cellCache = new Map();
    /** @type {{ bbox: number[], wood: object[], lng: number, lat: number }|null} */
    let woodSnapshot = null;

    function metersToDegLat(m) { return m / M_PER_DEG_LAT; }
    function metersToDegLng(m, lat) { return m / (M_PER_DEG_LAT * Math.cos(lat * DEG)); }

    function distMeters(lng1, lat1, lng2, lat2) {
        const north = (lat2 - lat1) * M_PER_DEG_LAT;
        const east = (lng2 - lng1) * M_PER_DEG_LAT * Math.cos(((lat1 + lat2) * 0.5) * DEG);
        return Math.hypot(north, east);
    }

    function distMetersSq(lng1, lat1, lng2, lat2) {
        const north = (lat2 - lat1) * M_PER_DEG_LAT;
        const east = (lng2 - lng1) * M_PER_DEG_LAT * Math.cos(((lat1 + lat2) * 0.5) * DEG);
        return north * north + east * east;
    }

    function hashU32(ix, iy, salt) {
        let h = (ix | 0) * 374761393 + (iy | 0) * 668265263 + (salt | 0) * 1442695041;
        h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
        h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
        return (h ^ (h >>> 16)) >>> 0;
    }

    function hash01(ix, iy, salt) {
        return hashU32(ix, iy, salt) / 4294967296;
    }

    function clampDensity(d) {
        return Math.max(0.2, Math.min(2, d || 1));
    }

    function effectiveSpawnChance() {
        return Math.min(0.98, cfg.spawnChanceBase * clampDensity(cfg.density));
    }

    function effectiveMaxCount() {
        return Math.round(cfg.maxCount * Math.min(1.6, clampDensity(cfg.density)));
    }

    function zoomBucket(z) {
        if (z <= 10) return 0;
        if (z <= 12) return 1;
        if (z <= 14) return 2;
        return 3;
    }

    function heightForZoom(z) {
        if (z <= 10) return 0;
        if (z <= 12) return 3;
        if (z <= 14) return 8;
        if (z <= 16) return 6;
        return 6;
    }

    function cellKey(ix, iy) { return ix + "," + iy; }

    function pointInRing(lng, lat, ring) {
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const xi = ring[i][0], yi = ring[i][1];
            const xj = ring[j][0], yj = ring[j][1];
            if (((yi > lat) !== (yj > lat)) &&
                (lng < (xj - xi) * (lat - yi) / (yj - yi + 1e-12) + xi)) inside = !inside;
        }
        return inside;
    }

    function pointInGeometry(lng, lat, geom) {
        if (!geom) return false;
        if (geom.type === "Polygon") {
            if (!pointInRing(lng, lat, geom.coordinates[0])) return false;
            for (let h = 1; h < geom.coordinates.length; h++) {
                if (pointInRing(lng, lat, geom.coordinates[h])) return false;
            }
            return true;
        }
        if (geom.type === "MultiPolygon") {
            for (let p = 0; p < geom.coordinates.length; p++) {
                const poly = geom.coordinates[p];
                if (!pointInRing(lng, lat, poly[0])) continue;
                let hole = false;
                for (let h = 1; h < poly.length; h++) {
                    if (pointInRing(lng, lat, poly[h])) { hole = true; break; }
                }
                if (!hole) return true;
            }
        }
        return false;
    }

    function pointInWood(lng, lat, wood) {
        for (let w = 0; w < wood.length; w++) {
            if (pointInGeometry(lng, lat, wood[w].geometry)) return true;
        }
        return false;
    }

    function bboxAround(lng, lat, radiusM) {
        const dLat = metersToDegLat(radiusM);
        const dLng = metersToDegLng(radiusM, lat);
        return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
    }

    function ringBbox(ring) {
        let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
        for (let i = 0; i < ring.length; i++) {
            minLng = Math.min(minLng, ring[i][0]);
            minLat = Math.min(minLat, ring[i][1]);
            maxLng = Math.max(maxLng, ring[i][0]);
            maxLat = Math.max(maxLat, ring[i][1]);
        }
        return [minLng, minLat, maxLng, maxLat];
    }

    function geomIntersectsBbox(geom, bbox) {
        const overlap = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
        if (geom.type === "Polygon") return overlap(ringBbox(geom.coordinates[0]), bbox);
        if (geom.type === "MultiPolygon") {
            for (let p = 0; p < geom.coordinates.length; p++) {
                if (overlap(ringBbox(geom.coordinates[p][0]), bbox)) return true;
            }
        }
        return false;
    }

    function rotationDegForCell(ix, iy) {
        const step = cfg.rotationStepDeg || 15;
        const slots = Math.round(360 / step);
        return Math.floor(hash01(ix, iy, 6) * slots) * step;
    }

    function cubePolygonRotated(lng, lat, halfEastM, halfNorthM, deg) {
        const rad = deg * DEG;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const mLng = M_PER_DEG_LAT * Math.cos(lat * DEG);
        const corners = [
            [-halfEastM, -halfNorthM],
            [halfEastM, -halfNorthM],
            [halfEastM, halfNorthM],
            [-halfEastM, halfNorthM]
        ];
        const ring = [];
        for (let i = 0; i < corners.length; i++) {
            const x = corners[i][0];
            const y = corners[i][1];
            const rx = x * cos - y * sin;
            const ry = x * sin + y * cos;
            ring.push([lng + rx / mLng, lat + ry / M_PER_DEG_LAT]);
        }
        ring.push(ring[0]);
        return [ring];
    }

    function findInsertBefore(map) {
        const prefer = ["building-3d", "building", "water_name_point_label"];
        for (let i = 0; i < prefer.length; i++) {
            if (map.getLayer(prefer[i])) return prefer[i];
        }
        const layers = map.getStyle() && map.getStyle().layers;
        if (!layers) return undefined;
        for (let i = 0; i < layers.length; i++) {
            if (layers[i].type === "symbol") return layers[i].id;
        }
        return undefined;
    }

    function layerPaint() {
        return {
            "fill-extrusion-color": cfg.extrusionColor,
            "fill-extrusion-base": cfg.extrusionBaseM,
            "fill-extrusion-height": ["+", cfg.extrusionBaseM, ["get", "h"]],
            "fill-extrusion-opacity": 1,
            "fill-extrusion-vertical-gradient": true
        };
    }

    function removeRuntime() {
        if (!mapRef) return;
        try { if (mapRef.getLayer("geowalk-wood-cubes")) mapRef.removeLayer("geowalk-wood-cubes"); } catch (e) {}
        try { if (mapRef.getLayer("geowalk-wood-pyramids")) mapRef.removeLayer("geowalk-wood-pyramids"); } catch (e) {}
        try { if (mapRef.getLayer(LAYER_ID)) mapRef.removeLayer(LAYER_ID); } catch (e) {}
        try { if (mapRef.getSource(SOURCE_ID)) mapRef.removeSource(SOURCE_ID); } catch (e) {}
    }

    function ensureRuntime() {
        if (!mapRef || !cfg) return false;
        if (!mapRef.getSource(SOURCE_ID)) {
            mapRef.addSource(SOURCE_ID, {
                type: "geojson",
                data: { type: "FeatureCollection", features: [] }
            });
        }
        if (!mapRef.getLayer(LAYER_ID)) {
            mapRef.addLayer({
                id: LAYER_ID,
                type: "fill-extrusion",
                source: SOURCE_ID,
                minzoom: cfg.minZoom,
                paint: layerPaint()
            }, findInsertBefore(mapRef));
        }
        return true;
    }

    function dedupeFeatures(raw, bbox) {
        const seen = new Set();
        const out = [];
        for (let i = 0; i < raw.length; i++) {
            const f = raw[i];
            if (!f.geometry || !geomIntersectsBbox(f.geometry, bbox)) continue;
            const key = f.id != null ? String(f.id) : JSON.stringify(f.geometry.coordinates[0][0]);
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(f);
        }
        return out;
    }

    function queryWoodFromSource(bbox) {
        if (!mapRef || !cfg) return [];
        try {
            return dedupeFeatures(mapRef.querySourceFeatures(cfg.vectorSource, {
                sourceLayer: cfg.sourceLayer,
                filter: ["==", ["get", "class"], cfg.woodClass]
            }), bbox);
        } catch (e) {
            return [];
        }
    }

    function queryWoodRendered(bbox) {
        if (!mapRef || !cfg) return [];
        const layerId = cfg.fillLayerId;
        if (!mapRef.getLayer(layerId)) return [];
        try {
            const canvas = mapRef.getCanvas();
            return dedupeFeatures(mapRef.queryRenderedFeatures(
                [[0, 0], [canvas.width, canvas.height]],
                { layers: [layerId] }
            ), bbox);
        } catch (e) {
            return [];
        }
    }

    function queryWood(bbox) {
        const fromSource = queryWoodFromSource(bbox);
        if (fromSource.length >= 1) return fromSource;
        return queryWoodRendered(bbox);
    }

    function getWood(bbox, lng, lat) {
        const stale = !woodSnapshot ||
            distMeters(lng, lat, woodSnapshot.lng, woodSnapshot.lat) > cfg.woodQueryMoveM;
        if (stale) {
            woodSnapshot = {
                bbox: bbox.slice(),
                wood: queryWood(bbox),
                lng,
                lat
            };
        }
        return woodSnapshot.wood;
    }

    function createTreeForCell(ix, iy, stepLng, stepLat, zoom, wood) {
        const clngCenter = (ix + 0.5) * stepLng;
        const clatCenter = (iy + 0.5) * stepLat;

        if (hash01(ix, iy, 0) > effectiveSpawnChance()) {
            return { feature: null, lng: clngCenter, lat: clatCenter };
        }

        const jitter = cfg.positionJitter;
        const ox = (hash01(ix, iy, 1) - 0.5) * stepLng * jitter * 2;
        const oy = (hash01(ix, iy, 2) - 0.5) * stepLat * jitter * 2;
        const clng = clngCenter + ox;
        const clat = clatCenter + oy;

        if (!wood.length || !pointInWood(clng, clat, wood)) {
            return { feature: null, lng: clngCenter, lat: clatCenter };
        }

        const sizeM = cfg.sizeMinM + hash01(ix, iy, 3) * (cfg.sizeMaxM - cfg.sizeMinM);
        const aspect = 0.72 + hash01(ix, iy, 4) * 0.56;
        const hScale = cfg.heightScaleMin +
            hash01(ix, iy, 5) * (cfg.heightScaleMax - cfg.heightScaleMin);
        const baseH = heightForZoom(zoom);
        if (baseH <= 0) {
            return { feature: null, lng: clngCenter, lat: clatCenter };
        }

        const halfEastM = sizeM * aspect;
        const halfNorthM = sizeM / aspect;
        const rotDeg = rotationDegForCell(ix, iy);

        return {
            feature: {
                type: "Feature",
                properties: { h: baseH * hScale },
                geometry: {
                    type: "Polygon",
                    coordinates: cubePolygonRotated(clng, clat, halfEastM, halfNorthM, rotDeg)
                }
            },
            lng: clng,
            lat: clat
        };
    }

    function flushToMap(lng, lat, force) {
        if (!dirty && !force) return;
        const radiusSq = cfg.radiusM * cfg.radiusM;
        const picked = [];
        for (const entry of cellCache.values()) {
            if (distMetersSq(lng, lat, entry.lng, entry.lat) > radiusSq) continue;
            if (entry.feature) picked.push(entry);
        }
        const cap = effectiveMaxCount();
        if (picked.length > cap) {
            picked.sort((a, b) =>
                distMetersSq(lng, lat, a.lng, a.lat) - distMetersSq(lng, lat, b.lng, b.lat));
            picked.length = cap;
        }
        const features = picked.map(e => e.feature);
        if (!force && features.length === lastFlushCount && !dirty) return;
        try {
            if (mapRef.getSource(SOURCE_ID)) {
                mapRef.getSource(SOURCE_ID).setData({ type: "FeatureCollection", features });
            }
        } catch (e) {
            console.warn("GeowalkWoodTerrainExtrude:", e);
        }
        lastFlushCount = features.length;
        lastFlushAt = performance.now();
        dirty = false;
    }

    function evictFarCells(lng, lat) {
        const radiusSq = cfg.radiusM * cfg.radiusM;
        for (const [key, entry] of cellCache) {
            if (distMetersSq(lng, lat, entry.lng, entry.lat) > radiusSq) {
                cellCache.delete(key);
                dirty = true;
            }
        }
    }

    function collectMissingCells(lng, lat, bbox, stepLng, stepLat) {
        const radiusSq = cfg.radiusM * cfg.radiusM;
        const missing = [];
        const ixMin = Math.floor(bbox[0] / stepLng);
        const ixMax = Math.floor(bbox[2] / stepLng);
        const iyMin = Math.floor(bbox[1] / stepLat);
        const iyMax = Math.floor(bbox[3] / stepLat);

        for (let iy = iyMin; iy <= iyMax; iy++) {
            for (let ix = ixMin; ix <= ixMax; ix++) {
                const key = cellKey(ix, iy);
                if (cellCache.has(key)) continue;
                const clng = (ix + 0.5) * stepLng;
                const clat = (iy + 0.5) * stepLat;
                const d2 = distMetersSq(lng, lat, clng, clat);
                if (d2 > radiusSq) continue;
                missing.push({ ix, iy, clng, clat, d2 });
            }
        }
        missing.sort((a, b) => a.d2 - b.d2);
        return missing;
    }

    function syncCache() {
        if (!mapRef || !cfg || !active || !terrainOn) return;
        const zoom = mapRef.getZoom();
        const bucket = zoomBucket(zoom);
        if (bucket !== lastZoomBucket) {
            lastZoomBucket = bucket;
            cellCache.clear();
            woodSnapshot = null;
            lastFlushCount = -1;
            dirty = true;
        }
        if (zoom < cfg.minZoom) {
            cellCache.clear();
            woodSnapshot = null;
            lastFlushCount = -1;
            try { mapRef.getSource(SOURCE_ID).setData({ type: "FeatureCollection", features: [] }); } catch (e) {}
            return;
        }
        if (!mapRef.getTerrain()) return;

        const lng = playerLng != null ? playerLng : mapRef.getCenter().lng;
        const lat = playerLat != null ? playerLat : mapRef.getCenter().lat;
        const cellM = cfg.gridCellM;
        const stepLat = metersToDegLat(cellM);
        const stepLng = metersToDegLng(cellM, lat);
        const bbox = bboxAround(lng, lat, cfg.radiusM);
        const wood = getWood(bbox, lng, lat);

        evictFarCells(lng, lat);

        const missing = collectMissingCells(lng, lat, bbox, stepLng, stepLat);
        const budget = cfg.cellsPerPass;
        let added = 0;
        for (let i = 0; i < missing.length && added < budget; i++) {
            const c = missing[i];
            const entry = createTreeForCell(c.ix, c.iy, stepLng, stepLat, zoom, wood);
            cellCache.set(cellKey(c.ix, c.iy), entry);
            if (entry.feature) dirty = true;
            added++;
        }

        const hasMore = missing.length > added;
        const now = performance.now();
        if (dirty && (!hasMore || now - lastFlushAt >= cfg.flushMinIntervalMs)) {
            flushToMap(lng, lat, false);
        }
        if (hasMore) scheduleRebuild(16);
    }

    function scheduleRebuild(ms) {
        if (rebuildTimer) clearTimeout(rebuildTimer);
        rebuildTimer = setTimeout(() => {
            rebuildTimer = null;
            syncCache();
        }, ms != null ? ms : cfg.rebuildDebounceMs);
    }

    function bindMapEvents(map) {
        if (!map || boundMaps.has(map)) return;
        boundMaps.add(map);
        map.on("sourcedata", (e) => {
            if (!active || !terrainOn || !cfg) return;
            if (e.sourceId === "terrain-dem" || e.sourceId === cfg.vectorSource) {
                if (e.isSourceLoaded) scheduleRebuild(0);
            }
        });
    }

    function clearCache() {
        cellCache.clear();
        woodSnapshot = null;
        lastCellIx = null;
        lastCellIy = null;
        lastZoomBucket = -1;
        lastFlushCount = -1;
        dirty = false;
        try {
            if (mapRef && mapRef.getSource(SOURCE_ID)) {
                mapRef.getSource(SOURCE_ID).setData({ type: "FeatureCollection", features: [] });
            }
        } catch (e) {}
    }

    function deactivate() {
        if (rebuildTimer) clearTimeout(rebuildTimer);
        rebuildTimer = null;
        clearCache();
        removeRuntime();
        active = false;
        terrainOn = false;
        playerLng = null;
        playerLat = null;
    }

    function reset(lng, lat) {
        if (!mapRef || !cfg || !active || !terrainOn) return;
        clearCache();
        if (lng != null && lat != null) {
            playerLng = lng;
            playerLat = lat;
        }
        dirty = true;
        scheduleRebuild(0);
    }

    function teardown() {
        deactivate();
        cfg = null;
        lastOptions = null;
        mapRef = null;
    }

    function shouldRun(options) {
        return options.enabled !== false && options.terrainOn !== false;
    }

    function applyRuntimeOptions(options) {
        if (!cfg) return false;
        let changed = false;
        if (options.density != null && clampDensity(options.density) !== clampDensity(cfg.density)) {
            cfg.density = clampDensity(options.density);
            changed = true;
        }
        return changed;
    }

    function setup(map, options) {
        teardown();
        mapRef = map;
        lastOptions = Object.assign({}, DEFAULTS, options || {});
        lastOptions.density = clampDensity(lastOptions.density);
        cfg = lastOptions;
        cellCache = new Map();
        bindMapEvents(map);
        if (!shouldRun(cfg)) return;
        active = true;
        terrainOn = true;
        ensureRuntime();
        scheduleRebuild(0);
    }

    function sync(state) {
        if (!mapRef) return;
        const enabled = state.enabled !== false;
        const terrainOnReq = !!(state && state.terrainOn);
        const want = enabled && terrainOnReq;

        if (!want) {
            if (active) deactivate();
            return;
        }

        if (!cfg) cfg = Object.assign({}, DEFAULTS, lastOptions || {});

        if (applyRuntimeOptions(state || {})) {
            clearCache();
            dirty = true;
            if (!active) {
                active = true;
                terrainOn = true;
                ensureRuntime();
            }
            scheduleRebuild(0);
            return;
        }

        if (!active) {
            active = true;
            terrainOn = true;
            ensureRuntime();
            scheduleRebuild(0);
            return;
        }

        if (state && state.force) scheduleRebuild(0);
    }

    function tick(state) {
        if (!active || !terrainOn || !cfg || !mapRef || !state || !state.ready) return;
        if (state.lng == null || state.lat == null) return;
        playerLng = state.lng;
        playerLat = state.lat;

        const stepLat = metersToDegLat(cfg.gridCellM);
        const stepLng = metersToDegLng(cfg.gridCellM, playerLat);
        const ix = Math.floor(playerLng / stepLng);
        const iy = Math.floor(playerLat / stepLat);
        if (lastCellIx === ix && lastCellIy === iy) return;

        lastCellIx = ix;
        lastCellIy = iy;
        scheduleRebuild(cfg.rebuildDebounceMs);
    }

    window.GeowalkWoodTerrainExtrude = { setup, sync, tick, reset, teardown, bindMapEvents };
})();
