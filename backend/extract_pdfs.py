import os
from pypdf import PdfReader

base_dir = os.path.dirname(os.path.abspath(__file__))
laws_dir = os.path.join(base_dir, "..", "Nepal Laws")

pdf_files = [f for f in os.listdir(laws_dir) if f.endswith('.pdf')]

for pdf_file in pdf_files:
    pdf_path = os.path.join(laws_dir, pdf_file)
    txt_path = os.path.join(laws_dir, pdf_file.replace('.pdf', '.txt'))
    print(f"Extracting {pdf_file}...")
    try:
        reader = PdfReader(pdf_path)
        text = ""
        for page in reader.pages:
            extracted = page.extract_text()
            if extracted:
                text += extracted + "\n"
        with open(txt_path, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"Saved {txt_path}")
    except Exception as e:
        print(f"Failed to process {pdf_file}: {e}")
