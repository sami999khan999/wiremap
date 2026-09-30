import { type ClassValue, clsx, twMerge } from "../import.js";

// Joins conditional classes, then drops the losing utility of any conflicting pair, so a
// caller's `className` overrides a component's default rather than racing it in the CSS.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
