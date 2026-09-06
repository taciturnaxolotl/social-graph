-- Where two people met, in their own words.
--
-- Optional, and free text on purpose: a fixed list of choices would decide in
-- advance what kinds of tie exist, which is one of the things this study is
-- supposed to find out. Empty for most edges; the ones that have it are worth
-- more than the number beside them.
ALTER TABLE ratings ADD COLUMN context TEXT;
