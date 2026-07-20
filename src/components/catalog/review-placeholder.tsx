type ReviewPlaceholderProps = {
  appName: string;
  appSlug: string;
  compact?: boolean;
};

export function ReviewPlaceholder({
  appName,
  appSlug,
  compact = false,
}: ReviewPlaceholderProps) {
  const titleId = `${appSlug}-reviews-title`;

  return (
    <section
      aria-labelledby={titleId}
      className={`review-placeholder${compact ? " review-placeholder--compact" : " surface-panel"}`}
      data-review-placeholder={appSlug}
    >
      <div>
        <p className="eyebrow">Future review signal</p>
        <h2 id={titleId}>Verified {appName} feedback, when it is ready.</h2>
      </div>
      <p>
        {compact
          ? "Moderated, privacy-safe feedback stays off this page until the governed public read model is ready. No rating or count is implied today."
          : "Future reviews will come from verified in-app feedback, pass through moderation, and appear here without exposing private account data. No rating or count is implied today."}
      </p>
      <span className="review-placeholder__status">Not published</span>
    </section>
  );
}
