import { cn } from "../../class-name/index.js";
import { BaseAlertDialog, BaseDialog, type ReactNode } from "../../import.js";
import { usePortalContainer } from "../../theme/index.js";
import { buttonClassName } from "../button/index.js";

// The page dimmed with --bg rather than black: in a dark theme a light scrim would read as
// a panel rather than as a shade.
const BACKDROP = "fixed inset-0 z-50 bg-[color-mix(in_oklch,var(--bg)_60%,transparent)]";
const POPUP =
  "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-4rem)] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-lg border border-border bg-surface p-6 text-fg shadow-lg outline-none";
const TITLE = "ui-dialog__title m-0 font-semibold text-fg text-lg leading-tight";
const DESCRIPTION = "ui-dialog__description m-0 text-fg-muted text-sm";
const ACTIONS = "ui-dialog__actions flex flex-wrap justify-end gap-2";

export interface DialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  // The dialog's accessible name, drawn as its heading.
  readonly title: string;
  readonly description?: string;
  readonly children?: ReactNode;
  // The row of buttons at the foot. A close button is the caller's, so its copy is too.
  readonly actions?: ReactNode;
  readonly className?: string;
}

// A modal panel. Base UI owns the focus trap, the inert page, Escape, the backdrop press and
// focus back to the opener; the caller owns `open`.
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  actions,
  className,
}: DialogProps) {
  const container = usePortalContainer();

  return (
    <BaseDialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <BaseDialog.Portal container={container}>
        <BaseDialog.Backdrop className={cn("ui-dialog__backdrop", BACKDROP)} />
        <BaseDialog.Popup className={cn("ui-dialog", POPUP, className)}>
          <BaseDialog.Title className={TITLE}>{title}</BaseDialog.Title>
          {description ? (
            <BaseDialog.Description className={DESCRIPTION}>{description}</BaseDialog.Description>
          ) : null}
          {children}
          {actions ? <div className={ACTIONS}>{actions}</div> : null}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

export interface AlertDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description?: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly onConfirm: () => void;
  // `danger` for a confirm that cannot be undone, which is most of them.
  readonly tone?: "danger" | "primary";
}

// A question that must be answered before the page is usable again: no backdrop press
// dismisses it. Focus starts on Cancel, so Enter on arrival never confirms by accident.
export function AlertDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  tone = "danger",
}: AlertDialogProps) {
  const container = usePortalContainer();

  return (
    <BaseAlertDialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <BaseAlertDialog.Portal container={container}>
        <BaseAlertDialog.Backdrop className={cn("ui-dialog__backdrop", BACKDROP)} />
        <BaseAlertDialog.Popup className={cn("ui-dialog ui-dialog--alert", POPUP)}>
          <BaseAlertDialog.Title className={TITLE}>{title}</BaseAlertDialog.Title>
          {description ? (
            <BaseAlertDialog.Description className={DESCRIPTION}>
              {description}
            </BaseAlertDialog.Description>
          ) : null}
          <div className={ACTIONS}>
            <BaseAlertDialog.Close className={buttonClassName("secondary")}>
              {cancelLabel}
            </BaseAlertDialog.Close>
            <button
              type="button"
              className={buttonClassName(tone)}
              onClick={() => {
                onConfirm();
                onOpenChange(false);
              }}
            >
              {confirmLabel}
            </button>
          </div>
        </BaseAlertDialog.Popup>
      </BaseAlertDialog.Portal>
    </BaseAlertDialog.Root>
  );
}
