import { act, fireEvent, screen } from "@testing-library/react";

// Chooses an option of a `Select` the way a pointer does: open, wait the tick Base UI takes
// to mount the list, then a whole press on the option, since it selects on the final click.
export async function choose(trigger: HTMLElement, option: string | RegExp): Promise<void> {
  fireEvent.click(trigger);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const target = screen.getByRole("option", { name: option });
  for (const type of ["pointerDown", "mouseDown", "pointerUp", "mouseUp", "click"] as const) {
    fireEvent[type](target);
  }
}
