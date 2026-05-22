import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const State = { mass: 6.5, lensing: 1.8, diskIntensity: 2.0, turbulence: 0.50, suction: 2.0, stretch: 3.0, plungeElapsedTime: 0.0, maxPlungeDuration: 60.0, isCompleted: false };
let scene, camera, renderer, controls, lensingMesh, diskMesh, particleSystem;
let clock = new THREE.Clock();

const LensingShader = {
    vertexShader: `varying vec2 vUv; varying vec3 vWorldPosition; void main() { vUv = uv; vec4 worldPos = modelMatrix * vec4(position, 1.0); vWorldPosition = worldPos.xyz; gl_Position = projectionMatrix * viewMatrix * worldPos; }`,
    fragmentShader: `uniform float uMass; uniform float uLensingStrength; uniform float uTime; uniform vec3 cameraPosition; varying vec2 vUv; varying vec3 vWorldPosition; void main() { vec3 relPos = vWorldPosition - vec3(0.0); float distanceToCenter = length(relPos); float eventHorizonRadius = uMass * 1.4; if (distanceToCenter <= eventHorizonRadius) discard; float deflection = (uLensingStrength * uMass) / (distanceToCenter - eventHorizonRadius); float edgeGlow = pow(eventHorizonRadius / distanceToCenter, 4.5); vec3 horizonGlow = vec3(0.0, 0.75, 1.0) * edgeGlow * (1.6 + sin(uTime * 2.0) * 0.25); gl_FragColor = vec4(horizonGlow, clamp(edgeGlow + (deflection * 0.12), 0.0, 1.0)); }`
};

const DiskShader = {
    vertexShader: `varying vec3 vLocalPosition; void main() { vLocalPosition = position; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uTime; uniform float uIntensity; uniform float uTurbulence; varying vec3 vLocalPosition; float noise(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); } void main() { float r = length(vLocalPosition.xz); float angle = atan(vLocalPosition.z, vLocalPosition.x); float speed = 2.5 / (r + 0.1); float dynamicAngle = angle - (uTime * speed); float n = noise(vec2(r * 2.0, dynamicAngle * (1.0 + uTurbulence))); float innerEdge = smoothstep(8.0, 11.0, r); float outerEdge = smoothstep(30.0, 12.0, r); float envelope = innerEdge * outerEdge; vec3 hotColor = vec3(1.0, 0.95, 0.8); vec3 coolColor = vec3(1.0, 0.28, 0.0); vec3 diskColor = mix(hotColor, coolColor, smoothstep(9.0, 20.0, r)); gl_FragColor = vec4(diskColor * (n * 1.6 + 0.4) * uIntensity, envelope); }`
};

function init() {
    const container = document.getElementById('webgl-container');
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 3000);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    controls = new OrbitControls(camera, renderer.domElement);
    
    resetCameraTrajectory();
    buildBlackHole();
    buildParticles();
    
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    const startBtn = document.getElementById('btn-start');
    const startOverlay = document.getElementById('start-overlay');
    const bgAudio = document.getElementById('audio-bg');
    const clickAudio = document.getElementById('audio-click');

    startBtn.addEventListener('click', () => {
        bgAudio.volume = 0.3;
        bgAudio.play();
        startOverlay.style.opacity = '0';
        setTimeout(() => startOverlay.style.display = 'none', 1000);
        animate();
    });

    document.addEventListener('click', (e) => {
        if(e.target.tagName === 'BUTTON' && e.target.id !== 'btn-start') {
            clickAudio.currentTime = 0;
            clickAudio.play();
        }
    });
}

function resetCameraTrajectory() {
    camera.position.set(0, 35, 115);
    controls.target.set(0, 0, 0);
    State.plungeElapsedTime = 0.0;
    State.isCompleted = false;
    document.getElementById('singularity-overlay').classList.remove('active');
}

function buildBlackHole() {
    const lensingGeo = new THREE.SphereGeometry(20.0, 64, 64);
    lensingMesh = new THREE.ShaderMaterial({ uniforms: { uMass: { value: State.mass }, uLensingStrength: { value: State.lensing }, uTime: { value: 0.0 } }, vertexShader: LensingShader.vertexShader, fragmentShader: LensingShader.fragmentShader, transparent: true, side: THREE.DoubleSide });
    scene.add(new THREE.Mesh(lensingGeo, lensingMesh));
    const diskGeo = new THREE.PlaneGeometry(60, 60);
    diskGeo.rotateX(-Math.PI / 2);
    diskMesh = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0.0 }, uIntensity: { value: State.diskIntensity }, uTurbulence: { value: State.turbulence } }, vertexShader: DiskShader.vertexShader, fragmentShader: DiskShader.fragmentShader, transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false });
    scene.add(new THREE.Mesh(diskGeo, diskMesh));
}

function buildParticles() {
    const count = 9000;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const metrics = new Float32Array(count * 3);
    for(let i=0; i<count; i++) {
        let r = 8.0 + Math.random() * 25.0;
        let theta = Math.random() * Math.PI * 2;
        positions[i*3] = r * Math.cos(theta);
        positions[i*3+1] = (Math.random() - 0.5) * 0.15;
        positions[i*3+2] = r * Math.sin(theta);
        metrics[i*3] = r; metrics[i*3+1] = theta; metrics[i*3+2] = Math.sqrt(1.0 / r) * 2.2;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aMetrics', new THREE.BufferAttribute(metrics, 3));
    particleSystem = new THREE.Points(geo, new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0.0 }, uSuction: { value: State.suction }, uStretch: { value: State.stretch }, uMass: { value: State.mass } }, vertexShader: `uniform float uTime; uniform float uSuction; uniform float uStretch; uniform float uMass; attribute vec3 aMetrics; varying float vStretch; void main() { vec3 pos = position; float r = aMetrics.x; float speed = aMetrics.z; float angle = aMetrics.y - (uTime * speed * 0.8); float dr = r - mod(uTime * uSuction * 0.5, r - (uMass * 0.4)); if(dr < (uMass * 0.4)) dr = 30.0; pos.x = dr * cos(angle); pos.z = dr * sin(angle); vStretch = (1.0 / (dr - (uMass * 0.3))) * uStretch; vec4 mv = modelViewMatrix * vec4(pos, 1.0); gl_PointSize = (2.5 * (300.0 / -mv.z)) * clamp(vStretch * 0.4, 1.0, 5.0); gl_Position = projectionMatrix * mv; }`, fragmentShader: `varying float vStretch; void main() { vec2 c = gl_PointCoord - vec2(0.5); if(length(c) > 0.5) discard; gl_FragColor = vec4(mix(vec3(1.0,0.35,0.0), vec3(1.0,0.95,0.8), vStretch*0.2), 0.75); }`, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    scene.add(particleSystem);
}

function animate() {
    requestAnimationFrame(animate);
    let dt = clock.getDelta();
    let delta = clock.getElapsedTime();
    lensingMesh.uniforms.uTime.value = delta;
    diskMesh.uniforms.uTime.value = delta;
    particleSystem.material.uniforms.uTime.value = delta;
    if (!State.isCompleted) {
        State.plungeElapsedTime += dt;
        let progress = Math.min(1.0, State.plungeElapsedTime / State.maxPlungeDuration);
        document.getElementById('plunge-timer').innerText = (State.maxPlungeDuration - State.plungeElapsedTime).toFixed(1) + 's';
        let targetRadius = 120.0 - (108.0 * Math.pow(progress, 3));
        let spherical = new THREE.Spherical().setFromVector3(camera.position);
        spherical.radius = targetRadius;
        camera.position.setFromSpherical(spherical);
        if (progress >= 1.0) { State.isCompleted = true; document.getElementById('singularity-overlay').classList.add('active'); }
    }
    controls.update();
    renderer.render(scene, camera);
}

window.onload = init;
