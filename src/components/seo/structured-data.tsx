type StructuredDataProps = {
  data: Record<string, unknown>;
  id: string;
};

export function StructuredData({ data, id }: StructuredDataProps) {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
      id={id}
      type="application/ld+json"
    />
  );
}
