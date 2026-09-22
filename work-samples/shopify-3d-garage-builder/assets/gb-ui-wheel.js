/* ============================================================================
   gb-ui-wheel.js
   ----------------------------------------------------------------------------
   Radial selection wheel for detail alternatives (opened after picking
   Single or Set from the two-option menu). Renders N wedges as an SVG
   overlay, with thumbnails and price labels.

   item shape: {
     sku?:            string          (may be absent for config-type items)
     type?:           'sku'|'config'  (default 'sku')
     title:           string
     price_formatted: string
     thumbnail?:      string          (image URL)
     disabled?:       boolean
     isCurrent?:      boolean         (used by config items)
     currentDelta?:   string          (e.g. "+$50")
   }

   Exposes: window.GB.Wheel
   ============================================================================ */

(function () {
  'use strict';
  window.GB = window.GB || {};

  const SVG_NS = 'http://www.w3.org/2000/svg';

  class GBWheel {
    constructor(container, { onSelect, onClose }) {
      this.container = container;
      this.onSelect  = onSelect || (() => {});
      this.onClose   = onClose  || (() => {});
      this.isOpen    = false;
      this._activeIndex = -1;
      this._items = [];

      this._handleKey          = this._handleKey.bind(this);
      this._handlePointerMove  = this._handlePointerMove.bind(this);
    }

    /**
     * @param {{ items, anchor, currentSku }} opts
     */
    open({ items, anchor, currentSku }) {
      this.close({ silent: true });
      this._items = items || [];
      if (!this._items.length) return;

      const n        = this._items.length;
      const smallSide = Math.min(window.innerWidth, window.innerHeight);
      const isMobile  = smallSide < 600;
      const maxR      = isMobile ? smallSide * 0.38 : Math.min(smallSide * 0.32, 280);
      const minR      = isMobile ? 90 : 160;
      const radius    = Math.min(maxR, Math.max(minR, 100 + n * 24));
      const size      = radius * 2 + 60;

      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class',    'gb-wheel');
      svg.setAttribute('width',    String(size));
      svg.setAttribute('height',   String(size));
      svg.setAttribute('viewBox',  `${-size/2} ${-size/2} ${size} ${size}`);
      svg.setAttribute('role',     'menu');
      svg.setAttribute('aria-label', 'Select replacement component');

      const slice  = (2 * Math.PI) / n;
      const start0 = -Math.PI / 2 - slice / 2;
      const defs   = document.createElementNS(SVG_NS, 'defs');
      svg.appendChild(defs);

      this._wedgeEls = [];

      this._items.forEach((item, i) => {
        const a0    = start0 + i * slice;
        const a1    = a0 + slice;
        const inner = radius * 0.35;
        const outer = radius;

        const wedge = document.createElementNS(SVG_NS, 'g');
        wedge.setAttribute('class', 'gb-wheel__wedge');
        wedge.setAttribute('data-index', String(i));
        wedge.setAttribute('data-sku',   item.sku || '');

        if (item.type === 'config') wedge.classList.add('gb-wheel__wedge--config');

        const isCurrent = item.type === 'config'
          ? item.isCurrent
          : (item.sku === currentSku);
        if (isCurrent)   wedge.classList.add('gb-wheel__wedge--current');
        if (item.disabled) wedge.classList.add('gb-wheel__wedge--disabled');

        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d',     this._annularPath(a0, a1, inner, outer));
        path.setAttribute('class', 'gb-wheel__wedge-fill');
        wedge.appendChild(path);

        // Clip path for thumbnail
        const clipId = `gb-clip-${i}-${Math.random().toString(36).slice(2, 7)}`;
        const clip   = document.createElementNS(SVG_NS, 'clipPath');
        clip.setAttribute('id', clipId);
        const cp = document.createElementNS(SVG_NS, 'path');
        cp.setAttribute('d', this._annularPath(a0, a1, inner, outer));
        clip.appendChild(cp);
        defs.appendChild(clip);

        const aMid = (a0 + a1) / 2;
        const midR = (inner + outer) / 2;
        const cx   = Math.cos(aMid) * midR;
        const cy   = Math.sin(aMid) * midR;

        if (item.thumbnail) {
          // Fill the entire wedge with the image — clip path handles the shape.
          // Center the image on (cx, cy) so the product subject is in view.
          const imgSize = outer * 2;
          const img = document.createElementNS(SVG_NS, 'image');
          img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', item.thumbnail);
          img.setAttribute('href',               item.thumbnail);
          img.setAttribute('x',                  String(cx - imgSize / 2));
          img.setAttribute('y',                  String(cy - imgSize / 2));
          img.setAttribute('width',              String(imgSize));
          img.setAttribute('height',             String(imgSize));
          img.setAttribute('clip-path',          `url(#${clipId})`);
          img.setAttribute('preserveAspectRatio','xMidYMid slice');
          img.setAttribute('class',              'gb-wheel__thumb');
          wedge.appendChild(img);
        } else {
          const label = document.createElementNS(SVG_NS, 'text');
          label.setAttribute('x', String(cx));
          label.setAttribute('y', String(cy));
          label.setAttribute('class', 'gb-wheel__label');
          label.setAttribute('text-anchor',       'middle');
          label.setAttribute('dominant-baseline', 'middle');
          label.textContent = this._truncate(item.title, n > 6 ? 9 : 14);
          wedge.appendChild(label);
        }

        wedge.addEventListener('click', (e) => {
          e.stopPropagation();
          if (item.disabled) return;
          this._select(i);
        });
        wedge.addEventListener('mouseenter', () => this._setActive(i));

        svg.appendChild(wedge);
        this._wedgeEls.push(wedge);
      });

      // Hub
      const hub = document.createElementNS(SVG_NS, 'circle');
      hub.setAttribute('r',     String(radius * 0.32));
      hub.setAttribute('class', 'gb-wheel__hub');
      svg.appendChild(hub);

      const hubLabel = document.createElementNS(SVG_NS, 'text');
      hubLabel.setAttribute('class',              'gb-wheel__hub-label');
      hubLabel.setAttribute('text-anchor',        'middle');
      hubLabel.setAttribute('dominant-baseline',  'middle');
      hubLabel.setAttribute('y', '-6');
      hubLabel.textContent = 'SELECT';
      svg.appendChild(hubLabel);

      this._hubDetail = document.createElementNS(SVG_NS, 'text');
      this._hubDetail.setAttribute('class',             'gb-wheel__hub-detail');
      this._hubDetail.setAttribute('text-anchor',       'middle');
      this._hubDetail.setAttribute('dominant-baseline', 'middle');
      this._hubDetail.setAttribute('y', '14');
      this._hubDetail.textContent = `${n} option${n === 1 ? '' : 's'}`;
      svg.appendChild(this._hubDetail);

      // Position wrap
      const wrap = document.createElement('div');
      wrap.className = 'gb-wheel-wrap';
      wrap.style.left = `${anchor.x}px`;
      wrap.style.top  = `${anchor.y}px`;
      wrap.style.setProperty('--gb-wheel-size', `${size}px`);
      wrap.appendChild(svg);

      this._backdropHandler = (e) => {
        if (!wrap.contains(e.target)) this.close();
      };
      setTimeout(() => document.addEventListener('pointerdown', this._backdropHandler), 0);

      this.container.innerHTML = '';
      this.container.appendChild(wrap);
      this.container.setAttribute('aria-hidden', 'false');
      this.container.classList.add('gb-wheel-layer--open');

      requestAnimationFrame(() => svg.classList.add('gb-wheel--open'));

      document.addEventListener('keydown', this._handleKey);
      svg.addEventListener('pointermove', this._handlePointerMove);
      this._svg    = svg;
      this._radius = radius;
      this.isOpen  = true;
    }

    close({ silent = false } = {}) {
      if (!this.isOpen && !silent) return;
      this.container.innerHTML = '';
      this.container.setAttribute('aria-hidden', 'true');
      this.container.classList.remove('gb-wheel-layer--open');
      document.removeEventListener('keydown', this._handleKey);
      if (this._backdropHandler) {
        document.removeEventListener('pointerdown', this._backdropHandler);
        this._backdropHandler = null;
      }
      this.isOpen  = false;
      this._items  = [];
      this._wedgeEls = [];
      if (!silent) this.onClose();
    }

    _select(i) {
      const item = this._items[i];
      if (!item || item.disabled) return;
      this.onSelect(item);
      this.close({ silent: true });
    }

    _setActive(i) {
      if (i === this._activeIndex) return;
      if (this._wedgeEls[this._activeIndex]) {
        this._wedgeEls[this._activeIndex].classList.remove('gb-wheel__wedge--active');
      }
      this._activeIndex = i;
      if (this._wedgeEls[i]) {
        this._wedgeEls[i].classList.add('gb-wheel__wedge--active');
        const item = this._items[i];
        if (this._hubDetail && item) {
          this._hubDetail.textContent =
            item.price_formatted ||
            (item.type === 'config' ? item.title : item.sku) ||
            '';
        }
      }
    }

    _handleKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault(); this.close();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        this._setActive((this._activeIndex + 1 + this._items.length) % this._items.length);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = this._activeIndex <= 0 ? this._items.length - 1 : this._activeIndex - 1;
        this._setActive(prev);
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (this._activeIndex >= 0) { e.preventDefault(); this._select(this._activeIndex); }
      }
    }

    _handlePointerMove(e) {
      const rect = this._svg.getBoundingClientRect();
      const dx   = e.clientX - (rect.left + rect.width  / 2);
      const dy   = e.clientY - (rect.top  + rect.height / 2);
      if (Math.hypot(dx, dy) < this._radius * 0.32) return;

      const n      = this._items.length;
      const slice  = (2 * Math.PI) / n;
      let angle    = Math.atan2(dy, dx);
      let norm     = angle - (-Math.PI / 2 - slice / 2);
      while (norm < 0)             norm += 2 * Math.PI;
      while (norm >= 2 * Math.PI) norm -= 2 * Math.PI;
      this._setActive(Math.floor(norm / slice));
    }

    _annularPath(a0, a1, rInner, rOuter) {
      const x0o = Math.cos(a0) * rOuter, y0o = Math.sin(a0) * rOuter;
      const x1o = Math.cos(a1) * rOuter, y1o = Math.sin(a1) * rOuter;
      const x0i = Math.cos(a0) * rInner, y0i = Math.sin(a0) * rInner;
      const x1i = Math.cos(a1) * rInner, y1i = Math.sin(a1) * rInner;
      const lg  = (a1 - a0) > Math.PI ? 1 : 0;
      return [`M ${x0o} ${y0o}`, `A ${rOuter} ${rOuter} 0 ${lg} 1 ${x1o} ${y1o}`,
              `L ${x1i} ${y1i}`, `A ${rInner} ${rInner} 0 ${lg} 0 ${x0i} ${y0i}`, 'Z'].join(' ');
    }

    _truncate(str, max) {
      if (!str) return '';
      str = String(str);
      return str.length > max ? str.slice(0, max - 1) + '…' : str;
    }
  }

  window.GB.Wheel = GBWheel;
})();
