-- User-confirmed billing/display currency at onboarding, device snapshot, mismatch flags.
-- Platform charge currency is still STRIPE_CURRENCY in Edge Functions; this is for UX alignment and review.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS billing_currency_user_code text,
  ADD COLUMN IF NOT EXISTS billing_currency_device_code text,
  ADD COLUMN IF NOT EXISTS billing_currency_differs_from_device boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS billing_currency_differs_from_platform boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.billing_currency_user_code IS 'ISO 4217 code confirmed during onboarding; used for amount display when set.';
COMMENT ON COLUMN public.users.billing_currency_device_code IS 'Device-suggested currency at onboarding (expo-localization snapshot).';
COMMENT ON COLUMN public.users.billing_currency_differs_from_device IS 'True when user choice differs from device-suggested currency.';
COMMENT ON COLUMN public.users.billing_currency_differs_from_platform IS 'True when user choice differs from EXPO_PUBLIC_PLATFORM_CHARGE_CURRENCY at save time.';

-- RLS does not allow users to INSERT notifications directly; use this for system copy the user should see in inbox.
CREATE OR REPLACE FUNCTION public.poolyn_insert_own_notification(
  p_type text,
  p_title text,
  p_body text,
  p_data jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (auth.uid(), p_type, p_title, p_body, COALESCE(p_data, '{}'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_insert_own_notification(text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_insert_own_notification(text, text, text, jsonb) TO authenticated;
