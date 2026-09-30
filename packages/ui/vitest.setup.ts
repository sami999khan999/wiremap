import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// `@testing-library/react` registers this itself only when vitest runs with
// `globals: true`. With explicit imports it does not, and the symptom is confusing
// rather than obvious: a second `render` in the same file leaves the first one mounted,
// so `getByText` fails with "found multiple elements" in a test that looks correct.
afterEach(cleanup);
