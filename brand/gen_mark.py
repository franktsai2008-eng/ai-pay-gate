import random, math
random.seed(11)
# Tile 100x100, rounded. Dissolve along the top-right edge: the solid body ends on a
# diagonal band, breaks into a grid of cells that thin out, then a few cells drift off.
CELL = 6.0
def s_of(x, y):  # 0 bottom-left .. 1 top-right
    return (x - y + 100) / 200
SOLID = 0.70   # fully solid below this
GONE  = 0.95   # nothing attached above this
inside_cells, drift = [], []
for gy in range(-1, 19):
    for gx in range(-1, 19):
        x, y = gx * CELL + 1, gy * CELL + 1
        cx, cy = x + CELL / 2, y + CELL / 2
        if not (-2 <= cx <= 102 and -2 <= cy <= 102): continue
        s = s_of(cx, cy) + random.uniform(-0.035, 0.035)
        if s <= SOLID - 0.07: continue
        if s <= SOLID:
            inside_cells.append((cx - CELL/2 - 0.05, cy - CELL/2 - 0.05, CELL + 0.1)); continue
        p = 1 - (s - SOLID) / (GONE - SOLID)          # 1 at the band, 0 at GONE
        p = max(0, min(1, p))
        r = random.random()
        if r < p ** 1.3:                                  # attached cell (part of the body)
            size = CELL + 0.1 - (1 - p) ** 0.7 * 3.0
            inside_cells.append((cx - size / 2, cy - size / 2, size))
        elif s > 0.78 and r < p ** 1.3 + 0.3 * (1 - p):  # a cell that let go: drifts up-right
            k = 1 + (1 - p) * 2.2
            dx, dy = random.uniform(1, 7) * k, -random.uniform(1, 7) * k
            size = CELL * random.uniform(0.35, 0.8) * (1 - (1 - p) * 0.4)
            op = max(0.18, 0.95 - (1 - p) * 0.9)
            drift.append((cx + dx - size / 2, cy + dy - size / 2, size, op))
# clip polygon for the solid body: everything with s <= SOLID + half a cell
c = (SOLID - 0.07) * 200 - 100  # x - y <= c
poly = f"-20,-20 {c-20},-20 {120},{120-c} 120,120 -20,120"
def rects(cells, fill, extra=""):
    out = []
    for x, y, w, *rest in cells:
        op = f' opacity="{rest[0]:.2f}"' if rest else ""
        out.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{w:.1f}" rx="{w*0.3:.1f}" fill="{fill}"{op}{extra}/>')
    return "\n".join(out)
mask = f'''<mask id="dissolve" maskUnits="userSpaceOnUse" x="-20" y="-20" width="140" height="140">
  <polygon points="{poly}" fill="#fff"/>
  {rects(inside_cells, "#fff")}
</mask>'''
defs = f'''<defs>
  <linearGradient id="sg-glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b4642"/><stop offset="1" stop-color="#1a1e1c"/></linearGradient>
  <radialGradient id="sg-inner" cx=".5" cy=".3" r=".75"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  <linearGradient id="sg-glow" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#2f5d4a"/><stop offset="1" stop-color="#8fc3a6"/></linearGradient>
  <clipPath id="sg-half"><polygon points="0,0 100,0 100,28 0,70"/></clipPath>
  <filter id="sg-soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.4"/></filter>
  {mask}
</defs>'''
S = '''<text x="48" y="74" text-anchor="middle" font-family="Newsreader,'Times New Roman',serif" font-size="68" fill="#f3f1ea">S</text>
<g clip-path="url(#sg-half)"><text x="48" y="74" text-anchor="middle" font-family="Newsreader,'Times New Roman',serif" font-size="68" fill="#9cc4ad">S</text></g>'''
body = f'''<g mask="url(#dissolve)">
  <rect width="100" height="100" rx="22" fill="url(#sg-glass)"/>
  <rect width="100" height="100" rx="22" fill="url(#sg-inner)"/>
  <ellipse cx="48" cy="62" rx="30" ry="22" fill="#4f8a6f" opacity=".30" filter="url(#sg-soft)"/>
  <rect x=".5" y=".5" width="99" height="99" rx="21.5" fill="none" stroke="#fff" stroke-opacity=".16"/>
</g>
<g mask="url(#dissolve)" opacity=".55">{rects([(x,y,w) for x,y,w in inside_cells if s_of(x+w/2,y+w/2)>0.78], "url(#sg-glow)")}</g>
{S}
{rects(drift, "url(#sg-glow)")}'''
symbol = f'<symbol id="sigil-mark" viewBox="-20 -20 140 140" overflow="visible"><g transform="translate(0 0)">{body}</g></symbol>'
# standalone svg (viewBox includes the drift margin so nothing clips)
svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-16 -16 132 132">{defs}{body}</svg>'
open("mark.svg","w").write(svg)
open("mark-defs.inc","w").write(defs + "\n" + f'<symbol id="sigil-mark" viewBox="-16 -16 132 132" overflow="visible">{body}</symbol>')
print(len(inside_cells), "attached cells,", len(drift), "drifting")
