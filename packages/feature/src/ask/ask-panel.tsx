import { PLAIN_BUTTON } from "../graph/role-tone.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  Callout,
  ErrorNormalizer,
  type GraphDocument,
  type ProjectId,
  Textarea,
  useApiClient,
  useRef,
  useState,
} from "../import.js";
import { Citations } from "./citations.js";

interface Turn {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly cached?: boolean;
  readonly files?: number;
}

type Preset = "file" | "folder" | "onboarding";

export interface AskPanelProps {
  readonly projectId: ProjectId;
  readonly document: GraphDocument;
  readonly selected: string | null;
  readonly onSelect: (path: string) => void;
}

// One thread for the session. The answer streams in as the model writes it; a citation of
// a real file or route selects it on the canvas; Stop aborts the request and the call.
export function AskPanel({ projectId, document, selected, onSelect }: AskPanelProps) {
  const { t } = useMessages("ask");
  const client = useApiClient();
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const ask = async (question: string, preset: Preset | null) => {
    if (busy || question.trim() === "") return;
    const history = turns.map((turn) => ({ role: turn.role, text: turn.text })).slice(-10);
    setError(null);
    setDraft("");
    setBusy(true);
    setTurns((current) => [
      ...current,
      { role: "user", text: question },
      { role: "assistant", text: "" },
    ]);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const stream = await client.ask.question(
        { projectId, question, preset, history },
        { signal: controller.signal },
      );
      for await (const chunk of stream) {
        setTurns((current) => {
          const last = current.at(-1);
          if (last?.role !== "assistant") return current;
          const next =
            chunk.kind === "text"
              ? { ...last, text: last.text + chunk.text }
              : { ...last, cached: chunk.cached, files: chunk.files.length };
          return [...current.slice(0, -1), next];
        });
      }
    } catch (caught) {
      if (!controller.signal.aborted) {
        const envelope = ErrorNormalizer.normalize(caught);
        setError(
          envelope.code === "RATE_LIMITED"
            ? t("ask.limited")
            : envelope.fields?.[0]?.rule === "off"
              ? t("ask.off")
              : t("ask.failed"),
        );
      }
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  const selectedName = selected ? (selected.split("/").pop() ?? selected) : null;
  const isFile = selected !== null && document.files.some((file) => file.path === selected);

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {turns.length === 0 ? (
          <div className="flex flex-col gap-2">
            <Button
              variant="secondary"
              onClick={() => void ask(t("ask.question.onboarding"), "onboarding")}
            >
              {t("ask.preset.onboarding")}
            </Button>
            {selected && selectedName ? (
              <Button
                variant="secondary"
                onClick={() =>
                  void ask(
                    t(isFile ? "ask.question.file" : "ask.question.folder", { path: selected }),
                    isFile ? "file" : "folder",
                  )
                }
              >
                {t("ask.preset.file", { name: selectedName })}
              </Button>
            ) : null}
          </div>
        ) : null}
        {turns.map((turn, index) => (
          <div
            key={index}
            className={
              turn.role === "user" ? "self-end rounded-lg bg-muted px-3 py-2 text-sm" : "text-sm"
            }
          >
            {turn.role === "assistant" ? (
              <>
                <p className="m-0 whitespace-pre-wrap leading-relaxed">
                  {turn.text === "" && busy ? (
                    <span className="text-fg-muted">{t("ask.thinking")}</span>
                  ) : (
                    Citations.split(turn.text, document).map((segment, at) =>
                      segment.kind === "text" ? (
                        <span key={at}>{segment.text}</span>
                      ) : (
                        <button
                          key={at}
                          type="button"
                          onClick={() => onSelect(segment.path)}
                          className={`${PLAIN_BUTTON} rounded-sm bg-muted px-1 font-mono text-xs text-primary hover:underline`}
                        >
                          {segment.text}
                        </button>
                      ),
                    )
                  )}
                </p>
                {turn.files !== undefined ? (
                  <p className="m-0 mt-1 text-[11px] text-fg-muted">
                    {turn.cached ? `${t("ask.cached")} · ` : ""}
                    {t("ask.grounded", { count: turn.files })}
                  </p>
                ) : null}
              </>
            ) : (
              turn.text
            )}
          </div>
        ))}
        {error ? <Callout tone="warning">{error}</Callout> : null}
      </div>
      <form
        className="flex flex-col gap-2 border-t border-border p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(draft, null);
        }}
      >
        <Textarea
          aria-label={t("ask.placeholder")}
          placeholder={t("ask.placeholder")}
          rows={3}
          maxLength={2_000}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void ask(draft, null);
            }
          }}
        />
        <div className="flex justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={busy || turns.length === 0}
            onClick={() => setTurns([])}
          >
            {t("ask.clear")}
          </Button>
          {busy ? (
            <Button type="button" variant="secondary" onClick={() => abort.current?.abort()}>
              {t("ask.stop")}
            </Button>
          ) : (
            <Button type="submit" disabled={draft.trim() === ""}>
              {t("ask.send")}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
