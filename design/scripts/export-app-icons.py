"""Exporte les icônes d'application (Android mipmap + iOS AppIcon) depuis design/brand/png/*-1024.png.

Usage : python3 design/scripts/export-app-icons.py   (nécessite Pillow ; à relancer après `node scripts/render.mjs`)
Les tailles iOS sont lues dans Contents.json de chaque application, pour rester alignées sur Xcode.
"""
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SOURCES = {"client": "icone-app-client-1024.png", "pro": "icone-app-pro-1024.png"}
ANDROID = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}

for app, source in SOURCES.items():
    # iOS refuse la transparence : on aplatit sur fond opaque.
    icon = Image.open(ROOT / "design/brand/png" / source).convert("RGB")
    res = ROOT / f"mobile/apps/{app}/android/app/src/main/res"
    for density, size in ANDROID.items():
        icon.resize((size, size), Image.LANCZOS).save(res / f"mipmap-{density}/ic_launcher.png", optimize=True)
    appiconset = ROOT / f"mobile/apps/{app}/ios/Runner/Assets.xcassets/AppIcon.appiconset"
    contents = json.loads((appiconset / "Contents.json").read_text())
    for image in contents["images"]:
        if "filename" not in image:
            continue
        points = float(image["size"].split("x")[0])
        scale = int(image["scale"].rstrip("x"))
        px = round(points * scale)
        icon.resize((px, px), Image.LANCZOS).save(appiconset / image["filename"], optimize=True)
    print(f"{app} : icônes Android ({len(ANDROID)}) et iOS ({sum('filename' in i for i in contents['images'])}) exportées")
