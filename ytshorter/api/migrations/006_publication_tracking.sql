-- v1.5 : suivi de publication. Sur une série de plusieurs épisodes, se
-- souvenir de ce qui est déjà en ligne évite le doublon et l'oubli.
ALTER TABLE clips
  ADD COLUMN published_youtube DATETIME NULL AFTER subtitles_edited,
  ADD COLUMN published_tiktok  DATETIME NULL AFTER published_youtube;
