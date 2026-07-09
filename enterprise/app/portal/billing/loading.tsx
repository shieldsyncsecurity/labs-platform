import { NavSkeleton, SkeletonBar, CardSkeleton, TableSkeleton } from "../_components/skeletons";

// Skeleton for the billing page (credits card + order history table).
export default function BillingLoading() {
  return (
    <div>
      <NavSkeleton />
      <div className="mx-auto max-w-3xl px-6 py-10">
        <SkeletonBar className="h-7 w-32" />
        <SkeletonBar className="mt-2 h-4 w-72" />
        <CardSkeleton className="mt-6" />
        <div className="mt-8">
          <SkeletonBar className="mb-3 h-4 w-32" />
          <TableSkeleton rows={3} />
        </div>
      </div>
    </div>
  );
}
