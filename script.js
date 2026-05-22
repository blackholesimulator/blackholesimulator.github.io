import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const State = {
    mass: 6.5,
    lensing: 1.8,
    diskIntensity: 2.0,
    turbulence: 0.50,
    suction: 2.0,
    stretch: 3.0,
    plungeElapsedTime: 0.0,
    maxPlungeDuration: 60.0,
    isCompleted: false
};

let scene, camera, renderer, controls;
let lensingMesh, diskMesh, particleSystem;
let clock = new THREE.Clock();

const LensingShader = {
    vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldPosition;
        void main() {
            vUv = uv;
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPos.xyz;
            gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
    `,
    fragmentShader: `
        uniform float uMass;
        uniform float uLensingStrength;
        uniform float uTime;
        uniform vec3 cameraPosition;
        varying vec2 vUv;
        varying vec3 vWorldPosition;

        void main() {
            vec3 viewDir = normalize(vWorldPosition - cameraPosition);
            vec3 relPos = vWorldPosition - vec3(0.0);
            float distanceToCenter = length(relPos);
            
            float eventHorizonRadius = uMass * 1.4;

            if (distanceToCenter <= eventHorizonRadius) {
                discard; 
            }

            float deflection = (uLensingStrength * uMass) / (distanceToCenter - eventHorizonRadius);
            float edgeGlow = pow(eventHorizonRadius / distanceToCenter, 4.5);

            vec3 horizonGlow = vec3(0.0, 0.75, 1.0) * edgeGlow * (1.6 + sin(uTime * 2.0) * 0.25);
            gl_FragColor = vec4(horizonGlow, clamp(edgeGlow + (deflection * 0.12), 0.0, 1.0));
        }
    `
};

const DiskShader = {
    vertexShader: `
        varying vec3 vLocalPosition;
        void main() {
            vLocalPosition = position;
            gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform float uTime;
        uniform float uIntensity;
        uniform float uTurbulence;
        varying vec3 vLocalPosition;

        float noise(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        void main() {
            float r = length(vLocalPosition.xz);
            float angle = atan(vLocalPosition.z, vLocalPosition.x);

            float speed = 2.5 / (r + 0.1);
            float dynamicAngle = angle - (uTime * speed);

            float n = noise(vec2(r * 2.0, dynamicAngle * (1.0 + uTurbulence)));

            float innerEdge = smoothstep(8.0, 11.0, r);
            float outerEdge = smoothstep(30.0, 12.0, r);
            float envelope = innerEdge * outerEdge;

            vec3 hotColor = vec3(1.0, 0.95, 0.8);
            vec3 coolColor = vec3(1.0, 0.28, 0.0);
            vec3 diskColor = mix(hotColor, coolColor, smoothstep(9.0, 20.0, r));

            gl_FragColor = vec4(diskColor * (n * 1.6 + 0.4) * uIntensity, envelope);
        }
    `
};

function init() {
    const container = document.getElementById('webgl-container');

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 3000);
    resetCameraTrajectory();

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 2;
    controls.maxDistance = 200;

    buildStars();
    buildBlackHole();
    buildParticles();

    window.addEventListener('resize', onWindowResize);
    setupUIEvents();

    animate();
}

function resetCameraTrajectory() {
    camera.position.set(0, 35, 110);
    State.plungeElapsedTime = 0.0;
    State.isCompleted = false;
    document.getElementById('singularity-overlay').classList.remove('active');
    document.getElementById('trajectory-status').innerText = "DESCENDING REFERENCE FRAME";
    document.getElementById('trajectory-status').style.color = "#00ff66";
}

function buildStars() {
    const starCount = 120000;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount * 3; i += 3) {
        let radius = 400 + Math.random() * 800;
        let theta = Math.random() * Math.PI * 2;
        let phi = Math.acos((Math.random() * 2) - 1);

        positions[i] = radius * Math.sin(phi) * Math.cos(theta);
        positions[i+1] = radius * Math.sin(phi) * Math.sin(theta);
        positions[i+2] = radius * Math.cos(phi);

        let randType = Math.random();
        if(randType > 0.85) {
            colors[i] = 0.75; colors[i+1] = 0.85; colors[i+2] = 1.0; 
        } else if (randType > 0.70) {
            colors[i] = 1.0; colors[i+1] = 0.8; colors[i+2] = 0.6;  
        } else {
            colors[i] = 1.0; colors[i+1] = 1.0; colors[i+2] = 1.0;  
        }
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    
    const mat = new THREE.PointsMaterial({ 
        size: 1.1, 
        vertexColors: true, 
        transparent: true, 
        opacity: 0.95,
        sizeAttenuation: true
    });
    scene.add(new THREE.Points(geo, mat));
}

function buildBlackHole() {
    const lensingGeo = new THREE.SphereGeometry(20.0, 64, 64);
    lensingMesh = new THREE.ShaderMaterial({
        uniforms: {
            uMass: { value: State.mass },
            uLensingStrength: { value: State.lensing },
            uTime: { value: 0.0 }
        },
        vertexShader: LensingShader.vertexShader,
        fragmentShader: LensingShader.fragmentShader,
        transparent: true,
        side: THREE.DoubleSide
    });
    scene.add(new THREE.Mesh(lensingGeo, lensingMesh));

    const diskGeo = new THREE.PlaneGeometry(60, 60);
    diskGeo.rotateX(-Math.PI / 2);
    diskMesh = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0.0 },
            uIntensity: { value: State.diskIntensity },
            uTurbulence: { value: State.turbulence }
        },
        vertexShader: DiskShader.vertexShader,
        fragmentShader: DiskShader.fragmentShader,
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false
    });
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

        metrics[i*3] = r;
        metrics[i*3+1] = theta;
        metrics[i*3+2] = Math.sqrt(1.0 / r) * 2.2; 
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aMetrics', new THREE.BufferAttribute(metrics, 3));

    particleSystem = new THREE.Points(geo, new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0.0 },
            uSuction: { value: State.suction },
            uStretch: { value: State.stretch },
            uMass: { value: State.mass }
        },
        vertexShader: `
            uniform float uTime;
            uniform float uSuction;
            uniform float uStretch;
            uniform float uMass;
            attribute vec3 aMetrics;
            varying float vStretch;

            void main() {
                vec3 pos = position;
                float radius = aMetrics.x;
                float initialAngle = aMetrics.y;
                float speed = aMetrics.z;

                float currentAngle = initialAngle - (uTime * speed * 0.8);
                float dynamicRadius = radius - mod(uTime * uSuction * 0.5, radius - (uMass * 0.4));
                
                if(dynamicRadius < (uMass * 0.4)) {
                    dynamicRadius = 30.0; 
                }

                pos.x = dynamicRadius * cos(currentAngle);
                pos.z = dynamicRadius * sin(currentAngle);

                vStretch = (1.0 / (dynamicRadius - (uMass * 0.3))) * uStretch;

                vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                gl_PointSize = (2.5 * (300.0 / -mvPosition.z)) * clamp(vStretch * 0.4, 1.0, 5.0);
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            varying float vStretch;
            void main() {
                vec2 c = gl_PointCoord - vec2(0.5);
                if(length(c) > 0.5) discard;
                vec3 col = mix(vec3(1.0, 0.35, 0.0), vec3(1.0, 0.95, 0.8), vStretch * 0.2);
                gl_FragColor = vec4(col, smoothstep(0.5, 0.1, length(c)) * 0.75);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    }));

    scene.add(particleSystem);
}

function setupUIEvents() {
    const handleInput = (id, stateKey, uniformMaterial, uniformKey, suffix = '') => {
        document.getElementById(id).addEventListener('input', (e) => {
            if (State.isCompleted) return;
            const val = parseFloat(e.target.value);
            State[stateKey] = val;
            document.getElementById('v-' + id.substring(6)).innerText = val.toFixed(2) + suffix;
            if(uniformMaterial && uniformMaterial.uniforms[uniformKey]) {
                uniformMaterial.uniforms[uniformKey].value = val;
            }
            if(id === 'param-mass') {
                particleSystem.material.uniforms.uMass.value = val;
            }
        });
    };

    handleInput('param-mass', 'mass', lensingMesh, 'uMass', 'M');
    handleInput('param-lensing', 'lensing', lensingMesh, 'uLensingStrength', 'x');
    handleInput('param-disk-int', 'diskIntensity', diskMesh, 'uIntensity');
    handleInput('param-turbulence', 'turbulence', diskMesh, 'uTurbulence');

    document.getElementById('param-suction').addEventListener('input', (e) => {
        particleSystem.material.uniforms.uSuction.value = parseFloat(e.target.value);
        document.getElementById('v-suction').innerText = parseFloat(e.target.value).toFixed(1);
    });
    document.getElementById('param-stretch').addEventListener('input', (e) => {
        particleSystem.material.uniforms.uStretch.value = parseFloat(e.target.value);
        document.getElementById('v-stretch').innerText = parseFloat(e.target.value).toFixed(1);
    });

    document.getElementById('btn-quantum').addEventListener('click', () => {
        setPreset(9.5, 2.5, 3.5, 0.9, 4.5, 5.0);
    });
    document.getElementById('btn-schwarz').addEventListener('click', () => {
        setPreset(5.0, 1.0, 1.5, 0.3, 1.5, 2.0);
    });

    document.getElementById('btn-restart-sequence').addEventListener('click', () => {
        resetCameraTrajectory();
    });
}

function setPreset(mass, lens, int, turb, suc, str) {
    const updateField = (id, val) => {
        const el = document.getElementById(id);
        el.value = val;
        el.dispatchEvent(new Event('input'));
    };
    updateField('param-mass', mass);
    updateField('param-lensing', lens);
    updateField('param-disk-int', int);
    updateField('param-turbulence', turb);
    updateField('param-suction', suc);
    updateField('param-stretch', str);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();
    const delta = clock.getElapsedTime();

    lensingMesh.uniforms.uTime.value = delta;
    diskMesh.uniforms.uTime.value = delta;
    particleSystem.material.uniforms.uTime.value = delta;

    if (!State.isCompleted) {
        State.plungeElapsedTime += dt;
        let timeLeft = Math.max(0.0, State.maxPlungeDuration - State.plungeElapsedTime);
        document.getElementById('plunge-timer').innerText = timeLeft.toFixed(1) + 's';

        let progress = Math.min(1.0, State.plungeElapsedTime / State.maxPlungeDuration);
        let curve = Math.pow(progress, 3.5); 

        let startingZ = 110.0;
        let endingZ = 12.0; 
        let currentZ = startingZ - (startingZ - endingZ) * curve;
        
        let currentY = 35.0 * (1.0 - curve * 0.95); 
        
        camera.position.set(0, currentY, currentZ);
        controls.target.set(0, 0, 0);

        camera.fov = 65.0 + (curve * 55.0);
        camera.updateProjectionMatrix();

        if (progress >= 0.75) {
            document.getElementById('trajectory-status').innerText = "INNER HORIZON APPROACH";
            document.getElementById('trajectory-status').style.color = "#ff3333";
        }

        if (progress >= 1.0) {
            State.isCompleted = true;
            document.getElementById('singularity-overlay').classList.add('active');
        }
    }

    controls.update();
    renderer.render(scene, camera);
}

window.onload = init;
