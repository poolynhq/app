-- Allow authenticated users to insert a community organisation if one
-- doesn't exist for their email domain yet. This is needed for the
-- independent-user signup path when the trigger hasn't fired.
CREATE POLICY "Authenticated users can create community orgs"
  ON public.organisations FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND org_type = 'community'
  );

-- Allow all authenticated users to read orgs by domain (needed during
-- signup to check if the org already exists).
CREATE POLICY "Authenticated users can look up orgs by domain"
  ON public.organisations FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Allow authenticated users to insert their own user row (bootstrap).
CREATE POLICY "Users can insert own profile"
  ON public.users FOR INSERT
  WITH CHECK (id = auth.uid());
