// Free mail providers, which no organization may claim: everyone at one is a stranger to
// everyone else there. Lower case, compared after the caller lower-cases the domain.
const PUBLIC_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.net",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "yandex.ru",
  "fastmail.com",
  "hey.com",
  "tutanota.com",
  "qq.com",
  "163.com",
]);

// What a claimable auto-join domain is. One place, because the add use-case and the
// joiner at sign-up must agree on how an address maps to a domain.
export class MemberDomainRules {
  private constructor() {}

  public static normalise(domain: string): string {
    return domain.trim().toLowerCase().replace(/\.$/, "");
  }

  public static isPublic(domain: string): boolean {
    return PUBLIC_DOMAINS.has(MemberDomainRules.normalise(domain));
  }

  // The part after the last `@`, normalised. Null for a string that is not an address.
  public static domainOf(email: string): string | null {
    const at = email.lastIndexOf("@");
    if (at < 1 || at === email.length - 1) return null;
    return MemberDomainRules.normalise(email.slice(at + 1));
  }
}
