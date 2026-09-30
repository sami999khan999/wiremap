import { CapabilitySet, type CapabilitySetDto, type FlagKey, type SessionUser } from "~/import.js";

// What crosses the SSR boundary. The DTO rather than the class, because `can()` on the
// client has to be the same `can()` the server ran.
export interface SessionSnapshot {
  readonly user: SessionUser | null;
  readonly capabilities: CapabilitySetDto;
  // Whether the *active* tenant is the tier — not whether the user is a platform admin,
  // which is the third axis of `capabilities`. The role editor reads this one.
  readonly isPlatformOrganization: boolean;
  // Not about the user, and it rides here anyway: `Env` is server-only, and this is the
  // one payload the root route already awaits on every request.
  readonly googleEnabled: boolean;
  // The on-set of client-gating flags only — the ones a widget names. A server-only
  // flag's name never rides here. See docs/reference/server-functions.md.
  readonly flags: readonly FlagKey[];
}

// Signed out, denying everything: there is no loading state that grants access, so
// resolution only ever widens this.
const ANONYMOUS: SessionSnapshot = {
  user: null,
  capabilities: CapabilitySet.empty().toJSON(),
  isPlatformOrganization: false,
  // Off until the server says otherwise, so an unresolved store renders no button rather
  // than one that leads nowhere.
  googleEnabled: false,
  flags: [],
};

// Resolve on the server, ride the SSR payload, be complete before the first client
// render. Never at module scope in a server bundle: that is a cross-tenant leak.
export class SessionStore {
  private snapshot: SessionSnapshot = ANONYMOUS;
  // Distinct from "the user is anonymous". An unresolved store has not asked yet; a
  // resolved one has, and the answer may legitimately be nobody.
  private resolved = false;
  private inFlight: Promise<void> | undefined;

  // Idempotent, and not a fetch-per-navigation: `restore()` marks the store resolved
  // before the first client render, so the round trip happens once.
  public async ensure(load: () => Promise<SessionSnapshot>): Promise<void> {
    if (this.resolved) return;
    // Concurrent matches share one request rather than racing two.
    this.inFlight ??= load()
      .then((snapshot) => {
        this.snapshot = snapshot;
        this.resolved = true;
      })
      .finally(() => {
        this.inFlight = undefined;
      });

    return this.inFlight;
  }

  // The next `ensure()` asks again; until it answers, the store keeps its current answer
  // rather than flashing anonymous.
  public invalidate(): void {
    this.resolved = false;
  }

  public get user(): SessionUser | null {
    return this.snapshot.user;
  }

  // The DTO, never a reconstructed `CapabilitySet`: this goes onto the router context,
  // which is dehydrated, and a class with methods is rejected at the type level.
  public get dto(): CapabilitySetDto {
    return this.snapshot.capabilities;
  }

  public get isPlatformOrganization(): boolean {
    return this.snapshot.isPlatformOrganization;
  }

  public get googleEnabled(): boolean {
    return this.snapshot.googleEnabled;
  }

  public get flags(): readonly FlagKey[] {
    return this.snapshot.flags;
  }

  public dehydrate(): SessionSnapshot {
    return this.snapshot;
  }

  public restore(snapshot: SessionSnapshot): void {
    this.snapshot = snapshot;
    this.resolved = true;
  }
}
