import os
import sys

sys.path.insert(0, os.path.abspath("./venv_libs"))
import pypdf

pdf_path = "./Modbus RTU Protocol V2.14-1 2.pdf"
reader = pypdf.PdfReader(pdf_path)

found = []
for idx, page in enumerate(reader.pages):
    text = page.extract_text()
    if "inverter" in text.lower() or "status" in text.lower() or "mode" in text.lower():
        lines = text.split('\n')
        for line in lines:
            if " 0 " in line or " 1 " in line or " 2 " in line:
                if len(line) < 150:
                    found.append((idx + 1, line))

for page_num, line in found[:50]:
    print(f"P{page_num}: {line}")
