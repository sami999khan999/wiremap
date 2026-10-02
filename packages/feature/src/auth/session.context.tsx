import {
  CapabilitySet,
  type CapabilitySetDto,
  createContext,
  type FlagKey,
  type ReactNode,
  useContext,
  useMemo,
} from "../import.js";

// One tenant the signed-in person may switch to, as the switcher renders it.
export interface SessionOrganization {
  readonly id: string;
  readonly name: string;
  // Per tenant, not per user: the same person is an owner in one organization and a
  // member in another, so this cannot sit beside `id` on the user.
  readonly roleName: string;
  // The platform organization, where its staff run the team, roles and platform docs.
  readonly isPlatform?: boolean;
}

export interface SessionUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  // Both ride the SSR snapshot, so the switcher is right on the first painted byte
  // rather than after a second round trip.
  readonly activeOrganizationId: string;
  readonly organizations: readonly SessionOrganization[];
  // The security page renders from this, so it rides the snapshot rather than being
  // read back through a cast the type system cannot check.
  readonly twoFactorEnabled: boolean;
}

interface SessionValue {
  readonly user: SessionUser | null;
  readonly capabilities: CapabilitySet;
  // Whether the *active* tenant is the platform tier — not whether this user is a
  // platform admin, which is the third axis of `capabilities`.
  readonly isPlatformOrganization: boolean;
  readonly flags: ReadonlySet<FlagKey>;
}

const SessionContext = createContext<SessionValue | null>(null);

// One instance, so the default does not change identity each render and rebuild the memo.
const NO_FLAGS: readonly FlagKey[] = Object.freeze([]);

export interface SessionProviderProps {
  readonly user: SessionUser | null;
  // The DTO, not the class: this crosses the SSR boundary as JSON, and reconstructing it
  // is what makes client `can()` the same `can()` the server ran.
  readonly capabilities: CapabilitySetDto;
  // Defaulted, so a caller that has not been updated renders as an ordinary tenant —
  // which is the safe reading: the platform module stays hidden.
  readonly isPlatformOrganization?: boolean;
  // The on-set of client-gating flags. Defaulted to none, so a caller not yet updated
  // renders every flagged affordance hidden, which is the side a rollout starts from.
  readonly flags?: readonly FlagKey[];
  readonly children: ReactNode;
}

export function SessionProvider({
  user,
  capabilities,
  isPlatformOrganization = false,
  flags = NO_FLAGS,
  children,
}: SessionProviderProps) {
  // Memoised so a re-render does not rebuild the internal Sets and invalidate every
  // downstream memo.
  const value = useMemo<SessionValue>(
    () => ({
      user,
      capabilities: CapabilitySet.from(capabilities),
      isPlatformOrganization,
      flags: new Set(flags),
    }),
    [user, capabilities, isPlatformOrganization, flags],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside a SessionProvider.");
  return value;
}

export function useCapabilities(): CapabilitySet {
  return useSession().capabilities;
}

export function useIsPlatformOrganization(): boolean {
  return useSession().isPlatformOrganization;
}

export function useFlags(): ReadonlySet<FlagKey> {
  return useSession().flags;
}
