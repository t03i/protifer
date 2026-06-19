-- Seed dev-only user plan overrides. Safe to re-run.
UPDATE "user" SET plan = 'pro'  WHERE email = 'dev-pro@example.com';
UPDATE "user" SET plan = 'free' WHERE email = 'dev-free@example.com';

-- Example per-account limit override: a pro account with raised quotas.
UPDATE "user"
SET limits = '{"submissionsPerMinute": 120, "maxConcurrentJobs": 25}'::jsonb
WHERE email = 'dev-pro@example.com';
