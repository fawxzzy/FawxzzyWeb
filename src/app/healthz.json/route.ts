export const dynamic = "force-static";

export function GET() {
  return Response.json({
    status: "ok",
    app: "fawxzzyweb",
    accountPortalCapability: "phase1-source",
    catalogCapability: "trove",
    runtime: "static-export",
  });
}
