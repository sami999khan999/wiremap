import { describe, expect, it } from "vitest";
import { BearerAuthStrategy } from "../../src/auth/bearer-auth.strategy.js";
import { CookieAuthStrategy } from "../../src/auth/cookie-auth.strategy.js";
import { TokenProvider } from "../../src/auth/token.provider.js";

// The in-memory provider the doc names as the third host, alongside the OS keychain
// and a mobile one. It is also the proof that `TokenProvider` needs no browser.
class InMemoryTokenProvider extends TokenProvider {
  public constructor(private token: string | null = null) {
    super();
  }

  public override get(): Promise<string | null> {
    return Promise.resolve(this.token);
  }

  public override set(token: string | null): Promise<void> {
    this.token = token;
    return Promise.resolve();
  }
}

describe("CookieAuthStrategy", () => {
  it("adds no header and asks fetch to send the cookie", async () => {
    const strategy = new CookieAuthStrategy();

    expect(await strategy.headers()).toEqual({});
    expect(strategy.credentials).toBe("include");
  });
});

describe("BearerAuthStrategy", () => {
  it("carries the token as a bearer header", async () => {
    const strategy = new BearerAuthStrategy(new InMemoryTokenProvider("abc123"));

    expect(await strategy.headers()).toEqual({ authorization: "Bearer abc123" });
  });

  it("omits the header entirely when there is no token", async () => {
    // Not `Bearer null`, and not an empty string — an absent credential has to look
    // absent, or the server answers 401 on a header it should never have received.
    expect(await new BearerAuthStrategy(new InMemoryTokenProvider()).headers()).toEqual({});
  });

  it("never sends a cookie", async () => {
    // `omit`, not `include`. A desktop shell calling a third-party origin must not
    // hand it a session cookie the API would not have read anyway.
    expect(new BearerAuthStrategy(new InMemoryTokenProvider()).credentials).toBe("omit");
  });

  it("re-reads the provider on every request", async () => {
    const tokens = new InMemoryTokenProvider("first");
    const strategy = new BearerAuthStrategy(tokens);

    expect(await strategy.headers()).toEqual({ authorization: "Bearer first" });
    await tokens.set("second");
    expect(await strategy.headers()).toEqual({ authorization: "Bearer second" });
  });

  it("stops sending a credential once the token is cleared", async () => {
    // `set(null)` is the sign-out path, which is why there is no third method.
    const tokens = new InMemoryTokenProvider("abc123");
    const strategy = new BearerAuthStrategy(tokens);

    await tokens.set(null);

    expect(await strategy.headers()).toEqual({});
  });
});

describe("the strategy seam", () => {
  it("is interchangeable at the construction site and nowhere else", async () => {
    // Doc 18's gate, as an assertion: both satisfy `AuthStrategy`, so swapping one for
    // the other is one argument at one call site and no other edit anywhere.
    const strategies = [
      new CookieAuthStrategy(),
      new BearerAuthStrategy(new InMemoryTokenProvider("t")),
    ];

    for (const strategy of strategies) {
      expect(typeof (await strategy.headers())).toBe("object");
      expect(["omit", "same-origin", "include"]).toContain(strategy.credentials);
    }
  });
});
