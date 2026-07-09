// Skeleton primitives shared by the portal loading.tsx files. Pure markup
// (server-renderable, no client state) -- shapes mirror the real pages so the
// swap-in is calm: same nav bar, same max-widths, same card radii.

export function SkeletonBar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-line ${className}`} aria-hidden="true" />;
}

/** Mirrors PortalNav's frame so the header doesn't jump when data arrives. */
export function NavSkeleton() {
  return (
    <div className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-6">
          <SkeletonBar className="h-4 w-36" />
          <SkeletonBar className="hidden h-4 w-20 sm:block" />
          <SkeletonBar className="hidden h-4 w-14 sm:block" />
        </div>
        <SkeletonBar className="h-4 w-24" />
      </div>
    </div>
  );
}

/** A bordered card shell with a title bar and one content bar. */
export function CardSkeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`rounded-xl border border-line bg-surface p-5 ${className}`}>
      <SkeletonBar className="h-4 w-36" />
      <SkeletonBar className="mt-3 h-8 w-28" />
    </div>
  );
}

/** A bordered table shell: header strip + `rows` body rows. */
export function TableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="border-b border-line bg-canvas px-4 py-3">
        <SkeletonBar className="h-3 w-48" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-6 border-b border-line px-4 py-4 last:border-b-0">
          <SkeletonBar className="h-4 w-1/4" />
          <SkeletonBar className="h-4 w-16" />
          <SkeletonBar className="h-4 w-24" />
          <SkeletonBar className="ml-auto h-4 w-28" />
        </div>
      ))}
    </div>
  );
}
