// What the running stack is, resolved once in `vitest.smoke.config.ts` and injected. Read
// there and not here: `noProcessEnv` and assertion 3 both walk `tests/`. See doc 15.
export interface Stack {
  // Two URLs for one server. `url` goes through pgBouncer in transaction mode; `directUrl`
  // does not, and is what DDL a transaction pooler cannot carry uses.
  readonly database: { readonly url: string; readonly directUrl: string };
  // Node 1, present only under the `sharded` profile with the two `.env.example` lines
  // uncommented. Its absence is what the rehearsal skips on, and this is the only door.
  readonly shard1?: { readonly url: string; readonly directUrl: string };
  // Node 0's standby, under the `replica` profile with `DATABASE_REPLICA_URL` set. Absent
  // is what `replica.smoke.spec.ts` skips on.
  readonly replica?: { readonly url: string };
  readonly redis: { readonly cacheUrl: string; readonly queueUrl: string };
  readonly storage: {
    readonly endpoint: string;
    readonly region: string;
    readonly bucket: string;
    readonly accessKey: string;
    readonly secretKey: string;
    readonly forcePathStyle: boolean;
  };
  // Tenant counts the ceiling measurement runs at, from `TENANT_CEILING=100,500`. Absent
  // is the normal case: it creates tens of thousands of partitions and takes minutes.
  readonly tenantCeiling?: readonly number[];
  // Recipient counts the fan-out measurement runs at, from `FAN_OUT_SCALE=1000,10000`.
  // Absent is the normal case: it creates a user row per recipient.
  readonly fanOut?: readonly number[];
  // Row counts the routed measurement runs at, from `ROUTED_SCALE=10000`. Needs `shard1`
  // as well: one node measures routing against nothing.
  readonly routed?: readonly number[];
  // Absent when the stack is not running one, which is the case the `skipIf` block is
  // about — not a missing variable, a service nobody started.
  readonly loki?: { readonly url: string; readonly tenantId?: string };
}

declare module "vitest" {
  interface ProvidedContext {
    stack: Stack;
  }
}
