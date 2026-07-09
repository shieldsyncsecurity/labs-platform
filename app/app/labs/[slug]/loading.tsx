// This segment does real per-request server work (getServerUser + an engine
// entitlement lookup) before it can render — Next shows this instantly while
// that resolves, instead of leaving the previous page frozen on screen.
// Shape mirrors the real page (gradient hero band + two-column guide/panel)
// so there's no layout jump when the real content swaps in.
export default function LoadingLab() {
  return (
    <div className="mx-auto max-w-[1536px] animate-pulse px-4 py-8 pb-24 sm:px-6 lg:px-10 lg:pb-8">
      <div className="h-[52px] rounded-2xl bg-line/60 sm:h-[46px]" />
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-3">
          <div className="h-6 w-2/3 rounded bg-line/60" />
          <div className="h-4 w-full rounded bg-line/40" />
          <div className="h-4 w-5/6 rounded bg-line/40" />
          <div className="mt-6 h-64 rounded-2xl bg-line/30" />
        </div>
        <div className="h-96 rounded-2xl bg-line/30" />
      </div>
    </div>
  );
}
