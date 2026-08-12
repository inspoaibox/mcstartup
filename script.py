import os

with open('src-tauri/src/main.rs', 'r', encoding='utf-8') as f:
    data = f.read()

data = data.replace('mod image_watermark_remove;', 'mod image_watermark_remove;\nmod excel_merge;')
data = data.replace('pdf_tools::pdf_to_images_gs,\n        ])', 'pdf_tools::pdf_to_images_gs,\n            excel_merge::merge_excel_files,\n        ])')
data = data.replace('pdf_tools::pdf_to_images_gs,\r\n        ])', 'pdf_tools::pdf_to_images_gs,\r\n            excel_merge::merge_excel_files,\r\n        ])')

with open('src-tauri/src/main.rs', 'w', encoding='utf-8') as f:
    f.write(data)
