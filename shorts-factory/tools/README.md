# tools/ — scripts utilitaires

| Script | Rôle | Lancer |
|---|---|---|
| `make_final.py` | **Générateur principal** : 5 sujets curés × FR/EN = 10 vidéos dans `output/rendu/{fr,en}/`. Hooks affinés, fonds fixés. | `PYTHONPATH=. python -m tools.make_final` |
| `make_bilingual.py` | Variante large : les 20 sujets × FR/EN = 40 vidéos. | `PYTHONPATH=. python -m tools.make_bilingual` |
| `fetch_broll.py` | (Re)télécharge un clip de fond réel par sujet dans `data/assets/broll/bg_<id>.mp4` (filtre anti-illustration). | `PYTHONPATH=. python -m tools.fetch_broll` |
| `make_template.py` | Génère le modèle Excel à remplir (aussi appelé par le dashboard et `main.py template`). | `python main.py template mon_modele.xlsx` |

> `PYTHONPATH=.` est requis car ces scripts importent `src/` depuis la racine du projet.
