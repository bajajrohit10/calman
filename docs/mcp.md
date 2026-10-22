# Calman MCP server (§88)

Lets Claude (claude.ai, the Claude apps, Claude Code) read Calman and make a few
narrow changes, as the super admin or manager who connects it. Combined with the
Shopify and Google Ads connectors, Claude can answer questions such as "which
lead sources convert best for CA Inter Costing this month" or "which Shopify
orders came through counselling".

Endpoint: `https://calman.zeroinfy.in/api/mcp`

## What Claude can do

| Tool | Kind | What it does |
|---|---|---|
| `describe_data` | read | The data model, counting rules and every readable table/column. Claude calls it first. |
| `run_sql` | read | One read-only SQL query, as the user, under RLS. 20 s timeout, 1,000-row cap. Can call the app's own functions (`analytics_by_teacher`, `call_report`, `offer_performance`…). |
| `lead_summary` | read | Lead funnel for an arrival-date range grouped by source / teacher / institute / course / subject / content / term / importance / call type / day / week / month. Same lead definition as the Analytics page. |
| `won_sales` | read | Every item marked purchased in a date range with its Shopify order id, amount, teacher, source and credited counsellor. Optional contacts. |
| `get_student` | read | Full history for one mobile number. |
| `create_offer` | write | Creates an offer — **inactive** unless the user asked for it to go live. |
| `set_offer_active` | write | Switches an offer on or off. |
| `assign_enquiries` | write | Puts open enquiries on a counsellor's My Day for a date (today or later) as a named Customised list. |
| `unassign_enquiries` | write | Removes assignments for today or a later date. |

Nothing can be deleted except future assignments. Every write runs as the
connected user, so it appears in the audit log under their name.

## How it is secured

- **Sign-in** is OAuth 2.1 with PKCE. Claude sends the user to
  `/oauth/authorize`, which uses the normal Calman login and then shows a
  consent screen. Only `super_admin` and `manager` can connect.
- **Redirects** are restricted to Claude's own callback
  (`https://claude.ai/api/mcp/auth_callback`, `https://claude.com/...`) and
  localhost. Anyone can register a client, but no one can point it at their
  own server. Add more with `MCP_EXTRA_REDIRECT_URIS` (exact URLs, comma-separated).
- **Tokens** are signed with `MCP_OAUTH_SECRET` and stored nowhere. Access
  tokens last 1 hour, refresh tokens 30 days. Every MCP call and every refresh
  re-reads the user's profile, so **deactivating the account or demoting it
  below manager cuts access immediately**. Rotating `MCP_OAUTH_SECRET` signs
  everyone out of Claude at once.
- **Database access** is a dedicated login role, `calman_mcp`, that can only
  become `authenticated`. Each request sets the user's id in
  `request.jwt.claims`, so RLS treats Claude exactly like that person in the
  app. Read tools run in `READ ONLY` transactions. `run_sql` also refuses
  anything that is not a query, more than one statement, and any attempt to
  change the role or settings.
- Data includes students' full phone numbers (as decided on 22 Oct 2026). The
  tools return contacts only when asked; `won_sales` hides them by default.

## Going live (one time)

1. **Apply the migration** `20261022000240_mcp_role.sql` (creates the
   `calman_mcp` role; touches no data).
2. **Give the role a password** in the Supabase SQL editor (never commit it):
   ```sql
   alter role calman_mcp with password '<long random password>';
   ```
3. **Vercel → calman → Settings → Environment Variables** (Production):
   - `CALMAN_MCP_DATABASE_URL` =
     `postgresql://calman_mcp.ksnznqvfglppcdustlpu:<password>@<pooler host>:6543/postgres`
     — copy the host from Supabase → Connect → Transaction pooler; only the
     user and password differ.
   - `MCP_OAUTH_SECRET` = a random string of 48+ characters
     (`openssl rand -base64 48`).
   - Optional `CALMAN_MCP_DATABASE_CA` = the contents of Supabase → Database
     settings → SSL certificate, to verify the server certificate (without it
     the connection is encrypted but not verified).
4. **Redeploy** (pushing the branch to main does this).
5. **Connect**: claude.ai → Settings → Connectors → Add custom connector →
   name `Calman`, URL `https://calman.zeroinfy.in/api/mcp`. Sign in with your
   Calman account and press Allow.

Until both env vars are set, the endpoints answer 503 and nothing is exposed.

## Disconnecting

- One person: deactivate them in Settings → Users, or remove the connector in Claude.
- Everyone: rotate `MCP_OAUTH_SECRET` and redeploy.
- Switch the feature off: delete `CALMAN_MCP_DATABASE_URL`.

## Testing locally

`next dev` with both env vars set, pointing `CALMAN_MCP_DATABASE_URL` at a
database with the migration applied, then use the MCP inspector
(`npx @modelcontextprotocol/inspector`) against `http://localhost:3000/api/mcp`.
