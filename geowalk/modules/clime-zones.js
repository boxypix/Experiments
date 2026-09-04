// Climate zones from GeoJSON → sky palette lookup by player position.
// GeowalkClimeZones.init({ url: "clime/clime1.geojson" });
// GeowalkClimeZones.getClimeAt(lng, lat) → "ice"|"pine"|"hot"|"peak"|"wet"|"default"
(function () {
    "use strict";

    const VALID_CLIMES = ["ice", "pine", "hot", "peak", "wet"];

    const CLIME_TREE_SPRITE = {
        ice: "clime/t_teee1.png",
        pine: "clime/t_teee2.png",
        hot: "clime/t_teee3.png",
        peak: "clime/t_teee4.png",
        wet: "clime/t_teee5.png",
        default: "clime/t_teee6.png"
    };

    const CLIME_SKY = {
        ice: {
            color: "#061428",
            horizonBlend: 0.32,
            horizonColor: "#1a3d5c",
            horizonFogBlend: 0.48,
            fogColor: "#4a6d8c",
            fogGroundBlend: 1
        },
        pine: {
            color: "#141c28",
            horizonBlend: 0.38,
            horizonColor: "#3d4a5c",
            horizonFogBlend: 0.52,
            fogColor: "#5c6778",
            fogGroundBlend: 1
        },
        hot: {
            color: "#0a4d47",
            horizonBlend: 0.35,
            horizonColor: "#2a9d8f",
            horizonFogBlend: 0.5,
            fogColor: "#6ec4b8",
            fogGroundBlend: 1
        },
        peak: {
            color: "#1e3a8a",
            horizonBlend: 0.48,
            horizonColor: "#7dd3fc",
            horizonFogBlend: 0.55,
            fogColor: "#bae6fd",
            fogGroundBlend: 1
        },
        wet: {
            color: "#3d5a80",
            horizonBlend: 0.4,
            horizonColor: "#e9c46a",
            horizonFogBlend: 0.52,
            fogColor: "#90e0ef",
            fogGroundBlend: 1
        },
        default: {
            color: "#2b6cb0",
            horizonBlend: 0.35,
            horizonColor: "#9fc8ff",
            horizonFogBlend: 0.5,
            fogColor: "#cfe3ff",
            fogGroundBlend: 1
        }
    };

    let zones = [];
    let loaded = false;
    let loadPromise = null;
    let geoUrl = "clime/clime1.geojson";

    function normalizeLng(lng) {
        let x = lng;
        while (x > 180) x -= 360;
        while (x < -180) x += 360;
        return x;
    }

    function pointInRing(lng, lat, ring) {
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const xi = ring[i][0];
            const yi = ring[i][1];
            const xj = ring[j][0];
            const yj = ring[j][1];
            if (((yi > lat) !== (yj > lat)) &&
                (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
        return inside;
    }

    function ringsFromGeometry(geom) {
        if (!geom) return [];
        if (geom.type === "Polygon") {
            return geom.coordinates[0] ? [geom.coordinates[0]] : [];
        }
        if (geom.type === "MultiPolygon") {
            return geom.coordinates.map((poly) => poly[0]).filter(Boolean);
        }
        return [];
    }

    function bboxFromRing(ring) {
        let minLng = Infinity;
        let maxLng = -Infinity;
        let minLat = Infinity;
        let maxLat = -Infinity;
        for (const pt of ring) {
            const lng = pt[0];
            const lat = pt[1];
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
        }
        return { minLng, maxLng, minLat, maxLat };
    }

    function ingestFeature(feature) {
        const clime = feature.properties && feature.properties.clime;
        if (!clime || VALID_CLIMES.indexOf(clime) < 0) return;
        const rings = ringsFromGeometry(feature.geometry);
        for (const ring of rings) {
            if (!ring || ring.length < 3) continue;
            zones.push({
                clime,
                ring,
                bbox: bboxFromRing(ring)
            });
        }
    }

    function ingestGeoJson(data) {
        zones = [];
        if (!data || data.type !== "FeatureCollection" || !Array.isArray(data.features)) return;
        for (const feature of data.features) ingestFeature(feature);
    }

    function loadGeoJson(url) {
        if (loadPromise) return loadPromise;
        loadPromise = Promise.resolve()
            .then(() => fetch(url).then((res) => {
                if (!res.ok) throw new Error("clime geojson " + res.status);
                return res.json();
            }))
            .catch(() => {
                try {
                    const xhr = new XMLHttpRequest();
                    xhr.open("GET", url, false);
                    xhr.send(null);
                    if (xhr.status >= 200 && xhr.status < 300 && xhr.responseText) {
                        return JSON.parse(xhr.responseText);
                    }
                } catch (e) { /* sync load failed */ }
                if (window.GEOWALK_CLIME_GEOJSON) return window.GEOWALK_CLIME_GEOJSON;
                throw new Error("clime geojson unavailable: " + url);
            })
            .then((data) => {
                ingestGeoJson(data);
                loaded = true;
                return zones.length;
            })
            .catch((err) => {
                console.warn("GeowalkClimeZones:", err);
                loaded = false;
                zones = [];
                throw err;
            });
        return loadPromise;
    }

    function pointInZone(lng, lat, zone) {
        const bb = zone.bbox;
        if (lat < bb.minLat || lat > bb.maxLat) return false;
        if (bb.maxLng - bb.minLng >= 360) {
            return pointInRing(lng, lat, zone.ring);
        }
        if (lng < bb.minLng || lng > bb.maxLng) return false;
        return pointInRing(lng, lat, zone.ring);
    }

    function getClimeAt(lng, lat) {
        if (!loaded || !zones.length) return "default";
        const x = normalizeLng(lng);
        let match = null;
        for (const zone of zones) {
            if (pointInZone(x, lat, zone)) match = zone.clime;
        }
        return match || "default";
    }

    function getSkyForClime(clime) {
        const key = VALID_CLIMES.indexOf(clime) >= 0 ? clime : "default";
        const sky = CLIME_SKY[key] || CLIME_SKY.default;
        return Object.assign({}, sky);
    }

    function getTreeSpriteForClime(clime) {
        const key = VALID_CLIMES.indexOf(clime) >= 0 ? clime : "default";
        return CLIME_TREE_SPRITE[key] || CLIME_TREE_SPRITE.default;
    }

    window.GeowalkClimeZones = {
        init(opts) {
            if (opts && opts.url) geoUrl = opts.url;
            return loadGeoJson(geoUrl);
        },
        ready() {
            return loaded;
        },
        getClimeAt,
        getSkyForClime,
        getTreeSpriteForClime,
        getSkyAt(lng, lat) {
            return getSkyForClime(getClimeAt(lng, lat));
        },
        getTreeSpriteAt(lng, lat) {
            return getTreeSpriteForClime(getClimeAt(lng, lat));
        },
        palettes: CLIME_SKY,
        treeSprites: CLIME_TREE_SPRITE
    };
})();
