import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="surface-panel w-full max-w-xl rounded-[34px] px-6 py-7 text-center">
        <p className="eyebrow">Missing Surface</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-text">
          That surface is not in FawxzzyWeb.
        </h1>
        <p className="mt-4 text-base leading-8 text-muted">
          The app catalog only renders entries that exist in the typed catalog data.
        </p>
        <div className="mt-6 flex justify-center">
          <Link className="catalog-button catalog-button--primary" href="/apps">
            Return to apps
          </Link>
        </div>
      </div>
    </main>
  );
}
