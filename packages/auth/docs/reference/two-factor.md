---
title: Two-factor
description: Three factors that are alternatives rather than a sequence, why enrolment is not finished until a code comes back, why the OTP period is in minutes, and what the password on every management call is actually protecting.
---

# Two-factor

The `twoFactor` plugin, configured once in `AuthFactory`:

```ts
twoFactor({
  schema: { twoFactor: { modelName: "twoFactors" } },
  issuer: config.appName,
  backupCodeOptions: { amount: 10, length: 10 },
  otpOptions: {
    period: 5,
    sendOTP: async ({ user, otp }) => mailer.sendTwoFactorOtp(user.email, otp),
  },
})
```

## Three factors, and they are alternatives

A sign-in that answers `TWO_FACTOR_REQUIRED` can be finished three ways, and `TwoFactorForm` offers
all three from wherever the user currently is:

| Factor | Endpoint | For |
|---|---|---|
| TOTP | `/two-factor/verify-totp` | The normal path |
| Backup code | `/two-factor/verify-backup-code` | The phone is gone |
| Email OTP | `/two-factor/verify-otp` | The phone is merely elsewhere |

**There is no order to get stuck in.** The person on this screen is already having a bad day, and a
recovery path reachable only from the factor they cannot produce is not a recovery path. Switching
clears the code, because carrying a half-typed six-digit TOTP into the backup-code field submits
something guaranteed to fail — and burns one of the three attempts a minute the server allows.

Without backup codes, enrolling two-factor is a one-way door. That is the whole reason ten of them
are generated at enrolment and shown once.

## `period` is in minutes

Better Auth's `otpOptions.period` is **minutes**, defaulting to 3. Reading it as seconds and writing
`period: 300` produces a five-hour second factor that looks entirely correct in review and passes
every test anyone would think to write.

Five minutes is a compromise with mail delivery latency. Longer widens the window in which a
forwarded message is still a valid second factor.

## Enrolment is not finished when `enable` returns

`twoFactor.enable` hands back the `otpauth://` URI and the backup codes, and two-factor is **not on
yet**. It becomes on when `verifyTotp` succeeds against a code the authenticator app produced.

That third step is not ceremony. Enabling on the strength of a QR nobody scanned — or scanned into
an app on a phone that then ran out of battery, or scanned wrongly — locks the user out at their
next sign-in with no way back in. `TwoFactorSetup` is a three-step wizard for exactly this reason:
password, scan, prove it scanned.

`skipVerificationOnEnable` exists and is deliberately left at its default `false`.

## The password on every management call

`enable`, `disable` and `generateBackupCodes` all take the current password. The reason is one
sentence: **a stolen session must not be able to change what protects the account.**

Without it, someone holding a hijacked cookie can enrol their own authenticator, or turn the factor
off entirely, and the real owner finds out at their next sign-in. The password is the thing the
attacker does not have, and asking for it is what makes the session alone insufficient.

The same argument is why `disableTwoFactor` asks for it too. Turning protection *off* is the more
dangerous of the two.

## The QR is rendered, not fetched

`QrCode` in `packages/ui` encodes the URI locally with `uqr` and draws `<rect>` elements. Nothing is
sent anywhere. The obvious alternative — an `<img>` pointed at a QR-generating service — puts a TOTP
secret in a third party's access log, which is the same as publishing it.

The modules paint with `currentColor`, so the code follows the theme like every icon in `asset`. The
secret is also rendered as selectable text beside it, for anyone whose authenticator cannot use a
camera; it is the same string the QR encodes, so there is nothing to keep in step.

## Backup codes are shown once

Better Auth stores them encrypted and its `viewBackupCodes` endpoint is server-only on purpose, so
this application genuinely cannot show them again. The copy at enrolment carries the whole warning
because there is no second screen to put it on.

Regenerating invalidates every previous code. That is the point rather than a side effect: codes
that have been printed, screenshotted or pasted into a note are exactly the reason to ask for a
fresh set.

## Account lockout

`accountLockout` is left at its defaults — ten consecutive failed verifications, fifteen minutes,
counted across challenges and factors and reset on success. It is separate from the rate limit on
`/two-factor/send-otp`, which caps how often this deployment can be made to send mail rather than
how often a code can be guessed.

## Related

- [`packages/auth/docs/reference/enrolment.md`](./enrolment.md) — the other thing that happens at
  first sign-in.
- `docs/setup/16-auth-package.md` §16.8 — the security checklist this configuration answers.
