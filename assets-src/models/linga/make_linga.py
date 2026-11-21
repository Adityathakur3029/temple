"""
Sannidhi Shiva linga, the `linga` slot in spec 11. TEST MODEL for the owner's computer only.

Spec 08 § Depiction: the linga is human-made in anything deployed. On 2026-11-08 the owner allowed
AI-made test models of the sacred forms on their own computer, to work out the size and
decoration to ask a human maker for. This model was made by Claude (AI) in Blender 5.2 with this
script, so its config says "ai": true and "interim": true, and `npm run deploy:web` refuses to
deploy while it is configured.

Run inside Blender (Scripting tab, or the MCP connector):
    path = r"<repo>/assets-src/models/linga/make_linga.py"
    exec(compile(open(path, encoding="utf-8").read(), path, "exec"), {"__file__": path})
It replaces any earlier "linga" object and, if EXPORT is set, writes linga.glb next to itself.

Frame: Blender metres, z up, origin at the bottom centre; -y is the front (glTF +z), which is
the spout. The slot turns it a quarter so the spout points north (+x), towards the somasutra.
The script works in the model's own frame (x across, y up, z to the front) and converts with
L(): Blender (x, y, z) = (x, -z, y).

The form (aniconic, plain dark stone; no face or eyes). The owner asked on 2026-11-21 to try the
tripundra (three white ash lines across the linga's face, toward the door), which spec 08 lists
as "check with advisor", default Off; a test model MAY try it. Set TRIPUNDRA = False to remove it.
- a square base slab 0.86 m across and 7.5 cm high, chamfered;
- a round pedestal with a moulded waist;
- the yoni pitha (jaladhari): a round basin with a raised rim and a narrower tongue to the front,
  the spout, with a groove that falls gently to its lip, 0.83 m from the centre;
- the linga: a smooth round shaft 0.31 m across with a tall rounded top, exactly 0.92 m
  above the floor (the slot's height, so fit is none);
- a few offerings: one bilva sprig (three leaflets) on the top, one on the door side above the
  tripundra (FACE_BILVA), two in the basin, and four
  small white flowers in the basin, none in the groove; a copper dharapatra on a brass tripod
  (DHARAPATRA, see below).
Old oiled stone in vertex colours: darker and wetter in the basin and groove. One material.
"""
import math
import os
import random

import bmesh
import bpy

EXPORT = True
NAME = "linga"
HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else None
TOP = 0.92

random.seed(11)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexcol(h):
    h = h.lstrip("#")
    return tuple(srgb_to_linear(int(h[i : i + 2], 16) / 255) for i in (0, 2, 4))


PAL = {
    "slab": hexcol("#3d3934"),
    "slabDust": hexcol("#4a453e"),
    "pitha": hexcol("#34302c"),
    "pithaShadow": hexcol("#2a2724"),
    "rim": hexcol("#3a3631"),
    "basin": hexcol("#262320"),
    "linga": hexcol("#2c2926"),
    "lingaTop": hexcol("#302d2a"),
    "bilva": hexcol("#4d6a28"),
    "bilvaBack": hexcol("#6a7f3e"),
    "flower": hexcol("#ebe6d6"),
    "flowerEye": hexcol("#d9a92b"),
}

bm = bmesh.new()
COL = bm.loops.layers.float_color.new("Col")


def L(x, y, z):
    return (x, -z, y)


def tone(color, jitter):
    base = PAL[color] if isinstance(color, str) else color
    k = 1 + random.uniform(-jitter, jitter)
    return tuple(min(1.0, v * k) for v in base)


def paint(faces, color, jitter=0.03):
    for f in faces:
        c = tone(color, jitter)
        for loop in f.loops:
            loop[COL] = (*c, 1.0)


def loft(rings, colors, cap_bottom=False, cap_top=None, jitter=0.03):
    """Join rings of model points (x, y, z), same count each, with quads. cap_top: None, "flat"
    or a centre point for a fan."""
    vr = [[bm.verts.new(L(*p)) for p in r] for r in rings]
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
    if cap_top == "flat":
        f = bm.faces.new(vr[-1])
        paint([f], per[-1], jitter)
    elif cap_top is not None:
        c = bm.verts.new(L(*cap_top))
        fan = [bm.faces.new([vr[-1][i], vr[-1][(i + 1) % n], c]) for i in range(n)]
        paint(fan, per[-1], jitter)
    return faces


# --- Plan shapes --------------------------------------------------------------------------------
N_TIP, N_SIDE, N_BIG = 10, 6, 40


def outline(R, w, tip, wt):
    """Outline (x, z) of the pitha in plan: a round basin of radius R with a tongue (the spout) to
    the front, half-width w where it leaves the circle, narrowing to a rounded lip of radius wt
    whose front is at z = tip. Same point count for any size, so the rings loft together."""
    g = math.asin(w / R)
    c = tip - wt
    root = (w, R * math.cos(g))
    out = [(wt * math.sin(a), c + wt * math.cos(a))
           for a in (-math.pi / 2 + math.pi * k / N_TIP for k in range(N_TIP + 1))]
    # Right side, lip to circle, gently curved (narrow near the lip, flaring at the root).
    for k in range(1, N_SIDE + 1):
        t = k / (N_SIDE + 1)
        out.append((wt + (w - wt) * t ** 1.8, c + (root[1] - c) * t))
    out += [(R * math.sin(a), R * math.cos(a))
            for a in (g + (2 * math.pi - 2 * g) * k / N_BIG for k in range(N_BIG + 1))]
    for k in range(1, N_SIDE + 1):
        t = 1 - k / (N_SIDE + 1)
        out.append((-(wt + (w - wt) * t ** 1.8), c + (root[1] - c) * t))
    return out


REF = outline(0.46, 0.17, 0.83, 0.075)
ANGLES = [math.atan2(x, z) for x, z in REF]


def circle_like(rad):
    """A circle with one point at the angle of each outline point, so it lofts into the pitha."""
    return [(rad * math.sin(a), rad * math.cos(a)) for a in ANGLES]


def fall(z):
    """The spout falls gently to its lip so water runs out."""
    return 0.07 * max(0.0, z - 0.3)


def ring_y(plan, y, falls=False):
    return [(x, y - (fall(z) if falls else 0.0), z) for x, z in plan]


# --- Base slab ----------------------------------------------------------------------------------
def square(h, y):
    return [(-h, y, h), (h, y, h), (h, y, -h), (-h, y, -h)]


loft([square(0.43, 0.0), square(0.43, 0.05), square(0.41, 0.07), square(0.39, 0.075)],
     ["slabDust", "slab", "slab"], cap_bottom=True, cap_top="flat")

# --- Pedestal and yoni pitha, one loft from the waist to the basin floor --------------------------
pedestal = [(0.37, 0.07), (0.37, 0.10), (0.345, 0.12), (0.33, 0.13), (0.31, 0.145), (0.30, 0.20),
            (0.31, 0.215), (0.33, 0.23), (0.345, 0.25)]
pitha = [  # (R, root half-width, lip front, lip radius, y)
    (0.37, 0.13, 0.79, 0.055, 0.265),     # underside of the spout, rising from the pedestal
    (0.43, 0.15, 0.815, 0.068, 0.29),
    (0.455, 0.165, 0.828, 0.073, 0.315),
    (0.46, 0.17, 0.83, 0.075, 0.335),     # outer face
    (0.46, 0.17, 0.83, 0.075, 0.375),
    (0.445, 0.16, 0.828, 0.067, 0.39),    # rounded top edge
    (0.425, 0.14, 0.824, 0.055, 0.395),   # rim top
    (0.405, 0.11, 0.818, 0.04, 0.388),   # inner edge of the rim
    (0.385, 0.095, 0.815, 0.033, 0.37),
    (0.365, 0.085, 0.812, 0.03, 0.36),    # basin floor, groove bottom
]
rings = [ring_y(circle_like(rad), y) for rad, y in pedestal]
rings += [ring_y(outline(R, w, tip, wt), y, falls=True) for R, w, tip, wt, y in pitha]
colors = (["pitha", "pitha", "pithaShadow", "pithaShadow", "pithaShadow", "pitha", "pitha", "pitha"]
          + ["pithaShadow", "pitha", "pitha", "pitha", "pitha", "rim", "rim", "rim", "basin", "basin"])
loft(rings, colors, cap_top=(0.0, 0.355, 0.05))

# --- The linga ----------------------------------------------------------------------------------
N_SHAFT = 40


def circle(rad, y):
    return [(rad * math.cos(2 * math.pi * k / N_SHAFT), y, -rad * math.sin(2 * math.pi * k / N_SHAFT))
            for k in range(N_SHAFT)]


SHAFT_R, DOME_Y = 0.152, 0.70
DOME_H = TOP - DOME_Y
shaft = [circle(0.158, 0.33), circle(0.158, 0.372), circle(0.155, 0.40), circle(0.153, 0.5),
         circle(SHAFT_R, DOME_Y)]
for k in range(1, 8):
    t = math.radians(12 * k)
    shaft.append(circle(SHAFT_R * math.cos(t), DOME_Y + DOME_H * math.sin(t)))
loft(shaft, ["basin", "basin", "linga", "linga"] + ["linga"] * 4 + ["lingaTop"] * 3,
     jitter=0.015, cap_top=(0.0, TOP, 0.0))

# Normals of the stone outwards before the thin offerings are added.
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))

# --- Tripundra (TRIAL: spec 08 lists it as "check with advisor", default Off) -----------------------
# Three horizontal lines of white ash across the face of the linga that looks out of the sanctum
# door. The slot turns the model a quarter so its spout (+z) points north, which turns its -x side
# to the east, the door. Each line wraps a little round the shaft and thins at its ends, sitting
# 1.5 mm proud of the stone. No dot or other mark.
TRIPUNDRA = True
if TRIPUNDRA:
    PAL["ash"] = hexcol("#e8e3d6")
    R_ASH, SPAN, SEGS = SHAFT_R + 0.002, math.radians(52), 18
    for yc in (0.62, 0.65, 0.68):
        rows = []
        for i in range(SEGS + 1):
            u = -1 + 2 * i / SEGS
            t = SPAN * u
            half = 0.0075 * (1 - 0.65 * abs(u) ** 3)
            x, z = -R_ASH * math.cos(t), R_ASH * math.sin(t)
            rows.append((bm.verts.new(L(x, yc - half, z)), bm.verts.new(L(x, yc + half, z))))
        strip = []
        for (a0, a1), (b0, b1) in zip(rows, rows[1:]):
            f = bm.faces.new([a0, b0, b1, a1])
            f.normal_update()
            c = f.calc_center_median()
            if f.normal.x * c.x + f.normal.y * c.y < 0:  # face away from the shaft's axis
                f.normal_flip()
            strip.append(f)
        paint(strip, "ash", 0.05)

# A round kumkum dot in the middle of the tripundra, over the middle line (TRIAL, owner
# 2026-11-21). Curved to the shaft and a little prouder than the ash, so it sits on top of it.
DOT = True
if TRIPUNDRA and DOT:
    PAL["kumkum"] = hexcol("#b1221b")
    R_DOT, DOT_R, DOT_Y, N_DOT = SHAFT_R + 0.0032, 0.0145, 0.65, 16

    def on_shaft(t, y):
        return L(-R_DOT * math.cos(t), y, R_DOT * math.sin(t))

    centre = bm.verts.new(on_shaft(0.0, DOT_Y))
    rim = [bm.verts.new(on_shaft(DOT_R / R_DOT * math.cos(a), DOT_Y + DOT_R * math.sin(a)))
           for a in (2 * math.pi * k / N_DOT for k in range(N_DOT))]
    dot = []
    for k in range(N_DOT):
        f = bm.faces.new([rim[k], rim[(k + 1) % N_DOT], centre])
        f.normal_update()
        if f.normal.x > 0:  # face out of the -x side, towards the door
            f.normal_flip()
        dot.append(f)
    paint(dot, "kumkum", 0.0)


# --- Offerings ----------------------------------------------------------------------------------
def dome_y(rho):
    return DOME_Y + DOME_H * math.sqrt(max(0.0, 1 - (rho / SHAFT_R) ** 2))


def leaflet(cx, cz, ang, length, width, height_of, lift=0.004):
    """A pointed oval leaf from (cx, cz) along angle ang (0 = +z), lying on the surface given by
    height_of(x, z), with a raised midrib. Two-sided (a lower skin 1.5 mm below)."""
    dx, dz = math.sin(ang), math.cos(ang)
    px, pz = dz, -dx
    stations = 7
    for skin, (col, dy) in enumerate((("bilva", 0.0), ("bilvaBack", -0.0015))):
        rows = []
        for i in range(stations + 1):
            u = length * i / stations
            w = max(0.002, width * 0.5 * math.sin(math.pi * i / stations) ** 0.8)
            row = []
            for v, rib in ((-w, 0.0), (0.0, 0.003), (w, 0.0)):
                x, z = cx + dx * u + px * v, cz + dz * u + pz * v
                row.append(bm.verts.new(L(x, height_of(x, z) + lift + rib + dy, z)))
            rows.append(row)
        faces = []
        for a, b in zip(rows, rows[1:]):
            for j in range(2):
                f = bm.faces.new([a[j], a[j + 1], b[j + 1], b[j]])
                f.normal_update()
                if (f.normal.z < 0) != bool(skin):  # top skin faces up, lower skin down
                    f.normal_flip()
                faces.append(f)
        paint(faces, col, 0.08)


def bilva(cx, cz, turn, height_of, size=1.0):
    """A bilva sprig: three leaflets, the middle one longer."""
    for k, (da, ln) in enumerate(((0.0, 0.085), (2.0, 0.065), (-2.0, 0.065))):
        leaflet(cx, cz, turn + da * 0.62, ln * size, 0.034 * size, height_of)


def basin_y(x, z):
    return 0.362


# One sprig over the top of the linga, the middle leaflet to the front.
bilva(0.0, 0.0, 0.0, lambda x, z: dome_y(math.hypot(x, z)))


def shaft_r(y):
    """Radius of the linga's surface at height y (straight shaft, then the dome)."""
    if y <= DOME_Y:
        return SHAFT_R
    return SHAFT_R * math.sqrt(max(0.0, 1 - ((y - DOME_Y) / DOME_H) ** 2))


def leaflet_on_face(y0, ang, length, width, lift=0.004):
    """A leaflet lying on the door-facing (-x) side of the linga, from height y0 at the middle of
    that side, along angle ang in the surface (0 = straight down). Two-sided, like leaflet()."""
    ds, dy = math.sin(ang), -math.cos(ang)
    ps, py = dy, -ds
    stations = 7
    for skin, (col, off) in enumerate((("bilva", 0.0), ("bilvaBack", -0.0015))):
        rows = []
        for i in range(stations + 1):
            u = length * i / stations
            w = max(0.002, width * 0.5 * math.sin(math.pi * i / stations) ** 0.8)
            row = []
            for v, rib in ((-w, 0.0), (0.0, 0.003), (w, 0.0)):
                s, y = ds * u + ps * v, y0 + dy * u + py * v
                r = shaft_r(y) + lift + rib + off
                t = s / SHAFT_R
                row.append(bm.verts.new(L(-r * math.cos(t), y, r * math.sin(t))))
            rows.append(row)
        faces = []
        for a, b in zip(rows, rows[1:]):
            for j in range(2):
                f = bm.faces.new([a[j], a[j + 1], b[j + 1], b[j]])
                f.normal_update()
                c = f.calc_center_median()
                out = f.normal.x * c.x + f.normal.y * c.y > 0  # away from the shaft's axis
                if out == bool(skin):  # outer skin faces out, inner skin in
                    f.normal_flip()
                faces.append(f)
        paint(faces, col, 0.08)


# A sprig on the face of the linga above the dot (owner, 2026-11-21): its stalk at 0.80 m on the
# door side, the three leaflets hanging down and out towards the tripundra, the middle leaflet's
# tip about 2.5 cm above the top ash line, so the lines and the dot stay clear.
FACE_BILVA = True
if FACE_BILVA:
    for da, ln in ((0.0, 0.085), (0.9, 0.065), (-0.9, 0.065)):
        leaflet_on_face(0.80, da, ln, 0.034)

# Two in the basin, behind and to the sides, away from the groove.
for a in (math.radians(140), math.radians(220)):
    bilva(0.24 * math.sin(a), 0.24 * math.cos(a), a + math.pi * 0.5, basin_y, 0.9)


def flower(cx, cz, rad):
    """A small white five-petalled flower lying in the basin, with a yellow eye."""
    y = 0.364
    n = 20
    rim = []
    spin = random.uniform(0, math.pi)
    for k in range(n):
        a = 2 * math.pi * k / n
        petal = abs(math.cos(2.5 * a))
        rr = rad * (0.4 + 0.6 * petal)
        rim.append(bm.verts.new(L(cx + rr * math.sin(a + spin), y + 0.002 + 0.005 * petal,
                                  cz + rr * math.cos(a + spin))))
    eye = bm.verts.new(L(cx, y + 0.006, cz))
    # Rising angle runs counter-clockwise seen from above in Blender, so the petals face up.
    petals = [bm.faces.new([rim[k], rim[(k + 1) % n], eye]) for k in range(n)]
    paint(petals, "flower", 0.04)
    for f in petals:
        for loop in f.loops:
            if loop.vert is eye:
                loop[COL] = (*PAL["flowerEye"], 1.0)


for a in (55, 100, 260, 305):
    r = math.radians(a)
    flower(0.255 * math.sin(r), 0.255 * math.cos(r), 0.03)

# --- Dharapatra (owner, 2026-11-21) ----------------------------------------------------------------
# A copper water pot that drips onto the linga, hung on three thin chains from a slim brass tripod
# standing on the sanctum floor round the pitha. Spec 08 allows an optional copper dharapatra; the
# spec 11 slot keeps it out of the linga model only because a fitted model's height would change,
# and this model isn't fitted (fit none), so here it is part of the model, behind this flag.
# Tripod legs at 90 degrees (behind, away from the door) and -30 / -150 degrees (either side of
# the door axis, clear of the spout), feet 0.70 m out; apex at 1.58 m. The pot's tip is 17 cm
# above the top of the linga.
DHARAPATRA = True
if DHARAPATRA:
    from mathutils import Vector

    PAL["copper"] = hexcol("#93512d")
    PAL["copperDark"] = hexcol("#6a3620")
    PAL["brass"] = hexcol("#b08d3c")
    APEX_Y, FOOT_R, HOOK_Y = 1.58, 0.70, 1.50
    LEG_ANGLES = (90, -30, -150)

    def tube(p0, p1, r0, r1, n, color, caps=True):
        """A tube from model point p0 to p1, radius r0 to r1, n sides."""
        a, b = Vector(p0), Vector(p1)
        axis = (b - a).normalized()
        side = axis.cross(Vector((0, 1, 0)) if abs(axis.y) < 0.9 else Vector((1, 0, 0))).normalized()
        up = axis.cross(side)
        rings = []
        for c, r in ((a, r0), (b, r1)):
            rings.append([tuple(c + (side * math.cos(2 * math.pi * k / n) + up * math.sin(2 * math.pi * k / n)) * r)
                          for k in range(n)])
        return loft(rings, color, cap_bottom=caps, cap_top="flat" if caps else None, jitter=0.03)

    F0 = len(bm.faces)
    # Tripod: three legs, small feet, an apex knob and a short hook.
    apex = (0.0, APEX_Y, 0.0)
    for deg in LEG_ANGLES:
        t = math.radians(deg)
        foot = (FOOT_R * math.sin(t), 0.0, FOOT_R * math.cos(t))
        tube((foot[0], 0.012, foot[2]), apex, 0.013, 0.009, 6, "brass")
        tube((foot[0], 0.0, foot[2]), (foot[0], 0.02, foot[2]), 0.028, 0.022, 8, "brass")
    tube((0, APEX_Y - 0.02, 0), (0, APEX_Y + 0.035, 0), 0.026, 0.012, 10, "brass")
    tube((0, HOOK_Y, 0), (0, APEX_Y - 0.01, 0), 0.005, 0.005, 6, "brass")
    tube((0, HOOK_Y - 0.012, 0), (0, HOOK_Y + 0.004, 0), 0.018, 0.018, 10, "brass")  # chain ring

    # The pot: a rounded copper vessel with a rolled lip and a fine drip nozzle under it.
    N_POT = 24

    def pot_ring(rad, y):
        return [(rad * math.cos(2 * math.pi * k / N_POT), y, -rad * math.sin(2 * math.pi * k / N_POT))
                for k in range(N_POT)]

    outer = [(0.006, 1.09), (0.03, 1.10), (0.065, 1.115), (0.095, 1.145), (0.11, 1.18), (0.112, 1.215),
             (0.102, 1.245), (0.084, 1.268), (0.078, 1.285), (0.09, 1.30), (0.094, 1.31)]
    inner = [(0.084, 1.312), (0.072, 1.29), (0.09, 1.25), (0.098, 1.20), (0.08, 1.15), (0.04, 1.125)]
    prof = outer + inner
    colours = ["copperDark"] * 3 + ["copper"] * 7 + ["copper"] + ["copperDark"] * 5
    loft([pot_ring(r, y) for r, y in prof], colours, cap_top=(0.0, 1.12, 0.0))
    # Nozzle: a short point under the pot, where the water drips from.
    tube((0, 1.093, 0), (0, 1.075, 0), 0.006, 0.0025, 6, "copperDark")

    # A thin stream of water from the nozzle down to the top of the linga (owner, 2026-11-21). One
    # material with no transparency, so the water is a pale, slightly blue-grey line: thinnest
    # just under the nozzle, a little fuller as it falls, with a small splash where it lands.
    STREAM = True
    if STREAM:
        PAL["water"] = hexcol("#c9d6dc")
        n_w = 6
        profile = [(0.0034, 1.077), (0.0028, 1.05), (0.0032, 1.01), (0.0036, 0.97), (0.0041, 0.935)]

        def w_ring(r, y):
            return [(r * math.cos(2 * math.pi * k / n_w), y, -r * math.sin(2 * math.pi * k / n_w))
                    for k in range(n_w)]

        loft([w_ring(r, y) for r, y in profile], "water", jitter=0.02, cap_bottom=True)
        # Splash: a low, wide dome where the stream meets the top of the linga.
        loft([w_ring(0.0041, 0.935), w_ring(0.011, TOP + 0.009), w_ring(0.013, TOP + 0.005)], "water",
             jitter=0.02, cap_top=(0.0, TOP + 0.003, 0.0))

    # Three chains (thin rods) from the lip to the ring on the hook.
    for deg in LEG_ANGLES:
        t = math.radians(deg + 60)
        tube((0.088 * math.sin(t), 1.305, 0.088 * math.cos(t)), (0, HOOK_Y - 0.008, 0), 0.003, 0.003, 4,
             "brass", caps=False)

    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces)[F0:])

# --- Object, material, export -------------------------------------------------------------------
old = bpy.data.objects.get(NAME)
if old:
    bpy.data.objects.remove(old, do_unlink=True)
mesh = bpy.data.meshes.get(NAME)
if mesh:
    bpy.data.meshes.remove(mesh)
mesh = bpy.data.meshes.new(NAME)
bm.normal_update()
bm.to_mesh(mesh)
bm.free()
mesh.color_attributes.active_color = mesh.color_attributes["Col"]
mesh.color_attributes.render_color_index = mesh.color_attributes.active_color_index
mesh.shade_smooth()
mesh.set_sharp_from_angle(angle=math.radians(40))

mat = bpy.data.materials.get("linga-stone") or bpy.data.materials.new("linga-stone")
mat.use_nodes = True
mat.use_backface_culling = True
nodes, links = mat.node_tree.nodes, mat.node_tree.links
bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
bsdf.inputs["Base Color"].default_value = (1, 1, 1, 1)
bsdf.inputs["Roughness"].default_value = 0.5  # oiled, often-bathed stone
bsdf.inputs["Metallic"].default_value = 0.0
attr = next((n for n in nodes if n.type == "VERTEX_COLOR"), None) or nodes.new("ShaderNodeVertexColor")
attr.layer_name = "Col"
attr.location = (bsdf.location.x - 300, bsdf.location.y)
links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
mesh.materials.append(mat)

obj = bpy.data.objects.new(NAME, mesh)
bpy.context.scene.collection.objects.link(obj)
obj.location = (-16.0, -8.0, 0.0)  # away from the other models while working; not exported

tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
xs = [v.co.x for v in mesh.vertices]
ys = [v.co.y for v in mesh.vertices]
zs = [v.co.z for v in mesh.vertices]
print(f"{NAME}: {tris} triangles, x {min(xs):.3f}..{max(xs):.3f}, front z {-max(ys):.3f}..{-min(ys):.3f}, "
      f"height {min(zs):.3f}..{max(zs):.3f}")
if tris > 6_000:
    print("WARNING: over the slot's 6,000 triangles")

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
