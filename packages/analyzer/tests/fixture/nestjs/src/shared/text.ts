import { slugify } from "./slug";

export function clean(value: string) {
  return value.trim() || slugify("x");
}
