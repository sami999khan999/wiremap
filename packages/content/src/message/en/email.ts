// Server-only copy. Reachable through `SERVER_CATALOG` and nothing else, which is what
// keeps it out of every client bundle — the CI grep for "email.digest." is the proof.
export const email = {
  "email.digest.subject": "Your daily digest — {count} updates",
  "email.digest.subjectEmpty": "Your daily digest",
  "email.digest.greeting": "Hello {name},",
  "email.digest.intro": "Here is what changed across your goals since yesterday.",
  "email.digest.empty": "Nothing changed since yesterday. Enjoy the quiet.",
  "email.digest.viewAll": "Open the dashboard",
  "email.digest.footer": "You are receiving this because you belong to {organization}.",
  "email.digest.unsubscribe": "Change how often you hear from us",

  // Short on purpose: the link is the message, and every extra sentence is one more
  // place for a phishing template to hide.
  "email.verify.subject": "Confirm your email address",
  "email.verify.body":
    "Open the link below to confirm this address and finish setting up your account. It expires in an hour, and if you did not sign up you can ignore this message.",
  "email.verify.action": "Confirm this address",
  "email.reset.subject": "Reset your password",
  "email.reset.body":
    "Open the link below to choose a new password. It expires in an hour, and signing in with your existing password will cancel it. If you did not ask for this, nothing has changed.",
  "email.reset.action": "Choose a new password",
  "email.change.subject": "Confirm the change to your email address",
  "email.change.body":
    "Someone asked to move this account to a different email address. Open the link below to approve it. This message goes to your current address on purpose — if it was not you, do not open the link, and change your password.",
  "email.change.action": "Approve the change",

  // Nothing here is clickable: the person reading it is signing in on a different device
  // from the one holding this mailbox.
  "email.otp.subject": "Your sign-in code",
  "email.otp.body": "Your sign-in code is {code}.",
  "email.otp.expiry":
    "It expires in five minutes. If you did not try to sign in, someone has your password — change it.",

  // The address may have no account yet, so it says what to do either way and promises
  // nothing about what the link will show.
  "email.invitation.subject": "{inviter} invited you to {organization}",
  "email.invitation.body":
    "{inviter} has invited you to join {organization}. Open the link below to accept. If you do not have an account yet you will be asked to create one with this address — the invitation is tied to it. It expires in seven days, and if you were not expecting this you can ignore it.",
  "email.invitation.action": "Join {organization}",

  // The bell, by mail. Deliberately not a copy of the in-app copy: this one has to make
  // sense to somebody who has not opened the app today.
  "email.notification.subject": "There is an update in your workspace",
  "email.notification.greeting": "Hello {name},",
  "email.notification.body":
    "Something changed that you asked to hear about. Open your notifications to see what it was.",
  "email.notification.action": "Open notifications",
} as const;
