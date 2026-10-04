import {
  DoubleSide, LoadingManager, Material, Mesh, MeshStandardMaterial,
  Object3D, Points, PointsMaterial,
} from 'three';
import type { MaterialInfo } from 'three/examples/jsm/loaders/MTLLoader.js';
import { TGALoader } from 'three/examples/jsm/loaders/TGALoader.js';
import { ModelDisposer } from './modelDisposal';
import { checkModelSignal, fetchModelData, ModelError, resolveModelResource, validate3MF, validateGLTF, validatePLY } from './modelResources';

let resourceGeneration = 0;
export { disposeModel } from './modelDisposal';

export class ModelLoadScope {
  readonly manager = new LoadingManager();
  readonly roots = new Set<Object3D>();
  readonly materials = new Set<Material>();
  private readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  private readonly disposer = new ModelDisposer();
  private readonly urls = new Set<string>();
  private readonly resources = new Set<string>();
  private readonly generation = ++resourceGeneration;
  private disposed = false;
  private pending = 0;
  private waiters: Array<() => void> = [];
  private fatalError?: ModelError;
  resourceWarning = false;

  constructor(readonly base: string, private readonly parentSignal: AbortSignal, onChange: () => void) {
    this.manager.setURLModifier(url => {
      checkModelSignal(this.signal);
      let resolved: string;
      try { resolved = resolveModelResource(url, base); }
      catch (error) {
        if (!(error instanceof ModelError) || error.code !== 'resource') {
          if (error instanceof ModelError) this.fatalError = error;
          throw error;
        }
        this.resourceWarning = true;
        // Fail this resource locally; missing textures should not hide geometry.
        return 'data:application/octet-stream;base64,';
      }
      if (resolved.startsWith('blob:')) this.urls.add(resolved);
      this.resources.add(resolved);
      if (this.resources.size > 256) {
        this.fatalError = new ModelError('large');
        throw this.fatalError;
      }
      if (/^(data|blob):/.test(resolved)) return resolved;
      const versioned = new URL(resolved);
      // Three's FileLoader coalesces URLs globally, even across loading managers.
      // A cancelled preview must not abort a subsequent preview of the same file.
      versioned.searchParams.set('preview', String(this.generation));
      return versioned.href;
    });
    const start = this.manager.itemStart.bind(this.manager);
    const end = this.manager.itemEnd.bind(this.manager);
    this.manager.itemStart = url => { this.pending++; start(url); };
    this.manager.itemEnd = url => {
      end(url);
      this.pending--;
      if (this.pending === 0) this.waiters.splice(0).forEach(resolve => resolve());
      if (this.disposed) this.disposer.closeImages(this.pending === 0);
      else onChange();
    };
    this.manager.onError = () => { this.resourceWarning = true; };
    this.manager.addHandler(/\.tga(?:\?.*)?$/i, new TGALoader(this.manager));
    parentSignal.addEventListener('abort', this.dispose, { once: true });
    if (parentSignal.aborted) this.dispose();
  }

  async ready(): Promise<void> {
    checkModelSignal(this.signal);
    if (this.fatalError) throw this.fatalError;
    if (!this.pending) return;
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(this.signal.reason);
      this.signal.addEventListener('abort', abort, { once: true });
      this.waiters.push(() => { this.signal.removeEventListener('abort', abort); resolve(); });
    });
    checkModelSignal(this.signal);
    if (this.fatalError) throw this.fatalError;
  }

  // FBX's synchronous parser also creates URLs for unused embedded images.
  // Capture only this synchronous call, never across an await, and restore even
  // when parsing fails. All captured URLs are released with this preview.
  parseEmbedded<T>(parse: () => T): T {
    const create = URL.createObjectURL;
    URL.createObjectURL = blob => {
      const url = create.call(URL, blob);
      this.urls.add(url);
      return url;
    };
    try { return parse(); } finally { URL.createObjectURL = create; }
  }

  track(root: Object3D): Object3D {
    if (this.disposed) {
      this.disposer.dispose([root]);
      this.disposer.closeImages(this.pending === 0);
    } else this.roots.add(root);
    return root;
  }

  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    this.parentSignal.removeEventListener('abort', this.dispose);
    this.controller.abort(this.parentSignal.reason);
    this.manager.abortController.abort();
    this.waiters.splice(0).forEach(resolve => resolve());
    this.disposer.dispose(this.roots, this.materials);
    this.disposer.closeImages(this.pending === 0);
    this.roots.clear();
    this.materials.clear();
    this.resources.clear();
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls.clear();
  };
}

export async function loadModel(data: ArrayBuffer, format: string, scope: ModelLoadScope): Promise<Object3D> {
  const { manager, base, signal } = scope;
  checkModelSignal(signal);
  format = format.toLowerCase();
  switch (format) {
    case '.glb':
    case '.gltf': {
      validateGLTF(data, format === '.glb');
      const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
        import('three/examples/jsm/loaders/GLTFLoader.js'),
        import('three/examples/jsm/libs/meshopt_decoder.module.js'),
      ]);
      checkModelSignal(signal);
      const result = await new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder).parseAsync(data, base);
      result.scenes.forEach(scene => scope.track(scene));
      return result.scene;
    }
    case '.obj': {
      const [{ OBJLoader }, { MTLLoader }] = await Promise.all([
        import('three/examples/jsm/loaders/OBJLoader.js'), import('three/examples/jsm/loaders/MTLLoader.js'),
      ]);
      checkModelSignal(signal);
      const text = new TextDecoder().decode(data);
      const loader = new OBJLoader(manager);
      const materialInfo: Record<string, MaterialInfo> = {};
      const libraries = new Set([...text.matchAll(/^\s*mtllib\s+(.+?)\s*$/gm)].map(match => match[1]));
      if (libraries.size > 32) throw new ModelError('large');
      for (const library of libraries) {
        try {
          const resource = resolveModelResource(library, base);
          const bytes = await fetchModelData(resource, signal);
          checkModelSignal(signal);
          const materials = new MTLLoader(manager).parse(new TextDecoder().decode(bytes), new URL('.', resource).href);
          Object.assign(materialInfo, materials.materialsInfo);
          // Resolve texture names against each MTL's own directory before merging.
          for (const info of Object.values(materials.materialsInfo)) {
            for (const key of ['map_kd', 'map_ks', 'map_ke', 'map_bump', 'bump', 'norm', 'disp', 'map_d'] as const) {
              const value = info[key];
              if (typeof value === 'string') {
                // MaterialCreator handles map options; retain them before the URI.
                const params = materials.getTextureParams(value, {});
                info[key] = value.replace(params.url, new URL(params.url, new URL('.', resource)).href);
              }
            }
          }
        } catch (error) {
          checkModelSignal(signal);
          if (error instanceof ModelError && error.code === 'large') throw error;
          scope.resourceWarning = true;
        }
      }
      if (Object.keys(materialInfo).length) {
        const materials = new MTLLoader(manager).parse('', '');
        materials.setManager(manager);
        materials.setMaterials(materialInfo);
        loader.setMaterials(materials);
        // OBJ only creates materials actually used in the model.
        const object = scope.track(loader.parse(text));
        Object.values(materials.materials).forEach(material => scope.materials.add(material));
        return object;
      }
      return scope.track(loader.parse(text));
    }
    case '.stl':
    case '.ply': {
      if (format === '.ply') validatePLY(data);
      const loader = format === '.stl'
        ? new (await import('three/examples/jsm/loaders/STLLoader.js')).STLLoader()
        : new (await import('three/examples/jsm/loaders/PLYLoader.js')).PLYLoader();
      checkModelSignal(signal);
      const geometry = loader.parse(data);
      const colors = !!geometry.getAttribute('color');
      if (format === '.ply' && !geometry.index) {
        geometry.computeBoundingSphere();
        return scope.track(new Points(geometry, new PointsMaterial({ color: colors ? 0xffffff : 0x78aeae, vertexColors: colors, size: Math.max(geometry.boundingSphere?.radius ?? 1, 1e-6) / 180 })));
      }
      if (format === '.stl' || !geometry.getAttribute('normal')) geometry.computeVertexNormals();
      return scope.track(new Mesh(geometry, new MeshStandardMaterial({ color: colors ? 0xffffff : 0x8eafb4, vertexColors: colors, side: DoubleSide, roughness: 0.65, metalness: 0.1 })));
    }
    case '.fbx': {
      const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
      checkModelSignal(signal);
      return scope.track(scope.parseEmbedded(() => new FBXLoader(manager).parse(data, base)));
    }
    case '.3mf': {
      validate3MF(data);
      const { ThreeMFLoader } = await import('three/examples/jsm/loaders/3MFLoader.js');
      checkModelSignal(signal);
      const object = scope.track(scope.parseEmbedded(() => new ThreeMFLoader(manager).parse(data)));
      object.rotateX(-Math.PI / 2);
      return object;
    }
    default: throw new ModelError('unsupported');
  }
}
