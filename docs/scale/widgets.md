---
title: Widgets and zones
description: Bringing back the fourth visibility mechanism — dashboard cards a user or org admin can hide — which lite left out.
---

# Widgets and zones

**Not a scale limit** — a product feature lite left out. In lite the dashboard is a static page. The
big kit lets each dashboard card be a *widget* placed in a *zone*, which a user can hide for
themselves and an org admin can hide for everyone. It is the fourth visibility mechanism, after
flag, entitlement and permission.

The design is already in this repository: [`docs/opinions/visibility.md`](../opinions/visibility.md)
describes all four mechanisms and the ten rules for a widget. When this is ported, restore the
widget half of [`docs/ai/rules/visibility.md`](../ai/rules/visibility.md) from the big kit's copy.

## What to copy

```
upstream:packages/permissions/src/widget/
upstream:packages/permissions/src/registry/   (the widget registry entry)
upstream:packages/contracts/src/widget/
upstream:packages/infrastructure/src/pg/schema/   (widget preferences)
upstream:packages/infrastructure/src/pg/repository/   (the widget preference repository)
upstream:packages/application/src/widget/
upstream:packages/ui/src/zone/
upstream:packages/query/src/widget/
upstream:packages/feature/src/widget/
upstream:packages/feature/src/dashboard/
upstream:apps/web/src/route/(app)/_authenticated/settings/widgets.tsx
```

**Migrations to read:** `0047_widget_preferences`, `0048_widget_grants`.

**Also restore** the `check-architecture` assertion that every inline widget is placed by its
literal key, which lite removed along with the feature.
