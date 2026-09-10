// Build-time guard: importing this from a Client Component is an error naming
// this file, rather than a runtime mystery in which SUPABASE_SERVICE_ROLE_KEY
// is silently undefined in the browser (it is not NEXT_PUBLIC_, so Next never
// inlines it) and every call fails with an unhelpful auth error.
import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

// SERVER-ONLY. Uses the service role key, which bypasses Row Level Security.
// Never import this file into a Client Component or any code that ships to the
// browser. Only use it from trusted server contexts (route handlers, server
// actions, server-only scripts) for admin work such as creating users or
// running imports that must bypass RLS.
export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
