import os
import sys

sys.path.insert(0, os.path.abspath("./venv_libs"))
import pypdf

pdf_path = "./Modbus RTU Protocol V2.14-1 2.pdf"
reader = pypdf.PdfReader(pdf_path)

print("--- PAGE 21 ---")
print(reader.pages[20].extract_text()[:4000])
