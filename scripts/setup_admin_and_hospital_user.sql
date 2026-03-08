-- =====================================================================
-- STEP 1: Delete old broken users (run this FIRST, alone)
-- =====================================================================
-- Delete any previously created admin/hospital users that may be missing
-- identity rows (which causes the 500 error).

DELETE FROM public.profiles
WHERE phone IN ('0912345678', '0956746746');

DELETE FROM auth.identities
WHERE user_id IN (
  SELECT id FROM auth.users
  WHERE email IN ('251912345678@phone.erdataya.app', '251956746746@phone.erdataya.app')
     OR phone IN ('+251912345678', '+251956746746')
);

DELETE FROM auth.users
WHERE email IN ('251912345678@phone.erdataya.app', '251956746746@phone.erdataya.app')
   OR phone IN ('+251912345678', '+251956746746');

-- =====================================================================
-- STEP 2: Create fresh users with proper identity rows
-- =====================================================================

DO $$
DECLARE
  -- Phone numbers: Ethiopian format for profiles, fake email for auth.users
  admin_phone TEXT := '0912345678';
  admin_auth_email TEXT := '251912345678@phone.erdataya.app';
  admin_password TEXT := 'Admin@123456';
  admin_full_name TEXT := 'System Admin';

  hospital_phone TEXT := '0956746746';
  hospital_auth_email TEXT := '251956746746@phone.erdataya.app';
  hospital_password TEXT := 'Hospital@123456';
  hospital_full_name TEXT := 'Hospital User';

  instance_uuid UUID;
  admin_user_id UUID;
  hospital_user_id UUID;
BEGIN
  -- Resolve instance_id
  SELECT instance_id INTO instance_uuid
  FROM auth.users
  WHERE instance_id IS NOT NULL
  LIMIT 1;

  IF instance_uuid IS NULL THEN
    SELECT id INTO instance_uuid FROM auth.instances LIMIT 1;
  END IF;

  IF instance_uuid IS NULL THEN
    instance_uuid := '00000000-0000-0000-0000-000000000000'::UUID;
  END IF;

  -- Ensure profiles.role allows hospital
  ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('patient', 'driver', 'admin', 'hospital'));

  -- ── Admin user ──────────────────────────────────────────────────
  admin_user_id := gen_random_uuid();

  INSERT INTO auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change,
    raw_app_meta_data,
    raw_user_meta_data,
    is_super_admin,
    created_at,
    updated_at
  )
  VALUES (
    admin_user_id,
    instance_uuid,
    'authenticated',
    'authenticated',
    admin_auth_email,
    crypt(admin_password, gen_salt('bf')),
    now(),
    '',
    '',
    '',
    '',
    jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
    jsonb_build_object('full_name', admin_full_name, 'phone', admin_phone, 'role', 'admin'),
    FALSE,
    now(),
    now()
  );

  -- Identity row (required by GoTrue v2 for password login)
  INSERT INTO auth.identities (
    id,
    user_id,
    provider_id,
    provider,
    identity_data,
    last_sign_in_at,
    created_at,
    updated_at
  )
  VALUES (
    admin_user_id,
    admin_user_id,
    admin_auth_email,
    'email',
    jsonb_build_object('sub', admin_user_id::TEXT, 'email', admin_auth_email),
    now(),
    now(),
    now()
  );

  -- ── Hospital user ───────────────────────────────────────────────
  hospital_user_id := gen_random_uuid();

  INSERT INTO auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change,
    raw_app_meta_data,
    raw_user_meta_data,
    is_super_admin,
    created_at,
    updated_at
  )
  VALUES (
    hospital_user_id,
    instance_uuid,
    'authenticated',
    'authenticated',
    hospital_auth_email,
    crypt(hospital_password, gen_salt('bf')),
    now(),
    '',
    '',
    '',
    '',
    jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
    jsonb_build_object('full_name', hospital_full_name, 'phone', hospital_phone, 'role', 'hospital'),
    FALSE,
    now(),
    now()
  );

  INSERT INTO auth.identities (
    id,
    user_id,
    provider_id,
    provider,
    identity_data,
    last_sign_in_at,
    created_at,
    updated_at
  )
  VALUES (
    hospital_user_id,
    hospital_user_id,
    hospital_auth_email,
    'email',
    jsonb_build_object('sub', hospital_user_id::TEXT, 'email', hospital_auth_email),
    now(),
    now(),
    now()
  );

  -- ── Profile rows (Ethiopian phone format) ──────────────────────
  INSERT INTO public.profiles (id, full_name, phone, role, created_at, updated_at)
  VALUES (admin_user_id, admin_full_name, admin_phone, 'admin', now(), now())
  ON CONFLICT (id)
  DO UPDATE SET
    full_name = EXCLUDED.full_name,
    phone = EXCLUDED.phone,
    role = 'admin',
    updated_at = now();

  INSERT INTO public.profiles (id, full_name, phone, role, created_at, updated_at)
  VALUES (hospital_user_id, hospital_full_name, hospital_phone, 'hospital', now(), now())
  ON CONFLICT (id)
  DO UPDATE SET
    full_name = EXCLUDED.full_name,
    phone = EXCLUDED.phone,
    role = 'hospital',
    updated_at = now();

  RAISE NOTICE 'Created users. Admin id: %, Hospital id: %', admin_user_id, hospital_user_id;
END $$;
