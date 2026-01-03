#!/usr/bin/env python3
"""
Build script for PJ Tab Age Grouper Chrome Extension.
Creates a zip file ready for Chrome Web Store upload.
"""

import zipfile
import os
from pathlib import Path
from datetime import datetime

# Files to include in the extension zip
INCLUDE_FILES = [
    "manifest.json",
    "background.js",
    "popup.html",
    "popup.js",
    "popup.css",
    "icons/logo16.png",
    "icons/logo48.png",
    "icons/logo128.png",
]

def build_extension():
    script_dir = Path(__file__).parent

    # Create output filename with version from manifest
    import json
    with open(script_dir / "manifest.json", "r") as f:
        manifest = json.load(f)

    version = manifest.get("version", "1.0")
    name = manifest.get("name", "extension").replace(" ", "-").lower()
    timestamp = datetime.now().strftime("%Y%m%d")

    zip_name = f"{name}-v{version}-{timestamp}.zip"
    zip_path = script_dir / zip_name

    # Remove old zip if exists
    if zip_path.exists():
        zip_path.unlink()

    # Create zip
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for file_path in INCLUDE_FILES:
            full_path = script_dir / file_path
            if full_path.exists():
                zf.write(full_path, file_path)
                print(f"  + {file_path}")
            else:
                print(f"  ! Missing: {file_path}")

    # Get zip size
    size_kb = zip_path.stat().st_size / 1024

    print(f"\nCreated: {zip_name} ({size_kb:.1f} KB)")
    print(f"Location: {zip_path}")
    return zip_path

if __name__ == "__main__":
    print("Building Chrome Extension zip...\n")
    build_extension()
