// What the platform status page reports. Declared here rather than imported from the
// composition root, which sits to the right of this package: the seam is forced.
export interface PlatformHealth {
  readonly healthy: boolean;
  readonly database: boolean;
  readonly cache: boolean;
  readonly queue: boolean;
  // `null` when this deployment runs no analytics store, which lite never does: absent,
  // rather than passing. See docs/scale/analytics.md.
  readonly analytics: boolean | null;
  // `null` in a process that has opened no subscriber connection, which is every worker.
  readonly realtime: boolean | null;
}

// Every node's standby folded into one reading — `25.1`. Healthy only when all answer,
// and the lag is the worst of them: a panel is asking whether to worry.
export interface ReplicaHealthReport {
  readonly healthy: boolean;
  // Null when any standby could not be asked, which is what `healthy: false` means.
  readonly lagSeconds: number | null;
}

export abstract class PlatformHealthReader {
  public abstract report(): Promise<PlatformHealth>;

  // `null` when the deployment runs no standby, never a failing reading.
  public abstract replica(): Promise<ReplicaHealthReport | null>;
}
