import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function vendorChunk(id: string): string | undefined {
  if (!id.includes('/node_modules/')) {
    return undefined;
  }
  if (id.includes('/node_modules/three/')) {
    // Load only the selected format's parser; the renderer stays shared.
    if (/\/(GLTFLoader|meshopt_decoder\.module)\.js$/.test(id)) return 'model-gltf';
    if (/\/(OBJLoader|MTLLoader)\.js$/.test(id)) return 'model-obj';
    if (id.endsWith('/STLLoader.js')) return 'model-stl';
    if (id.endsWith('/PLYLoader.js')) return 'model-ply';
    if (id.endsWith('/FBXLoader.js')) return 'model-fbx';
    if (id.endsWith('/3MFLoader.js')) return 'model-3mf';
    if (id.endsWith('/fflate.module.js')) return 'model-compression';
    return 'vendor-3d';
  }
  if (id.includes('/node_modules/@fortawesome/')) {
    return 'vendor-icons';
  }
  if (id.includes('/node_modules/highlight.js/')) {
    return 'vendor-highlight';
  }
  if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) {
    return 'vendor-react';
  }
  return 'vendor-markdown';
}

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          includeDependenciesRecursively: false,
          groups: [{ name: vendorChunk }],
        },
      },
    },
  },
});
