import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

export interface ConfirmOptions {
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface PromptOptions extends ConfirmOptions {
  label?: string;
  placeholder?: string;
  inputType?: string;
  validate?: (value: string) => string | null;
}

type ConfirmFn = (options?: ConfirmOptions) => Promise<boolean>;
type PromptFn = (options?: PromptOptions) => Promise<string | null>;

interface ConfirmContextValue {
  confirm: ConfirmFn;
  prompt: PromptFn;
}

type DialogState =
  | { kind: "confirm"; opts: ConfirmOptions }
  | { kind: "prompt"; opts: PromptOptions }
  | null;

// Styled replacements for window.confirm() / window.prompt(). Mount
// <ConfirmProvider> near the app root, then:
//   const confirm = useConfirm(); if (await confirm({...})) { ... }
//   const prompt = usePrompt();   const value = await prompt({...}); // null = cancelled
const ConfirmContext = createContext<ConfirmContextValue>({
  confirm: () => Promise.resolve(false),
  prompt: () => Promise.resolve(null),
});

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogState>(null);
  const resolveRef = useRef<((value: boolean | string | null) => void) | null>(
    null
  );

  const open = useCallback(
    (state: NonNullable<DialogState>) =>
      new Promise<boolean | string | null>((resolve) => {
        resolveRef.current = resolve;
        setDialog(state);
      }),
    []
  );

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      open({ kind: "confirm", opts: options ?? {} }) as Promise<boolean>,
    [open]
  );
  const prompt = useCallback<PromptFn>(
    (options) =>
      open({ kind: "prompt", opts: options ?? {} }) as Promise<string | null>,
    [open]
  );

  const settle = useCallback((result: boolean | string | null) => {
    setDialog(null);
    if (resolveRef.current) {
      resolveRef.current(result);
      resolveRef.current = null;
    }
  }, []);

  return (
    <ConfirmContext.Provider value={{ confirm, prompt }}>
      {children}
      {dialog &&
        (dialog.kind === "prompt" ? (
          <PromptDialog opts={dialog.opts} onSettle={settle} />
        ) : (
          <ConfirmDialog opts={dialog.opts} onSettle={settle} />
        ))}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext).confirm;
}

export function usePrompt(): PromptFn {
  return useContext(ConfirmContext).prompt;
}

function useDialogKeys(onEscape: () => void) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { key } = e;
      if (key === "Escape") onEscape();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onEscape]);
}

interface ConfirmDialogProps {
  opts: ConfirmOptions;
  onSettle: (result: boolean) => void;
}

function ConfirmDialog({ opts, onSettle }: ConfirmDialogProps) {
  const {
    title = "Are you sure?",
    message,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    danger = false,
  } = opts;
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);
  useDialogKeys(() => onSettle(false));

  return (
    <div className="modal-backdrop" onClick={() => onSettle(false)}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="modal-title">{title}</h2>
        {message && <p className="modal-message">{message}</p>}
        <div className="modal-actions">
          <button
            type="button"
            className="modal-btn"
            onClick={() => onSettle(false)}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            ref={confirmRef}
            className={`modal-btn ${danger ? "modal-btn--danger" : "modal-btn--primary"}`}
            onClick={() => onSettle(true)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

interface PromptDialogProps {
  opts: PromptOptions;
  onSettle: (result: string | null) => void;
}

function PromptDialog({ opts, onSettle }: PromptDialogProps) {
  const {
    title = "Enter a value",
    message,
    label,
    placeholder = "",
    inputType = "text",
    confirmLabel = "Save",
    cancelLabel = "Cancel",
    danger = false,
    validate,
  } = opts;
  const [value, setValue] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useDialogKeys(() => onSettle(null));

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (validate) {
      const msg = validate(value);
      if (msg) {
        setFieldError(msg);
        return;
      }
    }
    onSettle(value);
  };

  return (
    <div className="modal-backdrop" onClick={() => onSettle(null)}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 className="modal-title">{title}</h2>
        {message && <p className="modal-message">{message}</p>}
        <label className="modal-field">
          {label && <span>{label}</span>}
          <input
            ref={inputRef}
            type={inputType}
            value={value}
            placeholder={placeholder}
            onChange={(e) => {
              setValue(e.target.value);
              if (fieldError) setFieldError(null);
            }}
          />
        </label>
        {fieldError && <p className="modal-error">{fieldError}</p>}
        <div className="modal-actions">
          <button
            type="button"
            className="modal-btn"
            onClick={() => onSettle(null)}
          >
            {cancelLabel}
          </button>
          <button
            type="submit"
            className={`modal-btn ${danger ? "modal-btn--danger" : "modal-btn--primary"}`}
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
