import { type RequestHeaders, type ResolvedSession, SessionResolver } from "../import.js";

// Resolves to whatever it was handed. One line, because it exists so the port has a
// double — a use-case test builds a `Principal` directly and never reaches it.
export class StubSessionResolver extends SessionResolver {
  public constructor(private readonly session: ResolvedSession | null = null) {
    super();
  }

  public override resolve(_headers: RequestHeaders): Promise<ResolvedSession | null> {
    return Promise.resolve(this.session);
  }
}
