import { SecretCipher } from "../import.js";

// Marks a value as encrypted without encrypting it, so a spec can see what was stored.
export class ReversibleSecretCipher extends SecretCipher {
  public override encrypt(plaintext: string): string {
    return `fake:${plaintext}`;
  }

  public override decrypt(ciphertext: string): string {
    if (!ciphertext.startsWith("fake:")) throw new Error("Unreadable secret");
    return ciphertext.slice("fake:".length);
  }
}
