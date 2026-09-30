import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "../import.js";

// What `Field` writes onto the control it wraps. Everything else about the control is
// the caller's.
interface Association {
  readonly "aria-describedby"?: string;
  readonly "aria-invalid"?: true;
}

export interface FieldProps {
  readonly label: string;
  // Required, not optional: a label not tied to a control is decoration, and the input
  // is announced as unlabelled.
  readonly htmlFor: string;
  readonly hint?: string;
  readonly error?: string;
  readonly children: ReactNode;
}

// The child is cloned rather than made to accept the two attributes, because every call
// site passes exactly one control and the alternative is writing them out at each.
function associate(children: ReactNode, association: Association): ReactNode {
  const only = Children.toArray(children);
  const child = only.length === 1 ? only[0] : undefined;
  if (!child || !isValidElement(child)) return children;

  const element = child as ReactElement<Association>;
  // The caller's own value wins and this one joins it: `aria-describedby` is a list, and
  // replacing it would silence whatever the control already pointed at.
  const own = element.props["aria-describedby"];
  const describedBy = [own, association["aria-describedby"]].filter(Boolean).join(" ");

  return cloneElement(element, {
    ...association,
    ...(describedBy.length > 0 ? { "aria-describedby": describedBy } : {}),
  });
}

export function Field({ label, htmlFor, hint, error, children }: FieldProps) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ");

  return (
    <div className="ui-field" data-invalid={error ? "true" : undefined}>
      <label className="ui-field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {
        // The two ids are computed here and were placed only on the paragraphs below, so
        // nothing ever pointed the control at either of them.
      }
      {associate(children, {
        ...(describedBy.length > 0 ? { "aria-describedby": describedBy } : {}),
        ...(error ? { "aria-invalid": true as const } : {}),
      })}
      {hint ? (
        <p className="ui-field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {
        // `role="alert"` so the message is announced when it appears, not only when the
        // input is next focused.
      }
      {error ? (
        <p className="ui-field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
