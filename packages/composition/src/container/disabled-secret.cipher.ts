import { SecretCipher, UnavailableError } from "../import.js";

// No `SECRET_ENCRYPTION_KEY`: nothing can be stored encrypted, so saving a model key fails
// plainly instead of storing it under a key nobody chose.
export class DisabledSecretCipher extends SecretCipher {
  public override encrypt(): string {
    throw new UnavailableError("secret-cipher");
  }

  public override decrypt(): string {
    throw new UnavailableError("secret-cipher");
  }
}
