import { DOMAIN_EVENTS } from "../catalog/index.js";
import { z } from "../import.js";
import { Identifiers, type OrganizationId, type UserId } from "../primitive/index.js";

export type DomainEventName = keyof typeof DOMAIN_EVENTS;

export type DomainEventPayload<N extends DomainEventName> = z.infer<(typeof DOMAIN_EVENTS)[N]>;

interface EventInputOf<N extends DomainEventName> {
  readonly name: N;
  readonly payload: DomainEventPayload<N>;
}

interface EventOf<N extends DomainEventName> {
  readonly id: string;
  // Branded, like every other identifier that crosses a boundary here: a subscriber
  // handed a `string` would have to re-brand it before it could scope a query.
  readonly organizationId: OrganizationId;
  readonly name: N;
  readonly actorId: UserId;
  readonly occurredAt: Date;
  readonly payload: DomainEventPayload<N>;
}

// What a use-case hands the publisher. No id, no timestamp and no actor: those belong to
// the publisher, which is the only thing that can assign them consistently.
export type DomainEventInput<N extends DomainEventName = DomainEventName> =
  N extends DomainEventName ? EventInputOf<N> : never;

// What a subscriber receives, and **a discriminated union rather than one generic
// shape**: without the distribution, `event.name === "x"` narrows nothing about `payload`.
export type DomainEvent<N extends DomainEventName = DomainEventName> = N extends DomainEventName
  ? EventOf<N>
  : never;

const NAMES: readonly DomainEventName[] = Object.freeze(
  Object.keys(DOMAIN_EVENTS) as DomainEventName[],
);

const envelopeFor = <N extends DomainEventName>(name: N) =>
  z.object({
    id: z.uuid(),
    organizationId: Identifiers.organizationId,
    name: z.literal(name),
    actorId: Identifiers.userId,
    occurredAt: z.coerce.date(),
    payload: DOMAIN_EVENTS[name],
  });

// Built once at module load and frozen, for the reason `classes.md` gives: a lazily-built
// lookup on a `static readonly` is mutable state wearing a keyword.
const ENVELOPE = Object.freeze(
  z.discriminatedUnion(
    "name",
    NAMES.map((name) => envelopeFor(name)) as unknown as [
      ReturnType<typeof envelopeFor>,
      ...ReturnType<typeof envelopeFor>[],
    ],
  ),
);

// The closed vocabulary of facts this system publishes. A name that is not here cannot be
// published and cannot be subscribed to — both are compile errors.
export class DomainEvents {
  private constructor() {}

  public static names(): readonly DomainEventName[] {
    return NAMES;
  }

  // `Object.hasOwn`, not a bare index, for the reason `ProcedurePermissions` gives:
  // `DOMAIN_EVENTS["toString"]` otherwise resolves up the prototype chain to a function.
  public static isKnown(name: string): name is DomainEventName {
    return Object.hasOwn(DOMAIN_EVENTS, name);
  }

  public static schema<N extends DomainEventName>(name: N): (typeof DOMAIN_EVENTS)[N] {
    return DOMAIN_EVENTS[name];
  }

  // The whole envelope in one call, rather than reading `name` first and picking a
  // schema by hand — which is a second place to forget a case.
  public static parse(value: unknown): DomainEvent {
    // The validation is real; the assertion is only because the union is *built* from the
    // catalog at module load, so zod infers each member's payload as the whole union.
    return ENVELOPE.parse(value) as DomainEvent;
  }

  // Exposed for `safeParse`, which is what a spec wants when the expected answer is a
  // rejection rather than a value.
  public static get envelope(): typeof ENVELOPE {
    return ENVELOPE;
  }
}
