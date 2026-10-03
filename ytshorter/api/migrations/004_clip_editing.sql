-- v1.3 : ajustement des bornes et correction des sous-titres.

ALTER TABLE clips
  -- Secondes disponibles avant et après le clip dans le fichier de découpe.
  -- C'est la marge dans laquelle les bornes peuvent encore être déplacées,
  -- sans avoir conservé la vidéo source.
  ADD COLUMN pad_start FLOAT NOT NULL DEFAULT 0 AFTER end_seconds,
  ADD COLUMN pad_end FLOAT NOT NULL DEFAULT 0 AFTER pad_start,
  -- Vrai dès que les sous-titres de ce clip ont été corrigés à la main.
  ADD COLUMN subtitles_edited TINYINT(1) NOT NULL DEFAULT 0 AFTER restyle_status;
