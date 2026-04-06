-- Expand shared consumer-domain blocklist (enterprise + waitlist) and enforce work email
-- on public.waitlist_signups at the database so anon clients cannot bypass the app.

CREATE OR REPLACE FUNCTION public.consumer_email_domains()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT ARRAY[
    '163.com',
    'aol.com',
    'duck.com',
    'fastmail.com',
    'gmail.com',
    'googlemail.com',
    'gmx.com',
    'hey.com',
    'hotmail.co.uk',
    'hotmail.com',
    'hotmail.com.au',
    'icloud.com',
    'live.co.uk',
    'live.com',
    'live.com.au',
    'mac.com',
    'mail.com',
    'me.com',
    'msn.com',
    'naver.com',
    'outlook.co.uk',
    'outlook.com',
    'pm.me',
    'proton.me',
    'protonmail.com',
    'qq.com',
    'rocketmail.com',
    'tutanota.com',
    'tutamail.com',
    'yahoo.co.in',
    'yahoo.co.uk',
    'yahoo.com',
    'yahoo.com.au',
    'ymail.com',
    'yandex.com',
    'zoho.com'
  ]::text[];
$$;

REVOKE ALL ON FUNCTION public.consumer_email_domains() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.waitlist_signups_enforce_work_email()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  em text;
  parts text[];
  d text;
BEGIN
  em := lower(trim(NEW.email));
  parts := string_to_array(em, '@');
  IF parts IS NULL OR array_length(parts, 1) < 2 THEN
    RAISE EXCEPTION 'Please enter a valid email address.'
      USING ERRCODE = '23514';
  END IF;
  d := parts[array_length(parts, 1)];
  IF d = '' OR d IS NULL THEN
    RAISE EXCEPTION 'Please enter a valid email address.'
      USING ERRCODE = '23514';
  END IF;
  IF d = ANY (public.consumer_email_domains()) THEN
    RAISE EXCEPTION
      'Please use your work email. Personal addresses (Gmail, Outlook, iCloud, etc.) are not accepted.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.waitlist_signups_enforce_work_email() FROM PUBLIC;

DROP TRIGGER IF EXISTS waitlist_signups_work_email_check ON public.waitlist_signups;

CREATE TRIGGER waitlist_signups_work_email_check
  BEFORE INSERT OR UPDATE OF email ON public.waitlist_signups
  FOR EACH ROW
  EXECUTE FUNCTION public.waitlist_signups_enforce_work_email();
