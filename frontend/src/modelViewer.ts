import {
  ACESFilmicToneMapping, Box3, BufferGeometry, DirectionalLight, Group, HemisphereLight,
  Material, Mesh, Object3D, PerspectiveCamera, PMREMGenerator, Scene, Sphere, Texture, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { loadModel, ModelLoadScope } from './modelLoaders';
import { checkModelSignal, fetchModelData, maxModelGeometryBytes, ModelError } from './modelResources';

export function inspectModel(root: Object3D): { bounds: Sphere; needsEnvironment: boolean } {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const buffers = new Set<ArrayBufferLike>();
  const textures = new Set<Texture>();
  let bytes = 0;
  let vertices = 0;
  let texturePixels = 0;
  let objects = 0;
  let needsEnvironment = false;
  root.traverse(node => {
    if (++objects > 10000) throw new ModelError('large');
    const material = (node as Mesh).material;
    for (const item of Array.isArray(material) ? material : material ? [material] : []) {
      if (materials.has(item)) continue;
      materials.add(item);
      // Match the material families supported by Three's scene.environment.
      const lit = item as Material & { isMeshStandardMaterial?: boolean; isMeshLambertMaterial?: boolean; isMeshPhongMaterial?: boolean; envMap?: Texture | null };
      if (!lit.envMap && (lit.isMeshStandardMaterial || lit.isMeshLambertMaterial || lit.isMeshPhongMaterial)) needsEnvironment = true;
      for (const value of Object.values(item)) if (value?.isTexture && !textures.has(value)) {
        textures.add(value);
        const image = value.image;
        if (image?.width && image?.height) texturePixels += image.width * image.height;
      }
    }
    const geometry = (node as Mesh).geometry;
    if (!geometry || geometries.has(geometry)) return;
    geometries.add(geometry);
    vertices += geometry.getAttribute('position')?.count ?? 0;
    const countBuffer = (attribute: { array: { buffer: ArrayBufferLike } }) => {
      const buffer = attribute.array.buffer;
      if (!buffers.has(buffer)) { buffers.add(buffer); bytes += buffer.byteLength; }
    };
    for (const attribute of Object.values(geometry.attributes)) countBuffer(attribute);
    for (const attributes of Object.values(geometry.morphAttributes)) for (const attribute of attributes) countBuffer(attribute);
    if (geometry.index) countBuffer(geometry.index);
  });
  if (bytes > maxModelGeometryBytes || vertices > 5_000_000 || texturePixels > 32 * 1024 * 1024) throw new ModelError('large');
  if (!vertices) throw new ModelError('empty');
  root.updateMatrixWorld(true);
  const sphere = new Box3().setFromObject(root).getBoundingSphere(new Sphere());
  if (![sphere.radius, ...sphere.center.toArray()].every(Number.isFinite)) throw new ModelError('invalid');
  // A point cloud may consist of a single point.
  if (sphere.radius <= 0) sphere.radius = 1;
  return { bounds: sphere, needsEnvironment };
}

export function modelBounds(root: Object3D): Sphere { return inspectModel(root).bounds; }

// Only the camera moves in a static preview. Updating world transforms once
// avoids recomputing every model node's matrix on every orbit/pan/zoom frame.
export function freezeModelScene(scene: Scene): void {
  scene.updateMatrixWorld(true);
  scene.matrixWorldAutoUpdate = false;
}

export function fitModelDistance(aspect: number, verticalFov = 45): number {
  const vertical = verticalFov * Math.PI / 360;
  const horizontal = Math.atan(Math.tan(vertical) * Math.max(aspect, 0.01));
  return 1.15 / Math.sin(Math.min(vertical, horizontal));
}

export function createModelViewer(host: HTMLElement, url: string, format: string, signal: AbortSignal, callbacks: {
  progress: (fraction: number) => void;
  contextLost: () => void;
}) {
  checkModelSignal(signal);
  let renderer: WebGLRenderer;
  try { renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' }); }
  catch { throw new ModelError('webgl'); }
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.setClearAlpha(0);
  const canvas = renderer.domElement;
  host.appendChild(canvas);
  const scene = new Scene();
  const camera = new PerspectiveCamera(45, 1, 0.001, 250);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.minDistance = 0.025;
  controls.maxDistance = 150;
  controls.maxTargetRadius = 50;
  controls.screenSpacePanning = true;
  controls.cursorStyle = 'grab';
  scene.add(new HemisphereLight(0xffffff, 0x5b6872, 2));
  const light = new DirectionalLight(0xffffff, 3);
  light.position.set(4, 6, 5);
  scene.add(light);
  let disposed = false;
  let frame = 0;
  let fitted = false;
  let manipulated = false;
  let lastWidth = 0;
  let lastHeight = 0;
  let lastPixelRatio = 0;
  let environment: ReturnType<PMREMGenerator['fromScene']> | undefined;
  const invalidate = () => {
    if (disposed || !fitted || frame || document.hidden) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!disposed && !document.hidden && host.clientWidth && host.clientHeight) renderer.render(scene, camera);
    });
  };
  const scope = new ModelLoadScope(new URL('.', new URL(url, window.location.href)).href, signal, invalidate);
  const fit = () => {
    if (!fitted || disposed) return;
    controls.target.set(0, 0, 0);
    camera.position.copy(new Vector3(1, 0.65, 1).normalize().multiplyScalar(fitModelDistance(camera.aspect)));
    camera.near = 0.001;
    camera.far = Math.max(250, camera.position.length() * 4);
    camera.updateProjectionMatrix();
    controls.update();
    manipulated = false;
    invalidate();
  };
  const resize = () => {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height || disposed) return;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2, 4096 / Math.max(width, height));
    if (width === lastWidth && height === lastHeight && pixelRatio === lastPixelRatio) return;
    lastWidth = width; lastHeight = height; lastPixelRatio = pixelRatio;
    renderer.setDrawingBufferSize(width, height, pixelRatio);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (!manipulated) fit();
    invalidate();
  };
  const observer = new ResizeObserver(resize);
  const onStart = () => { manipulated = true; };
  const onContextLost = (event: Event) => {
    event.preventDefault();
    if (!disposed) callbacks.contextLost();
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener('abort', dispose);
    observer.disconnect();
    window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', invalidate);
    canvas.removeEventListener('webglcontextlost', onContextLost);
    controls.removeEventListener('change', invalidate);
    controls.removeEventListener('start', onStart);
    controls.dispose();
    if (frame) cancelAnimationFrame(frame);
    scope.dispose();
    environment?.dispose();
    environment = undefined;
    scene.environment = null;
    scene.clear();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  };
  signal.addEventListener('abort', dispose, { once: true });
  observer.observe(host);
  window.addEventListener('resize', resize);
  controls.addEventListener('change', invalidate);
  controls.addEventListener('start', onStart);
  canvas.addEventListener('webglcontextlost', onContextLost);
  document.addEventListener('visibilitychange', invalidate);
  resize();

  const ready = (async () => {
    try {
      const data = await fetchModelData(scope.manager.resolveURL(new URL(url, window.location.href).href), scope.signal, callbacks.progress);
      const object = await loadModel(data, format, scope);
      checkModelSignal(scope.signal);
      await scope.ready();
      checkModelSignal(scope.signal);
      const { bounds, needsEnvironment } = inspectModel(object);
      const scale = new Group();
      const center = new Group();
      scale.scale.setScalar(1 / bounds.radius);
      center.position.copy(bounds.center).negate();
      center.add(object);
      scale.add(center);
      scene.add(scale);
      if (needsEnvironment) {
        const generator = new PMREMGenerator(renderer);
        const room = new RoomEnvironment();
        try { environment = generator.fromScene(room, 0.04, 0.1, 100, { size: 128 }); }
        finally { room.dispose(); generator.dispose(); }
        scene.environment = environment.texture;
      }
      freezeModelScene(scene);
      fitted = true;
      fit();
      return { resourceWarning: scope.resourceWarning };
    } catch (error) {
      dispose();
      throw error;
    }
  })();
  return { ready, fit, dispose };
}
