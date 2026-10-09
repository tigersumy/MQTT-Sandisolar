import os
import sys

sys.path.insert(0, os.path.abspath("./venv_libs"))
import pypdf

pdf_path = "./Modbus RTU Protocol V2.14-1 2.pdf"
reader = pypdf.PdfReader(pdf_path)

found = []
for idx, page in enumerate(reader.pages):
    text = page.extract_text()
    if "flcden" in text.lower() or "201" in text:
        found.append((idx + 1, text))

for page_num, text in found:
    print(f"=== PAGE {page_num} ===")
    lines = text.split('\n')
    for line in lines:
        if "flcden" in line.lower() or "201" in line:
            print(line)
