// Пользовательская точка сохранения: вертикальный billboard-пин + localStorage.
//
// GeowalkSavePin.init({ src, padSrc, sizeM, padSizeM, baseM, storageKey })
// GeowalkSavePin.setPin({ lng, lat })
// GeowalkSavePin.getPin()
// GeowalkSavePin.tick()
(function () {
    "use strict";

    const DEG = Math.PI / 180;
    const M_PER_DEG_LAT = 111320;
    const DEFAULTS = {
        src: "images/mo_save.png",
        padSrc: "images/mo_save_p.png",
        sizeM: 4,
        padSizeM: 6,
        padLiftM: 0.03,
        baseM: 0.2,
        hideRadiusM: 3,
        storageKey: "geowalk-save-pin"
    };

    let opts = { ...DEFAULTS };
    let pin = null;
    let group = null;
    let pinMesh = null;
    let padMesh = null;
    let texture = null;
    let padTexture = null;
    let textureLoading = false;

    function getT3() { return window.GeowalkThree; }
    function getTHREE() { return window.THREE; }

    function loadFromStorage() {
        pin = null;
        try {
            const raw = localStorage.getItem(opts.storageKey);
            if (!raw) return;
            const data = JSON.parse(raw);
            if (data && data.lng != null && data.lat != null) {
                pin = { lng: data.lng, lat: data.lat };
            }
        } catch (e) { /* ignore corrupt storage */ }
    }

    function saveToStorage() {
        try {
            if (pin) localStorage.setItem(opts.storageKey, JSON.stringify(pin));
            else localStorage.removeItem(opts.storageKey);
        } catch (e) { /* private mode / quota */ }
    }

    function distM(lng1, lat1, lng2, lat2) {
        const cosLat = Math.cos(((lat1 + lat2) / 2) * DEG);
        const dLat = (lat2 - lat1) * M_PER_DEG_LAT;
        const dLng = (lng2 - lng1) * M_PER_DEG_LAT * cosLat;
        return Math.hypot(dLat, dLng);
    }

    function orientVerticalBillboard(mesh, bearingDeg) {
        const b = bearingDeg * DEG;
        // PlaneGeometry лежит в XY; -PI/2 по X ставит плоскость вертикально (высота вдоль +Z).
        mesh.rotation.order = "ZXY";
        mesh.rotation.z = -b;
        mesh.rotation.x = -Math.PI / 2;
        mesh.rotation.y = 0;
    }

    function setPinSpriteOpacity(opacity) {
        if (!pinMesh || !pinMesh.material) return;
        pinMesh.material.opacity = opacity;
        pinMesh.visible = opacity > 0;
    }

    function setPadVisible(visible) {
        if (!padMesh || !padMesh.material) return;
        padMesh.material.opacity = visible ? 1 : 0;
        padMesh.visible = visible;
    }

    function updatePinTransform(playerLng, playerLat) {
        const T = getT3();
        if (!T || !pinMesh || !pin) return;
        const map = T.getMap && T.getMap();
        const bearing = map && map.getBearing ? map.getBearing() : 0;
        const p = T.geoToLocal(pin.lng, pin.lat, opts.baseM);
        group.position.set(p.x, p.y, p.z);
        pinMesh.position.set(0, 0, opts.sizeM * 0.5);
        pinMesh.scale.set(opts.sizeM, opts.sizeM, 1);
        orientVerticalBillboard(pinMesh, bearing);
        if (padMesh) {
            padMesh.position.set(0, 0, opts.padLiftM);
            padMesh.scale.set(opts.padSizeM, opts.padSizeM, 1);
        }
        let pinOpacity = 1;
        if (playerLng != null && playerLat != null) {
            pinOpacity = distM(playerLng, playerLat, pin.lng, pin.lat) <= opts.hideRadiusM ? 0 : 1;
        }
        setPinSpriteOpacity(pinOpacity);
        setPadVisible(true);
    }

    function makeSpriteMaterial(t3, tex) {
        return new t3.MeshBasicMaterial({
            map: tex || null,
            alphaMap: tex || null,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            side: t3.DoubleSide,
            color: 0xffffff
        });
    }

    function buildPinMesh(t3, T) {
        if (group) return;
        group = new t3.Group();
        group.name = "geowalk-save-pin";
        T.add(group);

        pinMesh = new t3.Mesh(new t3.PlaneGeometry(1, 1), makeSpriteMaterial(t3, texture));
        pinMesh.visible = false;
        group.add(pinMesh);

        padMesh = new t3.Mesh(new t3.PlaneGeometry(1, 1), makeSpriteMaterial(t3, padTexture));
        padMesh.visible = false;
        group.add(padMesh);

        if (pin) updatePinTransform();
    }

    function ensurePinMesh() {
        const T = getT3();
        const t3 = getTHREE();
        if (!T || !t3 || !T.isReady()) return;
        if (group) {
            if (pin) updatePinTransform();
            return;
        }
        if (texture && padTexture) {
            buildPinMesh(t3, T);
            return;
        }
        if (textureLoading) return;
        textureLoading = true;
        const loader = new t3.TextureLoader();
        let pending = 2;
        let pinTex = null;
        let groundTex = null;

        function finishLoad() {
            pending -= 1;
            if (pending > 0) return;
            textureLoading = false;
            if (pinTex) {
                pinTex.colorSpace = t3.SRGBColorSpace;
                pinTex.repeat.y = -1;
                pinTex.offset.y = 1;
                texture = pinTex;
            }
            if (groundTex) {
                groundTex.colorSpace = t3.SRGBColorSpace;
                padTexture = groundTex;
            }
            buildPinMesh(t3, T);
        }

        loader.load(opts.src, (tex) => { pinTex = tex; finishLoad(); }, undefined, () => finishLoad());
        loader.load(opts.padSrc, (tex) => { groundTex = tex; finishLoad(); }, undefined, () => finishLoad());
    }

    function onSceneReady() {
        group = null;
        pinMesh = null;
        padMesh = null;
        loadFromStorage();
        ensurePinMesh();
    }

    window.GeowalkSavePin = {
        init(options) {
            opts = Object.assign({}, DEFAULTS, options || {});
            loadFromStorage();
            const T = getT3();
            if (T) T.onReady(onSceneReady);
        },
        setPin(data) {
            if (!data || data.lng == null || data.lat == null) return;
            pin = { lng: data.lng, lat: data.lat };
            saveToStorage();
            ensurePinMesh();
            updatePinTransform(data.lng, data.lat);
        },
        getPin() {
            return pin ? Object.assign({}, pin) : null;
        },
        hasPin() {
            return !!(pin && pin.lng != null && pin.lat != null);
        },
        clearPin() {
            pin = null;
            saveToStorage();
            setPinSpriteOpacity(0);
            setPadVisible(false);
        },
        tick(state) {
            if (!pin) return;
            ensurePinMesh();
            const lng = state && state.lng != null ? state.lng : null;
            const lat = state && state.lat != null ? state.lat : null;
            updatePinTransform(lng, lat);
        }
    };
})();
