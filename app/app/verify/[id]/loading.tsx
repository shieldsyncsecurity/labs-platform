// getCredential() is a real per-request engine call — this covers that gap
// instead of leaving the previous page frozen on screen.
export default function LoadingVerify() {
  return (
    <div className="mx-auto max-w-lg animate-pulse px-5 py-8 sm:py-10">
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
        <div className="h-[3px] w-full bg-line/60" />
        <div className="space-y-3 p-6 text-center sm:p-8">
          <div className="mx-auto h-14 w-14 rounded-full bg-line/40" />
          <div className="mx-auto h-5 w-2/3 rounded bg-line/50" />
          <div className="mx-auto h-4 w-4/5 rounded bg-line/30" />
        </div>
      </div>
    </div>
  );
}
