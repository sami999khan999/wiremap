import { AppError } from "./app.error.js";

// A server-only package was loaded in a client bundle. The context key is `package`
// because that key *is* the `{package}` placeholder in `error.serverOnly`.
export class ServerOnlyError extends AppError {
  public constructor(packageName: string) {
    super("SERVER_ONLY", { package: packageName });
  }
}
