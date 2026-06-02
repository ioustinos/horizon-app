-- Migration: add 'cloudbeds' as a valid value for rooms.platform and stores.platform
-- DO NOT run this until the Cloudbeds integration is ready to ship to production.
-- Once applied, the UI can offer Cloudbeds as a Store/Room platform option.

ALTER TABLE rooms  DROP CONSTRAINT IF EXISTS rooms_platform_check;
ALTER TABLE rooms  ADD  CONSTRAINT rooms_platform_check
  CHECK (platform IN ('hosthub','webhotelier','roomrack','hotelizer','cloudbeds','other'));

ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_platform_check;
ALTER TABLE stores ADD  CONSTRAINT stores_platform_check
  CHECK (platform IN ('hosthub','webhotelier','roomrack','hotelizer','cloudbeds','other'));
