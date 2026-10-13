import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  Copy,
  Image as ImageIcon,
  Plus,
  Upload,
  X,
} from "lucide-react";
import { thumbnailFor } from "./thumbnails";
import {
  exportPrompt,
  promptLabels,
  type Attempt,
  type ReferenceContract,
  type RuleMode,
} from "./domain";
export function Preview({
  blob,
  label,
  small = false,
  thumbnail = false,
}: {
  blob?: Blob;
  label: string;
  small?: boolean;
  thumbnail?: boolean;
}) {
  const [url, setUrl] = useState("");
  const host = useRef<HTMLElement | null>(null);
  useEffect(() => {
    let live = true,
      objectUrl = "";
    setUrl("");
    if (!blob) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        void (
          small || thumbnail ? thumbnailFor(blob) : Promise.resolve(blob)
        ).then((image) => {
          if (!live) return;
          objectUrl = URL.createObjectURL(image);
          setUrl(objectUrl);
        });
      },
      { rootMargin: "160px" },
    );
    if (host.current) observer.observe(host.current);
    return () => {
      live = false;
      observer.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [blob, small, thumbnail]);
  return url ? (
    <img
      ref={(element) => {
        host.current = element;
      }}
      loading="lazy"
      decoding="async"
      className={small ? "thumbnail" : "preview"}
      src={url}
      alt={label}
    />
  ) : (
    <div
      ref={(element) => {
        host.current = element;
      }}
      className={small ? "image-placeholder thumbnail" : "image-placeholder"}
    >
      <ImageIcon size={22} strokeWidth={1} />
      <span>An image to come</span>
    </div>
  );
}
export function UploadControl({
  onUpload,
  replace = false,
  disabled = false,
}: {
  onUpload: (file: File) => void;
  replace?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className="upload-control">
      <Upload size={16} />
      <span>{replace ? "Replace image" : "Upload an image"}</span>
      <input
        aria-label="Upload image"
        disabled={disabled}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onUpload(file);
        }}
      />
    </label>
  );
}
export function SectionTitle({
  number,
  title,
  aside,
}: {
  number: string;
  title: string;
  aside?: ReactNode;
}) {
  return (
    <div className="section-title">
      <span className="section-number">{number}</span>
      <h2>{title}</h2>
      {aside}
    </div>
  );
}
export function Modal({
  open,
  title,
  onClose,
  children,
  wide = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className={wide ? "wide-dialog" : ""}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={onClose}
    >
      <div className="dialog-heading">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label={`Close ${title}`}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {open && children}
    </dialog>
  );
}
export function ContractSummary({ contract }: { contract: ReferenceContract }) {
  return (
    <div className="contract-summary">
      {(["PRESERVE", "CHANGE", "ADAPT", "IGNORE"] as const).map((mode) => {
        const attributes = contract.attributes.filter((a) => a.mode === mode);
        return (
          <div key={mode}>
            <h3>
              {
                {
                  PRESERVE: "Keep",
                  CHANGE: "Change",
                  ADAPT: "Adapt",
                  IGNORE: "Ignore",
                }[mode]
              }
            </h3>
            {attributes.length ? (
              <ul>
                {attributes.map((a, i) => (
                  <li key={i}>
                    {a.name}
                    {a.notes && <small>{a.notes}</small>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="helper">None specified</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
export function ContractEditor({
  attempt,
  onChange,
  onRevise,
}: {
  attempt: Attempt;
  onChange: (patch: Partial<Attempt>) => void;
  onRevise: () => void;
}) {
  const editable = attempt.status === "DRAFT";
  return (
    <details className="disclosure">
      <summary>
        {editable
          ? "Edit preservation requirements"
          : "View preservation requirements"}
        <Plus size={15} />
      </summary>
      <p className="helper">
        These instructions express creative intent. Results must still be
        reviewed.
      </p>
      <label>
        Known failure points
        <textarea
          aria-label="Known failure points"
          readOnly={!editable}
          value={attempt.contract.knownFailurePoints ?? ""}
          onChange={(e) =>
            onChange({
              contract: {
                ...attempt.contract,
                knownFailurePoints: e.target.value,
              },
            })
          }
          placeholder="Details to check again in the next output…"
        />
      </label>
      <fieldset disabled={!editable}>
        {(["PRESERVE", "CHANGE", "ADAPT", "IGNORE"] as const).map((mode) => (
          <section className="grouped-contract" key={mode}>
            <h3>
              {
                {
                  PRESERVE: "Keep",
                  CHANGE: "Change",
                  ADAPT: "Adapt",
                  IGNORE: "Ignore",
                }[mode]
              }
            </h3>
            {attempt.contract.attributes.map((a, i) =>
              a.mode === mode ? (
                <div className="contract-rule" key={i}>
                  <label>
                    {a.name}
                    <select
                      aria-label={`${a.name} requirement`}
                      value={a.mode}
                      onChange={(e) =>
                        onChange({
                          contract: {
                            ...attempt.contract,
                            attributes: attempt.contract.attributes.map(
                              (x, j) =>
                                j === i
                                  ? { ...x, mode: e.target.value as RuleMode }
                                  : x,
                            ),
                          },
                        })
                      }
                    >
                      {Object.entries({
                        PRESERVE: "Keep unchanged",
                        ADAPT: "Adapt gently",
                        CHANGE: "Explore freely",
                        IGNORE: "No requirement",
                      }).map(([v, label]) => (
                        <option key={v} value={v}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <input
                    aria-label={`${a.name} notes`}
                    placeholder="A little more direction…"
                    value={a.notes}
                    onChange={(e) =>
                      onChange({
                        contract: {
                          ...attempt.contract,
                          attributes: attempt.contract.attributes.map((x, j) =>
                            j === i ? { ...x, notes: e.target.value } : x,
                          ),
                        },
                      })
                    }
                  />
                </div>
              ) : null,
            )}
          </section>
        ))}
      </fieldset>
      {editable ? (
        <button
          className="text-button"
          onClick={() => {
            const name = window.prompt(
              "What else should the next iteration consider?",
            );
            if (name?.trim())
              onChange({
                contract: {
                  ...attempt.contract,
                  attributes: [
                    ...attempt.contract.attributes,
                    { name: name.trim(), mode: "PRESERVE", notes: "" },
                  ],
                },
              });
          }}
        >
          <Plus size={15} />
          Add a requirement
        </button>
      ) : attempt.status === "APPROVED" ? (
        <button onClick={onRevise}>Revise this kept version</button>
      ) : (
        <p className="helper">
          These notes belong to this iteration. Try again to edit a new copy.
        </p>
      )}
    </details>
  );
}
export function DirectionNotes({
  attempt,
  onChange,
  onCopy,
}: {
  attempt: Attempt;
  onChange: (patch: Partial<Attempt>) => void;
  onCopy: (text: string) => void;
}) {
  const [writing, setWriting] = useState(false);
  const [concise, setConcise] = useState(false);
  const editable = attempt.status === "DRAFT";
  return (
    <div className="direction-notes">
      <p className="direction-excerpt">
        {attempt.prompt.subject ||
          attempt.prompt.objective ||
          "Every image begins with an intention. What would you like to make?"}
      </p>
      {attempt.prompt.notes && !writing && (
        <p className="written-note">{attempt.prompt.notes}</p>
      )}
      <div className="inline-actions">
        {editable && (
          <button
            className="text-button"
            aria-expanded={writing}
            onClick={() => setWriting(!writing)}
          >
            {writing ? "Close writing" : "Write direction"}
            <ArrowDown size={14} />
          </button>
        )}
        <button
          className="text-button"
          onClick={() =>
            onCopy(exportPrompt(attempt.prompt, attempt.contract, concise))
          }
        >
          <Copy size={15} />
          Copy prompt
        </button>
      </div>
      {writing && (
        <label>
          In your own words
          <textarea
            aria-label="In your own words"
            rows={5}
            value={attempt.prompt.notes}
            placeholder="The feeling, the story, the small details worth keeping…"
            onChange={(e) =>
              onChange({ prompt: { ...attempt.prompt, notes: e.target.value } })
            }
          />
          <span className="helper">
            Saved as Additional notes, alongside your structured direction.
          </span>
        </label>
      )}
      <details className="disclosure">
        <summary>
          {editable ? "Edit details" : "Read direction details"}
          <Plus size={15} />
        </summary>
        <fieldset disabled={!editable}>
          {Object.entries(promptLabels).map(([key, label]) => (
            <label key={key}>
              {label}
              <textarea
                aria-label={label}
                rows={2}
                value={attempt.prompt[key as keyof typeof promptLabels]}
                onChange={(e) =>
                  onChange({
                    prompt: { ...attempt.prompt, [key]: e.target.value },
                  })
                }
              />
            </label>
          ))}
        </fieldset>
      </details>
      <details className="disclosure">
        <summary>
          View structured prompt
          <Plus size={15} />
        </summary>
        <label>
          Export format
          <select
            aria-label="Prompt export mode"
            value={concise ? "concise" : "structured"}
            onChange={(e) => setConcise(e.target.value === "concise")}
          >
            <option value="structured">Structured sections</option>
            <option value="concise">Natural language</option>
          </select>
        </label>
        <textarea
          className="prompt-export"
          aria-label="Compiled prompt"
          readOnly
          rows={9}
          value={exportPrompt(attempt.prompt, attempt.contract, concise)}
        />
        <p className="helper">
          Assembled from your notes and requirements. No AI rewriting.
        </p>
      </details>
    </div>
  );
}
