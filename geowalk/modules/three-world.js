// Модуль: основной мир GeoWalk на чистом Three.js (без MapLibre для главного вида).
// Рельеф (Terrarium DEM), здания (MVT), небо/туман, камера, querySourceFeatures.
// Совместимый map-shim для существующего кода index.html.
//
// GeowalkWorld.init({ container, config, center, bearing, pitch, zoom })
// GeowalkWorld.getMapShim() / getScene() / geoToLocal() / updateOrigin()
// GeowalkWorld.onLoad(fn) / render() / resize()
(function () {
    "use strict";

    const M_PER_DEG_LAT = 111320;
    const DEG = Math.PI / 180;
    const ORIGIN_SHIFT_M = 3000;
    const TERRAIN_ZOOM = 14;
    const BUILD_ZOOM = 15;
    const MVT_URL = "https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf";
    const TERRAIN_SEG = 32;

    let cfg = {};
    let container = null;
    let renderer = null;
    let scene = null;
    let camera = null;
    let terrainGroup = null;
    let buildingsGroup = null;
    let ready = false;
    const loadListeners = [];

    const origin = { lng: null, lat: null, cosLat: 1 };
    const terrainTiles = new Map();
    const buildTiles = new Map();
    const featureCache = new Map();
    let terrainReady = false;
    let demLoaded = false;

    const shimState = {
        terrainOn: true,
        clampGround: false,
        bearing: 0,
        pitch: 60,
        zoom: 18,
        center: [0, 0],
        elevation: 0
    };

    const transform = {
        height: 800,
        cameraToCenterDistance: 1.5,
        farZ: 10000,
        overrideNearFarZ(near, far) { this._near = near; this._far = far; },
        clearNearFarZOverride() { this._near = null; this._far = null; }
    };

    function fireLoad() {
        ready = true;
        for (const fn of loadListeners) {
            try { fn(); } catch (e) { console.warn("GeowalkWorld onLoad:", e); }
        }
    }

    function setOrigin(lng, lat) {
        if (origin.lng != null && terrainGroup && buildingsGroup) {
            const cosLat = Math.cos(lat * DEG) || 1e-6;
            const dx = (origin.lng - lng) * M_PER_DEG_LAT * cosLat;
            const dy = (origin.lat - lat) * M_PER_DEG_LAT;
            terrainGroup.position.x += dx;
            terrainGroup.position.y += dy;
            buildingsGroup.position.x += dx;
            buildingsGroup.position.y += dy;
        }
        origin.lng = lng;
        origin.lat = lat;
        origin.cosLat = Math.cos(lat * DEG) || 1e-6;
    }

    function geoToLocal(lng, lat, alt) {
        if (origin.lng == null) return { x: 0, y: 0, z: alt || 0 };
        return {
            x: (lng - origin.lng) * M_PER_DEG_LAT * origin.cosLat,
            y: (lat - origin.lat) * M_PER_DEG_LAT,
            z: alt || 0
        };
    }

    function updateOrigin(lng, lat) {
        if (lng == null || lat == null) return;
        if (origin.lng == null) { setOrigin(lng, lat); return; }
        const p = geoToLocal(lng, lat);
        if (Math.hypot(p.x, p.y) > ORIGIN_SHIFT_M) setOrigin(lng, lat);
    }

    function lngLatToTile(lng, lat, z) {
        const n = Math.pow(2, z);
        const x = Math.floor((lng + 180) / 360 * n);
        const latR = lat * DEG;
        const y = Math.floor((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2 * n);
        return { x, y, z };
    }

    function tileKey(z, x, y) { return z + "/" + x + "/" + y; }

    function tileLngLatBounds(z, x, y) {
        const n = Math.pow(2, z);
        const lng0 = x / n * 360 - 180;
        const lng1 = (x + 1) / n * 360 - 180;
        const lat0 = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) / DEG;
        const lat1 = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n))) / DEG;
        return { lng0, lat1, lng1, lat0 };
    }

    function decodeTerrarium(data, u, v) {
        const i = (v * 256 + u) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        return (r * 256 + g + b / 256) - 32768;
    }

    function sampleTerrainAt(lng, lat) {
        const z = TERRAIN_ZOOM;
        const t = lngLatToTile(lng, lat, z);
        const key = tileKey(z, t.x, t.y);
        const tile = terrainTiles.get(key);
        if (!tile || !tile.heights) return 0;
        const b = tileLngLatBounds(z, t.x, t.y);
        const u = Math.max(0, Math.min(1, (lng - b.lng0) / (b.lng1 - b.lng0)));
        const v = Math.max(0, Math.min(1, (b.lat0 - lat) / (b.lat0 - b.lat1)));
        const seg = tile.seg;
        const fx = u * seg, fy = v * seg;
        const ix = Math.min(seg, Math.floor(fx));
        const iy = Math.min(seg, Math.floor(fy));
        const h00 = tile.heights[iy * (seg + 1) + ix];
        const h10 = tile.heights[iy * (seg + 1) + ix + 1];
        const h01 = tile.heights[(iy + 1) * (seg + 1) + ix];
        const h11 = tile.heights[(iy + 1) * (seg + 1) + ix + 1];
        const tx = fx - ix, ty = fy - iy;
        const h = (h00 * (1 - tx) + h10 * tx) * (1 - ty) + (h01 * (1 - tx) + h11 * tx) * ty;
        return h * (cfg.terrainExaggeration || 1);
    }

    function loadImage(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = url;
        });
    }

    function loadTerrainTile(z, x, y) {
        const key = tileKey(z, x, y);
        if (terrainTiles.has(key)) return terrainTiles.get(key).promise;
        const url = (cfg.demUrl || "").replace("{z}", z).replace("{x}", x).replace("{y}", y);
        const entry = { mesh: null, heights: null, seg: TERRAIN_SEG, promise: null };
        entry.promise = (async () => {
            try {
                const img = await loadImage(url);
                const c = document.createElement("canvas");
                c.width = 256; c.height = 256;
                const ctx = c.getContext("2d");
                ctx.drawImage(img, 0, 0);
                const data = ctx.getImageData(0, 0, 256, 256).data;
                const seg = TERRAIN_SEG;
                const ex = cfg.terrainExaggeration || 1;
                const b = tileLngLatBounds(z, x, y);
                const verts = [];
                const heights = new Float32Array((seg + 1) * (seg + 1));
                let vi = 0;
                for (let j = 0; j <= seg; j++) {
                    const v = j / seg;
                    const lat = b.lat0 + (b.lat1 - b.lat0) * v;
                    for (let i = 0; i <= seg; i++) {
                        const u = i / seg;
                        const lng = b.lng0 + (b.lng1 - b.lng0) * u;
                        const pu = Math.min(255, Math.floor(u * 255));
                        const pv = Math.min(255, Math.floor(v * 255));
                        const h = decodeTerrarium(data, pu, pv) * ex;
                        heights[vi++] = h;
                        const p = geoToLocal(lng, lat, h);
                        verts.push(p.x, p.y, p.z);
                    }
                }
                entry.heights = heights;
                const indices = [];
                for (let j = 0; j < seg; j++) {
                    for (let i = 0; i < seg; i++) {
                        const a = j * (seg + 1) + i;
                        const b0 = a + 1, c = a + seg + 1, d = c + 1;
                        indices.push(a, c, b0, b0, c, d);
                    }
                }
                const geom = new (window.THREE.BufferGeometry)();
                geom.setAttribute("position", new window.THREE.Float32BufferAttribute(verts, 3));
                geom.setIndex(indices);
                geom.computeVertexNormals();
                const mat = new window.THREE.MeshLambertMaterial({ color: 0x4a6741, flatShading: true });
                const mesh = new window.THREE.Mesh(geom, mat);
                mesh.userData.tileKey = key;
                entry.mesh = mesh;
                if (terrainGroup) terrainGroup.add(mesh);
                demLoaded = true;
                emitMapEvent("sourcedata", { sourceId: "terrain-dem", isSourceLoaded: true });
            } catch (e) {
                console.warn("terrain tile", key, e);
            }
            return entry;
        })();
        terrainTiles.set(key, entry);
        return entry.promise;
    }

    function parseMvt(buffer) {
        if (!window.vectorTile || !window.Pbf) return null;
        try {
            const tile = new vectorTile.VectorTile(new Pbf(buffer));
            return tile;
        } catch (e) { return null; }
    }

    function featureToGeo(layerName, feature, z, x, y) {
        const b = tileLngLatBounds(z, x, y);
        const size = 4096;
        const geo = feature.toGeoJSON(x, y, z);
        if (!geo) return null;
        geo.sourceLayer = layerName;
        geo._tileKey = tileKey(z, x, y);
        return geo;
    }

    function addFeaturesToCache(features) {
        for (const f of features) {
            const sl = f.sourceLayer || "unknown";
            if (!featureCache.has(sl)) featureCache.set(sl, []);
            featureCache.get(sl).push(f);
        }
    }

    function extrudeRing(ring, height, minH) {
        if (!ring || ring.length < 3) return null;
        const shape = new (window.THREE.Shape)();
        const pts = [];
        for (const c of ring) {
            const p = geoToLocal(c[0], c[1], 0);
            pts.push(new window.THREE.Vector2(p.x, p.y));
        }
        shape.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i].x, pts[i].y);
        shape.lineTo(pts[0].x, pts[0].y);
        const base = minH || 0;
        const depth = Math.max(0.5, height - base);
        const geom = new window.THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
        geom.translate(0, 0, base);
        return geom;
    }

    async function loadBuildTile(z, x, y) {
        const key = tileKey(z, x, y);
        if (buildTiles.has(key)) return buildTiles.get(key);
        const url = MVT_URL.replace("{z}", z).replace("{x}", x).replace("{y}", y);
        const entry = { meshes: [], promise: null };
        entry.promise = (async () => {
            try {
                const resp = await fetch(url);
                if (!resp.ok) return entry;
                const buf = await resp.arrayBuffer();
                const tile = parseMvt(buf);
                if (!tile) return entry;
                const feats = [];
                const geoms = [];
                for (const layerName in tile.layers) {
                    const layer = tile.layers[layerName];
                    for (let i = 0; i < layer.length; i++) {
                        const feat = layer.feature(i);
                        const geo = featureToGeo(layerName, feat, z, x, y);
                        if (geo) feats.push(geo);
                        if (layerName !== "building") continue;
                        const g = geo && geo.geometry;
                        if (!g) continue;
                        const polys = g.type === "Polygon" ? [g.coordinates]
                            : g.type === "MultiPolygon" ? g.coordinates : null;
                        if (!polys) continue;
                        const props = geo.properties || {};
                        const rawH = props.render_height != null ? props.render_height : props.height;
                        const h = (rawH != null && isFinite(+rawH)) ? +rawH : 12;
                        const minH = props.render_min_height != null ? +props.render_min_height : 0;
                        for (const poly of polys) {
                            const eg = extrudeRing(poly[0], h, minH);
                            if (eg) geoms.push(eg);
                        }
                    }
                }
                addFeaturesToCache(feats);
                if (geoms.length && buildingsGroup) {
                    const mat = new window.THREE.MeshLambertMaterial({ color: 0xc8c4bc, flatShading: true });
                    const mergeFn = window.THREE.BufferGeometryUtils && window.THREE.BufferGeometryUtils.mergeGeometries;
                    if (mergeFn && geoms.length > 1) {
                        const merged = mergeFn(geoms);
                        if (merged) {
                            const mesh = new window.THREE.Mesh(merged, mat);
                            mesh.userData.tileKey = key;
                            buildingsGroup.add(mesh);
                            entry.meshes.push(mesh);
                        }
                    } else {
                        for (const g of geoms) {
                            const mesh = new window.THREE.Mesh(g, mat);
                            mesh.userData.tileKey = key;
                            buildingsGroup.add(mesh);
                            entry.meshes.push(mesh);
                        }
                    }
                }
            } catch (e) {
                console.warn("build tile", key, e);
            }
            return entry;
        })();
        buildTiles.set(key, entry);
        return entry.promise;
    }

    function updateTilesAround(lng, lat) {
        const tz = TERRAIN_ZOOM;
        const tc = lngLatToTile(lng, lat, tz);
        const radius = 2;
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                loadTerrainTile(tz, tc.x + dx, tc.y + dy);
            }
        }
        const bz = BUILD_ZOOM;
        const bc = lngLatToTile(lng, lat, bz);
        const br = 2;
        for (let dy = -br; dy <= br; dy++) {
            for (let dx = -br; dx <= br; dx++) {
                loadBuildTile(bz, bc.x + dx, bc.y + dy);
            }
        }
    }

    function applySky(sky) {
        if (!scene || !window.THREE) return;
        const s = sky || cfg.sky || {};
        const col = new window.THREE.Color(s.color || "#0350B2");
        scene.background = col;
        const fogCol = new window.THREE.Color(s.fogColor || s.horizonColor || "#9fc8ff");
        const dist = 800 + (s.horizonFogBlend || 0.5) * 4000;
        scene.fog = new window.THREE.Fog(fogCol, 80, dist);
    }

    function applyJumpTo(opts) {
        if (!camera || !window.THREE) return;
        const o = opts || {};
        if (o.bearing != null) shimState.bearing = o.bearing;
        if (o.pitch != null) shimState.pitch = o.pitch;
        if (o.zoom != null) shimState.zoom = o.zoom;
        if (o.center) shimState.center = o.center.slice();
        if (o.elevation != null) shimState.elevation = o.elevation;

        const centerLng = shimState.center[0];
        const centerLat = shimState.center[1];
        const pitch = shimState.pitch;
        const bearing = shimState.bearing;
        const pr = pitch * DEG;
        const yawR = bearing * DEG;
        const cosLat = Math.cos(centerLat * DEG) || 1e-6;

        const EARTH_CIRC = 40075000;
        const TILE = 512;
        const ctc = transform.cameraToCenterDistance || 1.5;
        const mpp = EARTH_CIRC * cosLat / (TILE * Math.pow(2, shimState.zoom || 18));
        const eyeM = o.eyeM != null
            ? o.eyeM
            : Math.max(0.5, Math.cos(pr) * ctc * mpp);

        // MapLibre elevation — высота точки center над уровнем моря.
        const lookAlt = shimState.elevation != null
            ? shimState.elevation
            : sampleTerrainAt(centerLng, centerLat);

        const look = geoToLocal(centerLng, centerLat, lookAlt);

        // Вид сверху (MapLibre pitch ≈ 0).
        if (pitch <= 5) {
            const pos = geoToLocal(centerLng, centerLat, lookAlt + eyeM);
            camera.position.set(pos.x, pos.y, pos.z);
            camera.up.set(Math.sin(yawR), Math.cos(yawR), 0);
            camera.lookAt(look.x, look.y, look.z);
        } else {
            const groundDist = Math.tan(pr) * eyeM;
            const camLng = centerLng - (Math.sin(yawR) * groundDist) / (M_PER_DEG_LAT * cosLat);
            const camLat = centerLat - (Math.cos(yawR) * groundDist) / M_PER_DEG_LAT;
            const camAlt = lookAlt + eyeM;
            const pos = geoToLocal(camLng, camLat, camAlt);
            camera.position.set(pos.x, pos.y, pos.z);
            camera.up.set(0, 0, 1);
            camera.lookAt(look.x, look.y, look.z);
        }

        if (o.roll) {
            const rollAxis = new window.THREE.Vector3();
            camera.getWorldDirection(rollAxis);
            camera.rotateOnWorldAxis(rollAxis, -o.roll * DEG);
        }

        const h = container ? container.clientHeight : 800;
        transform.height = h;
        const nearZ = Math.max(0.02, h / (cfg.nearClipDivisor || 4000));
        let farZ = 12000;
        if (cfg.clip3dEnabled) {
            const factor = Math.max(0.05, Math.min(1, cfg.clip3dFactor || 0.5));
            farZ = nearZ + (farZ - nearZ) * factor;
        }
        camera.near = transform._near != null ? transform._near : nearZ;
        camera.far = transform._far != null ? transform._far : farZ;
        camera.fov = cfg.fov || 85;
        camera.updateProjectionMatrix();
    }

    function projectLngLat(lng, lat) {
        if (!camera || !container) return { x: 0, y: 0 };
        const h = sampleTerrainAt(lng, lat);
        const p = geoToLocal(lng, lat, h);
        const v = new window.THREE.Vector3(p.x, p.y, p.z);
        v.project(camera);
        const w = container.clientWidth;
        const hgt = container.clientHeight;
        return {
            x: (v.x * 0.5 + 0.5) * w,
            y: (-v.y * 0.5 + 0.5) * hgt
        };
    }

    let mapShim = null;
    const eventListeners = new Map();

    function emitMapEvent(type, payload) {
        const list = eventListeners.get(type);
        if (!list) return;
        for (const fn of list.slice()) {
            try { fn(payload || {}); } catch (e) { console.warn("GeowalkWorld event:", type, e); }
        }
    }

    function onMapEvent(type, fn) {
        if (!eventListeners.has(type)) eventListeners.set(type, []);
        eventListeners.get(type).push(fn);
    }

    function makeGeoJsonSource(spec) {
        let data = (spec && spec.data) || { type: "FeatureCollection", features: [] };
        return {
            type: "geojson",
            _data: data,
            setData(next) { data = next || { type: "FeatureCollection", features: [] }; this._data = data; },
            getData() { return data; }
        };
    }

    function buildMapShim() {
        const layers = {};
        const sources = {};
        mapShim = {
            getCanvas() { return renderer && renderer.domElement; },
            getCenter() {
                return { lng: shimState.center[0], lat: shimState.center[1] };
            },
            getBearing() { return shimState.bearing; },
            getPitch() { return shimState.pitch; },
            getZoom() { return shimState.zoom; },
            jumpTo(opts) { applyJumpTo(opts); },
            project(ll) { return projectLngLat(ll[0], ll[1]); },
            queryTerrainElevation(ll) {
                if (!shimState.terrainOn || !demLoaded) return 0;
                return sampleTerrainAt(ll[0], ll[1]);
            },
            getTerrain() { return shimState.terrainOn ? { source: "terrain-dem" } : null; },
            setTerrain(t) { shimState.terrainOn = !!(t && t.source); },
            getCenterClampedToGround() { return shimState.clampGround; },
            setCenterClampedToGround(v) { shimState.clampGround = !!v; },
            isSourceLoaded(id) { return id === "terrain-dem" ? demLoaded : true; },
            querySourceFeatures(sourceId, opts) {
                const sl = opts && opts.sourceLayer;
                if (!sl) {
                    const all = [];
                    for (const arr of featureCache.values()) all.push(...arr);
                    return all;
                }
                return featureCache.get(sl) ? featureCache.get(sl).slice() : [];
            },
            queryRenderedFeatures() { return []; },
            getSource(id) { return sources[id] || null; },
            addSource(id, spec) {
                if (spec && spec.type === "geojson") sources[id] = makeGeoJsonSource(spec);
                else sources[id] = spec || {};
            },
            getLayer(id) { return layers[id] || null; },
            addLayer(spec) { if (spec && spec.id) layers[spec.id] = spec; },
            removeLayer(id) { delete layers[id]; },
            removeSource(id) { delete sources[id]; },
            getStyle() { return { layers: Object.values(layers) }; },
            setStyle() { /* стиль — через GeowalkWorld.setSky */ },
            setSky() {},
            setLight() {},
            setVerticalFieldOfView(fov) {
                if (camera) { camera.fov = fov; camera.updateProjectionMatrix(); }
            },
            resize() { resize(); },
            transform,
            triggerRepaint() {},
            once(ev, fn) {
                if (ev === "load" || ev === "style.load") {
                    if (ready) setTimeout(fn, 0);
                    else loadListeners.push(fn);
                    return;
                }
                const wrapper = (payload) => {
                    try { fn(payload); } catch (e) { console.warn("GeowalkWorld once:", ev, e); }
                    const list = eventListeners.get(ev);
                    if (list) {
                        const i = list.indexOf(wrapper);
                        if (i >= 0) list.splice(i, 1);
                    }
                };
                onMapEvent(ev, wrapper);
            },
            on(ev, fn) {
                if (ev === "load" || ev === "style.load") {
                    if (ready) setTimeout(fn, 0);
                    else loadListeners.push(fn);
                    return;
                }
                onMapEvent(ev, fn);
            }
        };
        return mapShim;
    }

    function resize() {
        if (!renderer || !camera || !container) return;
        const w = container.clientWidth;
        const h = container.clientHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        transform.height = h;
    }

    function init(options) {
        if (!window.THREE) { console.error("GeowalkWorld: THREE не загружен"); return null; }
        cfg = (options && options.config) || {};
        container = typeof options.container === "string"
            ? document.querySelector(
                options.container[0] === "#" || options.container[0] === "."
                    ? options.container : "#" + options.container)
            : options.container;
        if (!container) return null;

        while (container.firstChild) container.removeChild(container.firstChild);

        scene = new window.THREE.Scene();
        camera = new window.THREE.PerspectiveCamera(cfg.fov || 85, 1, 0.1, 20000);
        renderer = new window.THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        container.appendChild(renderer.domElement);

        scene.add(new window.THREE.AmbientLight(0xffffff, 0.85));
        const sun = new window.THREE.DirectionalLight(0xfff4e0, 1.1);
        sun.position.set(120, -80, 200);
        scene.add(sun);

        terrainGroup = new window.THREE.Group();
        terrainGroup.name = "terrain";
        buildingsGroup = new window.THREE.Group();
        buildingsGroup.name = "buildings";
        scene.add(terrainGroup);
        scene.add(buildingsGroup);

        applySky(cfg.sky);
        resize();
        transform.cameraToCenterDistance = 1.5;

        const c = options.center || [cfg.start.lng, cfg.start.lat];
        setOrigin(c[0], c[1]);
        shimState.bearing = options.bearing != null ? options.bearing : (cfg.startBearing || 0);
        shimState.pitch = options.pitch != null ? options.pitch : 60;
        shimState.zoom = options.zoom != null ? options.zoom : 18;
        shimState.center = c.slice();

        updateTilesAround(c[0], c[1]);
        terrainReady = true;
        buildMapShim();
        applyJumpTo({
            center: c,
            bearing: shimState.bearing,
            pitch: shimState.pitch,
            zoom: shimState.zoom
        });

        setTimeout(fireLoad, 100);
        return window.GeowalkWorld;
    }

    function render() {
        if (!renderer || !scene || !camera) return;
        renderer.render(scene, camera);
    }

    window.GeowalkWorld = {
        init,
        render,
        resize,
        onLoad(fn) {
            if (typeof fn !== "function") return;
            if (ready) fn();
            else loadListeners.push(fn);
        },
        isReady() { return ready; },
        getMapShim() { return mapShim; },
        getScene() { return scene; },
        getCamera() { return camera; },
        getRenderer() { return renderer; },
        geoToLocal,
        setOrigin,
        updateOrigin,
        queryTerrainElevation(lng, lat) { return sampleTerrainAt(lng, lat); },
        project(lng, lat) { return projectLngLat(lng, lat); },
        applyJumpTo,
        setSky: applySky,
        updateTilesAround,
        getTHREE: () => window.THREE
    };
})();
