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
literal key, which lite removed along with the feature. It is §30, and the fixture harness's count
of assertions goes back from 30 to 31.

**And the pieces outside those folders**, which lite removed or rewrote in `LT1.2`:

- the `widget` module's gate, route and permission (`widget.default.manage`, also in the admin
  seed), `core.widget.customize` in `core.permissions.ts`, and the `widget.dismissal` flag;
- the `widget` content namespace in en and bn, `WIDGET_COPY` and `ZONE_COPY`, and the nav entry;
- `widget_preferences` in `PartitionedTable.ALL`, the query keys, the api-client getter and the
  `widget` router in `apps/web`;
- the `<Widget widget="notification.bell">` around the bell (lite uses `<Can>`), the
  `WidgetInspector` in the member access panel, and the dashboard route, which lite made static;
- the client-gating set in `FlagRegistry`, which lite leaves empty.

`TenantMembershipReader` stayed in lite with nothing reading it, so it needs no port.
