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
        <p className="eyebrow">Reviews</p>
        <h2 id={titleId}>{appName} reviews are coming.</h2>
      </div>
      <p>
        {compact
          ? "Verified in-app reviews will appear here after moderation. No ratings yet."
          : "Future reviews will come from verified in-app feedback, pass through moderation, and appear here without exposing private account data. No ratings are published yet."}
      </p>
      <span className="review-placeholder__status">Planned</span>
    </section>
  );
}
