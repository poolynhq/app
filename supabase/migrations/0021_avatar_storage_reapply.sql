-- Re-apply avatars bucket + object policies (safe to run again).
-- Use this if you still see HTTP 400 / "database schema is invalid or incompatible" on upload:
-- older policy definitions used storage.foldername(), which breaks on some Storage API builds.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  3145728,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

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
