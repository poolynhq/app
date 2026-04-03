-- Normalize object path in avatar policies so a leading slash cannot break folder checks.

DROP POLICY IF EXISTS "Users upload own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users update own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users delete own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Avatar images are publicly readable" ON storage.objects;

CREATE POLICY "Users upload own avatar"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND split_part(ltrim(name, '/'), '/', 1) = auth.uid()::text
  );

CREATE POLICY "Users update own avatar"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND split_part(ltrim(name, '/'), '/', 1) = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND split_part(ltrim(name, '/'), '/', 1) = auth.uid()::text
  );

CREATE POLICY "Users delete own avatar"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND split_part(ltrim(name, '/'), '/', 1) = auth.uid()::text
  );

CREATE POLICY "Avatar images are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');
