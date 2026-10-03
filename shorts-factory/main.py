#!/usr/bin/env python3
"""Bot de génération et publication automatique de YouTube Shorts.

Usage :
  python main.py auth                    # autorise YouTube (chaîne globale)
  python main.py auth --channel fr1      # autorise une chaîne précise
  python main.py channels                # liste les chaînes + statut d'auth
  python main.py template mes_shorts.xlsx   # crée un modèle Excel à remplir
  python main.py batch mes_shorts.xlsx      # génère + uploade depuis l'Excel
  python main.py batch mes_shorts.xlsx --no-upload   # génère seulement
  python main.py generate                # génère 1 vidéo (sans upload)
  python main.py run                     # génère 1 vidéo + upload
  python main.py schedule                # boucle autonome (X vidéos/jour)
  python main.py serve                   # dashboard web
  python main.py list                    # historique récent
"""
from __future__ import annotations

import argparse
import sys

from src.config import load_config
from src.logger import get_logger

log = get_logger("shortsbot")


def cmd_auth(args) -> None:
    from src.youtube.auth import run_auth_flow

    cfg = load_config(args.config)
    token_file = None
    if getattr(args, "channel", None):
        from src.channels import get_channel

        ch = get_channel(cfg, args.channel)
        token_file = ch.token_file
        log.info("Autorisation de la chaîne « %s » (%s)…", ch.name, ch.id)
    run_auth_flow(cfg, token_file=token_file)


def cmd_generate(args) -> None:
    from src.pipeline import Pipeline

    pipeline = Pipeline(load_config(args.config))
    try:
        rec = pipeline.generate()
        print(f"\n✅ Vidéo générée : {rec['file_path']}")
        print(f"   Titre : {rec['title']}")
    finally:
        pipeline.close()


def cmd_run(args) -> None:
    from src.pipeline import Pipeline

    pipeline = Pipeline(load_config(args.config))
    try:
        rec = pipeline.run_once(do_upload=not args.no_upload)
        print(f"\n✅ Vidéo : {rec['file_path']}")
        if rec.get("youtube_id"):
            print(f"   En ligne : https://youtu.be/{rec['youtube_id']}")
    finally:
        pipeline.close()


def cmd_schedule(args) -> None:
    from src.scheduler import start_scheduler

    start_scheduler(load_config(args.config))


def cmd_serve(args) -> None:
    import uvicorn

    cfg = load_config(args.config)
    host = cfg.get("dashboard", "host", default="0.0.0.0")
    port = int(cfg.get("dashboard", "port", default=8000))
    log.info("Dashboard : http://%s:%d", host, port)
    uvicorn.run("app:app", host=host, port=port, reload=False)


def cmd_list(args) -> None:
    from src.database import Database

    cfg = load_config(args.config)
    db = Database(cfg.path("project", "db_path", default="data/shorts.db"))
    rows = db.recent(limit=args.limit)
    if not rows:
        print("Aucune vidéo pour l'instant.")
        return
    for r in rows:
        yt = f"https://youtu.be/{r['youtube_id']}" if r.get("youtube_id") else "—"
        print(f"#{r['id']:<4} [{r['status']:<8}] {r['title'][:55]:<55} {yt}")
    db.close()


def cmd_batch(args) -> None:
    from src.batch import run_batch

    cfg = load_config(args.config)
    run_batch(cfg, args.file, do_upload=not args.no_upload)


def cmd_channels(args) -> None:
    from pathlib import Path

    from src.channels import load_channels
    from src.config import ROOT

    cfg = load_config(args.config)
    chans = load_channels(cfg)
    if not chans:
        print("Aucune chaîne définie (section 'channels' de config.yaml).")
        return
    print("Chaînes configurées :\n")
    for cid, ch in chans.items():
        token = ch.token_file or cfg.get(
            "youtube", "token_file", default="credentials/token.json"
        )
        tok = Path(token)
        if not tok.is_absolute():
            tok = ROOT / tok
        state = "✅ autorisée" if tok.exists() else "⬜ auth requise (python main.py auth --channel %s)" % cid
        voice = ch.voice or "—"
        print(f"  {cid:<5} {ch.name:<20} [{ch.language}] voix={voice:<22} {state}")


def cmd_template(args) -> None:
    from tools.make_template import make_template

    out = make_template(args.output)
    print(f"✅ Modèle Excel créé : {out}")
    print("Remplis-le puis lance : python main.py batch %s" % out)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Bot YouTube Shorts autonome")
    parser.add_argument("--config", default="config.yaml", help="chemin config.yaml")
    sub = parser.add_subparsers(dest="command", required=True)

    p_auth = sub.add_parser("auth", help="autorise l'accès YouTube (OAuth, 1 fois)")
    p_auth.add_argument("--channel", help="id de la chaîne à autoriser (ex: fr1)")

    sub.add_parser("generate", help="génère 1 vidéo sans upload")

    p_run = sub.add_parser("run", help="génère 1 vidéo puis upload")
    p_run.add_argument("--no-upload", action="store_true", help="ne pas uploader")

    p_batch = sub.add_parser("batch", help="génère des Shorts depuis un fichier Excel")
    p_batch.add_argument("file", help="chemin du fichier .xlsx")
    p_batch.add_argument("--no-upload", action="store_true",
                         help="tout générer sans rien uploader")

    p_tpl = sub.add_parser("template", help="crée un modèle Excel à remplir")
    p_tpl.add_argument("output", nargs="?", default="shorts_template.xlsx",
                       help="nom du fichier de sortie")

    sub.add_parser("channels", help="liste les chaînes et leur statut d'auth")
    sub.add_parser("schedule", help="boucle autonome (config schedule)")
    sub.add_parser("serve", help="lance le dashboard web")

    p_list = sub.add_parser("list", help="affiche l'historique")
    p_list.add_argument("--limit", type=int, default=25)
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    handlers = {
        "auth": cmd_auth,
        "generate": cmd_generate,
        "run": cmd_run,
        "batch": cmd_batch,
        "template": cmd_template,
        "channels": cmd_channels,
        "schedule": cmd_schedule,
        "serve": cmd_serve,
        "list": cmd_list,
    }
    try:
        handlers[args.command](args)
    except KeyboardInterrupt:
        print("\nInterrompu.")
        sys.exit(130)
    except Exception as exc:  # noqa: BLE001
        log.error("%s", exc)
        sys.exit(1)


if __name__ == "__main__":
    main()
