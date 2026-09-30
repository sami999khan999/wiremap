---
title: Popover
description: A panel anchored to the control that opened it — why it is React state rather than the native Popover API, what it deliberately is not, and the one thing that will clip it.
---

# Popover

```tsx
<Popover label="Notifications" trigger={<Icon name="bell" />}>
  <NotificationPeek href="/notifications" />
</Popover>
```

One string names both the button and the panel, because a popover whose control and dialog are
named differently reads as two things to anyone who cannot see that they are one.

## The panel is unmounted, not hidden

Every real caller's panel is a query. A hidden one would fetch on every page that renders the
trigger, which for a header bar is every page there is. Closed means it is not in the document,
so `aria-controls` is absent too — pointing at an id that is not there is worse than not pointing.

## Why not the native Popover API

`popover` and `popovertarget` give the top layer, light dismiss and Escape with no JavaScript at
all, and this component would be four attributes instead of fifty lines. Two things stopped it:

- **Anchoring.** A top-layer element is positioned against the viewport, not against an ancestor,
  so keeping the panel beside its trigger needs `anchor-name` / `position-anchor`. That is not
  everywhere yet, and the fallback — a panel centred on the screen — is the wrong shape for a
  notification list hanging off a bell.
- **It cannot be driven in a test.** `showPopover` is not implemented in the DOM these specs run
  against, so the behaviour that matters would be the behaviour nothing checks.

**It is the swap when anchor positioning is universal**, and it is a small one: the state goes, the
two listeners go, and the panel keeps its classes.

## What it is not

- **Not a menu.** There is no roving focus, no arrow-key navigation and no `role="menu"`. The
  panel is a `dialog` holding ordinary content, and its contents keep their own semantics.
- **Not focus-trapping.** Tab moves out of the panel and the popover stays open. A trap belongs to
  a modal, and this is explicitly not one — the page behind it stays live.
- **Not in the top layer**, which is the one thing that will surprise someone: an ancestor with
  `overflow: hidden` clips the panel. The header bar it was built for does not have one.

## The two listeners, and why `pointerdown`

They are bound only while it is open, so a page of twenty closed popovers holds none.

Outside dismissal listens on `pointerdown` rather than `click`. A click fires after the element
under the press may already have gone; a popover that closed on the way up would swallow the first
press on whatever the reader was actually aiming at.

Escape closes **and returns focus to the trigger**. Without the second half, dismissing with the
keyboard leaves focus on `body`, and the next Tab starts from the top of the page.
