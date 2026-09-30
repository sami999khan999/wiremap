import { type PlatformHealth, PlatformHealthReader, type ReplicaHealthReport } from "../import.js";
import type { Container } from "./container.js";

// The container already answers this for the liveness probe; the platform screen asks
// the same question through a port, because `application` may not name this package.
export class ContainerHealthReader extends PlatformHealthReader {
  public constructor(private readonly container: Container) {
    super();
  }

  // `HealthReport` carries `pool` too, and this narrows it away: a screen that showed a
  // pool gauge would be reading one process's, which is not the deployment's.
  public async report(): Promise<PlatformHealth> {
    const { database, pool: _pool, ...rest } = await this.container.health();

    // Every node folded into one boolean. Which node is down is an operator's question
    // and the readiness endpoint answers it; the platform screen asks whether to worry.
    return { ...rest, database: Object.values(database).every(Boolean) };
  }

  // Every node's standby folded the same way: healthy only if all answer, and the worst
  // lag, because one node's standby a minute behind is the one that decides.
  public async replica(): Promise<ReplicaHealthReport | null> {
    const standbys = await this.container.replicaHealth();
    if (standbys.length === 0) return null;

    const healthy = standbys.every((standby) => standby.healthy);
    const lags = standbys.map((standby) => standby.lagSeconds ?? 0);
    return { healthy, lagSeconds: healthy ? Math.max(...lags) : null };
  }
}
