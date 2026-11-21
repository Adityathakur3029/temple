"""
Sannidhi Ganesha shrine, the `ganesha-shrine` slot in spec 11: the small open-fronted shrine near
the gate, with its pedestal, and empty. The Ganesha murti is its own `ganesha` slot (sacred,
never AI-made; spec 08) and is not part of this model. Made for Sannidhi by Claude (AI) in
Blender 5.2 by this script, so the model is "ai": true and disclosed in the credits.

Run inside Blender (Scripting tab, or the MCP connector):
    path = r"<repo>/assets-src/models/ganesha-shrine/make_ganesha_shrine.py"
    exec(compile(open(path, encoding="utf-8").read(), path, "exec"), {"__file__": path})
It replaces any earlier "ganesha-shrine" object and, if EXPORT is set, writes ganesha-shrine.glb.

Frame: Blender metres, z up, origin at the bottom centre; -y is the front (glTF +z), the open
side. In the temple the slot stands at world (-5.3, 0, 52) turned a quarter to face +x, so the
model's x runs along world -z and its front (+z) is world +x. The script works in the model's
own frame (x across, y up, z to the front) and converts with L(): Blender (x, y, z) =
(x, -z, y).

Lines up with packages/protocol/src/world.ts, greybox.ts and slots.ts:
- Below 2.04 m it stays inside the GANESHA_SHRINE obstacle: x -1.1 ... 1.1, z -1.0 ... 1.0
  (world z 50.9 ... 53.1, x -6.3 ... -4.3). Only the eave and the tower overhang, by at most
  0.15 m, which the forest already keeps clear of.
- A 0.4 m plinth with a step at the front; the shrine floor at 0.4 m.
- The pedestal's top at exactly 0.75 m, 0.84 m across and 0.74 m deep, under where the `ganesha`
  slot sets the murti (local z -0.075). Nothing stands on it.
- Two small stone stands with flat tops at 0.785 m, under the two lamp flames drawn in code at
  (+/-0.3, 0.82, 0.35). Stands only: the lamp and flame stay in code.
- An opening 1.6 m wide and 1.5 m high under a plain lintel; a cornice to 2.3 m; a small curved
  tower with ribbed corner stones; a ribbed amalaka and a brass kalasha whose tip is at exactly
  3.9 m (the slot's height).
- A marigold garland across the front: two loops on the lintel, lowest at 1.88 m (the murti's
  top is at 1.46 m), and a short strand down each pilaster. Nothing in front of the murti.
No carved figures or sacred symbols. One material with vertex colours: one draw call.
"""
import math
import os
import random

import bmesh
import bpy
from mathutils import Vector

EXPORT = True
NAME = "ganesha-shrine"
HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else None

random.seed(5)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexcol(h):
    h = h.lstrip("#")
    return tuple(srgb_to_linear(int(h[i : i + 2], 16) / 255) for i in (0, 2, 4))


PAL = {
    "plinth": hexcol("#7d7366"),
    "moulding": hexcol("#6b6256"),
    "stone": hexcol("#8b8070"),
    "stoneDark": hexcol("#71675a"),
    "shikhara": hexcol("#867b6b"),
    "shikharaDark": hexcol("#6e6457"),
    "floor": hexcol("#8a8172"),
    "ceiling": hexcol("#4a433a"),
    "brass": hexcol("#b08d3c"),
    "moss": hexcol("#5b6142"),
}

bm = bmesh.new()
COL = bm.loops.layers.float_color.new("Col")
NO_WEATHER = set()


def L(x, y, z):
    """Model point (y up, z to the front) to Blender."""
    return (x, -z, y)


def tone(color, jitter):
    base = PAL[color] if isinstance(color, str) else color
    k = 1 + random.uniform(-jitter, jitter)
    return tuple(min(1.0, v * k) for v in base)


def paint(faces, color, jitter=0.04, each=True):
    c = tone(color, jitter)
    for f in faces:
        if each:
            c = tone(color, jitter)
        for loop in f.loops:
            loop[COL] = (*c, 1.0)


def loft(rings, colors, cap_bottom=False, cap_top=False, jitter=0.04, each=True):
    """Join rings of Blender points (same count, counter-clockwise from above) with quads."""
    vr = [[bm.verts.new(p) for p in r] for r in rings]
    n = len(rings[0])
    per = colors if isinstance(colors, list) else [colors] * (len(rings) - 1)
    faces = []
    for s, (a, b) in enumerate(zip(vr, vr[1:])):
        seg = [bm.faces.new([a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]]) for i in range(n)]
        paint(seg, per[s], jitter, each)
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


def rect_ring(x0, x1, z0, z1, y):
    return [L(x0, y, z1), L(x1, y, z1), L(x1, y, z0), L(x0, y, z0)]


def box(x0, x1, y0, y1, z0, z1, color, **kw):
    return loft([rect_ring(x0, x1, z0, z1, y0), rect_ring(x0, x1, z0, z1, y1)], color,
                cap_bottom=kw.pop("cap_bottom", True), cap_top=kw.pop("cap_top", True), **kw)


def moulded(x0, x1, z0, z1, profile, colors, **kw):
    """A rectangle lofted through (offset, height) pairs."""
    return loft([rect_ring(x0 - o, x1 + o, z0 - o, z1 + o, y) for o, y in profile], colors, **kw)


def circle_ring(cz, r, y, n, rib=1.0):
    return [(r * (rib if k % 2 else 1.0) * math.cos(2 * math.pi * k / n),
             -cz + r * (rib if k % 2 else 1.0) * math.sin(2 * math.pi * k / n), y) for k in range(n)]


def face_down(x0, x1, z0, z1, y, color):
    f = bm.faces.new([bm.verts.new(p) for p in reversed(rect_ring(x0, x1, z0, z1, y))])
    paint([f], color, 0.02)
    NO_WEATHER.add(f)
    return f


X, Z0, Z1 = 1.1, -1.0, 1.0  # GANESHA_SHRINE in the model frame
FLOOR = 0.40
PED_TOP = 0.75
TOP = 3.9

# --- Plinth with a step at the front -----------------------------------------------------------------
PZ1 = 0.84
moulded(-X, X, Z0, PZ1, [(0.0, 0.0), (0.0, 0.07), (-0.03, 0.10), (-0.03, 0.27), (0.0, 0.30),
                         (0.0, 0.36), (-0.015, FLOOR)],
        ["plinth", "plinth", "moulding", "plinth", "plinth", "plinth"], jitter=0.04)
fx = [-X + 0.015, -0.55, 0.0, 0.55, X - 0.015]
fz = [Z0 + 0.015, -0.4, 0.2, PZ1 - 0.015]
for j in range(len(fz) - 1):
    for i in range(len(fx) - 1):
        f = bm.faces.new([bm.verts.new(p) for p in rect_ring(fx[i], fx[i + 1], fz[j], fz[j + 1], FLOOR)])
        paint([f], "floor", 0.06)
box(-0.75, 0.75, 0.0, 0.2, PZ1, Z1, "plinth", cap_bottom=False, jitter=0.05)

# --- Walls: back and sides on a base course, a band, front pilasters, the lintel ---------------------
WX0, WX1 = 0.82, 1.05  # side walls, inner and outer faces
BZ0, BZ1 = -0.97, -0.72  # back wall
FZ0, FZ1 = 0.60, 0.88  # front pilasters
LIN = 1.90  # lintel underside
WTOP = 2.04
box(-1.07, 1.07, FLOOR, 0.50, BZ0 - 0.02, BZ1, "moulding", cap_bottom=False)
for s in (1, -1):
    xa, xb = sorted((s * (WX0 - 0.02), s * (WX1 + 0.02)))
    box(xa, xb, FLOOR, 0.50, BZ1, FZ0, "moulding", cap_bottom=False)
box(-WX1, WX1, 0.50, WTOP, BZ0, BZ1, "stone", cap_bottom=False, cap_top=False)
for s in (1, -1):
    xa, xb = sorted((s * WX0, s * WX1))
    box(xa, xb, 0.50, WTOP, BZ1, FZ0, "stone", cap_bottom=False, cap_top=False)
# A band round the outside at 1.30 m.
box(-1.07, 1.07, 1.30, 1.37, BZ0 - 0.02, BZ0 + 0.1, "stoneDark", cap_bottom=True)
for s in (1, -1):
    xa, xb = sorted((s * (WX1 - 0.1), s * (WX1 + 0.02)))
    box(xa, xb, 1.30, 1.37, BZ0 + 0.1, FZ0, "stoneDark")
PIL = [(0.0, FLOOR), (0.0, 0.52), (-0.025, 0.56), (-0.025, 1.62), (-0.01, 1.65), (-0.01, 1.70),
       (-0.03, 1.72), (0.0, 1.80), (0.02, 1.84), (0.02, LIN)]
for s in (1, -1):
    xa, xb = sorted((s * 0.80, s * 1.07))
    moulded(xa, xb, FZ0, FZ1, PIL, ["stoneDark", "stoneDark", "stone", "stoneDark", "stoneDark",
                                    "stone", "stone", "stoneDark", "stoneDark"])
box(-1.07, 1.07, LIN, WTOP, FZ0 - 0.02, FZ1 + 0.02, "stoneDark", cap_bottom=True, cap_top=False)
face_down(-WX0, WX0, BZ1, FZ0 - 0.02, WTOP, "ceiling")

# --- Cornice (a projecting eave) ---------------------------------------------------------------------
CX, CZ0, CZ1 = 1.07, -0.97, 0.90
moulded(-CX, CX, CZ0, CZ1, [(0.0, WTOP), (0.05, WTOP + 0.03), (0.18, WTOP + 0.11), (0.18, WTOP + 0.18),
                            (0.09, WTOP + 0.22), (0.05, WTOP + 0.26)],
        ["stoneDark", "stoneDark", "stoneDark", "stone", "stone"], cap_top=True, jitter=0.03)

# --- Tower: a small curved shikhara in courses, ribbed corner stones, amalaka and kalasha -----------
TZ = -0.035  # the tower's centre (between the back wall and the lintel)
T0, T1 = WTOP + 0.26, 3.25


def S_of(y):
    t = min(1.0, max(0.0, (y - T0) / (T1 - T0)))
    return 0.88 - 0.58 * t ** 1.8


def rot(p, k):
    u, v = p
    for _ in range(k):
        u, v = -v, u
    return (u, v)


def tower_ring(y, o=0.0):
    S = S_of(y)
    Hk, Hb, ek = S + o, S + 0.06 * S / 0.88 + o, 0.42 * S + o
    side = [(Hk, Hk), (ek, Hk), (ek, Hb), (-ek, Hb), (-ek, Hk)]
    return [(u, -TZ + v, y) for k in range(4) for u, v in (rot(q, k) for q in side)]


# The tower is kept lean (5 courses, 8-sided corner stones, 16-sided amalaka, 8-sided kalasha) so
# the whole model, garland included, stays under the Lite target (2,000 triangles, half the slot's
# 4,000) and the Lite build doesn't simplify it: simplifying drops the small flowers first.
N_COURSE = 5
CH = (T1 - T0) / N_COURSE
rings, cols = [], []
for i in range(N_COURSE):
    y = T0 + i * CH
    rings += [tower_ring(y, -0.015), tower_ring(y + 0.025)]
    cols += ["shikharaDark", "shikhara"]
rings += [tower_ring(T1), tower_ring(T1, 0.03), tower_ring(T1 + 0.06, 0.03)]
cols += ["shikhara", "stoneDark", "stoneDark"]
loft(rings, cols[: len(rings) - 1], cap_top=True, jitter=0.05)


def squircle(cu, cv, a, y, n=16, p=5.0, rib=1.0):
    pts = []
    for k in range(n):
        t = 2 * math.pi * k / n + math.pi / n
        c, s = math.cos(t), math.sin(t)
        rr = rib if k % 2 else 1.0
        pts.append((cu + rr * a * math.copysign(abs(c) ** (2 / p), c),
                    -TZ + cv + rr * a * math.copysign(abs(s) ** (2 / p), s), y))
    return pts


CUSHION = [(-0.5, 0.97, 1.0), (0.0, 1.38, 0.9), (0.5, 0.97, 1.0)]
for i in (1, 4):
    cy = T0 + (i + 0.5) * CH
    S = S_of(cy)
    ek = 0.42 * S
    a0, c = (S - ek) / 2, (S + ek) / 2
    for cu, cv in ((c, c), (-c, c), (-c, -c), (c, -c)):
        loft([squircle(cu, cv, a0 * sc, cy + f * CH, n=8, rib=rb) for f, sc, rb in CUSHION], "stone",
             jitter=0.03, each=False)

y0 = T1 + 0.06
loft([circle_ring(TZ, 0.24, y0, 12), circle_ring(TZ, 0.24, y0 + 0.04, 12)], "stoneDark", jitter=0.02)
AM = [(0.24, 0.0), (0.38, 0.04), (0.43, 0.105), (0.38, 0.17), (0.21, 0.21)]
ya = y0 + 0.04
loft([circle_ring(TZ, r, ya + h, 16, rib=(0.9 if 0 < j < len(AM) - 1 else 1.0)) for j, (r, h) in enumerate(AM)],
     "stone", jitter=0.02, each=False)
yc = ya + AM[-1][1]
loft([circle_ring(TZ, 0.21, yc, 12), circle_ring(TZ, 0.17, yc + 0.02, 12)], "stoneDark", cap_top=True,
     jitter=0.02)
KAL = [(0.2, 0), (0.42, 0.22), (0.32, 0.42), (0.13, 0.52), (0.17, 0.6), (0.06, 0.86), (0.001, 1.0)]
yk = yc + 0.02
ks = TOP - yk
brass = loft([circle_ring(TZ, r * ks, yk + h * ks, 8) for r, h in KAL], "brass", jitter=0.0)
NO_WEATHER.update(brass)

# --- Pedestal (top at exactly 0.75 m, empty) and the two lamp stands ----------------------------------
moulded(-0.40, 0.40, -0.45, 0.25, [(0.03, FLOOR), (0.03, 0.46), (0.0, 0.49), (-0.03, 0.52),
                                   (-0.03, 0.65), (0.0, 0.68), (0.02, 0.70), (0.02, PED_TOP)],
        ["stoneDark", "stoneDark", "moulding", "moulding", "stoneDark", "stoneDark", "stoneDark"],
        cap_top=True, jitter=0.03)
for x in (0.3, -0.3):
    loft([rect_ring(x - h, x + h, 0.35 - h, 0.35 + h, y) for h, y in
          ((0.065, FLOOR), (0.065, 0.45), (0.04, 0.48), (0.04, 0.72), (0.065, 0.785))],
         ["stone", "stone", "stoneDark", "stone"], cap_top=True, jitter=0.03)

# --- Weathering: damp at the foot, shade inside, darker undersides, moss on the eave and tower ---
bm.normal_update()
moss = PAL["moss"]
for f in bm.faces:
    if f in NO_WEATHER:
        continue
    n = f.normal
    cc = f.calc_center_median()
    mz = -cc.y  # model z
    k = 1.0
    if n.z < -0.5:
        k *= 0.8
    if cc.z < 0.45:
        k *= 0.8 + 0.2 * (cc.z / 0.45)
    if abs(cc.x) < WX0 + 0.005 and BZ1 - 0.005 < mz < FZ0 and FLOOR < cc.z < WTOP:
        k *= 0.62 + 0.25 * max(0.0, (mz - BZ1) / (FZ0 - BZ1))  # inside: darker towards the back
    mix = 0.0
    if n.z > 0.55 and WTOP < cc.z < 3.5 and random.random() < 0.6:
        mix = 0.2
    elif T0 < cc.z < T1 and abs(n.z) < 0.7 and random.random() < 0.12:
        mix = 0.12
    elif cc.z < 0.4 and random.random() < 0.35:
        mix = 0.1
    if k == 1.0 and mix == 0.0:
        continue
    for loop in f.loops:
        r, g, b, a = loop[COL]
        r, g, b = (r * (1 - mix) + moss[0] * mix, g * (1 - mix) + moss[1] * mix, b * (1 - mix) + moss[2] * mix)
        loop[COL] = (r * k, g * k, b * k, a)

# --- Marigold garland across the front (after weathering, so the flowers stay bright) -------------
# Two loops across the lintel and a short strand down each pilaster. The loops dip only 2 cm into
# the opening (lowest point 1.88 m; the murti's top is at 1.46 m), and nothing hangs in front of
# the murti. Front of the flowers at model z 0.99, inside the obstacle (1.0).
for key, h in (("marigold", "#e07b1a"), ("marigoldDeep", "#c95a1b"), ("marigoldYellow", "#e9a82a")):
    PAL[key] = hexcol(h)
bm.verts.index_update()
GARLAND_V0 = len(bm.verts)
BEAD_R = 0.038
G_HOOK = 1.98  # on the lintel's face (1.90 ... 2.04 m)
G_SAG = 0.10
G_HOOKS = [-0.935, 0.0, 0.935]  # over the pilasters and the middle of the lintel
G_FRONT = FZ1 + 0.02 + BEAD_R + 0.01  # the lintel's face is at 0.90
G_END = 1.64
G_BANDS = ["marigold", "marigoldYellow", "marigoldDeep", "marigoldYellow"]


def bead(p, color):
    """One marigold head: a six-sided double cone (12 triangles, as on the main shrine),
    smooth-shaded so it reads round, turned and sized a little at random."""
    s = BEAD_R * random.uniform(0.88, 1.1)
    turn = random.uniform(0, math.pi / 3)
    ring = [bm.verts.new((p.x + s * math.cos(turn + i * math.pi / 3), p.y + s * math.sin(turn + i * math.pi / 3),
                          p.z)) for i in range(6)]
    top = bm.verts.new((p.x, p.y, p.z + 0.78 * s))
    bot = bm.verts.new((p.x, p.y, p.z - 0.7 * s))
    faces = [bm.faces.new([ring[i], ring[(i + 1) % 6], top]) for i in range(6)]
    faces += [bm.faces.new([ring[(i + 1) % 6], ring[i], bot]) for i in range(6)]
    paint(faces, tuple(v * random.uniform(0.93, 1.05) for v in PAL[color]), 0.0)


def beads_along(points, spacing, colors, band=5):
    """Beads every `spacing` metres along a polyline of Blender points, in coloured bands."""
    out, carry = [], 0.0
    for a, b in zip(points, points[1:]):
        seg = (b - a).length
        t = carry
        while t <= seg:
            out.append(a.lerp(b, t / seg))
            t += spacing
        carry = t - seg
    for i, p in enumerate(out):
        bead(p, colors[(i // band) % len(colors)])
    return len(out)


g_count = 0
for x0, x1 in zip(G_HOOKS, G_HOOKS[1:]):
    pts = [Vector(L(x0 + (x1 - x0) * i / 40, G_HOOK - G_SAG * 4 * (i / 40) * (1 - i / 40), G_FRONT))
           for i in range(41)]
    g_count += beads_along(pts, 0.072, G_BANDS, band=4)
for x in (G_HOOKS[0], G_HOOKS[-1]):
    pts = [Vector(L(x, G_HOOK - 0.035, G_FRONT)), Vector(L(x, G_END, G_FRONT))]
    g_count += beads_along(pts, 0.072, ["marigold", "marigold", "marigoldYellow"], band=3)
print(f"garland: {g_count} marigolds")

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
mesh.shade_smooth()
mesh.set_sharp_from_angle(angle=math.radians(35))
# The flowers are rounded: no hard edges on them.
sharp = mesh.attributes.get("sharp_edge")
if sharp:
    for e in mesh.edges:
        if e.vertices[0] >= GARLAND_V0 and e.vertices[1] >= GARLAND_V0:
            sharp.data[e.index].value = False

mat =bpy.data.materials.get("ganesha-shrine-stone") or bpy.data.materials.new("ganesha-shrine-stone")
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
obj.location = (-12.0, -8.0, 0.0)  # away from the other models while working; not exported

tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
xs = [v.co.x for v in mesh.vertices]
ys = [v.co.y for v in mesh.vertices]
zs = [v.co.z for v in mesh.vertices]
print(f"{NAME}: {tris} triangles, x {min(xs):.3f}..{max(xs):.3f}, z {-max(ys):.3f}..{-min(ys):.3f}, "
      f"height {min(zs):.3f}..{max(zs):.3f}")
if tris > 2_000:
    print("WARNING: over the Lite target (2,000); the Lite build will simplify and drop flowers")

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
