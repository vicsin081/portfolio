/* ============================================================================
   gb-ui-menu.js
   ----------------------------------------------------------------------------
   Two-option circular popup: left half = SINGLE (in-place SKU swap),
   right half = SET (structural layout swap).

   Appears centered on the clicked component. Clicking a half fires the
   corresponding callback and closes the menu. The caller then opens the
   detail radial wheel (gb-ui-wheel.js) with the specific alternatives.

   States per half:
     available  — clickable, full colour
     disabled   — grayed out, pointer-events none (no alternatives exist)
     hidden     — not rendered (isSet=true → Single is never shown)
     fix        — special badge replaces both halves (fixed item, no swaps)

   Exposes: window.GB.Menu
   ============================================================================ */

(function () {
  'use strict';
  window.GB = window.GB || {};

  const SVG_NS  = 'http://www.w3.org/2000/svg';
  const SIZE    = 220;   // px — outer diameter
  const HUB_R   = 34;    // px — centre dead-zone radius
  const OUTER_R = SIZE / 2 - 6;

  class GBMenu {
    constructor(container, { onSingle, onSet, onClose }) {
      this.container = container;
      this.onSingle  = onSingle || (() => {});
      this.onSet     = onSet    || (() => {});
      this.onClose   = onClose  || (() => {});
      this.isOpen    = false;

      this._handleKey = this._handleKey.bind(this);
    }

    /**
     * @param {Object} opts
     * @param {{x:number, y:number}} opts.anchor  — screen coordinates (canvas-relative)
     * @param {boolean} opts.singleAvailable  — false = gray out Single half
     * @param {boolean} opts.setAvailable     — false = gray out Set half
     * @param {boolean} opts.isFix            — true = show locked badge instead
     * @param {string}  opts.nodeId
     */
    open({ anchor, singleAvailable, setAvailable, isFix, nodeId }) {
      this.close({ silent: true });

      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', 'gb-menu');
      svg.setAttribute('width',   String(SIZE));
      svg.setAttribute('height',  String(SIZE));
      svg.setAttribute('viewBox', `${-SIZE/2} ${-SIZE/2} ${SIZE} ${SIZE}`);
      svg.setAttribute('role',    'dialog');
      svg.setAttribute('aria-label', 'Component options');
      svg.style.setProperty('--gb-menu-size', `${SIZE}px`);

      if (isFix) {
        this._renderFixBadge(svg);
      } else {
        this._renderHalf(svg, 'single', singleAvailable);
        this._renderHalf(svg, 'set',    setAvailable);
      }

      this._renderHub(svg, isFix);

      const wrap = document.createElement('div');
      wrap.className = 'gb-menu-wrap';
      wrap.style.left = `${anchor.x}px`;
      wrap.style.top  = `${anchor.y}px`;
      wrap.style.setProperty('--gb-menu-size', `${SIZE}px`);
      wrap.appendChild(svg);

      this._backdropHandler = (e) => {
        if (!wrap.contains(e.target)) this.close();
      };
      setTimeout(() => document.addEventListener('pointerdown', this._backdropHandler), 0);

      this.container.innerHTML = '';
      this.container.appendChild(wrap);
      this.container.setAttribute('aria-hidden', 'false');
      this.container.classList.add('gb-menu-layer--open');

      requestAnimationFrame(() => svg.classList.add('gb-menu--open'));

      document.addEventListener('keydown', this._handleKey);
      this._svg    = svg;
      this._nodeId = nodeId;
      this.isOpen  = true;
    }

    close({ silent = false } = {}) {
      if (!this.isOpen && !silent) return;
      this.container.innerHTML = '';
      this.container.setAttribute('aria-hidden', 'true');
      this.container.classList.remove('gb-menu-layer--open');
      document.removeEventListener('keydown', this._handleKey);
      if (this._backdropHandler) {
        document.removeEventListener('pointerdown', this._backdropHandler);
        this._backdropHandler = null;
      }
      this.isOpen = false;
      if (!silent) this.onClose();
    }

    /* ── Private renderers ─────────────────────────────────── */

    _renderHalf(svg, side, available) {
      const isSingle = (side === 'single');
      // Left half: arc from 90° to 270° (π/2 to 3π/2) → negative X
      // Right half: arc from -90° to 90°              → positive X
      const a0 = isSingle ?  Math.PI / 2 : -Math.PI / 2;
      const a1 = isSingle ?  3 * Math.PI / 2 : Math.PI / 2;

      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', [
        'gb-menu__half',
        `gb-menu__half--${side}`,
        available ? '' : 'gb-menu__half--disabled',
      ].join(' ').trim());

      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', this._halfPath(a0, a1, HUB_R, OUTER_R));
      path.setAttribute('class', `gb-menu__fill-${side}`);
      g.appendChild(path);

      // Label
      const labelAngle = isSingle ? Math.PI : 0;
      const labelR     = (HUB_R + OUTER_R) / 2;
      const lx         = Math.cos(labelAngle) * labelR;
      const ly         = Math.sin(labelAngle) * labelR;

      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x',  String(lx));
      text.setAttribute('y',  String(ly));
      text.setAttribute('class', `gb-menu__label gb-menu__label--${side}`);
      text.textContent = isSingle ? 'SINGLE' : 'SET';
      g.appendChild(text);


      if (available) {
        g.addEventListener('click', (e) => {
          e.stopPropagation();
          this.close({ silent: true });
          if (isSingle) this.onSingle(this._nodeId);
          else          this.onSet(this._nodeId);
        });
      }

      svg.appendChild(g);
    }

    _renderHub(svg, isFix) {
      const hub = document.createElementNS(SVG_NS, 'circle');
      hub.setAttribute('r', String(HUB_R));
      hub.setAttribute('class', 'gb-menu__hub');
      svg.appendChild(hub);

      if (isFix) {
        const badge = document.createElementNS(SVG_NS, 'circle');
        badge.setAttribute('r', String(HUB_R * 0.82));
        badge.setAttribute('class', 'gb-menu__fix-badge');
        svg.appendChild(badge);

        const txt = document.createElementNS(SVG_NS, 'text');
        txt.setAttribute('class', 'gb-menu__fix-text');
        txt.setAttribute('y', '0');
        txt.textContent = 'FIXED';
        svg.appendChild(txt);
      } else {
        const txt = document.createElementNS(SVG_NS, 'text');
        txt.setAttribute('class', 'gb-menu__hub-text');
        txt.textContent = 'SWAP';
        svg.appendChild(txt);
      }
    }

    _renderFixBadge(svg) {
      // Full circle grayed out background
      const bg = document.createElementNS(SVG_NS, 'circle');
      bg.setAttribute('r', String(OUTER_R));
      bg.setAttribute('fill', 'rgba(255,77,109,0.08)');
      bg.setAttribute('stroke', 'rgba(255,77,109,0.3)');
      bg.setAttribute('stroke-width', '1');
      svg.appendChild(bg);
    }

    /* ── Geometry ──────────────────────────────────────────── */

    _halfPath(a0, a1, rInner, rOuter) {
      const x0o = Math.cos(a0) * rOuter, y0o = Math.sin(a0) * rOuter;
      const x1o = Math.cos(a1) * rOuter, y1o = Math.sin(a1) * rOuter;
      const x0i = Math.cos(a0) * rInner, y0i = Math.sin(a0) * rInner;
      const x1i = Math.cos(a1) * rInner, y1i = Math.sin(a1) * rInner;
      const largeArc = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
      return [
        `M ${x0o} ${y0o}`,
        `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x1o} ${y1o}`,
        `L ${x1i} ${y1i}`,
        `A ${rInner} ${rInner} 0 ${largeArc} 0 ${x0i} ${y0i}`,
        'Z',
      ].join(' ');
    }

    _handleKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    }
  }

  window.GB.Menu = GBMenu;
})();
