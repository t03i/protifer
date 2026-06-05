-- Seed dev-only user plan overrides. Safe to re-run.
UPDATE "user" SET plan = 'pro'  WHERE email = 'dev-pro@example.com';
UPDATE "user" SET plan = 'free' WHERE email = 'dev-free@example.com';
