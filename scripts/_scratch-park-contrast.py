# SCRATCH (IDEA-081): biscuit-vs-corridor contrast on a rendered board shot.
# Finds the darkest blobs on the walk (the biscuits) and the walk's own
# modal colour, and reports the WCAG contrast ratio between them.
import sys
from PIL import Image
from collections import Counter
def lin(v):
    v = v / 255
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
def L(c): return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
im = Image.open(sys.argv[1]).convert("RGB")
x0, y0, x1, y1 = map(int, sys.argv[2:6])
px = [im.getpixel((x, y)) for x in range(x0, x1) for y in range(y0, y1)]
# The walk: the most common light, non-green colour.
# Light and NOT green: the walk can be warm sand or a near-neutral cream.
warm = [p for p in px if p[1] <= p[0] + 6 and sum(p) > 450]
walk = Counter((p[0] // 6 * 6, p[1] // 6 * 6, p[2] // 6 * 6) for p in warm).most_common(1)[0][0]
# The biscuit: the darkest WARM pixels. Red only has to lead BLUE: a near-
# black chocolate (the ink biscuit) has red barely ahead of green, and the
# first version of this filter (red leading green by 25) silently skipped it
# and measured the biscuits' lighter edges instead. Shadows and kerbs are
# grey, so red-over-blue still keeps them out.
bis = sorted((p for p in px if p[0] > p[2] + 25 and p[1] <= p[0] + 6), key=L)[:40]
b = tuple(sum(c[i] for c in bis) // len(bis) for i in range(3))
lw, lb = L(walk), L(b)
print("walk", walk, round(lw, 3), "| biscuit", b, round(lb, 3), "| ratio", round((max(lw, lb) + 0.05) / (min(lw, lb) + 0.05), 2))
