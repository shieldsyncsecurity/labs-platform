import { NavSkeleton, SkeletonBar, CardSkeleton, TableSkeleton } from "./_components/skeletons";

// Skeleton for the portal dashboard (org name + credits card + assessments
// table) while the server components fetch from the engine.
export default function PortalDashboardLoading() {
  return (
    <div>
      <NavSkeleton />
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <SkeletonBar className="h-7 w-56" />
            <SkeletonBar className="mt-2 h-4 w-72" />
          </div>
          <SkeletonBar className="h-9 w-40 rounded-lg" />
        </div>
        <CardSkeleton className="mt-6" />
        <div className="mt-8">
          <SkeletonBar className="mb-3 h-4 w-28" />
          <TableSkeleton rows={4} />
        </div>
      </div>
    </div>
  );
}
