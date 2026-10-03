// The boundary this package is defined by: two workspace entries, both type-only except
// the sprite URL, and no cache library, router or contracts.

// ── @base-ui/react ───────────────────────────────────────────────────────────
// Behaviour only: focus, keyboard, dismissal and ARIA. Every part is styled here.
export { AlertDialog as BaseAlertDialog } from "@base-ui/react/alert-dialog";
export { Avatar as BaseAvatar } from "@base-ui/react/avatar";
export { Dialog as BaseDialog } from "@base-ui/react/dialog";
export { Menu as BaseMenu } from "@base-ui/react/menu";
export { Popover as BasePopover } from "@base-ui/react/popover";
export { Radio as BaseRadio } from "@base-ui/react/radio";
export { RadioGroup as BaseRadioGroup } from "@base-ui/react/radio-group";
export { Select as BaseSelect } from "@base-ui/react/select";
export { Tabs as BaseTabs } from "@base-ui/react/tabs";
export { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
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
// ── glass-scroll ─────────────────────────────────────────────────────────────
export { GlassScroll, GlassScrollArea, type PartialTheme as GlassScrollTheme } from "glass-scroll";
// ── react ────────────────────────────────────────────────────────────────────
export type {
  ButtonHTMLAttributes,
  CSSProperties,
  InputHTMLAttributes,
  KeyboardEvent,
  MouseEvent,
  PointerEvent,
  ReactElement,
  ReactNode,
  Ref,
  TextareaHTMLAttributes,
} from "react";
export {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
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
