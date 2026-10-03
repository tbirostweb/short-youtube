#!/usr/bin/env python3
"""Suivi du sujet pour le recadrage vertical.

Sortie JSON :
    {
      "width": 1920, "height": 1080, "fps": 30.0, "sample_fps": 5,
      "shots": 3,
      "method_counts": {"face": 120, "saliency": 30, "hold": 10},
      "usable_ratio": 0.83, "face_ratio": 0.75, "travel": 412.0,
      "keyframes": [{"t": 0.0, "cx": 960.0}, ...]
    }

Le recadrage 16:9 vers 9:16 jette près de la moitié de l'image : décider *où*
regarder est le seul endroit du pipeline où un mauvais choix se voit
immédiatement. La décision se prend en cascade, du plus fiable au plus général :

  1. **Visage** — MediaPipe si présent, sinon cascade de Haar OpenCV. En
     présence de plusieurs visages, le plus grand l'emporte, avec une prime de
     continuité pour celui qui est le plus proche de la cible précédente : sans
     elle, le cadre saute d'un interlocuteur à l'autre à chaque image.
  2. **Saillance** — quand aucun visage n'est vu (plan large, dos, mains,
     diapositive), le centre d'énergie de l'image est calculé à partir du
     mouvement et des contours. Retenu seulement si l'énergie est réellement
     concentrée ; sinon on ne suit rien plutôt que de suivre du bruit.
  3. **Maintien** — dernière position connue, puis retour progressif au centre.

Trois garde-fous temporels évitent l'écueil classique du recadrage automatique,
le cadre qui tremble :

  - **coupes de plan** détectées par corrélation d'histogrammes : le lissage est
    réinitialisé, le cadre se replace instantanément au lieu de traverser
    l'écran ;
  - **zone morte** : un déplacement inférieur à un seuil est ignoré ;
  - **vitesse maximale** : le cadre ne peut pas parcourir plus de N pixels par
    seconde, ce qui transforme un saut en panoramique.

Enfin le filtre « one euro » lisse ce qui reste. Ce module est optionnel : en
cas d'échec, le worker retombe sur le recadrage centré ajustable.
"""

import argparse
import json
import math
import sys


def import_cv2():
    try:
        import cv2  # noqa: WPS433
        return cv2
    except ImportError as exc:  # pragma: no cover - dépend de l'environnement
        print(f"OpenCV indisponible : {exc}", file=sys.stderr)
        sys.exit(2)


class OneEuroFilter:
    """Filtre « one euro » : peu de retard, peu de tremblement."""

    def __init__(self, freq, min_cutoff=0.6, beta=0.02, d_cutoff=1.0):
        self.freq = max(freq, 1e-3)
        self.min_cutoff = min_cutoff
        self.beta = beta
        self.d_cutoff = d_cutoff
        self.x_prev = None
        self.dx_prev = 0.0

    @staticmethod
    def _alpha(cutoff, freq):
        tau = 1.0 / (2 * math.pi * cutoff)
        te = 1.0 / freq
        return 1.0 / (1.0 + tau / te)

    def reset(self, value=None):
        self.x_prev = value
        self.dx_prev = 0.0

    def __call__(self, x):
        if self.x_prev is None:
            self.x_prev = x
            return x
        dx = (x - self.x_prev) * self.freq
        a_d = self._alpha(self.d_cutoff, self.freq)
        dx_hat = a_d * dx + (1 - a_d) * self.dx_prev
        cutoff = self.min_cutoff + self.beta * abs(dx_hat)
        a = self._alpha(cutoff, self.freq)
        x_hat = a * x + (1 - a) * self.x_prev
        self.x_prev = x_hat
        self.dx_prev = dx_hat
        return x_hat


class FaceDetector:
    """MediaPipe si présent, sinon cascade de Haar (toujours disponible)."""

    def __init__(self, cv2):
        self.cv2 = cv2
        self.mp_detector = None
        try:
            import mediapipe as mp  # noqa: WPS433
            self.mp_detector = mp.solutions.face_detection.FaceDetection(
                model_selection=1, min_detection_confidence=0.5
            )
        except Exception:  # pragma: no cover - MediaPipe est facultatif
            self.mp_detector = None

        self.cascade = None
        try:
            path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
            cascade = cv2.CascadeClassifier(path)
            if not cascade.empty():
                self.cascade = cascade
        except Exception:  # pragma: no cover
            self.cascade = None

    def detect(self, frame):
        """Retourne la liste des visages [(centre_x, surface)]."""
        height, width = frame.shape[:2]
        faces = []

        if self.mp_detector is not None:
            rgb = self.cv2.cvtColor(frame, self.cv2.COLOR_BGR2RGB)
            result = self.mp_detector.process(rgb)
            for detection in result.detections or []:
                box = detection.location_data.relative_bounding_box
                faces.append(
                    ((box.xmin + box.width / 2) * width, box.width * box.height * width * height)
                )
            if faces:
                return faces

        if self.cascade is not None:
            gray = self.cv2.cvtColor(frame, self.cv2.COLOR_BGR2GRAY)
            gray = self.cv2.equalizeHist(gray)
            detected = self.cascade.detectMultiScale(
                gray,
                scaleFactor=1.15,
                minNeighbors=5,
                minSize=(max(24, int(width * 0.04)), max(24, int(height * 0.06))),
            )
            for (x, y, w, h) in detected:
                faces.append((x + w / 2, float(w * h)))
        return faces


def pick_face(faces, previous_cx, width):
    """Le plus grand visage, avec une prime de continuité pour le plus proche.

    Sans cette prime, une scène à deux interlocuteurs fait osciller le cadre à
    chaque image entre deux visages de tailles voisines.
    """
    if not faces:
        return None
    if previous_cx is None or len(faces) == 1:
        return max(faces, key=lambda f: f[1])[0]

    best = None
    best_score = -1.0
    max_area = max(area for _, area in faces) or 1.0
    for cx, area in faces:
        distance = abs(cx - previous_cx) / max(width, 1)
        score = (area / max_area) - 0.6 * distance
        if score > best_score:
            best_score = score
            best = cx
    return best


def saliency_center(cv2, np, frame_gray, previous_gray):
    """Centre d'énergie horizontal : mouvement d'abord, contours ensuite.

    Retourne (centre_x, concentration) ou None. La concentration mesure à quel
    point l'énergie est localisée : une image uniformément agitée n'indique
    aucun sujet, et il vaut mieux ne pas bouger le cadre du tout.
    """
    energy = None
    if previous_gray is not None:
        motion = cv2.absdiff(frame_gray, previous_gray)
        motion = cv2.GaussianBlur(motion, (9, 9), 0)
        energy = motion.astype(np.float32)

    edges = cv2.Sobel(frame_gray, cv2.CV_32F, 1, 0, ksize=3)
    edges = np.abs(edges)
    energy = edges * 0.35 if energy is None else energy + edges * 0.15

    profile = energy.sum(axis=0)
    total = float(profile.sum())
    if total <= 1e-6:
        return None

    # Les colonnes faibles sont du bruit de fond : on ne garde que le relief.
    threshold = float(profile.mean())
    peaks = np.clip(profile - threshold, 0, None)
    peak_total = float(peaks.sum())
    if peak_total <= 1e-6:
        return None

    columns = np.arange(profile.shape[0], dtype=np.float32)
    center = float((peaks * columns).sum() / peak_total)

    # Part de l'énergie portée par le quart le plus actif de l'image.
    quarter = max(1, profile.shape[0] // 4)
    start = max(0, min(profile.shape[0] - quarter, int(center) - quarter // 2))
    concentration = float(profile[start:start + quarter].sum() / total)
    return center, concentration


def histogram(cv2, frame):
    small = cv2.resize(frame, (160, 90))
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1], None, [32, 32], [0, 180, 0, 256])
    cv2.normalize(hist, hist)
    return hist


def main():
    parser = argparse.ArgumentParser(description="Suivi du sujet pour recadrage vertical")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--sample-fps", type=float, default=5.0)
    parser.add_argument("--shot-threshold", type=float, default=0.5)
    # Déplacement ignoré, en fraction de la largeur de l'image.
    parser.add_argument("--dead-zone", type=float, default=0.02)
    # Vitesse maximale du cadre, en fraction de la largeur par seconde.
    parser.add_argument("--max-speed", type=float, default=0.35)
    # Concentration minimale pour qu'un centre de saillance soit retenu.
    parser.add_argument("--saliency-threshold", type=float, default=0.45)
    parser.add_argument("--no-saliency", action="store_true")
    args = parser.parse_args()

    cv2 = import_cv2()
    import numpy as np  # noqa: WPS433 - dépendance d'OpenCV

    capture = cv2.VideoCapture(args.input)
    if not capture.isOpened():
        print("Vidéo illisible", file=sys.stderr)
        sys.exit(3)

    fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    step = max(1, int(round(fps / max(args.sample_fps, 0.5))))
    effective_fps = fps / step

    detector = FaceDetector(cv2)
    smoother = OneEuroFilter(freq=effective_fps)

    dead_zone = args.dead_zone * width
    max_move = args.max_speed * width / max(effective_fps, 0.1)

    keyframes = []
    method_counts = {"face": 0, "saliency": 0, "hold": 0}
    previous_hist = None
    previous_gray = None
    target = width / 2.0
    smoothed = width / 2.0
    shots = 1
    sampled = 0
    index = 0
    travel = 0.0

    while True:
        ok, frame = capture.read()
        if not ok:
            break
        if index % step != 0:
            index += 1
            continue

        timestamp = index / fps
        sampled += 1
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        # --- Changement de plan : on ne traverse pas l'écran, on se replace ---
        hist = histogram(cv2, frame)
        cut = False
        if previous_hist is not None:
            correlation = cv2.compareHist(previous_hist, hist, cv2.HISTCMP_CORREL)
            if correlation < args.shot_threshold:
                cut = True
                shots += 1
        previous_hist = hist

        # --- Cascade de décision ---
        faces = detector.detect(frame)
        chosen = pick_face(faces, None if cut else target, width)
        if chosen is not None:
            target = chosen
            method_counts["face"] += 1
        elif not args.no_saliency:
            found = saliency_center(cv2, np, gray, None if cut else previous_gray)
            if found is not None and found[1] >= args.saliency_threshold:
                target = found[0]
                method_counts["saliency"] += 1
            else:
                method_counts["hold"] += 1
        else:
            method_counts["hold"] += 1

        previous_gray = gray

        if cut:
            # Nouveau plan : le lissage repart de la position visée.
            smoother.reset(target)
            smoothed = target
        else:
            # Zone morte puis limitation de vitesse, avant lissage.
            delta = target - smoothed
            if abs(delta) < dead_zone:
                delta = 0.0
            elif abs(delta) > max_move:
                delta = math.copysign(max_move, delta)
            smoothed = smoother(smoothed + delta)

        smoothed = max(0.0, min(float(width), smoothed))
        if keyframes:
            travel += abs(smoothed - keyframes[-1]["cx"])
        keyframes.append({"t": round(timestamp, 3), "cx": round(smoothed, 2)})
        index += 1

    capture.release()

    usable = method_counts["face"] + method_counts["saliency"]
    payload = {
        "width": width,
        "height": height,
        "fps": fps,
        "sample_fps": effective_fps,
        "shots": shots,
        "method_counts": method_counts,
        "face_ratio": round(method_counts["face"] / sampled, 3) if sampled else 0.0,
        "usable_ratio": round(usable / sampled, 3) if sampled else 0.0,
        "travel": round(travel, 1),
        "keyframes": keyframes,
    }
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(payload, handle)


if __name__ == "__main__":
    main()
