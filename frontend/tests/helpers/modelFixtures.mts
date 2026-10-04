import { zipSync, strToU8 } from 'three/examples/jsm/libs/fflate.module.js';

export function modelFixtures(): Record<string, Uint8Array> {
  const encode = (value: string) => new TextEncoder().encode(value);
  const vertices = [-1,-1,-1, 1,-1,-1, 1,1,-1, -1,1,-1, -1,-1,1, 1,-1,1, 1,1,1, -1,1,1];
  const triangles = [0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,3,7,6,3,6,2,0,4,7,0,7,3,1,2,6,1,6,5];
  const binary = new Uint8Array(232);
  new Float32Array(binary.buffer, 0, 24).set(vertices);
  new Uint16Array(binary.buffer, 96, 36).set(triangles);
  new Float32Array(binary.buffer, 168, 16).set([0,0,1,0,1,1,0,1,0,0,1,0,1,1,0,1]);
  const gltf = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, translation: [200, 500, -100] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 2 }, indices: 1, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.16, 0.65, 0.5, 1], metallicFactor: 0.25, roughnessFactor: 0.5 } }],
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 96 }, { buffer: 0, byteOffset: 96, byteLength: 72 }, { buffer: 0, byteOffset: 168, byteLength: 64 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [-1,-1,-1], max: [1,1,1] }, { bufferView: 1, componentType: 5123, count: 36, type: 'SCALAR' }, { bufferView: 2, componentType: 5126, count: 8, type: 'VEC2' }],
  };
  const rawJSON = encode(JSON.stringify(gltf));
  const json = new Uint8Array(Math.ceil(rawJSON.length / 4) * 4).fill(32);
  json.set(rawJSON);
  const glb = new Uint8Array(12 + 8 + json.length + 8 + binary.length);
  const view = new DataView(glb.buffer);
  [0x46546c67, 2, glb.length, json.length, 0x4e4f534a].forEach((value, index) => view.setUint32(index * 4, value, true));
  glb.set(json, 20);
  view.setUint32(20 + json.length, binary.length, true);
  view.setUint32(24 + json.length, 0x004e4942, true);
  glb.set(binary, 28 + json.length);
  const obj = 'mtllib materials/cube.mtl\n' + vertices.reduce((lines, value, index) => lines + (index % 3 === 0 ? 'v ' : ' ') + value + (index % 3 === 2 ? '\n' : ''), '')
    + 'usemtl green\n' + triangles.reduce((lines, value, index) => lines + (index % 3 === 0 ? 'f ' : ' ') + (value + 1) + (index % 3 === 2 ? '\n' : ''), '');
  const ply = 'ply\nformat ascii 1.0\nelement vertex 8\nproperty float x\nproperty float y\nproperty float z\nelement face 12\nproperty list uchar int vertex_indices\nend_header\n'
    + vertices.reduce((lines, value, index) => lines + value + (index % 3 === 2 ? '\n' : ' '), '')
    + triangles.reduce((lines, value, index) => lines + (index % 3 === 0 ? '3 ' : '') + value + (index % 3 === 2 ? '\n' : ' '), '');
  const stl = new Uint8Array(84 + 12 * 50);
  const stlView = new DataView(stl.buffer);
  stlView.setUint32(80, 12, true);
  for (let face = 0; face < 12; face++) {
    const positions = triangles.slice(face * 3, face * 3 + 3).flatMap(index => vertices.slice(index * 3, index * 3 + 3));
    positions.forEach((value, index) => stlView.setFloat32(84 + face * 50 + 12 + index * 4, value, true));
  }
  const fbx = `; FBX 7.4.0 project file
FBXHeaderExtension:  {
\tFBXHeaderVersion: 1003
\tFBXVersion: 7400
}
Objects:  {
\tGeometry: 1000, "Geometry::Cube", "Mesh" {
\t\tVertices: *24 {
\t\t\ta: ${vertices.join(',')}
\t\t}
\t\tPolygonVertexIndex: *36 {
\t\t\ta: ${triangles.map((value, index) => index % 3 === 2 ? -value - 1 : value).join(',')}
\t\t}
\t}
\tModel: 2000, "Model::Cube", "Mesh" {
\t\tVersion: 232
\t}
}
Connections:  {
\tC: "OO",1000,2000
\tC: "OO",2000,0
}
`;
  const mesh = `<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model"><mesh><vertices>${Array.from({ length: 8 }, (_, i) => `<vertex x="${vertices[i*3]}" y="${vertices[i*3+1]}" z="${vertices[i*3+2]}"/>`).join('')}</vertices><triangles>${Array.from({ length: 12 }, (_, i) => `<triangle v1="${triangles[i*3]}" v2="${triangles[i*3+1]}" v3="${triangles[i*3+2]}"/>`).join('')}</triangles></mesh></object></resources><build><item objectid="1"/></build></model>`;
  const texturedGLTF = { ...gltf, buffers: [{ byteLength: binary.byteLength, uri: 'mesh.bin' }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 } }],
    textures: [{ source: 0 }], images: [{ uri: 'textures/紅色 圖.png' }],
  };
  return {
    'textured.gltf': encode(JSON.stringify(texturedGLTF)),
    'missing.gltf': encode(JSON.stringify({ ...texturedGLTF, images: [{ uri: 'textures/missing.png' }] })),
    'external.gltf': encode(JSON.stringify({ ...texturedGLTF, images: [{ uri: 'https://example.invalid/image.png' }] })),
    'textured.obj': encode(obj.replace('materials/cube.mtl', 'materials/textured.mtl')),
    'materials/textured.mtl': encode('newmtl green\nKd 1 1 1\nmap_Kd ../textures/紅色 圖.png\n'),
    'textures/紅色 圖.png': new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,13,73,68,65,84,120,156,99,184,163,33,247,31,0,5,40,2,34,194,184,185,142,0,0,0,0,73,69,78,68,174,66,96,130]),
    'cube.glb' : glb,
    'cube.gltf': encode(JSON.stringify({ ...gltf, buffers: [{ byteLength: binary.byteLength, uri: 'mesh.bin' }] })),
    'mesh.bin': binary, 'cube.obj': encode(obj), 'cube.stl': stl, 'cube.ply': encode(ply), 'cube.fbx': encode(fbx),
    'materials/cube.mtl': encode('newmtl green\nKd 0.15 0.65 0.5\n'),
    'cube.3mf': zipSync({
      '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),
      '3D/3dmodel.model': strToU8(mesh),
    }),
  };
}
