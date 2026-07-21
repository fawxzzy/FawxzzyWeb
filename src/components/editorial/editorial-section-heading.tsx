type EditorialSectionHeadingProps = {
  description: string;
  eyebrow: string;
  id: string;
  title: string;
};

export function EditorialSectionHeading({
  description,
  eyebrow,
  id,
  title,
}: EditorialSectionHeadingProps) {
  return (
    <header className="editorial-section-heading">
      <p className="eyebrow">{eyebrow}</p>
      <h2 id={id}>{title}</h2>
      <p>{description}</p>
    </header>
  );
}
