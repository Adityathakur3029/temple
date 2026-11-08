"""
Sannidhi mandapa, the `mandapa` slot in spec 11: the open pillared hall in front of the shrine.
Made for Sannidhi by Claude (AI) in Blender 5.2 by this script, so the model is "ai": true and
disclosed in the credits.

Run inside Blender (Scripting tab, or the MCP connector):
    path = r"<repo>/assets-src/models/mandapa/make_mandapa.py"
    exec(compile(open(path, encoding="utf-8").read(), path, "exec"), {"__file__": path})
It replaces any earlier "mandapa" object and, if EXPORT is set, writes mandapa.glb.

Frame: Blender metres, z up. The origin is the slot's: world (0, 0, 12.1) in spec 02's layout,
and -y is the front (glTF +z, the world's +z, towards the steps). The script works in world
coordinates and converts with W(): Blender (x, y, z) = (world x, 12.1 - world z, world y).

Lines up with packages/protocol/src/world.ts and apps/web/src/scene/ground.ts (spec 11: the
walking rules don't change with the model, so the model follows them):
- Floor at exactly 0.45 m (PLINTH) over x -7 ... 7, z 5 ... 19, with the paler aisle stone on the
  Nandi axis (x -1.2 ... 1.2). Plain stone: no symbol on the floor or the steps (spec 08).
- Two steps down the east side, z 19 ... 19.67, full width, tops at 0.30 and 0.15 m, which match
  the walking slope in ground.ts.
- 12 pillars at MANDAPA_PILLARS (x +/-6.5 at z 5.6, 10, 14.4, 18.6; x +/-2.9 at z 5.6 and 18.6),
  0.44 m across (the obstacle is 0.5 m), capitals ending at 4.2 m (HEIGHTS.pillarTop). The outer
  pillars stay within 0.25 m of their centre at 3.42 m, where the code fixes the lamp brackets.
- Beams under a flat ceiling at 4.42 m; the eave reaches x +/-7.6 and z 4.6 ... 19.8 (15.2 m wide,
  the slot's size) with its underside at 4.42 m, where the mandapa bell chains end (x +/-2.2,
  z 19.5).
- Plinth mouldings stay within the plinth-edge obstacles (x +/-7.4, z from 4.6). A low wall runs
  along the north, south and west edges between the pillars; the east side is open to the steps.
- Nothing stands or hangs in the aisle below 4.15 m, so the darshan view through the antarala to
  the sanctum door stays clear.
- A stepped (phamsana) stone roof with a ribbed crown and a brass kalasha, about 7.9 m high.
No carved figures or sacred symbols. One material with vertex colours: one draw call.
"""
import math
import os
import random

import bmesh
import bpy

EXPORT = True
NAME = "mandapa"
HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else None
OZ = 12.1  # world z of the slot origin

random.seed(12)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexcol(h):
    h = h.lstrip("#")
    return tuple(srgb_to_linear(int(h[i : i + 2], 16) / 255) for i in (0, 2, 4))


# The greybox palette (greybox.ts COLOURS), with a few in-between stones.
PAL = {
    "floor": hexcol("#8a8172"),
    "aisle": hexcol("#a59c8c"),
    "plinth": hexcol("#7d7366"),
    "moulding": hexcol("#6b6256"),
    "stone": hexcol("#8b8070"),
    "stoneDark": hexcol("#71675a"),
    "roof": hexcol("#867b6b"),
    "ceiling": hexcol("#6f665a"),
    "brass": hexcol("#b08d3c"),
    "moss": hexcol("#5b6142"),
}

bm = bmesh.new()
COL = bm.loops.layers.float_color.new("Col")
NO_WEATHER = set()  # faces with their own baked shading


def W(x, y, z):
    """World point (y up) to Blender."""
    return (x, OZ - z, y)


def tone(color, jitter):
    base = PAL[color] if isinstance(color, str) else color
    k = 1 + random.uniform(-jitter, jitter)
    return tuple(min(1.0, v * k) for v in base)


def paint(faces, color, jitter=0.04):
    c = tone(color, jitter)
    for f in faces:
        for loop in f.loops:
            loop[COL] = (*c, 1.0)


def loft(rings, colors, cap_bottom=True, cap_top=True, jitter=0.04):
    """Join rings of Blender points (same count, counter-clockwise from above) with quads.
    `colors` is one colour for everything, or one per segment (cap colours: first and last)."""
    vr = [[bm.verts.new(p) for p in r] for r in rings]
    n = len(rings[0])
    per = colors if isinstance(colors, list) else [colors] * (len(rings) - 1)
    faces = []
    for s, (a, b) in enumerate(zip(vr, vr[1:])):
        seg = [bm.faces.new([a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]]) for i in range(n)]
        paint(seg, per[s], jitter)
        faces += seg
    if cap_bottom:
        f = bm.faces.new(list(reversed(vr[0])))
        paint([f], per[0], jitter)
        faces.append(f)
    if cap_top:
        f = bm.faces.new(vr[-1])
        paint([f], per[-1], jitter)
        faces.append(f)
    return faces


def box_w(x0, x1, y0, y1, z0, z1, color, **kw):
    """An axis-aligned box given in world coordinates (y up)."""
    b0, b1 = OZ - z1, OZ - z0
    sq = [(x0, b0), (x1, b0), (x1, b1), (x0, b1)]
    return loft([[(x, y, y0) for x, y in sq], [(x, y, y1) for x, y in sq]], color, **kw)


def rect_ring_w(x0, x1, z0, z1, y):
    b0, b1 = OZ - z1, OZ - z0
    return [(x0, b0, y), (x1, b0, y), (x1, b1, y), (x0, b1, y)]


def sq_ring_w(cx, cz, h, y):
    return rect_ring_w(cx - h, cx + h, cz - h, cz + h, y)


def poly_ring_w(cx, cz, r, y, n, phase=0.0):
    bx, by = cx, OZ - cz
    return [(bx + r * math.cos(phase + 2 * math.pi * i / n), by + r * math.sin(phase + 2 * math.pi * i / n), y)
            for i in range(n)]


def oct_ring_w(cx, cz, apothem, y):
    """Regular octagon with its flat faces towards the axes."""
    r = apothem / math.cos(math.pi / 8)
    return poly_ring_w(cx, cz, r, y, 8, math.pi / 8)


def extrude_y(profile_xz, y0, y1, color, **kw):
    """Blender: an (x, z) outline, counter-clockwise seen from -y, run along y from y0 to y1."""
    a = [bm.verts.new((x, y0, z)) for x, z in profile_xz]
    b = [bm.verts.new((x, y1, z)) for x, z in profile_xz]
    n = len(profile_xz)
    faces = [bm.faces.new([a[i], b[i], b[(i + 1) % n], a[(i + 1) % n]]) for i in range(n)]
    faces.append(bm.faces.new(a))
    faces.append(bm.faces.new(list(reversed(b))))
    paint(faces, color, **kw)
    return faces


def extrude_x(profile_yz, x0, x1, color, **kw):
    """Blender: a (y, z) outline, counter-clockwise seen from +x, run along x from x0 to x1."""
    a = [bm.verts.new((x0, y, z)) for y, z in profile_yz]
    b = [bm.verts.new((x1, y, z)) for y, z in profile_yz]
    n = len(profile_yz)
    faces = [bm.faces.new([a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]]) for i in range(n)]
    faces.append(bm.faces.new(b))
    faces.append(bm.faces.new(list(reversed(a))))
    paint(faces, color, **kw)
    return faces


# World layout (world.ts, ground.ts)
PLINTH = 0.45
MX, MZ0, MZ1 = 7.0, 5.0, 19.0  # MANDAPA
AISLE = 1.2  # NANDI_AXIS half width
PILLARS = [(x, z) for z in (5.6, 10, 14.4, 18.6) for x in (6.5, -6.5)] + \
          [(x, z) for z in (5.6, 18.6) for x in (2.9, -2.9)]
PILLAR_TOP = 4.2
CEIL = 4.42
EAVE_X, EAVE_Z0, EAVE_Z1 = 7.6, 4.6, 19.8

# --- Plinth: moulded sides round the north, south and west; the east face is behind the steps ------
# (offset out from the floor's edge, height). Each point is higher than the last, so the east face
# (where every ring meets z = 19) has no zero-area faces. The top is a chamfer, not a ledge, so
# nothing lies flat at 0.45 m beside the antarala's own floor.
PROFILE = [
    (0.32, 0.0), (0.32, 0.07), (0.26, 0.10), (0.24, 0.13), (0.25, 0.17), (0.24, 0.21),
    (0.19, 0.25), (0.11, 0.27), (0.07, 0.28), (0.07, 0.32), (0.17, 0.355), (0.19, 0.38),
    (0.12, 0.395), (0.06, 0.40), (0.06, 0.43), (0.0, PLINTH),
]
PCOL = ["plinth", "plinth", "moulding", "stone", "stone", "stone", "moulding", "moulding",
        "stoneDark", "moulding", "stone", "moulding", "moulding", "plinth", "plinth"]
rings = [rect_ring_w(-MX - o, MX + o, MZ0 - o, MZ1, y) for o, y in PROFILE]
loft(rings, PCOL, cap_bottom=False, cap_top=False, jitter=0.02)

# --- Floor: square stone slabs, the aisle in paler stone --------------------------------------------
fx = [-7, -6, -5, -4, -3, -2, -AISLE, -0.4, 0.4, AISLE, 2, 3, 4, 5, 6, 7]
fz = [float(z) for z in range(5, 20)]
grid = [[bm.verts.new(W(x, PLINTH, z)) for x in fx] for z in fz]
for j in range(len(fz) - 1):
    for i in range(len(fx) - 1):
        # Counter-clockwise from above in Blender: world z grows towards -y.
        f = bm.faces.new([grid[j + 1][i], grid[j + 1][i + 1], grid[j][i + 1], grid[j][i]])
        cx = (fx[i] + fx[i + 1]) / 2
        c = tone("aisle" if abs(cx) < AISLE else "floor", 0.05)
        for loop in f.loops:
            loop[COL] = (*c, 1.0)
        NO_WEATHER.add(f)

# --- Steps: two treads of stone blocks across the east side ---------------------------------------
for (z0, z1, top) in ((19.0, 19.335, 0.30), (19.335, 19.67, 0.15)):
    for k in range(7):
        x0, x1 = -7 + 2 * k, -5 + 2 * k
        box_w(x0 + (0.004 if k else 0), x1, 0.0, top, z0, z1, "plinth", cap_bottom=False, jitter=0.06)

# --- Pillars -----------------------------------------------------------------------------------------
for (px, pz) in PILLARS:
    # Square foot and lower shaft, with one raised band.
    sq = [(0.30, 0.45), (0.30, 0.56), (0.26, 0.62), (0.22, 0.66), (0.22, 0.95), (0.235, 0.97),
          (0.235, 1.02), (0.22, 1.04), (0.22, 1.55)]
    cols = ["stoneDark", "stoneDark", "stoneDark", "stone", "stoneDark", "stoneDark", "stoneDark", "stone"]
    loft([sq_ring_w(px, pz, h, y) for h, y in sq], cols, cap_bottom=False)
    # Octagonal middle, one band.
    oc = [(0.22, 1.55), (0.22, 2.0), (0.232, 2.02), (0.232, 2.07), (0.22, 2.09), (0.22, 2.55)]
    cols = ["stone", "stoneDark", "stoneDark", "stoneDark", "stone"]
    loft([oct_ring_w(px, pz, a, y) for a, y in oc], cols, cap_bottom=False)
    # Sixteen-sided upper shaft, a neck band and the pot (ghata) capital.
    rd = [(0.215, 2.55), (0.215, 3.18), (0.235, 3.2), (0.235, 3.27), (0.2, 3.29), (0.24, 3.36),
          (0.255, 3.45), (0.25, 3.55), (0.2, 3.62), (0.16, 3.66), (0.17, 3.68)]
    cols = ["stone", "stoneDark", "stoneDark", "stoneDark", "stone", "stone", "stone", "stone",
            "stoneDark", "stoneDark"]
    loft([poly_ring_w(px, pz, r, y, 16) for r, y in rd], cols, cap_bottom=False, cap_top=False)
    # Abacus, block and four curved bracket arms carrying the beams.
    loft([sq_ring_w(px, pz, h, y) for h, y in ((0.26, 3.68), (0.29, 3.72), (0.29, 3.78))], "stoneDark")
    box_w(px - 0.24, px + 0.24, 3.78, PILLAR_TOP, pz - 0.24, pz + 0.24, "stone", cap_bottom=False,
          cap_top=False)
    arm = [(0.0, 3.86), (0.30, 3.86), (0.36, 3.92), (0.38, 3.98), (0.46, 4.02), (0.47, PILLAR_TOP),
           (0.0, PILLAR_TOP)]
    bx, by = px, OZ - pz
    w = 0.11
    extrude_y([(bx + u, v) for u, v in arm], by - w, by + w, "stone")  # +x
    extrude_y([(bx - u, v) for u, v in reversed(arm)], by - w, by + w, "stone")  # -x
    extrude_x([(by + u, v) for u, v in arm], bx - w, bx + w, "stone")  # +y (world -z)
    extrude_x([(by - u, v) for u, v in reversed(arm)], bx - w, bx + w, "stone")  # -y (world +z)

# --- Beams: across at each pillar row, along each side between them ----------------------------------
def beam_profile(c, bottom):
    return [(c - 0.16, bottom), (c + 0.16, bottom), (c + 0.16, bottom + 0.07), (c + 0.2, bottom + 0.09),
            (c + 0.2, CEIL), (c - 0.2, CEIL), (c - 0.2, bottom + 0.09), (c - 0.16, bottom + 0.07)]


ROWS = [5.6, 10, 14.4, 18.6]
for z in ROWS:
    extrude_x(beam_profile(OZ - z, PILLAR_TOP), -6.85, 6.85, "stoneDark")
for x in (6.5, -6.5):
    for za, zb in zip(ROWS, ROWS[1:]):
        extrude_y(beam_profile(x, PILLAR_TOP + 0.04), OZ - (zb - 0.2), OZ - (za + 0.2), "stoneDark")

# --- Ceiling: the underside of the roof, darker deeper in ---------------------------------------------
cx_ = [-EAVE_X, -6.7, -6.3, -2.9, -AISLE, AISLE, 2.9, 6.3, 6.7, EAVE_X]
cz_ = [EAVE_Z0, 5.4, 5.8, 9.8, 10.2, 14.2, 14.6, 18.4, 18.8, EAVE_Z1]


def ceiling_k(x, z):
    d = min(EAVE_X - abs(x), z - EAVE_Z0 + 1.5, EAVE_Z1 - z)  # the west end is half closed by the shrine
    return 1.0 - 0.38 * min(1.0, max(0.0, d) / 3.5)


cg = [[bm.verts.new(W(x, CEIL, z)) for x in cx_] for z in cz_]
for j in range(len(cz_) - 1):
    for i in range(len(cx_) - 1):
        f = bm.faces.new([cg[j][i], cg[j][i + 1], cg[j + 1][i + 1], cg[j + 1][i]])  # faces down
        for loop in f.loops:
            co = loop.vert.co
            k = ceiling_k(co.x, OZ - co.y)
            loop[COL] = (*(v * k for v in PAL["ceiling"]), 1.0)
        NO_WEATHER.add(f)

# A coffered panel over the middle of the hall: three stepped square frames and a plain pendant.
CZ = 12.2
for (outer, inner, low) in ((1.8, 1.5, 4.30), (1.5, 1.2, 4.35), (1.2, 0.9, 4.39)):
    for (x0, x1, z0, z1) in ((-outer, outer, CZ - outer, CZ - inner), (-outer, outer, CZ + inner, CZ + outer),
                             (-outer, -inner, CZ - inner, CZ + inner), (inner, outer, CZ - inner, CZ + inner)):
        box_w(x0, x1, low, CEIL, z0, z1, "stoneDark", cap_top=False, jitter=0.03)
pendant = [(0.62, CEIL), (0.64, 4.39), (0.5, 4.33), (0.34, 4.28), (0.2, 4.23), (0.09, 4.18), (0.03, 4.15)]
loft([poly_ring_w(0, CZ, r, y, 16) for r, y in reversed(pendant)], "stone", cap_top=False)

# --- Low walls along the north, south and west edges, between the pillars ---------------------------
WALL = [(0.0, PLINTH), (0.22, PLINTH), (0.22, 0.52), (0.18, 0.55), (0.18, 0.95), (0.24, 0.98),
        (0.24, 1.05), (-0.02, 1.05), (-0.02, 0.98), (0.04, 0.95), (0.04, 0.55), (0.0, 0.52)]
WALL_IN = 6.88  # inner face, world |x|; the outer face leans no further than 7.12
for s in (1, -1):
    pts = [(s * (WALL_IN + u), v) for u, v in WALL]
    if s < 0:
        pts = list(reversed(pts))
    for za, zb in ((5.12, 5.31), (5.89, 9.71), (10.29, 14.11), (14.69, 18.31)):
        extrude_y(pts, OZ - zb, OZ - za, "plinth")
# West edge, from the inner pillars' feet out to the corners (world z 4.92 ... 5.12).
# Blender y grows towards the shrine, so the outline keeps its turn and needs no reversing. Each
# wall runs from the antarala's side wall (|x| 2.85) out to the corner.
west = [(OZ - (5.12 - u), v) for u, v in WALL]
for x0, x1 in ((2.85, 7.12), (-7.12, -2.85)):
    extrude_x(west, x0, x1, "plinth")

# --- Roof: a sloping eave, four stepped tiers, a ribbed crown and the kalasha ------------------------
# (half size, height); the eave is the slot's full 15.2 m, the tiers are square about the pillars.
roof = [rect_ring_w(-EAVE_X, EAVE_X, EAVE_Z0, EAVE_Z1, CEIL),
        rect_ring_w(-EAVE_X, EAVE_X, EAVE_Z0, EAVE_Z1, CEIL + 0.1),
        sq_ring_w(0, OZ, 6.7, 4.78)]
tiers = [(6.3, 4.80), (6.3, 5.02), (6.45, 5.08), (6.45, 5.12), (5.6, 5.24),
         (5.3, 5.25), (5.3, 5.45), (5.45, 5.50), (5.45, 5.54), (4.6, 5.66),
         (4.3, 5.67), (4.3, 5.85), (4.45, 5.90), (4.45, 5.94), (3.6, 6.05),
         (3.3, 6.06), (3.3, 6.22), (3.42, 6.26), (3.42, 6.30), (2.4, 6.42),
         (1.7, 6.44), (1.7, 6.58)]
for h, y in tiers:
    roof.append(sq_ring_w(0, OZ, h, y))
# Eave edge, eave slope, the ledge to the first tier; then each tier: band, kapota underside, kapota
# face, sloping top, ledge.
TIER_COLS = ["stone", "stoneDark", "stoneDark", "roof", "roof"]
rcol = ["stoneDark", "roof", "roof"] + [TIER_COLS[i % 5] for i in range(len(tiers) - 1)]
assert len(rcol) == len(roof) - 1
loft(roof, rcol, cap_bottom=False, jitter=0.02)

# Ribbed bell-shaped crown (ghanta) on the square top: 32 points a ring, every other one sunk.
CROWN = [(1.45, 6.58), (1.52, 6.66), (1.48, 6.76), (1.3, 6.88), (1.0, 6.98), (0.6, 7.05), (0.36, 7.08)]
crown_rings = []
for i, (r, y) in enumerate(CROWN):
    rib = 0.94 if 0 < i < len(CROWN) - 1 else 1.0
    pts = []
    for k in range(32):
        a = 2 * math.pi * k / 32
        rr = r * (1.0 if k % 2 == 0 else rib)
        pts.append((rr * math.cos(a), rr * math.sin(a), y))
    crown_rings.append(pts)
loft(crown_rings, "stone", cap_bottom=False)
neck = [(0.36, 7.08), (0.3, 7.1), (0.3, 7.14), (0.36, 7.16)]
loft([poly_ring_w(0, OZ, r, y, 16) for r, y in neck], "stoneDark", cap_bottom=False, cap_top=False)

# Brass kalasha (the greybox shape, 0.75 m tall), with its own little foot ring.
KAL = [(0.2, 0), (0.36, 0.1), (0.42, 0.26), (0.32, 0.42), (0.13, 0.52), (0.17, 0.6), (0.06, 0.86),
       (0.001, 1.0)]
s = 0.75
base_y = 7.16
kal = [poly_ring_w(0, OZ, 0.36, base_y, 16)] + \
      [poly_ring_w(0, OZ, r * s, base_y + y * s, 16) for r, y in KAL]
loft(kal, "brass", cap_bottom=False, cap_top=False, jitter=0.0)

# --- Weathering: damp near the ground, darker undersides, a little moss on the roof steps ----------
bm.normal_update()
moss = PAL["moss"]
for f in bm.faces:
    if f in NO_WEATHER:
        continue
    n = f.normal
    c = f.calc_center_median()
    k = 1.0
    if n.z < -0.5:
        k *= 0.8
    if c.z < 0.5:
        k *= 0.84 + 0.16 * (c.z / 0.5)
    mix = 0.14 if (n.z > 0.6 and 4.5 < c.z < 7.0 and random.random() < 0.7) else 0.0
    if k == 1.0 and mix == 0.0:
        continue
    for loop in f.loops:
        r, g, b, a = loop[COL]
        r, g, b = (r * (1 - mix) + moss[0] * mix, g * (1 - mix) + moss[1] * mix, b * (1 - mix) + moss[2] * mix)
        loop[COL] = (r * k, g * k, b * k, a)

# --- Object, material, export -----------------------------------------------------------------------
old = bpy.data.objects.get(NAME)
if old:
    bpy.data.objects.remove(old, do_unlink=True)
mesh = bpy.data.meshes.get(NAME)
if mesh:
    bpy.data.meshes.remove(mesh)
mesh = bpy.data.meshes.new(NAME)
bm.to_mesh(mesh)
bm.free()
mesh.color_attributes.active_color = mesh.color_attributes["Col"]
mesh.color_attributes.render_color_index = mesh.color_attributes.active_color_index
# Round parts (pots, pendant, crown, kalasha) shade smooth; anything sharper than 35 degrees stays crisp.
mesh.shade_smooth()
mesh.set_sharp_from_angle(angle=math.radians(35))

mat = bpy.data.materials.get("mandapa-stone") or bpy.data.materials.new("mandapa-stone")
mat.use_nodes = True
mat.use_backface_culling = True
nodes, links = mat.node_tree.nodes, mat.node_tree.links
bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
bsdf.inputs["Base Color"].default_value = (1, 1, 1, 1)
bsdf.inputs["Roughness"].default_value = 0.9
bsdf.inputs["Metallic"].default_value = 0.0
attr = next((n for n in nodes if n.type == "VERTEX_COLOR"), None) or nodes.new("ShaderNodeVertexColor")
attr.layer_name = "Col"
attr.location = (bsdf.location.x - 300, bsdf.location.y)
links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
mesh.materials.append(mat)

obj = bpy.data.objects.new(NAME, mesh)
bpy.context.scene.collection.objects.link(obj)
obj.location = (0.0, 40.0, 0.0)  # well away from the other models while working; not exported

tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
xs = [v.co.x for v in mesh.vertices]
ys = [v.co.y for v in mesh.vertices]
zs = [v.co.z for v in mesh.vertices]
print(f"{NAME}: {tris} triangles, x {min(xs):.3f}..{max(xs):.3f}, world z {OZ - max(ys):.3f}..{OZ - min(ys):.3f}, "
      f"height {min(zs):.3f}..{max(zs):.3f}")

if EXPORT and HERE:
    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    saved = obj.location.copy()
    obj.location = (0, 0, 0)
    out = os.path.join(HERE, NAME + ".glb")
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_cameras=False,
        export_lights=False,
        export_normals=True,
        export_vertex_color="MATERIAL",
    )
    obj.location = saved
    print("exported", out)
