// Secrets an organization hands wiremap (a model key, a webhook secret), encrypted at rest.
// The ciphertext names its key version, so a rotation reads old values and writes new ones.
export abstract class SecretCipher {
  public abstract encrypt(plaintext: string): string;

  // Throws on a value it cannot authenticate: a tampered or foreign ciphertext is never
  // returned as garbage.
  public abstract decrypt(ciphertext: string): string;
}
