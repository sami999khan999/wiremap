import { type ApiClient, createContext, type ReactNode, useContext } from "../import.js";

const ApiClientContext = createContext<ApiClient | null>(null);

export interface ApiClientProviderProps {
  readonly client: ApiClient;
  readonly children: ReactNode;
}

// Context rather than a module singleton: the SSR instance and the browser instance are
// different objects with different transports.
export function ApiClientProvider({ client, children }: ApiClientProviderProps): ReactNode {
  return <ApiClientContext.Provider value={client}>{children}</ApiClientContext.Provider>;
}

export function useApiClient(): ApiClient {
  const client = useContext(ApiClientContext);
  if (!client) {
    throw new Error("useApiClient must be used inside an ApiClientProvider.");
  }
  return client;
}
