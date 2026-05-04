---
type: Design
scope: work-package
mode: walking-skeleton
---

# Design -- Checkout Foundations (CHK01)

Walking-skeleton design for `work/checkout/01-foundations/`, implementing CHK01 from `domain/checkout/backlog.md`.

Domain-wide patterns (server-owned order state, idempotent placement, error taxonomy) are authoritative in `domain/checkout/solution.md` and are not repeated here.

## 1. The slice

> **A customer navigates to `/checkout` on the new storefront. The route renders a server-rendered shell with a fixed-height skeleton under Suspense. No payment is processed yet, but the request flows through the `(checkout)` route group and its layout, and the `placeOrder` Server Action returns `NOT_IMPLEMENTED` -- confirming the action boundary is wired end-to-end.**

## 2. Files shipped

### 2.1 Module scaffold

```text
modules/checkout/
  data/
    clients/
      orders-api.server.ts    NEW  createOrder(), getOrder(), listOrders() via fetch
    mappers/
      order.mapper.ts         NEW  orderToViewModel(ApiOrder) -> OrderViewModel
  logic/
    types.ts                  NEW  OrderViewModel + all slice types
    error-codes.ts            NEW  OrderPlacementErrorCode enum
    error-messages.ts         NEW  getOrderErrorMessage(code)
  actions/
    place-order.ts            NEW  Server Action (stub: returns NOT_IMPLEMENTED)
  index.ts                    NEW  server barrel
  client.ts                   NEW  client barrel (client-safe types only)
```

### 2.2 Route group

```text
app/(checkout)/
  layout.tsx              NEW  checkout layout (nav header + footer)
  checkout/
    page.tsx              NEW  RSC shell: Suspense + CheckoutSkeleton
    loading.tsx           NEW  route-level loading state
  components/
    CheckoutSkeleton.tsx  NEW  fixed-height skeleton matching Figma dimensions
```

## 3. Acceptance gates

### 3.1 End-to-end path

`GET /checkout` returns HTTP 200 for an authenticated session and renders `CheckoutSkeleton` inside Suspense. `placeOrder()` called from the page returns `{ error: 'NOT_IMPLEMENTED' }` without calling any external service.

### 3.2 Observability hook fires

The route emits a server log line `checkout.page.rendered` with `session_id` (hashed) and `duration_ms`. No PII.

### 3.3 Error path exercised

`GET /checkout` for an unauthenticated request redirects to `/login`. The `(checkout)` layout renders an `error.tsx` boundary that catches thrown errors and returns HTTP 200 with an inline error message (not a 500).

### 3.4 Quality gates

`pnpm typecheck` passes. `pnpm test modules/checkout` passes (mapper unit tests, error-code registry tests). axe-core passes on the skeleton page.

## 4. What this WP did NOT deliver

- Live payment form (CHK02).
- Payments provider integration (CHK02).
- Order confirmation page (CHK03).
- Guest checkout path (CHK05).
- Any call to the orders API or the payments provider.

## 5. Open questions closed during this sprint

- **Route group name.** `(checkout)` chosen to keep the checkout layout separate from the main storefront layout. Confirmed with the team.
- **Skeleton dimensions.** Fixed heights taken from Figma; updated if Figma changes before CHK02 ships.

## 6. Handoff to next WP (CHK02)

- `modules/checkout/` module structure is in place. CHK02 adds `PaymentForm.client.tsx` and wires the live `placeOrder` action.
- `orders-api.server.ts` scaffold is present. CHK02 fills in the real `createOrder` call after the payment charge succeeds.
- `OrderPlacementErrorCode` is defined. CHK02 returns real codes from the placement pipeline.
