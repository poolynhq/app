-- Avatar uploads: normalize `storage.objects.name` in policies.
-- Some Storage builds store `name` with a leading slash; strict equality to `{uid}/avatar.jpg` then fails
-- or policy evaluation surfaces HTTP 400 "database schema is invalid or incompatible".

DROP POLICY IF EXISTS "Users upload own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users update own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users delete own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Avatar images are publicly readable" ON storage.objects;

CREATE POLICY "Users upload own avatar"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND ltrim(name, '/') = (auth.uid())::text || '/avatar.jpg'
  );

CREATE POLICY "Users update own avatar"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND ltrim(name, '/') = (auth.uid())::text || '/avatar.jpg'
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND ltrim(name, '/') = (auth.uid())::text || '/avatar.jpg'
  );

CREATE POLICY "Users delete own avatar"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND ltrim(name, '/') = (auth.uid())::text || '/avatar.jpg'
  );

CREATE POLICY "Avatar images are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');
