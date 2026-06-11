import { useEffect, useRef } from "react";

// Transient, dismissible notification pinned to the bottom of the viewport.
// Auto-hides after `duration` ms; renders nothing when `message` is falsy.
// Used for non-fatal action failures (e.g. a save that fails while offline)
// so the page content stays put instead of being replaced by an error.
export default function Toast({ message, onClose, duration = 6000, type = "error" }) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!message) return undefined;
    const t = setTimeout(() => onCloseRef.current(), duration);
    return () => clearTimeout(t);
  }, [message, duration]);

  if (!message) return null;

  return (
    <div className={`toast ${type === "success" ? "toast--success" : ""}`} role="alert">
      <span className="toast-msg">{message}</span>
      <button
        type="button"
        className="toast-close"
        aria-label="Dismiss"
        onClick={onClose}
      >
        ×
      </button>
    </div>
  );
}
