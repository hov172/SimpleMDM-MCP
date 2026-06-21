#!/usr/bin/env python3
"""Convert a CSV file to a minimal, valid .xlsx (Office Open XML) using only the
Python standard library — no third-party deps. Numeric-looking cells are written
as numbers; everything else as inline strings.

Usage: python3 csv-to-xlsx.py <input.csv> <output.xlsx>

The engine shells out to this (best-effort); a non-zero exit just skips the xlsx
artifact, exactly like the pdf/docx pipeline degrades when a tool is absent.
"""
import csv
import re
import sys
import zipfile
from xml.sax.saxutils import escape

NUMERIC = re.compile(r"^-?\d+(\.\d+)?$")


def col_ref(idx: int) -> str:
    """0-based column index -> spreadsheet letter (0->A, 26->AA)."""
    s = ""
    idx += 1
    while idx:
        idx, rem = divmod(idx - 1, 26)
        s = chr(65 + rem) + s
    return s


def cell_xml(value: str, ref: str) -> str:
    # Treat genuine numbers as numeric cells; keep leading-zero / id-like strings as text.
    if NUMERIC.match(value) and not (len(value) > 1 and value[0] == "0" and value[1] != "."):
        return f'<c r="{ref}"><v>{value}</v></c>'
    return f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{escape(value)}</t></is></c>'


def sheet_xml(rows):
    out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
           '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
           '<sheetData>']
    for r, row in enumerate(rows, start=1):
        out.append(f'<row r="{r}">')
        for c, val in enumerate(row):
            out.append(cell_xml(val, f"{col_ref(c)}{r}"))
        out.append('</row>')
    out.append('</sheetData></worksheet>')
    return "".join(out)


CONTENT_TYPES = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                 '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                 '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                 '<Default Extension="xml" ContentType="application/xml"/>'
                 '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                 '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                 '</Types>')

ROOT_RELS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
             '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
             '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
             '</Relationships>')

WORKBOOK = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
            ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>')

WORKBOOK_RELS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                 '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                 '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
                 '</Relationships>')


def main():
    if len(sys.argv) != 3:
        sys.stderr.write("usage: csv-to-xlsx.py <input.csv> <output.xlsx>\n")
        return 2
    src, dst = sys.argv[1], sys.argv[2]
    with open(src, newline="", encoding="utf-8") as f:
        rows = list(csv.reader(f))
    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", CONTENT_TYPES)
        z.writestr("_rels/.rels", ROOT_RELS)
        z.writestr("xl/workbook.xml", WORKBOOK)
        z.writestr("xl/_rels/workbook.xml.rels", WORKBOOK_RELS)
        z.writestr("xl/worksheets/sheet1.xml", sheet_xml(rows))
    return 0


if __name__ == "__main__":
    sys.exit(main())
