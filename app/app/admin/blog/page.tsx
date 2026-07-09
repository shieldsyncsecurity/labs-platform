import type { Metadata } from "next";
import { BlogAdmin } from "./blog-admin";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/* Admin panel: create / edit / delete marketing-blog posts.
 *
 * Each post lives as content/blog/<slug>.json in the marketing repo
 * (shieldsync-website), and the site reads a merged, date-desc array from
 * lib/blog-extra.json. There is NO build step on Amplify, so the API route
 * keeps lib/blog-extra.json in sync itself and commits an on-brand SVG cover
 * to public/blog/<slug>.svg. Saving commits to the marketing repo and Amplify
 * redeploys - git stays the source of truth, the panel is just a friendly pen.
 *
 * Deliberately a STATIC page (no session read here): the Free-plan CPU cap
 * 1102s intermittent SSR, and a static shell costs ~0 CPU. All auth lives in
 * the API route, which fails closed - the client renders "Not authorized"
 * from its 403. The shell itself contains no private data. */
export default function AdminBlogPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-8 sm:py-10">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand">Admin</p>
      <h1 className="mt-1 text-2xl font-bold text-ink">Blog</h1>
      <p className="mt-1 max-w-2xl text-base text-ink-soft">
        Write, edit, and remove posts on the marketing site. Saving commits the post JSON to the{" "}
        <span className="font-semibold text-ink">marketing repo</span>, regenerates the on-brand cover, and keeps the
        merged feed in sync - changes are live in ~5-10 minutes, with full git history behind every edit.
      </p>
      <div className="mt-6">
        <BlogAdmin />
      </div>
    </div>
  );
}
