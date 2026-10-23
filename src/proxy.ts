// Request guard for the /api/* routes when the server runs inside the
// Electron shell. The main process generates a secret per launch, passes it to
// this server in WORKBENCH_DESKTOP_TOKEN, and attaches it to its own requests.
// Anything else on the loopback interface (another local user, a stray script)
// cannot use the AI routes.
//
// Without WORKBENCH_DESKTOP_TOKEN (the web app, `bun run dev`) this is a no-op.

import { NextResponse, type NextRequest } from "next/server";
import { DESKTOP_TOKEN_ENV, DESKTOP_TOKEN_HEADER } from "@/lib/desktop/contract";
import { isValidDesktopToken } from "@/lib/desktop/desktop-token";

export function proxy(request: NextRequest): NextResponse {
  const expected = process.env[DESKTOP_TOKEN_ENV];
  if (!expected) return NextResponse.next();

  if (isValidDesktopToken(request.headers.get(DESKTOP_TOKEN_HEADER), expected)) {
    return NextResponse.next();
  }
  return NextResponse.json(
    { error: "Forbidden" },
    { status: 403, headers: { "Cache-Control": "no-store" } }
  );
}

export const config = {
  matcher: "/api/:path*",
};
