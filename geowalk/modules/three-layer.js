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
//   GeowalkThree.configure({ originShiftM, terrainCacheMax, terrainCacheCell })
//   GeowalkThree.onReady(fn) / updateOrigin(lng, lat) / geoToLocal(lng, lat, alt)
//   GeowalkThree.add(obj) / remove(obj)
(function () {
    "use strict";

    const M_PER_DEG_LAT = 111320;
    const DEG = Math.PI / 180;

    let originShiftM = 3000;
    let terrainCacheCell = 0.00004;
    let terrainCacheMax = 1024;

    let map = null;
    let renderer = null;
    let scene = null;
    let camera = null;
    let layerObj = null;
    let layerAfterId = null;

    const origin = { lng: null, lat: null, merc: null, scale: 1, cosLat: 1 };
    const readyListeners = [];
    const beforeRenderListeners = [];
    const originShiftListeners = [];
    let pending = [];

    const terrainCache = new Map();
    let frameGround = { lng: null, lat: null, z: null };
    let frameQueryKey = null;
    let frameQueryZ = null;

    const projLocal = { m: null, l: null, v: null, s: null };

    function terrainCacheKey(lng, lat) {
        return Math.round(lng / terrainCacheCell) + "," + Math.round(lat / terrainCacheCell);
    }

    function trimTerrainCache() {
        while (terrainCache.size > terrainCacheMax) {
            const first = terrainCache.keys().next().value;
            if (first == null) break;
            terrainCache.delete(first);
        }
    }

    function clearTerrainCache() {
        terrainCache.clear();
        frameGround.lng = null;
        frameGround.lat = null;
        frameGround.z = null;
        frameQueryKey = null;
        frameQueryZ = null;
    }

    function setFrameGround(lng, lat, ground) {
        if (lng == null || lat == null || typeof ground !== "number" || !isFinite(ground)) return;
        frameGround.lng = lng;
        frameGround.lat = lat;
        frameGround.z = ground;
        const key = terrainCacheKey(lng, lat);
        terrainCache.delete(key);
        terrainCache.set(key, ground);
        trimTerrainCache();
    }

    function terrainAt(lng, lat) {
        if (lng == null || lat == null) return 0;
        if (frameGround.lng != null && frameGround.lat != null && frameGround.z != null) {
            const dLng = (lng - frameGround.lng) * M_PER_DEG_LAT * (origin.cosLat || 1);
            const dLat = (lat - frameGround.lat) * M_PER_DEG_LAT;
            if (dLng * dLng + dLat * dLat < 0.25) return frameGround.z;
        }
        const key = terrainCacheKey(lng, lat);
        if (frameQueryKey === key && frameQueryZ != null) return frameQueryZ;
        if (terrainCache.has(key)) {
            const cached = terrainCache.get(key);
            terrainCache.delete(key);
            terrainCache.set(key, cached);
            frameQueryKey = key;
            frameQueryZ = cached;
            return cached;
        }
        if (!map || !map.getTerrain || !map.getTerrain()) return 0;
        let ground = 0;
        try {
            const te = map.queryTerrainElevation([lng, lat]);
            if (typeof te === "number" && isFinite(te)) ground = te;
        } catch (e) { /* пропускаем редкий сбой кадра */ }
        terrainCache.set(key, ground);
        trimTerrainCache();
        frameQueryKey = key;
        frameQueryZ = ground;
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
            if (p.name === "geowalk-3dsky" || p.name === "geowalk-car-3d" || p.name === "geowalk-save-pin" || p.name === "geowalk-car-3d-talk") return true;
            p = p.parent;
        }
        return false;
    }

    function isShadowSceneObject(obj) {
        let p = obj;
        while (p) {
            if (p.name === "geowalk-rt-shadows") return true;
            p = p.parent;
        }
        return false;
    }

    function fireOriginShift(dx, dy, lng, lat) {
        for (const fn of originShiftListeners) {
            try { fn({ dx, dy, lng, lat }); } catch (e) { console.warn("GeowalkThree onOriginShift:", e); }
        }
    }

    function shiftScene(dx, dy) {
        if (!scene || (!dx && !dy)) return;
        for (let i = 0; i < scene.children.length; i++) {
            const obj = scene.children[i];
            if (obj.isLight) continue;
            if (isAnchoredSceneObject(obj)) continue;
            if (isShadowSceneObject(obj)) continue;
            obj.position.x += dx;
            obj.position.y += dy;
        }
    }

    function setOrigin(lng, lat) {
        if (!hasTHREE()) return;
        let dx = 0;
        let dy = 0;
        if (origin.lng != null && scene) {
            const cosLat = Math.cos(lat * DEG) || 1e-6;
            dx = (origin.lng - lng) * M_PER_DEG_LAT * cosLat;
            dy = (origin.lat - lat) * M_PER_DEG_LAT;
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
        if (dx !== 0 || dy !== 0) fireOriginShift(dx, dy, lng, lat);
    }

    function updateOrigin(lng, lat) {
        if (lng == null || lat == null) return false;
        if (origin.lng == null) { setOrigin(lng, lat); return true; }
        const east = (lng - origin.lng) * M_PER_DEG_LAT * origin.cosLat;
        const north = (lat - origin.lat) * M_PER_DEG_LAT;
        if (Math.hypot(east, north) > originShiftM) {
            setOrigin(lng, lat);
            return true;
        }
        return false;
    }

    function sceneHasRenderableMeshes() {
        if (!scene) return false;
        let found = false;
        scene.traverse((obj) => {
            if (found || !obj.isMesh || !obj.visible) return;
            found = true;
        });
        return found;
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

    function flattenMeshMaterials(root) {
        const THREE = window.THREE;
        if (!THREE || !root) return;
        root.traverse((node) => {
            if (!node.isMesh || !node.material) return;
            const flattenOne = (mat) => {
                if (!mat || mat.isMeshBasicMaterial) return mat;
                const basic = new THREE.MeshBasicMaterial({
                    color: mat.color ? mat.color.clone() : new THREE.Color(0xffffff),
                    map: mat.map || null,
                    transparent: !!mat.transparent,
                    opacity: mat.opacity != null ? mat.opacity : 1,
                    alphaMap: mat.alphaMap || null,
                    alphaTest: mat.alphaTest || 0,
                    side: mat.side != null ? mat.side : THREE.FrontSide,
                    depthWrite: mat.depthWrite !== false,
                    depthTest: mat.depthTest !== false,
                    vertexColors: !!mat.vertexColors
                });
                mat.dispose();
                return basic;
            };
            if (Array.isArray(node.material)) node.material = node.material.map(flattenOne);
            else node.material = flattenOne(node.material);
        });
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
                scene.add(new THREE.AmbientLight(0xffffff, 1));
                renderer = new THREE.WebGLRenderer({
                    canvas: m.getCanvas(),
                    context: gl,
                    antialias: true
                });
                renderer.autoClear = false;
                renderer.shadowMap.enabled = true;
                renderer.shadowMap.type = THREE.BasicShadowMap;
                renderer.shadowMap.autoUpdate = false;
                renderer.toneMapping = THREE.NoToneMapping;
                if (!projLocal.m) {
                    projLocal.m = new THREE.Matrix4();
                    projLocal.l = new THREE.Matrix4();
                    projLocal.v = new THREE.Vector3();
                    projLocal.s = new THREE.Vector3();
                }
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
                if (!sceneHasRenderableMeshes()) return;
                frameQueryKey = null;
                frameQueryZ = null;
                for (const fn of beforeRenderListeners) {
                    try { fn(camera, map, args); } catch (e) { /* кадр */ }
                }
                const THREE = window.THREE;
                const s = origin.scale;
                projLocal.v.set(origin.merc.x, origin.merc.y, origin.merc.z || 0);
                projLocal.s.set(s, -s, s);
                projLocal.l.makeTranslation(projLocal.v.x, projLocal.v.y, projLocal.v.z);
                projLocal.l.scale(projLocal.s);
                projLocal.m.fromArray(args.defaultProjectionData.mainMatrix);
                camera.projectionMatrix = projLocal.m.multiply(projLocal.l);
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
        configure(options) {
            const o = options || {};
            let cacheChanged = false;
            if (o.originShiftM != null) {
                const next = Math.max(500, Math.min(10000, +o.originShiftM || 0));
                if (next !== originShiftM) originShiftM = next;
            }
            if (o.terrainCacheMax != null) {
                const next = Math.max(64, Math.min(4096, o.terrainCacheMax | 0));
                if (next !== terrainCacheMax) {
                    terrainCacheMax = next;
                    cacheChanged = true;
                }
            }
            if (o.terrainCacheCell != null) {
                const next = Math.max(0.00001, +o.terrainCacheCell || 0.00004);
                if (next !== terrainCacheCell) {
                    terrainCacheCell = next;
                    cacheChanged = true;
                }
            }
            if (cacheChanged) clearTerrainCache();
            else trimTerrainCache();
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
        onOriginShift(fn) {
            if (typeof fn !== "function") return;
            if (originShiftListeners.indexOf(fn) === -1) originShiftListeners.push(fn);
        },
        offOriginShift(fn) {
            const i = originShiftListeners.indexOf(fn);
            if (i >= 0) originShiftListeners.splice(i, 1);
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
        flattenMeshMaterials,
        THREE() { return window.THREE; }
    };
})();
