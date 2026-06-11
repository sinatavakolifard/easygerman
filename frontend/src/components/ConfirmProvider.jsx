import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

// Styled replacements for window.confirm() / window.prompt(). Mount
// <ConfirmProvider> near the app root, then:
//   const confirm = useConfirm(); if (await confirm({...})) { ... }
//   const prompt = usePrompt();   const value = await prompt({...}); // null = cancelled
const ConfirmContext = createContext({
  confirm: () => Promise.resolve(false),
  prompt: () => Promise.resolve(null),
});

export function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState(null); // { kind, opts } | null
  const resolveRef = useRef(null);

  const open = useCallback((kind, options) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setDialog({ kind, opts: options || {} });
    });
  }, []);

  const confirm = useCallback((options) => open("confirm", options), [open]);
  const prompt = useCallback((options) => open("prompt", options), [open]);

  const settle = useCallback((result) => {
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

export function useConfirm() {
  return useContext(ConfirmContext).confirm;
}

export function usePrompt() {
  return useContext(ConfirmContext).prompt;
}

function useDialogKeys(onEscape) {
  useEffect(() => {
    const onKeyDown = (e) => {
      const { key } = e;
      if (key === "Escape") onEscape();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onEscape]);
}

function ConfirmDialog({ opts, onSettle }) {
  const {
    title = "Are you sure?",
    message,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    danger = false,
  } = opts;
  const confirmRef = useRef(null);

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

function PromptDialog({ opts, onSettle }) {
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
  const [fieldError, setFieldError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useDialogKeys(() => onSettle(null));

  const submit = (e) => {
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
