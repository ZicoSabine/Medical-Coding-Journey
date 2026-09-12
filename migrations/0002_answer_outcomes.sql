ALTER TABLE attempts ADD COLUMN answer_outcome TEXT CHECK (answer_outcome IN ('passed','failed'));
