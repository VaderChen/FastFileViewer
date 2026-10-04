import type { BufferGeometry, Material, Mesh, Object3D, Texture } from 'three';

// Weak sets remember resources shared by scenes that finish loading after an
// abort, without retaining their geometry or materials after disposal.
export class ModelDisposer {
  private readonly released = new WeakSet<object>();
  private readonly closedImages = new WeakSet<object>();
  private readonly pendingTextures = new Set<Texture>();

  private release(resource: { dispose(): void }): void {
    if (this.released.has(resource)) return;
    this.released.add(resource);
    resource.dispose();
  }

  dispose(roots: Iterable<Object3D>, extraMaterials: Iterable<Material> = []): void {
    const materials = new Set(extraMaterials);
    for (const root of roots) root.traverse(node => {
      const object = node as Mesh;
      if (object.geometry) this.release(object.geometry as BufferGeometry);
      if (object.material) {
        if (Array.isArray(object.material)) object.material.forEach(material => materials.add(material));
        else materials.add(object.material);
      }
      const skeleton = (node as Object3D & { skeleton?: { dispose(): void } }).skeleton;
      if (skeleton) this.release(skeleton);
    });
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (!value?.isTexture) continue;
        this.pendingTextures.add(value);
        this.release(value);
      }
      this.release(material);
    }
  }

  closeImages(settled: boolean): void {
    // Keep only unresolved texture handles for late callbacks, never entire
    // scene graphs. Completed images can be released while other reads wait.
    for (const texture of this.pendingTextures) {
      let loaded = true;
      for (const image of Array.isArray(texture.image) ? texture.image : [texture.image]) {
        if (!image) { loaded = false; continue; }
        if (typeof image.close !== 'function' || this.closedImages.has(image)) continue;
        this.closedImages.add(image);
        image.close();
      }
      if (loaded || settled) this.pendingTextures.delete(texture);
    }
  }
}

export function disposeModel(roots: Iterable<Object3D>, extraMaterials: Iterable<Material> = []): void {
  const disposer = new ModelDisposer();
  disposer.dispose(roots, extraMaterials);
  disposer.closeImages(true);
}
