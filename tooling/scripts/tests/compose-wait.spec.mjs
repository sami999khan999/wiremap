// The seven states `docker compose ps` reports, and what each means for the wait loop.

// @ts-check

import { describe, expect, it } from "vitest";

import { readiness } from "../compose-wait.mjs";

describe("readiness", () => {
  it("is ready when healthy", () => {
    expect(readiness({ State: "running", Health: "healthy" })).toEqual({
      ready: true,
      why: "healthy",
    });
  });

  it("is fatal when unhealthy, so the loop stops rather than waits out the timeout", () => {
    expect(readiness({ State: "running", Health: "unhealthy" })).toEqual({
      ready: false,
      why: "unhealthy",
      fatal: true,
    });
  });

  it("is ready when a one-shot has finished successfully", () => {
    expect(readiness({ State: "exited", ExitCode: 0 })).toEqual({ ready: true, why: "exited 0" });
  });

  it("is fatal when a one-shot has failed", () => {
    expect(readiness({ State: "exited", ExitCode: 1 })).toEqual({
      ready: false,
      why: "exited 1",
      fatal: true,
    });
  });

  it("is ready when running with no healthcheck to be healthy by", () => {
    expect(readiness({ State: "running" })).toEqual({ ready: true, why: "running" });
  });

  it("waits on a one-shot that is still running, rather than reading it as ready", () => {
    expect(readiness({ Service: "minio-init", State: "running" })).toEqual({
      ready: false,
      why: "running",
    });
  });

  it("is ready once that one-shot has finished", () => {
    expect(readiness({ Service: "minio-init", State: "exited", ExitCode: 0 })).toEqual({
      ready: true,
      why: "exited 0",
    });
  });

  it("waits while a healthcheck is still starting", () => {
    expect(readiness({ State: "running", Health: "starting" })).toEqual({
      ready: false,
      why: "starting",
    });
  });

  it("waits on a container that has not started, and names the state it reports", () => {
    expect(readiness({ State: "created" })).toEqual({ ready: false, why: "created" });
    expect(readiness({})).toEqual({ ready: false, why: "unknown" });
  });
});
