import {
  NavSkeleton,
  SkeletonBar,
  CardSkeleton,
  TableSkeleton,
} from "../../_components/skeletons";

// Skeleton for the assessment detail page (title + stat cards + report-link
// card + add-candidate card + invites table).
export default function AssessmentDetailLoading() {
  return (
    <div>
      <NavSkeleton />
      <div className="mx-auto max-w-5xl px-6 py-10">
        <SkeletonBar className="h-7 w-64" />
        <SkeletonBar className="mt-2 h-4 w-80" />

        <div className="mt-6 grid grid-cols-3 gap-3 sm:max-w-md">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>

        <div className="mt-6 rounded-xl border border-line bg-surface p-5">
          <SkeletonBar className="h-4 w-32" />
          <SkeletonBar className="mt-2 h-3 w-3/4" />
          <SkeletonBar className="mt-3 h-9 w-full rounded-lg" />
        </div>

        <div className="mt-8 rounded-xl border border-line bg-surface p-5">
          <SkeletonBar className="h-4 w-32" />
          <div className="mt-3 flex flex-wrap gap-3">
            <SkeletonBar className="h-9 w-48 rounded-lg" />
            <SkeletonBar className="h-9 w-56 rounded-lg" />
            <SkeletonBar className="h-9 w-36 rounded-lg" />
          </div>
        </div>

        <div className="mt-8">
          <SkeletonBar className="mb-3 h-4 w-24" />
          <TableSkeleton rows={3} />
        </div>
      </div>
    </div>
  );
}
