// Точки и пыль позади 2D-машины. Живут в сцене GeowalkThree и остаются на земле.
(function () {
    "use strict";

    const M_PER_DEG_LAT = 111320;
    const DEG = Math.PI / 180;
    const POINT_POOL = 140;
    const DUST_POOL = 70;

    const DEFAULTS = {
        enabled: true,
        lifeSec: 4,
        stepM: 1.6,
        points: 2,
        pointSizeM: 0.16,
        pointColor: "#b5b5b5",
        dustSizeM: 0.75,
        dustColor: "#8e8e8e",
        backM: 2.4,
        spreadM: 1.15
    };

    let cfg = Object.assign({}, DEFAULTS);
    let group = null;
    let pointGeo = null;
    let dustGeo = null;
    let pointPool = [];
    let dustPool = [];
    let live = [];
    let distAcc = 0;
    let prevSpeed = 0;

    const SHARP_TURN_DEG = 48;
    const LAUNCH_SPEED_MAX = 9;

    function THREE() { return window.THREE; }
    function GT() { return window.GeowalkThree; }

    function clamp(v, min, max) {
        return Math.max(min, Math.min(max, v));
    }

    function applyConfig(options) {
        const s = options || {};
        if (s.enabled != null) cfg.enabled = s.enabled !== false;
        if (s.lifeSec != null) cfg.lifeSec = clamp(+s.lifeSec || 4, 0.2, 20);
        if (s.stepM != null) cfg.stepM = clamp(+s.stepM || 1.6, 0.3, 20);
        if (s.points != null) cfg.points = clamp(s.points | 0, 0, 8);
        if (s.pointSizeM != null) cfg.pointSizeM = clamp(+s.pointSizeM || 0.16, 0.04, 2);
        if (s.pointColor) cfg.pointColor = s.pointColor;
        if (s.dustSizeM != null) cfg.dustSizeM = clamp(+s.dustSizeM || 0.75, 0.1, 4);
        if (s.dustColor) cfg.dustColor = s.dustColor;
        if (s.backM != null) cfg.backM = clamp(+s.backM || 0, 0, 12);
        if (s.spreadM != null) cfg.spreadM = clamp(+s.spreadM || 0, 0, 8);
        paint("point", cfg.pointColor);
        paint("dust", cfg.dustColor);
    }

    function paint(kind, color) {
        for (let i = 0; i < live.length; i++) {
            const p = live[i];
            if (p.kind === kind && p.mesh.material) p.mesh.material.color.set(color);
        }
    }

    function ensure() {
        const T = GT();
        const three = THREE();
        if (!T || !three || !T.isReady()) return false;
        if (group) return true;
        group = new three.Group();
        group.name = "geowalk-car-dust";
        T.add(group);
        pointGeo = new three.SphereGeometry(1, 5, 4);
        dustGeo = new three.SphereGeometry(1, 7, 5);
        for (let i = 0; i < POINT_POOL; i++) pointPool.push(makeMesh(three, "point"));
        for (let i = 0; i < DUST_POOL; i++) dustPool.push(makeMesh(three, "dust"));
        return true;
    }

    function makeMesh(three, kind) {
        const mat = new three.MeshBasicMaterial({
            color: kind === "point" ? cfg.pointColor : cfg.dustColor,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            depthTest: true,
            polygonOffset: true,
            polygonOffsetFactor: -4,
            polygonOffsetUnits: -4
        });
        const mesh = new three.Mesh(kind === "point" ? pointGeo : dustGeo, mat);
        mesh.visible = false;
        mesh.frustumCulled = false;
        mesh.renderOrder = 2;
        group.add(mesh);
        return mesh;
    }

    function hideParticle(p) {
        p.mesh.visible = false;
        p.mesh.material.opacity = 0;
        if (p.kind === "point") pointPool.push(p.mesh);
        else dustPool.push(p.mesh);
    }

    function clearLive() {
        for (let i = live.length - 1; i >= 0; i--) hideParticle(live[i]);
        live.length = 0;
        distAcc = 0;
        prevSpeed = 0;
    }

    function wantPoints(s, dt, speed) {
        const turn = Math.abs(s.turnRate || 0);
        if (turn >= SHARP_TURN_DEG && speed > 3) return true;
        if (s.braking && speed > 1.2) return true;
        const accel = dt > 0 ? (speed - prevSpeed) / dt : 0;
        return accel > 2 && speed > 0.5 && speed < LAUNCH_SPEED_MAX;
    }

    function spawn(kind, lng, lat, yaw, cosLat) {
        const pool = kind === "point" ? pointPool : dustPool;
        if (!pool.length) return;
        const mesh = pool.pop();
        const b = yaw * DEG;
        const back = cfg.backM + Math.random() * 0.8;
        const side = (Math.random() - 0.5) * cfg.spreadM * 2;
        const east = -Math.sin(b) * back + Math.cos(b) * side;
        const north = -Math.cos(b) * back - Math.sin(b) * side;
        const cos = cosLat != null && isFinite(cosLat) ? cosLat : Math.cos(lat * DEG);
        const pLng = lng + east / (M_PER_DEG_LAT * Math.max(0.2, cos));
        const pLat = lat + north / M_PER_DEG_LAT;
        const kick = kind === "point" ? 1.4 + Math.random() * 1.6 : 0.5 + Math.random() * 0.7;
        const sideVel = (Math.random() - 0.5) * 1.4;
        const size = kind === "point"
            ? cfg.pointSizeM * (0.65 + Math.random() * 0.7)
            : cfg.dustSizeM * (0.75 + Math.random() * 0.55);
        mesh.visible = true;
        mesh.material.color.set(kind === "point" ? cfg.pointColor : cfg.dustColor);
        mesh.material.opacity = kind === "point" ? 0.9 : 0.42;
        mesh.scale.setScalar(size);
        live.push({
            kind,
            mesh,
            lng: pLng,
            lat: pLat,
            z: (kind === "point" ? 0.35 : 0.6) + Math.random() * 0.35,
            ve: -Math.sin(b) * kick + Math.cos(b) * sideVel,
            vn: -Math.cos(b) * kick - Math.sin(b) * sideVel,
            vz: kind === "point" ? 0.8 + Math.random() * 1.1 : 0.35 + Math.random() * 0.45,
            life: 0,
            maxLife: cfg.lifeSec,
            size
        });
    }

    function place(p, T) {
        const local = T.geoToLocal(p.lng, p.lat, p.z);
        p.mesh.position.set(local.x, local.y, local.z);
    }

    function tick(state) {
        const s = state || {};
        const dt = s.dt > 0 ? Math.min(0.05, s.dt) : 0;
        if (!ensure()) return false;
        const T = GT();
        const speed = s.speed > 0 ? s.speed : 0;
        const driving = !!(s.active && cfg.enabled && s.lng != null && speed > 0.4);
        if (driving && dt > 0) {
            const points = wantPoints(s, dt, speed);
            distAcc += speed * dt;
            let bursts = 0;
            while (distAcc >= cfg.stepM && bursts < 6) {
                distAcc -= cfg.stepM;
                bursts++;
                if (points && cfg.points > 0) {
                    for (let i = 0; i < cfg.points; i++) spawn("point", s.lng, s.lat, s.yaw || 0, s.cosLat);
                }
                spawn("dust", s.lng, s.lat, s.yaw || 0, s.cosLat);
            }
        } else if (!s.active) {
            distAcc = 0;
        }
        prevSpeed = speed;

        if (!live.length) return false;
        const life = cfg.lifeSec;
        for (let i = live.length - 1; i >= 0; i--) {
            const p = live[i];
            p.life += dt;
            if (p.life >= p.maxLife || p.life >= life) {
                hideParticle(p);
                live.splice(i, 1);
                continue;
            }
            const cos = Math.max(0.2, Math.cos(p.lat * DEG));
            p.lng += (p.ve * dt) / (M_PER_DEG_LAT * cos);
            p.lat += (p.vn * dt) / M_PER_DEG_LAT;
            p.z += p.vz * dt;
            p.vz -= 6 * dt;
            p.ve *= Math.max(0, 1 - dt * 3.2);
            p.vn *= Math.max(0, 1 - dt * 3.2);
            const restZ = p.kind === "point" ? 0.3 : 0.55;
            if (p.z < restZ && p.vz < 0) {
                p.z = restZ;
                p.vz = 0;
            }
            const u = p.life / p.maxLife;
            const fade = u < 0.72 ? 1 : 1 - (u - 0.72) / 0.28;
            const base = p.kind === "point" ? 0.9 : 0.45;
            p.mesh.material.opacity = Math.max(0, base * fade);
            if (p.kind === "dust") {
                p.mesh.scale.setScalar(p.size * (1 + u * 0.85));
            }
            place(p, T);
        }
        return live.length > 0;
    }

    window.GeowalkCarDust = {
        sync: applyConfig,
        tick,
        clear: clearLive,
        alive() { return live.length; }
    };
})();
