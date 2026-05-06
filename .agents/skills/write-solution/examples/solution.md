---
type: Solution
scope: domain
stage: stub
---

# Solution -- Checkout

For product context see `domain/checkout/product.md`.

## 1. Context and scope

### 1.1 System context

```text
Customer Browser
 |
 +-- Checkout page (RSC)
 |     +-- PaymentForm.client.tsx
 |           -> Server Action: placeOrder()
 |                -> payments provider  POST /v1/charges
 |                -> orders API         POST /orders
 |                -> redirect /order/[id]
 |
 +-- Confirmation page at /order/[id]  (RSC)
       -> getOrder(id)  ->  OrderViewModel
```

### 1.2 System boundary

Checkout **owns**: the payment form, the `placeOrder` Server Action, the `/order/[id]` confirmation page, and the `OrderViewModel` contract.

Checkout **does not own**: the payments provider SDK internals; cart contents or cart mutations (Cart domain); fulfilment, shipping, or returns (Platform).

## 2. Quality goals and constraints

1. **Conversion rate.** No structural change ships that regresses checkout-to-placed-order rate.
2. **No orphaned orders.** A payment failure must not leave a partially placed order record. Idempotency key enforces this.
3. **Confirmation LCP p75 mobile < 2.5 s.** Order number renders server-side; customer sees it before full hydration.
4. **Placement round-trip p75 < 2 s, p95 < 4 s.**
5. **WCAG 2.1 AA.** axe-core clean in CI; keyboard-navigable payment form.

## 3–11. [NEEDS CLARIFICATION]
