import { LABS } from "@/lib/labs";
import { LabCard } from "@/components/lab-card";

export default function CatalogPage() {
  const live = LABS.filter((l) => l.ready).length;
  return (
    <div className="mx-auto max-w-[1800px] px-4 py-10 sm:px-6 lg:px-10">
      <section className="mb-9">
        <p className="text-sm font-bold uppercase tracking-widest text-brand">AWS Security Labs</p>
        <h1 className="mt-2 max-w-3xl text-3xl font-extrabold leading-tight text-ink sm:text-4xl">
          Practise cloud security in real, isolated AWS accounts.
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-ink-soft">
          Every lab spins up its own throwaway AWS account, hands you the real console, and wipes it
          when you&apos;re done. No setup, no bill, no risk to anything real.
        </p>
        <p className="mt-4 text-sm text-muted">
          {live} live · {LABS.length - live} more on the way · first beginner lab is free.
        </p>
      </section>

      <section className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {LABS.map((lab) => (
          <LabCard key={lab.slug} lab={lab} />
        ))}
      </section>
    </div>
  );
}
