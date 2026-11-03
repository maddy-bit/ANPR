"""
Master PDF Compiler & Document Generator.
Combines all documentation chapters into a styled HTML document and converts it to a professional PDF using Microsoft Edge headless.
"""

import os
import sys
import subprocess
from pathlib import Path

# Add chapters directory to sys.path
SCRIPT_DIR = Path(__file__).resolve().parent
CHAPTERS_DIR = SCRIPT_DIR / "chapters"
sys.path.insert(0, str(CHAPTERS_DIR))

import ch01_cover_and_toc
import ch02_overview_inventory
import ch03_architecture_diagrams
import ch04_syllabus_prerequisites
import ch05_dependency_audit
import ch06_source_analysis_ai
import ch07_source_analysis_backend
import ch08_source_analysis_frontend
import ch09_api_database_config
import ch10_reconstruction_roadmap
import ch11_testing_troubleshooting_security
import ch12_exercises_interview_glossary


def generate_css() -> str:
    return """
@page {
    size: A4;
    margin: 14mm 14mm 16mm 14mm;
    @bottom-right {
        content: "Page " counter(page);
        font-size: 8.5pt;
        font-family: 'Segoe UI', Arial, sans-serif;
        color: #64748b;
        font-weight: 600;
    }
    @bottom-left {
        content: "Bharat Electronics Limited (BEL) • SIH26127 Master Learning Guide";
        font-size: 8pt;
        font-family: 'Segoe UI', Arial, sans-serif;
        color: #94a3b8;
    }
}

* {
    box-sizing: border-box;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
}

body {
    font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif;
    font-size: 9.5pt;
    line-height: 1.55;
    color: #1e293b;
    margin: 0;
    padding: 0;
    background-color: #ffffff;
}

.page-break {
    page-break-before: always;
}

/* --- COVER PAGE --- */
.cover-page {
    padding: 40px 20px 20px 20px;
    min-height: 90vh;
    display: flex;
    flex-direction: column;
    justify-content: center;
    border-left: 8px solid #2563eb;
    padding-left: 30px;
}

.cover-badge {
    display: inline-block;
    background-color: #1e3a8a;
    color: #ffffff;
    font-size: 9pt;
    font-weight: 700;
    letter-spacing: 1.5px;
    padding: 5px 12px;
    border-radius: 4px;
    margin-bottom: 20px;
    text-transform: uppercase;
}

.cover-title {
    font-size: 26pt;
    font-weight: 800;
    line-height: 1.2;
    color: #0f172a;
    margin: 0 0 15px 0;
    letter-spacing: -0.5px;
}

.cover-subtitle {
    font-size: 13pt;
    line-height: 1.45;
    color: #334155;
    margin-bottom: 35px;
    font-weight: 500;
}

.cover-meta-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 15px;
    background-color: #f8fafc;
    border: 1px solid #e2e8f0;
    padding: 18px;
    border-radius: 6px;
    margin-bottom: 30px;
}

.meta-item {
    font-size: 9pt;
}

.meta-label {
    font-weight: 700;
    color: #64748b;
    font-size: 7.5pt;
    letter-spacing: 1px;
    text-transform: uppercase;
    margin-bottom: 3px;
}

.meta-val {
    color: #0f172a;
    font-weight: 600;
}

.cover-callout {
    background-color: #eff6ff;
    border-left: 4px solid #3b82f6;
    padding: 14px 18px;
    border-radius: 0 6px 6px 0;
    font-size: 9.5pt;
    color: #1e40af;
    line-height: 1.5;
}

/* --- HEADINGS --- */
h1, h2, h3, h4 {
    color: #0f172a;
    font-weight: 700;
    page-break-after: avoid;
}

.section-header-tag {
    font-size: 8.5pt;
    font-weight: 800;
    letter-spacing: 2px;
    color: #2563eb;
    text-transform: uppercase;
    margin-bottom: 4px;
}

.section-title {
    font-size: 18pt;
    color: #0f172a;
    border-bottom: 2px solid #e2e8f0;
    padding-bottom: 8px;
    margin-top: 0;
    margin-bottom: 16px;
    letter-spacing: -0.3px;
}

h3 {
    font-size: 12.5pt;
    margin-top: 20px;
    margin-bottom: 8px;
    color: #1e3a8a;
    border-left: 3px solid #2563eb;
    padding-left: 8px;
}

h4 {
    font-size: 10.5pt;
    margin-top: 14px;
    margin-bottom: 6px;
    color: #334155;
}

p {
    margin-top: 0;
    margin-bottom: 10px;
    text-align: justify;
}

ul, ol {
    margin-top: 0;
    margin-bottom: 12px;
    padding-left: 20px;
}

li {
    margin-bottom: 4px;
}

/* --- CODE BLOCKS & SYNTAX --- */
code {
    font-family: 'Consolas', 'Courier New', monospace;
    font-size: 8.5pt;
    background-color: #f1f5f9;
    color: #0f172a;
    padding: 1px 4px;
    border-radius: 3px;
    border: 1px solid #e2e8f0;
}

pre {
    background-color: #0f172a;
    color: #f8fafc;
    padding: 12px 14px;
    border-radius: 6px;
    font-size: 8pt;
    line-height: 1.45;
    overflow-x: hidden;
    page-break-inside: avoid;
    margin-top: 6px;
    margin-bottom: 14px;
    border: 1px solid #1e293b;
}

pre code {
    background-color: transparent;
    color: #f8fafc;
    padding: 0;
    border: none;
    font-size: 8pt;
}

/* --- TABLES --- */
.table-container {
    width: 100%;
    margin-top: 8px;
    margin-bottom: 16px;
    page-break-inside: avoid;
}

table {
    width: 100%;
    border-collapse: collapse;
    font-size: 8.5pt;
    page-break-inside: avoid;
}

th, td {
    border: 1px solid #cbd5e1;
    padding: 6px 10px;
    text-align: left;
    vertical-align: top;
}

th {
    background-color: #f1f5f9;
    color: #0f172a;
    font-weight: 700;
}

tr:nth-child(even) {
    background-color: #f8fafc;
}

/* --- BADGES --- */
.badge-get {
    background-color: #059669;
    color: #ffffff;
    font-size: 7pt;
    font-weight: 800;
    padding: 2px 6px;
    border-radius: 3px;
    display: inline-block;
}

.badge-post {
    background-color: #2563eb;
    color: #ffffff;
    font-size: 7pt;
    font-weight: 800;
    padding: 2px 6px;
    border-radius: 3px;
    display: inline-block;
}

.badge-ws {
    background-color: #7c3aed;
    color: #ffffff;
    font-size: 7pt;
    font-weight: 800;
    padding: 2px 6px;
    border-radius: 3px;
    display: inline-block;
}

/* --- ALERTS & CALLOUTS --- */
.alert-box {
    padding: 12px 15px;
    border-radius: 6px;
    margin-top: 10px;
    margin-bottom: 14px;
    page-break-inside: avoid;
    font-size: 9pt;
}

.alert-info {
    background-color: #eff6ff;
    border-left: 4px solid #3b82f6;
    color: #1e40af;
}

.alert-warning {
    background-color: #fffbeb;
    border-left: 4px solid #f59e0b;
    color: #92400e;
}

.alert-success {
    background-color: #ecfdf5;
    border-left: 4px solid #10b981;
    color: #065f46;
}

.alert-title {
    font-weight: 700;
    margin-bottom: 3px;
    font-size: 9.5pt;
}

/* --- TOC GRID --- */
.toc-container {
    padding: 10px 0;
}

.toc-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 20px;
}

.toc-group {
    margin-bottom: 16px;
}

.toc-group-title {
    font-size: 8pt;
    font-weight: 800;
    letter-spacing: 1px;
    color: #2563eb;
    margin-bottom: 6px;
    border-bottom: 1px solid #cbd5e1;
    padding-bottom: 3px;
}

.toc-item {
    display: block;
    color: #1e293b;
    text-decoration: none;
    font-size: 8.5pt;
    padding: 2.5px 0;
    font-weight: 500;
}

.toc-num {
    font-weight: 700;
    color: #64748b;
    margin-right: 4px;
}

/* --- CARDS & MILESTONES --- */
.card-grid-3 {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    margin-bottom: 15px;
    page-break-inside: avoid;
}

.card {
    background-color: #f8fafc;
    border: 1px solid #e2e8f0;
    padding: 12px;
    border-radius: 6px;
}

.card-title {
    font-weight: 700;
    color: #1e3a8a;
    font-size: 9.5pt;
    margin-bottom: 5px;
}

.meta-box {
    background-color: #f1f5f9;
    border-left: 3px solid #64748b;
    padding: 8px 12px;
    font-size: 8.5pt;
    margin-bottom: 12px;
    border-radius: 0 4px 4px 0;
}

.level-box {
    background-color: #f8fafc;
    border: 1px solid #e2e8f0;
    padding: 10px 14px;
    border-radius: 6px;
    margin-bottom: 10px;
    page-break-inside: avoid;
}

.level-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
}

.level-badge {
    background-color: #2563eb;
    color: white;
    font-size: 7.5pt;
    font-weight: 800;
    padding: 2px 6px;
    border-radius: 3px;
}

.level-title {
    font-weight: 700;
    color: #0f172a;
    font-size: 9.5pt;
}

.milestone-card {
    background-color: #ffffff;
    border: 1px solid #cbd5e1;
    border-left: 4px solid #2563eb;
    padding: 10px 14px;
    border-radius: 0 6px 6px 0;
    margin-bottom: 12px;
    page-break-inside: avoid;
}

.milestone-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
}

.milestone-badge {
    background-color: #1e3a8a;
    color: white;
    font-size: 7.5pt;
    font-weight: 800;
    padding: 2px 6px;
    border-radius: 3px;
    margin-right: 8px;
}

.milestone-title {
    font-weight: 700;
    color: #0f172a;
    font-size: 10pt;
    flex-grow: 1;
}

.milestone-diff {
    font-size: 7.5pt;
    color: #64748b;
    font-weight: 600;
}

.trouble-item {
    background-color: #fff1f2;
    border: 1px solid #fecdd3;
    border-left: 4px solid #e11d48;
    padding: 10px 14px;
    border-radius: 0 6px 6px 0;
    margin-bottom: 10px;
    page-break-inside: avoid;
}

.trouble-title {
    font-weight: 700;
    color: #9f1239;
    font-size: 9.5pt;
    margin-bottom: 4px;
}

.qa-item {
    background-color: #f8fafc;
    border: 1px solid #e2e8f0;
    padding: 12px 14px;
    border-radius: 6px;
    margin-bottom: 12px;
    page-break-inside: avoid;
}

.qa-q {
    font-weight: 700;
    color: #1e3a8a;
    font-size: 9.5pt;
    margin-bottom: 5px;
}

.qa-a {
    font-size: 9pt;
    color: #334155;
    line-height: 1.5;
}

.code-exercise {
    background-color: #fefce8;
    border: 1px solid #fef08a;
    border-left: 4px solid #ca8a04;
    padding: 10px 14px;
    border-radius: 0 6px 6px 0;
    font-size: 8.5pt;
    margin-top: 10px;
    margin-bottom: 14px;
    page-break-inside: avoid;
}

.code-solution {
    margin-top: 6px;
    page-break-inside: avoid;
}
"""


def build_master_html() -> str:
    print("Building master HTML document from chapter modules...")

    chapters = [
        ch01_cover_and_toc.get_content(),
        ch02_overview_inventory.get_content(),
        ch03_architecture_diagrams.get_content(),
        ch04_syllabus_prerequisites.get_content(),
        ch05_dependency_audit.get_content(),
        ch06_source_analysis_ai.get_content(),
        ch07_source_analysis_backend.get_content(),
        ch08_source_analysis_frontend.get_content(),
        ch09_api_database_config.get_content(),
        ch10_reconstruction_roadmap.get_content(),
        ch11_testing_troubleshooting_security.get_content(),
        ch12_exercises_interview_glossary.get_content(),
    ]

    body_html = "\n".join(chapters)
    css = generate_css()

    full_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>City AI Traffic Intelligence Platform (SIH26127 — BEL) — Master Learning Guide</title>
  <style>
{css}
  </style>
</head>
<body>
{body_html}
</body>
</html>
"""
    return full_html


def compile_pdf():
    html_content = build_master_html()
    html_path = SCRIPT_DIR / "COMPLETE_PROJECT_LEARNING_GUIDE.html"
    pdf_path = SCRIPT_DIR / "COMPLETE_PROJECT_LEARNING_GUIDE.pdf"

    print(f"Writing master HTML to: {html_path}")
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html_content)

    print(f"HTML size: {os.path.getsize(html_path)} bytes")

    edge_path = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
    if not os.path.exists(edge_path):
        print(f"Error: Microsoft Edge not found at {edge_path}", file=sys.stderr)
        sys.exit(1)

    print("Converting HTML to PDF via headless Microsoft Edge...")
    cmd = [
        edge_path,
        "--headless=new",
        "--disable-gpu",
        "--no-pdf-header-footer",
        f"--print-to-pdf={pdf_path}",
        f"file:///{html_path.resolve()}",
    ]

    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        print(f"Error generating PDF: {proc.stderr}", file=sys.stderr)
        sys.exit(proc.returncode)

    if not pdf_path.exists() or os.path.getsize(pdf_path) == 0:
        print("Error: Generated PDF is empty or missing!", file=sys.stderr)
        sys.exit(1)

    print(f"\n========================================================")
    print(f"SUCCESS: Generated PDF at: {pdf_path}")
    print(f"File Size: {os.path.getsize(pdf_path)} bytes ({os.path.getsize(pdf_path) / (1024*1024):.2f} MB)")
    print(f"========================================================")


if __name__ == "__main__":
    compile_pdf()
