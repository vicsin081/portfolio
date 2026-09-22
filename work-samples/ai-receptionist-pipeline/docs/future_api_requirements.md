# Future API Requirements (deferred — not built yet)

**Status:** In the current phase the AI receptionist does NOT call any system. Every
request that needs live data is **transferred to the right team** (see each API's
"fallback route" below). This document captures the APIs to build LATER so that
those transfers can be turned back into automated answers.

When the APIs exist, re-enable a `system_lookup` action in `decision_engine.py` /
`interactive_agent.py` (it was removed on purpose) and wire each intent/category
below to the matching API instead of transferring.

Source: every `knowledge_base.json` question category tagged
`automation: ai_needs_system_lookup`.

---

## 1. check_stock
- **Purpose:** real-time stock level, lead time, colour/variant availability.
- **Params:** `sku` (or product_name), optional `variant`/`colour`.
- **Returns:** `in_stock` (bool/qty), `lead_time`, `variants[]`, `alternatives[]`.
- **Used by:** Product Info -> Product Availability & Stock; Order Placement -> Stock & Product Information; Order Status -> Product & Stock Availability.
- **Fallback route (no API):** warehouse_stock.

## 2. get_delivery_quote
- **Purpose:** delivery cost + options for a destination.
- **Params:** `postcode`, `items[]` (sku/qty) or `dimensions`/`weight`.
- **Returns:** `cost`, `options[]`, `eta`, `regional_restrictions`, `depot_address`.
- **Used by:** Quotes -> Product & Delivery Quotes; Delivery -> Delivery Cost & Options; Product Info -> Pricing & Delivery Costs.
- **Fallback route:** delivery_freight.

## 3. get_order_status
- **Purpose:** status / dispatch / tracking of an existing order.
- **Params:** `order_id` OR `customer_name` + `phone`.
- **Returns:** `status`, `dispatch_date`, `tracking`, `items[]`.
- **Used by:** Order Status -> Order Status Inquiry; Delivery -> Delivery Status & Issues.
- **Fallback route:** accounts_invoice / delivery_freight.

## 4. get_product_details
- **Purpose:** specs, dimensions, materials, assembly info.
- **Params:** `sku` (or product_name).
- **Returns:** `dimensions`, `materials`, `features`, `assembly_instructions`, `price`.
- **Used by:** Product Info -> Product Specifications & Features, Assembly & Installation, Parts & Identification.
- **Fallback route:** sales / support_aftersales.

## 5. quote management (create / get / resend)
- **Purpose:** create a new quote, look up or resend an existing one.
- **Params:** create: `items[]`, `postcode`, `customer`. lookup: `quote_id` OR `email`.
- **Returns:** `quote_id`, `line_items[]`, `total`, `pdf/email_status`.
- **Used by:** Quotes -> Quote Management & Clarification; Order Placement -> Order Initiation.
- **Fallback route:** sales.

## 6. payment & invoice (status / link / resend)
- **Purpose:** check payment, send payment link, resend invoice, refund status.
- **Params:** `order_id`; for link `amount`.
- **Returns:** `payment_status`, `outstanding_balance`, `payment_link`, `refund_status`, `eta`.
- **Used by:** Payments & Refunds -> Make a Payment, Payment Confirmation & Receipts, Refund Status, Invoice & Payment Details; Order Status -> Invoice & Payment Inquiry.
- **Fallback route:** accounts_invoice.

## 7. delivery / pickup scheduling
- **Purpose:** confirm/change a delivery or pickup booking.
- **Params:** `order_id`, `preferred_date`, `new_address`/`new_time` (optional).
- **Returns:** `confirmed_slot`, `instructions`, `change_status`.
- **Used by:** Delivery -> Delivery Scheduling & Changes, Pickup Scheduling & Changes.
- **Fallback route:** delivery_freight / warehouse_stock.

## 8. showroom display lookup / visit booking
- **Purpose:** check if an item is on display; book a showroom visit.
- **Params:** display: `sku`. booking: `date`, `time`, `items[]`.
- **Returns:** `on_display` (bool), `appointment_confirmation`.
- **Used by:** Showroom & Viewing -> Specific Item Viewing & Display, Showroom Visit Booking.
- **Fallback route:** sales.
- **Note:** static showroom address/hours are already answerable from `company_facts.json` (no API needed).

## 9. log_callback_request (CRM)
- **Purpose:** record a callback request after the `clarify` step identifies the real need.
- **Params:** `customer_name`, `phone`, `intent`, `notes`, `requested_person` (optional).
- **Returns:** `ticket_id`.
- **Used by:** Callback & Specific Contact (after clarify).
- **Fallback route:** specific_person / relevant department.

---

## Handoff / screen pop (transfer payload)

Every `transfer` already produces a `handoff` card (customer_name, intent, one-line
need summary, key_details like order_no/product/postcode). Right now it is only printed
in the local demo.

**3CX integration requirement:** when the AI transfers a call, pass this handoff card to
the receiving agent as a **screen pop / call note**, so the customer does not have to
repeat themselves. This is independent of the lookup APIs above — it ships with the
transfer itself.

