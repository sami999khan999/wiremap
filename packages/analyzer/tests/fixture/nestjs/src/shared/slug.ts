import { clean } from "./text";

export function slugify(value: string) {
  return clean(value);
}

export function unslug(value: string) {
  return value;
}
