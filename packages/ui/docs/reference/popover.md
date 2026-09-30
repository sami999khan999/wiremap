---
title: Popover
description: A panel anchored to the control that opened it, on Base UI — what it keeps from the hand-rolled version, what it deliberately is not, and the two behaviours that changed.
---

# Popover

```tsx
<Popover label="Notifications" trigger={<Icon name="bell" />}>
  <NotificationPeek href="/notifications" />
</Popover>
```

One string names both the button and the panel, because a popover whose control and dialog are
named differently reads as two things to anyone who cannot see that they are one.

It is Base UI's `Popover` with the kit's styles. Base UI owns the parts that are easy to get
subtly wrong: Escape, dismissal on a press outside, focus in and back out, and `aria-expanded`
and `aria-controls` on the trigger. The props did not change when it moved.

## The panel is unmounted, not hidden

Every real caller's panel is a query. A hidden one would fetch on every page that renders the
trigger, which for a header bar is every page there is. Closed means it is not in the document, so
`aria-controls` is absent too, because pointing at an id that is not there is worse than not
pointing. That is Base UI's default, so it holds as long as nobody passes `keepMounted`.

## What changed with Base UI

- **Focus moves into the panel on open**, and Escape returns it to the trigger a tick after the
  panel closes. The spec waits for it. Without the return, dismissing with the keyboard leaves
  focus on `body`, and the next Tab starts from the top of the page.
- **It renders in a portal on `body`.** An ancestor with `overflow: hidden` no longer clips it,
  and it is positioned beside its trigger by Base UI's positioner rather than by a wrapper with
  `position: relative`. A portal also leaves any nested `data-theme` scope, so a popover opened
  inside the doc reader's scoped theme would paint in the page's theme. None does today.
- **A press outside dismisses on the click that ends it**, not on `pointerdown`. A spec drives a
  whole press, because that is what a pointer produces.

## What it is not

- **Not a menu.** There is no roving focus, no arrow-key navigation and no `role="menu"`. The
  panel is a `dialog` holding ordinary content, and its contents keep their own semantics.
- **Not modal.** Tab moves out of the panel. A trap belongs to a modal `Dialog`, and the page
  behind this one stays live.
