/* ============================================================================
   gb-calculator.js
   ----------------------------------------------------------------------------
   Computes the final price for the current garage configuration.

   Formula:
     finalPrice = basicPrice + Σ (currentPrice - originalPrice) per node
                - (bundleDiscount % of finalPrice before discount)

   Exposes: window.GB.Calculator
   ============================================================================ */

(function () {
  'use strict';
  window.GB = window.GB || {};

  class GBCalculator {
    /**
     * @param {number} basicPrice        — base price in cents (from preset product)
     * @param {number} discountPercent   — 0–100 bundle discount
     */
    constructor(basicPrice, discountPercent) {
      this.basicPrice      = basicPrice      || 0;
      this.discountPercent = discountPercent || 0;
    }

    /**
     * Compute the price breakdown for the current node state.
     *
     * @param {Array<{originalSku:string, currentSku:string, originalPrice:number, currentPrice:number}>} nodes
     * @returns {{ subtotal, delta, discountAmount, finalPrice, finalFormatted,
     *             rows: Array<{nodeId, originalSku, currentSku, deltaPrice}> }}
     */
    compute(nodes) {
      let delta = 0;
      const rows = [];

      nodes.forEach((n) => {
        const d = (n.currentPrice || 0) - (n.originalPrice || 0);
        delta += d;
        rows.push({
          nodeId:      n.nodeId,
          originalSku: n.originalSku,
          currentSku:  n.currentSku,
          deltaPrice:  d,
        });
      });

      // Discount applies only to the price delta (upgrades/downgrades), not the base price
      const discountAmount= delta !== 0 ? Math.round(delta * this.discountPercent / 100) : 0;
      const subtotal      = this.basicPrice + delta;
      const finalPrice    = Math.max(0, subtotal - discountAmount);

      return {
        basicPrice:     this.basicPrice,
        delta,
        subtotal,
        discountAmount,
        discountPercent: this.discountPercent,
        finalPrice,
        finalFormatted: this._money(finalPrice),
        rows,
      };
    }

    updateBasicPrice(cents)      { this.basicPrice      = cents || 0; }
    updateDiscountPercent(pct)   { this.discountPercent = pct   || 0; }

    _money(cents) {
      return '$' + (cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
  }

  window.GB.Calculator = GBCalculator;
})();
