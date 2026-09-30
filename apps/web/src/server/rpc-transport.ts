import { getRequest } from "@tanstack/react-start/server";
import { ApiClient } from "~/import.js";
import { createServerRpcClient } from "./rpc-client.js";

// SSR without a network hop, and without a relative URL `fetch` cannot resolve: under
// Node `overHttp("/api/rpc")` throws `Invalid URL` on the first call.
export function serverTransport(): ApiClient {
  return ApiClient.inProcess(createServerRpcClient(getRequest()));
}
