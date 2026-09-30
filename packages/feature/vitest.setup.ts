import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Required with `globals: false` — `@testing-library/react` registers this itself only
// under globals, and without it a second `render` in a file leaves the first mounted.
afterEach(cleanup);
