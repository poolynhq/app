-- Ensure crew-stickers bucket exists (0068 alone does not create it; 0067 creates bucket + old policies).
-- Re-apply RLS using split_part(name, '/', 1) like avatar storage (0018), not ltrim/storage.foldername.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'crew-stickers',
  'crew-stickers',
  true,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Crew owners upload crew sticker" ON storage.objects;
DROP POLICY IF EXISTS "Crew owners update crew sticker" ON storage.objects;
DROP POLICY IF EXISTS "Crew owners delete crew sticker" ON storage.objects;
DROP POLICY IF EXISTS "Crew sticker images are publicly readable" ON storage.objects;

CREATE POLICY "Crew owners upload crew sticker"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'crew-stickers'
    AND EXISTS (
      SELECT 1
      FROM public.crew_members cm
      WHERE cm.crew_id = split_part(name, '/', 1)::uuid
        AND cm.user_id = auth.uid()
        AND cm.role = 'owner'
    )
  );

CREATE POLICY "Crew owners update crew sticker"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'crew-stickers'
    AND EXISTS (
      SELECT 1
      FROM public.crew_members cm
      WHERE cm.crew_id = split_part(name, '/', 1)::uuid
        AND cm.user_id = auth.uid()
        AND cm.role = 'owner'
    )
  )
  WITH CHECK (
    bucket_id = 'crew-stickers'
    AND EXISTS (
      SELECT 1
      FROM public.crew_members cm
      WHERE cm.crew_id = split_part(name, '/', 1)::uuid
        AND cm.user_id = auth.uid()
        AND cm.role = 'owner'
    )
  );

CREATE POLICY "Crew owners delete crew sticker"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'crew-stickers'
    AND EXISTS (
      SELECT 1
      FROM public.crew_members cm
      WHERE cm.crew_id = split_part(name, '/', 1)::uuid
        AND cm.user_id = auth.uid()
        AND cm.role = 'owner'
    )
  );

CREATE POLICY "Crew sticker images are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'crew-stickers');
