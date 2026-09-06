-- Where somebody lives, at the tightest grain the room number reveals.
--
-- The signal this carries is the strongest one the directory has: people know
-- the people they walk past. It is never sent to the browser, only used to
-- choose whose face comes next, and the queue caps how much of any batch it
-- may fill — a study of one residence hall is not what we are collecting.
ALTER TABLE people ADD COLUMN cluster TEXT;
CREATE INDEX people_cluster ON people (cluster);
