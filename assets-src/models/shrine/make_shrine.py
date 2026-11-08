"""
Sannidhi shrine, the `shrine` slot in spec 11: the garbhagriha, antarala and shikhara, with the
amalaka, kalasha and the somasutra spout. Made for Sannidhi by Claude (AI) in Blender 5.2 by this
script, so the model is "ai": true and disclosed in the credits.

Run inside Blender (Scripting tab, or the MCP connector):
    path = r"<repo>/assets-src/models/shrine/make_shrine.py"
    exec(compile(open(path, encoding="utf-8").read(), path, "exec"), {"__file__": path})
It replaces any earlier "shrine" object and, if EXPORT is set, writes shrine.glb.

Frame: Blender metres, z up. The origin is the slot's: world (0, 0, 1.26) in spec 02's layout, and
-y is the front (glTF +z, the world's +z, towards the mandapa). The script works in world
coordinates and converts with B(): Blender (x, y, z) = (world x, 1.26 - world z, world y).

Lines up with packages/protocol/src/world.ts and apps/web/src/scene/ground.ts (spec 11: the
walking rules don't change with the model, so the model follows them):
- Garbhagriha 5.2 m square (GARBHAGRIHA, x and z -2.6 ... 2.6). Below 3.3 m nothing reaches past
  it, so nothing juts into the walkway beside the shrine; the bands and cornice above head height
  reach 2.78 m. Everything stays inside the camera's sanctum box (2.9 m), up to 16.1 m.
- Pancharatha plan: corner (karna), recessed (pratiratha) and central (bhadra) offsets on every
  side, carried up from the moulded base through the wall to the tower.
- Door 1.5 m wide (SANCTUM_DOOR) in the east wall, from the floor at 0.45 m to 2.85 m
  (HEIGHTS.doorTop), in a stepped stone frame with a plain dark wooden inner frame and a raised
  threshold. No figure on the lintel or jambs.
- Hollow, empty sanctum: inner walls at 2.2 m, a dark floor with its top at 0.465 m (where the
  linga slot stands) and a dark ceiling at 4.3 m. Nothing inside: the linga, its lamps and the
  sanctum light stay in their own slot and in code.
- Wall top at 4.5 m (HEIGHTS.shrineWall) under a cornice to 4.7 m; a curved (rekha) shikhara
  with seven storeys marked by ribbed corner stones (bhumi-amalakas) to its shoulder at 14.25 m;
  the neck, a ribbed amalaka, and a brass kalasha whose tip is at exactly 16.1 m
  (HEIGHTS.shikharaTop).
- Antarala (ANTARALA, z 2.6 ... 5): floor at 0.45 m with the paler aisle stone on the Nandi axis,
  moulded plinth sides inside the plinth-edge obstacles (x out to 2.92 m, the strip ends at 3 m),
  low walls to 1.05 m between pilasters, beams, and a roof slab from 3.7 to 4.0 m
  (HEIGHTS.antaralaRoof). Nothing below 3.7 m between x -2.6 and 2.6, so the darshan view stays
  clear. Above the roof, a plain gabled front (sukanasa) with a blank horseshoe arch.
- The somasutra spout on the north wall at z 0, a plain stone trough over the start of the
  channel, and a catch stone below it with the channel's profile up to x 3.45 m, where the
  channel in code begins.
- Marigold garlands: on the door frame, two loops across the lintel, under its cap, lowest at
  2.93 m (above the opening), and a strand down each outer jamb to 1.85 m; and four strands flat
  against the front wall beside the door. Nothing in the doorway or on the axis. The total stays under 22,500 triangles (the Lite target),
  so the Lite build keeps every flower.
No carved figures or sacred symbols anywhere. One material with vertex colours: one draw call.
"""
import math
import os
import random

import bmesh
import bpy
from mathutils import Vector

EXPORT = True
NAME = "shrine"
HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else None
OZ = 1.26  # world z of the slot origin

random.seed(21)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexcol(h):
    h = h.lstrip("#")
    return tuple(srgb_to_linear(int(h[i : i + 2], 16) / 255) for i in (0, 2, 4))


# The greybox palette (greybox.ts COLOURS), with a few in-between stones.
PAL = {
    "plinth": hexcol("#7d7366"),
    "moulding": hexcol("#6b6256"),
    "stone": hexcol("#8b8070"),
    "stoneDark": hexcol("#71675a"),
    "shikhara": hexcol("#867b6b"),
    "shikharaDark": hexcol("#6e6457"),
    "interior": hexcol("#2f2a25"),
    "sanctumFloor": hexcol("#3e3832"),
    "floor": hexcol("#8a8172"),
    "aisle": hexcol("#a59c8c"),
    "ceiling": hexcol("#5f574c"),
    "woodDark": hexcol("#4f3725"),
    "brass": hexcol("#b08d3c"),
    "groove": hexcol("#34342f"),
    "channel": hexcol("#6e695f"),
    "arch": hexcol("#5a5247"),
    "moss": hexcol("#5b6142"),
}

bm = bmesh.new()
COL = bm.loops.layers.float_color.new("Col")
NO_WEATHER = set()  # faces with their own baked shading


def B(x, y, z):
    """World point (y up, z east) to Blender."""
    return (x, OZ - z, y)


def BD(dx, dy, dz):
    """World direction to Blender."""
    return Vector((dx, -dz, dy))


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


def face(pts, want, color, jitter=0.04, weather=True):
    """One face from world points, turned so its normal points along `want` (a world direction)."""
    f = bm.faces.new([bm.verts.new(B(*p)) for p in pts])
    f.normal_update()
    if f.normal.dot(BD(*want)) < 0:
        f.normal_flip()
    paint([f], color, jitter)
    if not weather:
        NO_WEATHER.add(f)
    return f


def loft(rings, colors, cap_bottom=False, cap_top=False, jitter=0.04, each=True, skip=None):
    """Join rings of Blender points (same count, counter-clockwise from above) with quads.
    `colors` is one colour for everything, or one per segment. `skip(s, i)` leaves out the face
    from point i to i + 1 in segment s."""
    vr = [[bm.verts.new(p) for p in r] for r in rings]
    n = len(rings[0])
    per = colors if isinstance(colors, list) else [colors] * (len(rings) - 1)
    faces = []
    for s, (a, b) in enumerate(zip(vr, vr[1:])):
        seg = []
        for i in range(n):
            if skip and skip(s, i):
                continue
            seg.append(bm.faces.new([a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]]))
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


def rect_ring_w(x0, x1, z0, z1, y):
    b0, b1 = OZ - z1, OZ - z0
    return [(x0, b0, y), (x1, b0, y), (x1, b1, y), (x0, b1, y)]


def box_w(x0, x1, y0, y1, z0, z1, color, **kw):
    """An axis-aligned box given in world coordinates (y up)."""
    return loft([rect_ring_w(x0, x1, z0, z1, y0), rect_ring_w(x0, x1, z0, z1, y1)], color,
                cap_bottom=kw.pop("cap_bottom", True), cap_top=kw.pop("cap_top", True), **kw)


def circle_ring(cx, cz, r, y, n, rib=1.0, phase=0.0):
    """Blender ring about world (cx, cz); every other point pulled in to `rib` for ribs."""
    return [(cx + r * (rib if k % 2 else 1.0) * math.cos(phase + 2 * math.pi * k / n),
             OZ - cz + r * (rib if k % 2 else 1.0) * math.sin(phase + 2 * math.pi * k / n), y)
            for k in range(n)]


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
FLOOR = PLINTH + 0.015  # sanctum floor top, where the linga slot stands
G = 2.6  # GARBHAGRIHA half size
INNER = 2.2  # inner wall faces
DOOR = 0.75  # SANCTUM_DOOR.halfWidth
DOOR_TOP = PLINTH + 2.4
WALL_TOP = 4.5
SH0, SH1 = 4.7, 14.25  # shikhara from the cornice top to its shoulder
TOP = 16.1

# --- Plan: pancharatha rings ------------------------------------------------------------------------
# Plan coordinates (u, v) = (world x, -world z), so a ring counter-clockwise in (u, v) is
# counter-clockwise from above in Blender: Blender (x, y) = (u, OZ + v). Side 0 is v = +H (the
# west, back), side 1 the south, side 2 the east front with the door, side 3 the north.
# A ring is set by the faces of the corner (Hk), recessed (Hp) and central (Hb) projections and
# the u of the corner's inner edge (ek) and the centre's edge (eb).


def rot(p, k):
    u, v = p
    for _ in range(k):
        u, v = -v, u
    return (u, v)


def side_pts(Hk, Hp, Hb, ek, eb, mid=False):
    pts = [(Hk, Hk), (ek, Hk), (ek, Hp), (eb, Hp), (eb, Hb)]
    if mid:
        pts.append((0.0, Hb))
    return pts + [(-eb, Hb), (-eb, Hp), (-ek, Hp), (-ek, Hk)]


def ring_uv(plan, mid=False):
    p = side_pts(*plan, mid=mid)
    return [rot(q, k) for k in range(4) for q in p]


def offset(plan, o):
    """Move every face of the plan out by o (in by -o)."""
    Hk, Hp, Hb, ek, eb = plan
    return (Hk + o, Hp + o, Hb + o, ek - o, eb + o)


def ring_b(uv, y):
    return [(u, OZ + v, y) for u, v in uv]


def door_ring(plan):
    """The wall ring, with two points at the door's edges on the east side. The last face (from
    the last point back to the first) spans the doorway."""
    base = ring_uv(plan)  # 9 points a side; (-eb, -Hb) is 22 and (eb, -Hb) is 23
    Hb = plan[2]
    return [(DOOR, -Hb)] + base[23:] + base[:23] + [(-DOOR, -Hb)]


WALL_PLAN = (G, G - 0.13, G, 1.9, 1.1)

# --- Garbhagriha walls: moulded base, wall in courses, a band, the cornice -------------------------
# (offset from WALL_PLAN, height). The base keeps inside the 2.6 m square; the band and cornice
# above head height come out to 2.66 and 2.78 m.
E = [
    (0.0, 0.0), (0.0, 0.10), (-0.03, 0.13), (-0.03, 0.20),  # foot (khura)
    (0.0, 0.25), (0.0, 0.35), (-0.04, 0.41), (-0.08, 0.45),  # pot (kumbha)
    (-0.08, 0.52), (-0.02, 0.56), (-0.02, 0.66), (-0.06, 0.70),  # cushion (kalasha)
    (-0.10, 0.72), (-0.10, 0.80), (-0.04, 0.83), (-0.02, 0.90), (-0.08, 0.96),  # small eave
    (-0.12, 0.98), (-0.12, 1.04), (-0.07, 1.07), (-0.07, 1.13), (-0.12, 1.16),  # top band
]
JW = -0.12  # the wall face
for y in (1.50, 1.85, 2.20, 2.50, DOOR_TOP, 3.10):
    E += [(JW, y), (JW - 0.012, y), (JW, y + 0.015)]
E += [(JW, 3.30), (0.04, 3.33), (0.06, 3.36), (0.06, 3.43), (0.0, 3.47), (JW, 3.50)]  # band
E += [(JW, 3.90), (JW - 0.012, 3.90), (JW, 3.915), (JW, 4.30)]
E += [(0.0, 4.33), (0.0, 4.39), (0.18, 4.46), (0.18, 4.60), (0.10, 4.65), (0.06, SH0)]  # cornice


def wall_colour(o, y0, y1):
    m = (y0 + y1) / 2
    if m < PLINTH:
        return "plinth"
    if m < 1.16:
        return "moulding" if o < -0.05 else "plinth"
    if m < 3.30 or 3.5 < m < 4.30:
        return "stoneDark" if o < JW - 0.005 else "stone"
    return "stoneDark"


rings = [ring_b(door_ring(offset(WALL_PLAN, o)), y) for o, y in E]
n_door = len(rings[0])
cols = [wall_colour(min(E[s][0], E[s + 1][0]), E[s][1], E[s + 1][1]) for s in range(len(E) - 1)]
loft(rings, cols, cap_top=True, jitter=0.05,
     skip=lambda s, i: i == n_door - 1 and E[s][1] >= PLINTH - 1e-6 and E[s + 1][1] <= DOOR_TOP + 1e-6)


def o_at(y):
    """The wall's offset at height y (the first ring at that height)."""
    for (o0, y0), (o1, y1) in zip(E, E[1:]):
        if y0 <= y <= y1:
            return o0 if y1 == y0 else o0 + (o1 - o0) * (y - y0) / (y1 - y0)
    return 0.0


# Door reveals and soffit: from the outer face to the inner wall face.
door_e = [(o, y) for o, y in E if PLINTH <= y <= DOOR_TOP]
for s in (1, -1):
    for (oa, ya), (ob, yb) in zip(door_e, door_e[1:]):
        if yb - ya < 1e-6:
            continue
        za, zb = G + oa, G + ob
        face([(s * DOOR, ya, za), (s * DOOR, yb, zb), (s * DOOR, yb, INNER), (s * DOOR, ya, INNER)],
             (-s, 0, 0), "stoneDark", 0.03)
face([(-DOOR, DOOR_TOP, INNER), (DOOR, DOOR_TOP, INNER), (DOOR, DOOR_TOP, G + JW),
      (-DOOR, DOOR_TOP, G + JW)], (0, -1, 0), "stoneDark", 0.03)

# Framed blank panels on the north, west and south centres: pilasters, sill, lintel, a small eave.


def side_box(k, t0, t1, n0, n1, y0, y1, color, **kw):
    """A box in side k's frame: t along the side, n outward from the centre."""
    a, b = rot((t0, n0), k), rot((t1, n1), k)
    u0, u1 = sorted((a[0], b[0]))
    v0, v1 = sorted((a[1], b[1]))
    return box_w(u0, u1, y0, y1, -v1, -v0, color, **kw)


face_n = G + JW  # the centre's wall face
for k in (0, 1, 3):
    for s in (1, -1):
        t0, t1 = sorted((s * 0.80, s * 0.96))
        side_box(k, t0, t1, face_n - 0.02, face_n + 0.035, 1.16, 2.98, "stone", cap_bottom=False)
    side_box(k, -0.96, 0.96, face_n - 0.02, face_n + 0.04, 1.16, 1.28, "stoneDark", cap_bottom=False)
    side_box(k, -0.96, 0.96, face_n - 0.02, face_n + 0.04, 2.84, 2.98, "stoneDark")
    side_box(k, -1.02, 1.02, face_n - 0.02, face_n + 0.11, 2.98, 3.06, "stoneDark")

# --- Inside: dark lining, floor and ceiling ---------------------------------------------------------
for i in range(4):
    for j in range(4):
        x0, x1 = -INNER + 1.1 * i, -INNER + 1.1 * (i + 1)
        z0, z1 = -INNER + 1.1 * j, -INNER + 1.1 * (j + 1)
        face([(x0, FLOOR, z0), (x1, FLOOR, z0), (x1, FLOOR, z1), (x0, FLOOR, z1)], (0, 1, 0),
             "sanctumFloor", 0.06, weather=False)
CEIL_IN = 4.3
face([(-INNER, FLOOR, -INNER), (INNER, FLOOR, -INNER), (INNER, CEIL_IN, -INNER), (-INNER, CEIL_IN, -INNER)],
     (0, 0, 1), "interior", 0.02, weather=False)
for s in (1, -1):
    face([(s * INNER, FLOOR, -INNER), (s * INNER, FLOOR, INNER), (s * INNER, CEIL_IN, INNER),
          (s * INNER, CEIL_IN, -INNER)], (-s, 0, 0), "interior", 0.02, weather=False)
    face([(s * DOOR, FLOOR, INNER), (s * INNER, FLOOR, INNER), (s * INNER, CEIL_IN, INNER),
          (s * DOOR, CEIL_IN, INNER)], (0, 0, -1), "interior", 0.02, weather=False)
face([(-DOOR, DOOR_TOP, INNER), (DOOR, DOOR_TOP, INNER), (DOOR, CEIL_IN, INNER), (-DOOR, CEIL_IN, INNER)],
     (0, 0, -1), "interior", 0.02, weather=False)
face([(-INNER, CEIL_IN, -INNER), (INNER, CEIL_IN, -INNER), (INNER, CEIL_IN, INNER), (-INNER, CEIL_IN, INNER)],
     (0, -1, 0), "interior", 0.02, weather=False)

# --- Door: threshold, half-moon step, stepped stone frame with a dark wooden inner frame ------------
box_w(-DOOR, DOOR, PLINTH, PLINTH + 0.09, INNER, 2.74, "stoneDark", cap_bottom=False, jitter=0.02)
moon = [(0.5 * math.cos(math.pi * k / 12), 2.74 + 0.5 * math.sin(math.pi * k / 12)) for k in range(13)]
face([(x, PLINTH + 0.02, z) for x, z in moon], (0, 1, 0), "stoneDark", 0.02)
for (xa, za), (xb, zb) in zip(moon, moon[1:]):
    face([(xa, PLINTH, za), (xb, PLINTH, zb), (xb, PLINTH + 0.02, zb), (xa, PLINTH + 0.02, za)],
         ((xa + xb) / 2, 0, (za + zb) / 2 - 2.74), "stoneDark", 0.02)
FZ = 2.30  # the frame's back, inside the wall
for s in (1, -1):
    def jamb(a, b, y0, y1, z1, color):
        x0, x1 = sorted((s * a, s * b))
        box_w(x0, x1, y0, y1, FZ, z1, color, cap_bottom=False, jitter=0.03)
    jamb(DOOR, 1.14, PLINTH, 0.72, 2.74, "stoneDark")  # foot blocks
    jamb(0.98, 1.10, 0.72, 3.04, 2.64, "stone")
    jamb(0.87, 0.98, 0.72, 2.95, 2.68, "stoneDark")
    jamb(DOOR - 0.01, 0.87, 0.72, DOOR_TOP - 0.01, 2.71, "woodDark")
box_w(-1.10, 1.10, 3.04, 3.14, FZ, 2.64, "stone", cap_bottom=False)
box_w(-0.98, 0.98, 2.95, 3.04, FZ, 2.68, "stoneDark")
box_w(-0.87, 0.87, DOOR_TOP - 0.01, 2.95, FZ, 2.71, "woodDark")
box_w(-1.22, 1.22, 3.14, 3.22, FZ, 2.76, "stoneDark")
box_w(-1.16, 1.16, 3.22, 3.27, FZ, 2.70, "stone", cap_bottom=False)

# --- Shikhara: rekha curve in courses, seven storeys marked by ribbed corner stones ---------------


def S_of(y):
    t = min(1.0, max(0.0, (y - SH0) / (SH1 - SH0)))
    return 2.62 - 1.8 * t ** 1.9


def sh_plan(y, o=0.0):
    S = S_of(y)
    r = S / 2.62
    return offset((S, S - 0.22 * r, S + 0.08 * r, 0.72 * S, 0.38 * S), o)


N_COURSE = 35
CH = (SH1 - SH0) / N_COURSE
sh_rings, sh_cols = [], []
for i in range(N_COURSE):
    y = SH0 + i * CH
    sh_rings += [ring_b(ring_uv(sh_plan(y, -0.022), mid=True), y),
                 ring_b(ring_uv(sh_plan(y + 0.03), mid=True), y + 0.03)]
    sh_cols += ["shikharaDark", "shikhara"]
# Shoulder (skandha): a plain slab on the last course.
top_plan = sh_plan(SH1)
for o, y in ((0.0, SH1), (0.05, SH1 + 0.02), (0.05, SH1 + 0.11)):
    sh_rings.append(ring_b(ring_uv(offset(top_plan, o), mid=True), y))
sh_cols += ["shikhara", "stoneDark", "stoneDark"]
sh_cols = sh_cols[: len(sh_rings) - 1]
loft(sh_rings, sh_cols, cap_top=True, jitter=0.05)


def squircle(cu, cv, a, y, n=20, p=5.0, rib=1.0):
    pts = []
    for k in range(n):
        t = 2 * math.pi * k / n + math.pi / n
        c, s = math.cos(t), math.sin(t)
        rr = rib if k % 2 else 1.0
        pts.append((cu + rr * a * math.copysign(abs(c) ** (2 / p), c),
                    OZ + cv + rr * a * math.copysign(abs(s) ** (2 / p), s), y))
    return pts


# Bhumi-amalakas: a ribbed cushion on each corner at the top course of every storey.
CUSHION = [(-0.5, 0.97, 1.0), (-0.36, 1.22, 0.92), (-0.12, 1.4, 0.92), (0.12, 1.4, 0.92), (0.36, 1.22, 0.92),
           (0.5, 0.97, 1.0)]
for i in range(4, N_COURSE, 5):
    cy = SH0 + (i + 0.5) * CH
    Hk, _, _, ek, _ = sh_plan(cy)
    a0 = (Hk - ek) / 2
    c = (Hk + ek) / 2
    for cu, cv in ((c, c), (-c, c), (-c, -c), (c, -c)):
        loft([squircle(cu, cv, a0 * sc, cy + f * CH, rib=rb) for f, sc, rb in CUSHION], "stone",
             jitter=0.03, each=False)

# Neck, ribbed amalaka, its crown disc and the brass kalasha (tip at exactly 16.1 m).
y0 = SH1 + 0.11
loft([circle_ring(0, 0, 0.70, y0, 24), circle_ring(0, 0, 0.70, y0 + 0.11, 24)], "stoneDark", jitter=0.02)
AM = [(0.70, 0.0), (1.0, 0.05), (1.22, 0.15), (1.32, 0.31), (1.22, 0.47), (1.0, 0.57), (0.62, 0.62)]
ya = y0 + 0.11
loft([circle_ring(0, 0, r, ya + h, 40, rib=(0.92 if 0 < j < len(AM) - 1 else 1.0)) for j, (r, h) in enumerate(AM)],
     "stone", cap_top=False, jitter=0.02, each=False)
yc = ya + AM[-1][1]
loft([circle_ring(0, 0, 0.62, yc, 24), circle_ring(0, 0, 0.57, yc + 0.04, 24),
      circle_ring(0, 0, 0.48, yc + 0.07, 24)], "stoneDark", cap_top=True, jitter=0.02)
KAL = [(0.2, 0), (0.36, 0.1), (0.42, 0.26), (0.32, 0.42), (0.13, 0.52), (0.17, 0.6), (0.06, 0.86),
       (0.001, 1.0)]
yk = yc + 0.07
ks = (TOP - yk) / 1.0
brass = loft([circle_ring(0, 0, r * ks, yk + h * ks, 20) for r, h in KAL], "brass", jitter=0.0)
NO_WEATHER.update(brass)

# --- Antarala -------------------------------------------------------------------------------------
AZ0, AZ1 = 2.6, 5.0
# Plinth sides: the mandapa's moulding, within the plinth-edge strips (x 2.6 ... 3).
PROFILE = [
    (0.32, 0.0), (0.32, 0.07), (0.26, 0.10), (0.24, 0.13), (0.25, 0.17), (0.24, 0.21),
    (0.19, 0.25), (0.11, 0.27), (0.07, 0.28), (0.07, 0.32), (0.17, 0.355), (0.19, 0.38),
    (0.12, 0.395), (0.06, 0.40), (0.06, 0.43), (0.0, PLINTH),
]
for s in (1, -1):
    pts = [(s * G, 0.0)] + [(s * (G + o), y) for o, y in PROFILE]
    if s < 0:
        pts = list(reversed(pts))
    extrude_y(pts, OZ - AZ1, OZ - AZ0, "plinth", jitter=0.03)
# Floor slabs, the aisle paler; the back strip runs under the sanctum wall's base.
fx = [-G, -2.0, -1.2, -0.4, 0.4, 1.2, 2.0, G]
fz = [2.36, AZ0, 3.4, 4.2, AZ1]
for j in range(len(fz) - 1):
    for i in range(len(fx) - 1):
        cx = (fx[i] + fx[i + 1]) / 2
        face([(fx[i], PLINTH, fz[j]), (fx[i + 1], PLINTH, fz[j]), (fx[i + 1], PLINTH, fz[j + 1]),
              (fx[i], PLINTH, fz[j + 1])], (0, 1, 0), "aisle" if abs(cx) < 1.2 else "floor", 0.05,
             weather=False)
# Low walls between the pilasters (the mandapa's wall profile), inner face at x 2.6.
WALL = [(0.0, PLINTH), (0.22, PLINTH), (0.22, 0.52), (0.18, 0.55), (0.18, 0.95), (0.24, 0.98),
        (0.24, 1.05), (-0.02, 1.05), (-0.02, 0.98), (0.04, 0.95), (0.04, 0.55), (0.0, 0.52)]
for s in (1, -1):
    pts = [(s * (G + u), v) for u, v in WALL]
    if s < 0:
        pts = list(reversed(pts))
    extrude_y(pts, OZ - 4.65, OZ - 2.95, "plinth", jitter=0.04)
# Pilasters at both ends of each side, a beam on them, then the roof slab.
PIL = [(0.02, PLINTH), (0.02, 0.58), (-0.01, 0.62), (-0.01, 3.15), (0.02, 3.20), (0.02, 3.27),
       (0.04, 3.32), (0.04, 3.45)]
for s in (1, -1):
    x0, x1 = sorted((s * G, s * 2.92))
    for z0, z1 in ((AZ0, 2.95), (4.65, AZ1)):
        loft([rect_ring_w(x0 - o, x1 + o, z0 - o, z1 + o, y) for o, y in PIL],
             ["stoneDark", "stoneDark", "stone", "stoneDark", "stoneDark", "stoneDark", "stoneDark"])
    box_w(x0 - 0.02, x1 + 0.02, 3.45, 3.70, 2.45, AZ1 + 0.04, "stoneDark", jitter=0.02)
RZ1 = 5.15
loft([rect_ring_w(-2.96, 2.96, 2.45, RZ1, 3.70), rect_ring_w(-2.96, 2.96, 2.45, RZ1, 3.84),
      rect_ring_w(-2.99, 2.99, 2.45, RZ1 + 0.03, 3.88), rect_ring_w(-2.99, 2.99, 2.45, RZ1 + 0.03, 3.94),
      rect_ring_w(-2.93, 2.93, 2.45, RZ1 - 0.03, 4.0)],
     ["stoneDark", "stoneDark", "stoneDark", "stone"], cap_top=True, jitter=0.02)
face([(-2.96, 3.70, 2.45), (2.96, 3.70, 2.45), (2.96, 3.70, RZ1), (-2.96, 3.70, RZ1)], (0, -1, 0),
     "ceiling", 0.02)

# Sukanasa: a plain gabled front on the tower over the antarala, with a blank horseshoe arch.
box_w(-1.45, 1.45, 4.0, 4.58, 2.5, 3.78, "stoneDark", cap_bottom=False, jitter=0.03)
box_w(-1.52, 1.52, 4.58, SH0, 2.5, 3.86, "stoneDark", cap_bottom=False, jitter=0.03)
OUT = [(-1.3, SH0), (1.3, SH0), (1.3, 6.2), (1.15, 6.9), (0.85, 7.5), (0.45, 8.0), (0.0, 8.3),
       (-0.45, 8.0), (-0.85, 7.5), (-1.15, 6.9), (-1.3, 6.2)]
ZBACK = 1.9


def zf(y):
    return 3.55 - (y - SH0) * 0.25


face([(x, y, zf(y)) for x, y in OUT], (0, 0.2, 1), "shikhara", 0.03)
for (xa, ya_), (xb, yb) in zip(OUT[1:], OUT[2:] + OUT[:1]):
    nx, ny = yb - ya_, -(xb - xa)
    face([(xa, ya_, ZBACK), (xb, yb, ZBACK), (xb, yb, zf(yb)), (xa, ya_, zf(ya_))], (nx, ny, 0),
         "shikhara", 0.04)
# The arch: a raised band (legs and a horseshoe arc) on the front, a darker panel inside.
AC, AR, AW, AD = 6.35, 0.78, 0.075, 0.06
path = [((-AR * 0.945, 4.95), (-1.0, 0.0))]
for k in range(19):
    a = math.radians(199 - 238 * k / 18)
    path.append(((AR * math.cos(a), AC + AR * math.sin(a)), (math.cos(a), math.sin(a))))
path.append(((AR * 0.945, 4.95), (1.0, 0.0)))
path[0] = ((path[1][0][0], 4.95), (-1.0, 0.0))
path[-1] = ((path[-2][0][0], 4.95), (1.0, 0.0))
outer = [(c[0] + AW * n[0], c[1] + AW * n[1]) for c, n in path]
inner = [(c[0] - AW * n[0], c[1] - AW * n[1]) for c, n in path]
for k in range(len(path) - 1):
    (oa, ob), (ia, ib) = (outer[k], outer[k + 1]), (inner[k], inner[k + 1])
    face([(ia[0], ia[1], zf(ia[1]) + AD), (ib[0], ib[1], zf(ib[1]) + AD), (ob[0], ob[1], zf(ob[1]) + AD),
          (oa[0], oa[1], zf(oa[1]) + AD)], (0, 0.2, 1), "stone", 0.03)
    n = path[k][1]
    face([(oa[0], oa[1], zf(oa[1])), (ob[0], ob[1], zf(ob[1])), (ob[0], ob[1], zf(ob[1]) + AD),
          (oa[0], oa[1], zf(oa[1]) + AD)], (n[0], n[1], 0), "stoneDark", 0.03)
    face([(ia[0], ia[1], zf(ia[1])), (ib[0], ib[1], zf(ib[1])), (ib[0], ib[1], zf(ib[1]) + AD),
          (ia[0], ia[1], zf(ia[1]) + AD)], (-n[0], -n[1], 0), "stoneDark", 0.03)
face([(p[0], p[1], zf(p[1]) + 0.012) for p in reversed(inner)], (0, 0.2, 1), "arch", 0.02)

# --- Somasutra spout on the north wall, over a catch stone that leads into the channel ------------
c = OZ  # Blender y of world z 0
spout = [(c - 0.11, 0.50), (c + 0.11, 0.50), (c + 0.11, 0.62), (c + 0.05, 0.62), (c + 0.05, 0.57),
         (c - 0.05, 0.57), (c - 0.05, 0.62), (c - 0.11, 0.62)]
extrude_x(spout, 2.40, 3.38, "stoneDark", jitter=0.03)
catch = [(c - 0.3, 0.0), (c + 0.3, 0.0), (c + 0.3, 0.1), (c + 0.13, 0.1), (c + 0.13, 0.03),
         (c - 0.13, 0.03), (c - 0.13, 0.1), (c - 0.3, 0.1)]
extrude_x(catch, 2.55, 3.45, "channel", jitter=0.03)

# --- Weathering: damp at the foot, darker undersides, moss on ledges, lichen on the tower --------
bm.normal_update()
moss = PAL["moss"]
for f in bm.faces:
    if f in NO_WEATHER:
        continue
    n = f.normal
    cc = f.calc_center_median()
    wz = OZ - cc.y  # world z
    shady = cc.x > 0.5 or wz < -0.5  # north and west faces
    k = 1.0
    if n.z < -0.5:
        k *= 0.8
    if cc.z < 0.6:
        k *= 0.8 + 0.2 * (cc.z / 0.6)
    if 3.5 < cc.z < 4.3 and abs(n.z) < 0.3:
        k *= 0.94  # rain runs off the cornice
    if SH0 < cc.z < SH1:
        k *= 1.0 - 0.07 * (cc.z - SH0) / (SH1 - SH0)
    mix = 0.0
    if n.z > 0.55 and 0.3 < cc.z < SH1 + 0.2 and random.random() < (0.8 if shady else 0.45):
        mix = 0.2
    elif SH0 < cc.z < SH1 and abs(n.z) < 0.7 and random.random() < (0.22 if shady else 0.08):
        mix = 0.12
    elif cc.z < 0.5 and shady and random.random() < 0.5:
        mix = 0.1
    if k == 1.0 and mix == 0.0:
        continue
    for loop in f.loops:
        r, g, b, a = loop[COL]
        r, g, b = (r * (1 - mix) + moss[0] * mix, g * (1 - mix) + moss[1] * mix, b * (1 - mix) + moss[2] * mix)
        loop[COL] = (r * k, g * k, b * k, a)

# --- Marigold garlands (after weathering, so the flowers stay bright) ------------------------------
# On the sanctum door: two loops across the door's lintel, hung just under its projecting cap, and a
# strand down each outer jamb. Nothing hangs in the doorway or on the axis: the loops' lowest point
# (2.93 m) is above the opening (2.85 m), so the darshan view of the linga stays clear. All of it is
# in front of the frame (world z 2.65 ... 2.82), inside the camera's sanctum box and the Nandi-axis
# strip. On the front wall, four more strands hang flat against the wall on either side of the
# door. Each flower is a 12-triangle double cone, so the whole model stays well under the Lite
# target (half the slot's 45,000) and the Lite build keeps every flower.
for key, h in (("marigold", "#e07b1a"), ("marigoldDeep", "#c95a1b"), ("marigoldYellow", "#e9a82a")):
    PAL[key] = hexcol(h)
bm.verts.index_update()
GARLAND_V0 = len(bm.verts)
BEAD_R = 0.048
G_HOOK = 3.08  # under the cap (3.14 m)
G_SAG = 0.15
G_HOOKS = [-1.04, 0.0, 1.04]  # over the outer jambs and the middle of the lintel
G_FRONT = 2.71 + BEAD_R + 0.01  # in front of the wooden inner frame, the frame's most forward face
G_JAMB = 2.64 + BEAD_R + 0.012  # the strands, against the outer jambs
G_END = 1.85  # where the strands end
G_BANDS = ["marigold", "marigoldYellow", "marigoldDeep", "marigoldYellow"]


def bead(p, color, r=BEAD_R):
    """One marigold head: a six-sided double cone (12 triangles), smooth-shaded so it reads round,
    turned and sized a little at random."""
    s = r * random.uniform(0.88, 1.1)
    turn = random.uniform(0, math.pi / 3)
    ring = [bm.verts.new((p.x + s * math.cos(turn + i * math.pi / 3), p.y + s * math.sin(turn + i * math.pi / 3),
                          p.z)) for i in range(6)]
    top = bm.verts.new((p.x, p.y, p.z + 0.78 * s))
    bot = bm.verts.new((p.x, p.y, p.z - 0.7 * s))
    faces = [bm.faces.new([ring[i], ring[(i + 1) % 6], top]) for i in range(6)]
    faces += [bm.faces.new([ring[(i + 1) % 6], ring[i], bot]) for i in range(6)]
    paint(faces, tuple(v * random.uniform(0.93, 1.05) for v in PAL[color]), 0.0)


def beads_along(points, spacing, colors, band=5, r=BEAD_R):
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
        bead(p, colors[(i // band) % len(colors)], r)
    return len(out)


g_count = 0
for x0, x1 in zip(G_HOOKS, G_HOOKS[1:]):
    pts = [Vector(B(x0 + (x1 - x0) * i / 40, G_HOOK - G_SAG * 4 * (i / 40) * (1 - i / 40), G_FRONT))
           for i in range(41)]
    g_count += beads_along(pts, 0.068, G_BANDS)
for x in (G_HOOKS[0], G_HOOKS[-1]):
    pts = [Vector(B(x, G_HOOK - 0.04, G_FRONT - 0.015)), Vector(B(x, G_HOOK - 0.3, G_JAMB)),
           Vector(B(x, G_END, G_JAMB))]
    g_count += beads_along(pts, 0.068, ["marigold", "marigold", "marigoldYellow"], band=3)

# Strands on the front wall, from under the band at 3.30 m: one in the middle of each recessed face
# (wall at z 2.35) and one on each corner face (wall at z 2.48). They hang against the wall, behind
# the door plane, so they never stand in the antarala or in anyone's way.
W_R, W_HOOK, W_END = 0.046, 3.26, 1.6
for s in (1, -1):
    for x, wall in ((1.56, G - 0.13 + JW), (2.25, G + JW)):
        z = wall + W_R + 0.012
        pts = [Vector(B(s * x, W_HOOK, z)), Vector(B(s * x, W_END, z))]
        g_count += beads_along(pts, 0.072, ["marigold", "marigoldYellow", "marigold", "marigoldDeep"],
                               band=4, r=W_R)
print(f"garlands: {g_count} marigolds")

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
# Round parts (cushions, amalaka, kalasha) shade smooth; anything sharper than 35 degrees stays crisp.
mesh.shade_smooth()
mesh.set_sharp_from_angle(angle=math.radians(35))
# The flowers are rounded: no hard edges on them.
sharp = mesh.attributes.get("sharp_edge")
if sharp:
    for e in mesh.edges:
        if e.vertices[0] >= GARLAND_V0 and e.vertices[1] >= GARLAND_V0:
            sharp.data[e.index].value = False

mat = bpy.data.materials.get("shrine-stone") or bpy.data.materials.new("shrine-stone")
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
obj.location = (0.0, 40.0 + 12.1 - OZ, 0.0)  # behind the mandapa as it sits in the scene; not exported

tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
xs = [v.co.x for v in mesh.vertices]
ys = [v.co.y for v in mesh.vertices]
zs = [v.co.z for v in mesh.vertices]
print(f"{NAME}: {tris} triangles, x {min(xs):.3f}..{max(xs):.3f}, world z {OZ - max(ys):.3f}..{OZ - min(ys):.3f}, "
      f"height {min(zs):.3f}..{max(zs):.3f}")
if tris > 22_500:
    print("WARNING: over the Lite target (22,500); the Lite build will simplify and drop flowers")

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
