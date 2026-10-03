---
title: Shell primitives
description: The pieces wiremap's app shell and graph explorer are built from — ActionMenu, Avatar, Tabs, ResizablePanels, RoleDot and the three-way ThemeToggle — and the one choice behind each.
---

# Shell primitives

Six components wiremap added for its top bar and its three-pane explorer. Each one is Base UI for
behaviour and Tailwind over the twelve colours for looks, like the rest of this package.

| Component | Built on | For |
|---|---|---|
| `ActionMenu` | Base UI `Menu` | A list of actions: the organization menu, the account menu |
| `Avatar` | Base UI `Avatar` | A face, or two initials on `--primary` |
| `Tabs` | Base UI `Tabs` | Overview and Ask in the explorer's right panel |
| `ResizablePanels` | CSS grid | The explorer's three columns, with draggable dividers |
| `RoleDot` | — | A file role's colour square beside its name |
| `ThemeToggle` | Base UI `RadioGroup` | Light and dark, and with `system`, all three |

## `ActionMenu` is not `Menu`

`Menu` chooses one value, so it is a `Select` in a different coat. `ActionMenu` runs actions: each
entry has an `onSelect`, and none of them is "the value". An entry can be an `item` (with an icon, a
muted `detail` line, a `checked` mark or a `danger` tone), a `separator` or a `heading`. Navigation
arrives as a callback, because this package names no router.

## `Tabs` renders one panel

The content is a render function, `children(value)`, called for the open tab only. A closed tab
mounts nothing, so the Ask tab's thread does not run its queries while Overview is showing.

## `ResizablePanels` stacks below `lg`

Above `lg` it is a five-column grid: start, divider, centre, divider, end. Each divider is a
focusable `separator` that the arrow keys move in 16 px steps, with Home and End for the bounds,
and that a pointer drags. Widths are kept in `localStorage` under `storageKey` when one is given,
read after mount so the server render never differs from the first client one. Below `lg` the
panes stack and the dividers are hidden: a phone has no width to share.

## `RoleDot` has six tones, all from the twelve

| Tone | Paint |
|---|---|
| `primary` | `--primary` |
| `cool` | `--success` mixed 50 % with `--primary` (a cyan) |
| `warm` | `--danger` mixed 60 % with `--primary` (a pink) |
| `success`, `warning` | themselves |
| `neutral` | `--fg-muted` |

The mixes run in `oklch`, so they move with every theme. A role gets a tone and never a colour;
the mapping from role to tone lives in `feature`. The dot is `aria-hidden`, because the role's name
always sits beside it.

## `ThemeToggle` with `system`

Pass `system={{ label, preference, onPreferenceChange }}` and a third segment appears. The checked
segment is then the stored preference, `system` included, rather than the rendered mode. Changes
are reported through `onPreferenceChange`. `variant="labels"` writes the words instead of drawing a
sun and a moon, as the top bar does.
