import { type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

// `middleware.ts` was renamed to `proxy.ts` in Next 16. Behaviour is unchanged:
// refresh the Supabase session cookie on every matched request.
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Everything except static assets and image files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
