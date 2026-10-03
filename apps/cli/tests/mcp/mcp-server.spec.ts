import { fileURLToPath } from "node:url";
import { Analyzer } from "@loadbearing/analyzer";
import type { GraphDocument } from "@loadbearing/contracts";
import { beforeAll, describe, expect, it } from "vitest";
import { GraphTools, McpServer } from "../../src/mcp/index.js";

const fixture = fileURLToPath(
  new URL("../../../../packages/analyzer/tests/fixture/nestjs", import.meta.url),
);

let document: GraphDocument;

beforeAll(async () => {
  document = await Analyzer.run({
    repositories: [{ name: "acme/api", root: fixture }],
    ignore: [],
    tsconfigPath: null,
    version: "test",
  });
});

interface Reply {
  readonly id: number;
  readonly result?: {
    readonly content: readonly { readonly text: string }[];
    readonly isError?: boolean;
    readonly tools: readonly { readonly name: string }[];
    readonly [key: string]: unknown;
  };
  readonly error?: { readonly code: number };
}

// A client's side of the conversation: each request in, the one reply out, parsed.
const session = () => {
  const sent: unknown[] = [];
  const server = new McpServer(new GraphTools(document), GraphTools.definitions, "test", (line) =>
    sent.push(JSON.parse(line)),
  );
  let id = 0;
  const request = (method: string, params?: Record<string, unknown>) => {
    id += 1;
    server.receive(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return sent.at(-1) as Reply;
  };
  return { server, sent, request };
};

const text = (reply: Reply) => JSON.parse(reply.result?.content[0]?.text ?? "null");

describe("McpServer", () => {
  it("initializes on the client's version and lists the eight tools", () => {
    const { request, server, sent } = session();
    const init = request("initialize", { protocolVersion: "2025-03-26", capabilities: {} });
    expect(init.result).toMatchObject({
      protocolVersion: "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "wiremap" },
    });

    // A notification is answered with nothing at all.
    server.receive(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
    expect(sent).toHaveLength(1);

    const names = request("tools/list").result?.tools.map((tool) => tool.name);
    expect(names).toEqual([
      "overview",
      "find_files",
      "dependencies",
      "dependents",
      "impact",
      "routes",
      "route_for_path",
      "cycles",
    ]);
  });

  it("answers impact with dependents and the routes they serve", () => {
    const { request } = session();
    const impact = text(
      request("tools/call", { name: "impact", arguments: { path: "src/user/user.service.ts" } }),
    );
    expect(impact.dependents.map((each: { path: string }) => each.path)).toContain(
      "src/user/user.controller.ts",
    );
    expect(
      impact.routes.some((route: { handler: string }) =>
        /^src\/user\/user\.controller\.ts:\d+$/.test(route.handler),
      ),
    ).toBe(true);
  });

  it("matches a concrete URL to the route pattern that serves it", () => {
    const { request } = session();
    const routes = text(request("tools/call", { name: "routes", arguments: {} }));
    const parameterised = routes.find((route: { path: string }) => /[:{[]/.test(route.path));
    const concrete = parameterised.path.replace(/(:\w+|\{\w+\}|\[\w+\])/g, "42");

    const matched = text(
      request("tools/call", { name: "route_for_path", arguments: { path: concrete } }),
    );
    expect(matched.map((route: { path: string }) => route.path)).toContain(parameterised.path);
  });

  // The model reads the message and can correct itself; a protocol error would end the call.
  it("reports a bad call as a tool error, and an unknown method as a protocol one", () => {
    const { request } = session();
    const missing = request("tools/call", { name: "impact", arguments: { path: "nope.ts" } });
    expect(missing.result?.isError).toBe(true);
    expect(missing.result?.content[0]?.text).toContain("find_files");

    expect(request("resources/list").error?.code).toBe(-32601);
  });
});
