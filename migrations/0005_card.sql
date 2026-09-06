-- The two things you can change about your card that are not already columns.
--
-- Both are yours, both are optional, and both are cosmetic: nothing here is
-- shown to anybody but you, and nothing here reaches the export.
ALTER TABLE people ADD COLUMN card_accent TEXT;
ALTER TABLE people ADD COLUMN card_flavour TEXT;
