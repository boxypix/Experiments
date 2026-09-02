// RT building shadows in GeowalkThree: directional light + shadow map on a ground receiver.
// Building footprints from vector tiles → extruded shadow casters (invisible to color buffer).
// Low-quality path: BasicShadowMap, frozen map while walking, merged casters, throttled rebuilds.
(function () {
    "use strict";

    const M_PER_DEG_LAT = 111320;
    const DEG = Math.PI / 180;
    const GROUP_NAME = "geowalk-rt-shadows";
    const REBUILD_MOVE_M = 150;
    const REBUILD_MIN_MS = 2000;
    const REBUILD_IDLE_MS = 12000;
    const GROUND_GRID_SEG = 12;
    const GROUND_UPDATE_MOVE_M = 50;
    const LIGHT_SNAP_M = 40;

    let root = null;
    let casterGroup = null;
    let groundMesh = null;
    let sunLight = null;
    let ambientRef = null;
    let cfg = null;
    let playerLng = null;
    let playerLat = null;
    let lastBuildLng = null;
    let lastBuildLat = null;
    let lastBuildAt = 0;
    let lastGroundLng = null;
    let lastGroundLat = null;
    let lastGroundExt = 0;
    let lastLightLng = null;
    let lastLightLat = null;
    let lastMapSize = 0;
    let hooked = false;

    function defaults() {
        return {
            enabled: false,
            wallShade: false,
            groundFx: true,
            lightIntensity: 0.85,
            lightAzimuth: 210,
            lightPolar: 30,
            wallStrength: 0.5,
            wallBand: 1.0,
            shadowAlpha: 0.35,
            heightScale: 1,
            blur: 0,
            aoIntensity: 0.8,
            aoRadiusMin: 30,
            aoRadiusMax: 120,
            mapSize: 256,
            radiusM: 160,
            maxBuildings: 80,
            sourceId: "openmaptiles",
            sourceLayer: "building"
        };
    }

    function mergeCfg(c) {
        const d = defaults();
        if (!c) return d;
        return Object.assign(d, c);
    }

    function sunDir(azDeg, polDeg) {
        const az = azDeg * DEG;
        const pol = Math.max(0.05, polDeg * DEG);
        const cp = Math.cos(pol);
        const THREE = window.THREE;
        return new THREE.Vector3(Math.sin(az) * cp, Math.cos(az) * cp, Math.sin(pol)).normalize();
    }

    function playerMovedM(fromLng, fromLat) {
        if (fromLng == null || playerLng == null) return Infinity;
        const origin = GeowalkThree.getOrigin();
        const cosLat = origin.cosLat || 1;
        const dx = (playerLng - fromLng) * M_PER_DEG_LAT * cosLat;
        const dy = (playerLat - fromLat) * M_PER_DEG_LAT;
        return Math.hypot(dx, dy);
    }

    function markShadowDirty() {
        const renderer = window.GeowalkThree && GeowalkThree.getRenderer();
        if (renderer && renderer.shadowMap) renderer.shadowMap.needsUpdate = true;
        if (sunLight && sunLight.shadow) sunLight.shadow.needsUpdate = true;
    }

    function configureShadowRenderer() {
        const renderer = window.GeowalkThree && GeowalkThree.getRenderer();
        const THREE = window.THREE;
        if (!renderer || !THREE) return;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.BasicShadowMap;
        renderer.shadowMap.autoUpdate = false;
    }

    function ensureRoot() {
        const THREE = window.THREE;
        if (!window.GeowalkThree || !THREE || !GeowalkThree.getScene()) return null;
        const scene = GeowalkThree.getScene();
        if (root && root.parent === scene) {
            configureShadowRenderer();
            return root;
        }

        root = new THREE.Group();
        root.name = GROUP_NAME;

        casterGroup = new THREE.Group();
        casterGroup.name = "rt-shadow-casters";
        root.add(casterGroup);

        const groundMat = new THREE.ShadowMaterial({
            opacity: 0.35,
            transparent: true,
            depthWrite: true,
            depthTest: true,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1
        });
        groundMesh = new THREE.Mesh(new THREE.BufferGeometry(), groundMat);
        groundMesh.name = "rt-shadow-ground";
        groundMesh.receiveShadow = true;
        groundMesh.renderOrder = -1;
        root.add(groundMesh);

        sunLight = new THREE.DirectionalLight(0xffffff, 0.85);
        sunLight.name = "rt-shadow-sun";
        sunLight.castShadow = true;
        sunLight.shadow.autoUpdate = false;
        sunLight.target.name = "rt-shadow-sun-target";
        root.add(sunLight);
        root.add(sunLight.target);

        scene.add(root);

        for (let i = 0; i < scene.children.length; i++) {
            const ch = scene.children[i];
            if (ch.isAmbientLight) { ambientRef = ch; break; }
        }

        configureShadowRenderer();
        lastMapSize = 0;
        lastLightLng = null;
        lastLightLat = null;

        return root;
    }

    let sharedDepthMat = null;

    function casterMaterial() {
        const THREE = window.THREE;
        if (cfg.wallShade) {
            return new THREE.MeshLambertMaterial({
                color: 0x727272,
                transparent: true,
                opacity: Math.min(0.55, 0.15 + (cfg.wallStrength != null ? cfg.wallStrength : 0.5) * 0.35),
                depthWrite: false
            });
        }
        if (!sharedDepthMat) {
            sharedDepthMat = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0,
                depthWrite: false
            });
        }
        return sharedDepthMat;
    }

    function clearCasters() {
        if (!casterGroup) return;
        while (casterGroup.children.length) {
            const m = casterGroup.children[0];
            casterGroup.remove(m);
            if (m.geometry) m.geometry.dispose();
            if (m.material && m.material !== sharedDepthMat) m.material.dispose();
        }
        if (sharedDepthMat) {
            sharedDepthMat.dispose();
            sharedDepthMat = null;
        }
    }

    function mergeCasterGeometries(geoms) {
        const THREE = window.THREE;
        if (!geoms.length) return null;
        if (geoms.length === 1) return geoms[0];

        let vCount = 0;
        let iCount = 0;
        for (let i = 0; i < geoms.length; i++) {
            const g = geoms[i];
            vCount += g.attributes.position.count;
            iCount += g.index ? g.index.count : g.attributes.position.count;
        }

        const pos = new Float32Array(vCount * 3);
        const IndexArray = vCount > 65535 ? Uint32Array : Uint16Array;
        const indices = new IndexArray(iCount);
        let vOff = 0;
        let iOff = 0;
        let vBase = 0;

        for (let gi = 0; gi < geoms.length; gi++) {
            const g = geoms[gi];
            const p = g.attributes.position.array;
            pos.set(p, vOff);
            vOff += p.length;
            if (g.index) {
                const src = g.index.array;
                for (let i = 0; i < src.length; i++) indices[iOff++] = src[i] + vBase;
            } else {
                const n = g.attributes.position.count;
                for (let i = 0; i < n; i++) indices[iOff++] = vBase + i;
            }
            vBase += g.attributes.position.count;
            g.dispose();
        }

        const merged = new THREE.BufferGeometry();
        merged.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        merged.setIndex(new THREE.BufferAttribute(indices, 1));
        if (cfg.wallShade) merged.computeVertexNormals();
        merged.computeBoundingSphere();
        return merged;
    }

    function buildingHeight(props) {
        const raw = props.render_height != null ? props.render_height : props.height;
        return (raw != null && isFinite(+raw)) ? +raw : 12;
    }

    function rebuildCasters() {
        if (!cfg || !cfg.enabled || !casterGroup || playerLng == null) return;
        const map = GeowalkThree.getMap();
        const THREE = window.THREE;
        if (!map || !THREE) return;

        let feats;
        try {
            feats = map.querySourceFeatures(cfg.sourceId, { sourceLayer: cfg.sourceLayer });
        } catch (e) { return; }

        const lng0 = playerLng;
        const lat0 = playerLat;
        const pad = cfg.radiusM / M_PER_DEG_LAT;

        clearCasters();

        let count = 0;
        const maxN = Math.max(20, cfg.maxBuildings | 0);
        const geoms = [];

        for (const f of feats) {
            if (count >= maxN) break;
            const g = f.geometry;
            if (!g) continue;
            const polys = g.type === "Polygon" ? [g.coordinates]
                : g.type === "MultiPolygon" ? g.coordinates : null;
            if (!polys) continue;
            const scale = cfg.heightScale != null ? cfg.heightScale : 1;
            const h = buildingHeight(f.properties || {}) * scale;
            if (h < 0.5) continue;

            for (const poly of polys) {
                if (count >= maxN) break;
                const ring = poly[0];
                if (!ring || ring.length < 4) continue;

                let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
                for (const p of ring) {
                    if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0];
                    if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1];
                }
                if (maxx < lng0 - pad || minx > lng0 + pad || maxy < lat0 - pad || miny > lat0 + pad) continue;

                const cx = (minx + maxx) * 0.5;
                const cy = (miny + maxy) * 0.5;

                const shape = new THREE.Shape();
                for (let i = 0; i < ring.length; i++) {
                    const loc = GeowalkThree.geoToLocal(ring[i][0], ring[i][1], 0);
                    if (i === 0) shape.moveTo(loc.x, loc.y);
                    else shape.lineTo(loc.x, loc.y);
                }

                let baseZ = Infinity;
                for (let ri = 0; ri < ring.length; ri++) {
                    const z = GeowalkThree.terrainAt(ring[ri][0], ring[ri][1]);
                    if (z < baseZ) baseZ = z;
                }
                if (!isFinite(baseZ)) baseZ = GeowalkThree.terrainAt(cx, cy);

                const geo = new THREE.ExtrudeGeometry(shape, {
                    depth: h,
                    bevelEnabled: false,
                    curveSegments: 1
                });
                geo.translate(0, 0, baseZ);
                geoms.push(geo);
                count++;
            }
        }

        const merged = mergeCasterGeometries(geoms);
        if (merged) {
            const mesh = new THREE.Mesh(merged, casterMaterial());
            mesh.castShadow = true;
            mesh.receiveShadow = false;
            mesh.frustumCulled = false;
            casterGroup.add(mesh);
        }

        lastBuildLng = lng0;
        lastBuildLat = lat0;
        lastBuildAt = performance.now();
        markShadowDirty();
    }

    function groundExtentM() {
        const zoom = GeowalkThree.getMap() ? GeowalkThree.getMap().getZoom() : 17;
        const t = Math.min(Math.max((zoom - 15) / 5, 0), 1);
        const minR = cfg.aoRadiusMin != null ? cfg.aoRadiusMin : 30;
        const maxR = cfg.aoRadiusMax != null ? cfg.aoRadiusMax : 120;
        return (minR + t * (maxR - minR)) * 4;
    }

    function lngLatFromLocal(wx, wy) {
        const origin = GeowalkThree.getOrigin();
        if (origin.lng == null) return { lng: playerLng, lat: playerLat };
        const cosLat = origin.cosLat || 1;
        return {
            lng: origin.lng + wx / (M_PER_DEG_LAT * cosLat),
            lat: origin.lat + wy / M_PER_DEG_LAT
        };
    }

    function updateTerrainGroundMesh(ext, center) {
        if (!groundMesh || playerLng == null) return;
        const THREE = window.THREE;
        const size = ext * 2;
        const seg = GROUND_GRID_SEG;
        const centerZ = GeowalkThree.terrainAt(playerLng, playerLat);

        if (groundMesh.geometry) groundMesh.geometry.dispose();
        const geo = new THREE.PlaneGeometry(size, size, seg, seg);
        const pos = geo.attributes.position;
        let minZ = Infinity;
        let maxZ = -Infinity;

        for (let i = 0; i < pos.count; i++) {
            const lx = pos.getX(i);
            const ly = pos.getY(i);
            const wx = center.x + lx;
            const wy = center.y + ly;
            const ll = lngLatFromLocal(wx, wy);
            const z = GeowalkThree.terrainAt(ll.lng, ll.lat);
            if (z < minZ) minZ = z;
            if (z > maxZ) maxZ = z;
            pos.setZ(i, z - centerZ + 0.12);
        }
        pos.needsUpdate = true;
        geo.computeVertexNormals();
        groundMesh.geometry = geo;
        groundMesh.position.set(center.x, center.y, centerZ);
        groundMesh.scale.set(1, 1, 1);
        groundMesh.userData.terrainSpanZ = Math.max(1, maxZ - minZ);
        lastGroundLng = playerLng;
        lastGroundLat = playerLat;
        lastGroundExt = ext;
    }

    function maybeUpdateGroundMesh(ext, center) {
        if (!groundMesh || playerLng == null) return;
        const moved = playerMovedM(lastGroundLng, lastGroundLat);
        const extChanged = Math.abs(ext - lastGroundExt) > 1;
        if (lastGroundLng == null || moved > GROUND_UPDATE_MOVE_M || extChanged) {
            updateTerrainGroundMesh(ext, center);
        }
    }

    function applyMapSize(res) {
        if (!sunLight) return;
        if (lastMapSize === res && sunLight.shadow.mapSize.x === res) return;
        sunLight.shadow.mapSize.set(res, res);
        if (sunLight.shadow.map) {
            sunLight.shadow.map.dispose();
            sunLight.shadow.map = null;
        }
        lastMapSize = res;
        markShadowDirty();
    }

    function updateLightAndShadowCamera(target, ext) {
        const dir = sunDir(cfg.lightAzimuth, cfg.lightPolar);
        const dist = 600;
        sunLight.position.set(
            target.x + dir.x * dist,
            target.y + dir.y * dist,
            target.z + dir.z * dist
        );
        sunLight.target.position.set(target.x, target.y, target.z);

        const camExt = ext + LIGHT_SNAP_M;
        const cam = sunLight.shadow.camera;
        const spanZ = (groundMesh && groundMesh.userData.terrainSpanZ) || 80;
        cam.left = -camExt;
        cam.right = camExt;
        cam.top = camExt;
        cam.bottom = -camExt;
        cam.near = 0.5;
        cam.far = Math.max(900, spanZ + 400 + camExt * 0.5);
        cam.updateProjectionMatrix();

        sunLight.shadow.radius = cfg.blur != null ? cfg.blur : 0;
        sunLight.shadow.bias = -0.0008;
        sunLight.shadow.normalBias = 0.02;
    }

    function applyLightAndShadowSettings() {
        if (!sunLight || !cfg) return;
        const map = GeowalkThree.getMap();
        const zoom = map ? map.getZoom() : 17;

        if (zoom < 14.5) {
            root.visible = false;
            return;
        }
        root.visible = cfg.enabled;

        const target = GeowalkThree.geoToLocal(playerLng, playerLat, 0);
        sunLight.intensity = cfg.lightIntensity != null ? cfg.lightIntensity : 0.85;

        const ext = groundExtentM();
        const res = Math.max(128, Math.min(2048, (cfg.mapSize | 0) || 256));
        applyMapSize(res);

        if (lastLightLng == null || playerMovedM(lastLightLng, lastLightLat) >= LIGHT_SNAP_M) {
            updateLightAndShadowCamera(target, ext);
            lastLightLng = playerLng;
            lastLightLat = playerLat;
            markShadowDirty();
        }

        if (groundMesh) {
            groundMesh.visible = cfg.groundFx !== false;
            const alpha = (cfg.shadowAlpha != null ? cfg.shadowAlpha : 0.35)
                * (cfg.aoIntensity != null ? cfg.aoIntensity : 0.8);
            groundMesh.material.opacity = Math.max(0, Math.min(1, alpha));
            maybeUpdateGroundMesh(ext, target);
        }

        if (ambientRef) {
            ambientRef.intensity = cfg.enabled ? 0.42 : 1;
        }

        casterGroup.visible = true;
    }

    function maybeRebuildCasters() {
        if (!cfg || !cfg.enabled || playerLng == null) return;
        const origin = GeowalkThree.getOrigin();
        if (origin.lng == null) return;
        const moved = playerMovedM(lastBuildLng, lastBuildLat);
        const elapsed = performance.now() - lastBuildAt;
        if (lastBuildLng != null && elapsed < REBUILD_MIN_MS) return;
        if (lastBuildLng == null || moved > REBUILD_MOVE_M || elapsed > REBUILD_IDLE_MS) {
            rebuildCasters();
        }
    }

    function invalidateCaches() {
        lastBuildLng = null;
        lastBuildLat = null;
        lastGroundLng = null;
        lastGroundLat = null;
        lastLightLng = null;
        lastLightLat = null;
    }

    function onBeforeRender() {
        if (!cfg || !cfg.enabled) return;
        if (!ensureRoot()) return;
        applyLightAndShadowSettings();
        maybeRebuildCasters();
    }

    function hook() {
        if (hooked || !window.GeowalkThree) return;
        hooked = true;
        GeowalkThree.onReady(() => {
            ensureRoot();
            applyLightAndShadowSettings();
            if (cfg && cfg.enabled) rebuildCasters();
        });
        GeowalkThree.onBeforeRender(onBeforeRender);
        GeowalkThree.onOriginShift(() => {
            invalidateCaches();
            if (cfg && cfg.enabled) rebuildCasters();
        });
    }

    function disposeRoot() {
        if (!root || !window.GeowalkThree) return;
        const scene = GeowalkThree.getScene();
        if (scene) scene.remove(root);
        clearCasters();
        if (groundMesh && groundMesh.geometry) groundMesh.geometry.dispose();
        if (groundMesh && groundMesh.material) groundMesh.material.dispose();
        root = null;
        casterGroup = null;
        groundMesh = null;
        sunLight = null;
        lastMapSize = 0;
        invalidateCaches();
        if (ambientRef) ambientRef.intensity = 1;
    }

    window.GeowalkRtShadowsThree = {
        hook,
        setPlayer(lng, lat) {
            playerLng = lng;
            playerLat = lat;
        },
        sync(options) {
            cfg = mergeCfg(options);
            hook();
            if (!cfg.enabled) {
                if (root) root.visible = false;
                if (ambientRef) ambientRef.intensity = 1;
                return;
            }
            ensureRoot();
            invalidateCaches();
            applyLightAndShadowSettings();
            rebuildCasters();
        },
        rebuildShadowMap() {
            if (!cfg || !cfg.enabled) return;
            invalidateCaches();
            applyLightAndShadowSettings();
            rebuildCasters();
        },
        onStyleReset() {
            invalidateCaches();
            clearCasters();
        },
        dispose() {
            disposeRoot();
            cfg = mergeCfg(null);
            cfg.enabled = false;
        }
    };
})();
