// Procedural weather in GeowalkThree: none | rain | snow.
// Volume follows the player; particles drift opposite to world movement (fly-through any direction).
(function () {
    "use strict";

    const MODES = ["none", "rain", "snow"];

    const PRESETS = {
        rain: {
            fallSpeed: 44,
            opacity: 0.52,
            dropSize: 2.1,
            windMps: 2.2,
            windDriftX: 0.12,
            windDriftY: 0.04,
            moveFactor: 1,
            color: 0xc8e6ff,
            transparent: true,
            depthWrite: false,
            volume: {
                color: 0x9098a3,
                density: 1.05,
                scroll: 0.028
            }
        },
        snow: {
            fallSpeed: 5.5,
            opacity: 1,
            dropSize: 4.6,
            windMps: 0.9,
            windDriftX: 0.08,
            windDriftY: 0.03,
            moveFactor: 0.85,
            color: 0xffffff,
            transparent: false,
            depthWrite: true,
            volume: {
                color: 0xffffff,
                density: 0.88,
                scroll: 0.012
            }
        }
    };

    const DEFAULTS = {
        mode: "none",
        intensity: 0.65,
        areaM: 220,
        heightM: 120,
        maxCount: 7000
    };

    const VOLUME_VERT = [
        "varying vec3 vLocalPos;",
        "void main() {",
        "  vLocalPos = position;",
        "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
        "}"
    ].join("\n");

    const VOLUME_FRAG = [
        "uniform vec3 uCamLocal;",
        "uniform vec3 uHalfSize;",
        "uniform vec3 uColor;",
        "uniform float uDensity;",
        "uniform float uTime;",
        "uniform vec2 uWind;",
        "varying vec3 vLocalPos;",
        "float hash(vec3 p) {",
        "  p = fract(p * 0.3183099 + vec3(0.17, 0.31, 0.47));",
        "  p *= 17.0;",
        "  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));",
        "}",
        "float noise(vec3 p) {",
        "  vec3 i = floor(p);",
        "  vec3 f = fract(p);",
        "  f = f * f * (3.0 - 2.0 * f);",
        "  return mix(",
        "    mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x),",
        "        mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),",
        "    mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),",
        "        mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);",
        "}",
        "float fbm(vec3 p) {",
        "  float v = 0.0;",
        "  float a = 0.55;",
        "  for (int i = 0; i < 4; i++) {",
        "    v += a * noise(p);",
        "    p = p * 2.03 + vec3(1.7, 2.3, 0.9);",
        "    a *= 0.5;",
        "  }",
        "  return v;",
        "}",
        "vec2 boxIntersect(vec3 ro, vec3 rd, vec3 halfSize) {",
        "  vec3 inv = 1.0 / rd;",
        "  vec3 t0 = (-halfSize - ro) * inv;",
        "  vec3 t1 = (halfSize - ro) * inv;",
        "  vec3 tmin = min(t0, t1);",
        "  vec3 tmax = max(t0, t1);",
        "  return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));",
        "}",
        "void main() {",
        "  vec3 ro = uCamLocal;",
        "  vec3 rd = normalize(vLocalPos - ro);",
        "  vec2 hit = boxIntersect(ro, rd, uHalfSize);",
        "  if (hit.x > hit.y || hit.y < 0.0) discard;",
        "  float t0 = max(0.0, hit.x);",
        "  float t1 = hit.y;",
        "  const int STEPS = 32;",
        "  float dt = (t1 - t0) / float(STEPS);",
        "  vec3 pos = ro + rd * t0;",
        "  vec4 acc = vec4(0.0);",
        "  for (int i = 0; i < STEPS; i++) {",
        "    vec3 p = pos * 0.013 + vec3(uWind.x, uWind.y, uTime * 0.04);",
        "    float n = fbm(p);",
        "    vec3 norm = abs(pos) / uHalfSize;",
        "    float edge = 1.0 - smoothstep(0.68, 1.0, max(norm.x, max(norm.y, norm.z)));",
        "    float d = n * edge * uDensity * dt * 0.12;",
        "    acc.rgb += uColor * d * (1.0 - acc.a);",
        "    acc.a += d * (1.0 - acc.a);",
        "    pos += rd * dt;",
        "    if (acc.a > 0.94) break;",
        "  }",
        "  if (acc.a < 0.012) discard;",
        "  gl_FragColor = vec4(acc.rgb, acc.a);",
        "}"
    ].join("\n");

    let cfg = null;
    let map = null;
    let weatherRoot = null;
    let precipPoints = null;
    let precipGeo = null;
    let precipMat = null;
    let precipData = null;
    let volumeMesh = null;
    let volumeMat = null;
    let volumeHalfSize = { x: 0, y: 0, z: 0 };
    let volumeTime = 0;
    let activeMode = "none";
    let readyHook = null;
    let ready = false;
    let playerLng = null;
    let playerLat = null;
    let cameraElevM = 0;
    let velEast = 0;
    let velNorth = 0;
    let smoothVelEast = 0;
    let smoothVelNorth = 0;

    const DEG = Math.PI / 180;

    function t3() { return window.THREE; }
    function three() { return window.GeowalkThree; }

    function normalizeMode(mode) {
        return MODES.indexOf(mode) >= 0 ? mode : "none";
    }

    function currentMode() {
        return cfg ? normalizeMode(cfg.mode) : "none";
    }

    function currentPreset() {
        const mode = currentMode();
        return mode === "none" ? null : PRESETS[mode];
    }

    function intensityScale() {
        const intensity = cfg && cfg.intensity != null ? cfg.intensity : DEFAULTS.intensity;
        return Math.max(0, Math.min(1, intensity));
    }

    function precipActiveNow() {
        return currentMode() !== "none" && effectivePrecipCount() > 0;
    }

    function effectivePrecipCount() {
        const max = cfg && cfg.maxCount != null ? cfg.maxCount : DEFAULTS.maxCount;
        return Math.max(0, Math.round(max * intensityScale()));
    }

    function boundsZ() {
        const heightM = cfg.heightM != null ? cfg.heightM : DEFAULTS.heightM;
        const minZ = Math.max(0, cameraElevM - 12);
        const maxZ = minZ + Math.max(20, heightM);
        return { minZ, maxZ, height: maxZ - minZ };
    }

    function disposeVolume() {
        if (volumeMesh && weatherRoot) weatherRoot.remove(volumeMesh);
        if (volumeMesh && volumeMesh.geometry) volumeMesh.geometry.dispose();
        if (volumeMat) {
            volumeMat.dispose();
            volumeMat = null;
        }
        volumeMesh = null;
        volumeTime = 0;
    }

    function disposePrecip() {
        const GT = three();
        if (weatherRoot && GT) GT.remove(weatherRoot);
        if (precipGeo) {
            precipGeo.dispose();
            precipGeo = null;
        }
        if (precipMat) {
            precipMat.dispose();
            precipMat = null;
        }
        disposeVolume();
        precipPoints = null;
        weatherRoot = null;
        precipData = null;
        activeMode = "none";
        ready = false;
    }

    function seedParticle(data, i, areaM, minZ, maxZ) {
        const span = Math.max(1, maxZ - minZ);
        data.positions[i * 3] = (Math.random() - 0.5) * areaM;
        data.positions[i * 3 + 1] = (Math.random() - 0.5) * areaM;
        data.positions[i * 3 + 2] = minZ + Math.random() * span;
        data.speeds[i] = 0.82 + Math.random() * 0.36;
    }

    function wrapHorizontal(pos, i3, half, areaM) {
        if (pos[i3] < -half) pos[i3] += areaM;
        else if (pos[i3] > half) pos[i3] -= areaM;
    }

    function buildVolumeFog(T, mode, vol, areaM, minZ, maxZ) {
        disposeVolume();
        const height = Math.max(20, maxZ - minZ);
        const hx = areaM * 0.5;
        const hy = areaM * 0.5;
        const hz = height * 0.5;
        volumeHalfSize = { x: hx, y: hy, z: hz };

        const scale = 0.55 + intensityScale() * 0.45;
        volumeMat = new T.ShaderMaterial({
            uniforms: {
                uCamLocal: { value: new T.Vector3() },
                uHalfSize: { value: new T.Vector3(hx, hy, hz) },
                uColor: { value: new T.Color(vol.color) },
                uDensity: { value: vol.density * scale },
                uTime: { value: 0 },
                uWind: { value: new T.Vector2() }
            },
            vertexShader: VOLUME_VERT,
            fragmentShader: VOLUME_FRAG,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            side: T.DoubleSide,
            fog: false
        });

        volumeMesh = new T.Mesh(new T.BoxGeometry(areaM, areaM, height, 1, 1, 1), volumeMat);
        volumeMesh.position.z = minZ + hz;
        volumeMesh.renderOrder = 30;
        volumeMesh.frustumCulled = false;
        weatherRoot.add(volumeMesh);
    }

    function updateVolumePlacement(minZ, maxZ, areaM) {
        if (!volumeMesh || !volumeMat) return;
        const height = Math.max(20, maxZ - minZ);
        const hx = areaM * 0.5;
        const hy = areaM * 0.5;
        const hz = height * 0.5;
        volumeHalfSize = { x: hx, y: hy, z: hz };
        volumeMesh.position.z = minZ + hz;
        const baseH = volumeMesh.geometry.parameters.height || height;
        volumeMesh.scale.set(1, 1, height / baseH);
        volumeMat.uniforms.uHalfSize.value.set(hx, hy, hz);
        const scale = 0.55 + intensityScale() * 0.45;
        const vol = currentPreset().volume;
        volumeMat.uniforms.uDensity.value = vol.density * scale;
    }

    function updateVolumeUniforms(dt) {
        if (!volumeMesh || !volumeMat) return false;
        const GT = three();
        if (!GT || playerLng == null || playerLat == null) return false;

        volumeTime += dt;
        volumeMat.uniforms.uTime.value = volumeTime;

        const scroll = currentPreset().volume.scroll != null ? currentPreset().volume.scroll : 0.02;
        volumeMat.uniforms.uWind.value.set(
            smoothVelEast * scroll * 0.04 + volumeTime * 0.015,
            smoothVelNorth * scroll * 0.04 - volumeTime * 0.008
        );

        const ground = GT.terrainAt(playerLng, playerLat);
        const eyeWorld = GT.geoToLocal(playerLng, playerLat, Math.max(0, cameraElevM - ground));
        volumeMesh.updateMatrixWorld(true);
        volumeMat.uniforms.uCamLocal.value.copy(eyeWorld);
        volumeMesh.worldToLocal(volumeMat.uniforms.uCamLocal.value);
        return true;
    }

    function buildPrecip() {
        const T = t3();
        const GT = three();
        const mode = currentMode();
        const preset = currentPreset();
        if (!T || !GT || !GT.isReady() || !precipActiveNow() || !preset) {
            disposePrecip();
            return;
        }

        disposePrecip();

        const count = effectivePrecipCount();
        const areaM = cfg.areaM != null ? cfg.areaM : DEFAULTS.areaM;
        const b = boundsZ();
        const minZ = b.minZ;
        const maxZ = b.maxZ;

        weatherRoot = new T.Group();
        weatherRoot.name = "geowalk-weather";
        weatherRoot.renderOrder = 40;

        if (preset.volume) buildVolumeFog(T, mode, preset.volume, areaM, minZ, maxZ);

        const positions = new Float32Array(count * 3);
        const speeds = new Float32Array(count);
        precipData = { positions, speeds, minZ, maxZ, areaM, mode };

        for (let i = 0; i < count; i++) seedParticle(precipData, i, areaM, minZ, maxZ);

        precipGeo = new T.BufferGeometry();
        precipGeo.setAttribute("position", new T.BufferAttribute(positions, 3));

        precipMat = new T.PointsMaterial({
            color: preset.color,
            size: preset.dropSize,
            transparent: preset.transparent,
            opacity: preset.opacity,
            depthWrite: preset.depthWrite,
            depthTest: true,
            sizeAttenuation: true,
            fog: false
        });

        precipPoints = new T.Points(precipGeo, precipMat);
        precipPoints.frustumCulled = false;
        precipPoints.renderOrder = 40;
        weatherRoot.add(precipPoints);

        GT.add(weatherRoot);
        activeMode = mode;
        ready = true;
        applyPlacement();
        updateVolumePlacement(minZ, maxZ, areaM);
        updateVolumeUniforms(0);
        if (map) try { map.triggerRepaint(); } catch (e) { /* ok */ }
    }

    function applyPlacement() {
        const GT = three();
        if (!GT || !weatherRoot || playerLng == null || playerLat == null) return;
        const local = GT.geoToLocal(playerLng, playerLat, 0);
        weatherRoot.position.set(local.x, local.y, 0);
    }

    function updatePrecipBounds() {
        if (!precipData) return;
        const areaM = cfg.areaM != null ? cfg.areaM : DEFAULTS.areaM;
        const b = boundsZ();
        precipData.minZ = b.minZ;
        precipData.maxZ = b.maxZ;
        updateVolumePlacement(b.minZ, b.maxZ, areaM);
    }

    function tickPrecip(dt) {
        if (!precipActiveNow() || !precipData || !precipGeo) return false;
        const preset = currentPreset();
        if (!preset) return false;

        updatePrecipBounds();
        const fall = preset.fallSpeed * dt;
        const wind = preset.windMps * dt;
        const moveFactor = preset.moveFactor != null ? preset.moveFactor : 1;
        const velBlend = 1 - Math.exp(-dt / 0.14);
        smoothVelEast += (velEast - smoothVelEast) * velBlend;
        smoothVelNorth += (velNorth - smoothVelNorth) * velBlend;

        const relEast = -smoothVelEast * moveFactor * dt;
        const relNorth = -smoothVelNorth * moveFactor * dt;
        const areaM = precipData.areaM;
        const minZ = precipData.minZ;
        const maxZ = precipData.maxZ;
        const span = Math.max(1, maxZ - minZ);
        const pos = precipData.positions;
        const speeds = precipData.speeds;
        const half = areaM * 0.5;
        const moveSpeed = Math.hypot(smoothVelEast, smoothVelNorth);

        for (let i = 0, n = speeds.length; i < n; i++) {
            const i3 = i * 3;
            pos[i3 + 2] -= fall * speeds[i];
            pos[i3] += wind * preset.windDriftX + relEast;
            pos[i3 + 1] += wind * preset.windDriftY + relNorth;

            wrapHorizontal(pos, i3, half, areaM);
            wrapHorizontal(pos, i3 + 1, half, areaM);

            if (pos[i3 + 2] < minZ) {
                seedParticle(precipData, i, areaM, minZ, maxZ);
                pos[i3 + 2] = maxZ - Math.random() * span * 0.12;
            } else if (pos[i3 + 2] > maxZ) {
                pos[i3 + 2] = minZ + Math.random() * span * 0.08;
            }
        }

        precipGeo.attributes.position.needsUpdate = true;
        updateVolumeUniforms(dt);
        return moveSpeed > 0.4 || fall > 0 || !!volumeMesh;
    }

    function bindHooks() {
        const GT = three();
        if (!GT) return;
        if (!readyHook) {
            readyHook = function () {
                if (precipActiveNow()) buildPrecip();
            };
            GT.onReady(readyHook);
        }
        if (GT.isReady() && precipActiveNow()) buildPrecip();
    }

    function unbindHooks() {
        readyHook = null;
    }

    function applyState(s) {
        if (!s) return;
        if (s.playerLng != null && isFinite(s.playerLng)) playerLng = s.playerLng;
        if (s.playerLat != null && isFinite(s.playerLat)) playerLat = s.playerLat;
        if (s.cameraElevM != null && isFinite(s.cameraElevM)) cameraElevM = s.cameraElevM;
        if (s.velFwd != null || s.velStrafe != null) {
            const yaw = s.playerYaw != null ? s.playerYaw : 0;
            const b = yaw * DEG;
            const sinB = Math.sin(b);
            const cosB = Math.cos(b);
            const fwd = s.velFwd != null ? s.velFwd : 0;
            const strafe = s.velStrafe != null ? s.velStrafe : 0;
            velEast = fwd * sinB + strafe * cosB;
            velNorth = fwd * cosB - strafe * sinB;
        }
    }

    function applyConfig(state) {
        const s = state || {};
        if (!cfg) cfg = Object.assign({}, DEFAULTS);
        const prevMode = currentMode();
        const prevCount = effectivePrecipCount();

        if (s.mode != null) cfg.mode = normalizeMode(s.mode);
        if (s.intensity != null) cfg.intensity = Math.max(0, Math.min(1, +s.intensity || 0));
        if (s.areaM != null) cfg.areaM = Math.max(50, Math.min(800, +s.areaM || DEFAULTS.areaM));
        if (s.heightM != null) cfg.heightM = Math.max(20, Math.min(400, +s.heightM || DEFAULTS.heightM));
        applyState(s);

        const mode = currentMode();
        if (!precipActiveNow()) {
            disposePrecip();
            unbindHooks();
            return { rebuilt: false, active: false };
        }

        bindHooks();
        const modeChanged = mode !== prevMode;
        const countChanged = effectivePrecipCount() !== prevCount;
        const areaChanged = s.areaM != null;
        const intensityChanged = s.intensity != null;
        const heightChanged = s.heightM != null;
        if (modeChanged || countChanged || areaChanged || intensityChanged || heightChanged ||
            !ready || activeMode !== mode) {
            buildPrecip();
            return { rebuilt: true, active: true };
        }
        return { rebuilt: false, active: true };
    }

    window.GeowalkWeatherThree = {
        setup(m, options) {
            if (m) map = m;
            cfg = Object.assign({}, DEFAULTS, options || cfg || {});
            if (options && options.mode != null) cfg.mode = normalizeMode(options.mode);
            applyState(options);
            applyConfig(options);
            if (!precipActiveNow()) unbindHooks();
        },
        sync(state) {
            const result = applyConfig(state);
            if (map) try { map.triggerRepaint(); } catch (e) { /* ok */ }
            return result;
        },
        tick(state) {
            if (!cfg || !precipActiveNow()) return false;
            applyState(state);
            applyPlacement();
            const dt = state && state.dt != null ? state.dt : 0;
            return tickPrecip(dt);
        },
        isActive() {
            return precipActiveNow() && ready;
        },
        getMode() {
            return currentMode();
        },
        teardown() {
            disposePrecip();
            unbindHooks();
            cfg = null;
            map = null;
            playerLng = null;
            playerLat = null;
            cameraElevM = 0;
            velEast = 0;
            velNorth = 0;
            smoothVelEast = 0;
            smoothVelNorth = 0;
        }
    };
})();
