three.js r187 (npm three@0.187.0), MIT. Unmodified copies of build/three.module.js, build/three.core.js and the examples/jsm files under addons/ that the library page imports.

Figurines on the bookcases (js/stacks3d/figurines.js, loaded only by the 3D library, lazily, after the room is interactive):
- addons/loaders/GLTFLoader.js, addons/utils/BufferGeometryUtils.js, addons/utils/SkeletonUtils.js (three.js, MIT)
- addons/libs/meshopt_decoder.module.js (meshoptimizer by Arseny Kapoulkine, MIT; the decoder for EXT_meshopt_compression)
- addons/loaders/DRACOLoader.js (three.js, MIT) and addons/libs/draco/gltf/draco_wasm_wrapper.js + draco_decoder.wasm
  (Google Draco, Apache License 2.0, see addons/libs/draco/README.md; fetched only if a figurine uses KHR_draco_mesh_compression)
All copied from the same npm three@0.187.0 package, unmodified.
