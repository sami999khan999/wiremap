import type { GraphTools } from "./graph-tools.js";

interface Request {
  readonly jsonrpc: "2.0";
  readonly id?: string | number | null;
  readonly method: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

// The protocol versions this server speaks, newest first. A client asking for another is
// answered with the newest, which is what the specification asks of a server.
const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

// The Model Context Protocol over stdio: one JSON-RPC message per line in each direction.
// Written by hand because the SDK brings an HTTP server and its own zod into every `npx`.
export class McpServer {
  public constructor(
    private readonly tools: GraphTools,
    private readonly definitions: readonly unknown[],
    private readonly version: string,
    private readonly send: (line: string) => void,
  ) {}

  // One line in, at most one line out. A notification is answered with nothing.
  public receive(line: string): void {
    if (line.trim() === "") return;
    let request: Request;
    try {
      request = JSON.parse(line) as Request;
    } catch {
      this.reply(null, undefined, { code: -32700, message: "Parse error" });
      return;
    }
    if (request.id === undefined) return;
    try {
      this.reply(request.id, this.answer(request));
    } catch (error) {
      this.reply(request.id, undefined, {
        code: (error as { code?: number }).code ?? -32603,
        message: (error as Error).message,
      });
    }
  }

  private answer(request: Request): unknown {
    switch (request.method) {
      case "initialize": {
        const asked = request.params?.protocolVersion;
        return {
          protocolVersion:
            typeof asked === "string" && VERSIONS.includes(asked) ? asked : VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: "wiremap", version: this.version },
          instructions:
            "A codebase's import graph, routes and insights. Start with overview; find_files turns a name into the path the other tools take.",
        };
      }
      case "ping":
        return {};
      case "tools/list":
        return { tools: this.definitions };
      case "tools/call":
        return this.call(request.params ?? {});
      default:
        throw Object.assign(new Error(`Method not found: ${request.method}`), { code: -32601 });
    }
  }

  // A tool's own failure is a result the model reads, not a protocol error: it can then
  // correct the call, which is the point of saying what went wrong.
  private call(params: Readonly<Record<string, unknown>>): unknown {
    const name = typeof params.name === "string" ? params.name : "";
    const args =
      typeof params.arguments === "object" && params.arguments !== null
        ? (params.arguments as Record<string, unknown>)
        : {};
    try {
      const result = this.tools.call(name, args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: (error as Error).message }], isError: true };
    }
  }

  private reply(
    id: string | number | null,
    result: unknown,
    error?: { readonly code: number; readonly message: string },
  ): void {
    this.send(
      JSON.stringify(error ? { jsonrpc: "2.0", id, error } : { jsonrpc: "2.0", id, result }),
    );
  }
}
