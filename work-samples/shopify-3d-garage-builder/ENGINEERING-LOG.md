# Engineering Log - Shopify 3D Garage Builder

The main technical problems solved while building the configurator, and the reasoning behind each
solution. Each entry follows the same format: problem, root cause, resolution, verification,
lesson. Entries 1-8 describe design problems addressed in the implementation; entry 9 records
inconsistencies found and corrected while preparing this portfolio copy.

## Summary

| # | Problem | Category | Resolution |
|---|---|---|---|
| 1 | Components of different heights did not stack cleanly | 3D layout | Stack on measured bounding-box height |
| 2 | Models did not sit flush against the wall | 3D layout | Snap each model's back face to Z = 0 |
| 3 | Visible gaps between columns | 3D layout | Repack columns by measured width after loading |
| 4 | Clicking a component also rotated the camera | Interaction | 5 px movement threshold between click and drag |
| 5 | Set swaps where the new set has a different item count | Data model | Three mapping cases plus empty, re-fillable nodes |
| 6 | Swapping a single item for a multi-item set | Data model | Collision-checked upward expansion |
| 7 | 3D model URLs broke after theme asset updates | Shopify platform | Render versioned CDN URLs server-side |
| 8 | Bundle items appeared as unrelated cart lines | Commerce | Shared bundle properties on every line item |
| 9 | Settings text and code comments did not match behaviour | Documentation | Aligned text with the implemented behaviour |

---

## 1 - Components of different heights did not stack cleanly

**Problem.** Cabinets, drawer units and hutches have different heights. Placing each tier at a
fixed height (`tier_height_m`) left gaps above short items and overlaps above tall ones.

**Root cause.** The layout assumed a uniform tier height, but real product models vary.

**Resolution.** After each GLB loads, its bounding box is measured and the item is positioned on
the actual top of the item below (`_getStackedY`). When a lower item is swapped and its height
changes, `_reStackAbove` repositions everything above it in that column, from the bottom up. A
node can also declare `height_override_m` for models whose geometry does not reflect the real
product height.

**Verification.** The scene logs the measured height of every node (`[GB height] ...`) so stacking
can be checked against product specifications during setup.

**Lesson.** Derive layout from measured geometry, not from nominal sizes.

---

## 2 - Models did not sit flush against the wall

**Problem.** Some models appeared to float in front of the wall or sink into it.

**Root cause.** Each GLB file has its own origin, set by whoever exported it, so the same position
means different things for different models.

**Resolution.** Every loaded model is shifted so the back face of its bounding box sits at `Z = 0`,
and centred horizontally on its column.

```js
const box = new THREE.Box3().setFromObject(group);
group.position.z = -box.min.z;                          // back face on the wall
group.position.x = worldX - (box.min.x + box.max.x) / 2; // centred on its column
```

**Verification.** Placement depends only on each model's measured bounding box, so models exported
with different origins end up on the same wall plane.

**Lesson.** Normalise third-party assets on load rather than relying on consistent exports.

---

## 3 - Visible gaps between columns

**Problem.** Column positions based on a fixed `column_width_m` left gaps between narrow items and
overlaps between wide ones.

**Root cause.** Real component widths differ from the nominal column width.

**Resolution.** After all models load, `_repackXPositions` groups nodes by the columns they span,
measures each group's real width, packs the groups left to right with no gaps, and centres the
whole arrangement. Spanning items are placed at the average centre of the columns they cover.

**Verification.** The dimension overlay shows the total width after repacking, which can be
compared with the sum of the component widths from the product specifications.

**Lesson.** When exact fit matters, lay out in two passes: place approximately, then correct from
measurements.

---

## 4 - Clicking a component also rotated the camera

**Problem.** The same pointer gesture is used to select a component and to orbit the camera, so a
slightly moving click rotated the view instead of selecting.

**Root cause.** OrbitControls and selection both listen to pointer events, and a real click almost
always includes a few pixels of movement.

**Resolution.** The scene records the pointer-down position. On release, a movement under 5 px is
treated as a click and passed to raycasting; anything larger is an orbit. The same threshold
applies to touch events. The camera's polar angle is also limited so users cannot orbit
underneath the layout.

**Verification.** The threshold is applied in one place for both pointer and touch events
(`dist < 5` in `gb-scene.js`).

**Lesson.** Where two interactions share one gesture, separate them with an explicit threshold.

---

## 5 - Set swaps where the new set has a different item count

**Problem.** A linked group (for example, three stacked cabinets) can be replaced by a set with the
same number of items, a single item spanning all positions, or fewer items than positions.

**Root cause.** A simple one-to-one SKU replacement only works when the counts match.

**Resolution.** The group's nodes are expanded into individual `(x, y)` positions, sorted by tier
then column, and mapped with three cases:

| Case | Condition | Result |
|---|---|---|
| 1 | Set size equals position count | One SKU per position, in order |
| 2 | Set has one SKU, several positions | One node spanning the columns (same tier) or the tiers (same column) |
| 3 | Any other count | Positions filled in order; extra SKUs are ignored, and if there are fewer SKUs the last one repeats |

When a single item must replace a block covering several columns and tiers, it spans the columns
at the lowest tier, and the positions above it become empty nodes. Empty nodes keep the group
link, so they can be filled later and the group still swaps as one unit.

**Verification.** Every position of the old group is either covered by a new node or turned into
an empty node, so no position is lost. Empty nodes are priced at zero, which is covered by
`tests/calculator.test.js`.

**Lesson.** Model the layout as positions, not as items, so that items of any shape can be mapped
onto it.

---

## 6 - Swapping a single item for a multi-item set

**Problem.** A standalone item can be replaced with a set that needs more positions than it
occupies.

**Root cause.** The extra items need space, and that space may already be used by other components.

**Resolution.** The engine adds tiers above the item one level at a time, checking each new level
against every existing node in the same columns, and stops at the first collision.

**Verification.** Expansion stops at the first occupied level, so a new item is never placed on a
position already used by another node.

**Lesson.** Every automatic layout change needs a collision check before it is applied.

---

## 7 - 3D model URLs broke after theme asset updates

**Problem.** Building model URLs from a fixed pattern in JavaScript produced URLs that failed to
load or served an old file after a model was re-uploaded.

**Root cause.** Shopify serves theme assets from a CDN with a version value in the URL that changes
on each upload, and that value is known only to Liquid at render time.

**Resolution.** The section renders a JSON map from SKU to URL using the `asset_url` filter, so the
current versioned URL is embedded in the page. `GB.Data.glbUrlFor()` resolves URLs in priority
order: a `glb:` product tag, a `glb_url` product field, then the rendered map.

**Verification.** A missing entry is logged and the node keeps its placeholder block instead of
failing the whole scene.

**Lesson.** Let the platform generate platform-specific URLs; pass them to the client as data.

---

## 8 - Bundle items appeared as unrelated cart lines

**Problem.** Adding each configured component separately produced unrelated cart lines, with
nothing to show which items were ordered together.

**Root cause.** The Shopify cart has no concept of a bundle.

**Resolution.** All selected variants are posted in a single `/cart/add.js` request, and each line
item carries hidden properties: `_bundle_id` (shared by the whole configuration), `_bundle_node`
(its position) and `_bundle_sku`. Properties starting with an underscore are hidden from customers
but visible on the order for fulfilment. A `cart:updated` event lets the theme refresh its cart
drawer.

**Verification.** Each order line carries the same `_bundle_id` and its own `_bundle_node`, so the
full configuration can be reconstructed from the order.

**Lesson.** When the platform lacks a concept, carry it in metadata that downstream systems can read.

---

## 9 - Settings text and code comments did not match behaviour

Found while preparing this copy; the code behaviour was kept and the text corrected.

| Location | Text said | Code does | Correction |
|---|---|---|---|
| Theme setting `discount_percentage` | Discount applies to the final total | Discount applies only to the price difference from swaps | Help text now describes the implemented behaviour |
| `gb-scene.js` header comment | Maximum camera polar angle is 85 degrees | `maxPolarAngle = Math.PI * 0.85` (about 153 degrees) | Comment now states the real value |

**Lesson.** Merchant-facing settings text is part of the product; a unit test on the pricing rule
(`tests/calculator.test.js`) now documents the intended behaviour in code.
