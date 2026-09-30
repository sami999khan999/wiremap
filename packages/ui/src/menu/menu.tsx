import { Icon } from "../icon/index.js";
import {
  type IconName,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "../import.js";

export interface MenuOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: IconName;
}

export interface MenuProps {
  // The control's accessible name, spoken before the selected option's label.
  readonly label: string;
  readonly value: string;
  readonly options: readonly MenuOption[];
  readonly onSelect: (value: string) => void;
  // Which side the list opens on. `above` is for a trigger at the foot of a column, where
  // a list opening downwards lands under the fold.
  readonly placement?: "below" | "above";
  readonly className?: string;
}

function optionContent(option: MenuOption, description: boolean): ReactNode {
  return (
    <>
      {option.icon ? (
        <span className="ui-menu__icon">
          <Icon name={option.icon} size={16} />
        </span>
      ) : null}
      <span className="ui-menu__text">
        <span className="ui-menu__label">{option.label}</span>
        {description && option.description ? (
          <span className="ui-menu__description">{option.description}</span>
        ) : null}
      </span>
    </>
  );
}

// A select that can show an icon and a second line, which a native `<select>` cannot.
// The same dismissal rules as `Popover`, with a listbox inside rather than a dialog.
export function Menu({
  label,
  value,
  options,
  onSelect,
  placement = "below",
  className,
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const listId = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const control = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const selected = options[selectedIndex];

  useEffect(() => {
    if (!open) return;
    list.current?.focus();

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && wrapper.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const show = () => {
    setCursor(selectedIndex);
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    control.current?.focus();
  };

  const choose = (index: number) => {
    const option = options[index];
    if (option) onSelect(option.value);
    close();
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = options.length - 1;
    const moves: Record<string, () => void> = {
      ArrowDown: () => setCursor((at) => Math.min(last, at + 1)),
      ArrowUp: () => setCursor((at) => Math.max(0, at - 1)),
      Home: () => setCursor(0),
      End: () => setCursor(last),
      Enter: () => choose(cursor),
      " ": () => choose(cursor),
      Escape: close,
      Tab: () => setOpen(false),
    };
    const move = moves[event.key];
    if (!move) return;
    if (event.key !== "Tab") event.preventDefault();
    move();
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    show();
  };

  return (
    <div ref={wrapper} className={["ui-menu", className].filter(Boolean).join(" ")}>
      <button
        ref={control}
        type="button"
        className="ui-menu__trigger"
        aria-label={selected ? `${label}: ${selected.label}` : label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? close() : show())}
        onKeyDown={onTriggerKeyDown}
      >
        {selected ? optionContent(selected, false) : null}
        <Icon name="chevron-up-down" size={16} className="ui-menu__chevron" />
      </button>

      {open ? (
        <div
          ref={list}
          id={listId}
          role="listbox"
          aria-label={label}
          aria-activedescendant={`${listId}-${cursor}`}
          tabIndex={-1}
          className={placement === "above" ? "ui-menu__list ui-menu__list--above" : "ui-menu__list"}
          onKeyDown={onListKeyDown}
        >
          {options.map((option, index) => (
            // `onMouseDown` would steal focus from the list first; a click keeps it.
            // biome-ignore lint/a11y/useKeyWithClickEvents: the listbox owns the keyboard.
            <div
              key={option.value}
              id={`${listId}-${index}`}
              role="option"
              tabIndex={-1}
              aria-selected={option.value === value}
              className={[
                "ui-menu__option",
                index === cursor ? "ui-menu__option--active" : null,
                option.value === value ? "ui-menu__option--selected" : null,
              ]
                .filter(Boolean)
                .join(" ")}
              onMouseEnter={() => setCursor(index)}
              onClick={() => choose(index)}
            >
              {optionContent(option, true)}
              {option.value === value ? (
                <Icon name="check" size={16} className="ui-menu__check" />
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
