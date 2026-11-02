import { useState, useCallback, useRef, useEffect, createContext, useContext } from "react";
import { useTranslation } from "react-i18next";
import { DialogShell } from "./ui";

/** Shown confirm or prompt and the resolver of its promise, null when neither is open. */
type DialogState =
  | { type: "confirm"; id: number; message: string; resolve: (ok: boolean) => void }
  | { type: "prompt"; id: number; message: string; defaultValue: string; resolve: (val: string | null) => void }
  | null;

/** Promise-based confirm and prompt calls the dialog context provides. */
interface DialogContextValue {
  confirm: (message: string) => Promise<boolean>;
  prompt: (message: string, defaultValue?: string) => Promise<string | null>;
}

/** Context carrying confirm and prompt, null outside DialogProvider. */
const DialogContext = createContext<DialogContextValue | null>(null);

/** Use the themed confirm and prompt dialogs; throws outside DialogProvider. */
export function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialog must be inside DialogProvider");
  return ctx;
}

/** Provider of promise-based confirm and prompt dialogs; a new one cancels the one shown. */
export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [dialog, setDialog] = useState<DialogState>(null);
  const shown = useRef<DialogState>(null);
  const nextId = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const show = useCallback((next: NonNullable<DialogState>) => {
    const prev = shown.current;
    if (prev?.type === "confirm") prev.resolve(false);
    else if (prev?.type === "prompt") prev.resolve(null);
    shown.current = next;
    setDialog(next);
  }, []);

  const confirm = useCallback((message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      show({ type: "confirm", id: ++nextId.current, message, resolve });
    });
  }, [show]);

  const prompt = useCallback((message: string, defaultValue = ""): Promise<string | null> => {
    return new Promise((resolve) => {
      show({ type: "prompt", id: ++nextId.current, message, defaultValue, resolve });
    });
  }, [show]);

  function close(result: boolean | string | null) {
    if (!dialog || shown.current !== dialog) return;
    shown.current = null;
    if (dialog.type === "confirm") {
      dialog.resolve(result as boolean);
    } else {
      dialog.resolve(result as string | null);
    }
    setDialog(null);
  }

  useEffect(() => {
    if (dialog?.type === "prompt") {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [dialog]);

  return (
    <DialogContext.Provider value={{ confirm, prompt }}>
      {children}
      {dialog && (
        <DialogOverlay
          key={dialog.id}
          dialog={dialog}
          inputRef={inputRef}
          onClose={close}
        />
      )}
    </DialogContext.Provider>
  );
}

/** Confirm or prompt dialog; Enter accepts unless a button has focus, Escape or backdrop cancels. */
function DialogOverlay({
  dialog,
  inputRef,
  onClose,
}: {
  dialog: NonNullable<DialogState>;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onClose: (result: boolean | string | null) => void;
}) {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState(
    dialog.type === "prompt" ? dialog.defaultValue : "",
  );

  function handleOk() {
    if (dialog.type === "confirm") {
      onClose(true);
    } else {
      onClose(inputValue);
    }
  }

  function handleCancel() {
    if (dialog.type === "confirm") {
      onClose(false);
    } else {
      onClose(null);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) handleOk();
  }

  return (
    <DialogShell
      onClose={handleCancel}
      zIndex={100}
      backdropOpacity={0.5}
      panelClassName="rounded-lg"
      panelStyle={{ minWidth: "340px", maxWidth: "460px", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}
    >
      <div className="p-5 flex flex-col gap-4" onKeyDown={handleKeyDown}>
        <p
          className="text-sm whitespace-pre-wrap"
          style={{ color: "var(--text-primary)" }}
        >
          {dialog.message}
        </p>

        {dialog.type === "prompt" && (
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            className="px-3 py-1.5 rounded text-sm w-full"
            style={{
              background: "var(--bg-secondary)",
              color: "var(--text-primary)",
              border: "1px solid var(--border)",
              outline: "none",
            }}
          />
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={handleCancel}
            className="px-4 py-1.5 rounded text-xs font-medium"
            style={{
              background: "var(--bg-tertiary)",
              color: "var(--text-primary)",
            }}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={handleOk}
            className="px-4 py-1.5 rounded text-xs font-medium"
            style={{
              background: "var(--accent)",
              color: "#fff",
            }}
          >
            {t("common.ok")}
          </button>
        </div>
      </div>
    </DialogShell>
  );
}
