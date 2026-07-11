// Three.js-слой поверх MapLibre (CustomLayer, renderingMode: "3d").
//
// MapLibre: карта, рельеф, здания, дороги, вода.
// Three.js: коллекционные кубики, спрайты деревьев, основания спрайтов — с depth-test
// против зданий и рельефа.
//
// Локальные координаты (метры от origin):
//   x = восток, y = север, z = высота над уровнем моря (рельеф + offset).
//
// API:
//   GeowalkThree.setup(map, { afterLayer, originLng, originLat })
//   GeowalkThree.onReady(fn) / updateOrigin(lng, lat) / geoToLocal(lng, lat, alt)
//   GeowalkThree.add(obj) / remove(obj)
(function () {
    "use strict";

    const M_PER_DEG_LAT = 111320;
    const DEG = Math.PI / 180;
    const ORIGIN_SHIFT_M = 3000;

    let map = null;
    let renderer = null;
    let scene = null;
    let camera = null;
    let layerObj = null;
    let layerAfterId = null;

    const origin = { lng: null, lat: null, merc: null, scale: 1, cosLat: 1 };
    const readyListeners = [];
    const beforeRenderListeners = [];
    let pending = [];

    const TERRAIN_CACHE_CELL = 0.00004;
    const TERRAIN_CACHE_MAX = 640;
    const terrainCache = new Map();
    let frameGround = { lng: null, lat: null, z: null };

    function terrainCacheKey(lng, lat) {
        return Math.round(lng / TERRAIN_CACHE_CELL) + "," + Math.round(lat / TERRAIN_CACHE_CELL);
    }

    function clearTerrainCache() {
        terrainCache.clear();
        frameGround.lng = null;
        frameGround.lat = null;
        frameGround.z = null;
    }

    function setFrameGround(lng, lat, ground) {
        if (lng == null || lat == null || typeof ground !== "number" || !isFinite(ground)) return;
        frameGround.lng = lng;
        frameGround.lat = lat;
        frameGround.z = ground;
        terrainCache.set(terrainCacheKey(lng, lat), ground);
    }

    function terrainAt(lng, lat) {
        if (lng == null || lat == null) return 0;
        if (frameGround.lng != null && frameGround.lat != null && frameGround.z != null) {
            const dLng = (lng - frameGround.lng) * M_PER_DEG_LAT * (origin.cosLat || 1);
            const dLat = (lat - frameGround.lat) * M_PER_DEG_LAT;
            if (dLng * dLng + dLat * dLat < 0.25) return frameGround.z;
        }
        const key = terrainCacheKey(lng, lat);
        if (terrainCache.has(key)) return terrainCache.get(key);
        if (!map || !map.getTerrain || !map.getTerrain()) return 0;
        let ground = 0;
        try {
            const te = map.queryTerrainElevation([lng, lat]);
            if (typeof te === "number" && isFinite(te)) ground = te;
        } catch (e) { /* пропускаем редкий сбой кадра */ }
        terrainCache.set(key, ground);
        if (terrainCache.size > TERRAIN_CACHE_MAX) terrainCache.clear();
        return ground;
    }

    function hasTHREE() { return !!window.THREE; }

    function geoToLocal(lng, lat, alt) {
        if (origin.lng == null) return { x: 0, y: 0, z: alt || 0 };
        const ground = terrainAt(lng, lat);
        return {
            x: (lng - origin.lng) * M_PER_DEG_LAT * origin.cosLat,
            y: (lat - origin.lat) * M_PER_DEG_LAT,
            z: ground + (alt || 0)
        };
    }

    function isAnchoredSceneObject(obj) {
        let p = obj;
        while (p) {
            if (p.name === "geowalk-3dsky" || p.name === "geowalk-car-3d") return true;
            p = p.parent;
        }
        return false;
    }

    function shiftScene(dx, dy) {
        if (!scene) return;
        scene.traverse((obj) => {
            if (obj.isLight) return;
            if (isAnchoredSceneObject(obj)) return;
            if (obj.isMesh) {
                obj.position.x += dx;
                obj.position.y += dy;
            }
        });
    }

    function setOrigin(lng, lat) {
        if (!hasTHREE()) return;
        if (origin.lng != null && scene) {
            const cosLat = Math.cos(lat * DEG) || 1e-6;
            const dx = (origin.lng - lng) * M_PER_DEG_LAT * cosLat;
            const dy = (origin.lat - lat) * M_PER_DEG_LAT;
            shiftScene(dx, dy);
        }
        origin.lng = lng;
        origin.lat = lat;
        origin.cosLat = Math.cos(lat * DEG) || 1e-6;
        clearTerrainCache();
        if (window.maplibregl) {
            origin.merc = maplibregl.MercatorCoordinate.fromLngLat([lng, lat], 0);
            origin.scale = origin.merc.meterInMercatorCoordinateUnits();
        }
    }

    function updateOrigin(lng, lat) {
        if (lng == null || lat == null) return false;
        if (origin.lng == null) { setOrigin(lng, lat); return true; }
        const east = (lng - origin.lng) * M_PER_DEG_LAT * origin.cosLat;
        const north = (lat - origin.lat) * M_PER_DEG_LAT;
        if (Math.hypot(east, north) > ORIGIN_SHIFT_M) {
            setOrigin(lng, lat);
            return true;
        }
        return false;
    }

    function fireReady() {
        for (const fn of readyListeners) {
            try { fn(); } catch (e) { console.warn("GeowalkThree onReady:", e); }
        }
    }

    function attachPending() {
        if (!scene) return;
        if (pending.length) {
            for (const o of pending) scene.add(o);
            pending = [];
        }
        fireReady();
    }

    function layerInsertBefore(m, afterId) {
        if (!afterId) return null;
        const layers = m.getStyle() && m.getStyle().layers;
        if (!layers) return null;
        const idx = layers.findIndex((l) => l.id === afterId);
        if (idx < 0 || idx >= layers.length - 1) return null;
        return layers[idx + 1].id;
    }

    function makeLayer() {
        return {
            id: "geowalk-three",
            type: "custom",
            renderingMode: "3d",
            onAdd(m, gl) {
                map = m;
                const THREE = window.THREE;
                camera = new THREE.Camera();
                scene = new THREE.Scene();
                scene.add(new THREE.AmbientLight(0xffffff, 1.15));
                const dir = new THREE.DirectionalLight(0xffffff, 1.5);
                dir.position.set(0.4, 0.7, 1).normalize();
                scene.add(dir);
                renderer = new THREE.WebGLRenderer({
                    canvas: m.getCanvas(),
                    context: gl,
                    antialias: true
                });
                renderer.autoClear = false;
                if (origin.lng != null) {
                    origin.merc = maplibregl.MercatorCoordinate.fromLngLat([origin.lng, origin.lat], 0);
                    origin.scale = origin.merc.meterInMercatorCoordinateUnits();
                }
                attachPending();
            },
            onRemove() {
                scene = null;
                camera = null;
                renderer = null;
                pending = [];
            },
            render(gl, args) {
                if (!scene || !camera || !renderer || origin.merc == null) return;
                for (const fn of beforeRenderListeners) {
                    try { fn(camera, map, args); } catch (e) { /* кадр */ }
                }
                const THREE = window.THREE;
                const s = origin.scale;
                const l = new THREE.Matrix4()
                    .makeTranslation(origin.merc.x, origin.merc.y, origin.merc.z || 0)
                    .scale(new THREE.Vector3(s, -s, s));
                const m = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix);
                camera.projectionMatrix = m.multiply(l);
                renderer.resetState();
                renderer.render(scene, camera);
            }
        };
    }

    function ensureLayer(m) {
        if (!m || !hasTHREE()) return;
        const before = layerInsertBefore(m, layerAfterId);
        if (m.getLayer("geowalk-three")) {
            if (before) {
                try { m.moveLayer("geowalk-three", before); } catch (e) { /* уже на месте */ }
            }
            return;
        }
        layerObj = makeLayer();
        if (before) m.addLayer(layerObj, before);
        else m.addLayer(layerObj);
    }

    window.GeowalkThree = {
        setup(m, options) {
            map = m;
            layerAfterId = options && options.afterLayer ? options.afterLayer : null;
            if (!hasTHREE()) { console.warn("GeowalkThree: THREE не загружен"); return; }
            if (options && options.originLng != null && options.originLat != null) {
                setOrigin(options.originLng, options.originLat);
            } else if (origin.lng != null) {
                setOrigin(origin.lng, origin.lat);
            }
            ensureLayer(m);
        },
        onReady(fn) {
            if (typeof fn !== "function") return;
            if (readyListeners.indexOf(fn) === -1) readyListeners.push(fn);
            if (scene) { try { fn(); } catch (e) {} }
        },
        onBeforeRender(fn) {
            if (typeof fn !== "function") return;
            if (beforeRenderListeners.indexOf(fn) === -1) beforeRenderListeners.push(fn);
        },
        offBeforeRender(fn) {
            const i = beforeRenderListeners.indexOf(fn);
            if (i >= 0) beforeRenderListeners.splice(i, 1);
        },
        isReady() { return !!scene; },
        getMap() { return map; },
        setOrigin,
        updateOrigin,
        geoToLocal,
        terrainAt,
        setFrameGround,
        clearTerrainCache,
        add(obj) { if (scene) scene.add(obj); else if (obj) pending.push(obj); },
        remove(obj) { if (scene && obj) scene.remove(obj); },
        getScene() { return scene; },
        getCamera() { return camera; },
        getRenderer() { return renderer; },
        getOrigin() {
            return {
                lng: origin.lng,
                lat: origin.lat,
                merc: origin.merc,
                scale: origin.scale,
                cosLat: origin.cosLat
            };
        },
        meterScale() { return origin.scale; },
        THREE() { return window.THREE; }
    };
})();
