/* ============================================================================
   gb-shopify-data.js
   ----------------------------------------------------------------------------
   Parses JSON blobs embedded by the Liquid section and exposes lookup helpers.

   Data blobs expected (by element id):
     gb-products-{sectionId}   — array from gb-products-json.liquid
     gb-config-{sectionId}     — object from gb-config-json.liquid
     gb-base-prices-{sectionId}— { "4": cents, "5": cents, "6": cents }
     gb-dev-skus-{sectionId}   — optional dev override map

   Exposes: window.GB.Data
   ============================================================================ */

(function () {
  'use strict';
  window.GB = window.GB || {};

  class GBData {
    constructor(sectionId) {
      this.sectionId = sectionId;

      this.products   = this._readJson(`gb-products-${sectionId}`)    || [];
      this.config     = this._readJson(`gb-config-${sectionId}`)      || {};
      this.basePrices = this._readJson(`gb-base-prices-${sectionId}`) || {};
      this.glbUrls    = this._readJson(`gb-glb-urls-${sectionId}`)    || {};
      if (!document.getElementById(`gb-glb-urls-${sectionId}`)) {
        console.error(`[GB] WARNING: #gb-glb-urls-${sectionId} element not found — GLBs will not load. Redeploy the section template.`);
      } else {
        console.log(`[GB] glbUrls loaded: ${Object.keys(this.glbUrls).length} entries`, this.glbUrls);
      }
      this.devSkus    = this._readJson(`gb-dev-skus-${sectionId}`)    || null;

      this.config.presets      = this.config.presets      || {};
      this.config.single_swaps = this.config.single_swaps || {};
      this.config.sets         = this.config.sets         || {};

      this.bySku       = new Map();
      this.byVariantId = new Map();

      this.products.forEach((p) => {
        if (p.sku)        this.bySku.set(p.sku, p);
        if (p.variant_id) this.byVariantId.set(String(p.variant_id), p);
      });

      // Inject dev-mode placeholder products
      if (this.devSkus) {
        Object.entries(this.devSkus).forEach(([sku, info]) => {
          if (this.bySku.has(sku)) return;
          this.bySku.set(sku, {
            sku, title: info.title || sku,
            variant_id: null, price: info.price || 0,
            price_formatted: info.price_formatted || '$0.00',
            available: true, featured_image: null,
            handle: null, _synthetic: true,
          });
        });
      }
    }

    _readJson(id) {
      const el = document.getElementById(id);
      if (!el) return null;
      try { return JSON.parse(el.textContent); }
      catch (err) { console.error(`[GB] Failed to parse #${id}`, err); return null; }
    }

    /* ── Product lookups ─────────────────────────────────── */

    getProductBySku(sku)        { return this.bySku.get(sku) || null; }
    getProductByVariantId(id)   { return this.byVariantId.get(String(id)) || null; }
    getAllSkus()                 { return Array.from(this.bySku.keys()); }
    hasProduct(sku)              { return this.bySku.has(sku); }

    /* ── Preset nodes ────────────────────────────────────── */

    /** Returns the nodes array for the given preset (4, 5, or 6). */
    getPresetNodes(preset) {
      const p = this.config.presets[String(preset)];
      return (p && Array.isArray(p.nodes)) ? p.nodes : [];
    }

    getAvailablePresets() {
      return Object.keys(this.config.presets).map(Number).sort((a, b) => a - b);
    }

    /* ── Layout dimensions ───────────────────────────────── */

    getTierHeight()   { return Number(this.config.tier_height_m)  || 0.85; }
    getColumnWidth()  { return Number(this.config.column_width_m) || 0.9; }

    /* ── Swap rules ──────────────────────────────────────── */

    /**
     * Returns single-swap alternatives for a SKU, filtered to products that
     * exist in the collection (or dev skus). First entry = source SKU.
     */
    getSingleSwaps(sku) {
      const list = this.config.single_swaps[sku];
      if (!list || !Array.isArray(list)) return [sku];
      return list.filter((s) => this.bySku.has(s));
    }

    /**
     * Returns the set options for an availableSet id.
     * Each option: { set_id, label, sku, nodes[] }
     */
    getSets(availableSetId) {
      if (!availableSetId) return [];
      return this.config.sets[availableSetId] || [];
    }

    /* ── Base price ──────────────────────────────────────── */

    /** Returns base price in cents for the given preset size. */
    getBasePrice(preset) {
      return Number(this.basePrices[String(preset)]) || 0;
    }

    /* ── GLB resolution ──────────────────────────────────── */

    /**
     * Resolves the CDN URL for a SKU's .glb file.
     * Priority:  glb: tag → product.glb_url → GB_GLB_URL_PATTERN → ''
     */
    glbUrlFor(sku) {
      // 1. Product tag override: "glb:https://..."
      const product = this.getProductBySku(sku);
      if (product && Array.isArray(product.tags)) {
        const tag = product.tags.find((t) => typeof t === 'string' && t.startsWith('glb:'));
        if (tag) return tag.slice(4);
      }
      // 2. Explicit URL from product object
      if (product && product.glb_url) return product.glb_url;
      // 3. Pre-rendered per-SKU URL blob (correct version hash per file)
      if (this.glbUrls[sku]) return this.glbUrls[sku];
      return '';
    }
  }

  window.GB.Data = GBData;
})();
