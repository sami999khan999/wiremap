import type { DomainEventInput, DomainEventName } from "../import.js";
import type { Principal } from "../primitive/index.js";

// Broker-shaped by construction, because these four are what Kafka or Redis Streams
// cannot give back later. See docs/reference/ports.md.
export abstract class DomainEventPublisher {
  // Returns nothing: a caller reading a return value is doing RPC. Call it **inside**
  // `unitOfWork.run` — outside, you are announcing a change that may not commit.
  public abstract publish<N extends DomainEventName>(
    actor: Principal,
    event: DomainEventInput<N>,
  ): Promise<void>;
}
