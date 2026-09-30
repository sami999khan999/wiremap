import {
  type ClientNamespace,
  createContext,
  type MessageParams,
  type MessageStore,
  type NamespaceKeys,
  type ReactNode,
  type ShellNamespace,
  type Translator,
  useCallback,
  useContext,
  useSyncExternalStore,
} from "../import.js";

const MessageContext = createContext<Translator | null>(null);

// Its own namespace plus the always-loaded shell, which every `ContentSource` puts in
// every snapshot — so the type says exactly what the runtime guarantees.
type ScopedKey<N extends ClientNamespace> = NamespaceKeys[N] | NamespaceKeys[ShellNamespace];

export interface MessageProviderProps {
  readonly messages: MessageStore;
  readonly children: ReactNode;
}

// The React binding for `content`'s `Translator`. It lives here rather than in `content`
// because that package has to stay React-free for the worker.
export function MessageProvider({ messages, children }: MessageProviderProps) {
  const subscribe = useCallback((onChange: () => void) => messages.subscribe(onChange), [messages]);
  const read = useCallback(() => messages.translator, [messages]);
  // Subscribed once, here, so `useMessages` stays a plain context read. A new translator
  // identity per call would re-render forever.
  const translator = useSyncExternalStore(subscribe, read, read);

  return <MessageContext.Provider value={translator}>{children}</MessageContext.Provider>;
}

// The translator itself, for the one caller that needs it un-narrowed: `ErrorCopy` picks
// its own shell key from the code, so a namespace parameter would have nothing to scope.
export function useTranslator(): Translator {
  const translator = useContext(MessageContext);
  if (!translator) throw new Error("useTranslator must be used inside a MessageProvider.");

  return translator;
}

// `N` is inferred from one argument position, which is what makes the constraint real:
// a two-argument `t(ns, key)` widens `N` until both arguments fit.
export function useMessages<N extends ClientNamespace>(namespace: N) {
  const translator = useTranslator();

  const t = useCallback(
    (key: ScopedKey<N>, params?: MessageParams) => translator.t(key, params),
    [translator],
  );

  return { t, locale: translator.locale, namespace };
}
