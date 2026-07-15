import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/server/admin-session";
import AdminNav from "../../_components/admin-nav";
import RegisterForm from "./register-form";

export const metadata: Metadata = {
  title: "Register document",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function NewDocumentPage() {
  const isAdmin = await getAdminSession();
  if (!isAdmin) {
    redirect("/admin/login");
  }

  return (
    <div>
      <AdminNav />
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Link href="/admin/documents" className="text-sm text-ink-soft hover:text-brand-strong">
          &larr; Documents
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-ink">Register a document for signing</h1>
        <p className="mt-1 text-sm text-muted">
          Upload the final PDF (up to 4 MB) and name the signer. You&apos;ll get a private signing
          link -- shown <strong>once</strong> -- where they view the exact document, verify their
          email with a one-time code, and accept with their typed name.
        </p>
        <RegisterForm />
      </div>
    </div>
  );
}
