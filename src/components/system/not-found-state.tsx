import { StaticLink } from "@/components/site/static-link";
import { SystemState } from "@/components/system/system-state";
import { productIdentity } from "@/config/product";

// The one "this page is not here" body, shared by the 404 page and by pages that
// must look nonexistent to anyone who is not allowed to see them (Projects).
export function NotFoundState() {
  return (
    <SystemState
      actions={
        <StaticLink className="catalog-button catalog-button--primary" href={productIdentity.appsPath}>
          Browse apps
        </StaticLink>
      }
      description={<>We could not find that {productIdentity.publicName} page.</>}
      eyebrow="Page not found"
      headingLevel={1}
      title="This page is not here."
      variant="empty"
    />
  );
}
