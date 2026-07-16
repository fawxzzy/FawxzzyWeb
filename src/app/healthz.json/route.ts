export const dynamic = "force-static";

export function GET() {
  return Response.json({
    status: "ok",
    app: "fawxzzyweb",
    catalogCapability: "trove",
    runtime: "static-export",
  });
}
