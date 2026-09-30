export interface MailAction {
  readonly label: string;
  readonly url: string;
}

export interface MailContent {
  readonly heading: string;
  readonly paragraphs: readonly string[];
  // Absent for the one message that is not a link: rendering a second factor as a URL
  // makes it clickable on the wrong device.
  readonly action?: MailAction;
}

// The one place in this repository allowed to write a literal colour, and the exemption
// is recorded in docs/ai/rules/color.md. See the comment below for why.
const PALETTE = Object.freeze({
  bg: "#f9fafb",
  surface: "#ffffff",
  border: "#e3e5e7",
  fg: "#16181d",
  fgMuted: "#696d74",
  primary: "#236ade",
  primaryFg: "#fcfcfc",
});

// A mail client resolves no CSS custom property and honours no `<style>` block reliably,
// so `var(--primary)` renders as nothing at all. These are slate-light in sRGB.
const STYLE = Object.freeze({
  body: `margin:0;padding:0;background-color:${PALETTE.bg};`,
  card: `max-width:560px;margin:0 auto;background-color:${PALETTE.surface};border:1px solid ${PALETTE.border};border-radius:8px;padding:32px;`,
  font: "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;",
  heading: `margin:0 0 16px;font-size:20px;line-height:28px;font-weight:600;color:${PALETTE.fg};`,
  paragraph: `margin:0 0 16px;font-size:15px;line-height:24px;color:${PALETTE.fg};`,
  button: `display:inline-block;padding:12px 20px;border-radius:6px;background-color:${PALETTE.primary};color:${PALETTE.primaryFg};font-size:15px;line-height:20px;font-weight:600;text-decoration:none;`,
  fallback: `margin:24px 0 0;font-size:13px;line-height:20px;color:${PALETTE.fgMuted};word-break:break-all;`,
});

// Tables rather than divs, and inline styles rather than a stylesheet: that is what a mail
// client renders. Every string arriving here is already translated.
export class MailLayout {
  private constructor() {}

  public static html(content: MailContent): string {
    const paragraphs = content.paragraphs
      .map((text) => `<p style="${STYLE.paragraph}">${MailLayout.escape(text)}</p>`)
      .join("");

    return [
      `<!doctype html><html><head><meta charset="utf-8">`,
      `<meta name="viewport" content="width=device-width,initial-scale=1">`,
      `<title>${MailLayout.escape(content.heading)}</title></head>`,
      `<body style="${STYLE.body}${STYLE.font}">`,
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">`,
      `<tr><td style="padding:32px 16px;">`,
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="${STYLE.card}">`,
      `<tr><td>`,
      `<h1 style="${STYLE.heading}">${MailLayout.escape(content.heading)}</h1>`,
      paragraphs,
      content.action ? MailLayout.button(content.action) : "",
      `</td></tr></table></td></tr></table></body></html>`,
    ].join("");
  }

  // The same message with no markup in it. Not derived from the HTML: stripping tags is
  // how a `&amp;` ends up in a plain-text body and a URL stops working.
  public static text(content: MailContent): string {
    const blocks = [content.heading, ...content.paragraphs];
    if (content.action) blocks.push(`${content.action.label}: ${content.action.url}`);

    return `${blocks.join("\n\n")}\n`;
  }

  // The URL is repeated as text below the button, because a client that blocks the
  // styled anchor still has to leave the recipient something to copy.
  private static button(action: MailAction): string {
    const url = MailLayout.escape(action.url);

    return [
      `<p style="margin:24px 0 0;">`,
      `<a href="${url}" style="${STYLE.button}">${MailLayout.escape(action.label)}</a>`,
      `</p>`,
      `<p style="${STYLE.fallback}">${url}</p>`,
    ].join("");
  }

  // Copy is translated, not trusted markup: an organization named `A & B <ops>` is a
  // broken document and a URL with an `&` in its query is a broken link.
  private static escape(value: string): string {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
}
