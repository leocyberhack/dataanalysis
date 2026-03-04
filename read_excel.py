import sys
import pandas as pd
file = r'c:\桌面\美团数据分析\商品排行1772173331102.xlsx'
with open(r'c:\桌面\美团数据分析\excel_info.txt', 'w', encoding='utf-8') as f:
    try:
        xls = pd.ExcelFile(file)
        f.write("总共有 {} 个Sheet。\n".format(len(xls.sheet_names)))
        for s in xls.sheet_names:
            df = pd.read_excel(xls, sheet_name=s)
            f.write("\n==============================\n")
            f.write("Sheet名称: {}\n".format(s))
            f.write("数据结构(行, 列): {}\n".format(df.shape))
            f.write("数据列(字段):\n")
            for i, col in enumerate(df.columns.tolist()):
                f.write("  {}. {}\n".format(i+1, col))
            f.write("前两行数据示例:\n")
            f.write(df.head(2).to_string() + "\n")
            f.write("==============================\n")
    except Exception as e:
        f.write("Error: " + str(e) + "\n")
