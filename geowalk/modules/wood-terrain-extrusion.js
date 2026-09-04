// Лес GeoWalk: случайные кубы (fill-extrusion) в wood; кэш + инкрементальная генерация.
(function () {
    "use strict";

    const M_PER_DEG_LAT = 111320;
    const DEG = Math.PI / 180;
    const SOURCE_ID = "geowalk-wood-blobs";
    const LAYER_ID = "geowalk-wood-blobs";

    const DEFAULTS = {
        enabled: false,
        treeSpritesEnabled: true,
        terrainOn: true,
        density: 4,
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
        treeSpriteSrc: "clime/t_teee6.png",
        treeSpriteAspect: 1,
        treeSpriteScale: 5,
        treeSpriteSizeSpread: 1,
        treeSpriteRadiusM: 700,
        treeSpriteSpawnAnim: true,
        treeSpriteSpawnAnimSec: 1.5,
        treeShakeEnabled: true,
        treeAreaM: 8,
        treeShakeMinSpeed: 0.6,
        treeShakeImpulse: 0.28,
        treeShakeSpring: 42,
        treeShakeDamping: 5.5,
        treeShakeMaxAngle: 0.38,
        climeZonesEnabled: true,
        cellsPerPass: 28,
        woodQueryMoveM: 180,
        flushMinIntervalMs: 180,
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
    let lastFlushSig = "";
    let lastFlushAt = 0;
    /** @type {Map<string, { feature: object|null, lng: number, lat: number }>} */
    let cellCache = new Map();
    /** @type {{ bbox: number[], wood: object[], lng: number, lat: number }|null} */
    let woodSnapshot = null;
    let treeSpriteByKey = new Map();
    let treeSpriteMatBySrc = new Map();
    let treePlaneGeom = null;
    let originShiftHandler = null;

    function repositionTreeSpritesOnOrigin() {
        const T = window.GeowalkThree;
        if (!T || !T.isReady()) return;
        for (const rec of treeSpriteByKey.values()) {
            const group = rec.group;
            if (!group || group.userData.geoLng == null || group.userData.geoLat == null) continue;
            const base = group.userData.geoBase != null ? group.userData.geoBase : (cfg ? cfg.extrusionBaseM : 1);
            const p = T.geoToLocal(group.userData.geoLng, group.userData.geoLat, base);
            group.position.set(p.x, p.y, p.z);
        }
    }

    function bindOriginShiftHandler() {
        const T = window.GeowalkThree;
        if (!T || !T.onOriginShift) return;
        if (!originShiftHandler) {
            originShiftHandler = () => repositionTreeSpritesOnOrigin();
            T.onOriginShift(originShiftHandler);
        }
    }

    function unbindOriginShiftHandler() {
        const T = window.GeowalkThree;
        if (T && T.offOriginShift && originShiftHandler) {
            T.offOriginShift(originShiftHandler);
        }
        originShiftHandler = null;
    }

    function resetTreeSpriteCache() {
        clearAllTreeSprites();
        for (const mat of treeSpriteMatBySrc.values()) {
            if (mat.map) mat.map.dispose();
            mat.dispose();
        }
        treeSpriteMatBySrc.clear();
        if (treePlaneGeom) {
            treePlaneGeom.dispose();
            treePlaneGeom = null;
        }
    }

    function resolveTreeSpriteSrc(lng, lat) {
        if (cfg && cfg.climeZonesEnabled !== false &&
            window.GeowalkClimeZones &&
            typeof GeowalkClimeZones.getTreeSpriteAt === "function" &&
            GeowalkClimeZones.ready()) {
            return GeowalkClimeZones.getTreeSpriteAt(lng, lat);
        }
        return (cfg && cfg.treeSpriteSrc) || "clime/t_teee6.png";
    }

    function getTreeSpriteMaterial(t3, lng, lat) {
        const src = resolveTreeSpriteSrc(lng, lat);
        let mat = treeSpriteMatBySrc.get(src);
        if (mat) return mat;
        const tex = new t3.TextureLoader().load(src);
        if (t3.SRGBColorSpace) tex.colorSpace = t3.SRGBColorSpace;
        mat = new t3.MeshBasicMaterial({
            map: tex,
            transparent: true,
            alphaTest: 0.35,
            side: t3.DoubleSide,
            depthTest: true,
            depthWrite: false
        });
        treeSpriteMatBySrc.set(src, mat);
        return mat;
    }

    function extrusionRadiusM() {
        return cfg && cfg.radiusM != null ? cfg.radiusM : DEFAULTS.radiusM;
    }

    function spriteRadiusM() {
        if (!cfg) return DEFAULTS.treeSpriteRadiusM;
        return cfg.treeSpriteRadiusM != null ? cfg.treeSpriteRadiusM : extrusionRadiusM();
    }

    function genRadiusM() {
        let r = 0;
        if (cfg && cfg.enabled !== false) r = Math.max(r, extrusionRadiusM());
        if (cfg && cfg.treeSpritesEnabled !== false) r = Math.max(r, spriteRadiusM());
        return r || extrusionRadiusM();
    }

    function disposeTreeSprite(rec) {
        if (!rec) return;
        if (rec.mesh && rec.mesh.material) rec.mesh.material.dispose();
    }

    function clearAllTreeSprites() {
        const T = window.GeowalkThree;
        if (T) {
            for (const rec of treeSpriteByKey.values()) {
                disposeTreeSprite(rec);
                T.remove(rec.group);
            }
        }
        treeSpriteByKey.clear();
    }

    function applyTreeSpriteScale(mesh, factor) {
        const side = mesh.userData.side;
        if (side == null) return;
        const f = factor != null ? factor : 1;
        mesh.scale.set(side * f, side * f, 1);
    }

    function applyTreeSpriteOpacity(mesh, opacity) {
        const mat = mesh.material;
        if (!mat) return;
        const o = opacity != null ? opacity : 1;
        mat.opacity = o;
        mat.alphaTest = o >= 1 ? 0.35 : 0;
    }

    function randomYawForLngLat(lng, lat) {
        const ix = Math.floor(lng * 1e5);
        const iy = Math.floor(lat * 1e5);
        return hash01(ix, iy, 9) * Math.PI * 2;
    }

    function createTreeBillboard(t3, T, lng, lat, sizeM, base) {
        const mat = getTreeSpriteMaterial(t3, lng, lat);
        const p = T.geoToLocal(lng, lat, base);
        if (!treePlaneGeom) {
            treePlaneGeom = new t3.PlaneGeometry(1, 1);
            // Ось вращения: низ по центру (локально y = 0).
            treePlaneGeom.translate(0, 0.5, 0);
        }
        const meshMat = mat.clone();
        const mesh = new t3.Mesh(treePlaneGeom, meshMat);
        mesh.userData.side = sizeM;
        mesh.userData.baseRotX = Math.PI / 2;
        mesh.userData.shakeX = 0;
        mesh.userData.shakeY = 0;
        mesh.userData.shakeVelX = 0;
        mesh.userData.shakeVelY = 0;
        mesh.rotation.x = mesh.userData.baseRotX;
        applyTreeSpriteScale(mesh, 1);
        applyTreeSpriteOpacity(mesh, cfg && cfg.treeSpriteSpawnAnim !== false ? 0 : 1);
        const group = new t3.Group();
        group.add(mesh);
        group.position.set(p.x, p.y, p.z);
        group.rotation.z = randomYawForLngLat(lng, lat);
        group.userData.cellKey = null;
        group.userData.geoLng = lng;
        group.userData.geoLat = lat;
        group.userData.geoBase = base;
        return group;
    }

    function capSpriteEntries(lng, lat, entries) {
        const cap = effectiveMaxCount();
        if (entries.length <= cap) return entries;
        entries.sort((a, b) =>
            distMetersSq(lng, lat, a.lng, a.lat) - distMetersSq(lng, lat, b.lng, b.lat));
        return entries.slice(0, cap);
    }

    function syncThreeTrees(lng, lat, entries) {
        const T = window.GeowalkThree;
        const t3 = window.THREE;
        if (!T || !t3 || !T.isReady() || !cfg) return;
        if (!cfg.treeSpritesEnabled || !active) {
            clearAllTreeSprites();
            return;
        }
        const radiusSq = spriteRadiusM() * spriteRadiusM();
        const keepKeys = new Set();
        const inRange = [];
        for (const entry of entries || []) {
            if (!entry || !entry.feature || !entry.key) continue;
            if (distMetersSq(lng, lat, entry.lng, entry.lat) > radiusSq) continue;
            keepKeys.add(entry.key);
            inRange.push(entry);
        }
        const capped = capSpriteEntries(lng, lat, inRange);

        for (const [key, rec] of treeSpriteByKey) {
            if (!keepKeys.has(key)) {
                disposeTreeSprite(rec);
                T.remove(rec.group);
                treeSpriteByKey.delete(key);
            }
        }

        const scaleMul = cfg.treeSpriteScale != null ? cfg.treeSpriteScale : 5;
        const animOn = cfg.treeSpriteSpawnAnim !== false;

        for (const entry of capped) {
            if (treeSpriteByKey.has(entry.key)) continue;
            const f = entry.feature;
            const ring = f.geometry && f.geometry.coordinates && f.geometry.coordinates[0];
            if (!ring || !ring.length) continue;
            let flng = 0, flat = 0;
            for (const c of ring) { flng += c[0]; flat += c[1]; }
            flng /= ring.length; flat /= ring.length;
            const h = (f.properties && f.properties.h) || 4;
            const base = cfg.extrusionBaseM || 1;
            const keyParts = entry.key.split(",");
            const ix = parseInt(keyParts[0], 10) || 0;
            const iy = parseInt(keyParts[1], 10) || 0;
            const sizeM = Math.max(2.5, h) * scaleMul * treeSpriteSizeFactor(ix, iy);
            const group = createTreeBillboard(t3, T, flng, flat, sizeM, base);
            group.userData.cellKey = entry.key;
            const mesh = group.children[0];
            if (animOn) {
                mesh.userData.spawnAnim = true;
                mesh.userData.animT = 0;
                applyTreeSpriteOpacity(mesh, 0);
            }
            T.add(group);
            treeSpriteByKey.set(entry.key, { group, mesh });
        }
    }

    function hasActiveTreeSpawnAnim() {
        if (!cfg || cfg.treeSpritesEnabled === false || cfg.treeSpriteSpawnAnim === false) return false;
        for (const rec of treeSpriteByKey.values()) {
            if (rec.mesh && rec.mesh.userData.spawnAnim) return true;
        }
        return false;
    }

    function hasActiveTreeShake() {
        if (!cfg || cfg.treeShakeEnabled === false) return false;
        for (const rec of treeSpriteByKey.values()) {
            const ud = rec.mesh && rec.mesh.userData;
            if (!ud) continue;
            if (Math.abs(ud.shakeX) > 0.001 || Math.abs(ud.shakeY) > 0.001 ||
                Math.abs(ud.shakeVelX) > 0.001 || Math.abs(ud.shakeVelY) > 0.001) return true;
        }
        return false;
    }

    function initTreeShake(mesh) {
        if (!mesh || !mesh.userData) return;
        mesh.userData.shakeX = 0;
        mesh.userData.shakeY = 0;
        mesh.userData.shakeVelX = 0;
        mesh.userData.shakeVelY = 0;
        if (mesh.userData.baseRotX == null) mesh.userData.baseRotX = Math.PI / 2;
        mesh.rotation.x = mesh.userData.baseRotX;
        mesh.rotation.y = 0;
        mesh.rotation.z = 0;
    }

    function applyTreeShakeImpulse(group, mesh, playerLng, playerLat, impactEast, impactNorth, moveSpeed) {
        const tLng = group.userData.geoLng;
        const tLat = group.userData.geoLat;
        if (tLng == null || tLat == null) return;

        const cosLat = Math.cos(((playerLat + tLat) * 0.5) * DEG);
        const toTreeEast = (tLng - playerLng) * M_PER_DEG_LAT * cosLat;
        const toTreeNorth = (tLat - playerLat) * M_PER_DEG_LAT;
        const toLen = Math.hypot(toTreeEast, toTreeNorth);
        if (toLen < 1e-4) return;

        const toward = (impactEast * toTreeEast + impactNorth * toTreeNorth) / toLen;
        if (toward <= 0) return;

        const ud = mesh.userData;
        const impulseScale = cfg.treeShakeImpulse != null ? cfg.treeShakeImpulse : 0.28;
        const impulse = impulseScale * toward * Math.min(1, moveSpeed / 7);
        const worldSwayEast = -toTreeEast / toLen;
        const worldSwayNorth = -toTreeNorth / toLen;
        const localYaw = group.rotation.z;
        const sinY = Math.sin(localYaw);
        const cosY = Math.cos(localYaw);
        ud.shakeVelX += (worldSwayEast * cosY + worldSwayNorth * sinY) * impulse;
        ud.shakeVelY += (-worldSwayEast * sinY + worldSwayNorth * cosY) * impulse;
    }

    function checkTreeCollisions(state) {
        if (!cfg || cfg.treeShakeEnabled === false || !state) return;
        const speed = state.speed != null ? state.speed : 0;
        const minSpeed = cfg.treeShakeMinSpeed != null ? cfg.treeShakeMinSpeed : 0.6;
        if (speed < minSpeed) return;

        const lng = state.lng;
        const lat = state.lat;
        if (lng == null || lat == null) return;

        const yaw = (state.playerYaw != null ? state.playerYaw : 0) * DEG;
        const sinB = Math.sin(yaw);
        const cosB = Math.cos(yaw);
        const velFwd = state.velFwd != null ? state.velFwd : 0;
        const velStrafe = state.velStrafe != null ? state.velStrafe : 0;
        const impactEast = velFwd * sinB + velStrafe * cosB;
        const impactNorth = velFwd * cosB - velStrafe * sinB;
        const moveSpeed = Math.hypot(impactEast, impactNorth);
        if (moveSpeed < minSpeed * 0.5) return;

        const areaM = cfg.treeAreaM != null ? cfg.treeAreaM : 8;

        for (const rec of treeSpriteByKey.values()) {
            const group = rec.group;
            const mesh = rec.mesh;
            if (!group || !mesh) continue;
            if (!playerInTreeArea(lng, lat, group.userData.geoLng, group.userData.geoLat, areaM)) continue;
            applyTreeShakeImpulse(group, mesh, lng, lat, impactEast, impactNorth, moveSpeed);
        }
    }

    function tickTreeShake(dt) {
        if (!hasActiveTreeShake()) return false;
        const spring = cfg.treeShakeSpring != null ? cfg.treeShakeSpring : 42;
        const damp = cfg.treeShakeDamping != null ? cfg.treeShakeDamping : 5.5;
        const maxA = cfg.treeShakeMaxAngle != null ? cfg.treeShakeMaxAngle : 0.38;
        let needsRepaint = false;

        for (const rec of treeSpriteByKey.values()) {
            const mesh = rec.mesh;
            if (!mesh) continue;
            const ud = mesh.userData;
            ud.shakeVelX += (-spring * ud.shakeX - damp * ud.shakeVelX) * dt;
            ud.shakeVelY += (-spring * ud.shakeY - damp * ud.shakeVelY) * dt;
            ud.shakeX += ud.shakeVelX * dt;
            ud.shakeY += ud.shakeVelY * dt;
            ud.shakeX = Math.max(-maxA, Math.min(maxA, ud.shakeX));
            ud.shakeY = Math.max(-maxA, Math.min(maxA, ud.shakeY));

            if (Math.abs(ud.shakeX) < 0.0004 && Math.abs(ud.shakeY) < 0.0004 &&
                Math.abs(ud.shakeVelX) < 0.0004 && Math.abs(ud.shakeVelY) < 0.0004) {
                initTreeShake(mesh);
                continue;
            }

            mesh.rotation.x = ud.baseRotX != null ? ud.baseRotX : Math.PI / 2;
            mesh.rotation.y = ud.shakeY;
            mesh.rotation.z = ud.shakeX;
            needsRepaint = true;
        }
        return needsRepaint;
    }

    function tickTreeSpriteAnim(dt) {
        if (!hasActiveTreeSpawnAnim()) return;
        const dur = Math.max(0.05, cfg.treeSpriteSpawnAnimSec != null ? cfg.treeSpriteSpawnAnimSec : 1.5);
        for (const rec of treeSpriteByKey.values()) {
            const mesh = rec.mesh;
            if (!mesh || !mesh.userData.spawnAnim) continue;
            mesh.userData.animT = Math.min(dur, (mesh.userData.animT || 0) + dt);
            const u = mesh.userData.animT / dur;
            const f = 1 - Math.pow(1 - u, 3);
            applyTreeSpriteOpacity(mesh, f);
            if (u >= 1) {
                mesh.userData.spawnAnim = false;
                applyTreeSpriteOpacity(mesh, 1);
            }
        }
    }

    function extrusionFeatureSig(features) {
        if (!features.length) return "0";
        let h = features.length | 0;
        const step = Math.max(1, Math.floor(features.length / 8));
        for (let i = 0; i < features.length; i += step) {
            const p = features[i].properties;
            h = Math.imul(31, h) + ((p && p.h != null ? (p.h * 1000) | 0 : 0) ^ i);
        }
        return String(h);
    }

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

    function playerInTreeArea(playerLng, playerLat, treeLng, treeLat, sideM) {
        const half = Math.max(0.2, sideM) * 0.5;
        const cosLat = Math.cos(((playerLat + treeLat) * 0.5) * DEG);
        const dEast = (playerLng - treeLng) * M_PER_DEG_LAT * cosLat;
        const dNorth = (playerLat - treeLat) * M_PER_DEG_LAT;
        return Math.abs(dEast) <= half && Math.abs(dNorth) <= half;
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
        return Math.max(0.2, Math.min(4, d || 1));
    }

    function effectiveGridCellM() {
        const d = clampDensity(cfg.density);
        const base = cfg.gridCellM != null ? cfg.gridCellM : 52;
        return Math.max(24, base * Math.sqrt(2 / d));
    }

    function effectiveSpawnChance() {
        return Math.min(0.98, cfg.spawnChanceBase * clampDensity(cfg.density));
    }

    function effectiveMaxCount() {
        const d = clampDensity(cfg.density);
        return Math.round(cfg.maxCount * Math.min(2.5, 0.25 + d * 0.5625));
    }

    function treeSpriteSizeFactor(ix, iy) {
        const spread = cfg.treeSpriteSizeSpread != null ? cfg.treeSpriteSizeSpread : 1;
        const s = Math.max(0, Math.min(1, spread));
        if (s <= 0) return 1;
        const t = hash01(ix, iy, 11);
        const minMul = 1 - s;
        const maxMul = 1 + s;
        return minMul + t * (maxMul - minMul);
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
            "fill-extrusion-opacity": 0,
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
            const pad = 64;
            const sw = mapRef.project([bbox[0], bbox[1]]);
            const ne = mapRef.project([bbox[2], bbox[3]]);
            const x0 = Math.max(0, Math.min(sw.x, ne.x) - pad);
            const y0 = Math.max(0, Math.min(sw.y, ne.y) - pad);
            const canvas = mapRef.getCanvas();
            const x1 = Math.min(canvas.width, Math.max(sw.x, ne.x) + pad);
            const y1 = Math.min(canvas.height, Math.max(sw.y, ne.y) + pad);
            if (x1 <= x0 || y1 <= y0) return [];
            return dedupeFeatures(mapRef.queryRenderedFeatures(
                [[x0, y0], [x1, y1]],
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

    function pickSpriteEntries(lng, lat) {
        const radiusSq = spriteRadiusM() * spriteRadiusM();
        const picked = [];
        for (const entry of cellCache.values()) {
            if (!entry.feature || !entry.key) continue;
            if (distMetersSq(lng, lat, entry.lng, entry.lat) > radiusSq) continue;
            picked.push(entry);
        }
        return capSpriteEntries(lng, lat, picked);
    }

    function refreshThreeTrees(lng, lat) {
        if (!cfg || !cfg.treeSpritesEnabled || !active) return;
        syncThreeTrees(lng, lat, pickSpriteEntries(lng, lat));
    }

    function flushToMap(lng, lat, force) {
        if (!dirty && !force) return false;
        const extrusionRadiusSq = extrusionRadiusM() * extrusionRadiusM();
        const pickedExtrusion = [];
        for (const entry of cellCache.values()) {
            if (!entry.feature) continue;
            if (distMetersSq(lng, lat, entry.lng, entry.lat) > extrusionRadiusSq) continue;
            pickedExtrusion.push(entry);
        }
        const cap = effectiveMaxCount();
        if (pickedExtrusion.length > cap) {
            pickedExtrusion.sort((a, b) =>
                distMetersSq(lng, lat, a.lng, a.lat) - distMetersSq(lng, lat, b.lng, b.lat));
            pickedExtrusion.length = cap;
        }
        const features = pickedExtrusion.map(e => e.feature);
        const spritesOn = cfg.treeSpritesEnabled !== false;
        const spriteEntries = spritesOn ? pickSpriteEntries(lng, lat) : [];
        const sig = extrusionFeatureSig(features);
        if (!force && sig === lastFlushSig && !dirty) {
            if (spritesOn) syncThreeTrees(lng, lat, spriteEntries);
            return false;
        }
        let flushed = false;
        try {
            if (cfg.enabled !== false && mapRef.getSource(SOURCE_ID)) {
                mapRef.getSource(SOURCE_ID).setData({ type: "FeatureCollection", features });
                flushed = true;
            }
        } catch (e) {
            console.warn("GeowalkWoodTerrainExtrude:", e);
        }
        lastFlushSig = sig;
        lastFlushCount = features.length;
        lastFlushAt = performance.now();
        dirty = false;
        if (spritesOn) syncThreeTrees(lng, lat, spriteEntries);
        return flushed;
    }

    function evictFarCells(lng, lat) {
        const radiusSq = genRadiusM() * genRadiusM();
        for (const [key, entry] of cellCache) {
            if (distMetersSq(lng, lat, entry.lng, entry.lat) > radiusSq) {
                cellCache.delete(key);
                dirty = true;
            }
        }
    }

    function collectMissingCells(lng, lat, bbox, stepLng, stepLat) {
        const radiusSq = genRadiusM() * genRadiusM();
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
            lastFlushSig = "";
            clearAllTreeSprites();
            dirty = true;
        }
        if (zoom < cfg.minZoom) {
            cellCache.clear();
            woodSnapshot = null;
            lastFlushCount = -1;
            lastFlushSig = "";
            clearAllTreeSprites();
            try { mapRef.getSource(SOURCE_ID).setData({ type: "FeatureCollection", features: [] }); } catch (e) {}
            return;
        }
        if (!mapRef.getTerrain()) return;

        const lng = playerLng != null ? playerLng : mapRef.getCenter().lng;
        const lat = playerLat != null ? playerLat : mapRef.getCenter().lat;
        const cellM = effectiveGridCellM();
        const stepLat = metersToDegLat(cellM);
        const stepLng = metersToDegLng(cellM, lat);
        const bbox = bboxAround(lng, lat, genRadiusM());
        const wood = getWood(bbox, lng, lat);

        evictFarCells(lng, lat);

        const missing = collectMissingCells(lng, lat, bbox, stepLng, stepLat);
        if (!missing.length && !dirty) return;

        const budget = cfg.cellsPerPass;
        let added = 0;
        for (let i = 0; i < missing.length && added < budget; i++) {
            const c = missing[i];
            const key = cellKey(c.ix, c.iy);
            const entry = createTreeForCell(c.ix, c.iy, stepLng, stepLat, zoom, wood);
            entry.key = key;
            cellCache.set(key, entry);
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
        lastFlushSig = "";
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
        clearAllTreeSprites();
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
        unbindOriginShiftHandler();
        resetTreeSpriteCache();
        deactivate();
        cfg = null;
        lastOptions = null;
        mapRef = null;
    }

    function shouldRunExtrusion(options) {
        return options.enabled !== false && options.terrainOn !== false;
    }

    function shouldRunSprites(options) {
        return options.treeSpritesEnabled !== false && options.terrainOn !== false;
    }

    function shouldRunAny(options) {
        return shouldRunExtrusion(options) || shouldRunSprites(options);
    }

    function applyRuntimeOptions(options) {
        if (!cfg) return false;
        let changed = false;
        if (options.density != null && clampDensity(options.density) !== clampDensity(cfg.density)) {
            cfg.density = clampDensity(options.density);
            changed = true;
        }
        if (options.treeSpriteSizeSpread != null) {
            const s = Math.max(0, Math.min(1, +options.treeSpriteSizeSpread || 0));
            if (s !== cfg.treeSpriteSizeSpread) {
                cfg.treeSpriteSizeSpread = s;
                changed = true;
            }
        }
        if (options.enabled != null) cfg.enabled = options.enabled !== false;
        if (options.treeSpritesEnabled != null) {
            const next = options.treeSpritesEnabled !== false;
            if (next !== cfg.treeSpritesEnabled) {
                cfg.treeSpritesEnabled = next;
                changed = true;
            }
        }
        if (options.treeSpriteRadiusM != null) {
            const r = Math.max(50, Math.min(3000, +options.treeSpriteRadiusM || 0));
            if (r !== cfg.treeSpriteRadiusM) {
                cfg.treeSpriteRadiusM = r;
                changed = true;
            }
        }
        if (options.treeSpriteSpawnAnim != null) {
            const next = options.treeSpriteSpawnAnim !== false;
            if (next !== cfg.treeSpriteSpawnAnim) {
                cfg.treeSpriteSpawnAnim = next;
                changed = true;
            }
        }
        if (options.treeAreaM != null) {
            const a = Math.max(0.5, Math.min(20, +options.treeAreaM || 0));
            if (a !== cfg.treeAreaM) {
                cfg.treeAreaM = a;
                changed = true;
            }
        }
        if (options.climeZonesEnabled != null) {
            const next = options.climeZonesEnabled !== false;
            if (next !== cfg.climeZonesEnabled) {
                cfg.climeZonesEnabled = next;
                changed = true;
            }
        }
        return changed;
    }

    function applyExtrusionRuntime(wantExtrusion) {
        if (wantExtrusion) ensureRuntime();
        else {
            try {
                if (mapRef && mapRef.getSource(SOURCE_ID)) {
                    mapRef.getSource(SOURCE_ID).setData({ type: "FeatureCollection", features: [] });
                }
            } catch (e) {}
            removeRuntime();
        }
    }

    function setup(map, options) {
        teardown();
        mapRef = map;
        lastOptions = Object.assign({}, DEFAULTS, options || {});
        lastOptions.density = clampDensity(lastOptions.density);
        cfg = lastOptions;
        cellCache = new Map();
        bindMapEvents(map);
        if (!shouldRunAny(cfg)) return;
        active = true;
        terrainOn = true;
        applyExtrusionRuntime(shouldRunExtrusion(cfg));
        bindOriginShiftHandler();
        scheduleRebuild(0);
    }

    function sync(state) {
        if (!mapRef) return;
        const s = state || {};
        const terrainOnReq = !!s.terrainOn;
        if (!cfg) cfg = Object.assign({}, DEFAULTS, lastOptions || {});

        const optsChanged = applyRuntimeOptions(s);

        const extrusionOn = cfg.enabled !== false && terrainOnReq;
        const spritesOn = cfg.treeSpritesEnabled !== false && terrainOnReq;
        const want = extrusionOn || spritesOn;

        if (!want) {
            if (active) deactivate();
            return;
        }

        if (!active) {
            active = true;
            terrainOn = true;
            applyExtrusionRuntime(extrusionOn);
            scheduleRebuild(0);
            return;
        }

        applyExtrusionRuntime(extrusionOn);
        if (!spritesOn) clearAllTreeSprites();

        if (optsChanged) {
            resetTreeSpriteCache();
            clearCache();
            dirty = true;
            scheduleRebuild(0);
            return;
        }

        if (s.force) scheduleRebuild(0);
    }

    function tick(state) {
        if (!active || !terrainOn || !cfg || !mapRef || !state || !state.ready) return false;
        if (state.lng == null || state.lat == null) return false;
        playerLng = state.lng;
        playerLat = state.lat;

        const dt = state.dt != null ? state.dt : 0;
        let needsRepaint = false;
        if (hasActiveTreeSpawnAnim()) {
            tickTreeSpriteAnim(dt);
            needsRepaint = true;
        }
        if (cfg.treeShakeEnabled !== false) {
            checkTreeCollisions(state);
            if (tickTreeShake(dt)) needsRepaint = true;
        }

        const stepLat = metersToDegLat(effectiveGridCellM());
        const stepLng = metersToDegLng(effectiveGridCellM(), playerLat);
        const ix = Math.floor(playerLng / stepLng);
        const iy = Math.floor(playerLat / stepLat);
        if (lastCellIx === ix && lastCellIy === iy) return needsRepaint;

        lastCellIx = ix;
        lastCellIy = iy;
        if (cfg.treeSpritesEnabled !== false) refreshThreeTrees(playerLng, playerLat);
        if (!rebuildTimer) scheduleRebuild(cfg.rebuildDebounceMs);
        return needsRepaint;
    }

    window.GeowalkWoodTerrainExtrude = { setup, sync, tick, reset, teardown, bindMapEvents };
})();
