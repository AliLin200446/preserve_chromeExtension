import type { ReactNode } from "react";
import { Check, Circle, RotateCcw } from "lucide-react";
/** Labels always accompany color so status does not rely on hue alone. */
export function StatusBadge({
  tone = "neutral",
  children,
}: {
  tone?: "sage" | "blue" | "rust" | "neutral";
  children: ReactNode;
}) {
  const Icon = tone === "sage" ? Check : tone === "rust" ? RotateCcw : Circle;
  return (
    <span className={`notebook-status tone-${tone}`}>
      <Icon size={12} aria-hidden="true" />
      {children}
    </span>
  );
}
export function NotebookEmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="notebook-empty">
      <span className="empty-mark" aria-hidden="true">
        ＋
      </span>
      <div>
        <h3>{title}</h3>
        <p>{children}</p>
        {action && <div className="empty-action">{action}</div>}
      </div>
    </div>
  );
}
