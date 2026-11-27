# Contact sheet: python3 tools/contact-sheet.py out.jpg <cols> <scale> img1.png img2.png ...
import sys
from PIL import Image, ImageDraw
out, cols, scale, *files = sys.argv[1:]
cols, scale = int(cols), float(scale)
ims = [Image.open(f).convert('RGB') for f in files]
w, h = int(ims[0].width * scale), int(ims[0].height * scale)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (w * cols, h * rows), 'white')
for i, (im, f) in enumerate(zip(ims, files)):
    im = im.resize((w, h), Image.LANCZOS)
    x, y = (i % cols) * w, (i // cols) * h
    sheet.paste(im, (x, y))
    ImageDraw.Draw(sheet).text((x + 6, y + 6), f.rsplit('/', 1)[-1][:40], fill='red')
sheet.save(out, quality=85)
