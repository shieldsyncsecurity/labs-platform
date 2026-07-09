"use client";

import { useEffect, useMemo, useState } from "react";

/* Client UI for /admin/blog. Loads the current post list via the admin API
 * (GitHub-backed), edits locally, and saves = commit to the marketing repo.
 * The page shell is static; this component is the auth-aware surface. */

// ---- data model (mirrors content/blog/<slug>.json) -------------------------
type BlockType = "p" | "h2" | "ul" | "code" | "callout";

type Block =
  | { t: "p"; text: string }
  | { t: "h2"; text: string }
  | { t: "ul"; items: string[] }
  | { t: "code"; code: string }
  | { t: "callout"; text: string };

type Post = {
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  date: string; // "Apr 22, 2026"
  read: string; // "10 min"
  image: string; // "/blog/<slug>.svg"
  body: Block[];
};

// Editor-side block: ul edits as a newline string, everything else as `text`.
type EBlock = { id: number; t: BlockType; text: string; items: string };

type Draft = {
  isNew: boolean;
  slug: string;
  slugTouched: boolean;
  title: string;
  excerpt: string;
  category: string;
  dateIso: string; // "2026-04-22"
  read: string;
  image: string; // preserved on edit; defaulted to /blog/<slug>.svg on new
  blocks: EBlock[];
};

// ---- helpers ---------------------------------------------------------------
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function toInputDate(human: string): string {
  // "Apr 22, 2026" -> "2026-04-22"
  const m = /^([A-Za-z]{3,})\s+(\d{1,2}),\s*(\d{4})$/.exec((human || "").trim());
  if (!m) return "";
  const mi = MONTHS.findIndex((x) => x.toLowerCase() === m[1].slice(0, 3).toLowerCase());
  if (mi < 0) return "";
  return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function fromInputDate(iso: string): string {
  // "2026-04-22" -> "Apr 22, 2026"
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso || "").trim());
  if (!m) return "";
  const mi = Number(m[2]) - 1;
  if (mi < 0 || mi > 11) return "";
  return `${MONTHS[mi]} ${Number(m[3])}, ${m[1]}`;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

let uid = 1;
function nextId(): number {
  return uid++;
}

function blockToEditor(b: Block): EBlock {
  if (b.t === "ul") return { id: nextId(), t: "ul", text: "", items: b.items.join("\n") };
  if (b.t === "code") return { id: nextId(), t: "code", text: b.code, items: "" };
  return { id: nextId(), t: b.t, text: b.text, items: "" };
}

function editorToBlock(e: EBlock): Block | null {
  if (e.t === "ul") {
    const items = e.items.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    return items.length ? { t: "ul", items } : null;
  }
  if (e.t === "code") {
    return e.text.trim() ? { t: "code", code: e.text } : null;
  }
  return e.text.trim() ? { t: e.t, text: e.text } : null;
}

function newDraft(): Draft {
  return {
    isNew: true,
    slug: "",
    slugTouched: false,
    title: "",
    excerpt: "",
    category: "",
    dateIso: todayIso(),
    read: "",
    image: "",
    blocks: [{ id: nextId(), t: "p", text: "", items: "" }],
  };
}

function editDraft(p: Post): Draft {
  return {
    isNew: false,
    slug: p.slug,
    slugTouched: true,
    title: p.title,
    excerpt: p.excerpt,
    category: p.category,
    dateIso: toInputDate(p.date),
    read: p.read,
    image: p.image,
    blocks: (p.body ?? []).map(blockToEditor),
  };
}

const BLOCK_LABELS: Record<BlockType, string> = {
  p: "Paragraph",
  h2: "Heading",
  ul: "Bullet list",
  code: "Code",
  callout: "Callout",
};

// ---- shared class tokens (match /admin/labs) -------------------------------
const inputCls =
  "w-full rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-sm font-medium text-ink shadow-sm outline-none placeholder:font-normal placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/15";
const areaCls = inputCls + " leading-6";
const selectCls = inputCls + " cursor-pointer";
const labelCls = "block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted";
const btnPrimary =
  "rounded-xl bg-brand px-5 py-2.5 text-base font-semibold text-white hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm font-semibold text-ink hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-40";

// ---- component -------------------------------------------------------------
export function BlogAdmin() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [admin, setAdmin] = useState("");
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");

  const [draft, setDraft] = useState<Draft | null>(null); // null = list view
  const [saving, setSaving] = useState(false);
  const [confirmSlug, setConfirmSlug] = useState("");
  const [busySlug, setBusySlug] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string; links?: string[] } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/admin/blog", { cache: "no-store" });
        if (r.status === 401 || r.status === 403) {
          if (alive) {
            setDenied(true);
            setLoading(false);
          }
          return;
        }
        const d = (await r.json()) as { configured?: boolean; admin?: string; posts?: Post[]; error?: string };
        if (!alive) return;
        setConfigured(!!d.configured);
        setAdmin(d.admin ?? "");
        setPosts(Array.isArray(d.posts) ? d.posts : []);
        if (d.error) setLoadErr(d.error);
      } catch {
        if (alive) setLoadErr("Could not load posts.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of posts) if (p.category) set.add(p.category);
    return Array.from(set).sort();
  }, [posts]);

  function patch(p: Partial<Draft>) {
    setDraft((d) => (d ? { ...d, ...p } : d));
  }

  function patchBlock(id: number, p: Partial<EBlock>) {
    setDraft((d) => (d ? { ...d, blocks: d.blocks.map((b) => (b.id === id ? { ...b, ...p } : b)) } : d));
  }

  function addBlock() {
    setDraft((d) => (d ? { ...d, blocks: [...d.blocks, { id: nextId(), t: "p", text: "", items: "" }] } : d));
  }

  function removeBlock(id: number) {
    setDraft((d) => (d ? { ...d, blocks: d.blocks.filter((b) => b.id !== id) } : d));
  }

  function moveBlock(id: number, dir: -1 | 1) {
    setDraft((d) => {
      if (!d) return d;
      const i = d.blocks.findIndex((b) => b.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= d.blocks.length) return d;
      const blocks = d.blocks.slice();
      [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
      return { ...d, blocks };
    });
  }

  function assemble(d: Draft): { ok: true; post: Post } | { ok: false; error: string } {
    const title = d.title.trim();
    const slug = slugify(d.slug);
    const excerpt = d.excerpt.trim();
    const category = d.category.trim();
    const read = d.read.trim();
    const date = fromInputDate(d.dateIso);
    if (!title) return { ok: false, error: "Title is required." };
    if (!slug) return { ok: false, error: "Slug is required." };
    if (!excerpt) return { ok: false, error: "Excerpt is required." };
    if (!category) return { ok: false, error: "Category is required." };
    if (!date) return { ok: false, error: "A valid date is required." };
    if (!read) return { ok: false, error: "Read time is required (e.g. 8 min)." };
    if (d.isNew && posts.some((p) => p.slug === slug))
      return { ok: false, error: `A post with slug "${slug}" already exists.` };
    const body = d.blocks.map(editorToBlock).filter((b): b is Block => b !== null);
    if (body.length === 0) return { ok: false, error: "Add at least one non-empty content block." };
    const image = d.image.trim() || `/blog/${slug}.svg`;
    return { ok: true, post: { slug, title, excerpt, category, date, read, image, body } };
  }

  async function save() {
    if (!draft) return;
    setMsg(null);
    const a = assemble(draft);
    if (!a.ok) {
      setMsg({ kind: "err", text: a.error });
      return;
    }
    setSaving(true);
    try {
      const r = await fetch("/api/admin/blog", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(a.post),
      });
      const d = (await r.json()) as { ok?: boolean; note?: string; commits?: string[]; error?: string };
      if (r.ok && d.ok) {
        // Reflect the change in the local list (insert-or-replace, date-desc).
        setPosts((prev) => {
          const rest = prev.filter((p) => p.slug !== a.post.slug);
          const merged = [...rest, a.post];
          merged.sort((x, y) => (toInputDate(y.date) || "").localeCompare(toInputDate(x.date) || ""));
          return merged;
        });
        setDraft(null);
        setMsg({
          kind: "ok",
          text: d.note ?? "Saved. Live on the site in ~5-10 minutes (Amplify rebuild).",
          links: d.commits,
        });
      } else {
        setMsg({ kind: "err", text: d.error ?? "Save failed." });
      }
    } catch {
      setMsg({ kind: "err", text: "Network error while saving." });
    } finally {
      setSaving(false);
    }
  }

  async function del(slug: string) {
    setMsg(null);
    setBusySlug(slug);
    try {
      const r = await fetch(`/api/admin/blog?slug=${encodeURIComponent(slug)}`, { method: "DELETE" });
      const d = (await r.json()) as { ok?: boolean; note?: string; commits?: string[]; error?: string };
      if (r.ok && d.ok) {
        setPosts((prev) => prev.filter((p) => p.slug !== slug));
        setMsg({
          kind: "ok",
          text: d.note ?? "Deleted. Gone from the site in ~5-10 minutes (Amplify rebuild).",
          links: d.commits,
        });
      } else {
        setMsg({ kind: "err", text: d.error ?? "Delete failed." });
      }
    } catch {
      setMsg({ kind: "err", text: "Network error while deleting." });
    } finally {
      setBusySlug("");
      setConfirmSlug("");
    }
  }

  // ---- render: loading / denied -------------------------------------------
  if (loading) return <p className="text-base text-muted">Loading posts...</p>;

  if (denied) {
    return (
      <div className="max-w-md rounded-2xl border border-line bg-surface px-6 py-7 text-center shadow-sm">
        <h2 className="text-xl font-bold text-ink">Not authorized</h2>
        <p className="mt-2 text-base text-ink-soft">This panel is for ShieldSync admins. Sign in with an admin account.</p>
        <a
          href="/sign-in"
          className="mt-5 inline-block rounded-xl bg-brand px-6 py-2.5 text-base font-semibold text-white hover:bg-brand-strong"
        >
          Sign in
        </a>
      </div>
    );
  }

  const adminChip = (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/60 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Signed in as admin{admin ? ` - ${admin}` : ""}
      </span>
      <span className="text-xs text-muted">
        {configured ? "Connected to GitHub - saves commit to the marketing repo" : ""}
      </span>
    </div>
  );

  const setupBanner = configured === false && (
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900">
      <p className="font-semibold">Setup needed - read-only until then.</p>
      <p className="mt-1">
        This panel reuses the same <span className="font-mono">GITHUB_TOKEN</span> Worker secret as{" "}
        <span className="font-mono">/admin/labs</span> — a fine-grained GitHub token with{" "}
        <span className="font-semibold">Contents: Read &amp; Write on shieldsync-website</span> (the marketing repo).
        If it&apos;s already set for the labs panel, this one works too; otherwise set it from{" "}
        <span className="font-mono">labs-platform/app</span> via{" "}
        <span className="font-mono">npx wrangler secret put GITHUB_TOKEN</span> and redeploy.
      </p>
    </div>
  );

  const statusLine = msg && (
    <p className={`text-sm ${msg.kind === "ok" ? "text-emerald-700" : "text-[#b91c1c]"}`} role="status">
      {msg.text}{" "}
      {msg.links?.map((u, i) => (
        <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="underline">
          commit {i + 1}
        </a>
      ))}
    </p>
  );

  // ---- render: editor ------------------------------------------------------
  if (draft) {
    return (
      <div>
        {adminChip}
        {setupBanner}

        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-ink">{draft.isNew ? "New post" : `Edit: ${draft.title || draft.slug}`}</h2>
          <button className={btnGhost} onClick={() => setDraft(null)} disabled={saving}>
            Back to list
          </button>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5">
          {/* meta fields */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor="f-title">Title</label>
              <input
                id="f-title"
                className={inputCls + " mt-1"}
                value={draft.title}
                onChange={(e) => {
                  const title = e.target.value;
                  patch({ title, ...(draft.isNew && !draft.slugTouched ? { slug: slugify(title) } : {}) });
                }}
                placeholder="AWS Detection Engineering: High-Signal Rules"
              />
            </div>

            <div>
              <label className={labelCls} htmlFor="f-slug">Slug</label>
              <input
                id="f-slug"
                className={inputCls + " mt-1 font-mono" + (draft.isNew ? "" : " opacity-70")}
                value={draft.slug}
                readOnly={!draft.isNew}
                onChange={(e) => patch({ slug: slugify(e.target.value), slugTouched: true })}
                placeholder="aws-detection-engineering"
              />
              <p className="mt-1 text-[11px] text-muted">
                {draft.isNew ? "Auto from title; edit to override. URL-safe." : "Locked when editing."}
              </p>
            </div>

            <div>
              <label className={labelCls} htmlFor="f-cat">Category</label>
              <input
                id="f-cat"
                className={inputCls + " mt-1"}
                list="blog-categories"
                value={draft.category}
                onChange={(e) => patch({ category: e.target.value })}
                placeholder="Detection & Response"
              />
              <datalist id="blog-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>

            <div>
              <label className={labelCls} htmlFor="f-date">Date</label>
              <input
                id="f-date"
                type="date"
                className={inputCls + " mt-1"}
                value={draft.dateIso}
                onChange={(e) => patch({ dateIso: e.target.value })}
              />
              <p className="mt-1 text-[11px] text-muted">Saved as {fromInputDate(draft.dateIso) || "Mon DD, YYYY"}.</p>
            </div>

            <div>
              <label className={labelCls} htmlFor="f-read">Read time</label>
              <input
                id="f-read"
                className={inputCls + " mt-1"}
                value={draft.read}
                onChange={(e) => patch({ read: e.target.value })}
                placeholder="8 min"
              />
            </div>

            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor="f-excerpt">Excerpt</label>
              <textarea
                id="f-excerpt"
                className={areaCls + " mt-1"}
                rows={3}
                value={draft.excerpt}
                onChange={(e) => patch({ excerpt: e.target.value })}
                placeholder="One or two sentences that summarise the post for the blog index and search."
              />
            </div>
          </div>

          <p className="mt-3 text-[11px] text-muted">
            Cover: {draft.image.trim() || `/blog/${slugify(draft.slug) || "<slug>"}.svg`}
            {draft.isNew ? " - an on-brand SVG is generated on save." : ""}
          </p>
        </div>

        {/* block editor + preview */}
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          {/* editor */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-muted">Content blocks</h3>
              <button className={btnGhost} onClick={addBlock}>+ Add block</button>
            </div>
            <div className="space-y-3">
              {draft.blocks.map((b, i) => (
                <div key={b.id} className="rounded-xl border border-line bg-surface p-3 shadow-sm">
                  <div className="mb-2 flex items-center gap-2">
                    <select
                      className={selectCls + " w-auto"}
                      value={b.t}
                      onChange={(e) => patchBlock(b.id, { t: e.target.value as BlockType })}
                      aria-label={`Block ${i + 1} type`}
                    >
                      {(Object.keys(BLOCK_LABELS) as BlockType[]).map((t) => (
                        <option key={t} value={t}>
                          {BLOCK_LABELS[t]}
                        </option>
                      ))}
                    </select>
                    <span className="ml-auto flex items-center gap-1">
                      <button
                        className={btnGhost + " px-2 py-1"}
                        onClick={() => moveBlock(b.id, -1)}
                        disabled={i === 0}
                        aria-label="Move block up"
                        title="Move up"
                      >
                        Up
                      </button>
                      <button
                        className={btnGhost + " px-2 py-1"}
                        onClick={() => moveBlock(b.id, 1)}
                        disabled={i === draft.blocks.length - 1}
                        aria-label="Move block down"
                        title="Move down"
                      >
                        Down
                      </button>
                      <button
                        className={btnGhost + " px-2 py-1 hover:border-[#b91c1c] hover:text-[#b91c1c]"}
                        onClick={() => removeBlock(b.id)}
                        disabled={draft.blocks.length === 1}
                        aria-label="Delete block"
                        title="Delete block"
                      >
                        Delete
                      </button>
                    </span>
                  </div>

                  {b.t === "h2" ? (
                    <input
                      className={inputCls}
                      value={b.text}
                      onChange={(e) => patchBlock(b.id, { text: e.target.value })}
                      placeholder="Section heading"
                    />
                  ) : b.t === "ul" ? (
                    <>
                      <textarea
                        className={areaCls + " font-mono"}
                        rows={4}
                        value={b.items}
                        onChange={(e) => patchBlock(b.id, { items: e.target.value })}
                        placeholder={"One bullet per line\nAnother bullet"}
                      />
                      <p className="mt-1 text-[11px] text-muted">One item per line.</p>
                    </>
                  ) : b.t === "code" ? (
                    <textarea
                      className={areaCls + " font-mono"}
                      rows={6}
                      value={b.text}
                      onChange={(e) => patchBlock(b.id, { text: e.target.value })}
                      placeholder="aws sts get-caller-identity"
                    />
                  ) : (
                    <textarea
                      className={areaCls}
                      rows={b.t === "callout" ? 3 : 4}
                      value={b.text}
                      onChange={(e) => patchBlock(b.id, { text: e.target.value })}
                      placeholder={b.t === "callout" ? "A highlighted aside worth emphasising." : "Paragraph text..."}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* live preview */}
          <div>
            <h3 className="mb-2 text-sm font-bold uppercase tracking-[0.12em] text-muted">Live preview</h3>
            <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
              {draft.title.trim() ? (
                <h2 className="text-2xl font-bold tracking-tight text-ink">{draft.title}</h2>
              ) : (
                <p className="text-muted">Post title...</p>
              )}
              {draft.excerpt.trim() ? (
                <p className="mt-2 text-base leading-7 text-ink-soft">{draft.excerpt}</p>
              ) : null}
              <div className="mt-5 border-t border-line pt-3">
                <BlockPreview blocks={draft.blocks} />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button onClick={save} disabled={saving || configured === false} className={btnPrimary}>
            {saving ? "Committing..." : draft.isNew ? "Publish post" : "Save changes"}
          </button>
          <button className={btnGhost} onClick={() => setDraft(null)} disabled={saving}>
            Cancel
          </button>
          {statusLine}
        </div>
      </div>
    );
  }

  // ---- render: list --------------------------------------------------------
  return (
    <div>
      {adminChip}
      {setupBanner}
      {loadErr && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900">
          Loaded a fallback copy - GitHub read failed: {loadErr}
        </div>
      )}

      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-muted">{posts.length} post{posts.length === 1 ? "" : "s"}</p>
        <button
          className={btnPrimary + " px-5 py-2"}
          onClick={() => {
            setMsg(null);
            setDraft(newDraft());
          }}
        >
          + New post
        </button>
      </div>

      {statusLine && <div className="mb-3">{statusLine}</div>}

      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-canvas/70 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                <th className="px-4 py-3">Post</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {posts.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted">
                    No posts yet. Click <span className="font-semibold">New post</span> to write the first one.
                  </td>
                </tr>
              )}
              {posts.map((p) => {
                const confirming = confirmSlug === p.slug;
                const busy = busySlug === p.slug;
                return (
                  <tr key={p.slug} className="border-b border-line/70 align-top last:border-b-0">
                    <td className="px-4 py-3.5">
                      <div className="font-semibold text-ink">{p.title}</div>
                      <div className="mt-0.5 font-mono text-[11px] text-muted">{p.slug}</div>
                    </td>
                    <td className="px-4 py-3.5 text-ink-soft">{p.category}</td>
                    <td className="px-4 py-3.5 whitespace-nowrap text-ink-soft">{p.date}</td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          className={btnGhost}
                          onClick={() => {
                            setMsg(null);
                            setConfirmSlug("");
                            setDraft(editDraft(p));
                          }}
                        >
                          Edit
                        </button>
                        {confirming ? (
                          <>
                            <button
                              className="rounded-lg bg-[#b91c1c] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#991b1b] disabled:opacity-50"
                              onClick={() => del(p.slug)}
                              disabled={busy}
                            >
                              {busy ? "Deleting..." : "Confirm delete"}
                            </button>
                            <button className={btnGhost} onClick={() => setConfirmSlug("")} disabled={busy}>
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            className={btnGhost + " hover:border-[#b91c1c] hover:text-[#b91c1c]"}
                            onClick={() => setConfirmSlug(p.slug)}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---- preview renderer (mirrors the marketing blog reader) ------------------
function BlockPreview({ blocks }: { blocks: EBlock[] }) {
  const rendered = blocks
    .map((b) => ({ b, out: editorToBlock(b) }))
    .filter((x) => x.out !== null);

  if (rendered.length === 0) {
    return <p className="text-sm text-muted">Content preview appears here as you write.</p>;
  }

  return (
    <div>
      {rendered.map(({ b, out }) => {
        if (!out) return null;
        if (out.t === "h2")
          return (
            <h3 key={b.id} className="mt-6 text-xl font-bold tracking-tight text-ink first:mt-0">
              {out.text}
            </h3>
          );
        if (out.t === "p")
          return (
            <p key={b.id} className="mt-4 text-base leading-7 text-ink-soft first:mt-0">
              {out.text}
            </p>
          );
        if (out.t === "ul")
          return (
            <ul key={b.id} className="mt-3 space-y-2 first:mt-0">
              {out.items.map((it, k) => (
                <li key={k} className="flex gap-2.5 text-base leading-6 text-ink-soft">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                  {it}
                </li>
              ))}
            </ul>
          );
        if (out.t === "code")
          return (
            <pre
              key={b.id}
              className="mt-4 overflow-x-auto rounded-xl border border-line bg-canvas p-4 font-mono text-sm leading-6 text-ink first:mt-0"
            >
              <code>{out.code}</code>
            </pre>
          );
        return (
          <p
            key={b.id}
            className="mt-5 rounded-xl border border-brand/20 bg-brand/5 px-4 py-3 text-base leading-7 text-ink first:mt-0"
          >
            {out.text}
          </p>
        );
      })}
    </div>
  );
}
