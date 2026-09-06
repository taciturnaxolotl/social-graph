-- The card is gone, and so are the two columns that only it used.
--
-- Nothing else read them, nothing was ever stored in them in production, and
-- a column kept "in case" is how a schema stops describing the thing it is
-- for. Re-adding them is one migration if the idea ever comes back.
ALTER TABLE people DROP COLUMN card_accent;
ALTER TABLE people DROP COLUMN card_flavour;
