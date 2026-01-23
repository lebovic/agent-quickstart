-- Rename environment kind from 'local' to 'docker'
UPDATE "environments" SET "kind" = 'docker' WHERE "kind" = 'local';
