/* ============================================================================
   gb-main.js
   ----------------------------------------------------------------------------
   Main controller for the 3D Garage Builder.

   Boot sequence:
     1. Parse section JSON blobs via GBData
     2. Wire up preset buttons (4 / 5 / 6 slots)
     3. On preset select → build scene layout + sidebar node list
     4. Node click (scene or sidebar row) → show GBMenu (Single / Set)
     5. Menu Single → build single-swap wheel options → open GBWheel
     6. Menu Set    → compute eligible set options (overlap guard) → open GBWheel
     7. Wheel select → apply swap → re-render sidebar + totals
     8. Checkout button → POST to /cart/add.js

   State shape:
     this.state = {
       preset:   number,
       nodes:    Map<nodeId, { nodeDef, currentSku, originalSku,
                               currentPrice, originalPrice }>,
     }

   Exposes: window.GB.Main (constructed automatically per section)
   ============================================================================ */

(function () {
  'use strict';
  window.GB = window.GB || {};

  class GBMain {
    constructor(sectionId) {
      this.sectionId  = sectionId;
      this.data       = new window.GB.Data(sectionId);
      this.calculator = null;
      this.scene      = null;
      this.menu       = null;
      this.wheel      = null;

      this.state = { preset: null, nodes: new Map() };

      this._editingNodeId = null;
      this._dimsPending   = false;

      this._el = (id) => document.getElementById(`${id}-${sectionId}`);
      this._init();
    }

    /* ── Bootstrap ────────────────────────────────────────── */

    async _init() {
      const landing = this._el('gb-landing');
      const builder = this._el('gb-builder');
      if (!landing || !builder) return;

      this._renderPresetButtons();

      this._el('gb-start')?.addEventListener('click', () => this._startBuilder());
      this._el('gb-back')?.addEventListener('click',  () => this._backToLanding());
      this._el('gb-checkout')?.addEventListener('click', () => this._addToCart());

      // HUD buttons
      const wrap = this._el('gb-canvas-wrap');
      wrap?.querySelector('[data-action="reset-cam"]')?.addEventListener('click', () => this.scene?.resetCamera());
      wrap?.querySelector('[data-action="zoom-fit"]')?.addEventListener('click',  () => this.scene?.resetCamera());
    }

    /* ── Preset buttons ───────────────────────────────────── */

    _renderPresetButtons() {
      const container = this._el('gb-presets');
      if (!container) return;

      this.data.getAvailablePresets().forEach((n) => {
        const basePrice = this.data.getBasePrice(n);
        const btn = document.createElement('button');
        btn.className = 'gb-preset-btn';
        btn.dataset.preset = n;
        btn.innerHTML = `
          <span class="gb-preset-btn__num">${n}</span>
          <span class="gb-preset-btn__label">SLOTS</span>
          ${basePrice ? `<span class="gb-preset-btn__price">${this._money(basePrice)}</span>` : ''}
        `;
        btn.addEventListener('click', () => this._selectPreset(n));
        container.appendChild(btn);
      });
    }

    _selectPreset(n) {
      this.state.preset = n;
      document.querySelectorAll(`#gb-presets-${this.sectionId} .gb-preset-btn`).forEach((b) => {
        b.classList.toggle('gb-preset-btn--active', Number(b.dataset.preset) === n);
      });
      const startBtn = this._el('gb-start');
      if (startBtn) startBtn.disabled = false;
    }

    /* ── Landing ↔ Builder ────────────────────────────────── */

    async _startBuilder() {
      if (!this.state.preset) return;
      this._el('gb-landing').hidden = true;
      this._el('gb-builder').hidden = false;
      await this._initScene();
      // Wait one frame so the browser reflows the canvas to its actual dimensions
      // before buildLayout runs (prevents 0×0 camera aspect on second entry)
      await new Promise((r) => requestAnimationFrame(r));
      await this._loadPreset(this.state.preset);
    }

    _backToLanding() {
      this._el('gb-builder').hidden = true;
      this._el('gb-landing').hidden = false;
      this.menu?.close({ silent: true });
      this.wheel?.close({ silent: true });
    }

    /* ── Scene init ───────────────────────────────────────── */

    async _initScene() {
      if (this.scene) return;

      const canvas = this._el('gb-canvas');
      this.scene   = new window.GB.Scene(canvas, {
        onNodeClick:  (info) => this._handleNodeClick(info),
        onProgress:   ()     => {},
        onDimsChange: ()     => {
          if (this._dimsPending) return;
          this._dimsPending = true;
          requestAnimationFrame(() => { this._dimsPending = false; this._updateDims(); });
        },
      });

      this.menu = new window.GB.Menu(this._el('gb-menu-layer'), {
        onSingle: (nodeId) => this._openSingleWheel(nodeId),
        onSet:    (nodeId) => this._openSetWheel(nodeId),
        onClose:  ()       => { this._editingNodeId = null; },
      });

      this.wheel = new window.GB.Wheel(this._el('gb-wheel-layer'), {
        onSelect: (item)   => this._handleWheelSelect(item),
        onClose:  ()       => { this._editingNodeId = null; },
      });

      this._showLoading(true);
      await this.scene.init();
      this._showLoading(false);
    }

    /* ── Load preset ──────────────────────────────────────── */

    async _loadPreset(n) {
      const nodeDefs   = this.data.getPresetNodes(n);
      const tierH      = this.data.getTierHeight();
      const colW       = this.data.getColumnWidth();
      const basePrice  = this.data.getBasePrice(n);

      this.calculator = new window.GB.Calculator(basePrice, window.GB_DISCOUNT || 0);
      this.state.nodes.clear();

      const total = nodeDefs.length;
      let loaded  = 0;
      this._setProgress(5);

      // Attach GLB URLs and build state map
      nodeDefs.forEach((nd) => {
        const glbUrl = this.data.glbUrlFor(nd.sku);
        nd._glbUrl   = glbUrl;
        console.log(`[GB] ${nd.node_id} sku=${nd.sku} → ${glbUrl || 'EMPTY'}`);

        const product = this.data.getProductBySku(nd.sku);
        this.state.nodes.set(nd.node_id, {
          nodeDef:       nd,
          currentSku:    nd.sku,
          originalSku:   nd.sku,
          currentPrice:  product?.price  || 0,
          originalPrice: product?.price  || 0,
        });
      });

      this._showLoading(true);
      this._setProgress(10);

      this.scene.onProgress = () => {
        loaded++;
        this._setProgress(10 + Math.round(loaded / total * 85));
      };

      await this.scene.buildLayout(nodeDefs, tierH, colW);

      this._showLoading(false);
      this._renderNodeList();
      this._renderTotals();

      const checkout = this._el('gb-checkout');
      if (checkout) checkout.disabled = false;
    }

    /* ── Node click handler ───────────────────────────────── */

    _handleNodeClick({ nodeId, anchor }) {
      this._editingNodeId = nodeId;
      const entry = this.state.nodes.get(nodeId);
      if (!entry) return;

      const nd    = entry.nodeDef;
      const isFix = nd.fix;

      if (isFix) {
        this.menu.open({ anchor, singleAvailable: false, setAvailable: false, isFix: true, nodeId });
        return;
      }

      const skuForSingle  = nd._isBlueBox ? (nd._defaultSku || '') : entry.currentSku;
      const singleOptions = this._getSingleOptions(skuForSingle);
      // BlueBox: any option; real node: at least one option differs from the current SKU
      const singleAvail   = nd._isBlueBox ? singleOptions.length > 0 : singleOptions.some((s) => s !== entry.currentSku);
      const setsAvail     = nd.setAvailable ? this.data.getSets(nd.setAvailable).length > 0 : false;

      this.menu.open({
        anchor,
        singleAvailable: singleAvail,
        setAvailable:    setsAvail,
        isFix:           false,
        nodeId,
      });
    }

    /* ── Single swap wheel ────────────────────────────────── */

    _openSingleWheel(nodeId) {
      const entry = this.state.nodes.get(nodeId);
      if (!entry) return;
      this._editingNodeId = nodeId;

      const nd        = entry.nodeDef;
      const lookupSku = nd._isBlueBox ? (nd._defaultSku || '') : entry.currentSku;
      const skus  = this._getSingleOptions(lookupSku);
      if (!skus.length) { this._toast('No alternatives', 'No single-swap options found for this item.', 'warning'); return; }

      const items = skus.map((sku) => {
        const product = this.data.getProductBySku(sku);
        return {
          type:            'sku',
          sku,
          title:           product?.title          || sku,
          price_formatted: product?.price_formatted || '',
          thumbnail:       product?.featured_image  || null,
          disabled:        !this.data.hasProduct(sku),
          isCurrent:       sku === entry.currentSku,
        };
      });

      const rect = this._el('gb-canvas')?.getBoundingClientRect() || { left: 0, top: 0 };
      this.wheel.open({
        items,
        anchor: { x: rect.width / 2, y: rect.height / 2 },
        currentSku: entry.currentSku,
      });
    }

    _getSingleOptions(sku) {
      return this.data.getSingleSwaps(sku).filter((s) => this.data.hasProduct(s));
    }

    /* ── Set swap wheel ───────────────────────────────────── */

    _openSetWheel(nodeId) {
      const entry = this.state.nodes.get(nodeId);
      if (!entry) return;
      this._editingNodeId = nodeId;

      const nd = entry.nodeDef;
      if (!nd.setAvailable) { this._toast('No sets', 'No set configurations available here.', 'warning'); return; }

      const groups = this.data.getSets(nd.setAvailable);
      if (!groups.length) { this._toast('No sets', 'No set options found.', 'warning'); return; }

      const items = groups.map((group) => {
        const thumbSku    = group.skus[0];
        const product     = this.data.getProductBySku(thumbSku);
        const totalCents  = group.skus.reduce((sum, sku) => {
          return sum + (this.data.getProductBySku(sku)?.price || 0);
        }, 0);
        return {
          type:            'config',
          group_id:        group.group_id,
          sku:             thumbSku,
          title:           group.label    || group.group_id,
          price_formatted: totalCents > 0 ? this._money(totalCents) : '',
          thumbnail:       product?.featured_image  || null,
          disabled:        false,
          isCurrent:       this._isCurrentSet(nd.setAvailable, group.group_id),
          _group:          group,
        };
      });

      const rect = this._el('gb-canvas')?.getBoundingClientRect() || { left: 0, top: 0 };
      this.wheel.open({
        items,
        anchor: { x: rect.width / 2, y: rect.height / 2 },
        currentSku: null,
      });
    }

    /** Returns all nodeIds sharing the same setWith key. */
    _getGroupNodes(setWith) {
      const ids = [];
      if (!setWith) return ids;
      this.state.nodes.forEach((entry, id) => {
        if (entry.nodeDef.setWith === setWith) ids.push(id);
      });
      return ids;
    }

    /**
     * Expands nodeIds to individual (x, y) position objects, sorted y then x.
     * Handles x-span (x=[2,3]), y-span (y=[1,2]), and regular single-cell nodes.
     */
    _expandPositions(nodeIds) {
      const positions = [];
      nodeIds.forEach((id) => {
        const e = this.state.nodes.get(id);
        if (!e) return;
        const xs = Array.isArray(e.nodeDef.x) ? e.nodeDef.x : [e.nodeDef.x];
        const ys = Array.isArray(e.nodeDef.y) ? e.nodeDef.y : [e.nodeDef.y];
        xs.forEach((x) => ys.forEach((y) => positions.push({ x, y })));
      });
      return positions.sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));
    }

    _isCurrentSet(setAvailable, groupId) {
      const opts  = this.data.getSets(setAvailable);
      const group = opts.find((g) => g.group_id === groupId);
      if (!group) return false;

      const nd = this._editingNodeId ? this.state.nodes.get(this._editingNodeId)?.nodeDef : null;
      if (!nd) return false;

      const groupIds   = nd.setWith ? this._getGroupNodes(nd.setWith) : [this._editingNodeId];
      const currentSkus = groupIds
        .map((id) => this.state.nodes.get(id))
        .filter((e) => e && !e.nodeDef._isBlueBox)
        .sort((a, b) => this._nodeOrder(a.nodeDef) - this._nodeOrder(b.nodeDef))
        .map((e) => e.currentSku);

      if (currentSkus.length !== group.skus.length) return false;
      return group.skus.every((sku, i) => sku === currentSkus[i]);
    }

    /* ── Wheel select handler ─────────────────────────────── */

    _handleWheelSelect(item) {
      if (item.type === 'config') {
        this._applySetSwap(item._group);
      } else {
        this._applySingleSwap(this._editingNodeId, item.sku);
      }
      this._editingNodeId = null;
    }

    /* ── Apply swaps ──────────────────────────────────────── */

    async _applySingleSwap(nodeId, newSku) {
      const entry = this.state.nodes.get(nodeId);
      if (!entry) return;
      if (!entry.nodeDef._isBlueBox && entry.currentSku === newSku) return;

      const product = this.data.getProductBySku(newSku);
      const glbUrl  = this.data.glbUrlFor(newSku);
      const setWith = entry.nodeDef.setWith;

      if (entry.nodeDef._isBlueBox || !setWith) {
        // BlueBox fill or Case 2: replace this slot only, never touch siblings.
        // BlueBox keeps setWith/setAvailable so the group remains addressable.
        entry.currentSku   = newSku;
        entry.currentPrice = product?.price || 0;
        entry.nodeDef      = { ...entry.nodeDef, sku: newSku, _glbUrl: glbUrl, _isBlueBox: false, _defaultSku: undefined };
        await this.scene.replaceNodeSku(nodeId, newSku, glbUrl);
      } else {
        // Single swap on grouped node — only this node changes, siblings untouched.
        // The node leaves the group (setWith cleared) so it acts as a standalone item.
        entry.currentSku   = newSku;
        entry.currentPrice = product?.price || 0;
        entry.nodeDef      = { ...entry.nodeDef, sku: newSku, _glbUrl: glbUrl, _isBlueBox: false, _defaultSku: undefined, setWith: '', setAvailable: '' };
        await this.scene.replaceNodeSku(nodeId, newSku, glbUrl);
      }

      this._renderNodeList();
      this._renderTotals();
    }

    async _applySetSwap(group) {
      const editingEntry = this._editingNodeId ? this.state.nodes.get(this._editingNodeId) : null;
      if (!editingEntry) return;

      const nd       = editingEntry.nodeDef;
      const setWith  = nd.setWith;
      const setAvail = nd.setAvailable;
      const { skus } = group;

      // Collect the current group's nodeIds and expand to all (x, y) positions
      const groupIds  = setWith ? this._getGroupNodes(setWith) : [this._editingNodeId];
      const positions = this._expandPositions(groupIds);  // sorted y then x

      // Standalone node: if the group needs more positions than exist, expand upward
      if (!setWith && skus.length > positions.length) {
        const xs  = [...new Set(positions.map((p) => p.x))].sort((a, b) => a - b);
        let nextY = Math.max(...positions.map((p) => p.y)) + 1;
        while (positions.length < skus.length) {
          const occupied = [...this.state.nodes.values()].some((e) => {
            const exXs = Array.isArray(e.nodeDef.x) ? e.nodeDef.x : [e.nodeDef.x];
            const exYs = Array.isArray(e.nodeDef.y) ? e.nodeDef.y : [e.nodeDef.y];
            return xs.some((x) => exXs.includes(x)) && exYs.includes(nextY);
          });
          if (occupied) break;
          xs.forEach((x) => positions.push({ x, y: nextY }));
          nextY++;
        }
        positions.sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));
      }

      let newNodeDefs = [];

      if (skus.length === positions.length) {
        // Case 1: same count — map each SKU to the matching position in order
        const newSetWith = positions.length > 1 ? positions.map((p) => `S${p.x},${p.y}`).join('|') : '';
        newNodeDefs = positions.map((pos, i) => ({
          node_id:      `S${pos.x},${pos.y}`,
          x:            pos.x,
          y:            pos.y,
          sku:          skus[i],
          setWith:      newSetWith,
          setAvailable: setAvail,
          fix:          false,
          _glbUrl:      this.data.glbUrlFor(skus[i]),
        }));

      } else if (skus.length === 1) {
        // Case 3: one SKU for multiple positions → create a spanning node
        const sku    = skus[0];
        const allXs  = [...new Set(positions.map((p) => p.x))].sort((a, b) => a - b);
        const allYs  = [...new Set(positions.map((p) => p.y))].sort((a, b) => a - b);

        let xVal, yVal, nodeId;
        if (allYs.length === 1) {
          // All same Y → x-span
          xVal   = allXs.length === 1 ? allXs[0] : allXs;
          yVal   = allYs[0];
          nodeId = `S${allXs.join('+')},${allYs[0]}`;
        } else if (allXs.length === 1) {
          // All same X → y-span
          xVal   = allXs[0];
          yVal   = allYs.length === 1 ? allYs[0] : allYs;
          nodeId = `S${allXs[0]},${allYs.join('+')}`;
        } else {
          // Mixed — x-span at min Y (best effort)
          xVal   = allXs;
          yVal   = allYs[0];
          nodeId = `S${allXs.join('+')},${allYs[0]}`;
        }
        newNodeDefs = [{ node_id: nodeId, x: xVal, y: yVal, sku, setWith: '', setAvailable: setAvail, fix: false, _glbUrl: this.data.glbUrlFor(sku) }];

      } else {
        // skus.length > positions.length — fill available positions, extras ignored
        const newSetWith = positions.length > 1 ? positions.map((p) => `S${p.x},${p.y}`).join('|') : '';
        newNodeDefs = positions.map((pos, i) => ({
          node_id:      `S${pos.x},${pos.y}`,
          x:            pos.x,
          y:            pos.y,
          sku:          skus[Math.min(i, skus.length - 1)],
          setWith:      newSetWith,
          setAvailable: setAvail,
          fix:          false,
          _glbUrl:      this.data.glbUrlFor(skus[Math.min(i, skus.length - 1)]),
        }));
      }

      // Remove old group nodes from state
      groupIds.forEach((id) => this.state.nodes.delete(id));

      // Any positions not covered by new nodes → BlueBox (preserves setWith so group stays linked)
      const coveredKeys = new Set();
      newNodeDefs.forEach((newNd) => {
        const nxs = Array.isArray(newNd.x) ? newNd.x : [newNd.x];
        const nys = Array.isArray(newNd.y) ? newNd.y : [newNd.y];
        nxs.forEach((x) => nys.forEach((y) => coveredKeys.add(`${x},${y}`)));
      });

      const newSetWith = newNodeDefs.length > 1 ? newNodeDefs.map((n) => n.node_id).join('|') : (newNodeDefs[0]?.setWith || '');
      const blueBoxDefs = [];
      positions.forEach((pos) => {
        const key = `${pos.x},${pos.y}`;
        if (coveredKeys.has(key)) return;
        const bbId = `EMPTY-S${pos.x},${pos.y}`;
        const bbNd = { node_id: bbId, x: pos.x, y: pos.y, sku: '', setWith: newSetWith, setAvailable: setAvail, fix: false, _isBlueBox: true, _defaultSku: 'MOD-2DBC-GS', _glbUrl: '' };
        this.state.nodes.set(bbId, { nodeDef: bbNd, currentSku: '', originalSku: '', currentPrice: 0, originalPrice: 0 });
        blueBoxDefs.push(bbNd);
      });

      // Register new nodes in state
      newNodeDefs.forEach((newNd) => {
        const product = this.data.getProductBySku(newNd.sku);
        this.state.nodes.set(newNd.node_id, { nodeDef: newNd, currentSku: newNd.sku, originalSku: newNd.sku, currentPrice: product?.price || 0, originalPrice: product?.price || 0 });
      });

      await this.scene.replaceSet(groupIds, [...newNodeDefs, ...blueBoxDefs]);
      this._renderNodeList();
      this._renderTotals();
    }

    /* ── Sidebar node list ────────────────────────────────── */

    _renderNodeList() {
      const list = this._el('gb-node-list');
      if (!list) return;
      list.innerHTML = '';
      list.classList.toggle('gb-dev', this.data.devSkus !== null);

      // Swappable items first, fixed/locked items last; within each group sort by position
      const all = [];
      this.state.nodes.forEach((entry, nodeId) => all.push({ nodeId, entry }));
      all.sort((a, b) => {
        const aFix = a.entry.nodeDef.fix ? 1 : 0;
        const bFix = b.entry.nodeDef.fix ? 1 : 0;
        if (aFix !== bFix) return aFix - bFix;
        return this._nodeOrder(a.entry.nodeDef) - this._nodeOrder(b.entry.nodeDef);
      });
      all.forEach(({ nodeId, entry }) => list.appendChild(this._makeNodeRow(nodeId, entry)));
    }

    _renderGroupBlock(container, group) {
      group
        .sort((a, b) => this._nodeOrder(a.entry.nodeDef) - this._nodeOrder(b.entry.nodeDef))
        .forEach(({ nodeId, entry }) => container.appendChild(this._makeNodeRow(nodeId, entry)));
    }

    _makeNodeRow(nodeId, entry) {
      const devMode = this.data.devSkus !== null;
      const nd    = entry.nodeDef;
      const isFix = nd.fix;
      const xs    = Array.isArray(nd.x) ? nd.x : [nd.x];
      const ys    = Array.isArray(nd.y) ? nd.y : [nd.y];
      const coord = `S${xs.join('+')}·${ys.join('+')}`;

      const wrap = document.createElement('div');

      const btn = document.createElement('button');

      // BlueBox: empty slot awaiting an item
      if (nd._isBlueBox) {
        btn.className = 'gb-node-row gb-node-row--empty';
        btn.innerHTML = `
          <span class="gb-node-row__coord">${coord}</span>
          <span class="gb-node-row__thumb gb-node-row__thumb--empty">+</span>
          <span class="gb-node-row__body">
            <span class="gb-node-row__title">Empty Slot</span>
            <span class="gb-node-row__price">Click to add</span>
          </span>
          <span class="gb-node-row__swap">ADD →</span>
        `;
        btn.addEventListener('click', () => {
          this._el('gb-canvas-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          const canvas = this._el('gb-canvas');
          const rect   = canvas?.getBoundingClientRect() || { width: 300, height: 300 };
          this.scene?.selectNode(nodeId);
          this._handleNodeClick({ nodeId, anchor: { x: rect.width / 2, y: rect.height / 2 } });
        });
        if (!devMode) return btn;
        wrap.appendChild(btn);
        const dev = document.createElement('div');
        dev.className = 'gb-node-row__dev';
        dev.textContent = `${nodeId} | setWith: ${nd.setWith || '—'} | setAvail: ${nd.setAvailable || '—'}`;
        wrap.appendChild(dev);
        return wrap;
      }

      const product = this.data.getProductBySku(entry.currentSku);
      const missing = !product;

      btn.className = `gb-node-row${isFix ? ' gb-node-row--fix' : ''}`;

      const thumbClass = isFix ? 'gb-node-row__thumb--fix' : missing ? 'gb-node-row__thumb--missing' : '';
      const thumbContent = product?.featured_image
        ? `<img src="${product.featured_image}" alt="" loading="lazy">`
        : isFix ? 'FIX' : missing ? '?' : entry.currentSku.slice(-3);

      const delta     = entry.currentPrice - entry.originalPrice;
      const deltaStr  = delta !== 0 ? ` (${delta > 0 ? '+' : ''}${this._money(delta)})` : '';

      btn.innerHTML = `
        <span class="gb-node-row__coord">${coord}</span>
        <span class="gb-node-row__thumb ${thumbClass}">${thumbContent}</span>
        <span class="gb-node-row__body">
          <span class="gb-node-row__title">${product?.title || entry.currentSku}</span>
          <span class="gb-node-row__price">${product?.price_formatted || '—'}${deltaStr}</span>
        </span>
        <span class="gb-node-row__swap">${isFix ? 'FIXED' : 'SWAP →'}</span>
      `;

      if (!isFix) {
        btn.addEventListener('click', () => {
          this._el('gb-canvas-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          const canvas = this._el('gb-canvas');
          const rect   = canvas?.getBoundingClientRect() || { width: 300, height: 300 };
          this.scene?.selectNode(nodeId);
          this._handleNodeClick({ nodeId, anchor: { x: rect.width / 2, y: rect.height / 2 } });
        });
      }

      if (!devMode) return btn;

      wrap.appendChild(btn);
      const dev = document.createElement('div');
      dev.className = 'gb-node-row__dev';
      dev.textContent = `${nodeId} | sku: ${entry.currentSku} | setWith: ${nd.setWith || '—'} | setAvail: ${nd.setAvailable || '—'} | orig: ${entry.originalSku} | $${(entry.currentPrice/100).toFixed(2)}`;
      wrap.appendChild(dev);
      return wrap;
    }

    _nodeOrder(nd) {
      const xs = Array.isArray(nd.x) ? nd.x : [nd.x];
      const ys = Array.isArray(nd.y) ? nd.y : [nd.y];
      return xs[0] * 100 + (ys[0] || 1);
    }

    /* ── Totals ───────────────────────────────────────────── */

    _renderTotals() {
      const totalsEl = this._el('gb-totals');
      if (!totalsEl || !this.calculator) return;

      const nodes = [...this.state.nodes.values()].map((e) => ({
        nodeId:        [...this.state.nodes.entries()].find(([, v]) => v === e)?.[0],
        originalSku:   e.originalSku,
        currentSku:    e.currentSku,
        originalPrice: e.originalPrice,
        currentPrice:  e.currentPrice,
      }));

      const result = this.calculator.compute(nodes);

      totalsEl.innerHTML = `
        <div class="gb-totals__row">
          <span>Base</span>
          <span>${this._money(result.basicPrice)}</span>
        </div>
        ${result.delta !== 0 ? `
        <div class="gb-totals__row">
          <span>Upgrades</span>
          <span>${result.delta >= 0 ? '+' : ''}${this._money(result.delta)}</span>
        </div>` : ''}
        ${result.discountAmount > 0 ? `
        <div class="gb-totals__row gb-totals__row--discount">
          <span>Bundle ${result.discountPercent}% off</span>
          <span>−${this._money(result.discountAmount)}</span>
        </div>` : ''}
        <div class="gb-totals__row gb-totals__row--final">
          <span>TOTAL</span>
          <span>${result.finalFormatted}</span>
        </div>
      `;
    }

    /* ── Cart ─────────────────────────────────────────────── */

    async _addToCart() {
      const btn = this._el('gb-checkout');
      if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }

      const bundleId = `gb-${Date.now()}`;
      const items    = [];

      this.state.nodes.forEach((entry, nodeId) => {
        const product = this.data.getProductBySku(entry.currentSku);
        if (!product?.variant_id) return;
        items.push({
          id:         product.variant_id,
          quantity:   1,
          properties: {
            _bundle_id:   bundleId,
            _bundle_node: nodeId,
            _bundle_sku:  entry.currentSku,
          },
        });
      });

      if (!items.length) {
        this._toast('Cart Error', 'No products to add — ensure all items have a matching Shopify product.', 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = 'ADD TO CART <span class="gb-checkout-btn__arrow">→</span>'; }
        return;
      }

      try {
        const res = await fetch('/cart/add.js', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ items }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this._toast('Added to Cart', `${items.length} item${items.length === 1 ? '' : 's'} added successfully.`, 'info');
        document.dispatchEvent(new CustomEvent('cart:updated'));
      } catch (err) {
        this._toast('Cart Error', err.message, 'error');
      } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = 'ADD TO CART <span class="gb-checkout-btn__arrow">→</span>'; }
      }
    }

    /* ── Loading overlay ──────────────────────────────────── */

    _showLoading(show) {
      const el = this._el('gb-loading');
      if (el) el.hidden = !show;
    }

    _setProgress(pct) {
      const bar = this._el('gb-loading')?.querySelector('.gb-loading__bar span');
      if (bar) bar.style.width = `${Math.min(100, pct)}%`;
    }

    /* ── Toast ────────────────────────────────────────────── */

    _toast(title, message, type = 'info') {
      const host = this._el('gb-toast');
      if (!host) { console.warn(`[GB] ${title}: ${message}`); return; }

      const el = document.createElement('div');
      el.className = `gb-toast gb-toast--${type}`;
      el.innerHTML = `
        <span class="gb-toast__title">${title}</span>
        <button class="gb-toast__close" aria-label="Dismiss">×</button>
        <span class="gb-toast__msg">${message}</span>
      `;
      el.querySelector('.gb-toast__close').addEventListener('click', () => this._dismissToast(el));
      host.appendChild(el);
      requestAnimationFrame(() => el.classList.add('gb-toast--in'));
      setTimeout(() => this._dismissToast(el), 6000);
    }

    _dismissToast(el) {
      el.classList.replace('gb-toast--in', 'gb-toast--leaving');
      el.addEventListener('transitionend', () => el.remove(), { once: true });
    }

    /* ── Dimension overlay ────────────────────────────────── */

    _updateDims() {
      const dimsEl = this._el('gb-dims');
      if (!dimsEl || !this.scene) return;

      const dims = this.scene.getDimensions();
      if (!dims) { dimsEl.innerHTML = ''; return; }

      const { box, widthCm, heightCm, depthCm } = dims;
      const W = this.scene.canvas.clientWidth;
      const H = this.scene.canvas.clientHeight;

      const p = (x, y, z) => this.scene.projectToScreen(x, y, z);

      // Projected corners used for dimension lines
      const bfl = p(box.min.x, box.min.y, box.max.z); // bottom-front-left
      const bfr = p(box.max.x, box.min.y, box.max.z); // bottom-front-right
      const tfr = p(box.max.x, box.max.y, box.max.z); // top-front-right
      const bbr = p(box.max.x, box.min.y, box.min.z); // bottom-back-right (depth end)

      // Screen-space centre of the whole model (for outward-offset direction)
      const ctr = p(
        (box.min.x + box.max.x) / 2,
        (box.min.y + box.max.y) / 2,
        (box.min.z + box.max.z) / 2,
      );

      const ns  = 'http://www.w3.org/2000/svg';
      const ACC = '#00bfff';
      const BG  = 'rgba(8,14,22,0.90)';
      const OFF = 22;   // px offset from model edge to dimension line
      const ARR = 5;    // arrowhead size

      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('width',   String(W));
      svg.setAttribute('height',  String(H));
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.style.cssText = 'position:absolute;inset:0;overflow:visible;pointer-events:none;';

      const mkEl = (tag, attrs) => {
        const e = document.createElementNS(ns, tag);
        Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, String(v)));
        return e;
      };

      // Build one dimension annotation: line + arrows + label chip
      // p1/p2 = projected model edge endpoints
      // label = text string
      // Returns false if a point is well outside the canvas (skip dim line)
      const visible = (pt) => pt.x > -80 && pt.x < W + 80 && pt.y > -80 && pt.y < H + 80;

      const makeDim = (p1, p2, label) => {
        const g    = document.createElementNS(ns, 'g');

        // Skip entirely if both endpoints are off-screen
        if (!visible(p1) && !visible(p2)) return g;

        const dx   = p2.x - p1.x,  dy   = p2.y - p1.y;
        const len  = Math.hypot(dx, dy);
        if (len < 12) return g;  // too small to render

        // Unit vector along line and its perpendicular (CCW rotation)
        const ux = dx / len,   uy = dy / len;
        const nx = -uy,        ny = ux;

        // Pick perpendicular direction pointing AWAY from model centre
        const midX = (p1.x + p2.x) / 2,  midY = (p1.y + p2.y) / 2;
        const dot  = nx * (ctr.x - midX) + ny * (ctr.y - midY);
        const sign = dot > 0 ? -1 : 1;
        const ox   = nx * sign * OFF,  oy = ny * sign * OFF;

        // Offset endpoints
        const ax1 = p1.x + ox,  ay1 = p1.y + oy;
        const ax2 = p2.x + ox,  ay2 = p2.y + oy;

        // Extension lines (thin, faint)
        g.appendChild(mkEl('line', { x1: p1.x, y1: p1.y, x2: ax1, y2: ay1,
          stroke: ACC, 'stroke-width': '0.5', opacity: '0.35' }));
        g.appendChild(mkEl('line', { x1: p2.x, y1: p2.y, x2: ax2, y2: ay2,
          stroke: ACC, 'stroke-width': '0.5', opacity: '0.35' }));

        // Main dimension line
        g.appendChild(mkEl('line', { x1: ax1, y1: ay1, x2: ax2, y2: ay2,
          stroke: ACC, 'stroke-width': '1', opacity: '0.6' }));

        // Arrowhead at ax1 (pointing inward toward ax2)
        const in1x = ax1 + ux * ARR,  in1y = ay1 + uy * ARR;
        g.appendChild(mkEl('polygon', {
          points: `${ax1},${ay1} ${in1x + ny * ARR * 0.55},${in1y - nx * ARR * 0.55} ${in1x - ny * ARR * 0.55},${in1y + nx * ARR * 0.55}`,
          fill: ACC, opacity: '0.7',
        }));
        // Arrowhead at ax2 (pointing inward toward ax1)
        const in2x = ax2 - ux * ARR,  in2y = ay2 - uy * ARR;
        g.appendChild(mkEl('polygon', {
          points: `${ax2},${ay2} ${in2x + ny * ARR * 0.55},${in2y - nx * ARR * 0.55} ${in2x - ny * ARR * 0.55},${in2y + nx * ARR * 0.55}`,
          fill: ACC, opacity: '0.7',
        }));

        // Label chip — clamped to stay inside the canvas
        const tw   = label.length * 6.8 + 14;
        const th   = 18;
        const PAD  = 6;
        const rawX = midX + ox * 1.4;
        const rawY = midY + oy * 1.4;
        const lx   = Math.max(PAD + tw / 2, Math.min(W - PAD - tw / 2, rawX));
        const ly   = Math.max(PAD + th / 2, Math.min(H - PAD - th / 2, rawY));

        g.appendChild(mkEl('rect', {
          x: lx - tw / 2, y: ly - th / 2, width: tw, height: th,
          fill: BG, rx: '3', stroke: ACC, 'stroke-width': '0.75',
        }));
        const txt = mkEl('text', {
          x: lx, y: ly,
          fill: ACC,
          'font-family': "'Archivo', 'ui-sans-serif', sans-serif",
          'font-size': '11',
          'font-weight': '700',
          'text-anchor': 'middle',
          'dominant-baseline': 'middle',
        });
        txt.textContent = label;
        g.appendChild(txt);
        return g;
      };

      svg.appendChild(makeDim(bfl, bfr, `${widthCm} cm`));   // width  — bottom edge
      svg.appendChild(makeDim(bfr, tfr, `${heightCm} cm`));  // height — right edge
      svg.appendChild(makeDim(bfr, bbr, `${depthCm} cm`));   // depth  — front→back edge

      dimsEl.innerHTML = '';
      dimsEl.appendChild(svg);
    }

    /* ── Helpers ──────────────────────────────────────────── */

    _money(cents) {
      const neg = cents < 0;
      const abs = Math.abs(cents);
      return (neg ? '-' : '') + '$' + (abs / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
  }

  window.GB.Main = GBMain;
})();
