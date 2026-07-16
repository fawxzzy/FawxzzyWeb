import type { AnchorHTMLAttributes } from "react";

type StaticLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
};

export function StaticLink({ children, href, ...props }: StaticLinkProps) {
  return (
    <a href={href} {...props}>
      {children}
    </a>
  );
}
