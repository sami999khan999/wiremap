import { Locales, SERVER_CATALOG, StaticContentSource } from "@loadbearing/content";
import {
  type MailTemplateKey,
  type MailTemplateParams,
  MailTemplates,
} from "@loadbearing/contracts";
import { describe, expect, it } from "vitest";
import { ContentMailRenderer } from "../../src/mail/content-mail.renderer.js";

const BASE = "https://app.example.test";

const renderer = () => new ContentMailRenderer(new StaticContentSource(SERVER_CATALOG), BASE);

const URL = "https://app.example.test/verify?token=a%20b&next=/x";

describe("ContentMailRenderer", () => {
  it("renders every template in the manifest, with both parts and a subject", async () => {
    for (const key of MailTemplates.keys()) {
      const rendered = await renderOne(key);

      expect(rendered.subject, key).not.toBe("");
      expect(rendered.text, key).not.toBe("");
      expect(rendered.html, key).toContain("<html>");
    }
  });

  it("carries the action URL in both parts, not just the button", async () => {
    const rendered = await renderer().render("auth.verify", Locales.DEFAULT, { url: URL });

    expect(rendered.text).toContain(URL);
    // Escaped in the HTML: an unescaped `&` in a query string truncates the link.
    expect(rendered.html).toContain("&amp;next=/x");
  });

  // Composed, never derived from the HTML by stripping tags — which is how a `&amp;` ends
  // up in a text body and the link stops working. Copy may legitimately contain a `<`.
  it("carries neither the layout's markup nor its entities into the text part", async () => {
    const rendered = await renderer().render("member.invitation", Locales.DEFAULT, {
      url: URL,
      inviter: "A & B",
      organization: "<Ops>",
    });

    expect(rendered.text).not.toMatch(/<(?:p|a|h1|table|html|body)\b/i);
    expect(rendered.text).not.toContain("&amp;");
    expect(rendered.text).toContain("A & B");
    expect(rendered.text).toContain(URL);
  });

  it("escapes copy that would otherwise break the document", async () => {
    const rendered = await renderer().render("member.invitation", Locales.DEFAULT, {
      url: URL,
      inviter: "A & B",
      organization: "<Ops>",
    });

    expect(rendered.html).toContain("&lt;Ops&gt;");
    expect(rendered.html).not.toContain("<Ops>");
  });

  // A code rendered as a URL is a second factor made clickable on the wrong device.
  it("gives the one-time code no action link", async () => {
    const rendered = await renderer().render("auth.otp", Locales.DEFAULT, { code: "123456" });

    expect(rendered.text).toContain("123456");
    expect(rendered.html).not.toContain("<a href");
  });

  it("renders in the recipient's locale rather than the default", async () => {
    const en = await renderer().render("auth.verify", "en", { url: URL });
    const bn = await renderer().render("auth.verify", "bn", { url: URL });

    expect(bn.subject).not.toBe(en.subject);
  });

  // A mail client has no page to resolve a relative href against, so `/settings/members`
  // rendered as nothing at all. The policy builds paths; the origin belongs here.
  it("makes a relative notification link absolute", async () => {
    const mail = await renderer().render("notification.single", "en", {
      kind: "member.joined",
      name: "Ada",
      url: "/settings/members",
    });

    expect(mail.html).toContain(`${BASE}/settings/members`);
    expect(mail.text).toContain(`${BASE}/settings/members`);
  });

  it("makes the digest's link absolute too", async () => {
    const mail = await renderer().render("notification.digest", "en", {
      count: 3,
      name: "Ada",
      organization: "Acme",
      url: "/notifications",
    });

    expect(mail.html).toContain(`${BASE}/notifications`);
  });

  // A caller that already knows the origin still passes one, and this must not double it.
  it("leaves an absolute link alone", async () => {
    const mail = await renderer().render("notification.single", "en", {
      kind: "member.joined",
      name: "Ada",
      url: "https://elsewhere.test/x",
    });

    expect(mail.html).toContain("https://elsewhere.test/x");
    expect(mail.html).not.toContain(`${BASE}https://`);
  });
});

// A total record, so a key added to the manifest fails to compile here rather than being
// skipped by a loop that reads the manifest at runtime.
const PARAMS: { readonly [K in MailTemplateKey]: MailTemplateParams<K> } = {
  "auth.verify": { url: URL },
  "auth.reset": { url: URL },
  "auth.change": { url: URL },
  "auth.otp": { code: "123456" },
  "member.invitation": { url: URL, inviter: "Ada", organization: "Acme" },
  "notification.single": { kind: "member.joined", name: "Ada", url: URL },
  "notification.digest": { count: 3, name: "Ada", organization: "Acme", url: URL },
};

const renderOne = <K extends MailTemplateKey>(key: K) =>
  renderer().render(key, Locales.DEFAULT, PARAMS[key]);
