# Platform super admin (operator directory)

## How the database models this

There is **no separate “users table” vs “admins table”** for normal commuters. Everyone is a row in **`public.users`** (linked 1:1 to **`auth.users`**).

| Concept | Where it lives | Meaning |
|--------|----------------|---------|
| **Commute mode** | `users.role` | `driver`, `passenger`, or `both` (how they carpool). |
| **Organisation membership** | `users.org_id` | UUID of `organisations`, or **NULL** if not linked to an org (rare once onboarding/bootstrap has run). |
| **Org network admin** | `users.org_role` | `member` or **`admin`**. Admins manage **their company’s** Poolyn network (invites, members, settings in the in-app **Network admin** tabs). |
| **Platform operator (you)** | **`platform_super_admins.user_id`** | Can call **`super_admin_*`** RPCs and open the in-app **`/super-admin`** screen to list **all** users and orgs. |

So: **org admins** are still rows in `users` with `org_role = 'admin'`. **Platform super admins** are a **small allowlist** in `platform_super_admins`; they are not implied by `org_role`.

## Access credentials

- **There is no extra password.** Operators sign in with the **same Supabase Auth email/password** (or magic link) as any other user.
- **Authorization** is: your `users.id` must appear in **`public.platform_super_admins`**.

## One-time setup (Supabase SQL Editor)

1. Create or pick the operator account in the app (or **Authentication → Users** in the dashboard).
2. Get their UUID:  
   `SELECT id, email FROM auth.users WHERE email = 'you@company.com';`  
   The `id` must also exist in `public.users` (it will after first sign-in / bootstrap).
3. Apply migration **`0017_platform_super_admin.sql`** (or run its contents) so the table and RPCs exist.
4. Grant access (run as SQL Editor — uses elevated role, **not** the anon key):

```sql
INSERT INTO public.platform_super_admins (user_id, note)
VALUES (
  'PASTE-YOUR-auth.users.id-UUID-HERE',
  'Primary operator'
);
```

5. Revoke access by deleting the row:

```sql
DELETE FROM public.platform_super_admins WHERE user_id = '...';
```

The table has **RLS that denies all** direct reads/writes from the API; only **service role / SQL Editor** can insert. The app uses **`is_platform_super_admin()`** and **`super_admin_list_directory()`** / **`super_admin_org_overview()`**, which run as **SECURITY DEFINER** and check the allowlist.

## Using the in-app dashboard

1. Sign in as the operator account.
2. Open **Profile → OPERATIONS → Platform directory (super admin)**, or go directly to **`/super-admin`** (e.g. `poolyn://super-admin` with your app scheme, or the path in Expo web).
3. Pull to refresh. Use **With org** / **No org** / **Org admins** filters and search.

## Security notes

- Do **not** put the **service role** key in the Expo app; this feature is designed to work with the **anon** key + RPCs.
- Treat **`platform_super_admins`** like production root access: minimal rows, remove promptly when someone leaves.
