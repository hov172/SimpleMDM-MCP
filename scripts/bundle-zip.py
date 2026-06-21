#!/usr/bin/env python3
"""Bundle every file in a report output directory into a single .zip, using only
the Python standard library. Excludes the bundle itself, macOS cruft, and the
sha256 manifest is included (it's a deliverable). Preserves subdirs (e.g. raw/,
status-snapshots/) with paths relative to the output directory.

Usage: python3 bundle-zip.py <out_dir> <zip_name>

Best-effort: the engine ignores a non-zero exit and just skips the .zip artifact.
"""
import os
import sys
import zipfile


def main():
    if len(sys.argv) != 3:
        sys.stderr.write("usage: bundle-zip.py <out_dir> <zip_name>\n")
        return 2
    out_dir, zip_name = sys.argv[1], sys.argv[2]
    zip_path = os.path.join(out_dir, zip_name)
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for root, _dirs, files in os.walk(out_dir):
            for name in sorted(files):
                if name == zip_name or name == ".DS_Store" or name.startswith("__MACOSX"):
                    continue
                full = os.path.join(root, name)
                arc = os.path.relpath(full, out_dir)
                z.write(full, arc)
    return 0


if __name__ == "__main__":
    sys.exit(main())
