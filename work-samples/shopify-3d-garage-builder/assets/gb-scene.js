/* ============================================================================
   gb-scene.js
   ----------------------------------------------------------------------------
   Three.js r160 scene for the 3D Garage Builder.

   Key behaviours:
   • Click vs drag: pointer down/up delta < 5 px → click (select); otherwise → orbit
   • Touch: same 5 px threshold on touch events (suppresses orbital jitter)
   • Wall snap: every loaded GLB is shifted in Z so its back face aligns to Z = 0
   • Vertical stacking: items at y > 1 sit exactly on top of the item below (uses
     actual measured mesh height, not a fixed tier constant)
   • Spanning items (x=[a,b]): positioned at the average X of the spanned columns
   • Auto-zoom: after layout build, camera frames the total bounding box
   • Camera: max polar angle = 0.85 * PI (about 153 degrees), limiting views from below
   • Placeholder cubes are shown while GLBs load; replaced when ready

   Exposes: window.GB.Scene
   ============================================================================ */

(function () {
  'use strict';
  window.GB = window.GB || {};

  const THREE_URL        = 'https://esm.sh/three@0.160.0';
  const CONTROLS_URL     = 'https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js';
  const GLTF_URL         = 'https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
  const DRACO_URL        = 'https://esm.sh/three@0.160.0/examples/jsm/loaders/DRACOLoader.js';
  const DRACO_DECODER    = 'https://www.gstatic.com/draco/versioned/decoders/1.5.6/';

  // Placeholder cube — clearly visible while GLBs load
  const PLACEHOLDER_COLOR = 0x1e3c6e;
  const SELECT_COLOR      = 0x00bfff;

  class GBScene {
    constructor(canvas, { onNodeClick, onProgress, onDimsChange }) {
      this.canvas        = canvas;
      this.onNodeClick   = onNodeClick   || (() => {});
      this.onProgress    = onProgress    || (() => {});
      this.onDimsChange  = onDimsChange  || null;

      this._ready      = false;
      this._nodes      = new Map();  // nodeId → { group, sku, mesh, height, nodeDef }
      this._colHeights = new Map();  // "col-x" → [heights by y level]
      this._columnPos  = new Map();  // column index → world X
      this._glbCache   = new Map();  // sku → THREE.Group (cloned per use)
      this._loader     = null;
      this._selected   = null;       // currently highlighted nodeId
      this._layoutBox  = null;       // last computed bounding box

      this._pointerStart = null;
      this._THREE    = null;
      this._controls = null;
    }

    /* ── Bootstrap ────────────────────────────────────────── */

    async init() {
      const [threeModule, controlsModule, gltfModule, dracoModule] = await Promise.all([
        import(THREE_URL),
        import(CONTROLS_URL),
        import(GLTF_URL),
        import(DRACO_URL),
      ]);
      const THREE         = threeModule;
      const OrbitControls = controlsModule.OrbitControls;
      const GLTFLoader    = gltfModule.GLTFLoader;
      const DRACOLoader   = dracoModule.DRACOLoader;

      this._THREE  = THREE;

      const draco = new DRACOLoader();
      draco.setDecoderPath(DRACO_DECODER);
      this._loader = new GLTFLoader();
      this._loader.setDRACOLoader(draco);

      // Renderer
      const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight, false);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
      renderer.outputColorSpace   = THREE.SRGBColorSpace;
      this._renderer = renderer;

      // Camera
      const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
      const camera = new THREE.PerspectiveCamera(45, aspect, 0.05, 100);
      camera.position.set(0, 2.4, 6);
      this._camera = camera;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x152235);
      scene.fog = new THREE.FogExp2(0x152235, 0.035);
      this._scene = scene;

      // Lights
      scene.add(new THREE.AmbientLight(0xffffff, 1.1));
      const sun = new THREE.DirectionalLight(0xffffff, 1.6);
      sun.position.set(4, 8, 6);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.camera.near = 0.1;
      sun.shadow.camera.far  = 40;
      scene.add(sun);
      const fillLight = new THREE.DirectionalLight(0x99aaff, 0.5);
      fillLight.position.set(-4, 3, -3);
      scene.add(fillLight);
      // Rim light from front-left to show cabinet faces
      const rimLight = new THREE.DirectionalLight(0xffffff, 0.4);
      rimLight.position.set(-2, 1, 5);
      scene.add(rimLight);

      // Wall — visible dark-blue panel behind all items
      const wallGeo = new THREE.PlaneGeometry(24, 10);
      const wallMat = new THREE.MeshStandardMaterial({
        color: 0x18243a, roughness: 0.85, metalness: 0.06,
      });
      const wall = new THREE.Mesh(wallGeo, wallMat);
      wall.position.set(0, 2.5, -0.01);
      wall.receiveShadow = true;
      scene.add(wall);

      // Subtle vertical panel lines on wall (grid overlay)
      const wallGrid = new THREE.GridHelper(24, 24, 0x1f2f4a, 0x1a2840);
      wallGrid.rotation.x = Math.PI / 2;
      wallGrid.position.set(0, 2.5, 0.0);
      scene.add(wallGrid);

      // Floor — slightly lighter so it's distinguishable from wall
      const floorGeo = new THREE.PlaneGeometry(24, 12);
      const floorMat = new THREE.MeshStandardMaterial({
        color: 0x111c2e, roughness: 0.95, metalness: 0.04,
      });
      const floor = new THREE.Mesh(floorGeo, floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      scene.add(floor);

      // Floor grid — gives depth cues
      const floorGrid = new THREE.GridHelper(24, 24, 0x1a2840, 0x162030);
      floorGrid.material.opacity = 0.6;
      floorGrid.material.transparent = true;
      scene.add(floorGrid);

      // Controls
      const controls = new OrbitControls(camera, this.canvas);
      controls.enableDamping    = true;
      controls.dampingFactor    = 0.07;
      controls.maxPolarAngle    = Math.PI * 0.85;
      controls.minPolarAngle    = 0.05;
      controls.minDistance      = 1.5;
      controls.maxDistance      = 20;
      controls.target.set(0, 1.4, 0);
      controls.update();
      this._controls = controls;

      controls.addEventListener('change', () => this.onDimsChange?.());

      // Pointer interaction
      this._bindPointerEvents();

      // Resize observer
      new ResizeObserver(() => this._onResize()).observe(this.canvas.parentElement);

      // Render loop
      this._animate();
      this._ready = true;
    }

    /* ── Layout building ──────────────────────────────────── */

    /**
     * Build the scene from a preset's node definitions.
     * @param {Array}  nodeDefs    — from GBData.getPresetNodes(n)
     * @param {number} tierHeight  — metres per tier
     * @param {number} colWidth    — metres per column
     */
    async buildLayout(nodeDefs, tierHeight, colWidth) {
      this._clearLayout();
      this._tierHeight = tierHeight;
      this._colWidth   = colWidth;
      if (!nodeDefs.length) return;

      // Gather unique column indices, sort left→right
      const allCols = new Set();
      nodeDefs.forEach((nd) => {
        const xs = Array.isArray(nd.x) ? nd.x : [nd.x];
        xs.forEach((x) => allCols.add(x));
      });
      const sortedCols = [...allCols].sort((a, b) => a - b);
      const totalW     = sortedCols.length * colWidth;
      const offset     = -totalW / 2 + colWidth / 2;

      this._columnPos.clear();
      sortedCols.forEach((col, idx) => {
        this._columnPos.set(col, offset + idx * colWidth);
      });

      // Sort nodes: lowest Y first so heights are known when upper nodes place
      const sorted = [...nodeDefs].sort((a, b) => {
        const aMin = Array.isArray(a.y) ? Math.min(...a.y) : a.y;
        const bMin = Array.isArray(b.y) ? Math.min(...b.y) : b.y;
        return aMin - bMin;
      });

      // Load + place all nodes (parallel loads, sequential placement per column)
      await Promise.all(sorted.map((nd) => this._loadAndPlaceNode(nd, tierHeight, colWidth)));

      this._repackXPositions();
      this._autoZoom();
    }

    async _loadAndPlaceNode(nd, tierHeight, colWidth) {
      const xs      = Array.isArray(nd.x) ? nd.x : [nd.x];
      const ys      = Array.isArray(nd.y) ? nd.y : [nd.y];
      const minY    = Math.min(...ys);
      const maxY    = Math.max(...ys);
      const worldXs = xs.map((x) => this._columnPos.get(x));
      const worldX  = worldXs.reduce((a, b) => a + b, 0) / worldXs.length;
      const spanW   = xs.length * colWidth;

      // Y: bottom of this node = tallest stack across ALL covered columns
      const worldY = Math.max(...xs.map((x) => this._getStackedY(x, minY)));

      // Placeholder cube while loading
      const placeholder = this._makePlaceholder(spanW * 0.88, tierHeight * 0.9, 0.85);
      placeholder.position.set(worldX, worldY + tierHeight * 0.45, 0.45);
      placeholder.userData.gbNodeId = nd.node_id;
      this._scene.add(placeholder);

      const entry = { group: placeholder, sku: nd.sku, height: tierHeight, nodeDef: nd };
      this._nodes.set(nd.node_id, entry);

      // Load GLB
      const glbUrl = nd._glbUrl || '';
      if (!glbUrl) {
        console.warn(`[GB Scene] No GLB URL for node ${nd.node_id} (sku: ${nd.sku}) — placeholder kept`);
      }
      if (glbUrl) {
        console.log(`[GB Scene] Loading ${nd.sku} from ${glbUrl}`);
        try {
          const gltf  = await this._loadGLB(glbUrl);
          const group = gltf.scene.clone(true);
          this._prepareMesh(group, nd.node_id, nd.fix);

          // Wall snap + measure
          const box    = new this._THREE.Box3().setFromObject(group);
          const depth  = box.max.z - box.min.z;
          const height = box.max.y - box.min.y;
          console.log(`[GB height] ${nd.node_id} (${nd.sku}): bbox_h=${height.toFixed(3)}m${nd.height_override_m ? ` → override=${nd.height_override_m}m` : ''}`);

          // Wall snap: back face at Z = 0
          group.position.z = -box.min.z;

          // Horizontal centre at worldX
          const midX = (box.min.x + box.max.x) / 2;
          group.position.x = worldX - midX;

          // Recompute stack Y after async load — sibling nodes may have loaded in the meantime
          const stackedY = Math.max(...xs.map((x) => this._getStackedY(x, minY)));
          group.position.y = stackedY - box.min.y;

          this._scene.remove(placeholder);
          this._scene.add(group);
          entry.group  = group;
          entry.height = nd.height_override_m || height;

          // Reposition nodes stacked above in ALL covered columns
          xs.forEach((x) => this._reStackAbove(x, maxY));

        } catch (err) {
          console.error(`[GB Scene] GLB load failed for ${nd.sku} (${glbUrl}):`, err?.message || err);
        }
      }

      this.onProgress();
    }

    /* ── Stack height tracking ────────────────────────────── */

    _getStackedY(col, tier) {
      // World Y for an item placed at this tier in this column.
      // Sums heights of items at tiers 1..(tier-1), counting each y-span node
      // only at its minY and skipping interior tiers it covers.
      let y = 0;
      for (let t = 1; t < tier; t++) {
        const nodes = [...this._nodes.values()];
        const starter = nodes.find((e) => {
          const xs   = Array.isArray(e.nodeDef.x) ? e.nodeDef.x : [e.nodeDef.x];
          const eys  = Array.isArray(e.nodeDef.y) ? e.nodeDef.y : [e.nodeDef.y];
          return xs.includes(col) && Math.min(...eys) === t;
        });
        if (starter) {
          y += starter.height;
        } else {
          // Only add default height if no y-span from below covers this tier
          const spanned = nodes.some((e) => {
            const xs   = Array.isArray(e.nodeDef.x) ? e.nodeDef.x : [e.nodeDef.x];
            const eys  = Array.isArray(e.nodeDef.y) ? e.nodeDef.y : [e.nodeDef.y];
            const eMin = Math.min(...eys);
            const eMax = Math.max(...eys);
            return xs.includes(col) && eMin < t && eMax >= t;
          });
          if (!spanned) y += 0.85;
        }
      }
      return y;
    }

    _reStackAbove(col, fromTier) {
      // After a tier's height changes, reposition all items above it.
      // Uses minY for y-span nodes; processes low→high.
      [...this._nodes.values()]
        .filter((e) => {
          const xs   = Array.isArray(e.nodeDef.x) ? e.nodeDef.x : [e.nodeDef.x];
          const eys  = Array.isArray(e.nodeDef.y) ? e.nodeDef.y : [e.nodeDef.y];
          return xs.includes(col) && Math.min(...eys) > fromTier;
        })
        .sort((a, b) => {
          const aMin = Math.min(...(Array.isArray(a.nodeDef.y) ? a.nodeDef.y : [a.nodeDef.y]));
          const bMin = Math.min(...(Array.isArray(b.nodeDef.y) ? b.nodeDef.y : [b.nodeDef.y]));
          return aMin - bMin;
        })
        .forEach((e) => {
          const eys  = Array.isArray(e.nodeDef.y) ? e.nodeDef.y : [e.nodeDef.y];
          const newY = this._getStackedY(col, Math.min(...eys));
          e.group.updateMatrixWorld(true);
          const box  = new this._THREE.Box3().setFromObject(e.group);
          e.group.position.y += (newY - box.min.y);
        });
    }

    /* ── Node swap ────────────────────────────────────────── */

    /** Replace the SKU for one node in-place. */
    async replaceNodeSku(nodeId, newSku, glbUrl) {
      const entry = this._nodes.get(nodeId);
      if (!entry) return;
      const nd = { ...entry.nodeDef, sku: newSku, _glbUrl: glbUrl };
      this._scene.remove(entry.group);
      this._nodes.delete(nodeId);
      this._clearSelection();
      await this._loadAndPlaceNode(nd, this._tierHeight || 0.85, this._colWidth || 0.9);
    }

    /** Remove a set of nodes and place new ones. */
    async replaceSet(removeIds, newNodeDefs) {
      removeIds.forEach((id) => {
        const e = this._nodes.get(id);
        if (e) { this._scene.remove(e.group); this._nodes.delete(id); }
      });
      this._clearSelection();
      for (const nd of newNodeDefs) {
        await this._loadAndPlaceNode(nd, this._tierHeight || 0.85, this._colWidth || 0.9);
      }
      this._recomputeAllStacks();
      this._repackXPositions();
      this._autoZoom();
    }

    _recomputeAllStacks() {
      // Re-sort and reposition every node by column order
      const cols = new Set();
      this._nodes.forEach((e) => {
        const xs = Array.isArray(e.nodeDef.x) ? e.nodeDef.x : [e.nodeDef.x];
        xs.forEach((x) => cols.add(x));
      });
      cols.forEach((col) => this._reStackAbove(col, 0));
    }

    /* ── Selection highlight ──────────────────────────────── */

    selectNode(nodeId) {
      this._clearSelection();
      const entry = this._nodes.get(nodeId);
      if (!entry) return;
      this._selected = nodeId;
      entry.group.traverse((child) => {
        if (child.isMesh) {
          child.userData._origEmissive = child.material.emissive?.getHex?.() || 0;
          child.material = child.material.clone();
          child.material.emissive    = new this._THREE.Color(SELECT_COLOR);
          child.material.emissiveIntensity = 0.25;
        }
      });
    }

    _clearSelection() {
      if (!this._selected) return;
      const entry = this._nodes.get(this._selected);
      if (entry) {
        entry.group.traverse((child) => {
          if (child.isMesh && child.userData._origEmissive !== undefined) {
            child.material = child.material.clone();
            child.material.emissive.setHex(child.userData._origEmissive);
            child.material.emissiveIntensity = 0;
          }
        });
      }
      this._selected = null;
    }

    /* ── Pointer events ───────────────────────────────────── */

    _bindPointerEvents() {
      const canvas = this.canvas;

      canvas.addEventListener('pointerdown', (e) => {
        this._pointerStart = { x: e.clientX, y: e.clientY };
      });

      canvas.addEventListener('pointerup', (e) => {
        if (!this._pointerStart) return;
        const dx   = e.clientX - this._pointerStart.x;
        const dy   = e.clientY - this._pointerStart.y;
        const dist = Math.hypot(dx, dy);
        this._pointerStart = null;
        if (dist < 5) this._handleClick(e);   // < 5 px = tap/click
      });

      canvas.addEventListener('pointercancel', () => { this._pointerStart = null; });
    }

    _handleClick(e) {
      const rect   = this.canvas.getBoundingClientRect();
      const ndcX   = ((e.clientX - rect.left)  / rect.width)  * 2 - 1;
      const ndcY  = -((e.clientY - rect.top)   / rect.height) * 2 + 1;

      const raycaster = new this._THREE.Raycaster();
      raycaster.setFromCamera(new this._THREE.Vector2(ndcX, ndcY), this._camera);

      const meshes = [];
      this._nodes.forEach((entry) => {
        entry.group.traverse((child) => { if (child.isMesh) meshes.push(child); });
      });

      const hits = raycaster.intersectObjects(meshes, false);
      if (!hits.length) { this._clearSelection(); return; }

      // Walk up to find the node group
      let obj = hits[0].object;
      while (obj && !obj.userData.gbNodeId) obj = obj.parent;
      if (!obj) return;

      const nodeId = obj.userData.gbNodeId;
      this.selectNode(nodeId);

      // Screen coordinates for menu anchor
      const world3D = new this._THREE.Vector3();
      new this._THREE.Box3().setFromObject(this._nodes.get(nodeId).group).getCenter(world3D);
      world3D.project(this._camera);
      const rect2   = this.canvas.getBoundingClientRect();
      const screenX = (world3D.x + 1) / 2 * rect2.width;
      const screenY = (1 - world3D.y) / 2 * rect2.height;

      this.onNodeClick({ nodeId, anchor: { x: screenX, y: screenY } });
    }

    /* ── GLB loader (cached) ──────────────────────────────── */

    _loadGLB(url) {
      if (this._glbCache.has(url)) {
        return Promise.resolve({ scene: this._glbCache.get(url) });
      }
      return new Promise((resolve, reject) => {
        this._loader.load(url,
          (gltf) => { this._glbCache.set(url, gltf.scene); resolve(gltf); },
          (xhr)  => { this.onProgress(xhr.loaded / (xhr.total || 1)); },
          reject
        );
      });
    }

    _prepareMesh(group, nodeId, isFix) {
      group.userData.gbNodeId = nodeId;
      group.traverse((child) => {
        if (!child.isMesh) return;
        child.castShadow    = true;
        child.receiveShadow = true;
        child.userData.gbNodeId = nodeId;
        if (isFix && child.material) {
          child.material = child.material.clone();
          child.material.color?.multiplyScalar(0.7);
        }
      });
    }

    /* ── Placeholder cube ─────────────────────────────────── */

    _makePlaceholder(w, h, d) {
      const geo = new this._THREE.BoxGeometry(w, h, d);
      const mat = new this._THREE.MeshStandardMaterial({
        color: PLACEHOLDER_COLOR, roughness: 0.7, metalness: 0.2,
        transparent: true, opacity: 0.85,
      });
      const edges = new this._THREE.EdgesGeometry(geo);
      const line  = new this._THREE.LineSegments(edges,
        new this._THREE.LineBasicMaterial({ color: 0x4499ee, opacity: 1.0, transparent: false }));
      const group = new this._THREE.Group();
      group.add(new this._THREE.Mesh(geo, mat));
      group.add(line);
      return group;
    }

    /* ── X repack ────────────────────────────────────────── */

    /**
     * After GLBs load, repositions all nodes so items are flush against each
     * other with no gaps. Groups by column-span signature (sorted xs joined),
     * measures each group's actual bounding-box width, packs left→right, then
     * centres the whole arrangement.
     */
    _repackXPositions() {
      if (!this._nodes.size) return;

      // ── Pass 1: measure every node's bounding-box width ──────────────────
      const bboxW = new Map(); // nodeId → measured width
      this._nodes.forEach((e) => {
        e.group.updateMatrixWorld(true);
        const box = new this._THREE.Box3().setFromObject(e.group);
        bboxW.set(e.nodeDef.node_id, (box.max.x - box.min.x) || this._colWidth);
      });

      // ── Pass 2: build per-column width from single-column nodes only ─────
      // Spanning nodes (xs.length > 1) do NOT consume extra column space when
      // the columns they cover already have single-column nodes. This lets a
      // spanning item (e.g. a work-top across x=[2,3]) sit above its columns
      // without pushing them apart.
      const colWidths = new Map(); // col → width

      this._nodes.forEach((e) => {
        const xs = (Array.isArray(e.nodeDef.x) ? [...e.nodeDef.x] : [e.nodeDef.x])
                     .sort((a, b) => a - b);
        if (xs.length !== 1) return; // skip spanning nodes in this pass
        const w    = bboxW.get(e.nodeDef.node_id);
        const prev = colWidths.get(xs[0]) || 0;
        if (w > prev) colWidths.set(xs[0], w);
      });

      // For columns that ONLY exist in spanning nodes (no single node present),
      // derive per-column width from the spanning node proportionally.
      this._nodes.forEach((e) => {
        const xs = (Array.isArray(e.nodeDef.x) ? [...e.nodeDef.x] : [e.nodeDef.x])
                     .sort((a, b) => a - b);
        if (xs.length === 1) return;
        const w      = bboxW.get(e.nodeDef.node_id);
        const perCol = w / xs.length;
        xs.forEach((x) => {
          if (!colWidths.has(x)) colWidths.set(x, perCol); // only if not already set
        });
      });

      // ── Pass 3: sort columns and compute world-space centres ─────────────
      const sortedCols = [...colWidths.keys()].sort((a, b) => a - b);
      const totalW     = sortedCols.reduce((s, c) => s + colWidths.get(c), 0);
      let curX         = -totalW / 2;
      const colCenter  = new Map(); // col → world centre X

      sortedCols.forEach((col) => {
        const w = colWidths.get(col);
        colCenter.set(col, curX + w / 2);
        curX += w;
      });

      // ── Pass 4: reposition every node ────────────────────────────────────
      // Single-column → that column's centre.
      // Spanning → average of its covered column centres (sits over existing columns).
      this._nodes.forEach((e) => {
        const xs = (Array.isArray(e.nodeDef.x) ? [...e.nodeDef.x] : [e.nodeDef.x])
                     .sort((a, b) => a - b);
        const coveredCx = xs.map((x) => colCenter.get(x)).filter((c) => c !== undefined);
        if (!coveredCx.length) return;
        const targetCx = coveredCx.reduce((s, c) => s + c, 0) / coveredCx.length;

        e.group.updateMatrixWorld(true);
        const box      = new this._THREE.Box3().setFromObject(e.group);
        const currentCx = (box.min.x + box.max.x) / 2;
        e.group.position.x += (targetCx - currentCx);
      });

      // ── Refresh column-centre cache ───────────────────────────────────────
      this._columnPos.clear();
      colCenter.forEach((cx, col) => this._columnPos.set(col, cx));
    }

    /* ── Auto-zoom ────────────────────────────────────────── */

    _autoZoom() {
      if (!this._nodes.size) return;
      const box = new this._THREE.Box3();
      this._nodes.forEach((e) => {
        e.group.updateMatrixWorld(true);
        box.expandByObject(e.group);
      });
      if (box.isEmpty()) return;

      this._layoutBox = box.clone();

      const center = new this._THREE.Vector3();
      const size   = new this._THREE.Vector3();
      box.getCenter(center);
      box.getSize(size);

      // Frame the scene with some headroom above and to the sides
      const fovRad   = this._camera.fov * Math.PI / 180;
      const aspect   = this._camera.aspect;
      const fitW     = (size.x / 2) / (Math.tan(fovRad / 2) * aspect);
      const fitH     = (size.y / 2) / Math.tan(fovRad / 2);
      const dist     = Math.max(fitW, fitH) * 1.55;

      const target = new this._THREE.Vector3(center.x, center.y * 0.75, 0);
      this._controls.target.copy(target);
      this._camera.position.set(center.x, target.y + size.y * 0.2, dist);
      this._controls.update();

      this.onDimsChange?.();
    }

    resetCamera() { this._autoZoom(); }

    /* ── Dimension helpers ────────────────────────────────── */

    getDimensions() {
      if (!this._layoutBox || this._layoutBox.isEmpty()) return null;
      const size = new this._THREE.Vector3();
      this._layoutBox.getSize(size);
      return {
        widthCm:  Math.round(size.x * 100),
        heightCm: Math.round(size.y * 100),
        depthCm:  Math.round(size.z * 100),
        box: this._layoutBox,
      };
    }

    projectToScreen(x, y, z) {
      const v = new this._THREE.Vector3(x, y, z);
      v.project(this._camera);
      return {
        x: (v.x + 1) / 2 * this.canvas.clientWidth,
        y: (1 - v.y) / 2 * this.canvas.clientHeight,
      };
    }

    /* ── Resize / render loop ─────────────────────────────── */

    _onResize() {
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      if (!w || !h) return;
      this._camera.aspect = w / h;
      this._camera.updateProjectionMatrix();
      this._renderer.setSize(w, h, false);
      this.onDimsChange?.();
    }

    _animate() {
      requestAnimationFrame(() => this._animate());
      this._controls?.update();
      this._renderer.render(this._scene, this._camera);
    }

    /* ── Cleanup ──────────────────────────────────────────── */

    _clearLayout() {
      this._nodes.forEach((e) => this._scene.remove(e.group));
      this._nodes.clear();
      this._colHeights.clear();
      this._clearSelection();
    }

    dispose() {
      this._clearLayout();
      this._renderer?.dispose();
      this._controls?.dispose();
    }
  }

  window.GB.Scene = GBScene;
})();
