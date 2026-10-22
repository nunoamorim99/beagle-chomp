# Contact sheet of a shoot-showcase.ts run: one row per stage, one column per
# theme. Usage: python scripts/_scratch-showcase-contact.py <label> [framing]
import sys
from PIL import Image
label = sys.argv[1]
framing = sys.argv[2] if len(sys.argv) > 2 else "phone"
root = f".img2threejs/showcase/renders/{label}"
themes = ["garden", "forest", "beach", "park", "city", "classic"]
stages = ["menu", "shop", "theme"]
w, h = (234, 506) if framing == "phone" else (480, 300)
sheet = Image.new("RGB", (w * len(themes), h * len(stages)), "white")
for r, st in enumerate(stages):
    for c, th in enumerate(themes):
        try:
            im = Image.open(f"{root}/{st}-{th}-{framing}.png").convert("RGB").resize((w, h))
            sheet.paste(im, (c * w, r * h))
        except FileNotFoundError:
            pass
sheet.save(f"{root}/_contact-{framing}.png")
print(f"{root}/_contact-{framing}.png")
