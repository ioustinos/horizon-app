-- Migration: add 'lodgify' as a valid value for rooms.platform and stores.platform
-- DO NOT run this until the Lodgify integration is ready to ship to production.
ALTER TABLE rooms  DROP CONSTRAINT IF EXISTS rooms_platform_check;
ALTER TABLE rooms  ADD  CONSTRAINT rooms_platform_check
  CHECK (platform IN ('hosthub','webhotelier','roomrack','hotelizer','cloudbeds','lodgify','other'));

ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_platform_check;
ALTER TABLE stores ADD  CONSTRAINT stores_platform_check
  CHECK (platform IN ('hosthub','webhotelier','roomrack','hotelizer','cloudbeds','lodgify','other'));
