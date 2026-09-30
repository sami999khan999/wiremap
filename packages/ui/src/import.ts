// The boundary this package is defined by: two workspace entries, both type-only except
// the sprite URL, and no cache library, router or contracts.

// ── @base-ui/react ───────────────────────────────────────────────────────────
// Behaviour only: focus, keyboard, dismissal and ARIA. Every part is styled here.
export { Popover as BasePopover } from "@base-ui/react/popover";
export { Radio as BaseRadio } from "@base-ui/react/radio";
export { RadioGroup as BaseRadioGroup } from "@base-ui/react/radio-group";
export { Select as BaseSelect } from "@base-ui/react/select";
// ── @loadbearing/asset ───────────────────────────────────────────────────────
export { type IconName, IconRegistry } from "@loadbearing/asset";
export { default as spriteUrl } from "@loadbearing/asset/sprite.svg";
// ── @loadbearing/permissions ─────────────────────────────────────────────────
// Type-only, both of them. The `CapabilitySet` instance arrives as a prop, so
// `verbatimModuleSyntax` erases these and the emitted JavaScript imports nothing.
export type { CapabilitySet, PermissionKey } from "@loadbearing/permissions";

// ── clsx · tailwind-merge ────────────────────────────────────────────────────
// Composed once, as `cn` in class-name/. Nothing else calls either directly.
export { type ClassValue, clsx } from "clsx";
// ── react ────────────────────────────────────────────────────────────────────
export type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  KeyboardEvent,
  MouseEvent,
  ReactElement,
  ReactNode,
  Ref,
  TextareaHTMLAttributes,
} from "react";
export {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
export { twMerge } from "tailwind-merge";

// ── uqr ──────────────────────────────────────────────────────────────────────
// The only runtime dependency other than the sprite. It computes a module matrix rather
// than drawing, so `QrCode` renders during SSR.
export { encode } from "uqr";
