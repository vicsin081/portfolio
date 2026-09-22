# Shopify 3D Garage Builder

An interactive 3D product configurator built as a Shopify theme section. Customers choose a garage
storage layout, swap individual cabinets or whole linked sets in a live WebGL scene, see the price
update with every change, and add the complete bundle to the cart in one click.

| | |
|---|---|
| **Context** | E-commerce feature for the company's Shopify store, Excel Intelligent Pty Ltd |
| **Users** | Online customers configuring modular garage storage |
| **Stack** | Shopify Liquid (Online Store 2.0), vanilla JavaScript, Three.js r160, GLTF and Draco loaders, Shopify Ajax Cart API |
| **Size** | About 3,300 lines across 10 source files |
| **Status** | Built for the live store; sanitised copy (3D models and store data not included) |
| **Engineering log** | [ENGINEERING-LOG.md](ENGINEERING-LOG.md) |

---

## Overview

**Problem.** Modular garage storage is sold as individual cabinets, workbenches and wall units
that fit together in many combinations. Product pages and photos could not show how a chosen
combination would look, what it would measure, or what it would cost as a whole, and customers
had to add each component to the cart separately.

**Solution.** A configurator section that starts from a preset layout (4, 5 or 6 slots) and
renders every component as a 3D model on a virtual garage wall. Clicking a component offers
alternatives for that item, or alternative configurations for its whole linked group. The price,
overall dimensions and component list update after each change, and the final bundle is added to
the cart as grouped line items.

**Design principle.** Layouts, swap rules and sets are data in a Liquid snippet, not code. The
merchandising team can change which products are offered where without changing JavaScript.

## Architecture

```
Shopify theme editor settings          Shopify collection
(base products, discount, collection)  (products, prices, variants)
            |                                   |
            v                                   v
+---------------------------------------------------------------+
| sections/garage-builder.liquid                                |
|   renders JSON blobs: config, products, base prices, GLB URLs |
+---------------------------------------------------------------+
            |
            v
      GB.Data (gb-shopify-data.js) - parses blobs, lookup helpers
            |
            v
      GB.Main (gb-main.js) - controller and state
       |          |            |              |
       v          v            v              v
   GB.Scene    GB.Menu      GB.Wheel     GB.Calculator
   3D scene    Single/Set   choose an    pricing
   (Three.js)  popup        alternative  (pure logic)
                                              |
                                              v
                                  POST /cart/add.js (bundle)
```

Everything is namespaced under one global `window.GB` object, and each section instance is scoped
by its Shopify `section.id`, so more than one builder can run on the same page.

## User flow

| Step | View | What happens |
|---|---|---|
| 1 | Landing | Preset buttons (4, 5 and 6 slots) with base prices from the configured base products |
| 2 | Builder | Three.js scene loads; each component is placed as a GLB model against the wall |
| 3 | Select | Clicking a component in the scene or the sidebar opens the Single / Set menu |
| 4 | Swap | A radial wheel lists alternatives, with thumbnail and price for each |
| 5 | Review | Sidebar shows every component and its price change; totals and a dimension overlay update |
| 6 | Checkout | All selected variants are posted to `/cart/add.js`, tagged with a shared bundle ID |

## Components

| File | Responsibility |
|---|---|
| `sections/garage-builder.liquid` | Section markup, theme-editor settings schema, JSON data blobs, script loading |
| `snippets/gb-config-json.liquid` | Preset layouts, single-swap rules and set definitions |
| `snippets/gb-products-json.liquid` | Renders the chosen Shopify collection as a JSON product array |
| `assets/gb-shopify-data.js` | Parses the JSON blobs and exposes lookups: product by SKU, swaps, sets, GLB URL (`GB.Data`) |
| `assets/gb-scene.js` | Three.js scene: GLB loading and caching, wall snap, stacking, repacking, raycasting, auto-zoom (`GB.Scene`) |
| `assets/gb-ui-menu.js` | Two-option Single / Set popup (`GB.Menu`) |
| `assets/gb-ui-wheel.js` | Radial selection wheel with keyboard navigation (`GB.Wheel`) |
| `assets/gb-calculator.js` | Pricing with no DOM dependency (`GB.Calculator`) |
| `assets/gb-main.js` | Controller: state, swaps, sidebar, totals, dimensions overlay, cart (`GB.Main`) |
| `assets/gb-styles.css` | Component styling |
| `tests/calculator.test.js` | Unit tests for the pricing module |

## Key features

| Feature | Detail |
|---|---|
| Data-driven layouts | Presets, swaps and sets declared in `gb-config-json.liquid`; no layout logic in JavaScript |
| Single and set swaps | Replace one item, or replace a whole linked group with a different configuration |
| Flexible set mapping | Handles one SKU per slot, one SKU spanning several slots, and sets whose size differs from the group, leaving re-fillable empty nodes where needed |
| Accurate stacking | Items sit on the measured height of the item below, not on a fixed tier height |
| Gap-free layout | After models load, columns are repacked by measured width and the arrangement is centred |
| Live dimensions | Width, height and depth in centimetres drawn over the scene after each change |
| Live pricing | Base price plus the sum of swap differences, with an optional bundle discount on the difference |
| Grouped cart lines | Each line item carries `_bundle_id`, `_bundle_node` and `_bundle_sku` properties |
| Touch and mouse | A movement under 5 px is a click (select); more is a drag (orbit the camera) |
| Accessibility | Keyboard control of the wheel (arrow keys, Enter, Escape) and ARIA labels on the menus |
| Merchant settings | Collection, base product per preset, discount (0-50 percent) and a dev mode, all in the theme editor |

## Configuration model

Each node in a preset layout is defined in `gb-config-json.liquid`:

| Field | Meaning |
|---|---|
| `node_id` | Unique ID, stable across swaps (for example `S2,1`) |
| `x` | Column index, or `[a, b]` for an item spanning columns |
| `y` | Tier level, where 1 is the floor |
| `sku` | Default product SKU |
| `setWith` | Nodes sharing this value form a linked group and are swapped together |
| `setAvailable` | Key into `sets`, listing the configurations this group can switch to |
| `fix` | `true` locks the node (for example, a fixed wall panel) |

`single_swaps` maps each SKU to its alternatives, and `sets` maps each `setAvailable` key to a list
of configurations (label and SKU list).

## Repository contents

```
shopify-3d-garage-builder/
|-- sections/
|   `-- garage-builder.liquid
|-- snippets/
|   |-- gb-config-json.liquid
|   `-- gb-products-json.liquid
|-- assets/
|   |-- gb-shopify-data.js
|   |-- gb-scene.js
|   |-- gb-ui-menu.js
|   |-- gb-ui-wheel.js
|   |-- gb-calculator.js
|   |-- gb-main.js
|   `-- gb-styles.css
|-- tests/
|   `-- calculator.test.js
|-- README.md
`-- ENGINEERING-LOG.md
```

## Installation and testing

### Install into a Shopify theme

1. Copy `sections/`, `snippets/` and `assets/` into the theme.
2. Upload a `.glb` model for each component SKU to the theme's `assets/` folder and list it in the
   GLB URL map in `garage-builder.liquid`.
3. In the theme editor, add the **3D Garage Builder** section to a page, then choose the storage
   collection, the base product for each preset, and the bundle discount.

Without the models, the scene shows placeholder blocks. Dev mode injects placeholder products for
SKUs that are not in the collection, so the flow can be tested before the catalogue is complete.

### Run the unit tests

Requires Node.js 18 or later; no packages to install.

```bash
node --test tests/calculator.test.js
```

The five tests cover an unchanged layout, an upgrade with discount, a downgrade, the zero floor,
and empty slots.

## Sanitisation

Brand names and SKUs are replaced with neutral placeholders (`Acme Storage`, `MOD-...`). The 3D
model files, the live product collection and store-specific content are not included, so the scene
does not fully render outside a configured store.

## Skills demonstrated

| Area | Detail |
|---|---|
| 3D on the web | Three.js scene setup, GLB and Draco loading, bounding-box measurement, raycasting, camera framing |
| Front-end architecture | Modular vanilla JavaScript with single-responsibility files and no framework |
| Shopify development | Online Store 2.0 section, settings schema, Liquid data rendering, Ajax Cart API |
| Data modelling | Configuration schema for layouts, spanning items, linked groups and swap rules |
| Algorithms | Set-to-position mapping with spanning items and empty nodes, collision-checked upward expansion |
| Testing | Unit tests for the pricing logic with the Node.js built-in test runner |
| Accessibility | Keyboard navigation and ARIA labelling for custom radial controls |

## Related documents

- [ENGINEERING-LOG.md](ENGINEERING-LOG.md) - technical problems solved in the implementation
- [Work samples overview](../README.md)
