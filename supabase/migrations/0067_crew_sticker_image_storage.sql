-- Crew sticker image (public URL); storage bucket writable only by crew owner.

ALTER TABLE public.crews
  ADD COLUMN IF NOT EXISTS sticker_image_url text NULL;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'crew-stickers',
  'crew-stickers',
  true,
  1048576,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Crew owners upload crew sticker" ON storage.objects;
DROP POLICY IF EXISTS "Crew owners update crew sticker" ON storage.objects;
DROP POLICY IF EXISTS "Crew owners delete crew sticker" ON storage.objects;
DROP POLICY IF EXISTS "Crew sticker images are publicly readable" ON storage.objects;

CREATE POLICY "Crew owners upload crew sticker"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'crew-stickers'
    AND EXISTS (
      SELECT 1
      FROM public.crew_members cm
      WHERE cm.crew_id = (storage.foldername(name))[1]::uuid
        AND cm.user_id = auth.uid()
        AND cm.role = 'owner'
    )
  );

CREATE POLICY "Crew owners update crew sticker"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'crew-stickers'
    AND EXISTS (
      SELECT 1
      FROM public.crew_members cm
      WHERE cm.crew_id = (storage.foldername(name))[1]::uuid
        AND cm.user_id = auth.uid()
        AND cm.role = 'owner'
    )
  );

CREATE POLICY "Crew owners delete crew sticker"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'crew-stickers'
    AND EXISTS (
      SELECT 1
      FROM public.crew_members cm
      WHERE cm.crew_id = (storage.foldername(name))[1]::uuid
        AND cm.user_id = auth.uid()
        AND cm.role = 'owner'
    )
  );

CREATE POLICY "Crew sticker images are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'crew-stickers');
