"""
Sannidhi devotee avatar (spec 02 § Avatar, spec 11 asset list). Made for Sannidhi by Claude (AI)
in Blender 5.2 by this script, so the model is "ai": true and disclosed in the credits.

Run inside Blender (Scripting tab, or the MCP connector):
    path = r"<repo>/assets-src/models/avatar/make_avatar.py"
    exec(compile(open(path, encoding="utf-8").read(), path, "exec"), {"__file__": path})
It replaces any earlier avatar objects and, if EXPORT is set, writes avatar.glb next to itself.
With PREVIEW set it also lays out posed copies (idle, walk, sit, namaste, pranam, bell) for a
visual check; those are never exported.

An original, short and rounded devotee, about 1.17 m and a little over three heads tall: a big
round head, a round tummy, short legs, stubby arms, and round hands and feet. A kurta with a
dhoti (body 0) or a salwar (body 1), a wool shawl over both shoulders, and bare feet. Hair, ears
and a small nose, and no eyes, mouth, tilak or other marker; body 1 wears its hair in a bun.
It isn't a deity, sadhu, priest or child-monk look (no shaven head, robe or sash), and carries
no caste, sect or regional sign.

The rig is the one apps/web/src/scene/avatar.ts animates: the same 17 bones at the same rest
positions (makeBones; the proportions below mirror its constants), so the code's walk, sit and
gestures drive this mesh unchanged. The wrists (handL, handR) let the palms press together with
the fingers up for namaste and pranam. Every vertex follows exactly one bone (rigid skinning),
and the parts overlap at the joints.

What the glb holds (the client reads it by these names):
- Armatures `rig0` and `rig1`, bones named `b<body>-<bone>` (root, hips, spine, head, upperL,
  foreL, upperR, foreR, thighL, shinL, footL, thighR, shinR, footR, skirt, handL, handR).
- Meshes `body0-high`, `body0-low`, `body1-high`, `body1-low`, each skinned to its rig, in the
  avatar's own space (unscaled; the code scales body 1 by 0.96).
- Two materials, both vertex colours only: `avatar-body` (final colours) and `avatar-shawl`
  (a grey shade the code multiplies by the visitor's shawl colour, one of 8).

Frame: the code's avatar space is x left, y up, z forward (the avatar faces +z). Blender gets
(x, -z, y), so the front is -y in Blender, as for every slot model.
"""
import math
import os
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

EXPORT = True
PREVIEW = True
HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else None
SHOW_AT = Vector((0.0, -20.0, 0.0))  # where the rigs stand in Blender (moved to 0 for export)

random.seed(108)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexcol(h):
    h = h.lstrip("#")
    return tuple(srgb_to_linear(int(h[i : i + 2], 16) / 255) for i in (0, 2, 4))


# Colours from avatar.ts, so the model reads like the greybox figure it replaces.
SKIN = hexcol("#9a6b4f")
HAIR = hexcol("#2a221d")
KURTA = hexcol("#e6dfce")
BUTTON = hexcol("#8c7b5e")
SHAWL_MAIN = 1.0  # shawl shades: multiplied by the visitor's shawl colour in the code
SHAWL_BORDER = 0.62
SHAWL_INSIDE = 0.7

# Proportions: keep in step with the constants of the same names in avatar.ts.
THIGH = 0.2
SHIN = 0.18
HIP_HEIGHT = THIGH + SHIN + 0.07
SPINE_HEAD = 0.35  # neck joint above the hips
SPINE_SHOULDER = 0.31  # shoulder joints above the hips
UPPER_ARM = 0.18  # shoulder to elbow
FOREARM = 0.15  # elbow to wrist
SKIRT = -0.07  # the kurta hem's bone, below the hips
FOOT_Z = 0.04  # ankle to the foot bone, forward
SEATED_HIP = 0.12  # hips above the mat when seated
HEAD_C = (0.0, HIP_HEIGHT + SPINE_HEAD + 0.18, 0.005)  # centre of the head
HEAD_R = (0.162, 0.172, 0.158)  # half width, half height, half depth

BODIES = [
    # palms_out: extra outward forearm turn for joined palms, so the narrower shoulders of body 1
    # still bring the palms together instead of through each other (avatar.ts Body.palmsOut).
    dict(scale=1.0, shoulder=0.145, hip=0.07, lower=hexcol("#efe9d8"), salwar=False, palms_out=0.0),
    dict(scale=0.96, shoulder=0.135, hip=0.072, lower=hexcol("#e2d8c3"), salwar=True, palms_out=0.07),
]

BONES = ["root", "hips", "spine", "head", "upperL", "foreL", "upperR", "foreR",
         "thighL", "shinL", "footL", "thighR", "shinR", "footR", "skirt", "handL", "handR"]
PARENT = {"hips": "root", "spine": "hips", "head": "spine", "upperL": "spine", "foreL": "upperL",
          "upperR": "spine", "foreR": "upperR", "thighL": "hips", "shinL": "thighL",
          "footL": "shinL", "thighR": "hips", "shinR": "thighR", "footR": "shinR", "skirt": "hips",
          "handL": "foreL", "handR": "foreR"}
EULER_ORDER = {"thighL": "YXZ", "thighR": "YXZ", "shinL": "ZXY", "shinR": "ZXY"}


def rest_local(body):
    """Each bone's position in its parent, as makeBones() in avatar.ts."""
    sh, hp = body["shoulder"], body["hip"]
    return {
        "root": (0, 0, 0), "hips": (0, HIP_HEIGHT, 0), "spine": (0, 0, 0),
        "head": (0, SPINE_HEAD, 0),
        "upperL": (sh + 0.02, SPINE_SHOULDER, 0), "foreL": (0, -UPPER_ARM, 0),
        "upperR": (-(sh + 0.02), SPINE_SHOULDER, 0), "foreR": (0, -UPPER_ARM, 0),
        "thighL": (hp, -0.02, 0), "shinL": (0, -THIGH, 0), "footL": (0, -SHIN - 0.02, FOOT_Z),
        "thighR": (-hp, -0.02, 0), "shinR": (0, -THIGH, 0), "footR": (0, -SHIN - 0.02, FOOT_Z),
        "skirt": (0, SKIRT, 0), "handL": (0, -FOREARM, 0), "handR": (0, -FOREARM, 0),
    }


def rest_world(body):
    loc = rest_local(body)
    out = {}
    for name in BONES:  # parents come first in BONES
        p = PARENT.get(name)
        out[name] = Vector(loc[name]) + (out[p] if p else Vector())
    return out


def to_blender(p):
    return (p[0], -p[2], p[1])


def to_three(co):
    return (co.x, co.z, -co.y)


def lerp(a, b, t):
    return a + (b - a) * t


def interp(table, y):
    """Piecewise-linear lookup in rows (y, a, b, ...) sorted by y."""
    if y <= table[0][0]:
        return table[0][1:]
    for r0, r1 in zip(table, table[1:]):
        if y <= r1[0]:
            t = (y - r0[0]) / (r1[0] - r0[0])
            return tuple(lerp(a, b, t) for a, b in zip(r0[1:], r1[1:]))
    return table[-1][1:]


# --- Geometry helpers (all in the code's avatar space) ------------------------------------------


def grid(fn, us, rows, wrap, pole0=None, pole1=None):
    """Quads over fn(u, row) for u in us and each row; optional fans to a point at either end."""
    pts, faces, idx = [], [], {}
    nu = len(us)
    for j, row in enumerate(rows):
        for i, u in enumerate(us):
            idx[i, j] = len(pts)
            pts.append(fn(u, row))
    spans = nu if wrap else nu - 1
    for j in range(len(rows) - 1):
        for i in range(spans):
            i2 = (i + 1) % nu
            faces.append(((idx[i, j], idx[i2, j], idx[i2, j + 1], idx[i, j + 1]), (i, j)))
    if pole0 is not None:
        p = len(pts)
        pts.append(pole0)
        for i in range(spans):
            faces.append(((p, idx[(i + 1) % nu, 0], idx[i, 0]), (i, -1)))
    if pole1 is not None:
        p = len(pts)
        pts.append(pole1)
        last = len(rows) - 1
        for i in range(spans):
            faces.append(((idx[i, last], idx[(i + 1) % nu, last], p), (i, last)))
    return pts, faces


def ring_us(n):
    return [i / n for i in range(n)]


def ring_offset(row):
    """(cx, cz) of a ring: rows are (y, rx, rz), (y, rx, rz, cz) or (y, rx, rz, cx, cz)."""
    if len(row) == 4:
        return 0.0, row[3]
    if len(row) == 5:
        return row[3], row[4]
    return 0.0, 0.0


def lathe(rows, seg, at, pole0=None, pole1=None):
    """Elliptical rings about a vertical axis through `at`: rows (y, rx, rz[, cx], cz]), y relative
    to `at`. θ = 0 faces front (+z), θ = π/2 faces +x. Poles are relative to `at` too."""
    ax, ay, az = at

    def fn(u, row):
        y, rx, rz = row[:3]
        cx, cz = ring_offset(row)
        th = 2 * math.pi * u
        return (ax + cx + rx * math.sin(th), ay + y, az + cz + rz * math.cos(th))

    p0 = (ax + pole0[0], ay + pole0[1], az + pole0[2]) if pole0 else None
    p1 = (ax + pole1[0], ay + pole1[1], az + pole1[2]) if pole1 else None
    return grid(fn, ring_us(seg), rows, True, p0, p1)


def ring_centre(row):
    cx, cz = ring_offset(row)
    return (cx, row[0], cz)


def ellipsoid(centre, radii, lon, lat):
    cx, cy, cz = centre
    rx, ry, rz = radii
    rows = [-math.pi / 2 + math.pi * (j + 1) / (lat + 1) for j in range(lat)]

    def fn(u, la):
        th = 2 * math.pi * u
        return (cx + rx * math.cos(la) * math.sin(th), cy + ry * math.sin(la),
                cz + rz * math.cos(la) * math.cos(th))

    return grid(fn, ring_us(lon), rows, True, (cx, cy - ry, cz), (cx, cy + ry, cz))


def shell(fn, us, rows, wrap, d_out, d_in, pole1=None):
    """A closed cloth piece of some thickness: fn(u, row, d) at d_out and d_in, inner side
    flipped, the open borders stitched. pole1(d) closes the last row, if given."""
    po, fo = grid(lambda u, r: fn(u, r, d_out), us, rows, wrap, None,
                  pole1(d_out) if pole1 else None)
    pi_, fi = grid(lambda u, r: fn(u, r, d_in), us, rows, wrap, None,
                   pole1(d_in) if pole1 else None)
    n = len(po)
    pts = po + pi_
    faces = [(f, ("out",) + m) for f, m in fo]
    faces += [(tuple(reversed([k + n for k in f])), ("in",) + m) for f, m in fi]
    nu = len(us)
    gi = lambda i, j: j * nu + i  # grid() numbers rows first
    borders = [[gi(i, 0) for i in range(nu)] + ([gi(0, 0)] if wrap else [])]
    if not pole1:
        last = len(rows) - 1
        borders.append([gi(i, last) for i in range(nu)] + ([gi(0, last)] if wrap else []))
    if not wrap:
        borders.append([gi(0, j) for j in range(len(rows))])
        borders.append([gi(nu - 1, j) for j in range(len(rows))])
    for b in borders:
        for a, c in zip(b, b[1:]):
            faces.append(((a, c, c + n, a + n), ("edge",)))
    return pts, faces


def hull(points):
    tmp = bmesh.new()
    vs = [tmp.verts.new(p) for p in points]
    bmesh.ops.convex_hull(tmp, input=vs)
    tmp.verts.index_update()
    pts = [tuple(v.co) for v in tmp.verts]
    faces = [(tuple(v.index for v in f.verts), ()) for f in tmp.faces]
    tmp.free()
    return pts, faces


class Builder:
    def __init__(self):
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.float_color.new("Col")
        self.dl = self.bm.verts.layers.deform.verify()

    def piece(self, geo, bone, colour, mat=0, closed=False):
        """colour(p, meta) -> linear rgb, per face corner; p is in avatar space."""
        pts, faces = geo
        bm = self.bm
        vs = [bm.verts.new(to_blender(p)) for p in pts]
        bi = BONES.index(bone)
        for v in vs:
            v[self.dl][bi] = 1.0
        fs, metas = [], []
        for f, meta in faces:
            if len(set(f)) < 3:
                continue
            try:
                fs.append(bm.faces.new([vs[k] for k in f]))
                metas.append(meta)
            except ValueError:
                pass
        if closed:
            bmesh.ops.recalc_face_normals(bm, faces=fs)
        for f in fs:
            f.normal_update()
        cen = sum((v.co for v in vs), Vector()) / len(vs)
        if sum((f.calc_center_median() - cen).dot(f.normal) * f.calc_area() for f in fs) < 0:
            for f in fs:
                f.normal_flip()
        for f, meta in zip(fs, metas):
            f.material_index = mat
            f.smooth = True
            for loop in f.loops:
                c = colour(to_three(loop.vert.co), meta)
                loop[self.col] = (min(1, c[0]), min(1, c[1]), min(1, c[2]), 1.0)
        return fs


def flat(c, jitter=0.03):
    k = 1 + random.uniform(-jitter, jitter)
    c = tuple(v * k for v in c)
    return lambda p, m: c


def folds(c, at, n=7, depth=0.05, jitter=0.02):
    """Cloth with soft vertical folds around an axis through `at`."""
    k = 1 + random.uniform(-jitter, jitter)

    def fn(p, m):
        th = math.atan2(p[0] - at[0], p[2] - at[2])
        s = 1 - depth * (0.5 + 0.5 * math.sin(n * th + 15 * p[1]))
        return tuple(v * k * s for v in c)

    return fn


def scale(c, k):
    return tuple(v * k for v in c)


# --- The figure ----------------------------------------------------------------------------------

NECK = HIP_HEIGHT + SPINE_HEAD  # the neck joint, 0.80
Y_TOP = NECK + 0.012  # the shawl's top edge round the neck
CHEST = HIP_HEIGHT + 0.23

# Torso (kurta) rings: y, rx, rz, cz. A round tummy and soft, sloping shoulders.
TORSO = [
    (0.36, 0.130, 0.115, 0.0), (0.44, 0.140, 0.124, 0.006), (0.52, 0.146, 0.13, 0.014),
    (0.60, 0.143, 0.124, 0.012), (0.68, 0.146, 0.114, 0.006), (0.74, 0.140, 0.102, 0.0),
    (0.775, 0.112, 0.086, -0.004), (0.80, 0.070, 0.062, -0.004), (0.815, 0.045, 0.045, 0.0),
]
# Body 1: a little wider at the hips, narrower at the chest and shoulders.
TORSO_X1 = [(0.36, 1.04), (0.44, 1.04), (0.52, 0.97), (0.60, 0.94), (0.68, 0.93), (0.815, 0.95)]


def torso_rows(bi):
    if bi == 0:
        return TORSO
    out = []
    for y, rx, rz, cz in TORSO:
        k = interp(TORSO_X1, y)[0]
        out.append((y, rx * k, rz * (1.03 if 0.6 < y < 0.72 else 1.0), cz))
    return out


def head_pt(lat, lon, inflate=0.0, back=0.04):
    """A big round head: full cheeks, a soft chin, the back of the skull tucked to the neck."""
    cy, cl = math.sin(lat), math.cos(lat)
    x = (HEAD_R[0] + inflate) * cl * math.sin(lon)
    y = (HEAD_R[1] + inflate) * cy
    z = (HEAD_R[2] + inflate) * cl * math.cos(lon)
    if cy < -0.25:
        t = (-cy - 0.25) / 0.75
        x *= 1 - 0.2 * t ** 1.3
        z *= (1 - 0.06 * t) if z > 0 else (1 - 0.4 * t)
        z += 0.01 * t
    if z < 0:
        z *= 1 + back
    return (HEAD_C[0] + x, HEAD_C[1] + y, HEAD_C[2] + z)


def hairline(lon, front, side, back):
    c = math.cos(lon)
    return lerp(side, front, c ** 1.6) if c >= 0 else lerp(side, back, (-c) ** 1.2)


def build(bi, detail):
    body = BODIES[bi]
    hi = detail == "high"
    W = rest_world(body)
    out = Builder()
    P = out.piece
    seg = lambda h, l: h if hi else l

    def thin(rows):
        if hi or len(rows) <= 3:
            return rows
        return [r for k, r in enumerate(rows) if k in (0, len(rows) - 1) or k % 2 == 0]

    lower = body["lower"]
    T = torso_rows(bi)

    # Torso in the kurta, with a band collar and (near detail) three small buttons.
    rows = thin(T)
    P(lathe(rows, seg(16, 8), (0, 0, 0), ring_centre(rows[0]), ring_centre(rows[-1])),
      "spine", folds(KURTA, (0, 0, 0), n=5, depth=0.03))
    collar = [(NECK - 0.006, 0.056, 0.052, 0, -0.002), (NECK + 0.022, 0.051, 0.048, 0, -0.002)]
    P(lathe(collar, seg(12, 6), (0, 0, 0), ring_centre(collar[0]), ring_centre(collar[1])),
      "spine", flat(scale(KURTA, 0.92)))
    if hi:
        for y in (0.73, 0.685, 0.64):
            rx, rz, cz = interp(T, y)
            z = cz + rz
            r = 0.0065
            P(hull([(0, y + r, z - 0.002), (0, y - r, z - 0.002), (r, y, z - 0.002),
                    (-r, y, z - 0.002), (0, y, z + 0.004)]), "spine", flat(BUTTON, 0), closed=True)

    # Kurta hem, on the skirt bone (the code squashes it when seated). It ends above the knees;
    # the top ring tucks inside the torso, so there is no ledge where they meet.
    hem = ([(0.27, 0.162, 0.148), (0.31, 0.155, 0.139), (0.37, 0.147, 0.13), (0.42, 0.142, 0.126),
            (0.46, 0.13, 0.112)]
           if bi == 0 else
           [(0.245, 0.176, 0.162), (0.29, 0.166, 0.15), (0.36, 0.152, 0.134), (0.42, 0.146, 0.128),
            (0.46, 0.134, 0.114)])
    hem = thin(hem)

    def hem_fn(u, row, d):
        y, rx, rz = row
        th = 2 * math.pi * u
        return ((rx + d) * math.sin(th), y, (rz + d) * math.cos(th))

    hem_col = folds(KURTA, (0, 0, 0), n=6, depth=0.06)
    if hi:
        P(shell(hem_fn, ring_us(16), hem, True, 0.0, -0.007), "skirt",
          lambda p, m: scale(hem_col(p, m), SHAWL_INSIDE) if m and m[0] == "in" else hem_col(p, m),
          closed=True)
    else:
        P(grid(lambda u, r: hem_fn(u, r, 0.0), ring_us(8), hem, True), "skirt", hem_col)

    # The shawl: over both shoulders and round the back to the tummy, its two ends hanging down
    # the chest either side of a strip of kurta, with a darker woven border.
    chest = interp(T, CHEST)
    y_low = 0.53

    def shawl_r(y):
        rx, rz, cz = interp(T, y)
        if y < CHEST:  # hangs straight down from the chest over the tummy
            rx, rz = max(rx, chest[0] * 0.99), max(rz, chest[1] * 1.04)
        return rx, rz, cz

    def phi(s):
        d = 0.016 + 0.008 * s ** 4
        rx = shawl_r(lerp(y_low, Y_TOP, s))[0] + d
        return math.asin(min(0.97, lerp(0.07, 0.05, s) / rx))

    def shawl_fn(u, s, d):
        f = phi(s)
        th = f + u * (2 * math.pi - 2 * f)
        a = th if th <= math.pi else 2 * math.pi - th  # angle from the front
        yb = y_low + 0.04 * math.sin(a) ** 2 - 0.03 * max(0.0, math.cos(a)) ** 2
        y = yb + (Y_TOP - yb) * s
        rx, rz, cz = shawl_r(y)
        dd = d + 0.008 * s ** 4  # a soft roll where it lies round the neck
        return ((rx + dd) * math.sin(th), y, cz + (rz + dd) * math.cos(th))

    if hi:
        b = 0.035
        us = [0.0, b] + [b + (1 - 2 * b) * k / 16 for k in range(1, 16)] + [1 - b, 1.0]
        srows = [0.0, 0.08, 0.32, 0.55, 0.75, 0.9, 1.0]
    else:
        us = [k / 9 for k in range(10)]
        srows = [0.0, 0.5, 1.0]
    n_us = len(us)

    def shawl_col(p, m):
        if not m:
            return (SHAWL_MAIN,) * 3
        if m[0] == "in":
            return (SHAWL_INSIDE,) * 3
        if m[0] == "edge":
            return (SHAWL_BORDER,) * 3
        i, j = m[-2], m[-1]
        border = hi and (j == 0 or i == 0 or i == n_us - 2)
        th = math.atan2(p[0], p[2])
        fold = 1 - 0.07 * (0.5 + 0.5 * math.sin(9 * th + 8 * p[1])) * (CHEST + 0.04 - p[1]) / 0.2
        k = (SHAWL_BORDER if border else SHAWL_MAIN) * min(1.0, max(0.85, fold))
        return (k,) * 3

    if hi:
        P(shell(shawl_fn, us, srows, False, 0.016, 0.006), "spine", shawl_col, mat=1, closed=True)
    else:
        P(grid(lambda u, s: shawl_fn(u, s, 0.016), us, srows, False), "spine",
          lambda p, m: (SHAWL_MAIN,) * 3, mat=1)

    # Arms: the shawl over each shoulder, short kurta sleeves, round hands with the palms to the
    # sides.
    for side, upper, fore, hand_bone in ((1, "upperL", "foreL", "handL"), (-1, "upperR", "foreR", "handR")):
        J = W[upper]

        def cap_fn(u, v, d, J=J, side=side):
            lon = 2 * math.pi * u
            out_ = math.sin(lon) * side  # 1 on the outside of the arm, -1 towards the body
            r = 0.046 + d
            if v < 0.5:  # falls lowest on the outside of the arm, barely at all on the inside
                yb = -0.04 - 0.035 * out_
                y = yb * (1 - v / 0.5)
                rr = r * (1 - 0.06 * (1 - v / 0.5))
            else:  # a low dome, level with the shawl's shoulder line
                la = (v - 0.5) / 0.5 * (math.pi / 2)
                y = math.sin(la) * r * 0.6
                rr = math.cos(la) * r
            return (J.x + rr * math.sin(lon), J.y + y, J.z + rr * math.cos(lon))

        cap_rows = [0.0, 0.08, 0.35, 0.6, 0.8] if hi else [0.0, 0.5, 0.8]
        top = lambda d, J=J: (J.x, J.y + (0.046 + d) * 0.6, J.z)

        def cap_col(p, m):
            if m and m[0] == "in":
                return (SHAWL_INSIDE,) * 3
            if m and m[0] == "edge":
                return (SHAWL_BORDER,) * 3
            j = m[-1] if m else 1
            return ((SHAWL_BORDER if hi and j == 0 else SHAWL_MAIN),) * 3

        if hi:
            P(shell(cap_fn, ring_us(10), cap_rows, True, 0.009, 0.003, pole1=top), upper, cap_col,
              mat=1, closed=True)
        else:
            P(grid(lambda u, v: cap_fn(u, v, 0.009), ring_us(6), cap_rows, True, None, top(0.009)),
              upper, cap_col, mat=1)

        sleeve = thin([(-0.165, 0.036, 0.035), (-0.12, 0.039, 0.038), (-0.06, 0.042, 0.04),
                       (-0.02, 0.042, 0.04), (0.008, 0.036, 0.034)])
        P(lathe(sleeve, seg(10, 6), J, (0, -0.195, 0), (0, 0.022, 0)), upper,
          folds(KURTA, J, n=3, depth=0.04))
        F = W[fore]
        forearm = thin([(-0.145, 0.034, 0.033), (-0.13, 0.034, 0.033), (-0.11, 0.031, 0.031),
                        (-0.05, 0.035, 0.034), (0.0, 0.037, 0.036)])
        P(lathe(forearm, seg(10, 6), F, (0, -0.145, 0), (0, 0.03, 0)), fore,
          folds(KURTA, F, n=3, depth=0.04))
        H = W[hand_bone]
        hand = thin([(-0.085, 0.015, 0.03, 0, -0.002), (-0.065, 0.021, 0.038), (-0.04, 0.022, 0.04, 0, 0.002),
                     (-0.015, 0.02, 0.031), (0.015, 0.021, 0.025)])
        P(lathe(hand, seg(8, 5), H, (0, -0.1, -0.003), (0, 0.015, 0)), hand_bone, flat(SKIN, 0.01))
        if hi:
            P(ellipsoid((H.x - side * 0.005, H.y - 0.035, H.z + 0.033), (0.011, 0.02, 0.011), 6, 3),
              hand_bone, flat(SKIN, 0.01))

    # Legs: the dhoti (body 0) or salwar (body 1), and bare feet.
    for side, thigh, shin, foot in ((1, "thighL", "shinL", "footL"), (-1, "thighR", "shinR", "footR")):
        J = W[thigh]
        k = 1.07 if body["salwar"] else 1.0
        # The top leans in and stays under the kurta, so it never shows at the hips.
        rows = thin([(-0.2, 0.06 * k, 0.063 * k), (-0.16, 0.063 * k, 0.066 * k),
                     (-0.09, 0.068 * k, 0.072 * k), (-0.03, 0.066 * k, 0.07 * k, -side * 0.005, 0),
                     (0.0, 0.055, 0.06, -side * 0.01, 0)])
        P(lathe(rows, seg(12, 6), J, (0, -0.235, 0), (-side * 0.012, 0.012, 0)), thigh,
          folds(lower, J, n=5, depth=0.06))
        S = W[shin]
        if body["salwar"]:
            rows = [(-0.175, 0.04, 0.042), (-0.16, 0.042, 0.044), (-0.15, 0.04, 0.042),
                    (-0.09, 0.05, 0.052), (-0.03, 0.06, 0.063), (0.01, 0.065, 0.068)]
            ankle_top = -0.16
            cuff = -0.15
        else:
            rows = [(-0.16, 0.064, 0.066), (-0.145, 0.062, 0.064), (-0.09, 0.057, 0.059),
                    (-0.03, 0.058, 0.061), (0.01, 0.06, 0.063)]
            ankle_top = -0.14
            cuff = -0.145
        rows = thin(rows)
        leg_col = folds(lower, S, n=5, depth=0.06)
        P(lathe(rows, seg(12, 6), S, (0, rows[0][0], 0), (0, 0.035, 0)), shin,
          lambda p, m, S=S, cuff=cuff: scale(leg_col(p, m), 0.9) if p[1] - S.y < cuff + 0.002 else leg_col(p, m))
        ank = [(-0.19, 0.028, 0.032, 0, 0.004), (-0.175, 0.026, 0.028), (ankle_top, 0.027, 0.029)]
        P(lathe(ank, seg(8, 5), S, (0, -0.2, 0.005), (0, ankle_top, 0)), shin, flat(SKIN, 0.01))

        # A round foot along +z from its bone: (z, half width, top, sole), the toes turned a little in.
        Fp = W[foot]
        fr = [(-0.065, 0.026, 0.02, -0.027), (-0.05, 0.031, 0.036, -0.03), (-0.025, 0.034, 0.045, -0.03),
              (0.005, 0.037, 0.04, -0.03), (0.035, 0.041, 0.031, -0.03), (0.065, 0.043, 0.024, -0.03),
              (0.085, 0.041, 0.019, -0.029), (0.1, 0.034, 0.015, -0.027)]
        if not hi:
            fr = [fr[0], fr[2], fr[4], fr[6], fr[7]]

        def foot_fn(u, row, Fp=Fp, side=side):
            z, w, top_, sole = row
            a = 2 * math.pi * u
            ry = (top_ - sole) * 0.6
            y = max(sole, top_ - ry + ry * math.sin(a))
            cx = -side * 0.005 * max(0.0, (z - 0.05) / 0.05)
            return (Fp.x + cx + w * math.cos(a), Fp.y + y, Fp.z + z)

        P(grid(foot_fn, ring_us(seg(10, 6)), fr, True, (Fp.x, Fp.y - 0.008, Fp.z - 0.077),
               (Fp.x - side * 0.006, Fp.y - 0.012, Fp.z + 0.112)), foot, flat(SKIN, 0.01))

    # Neck and head: ears, a small nose and hair; no eyes, mouth, tilak or other marks.
    neck = thin([(NECK - 0.01, 0.045, 0.045), (NECK + 0.01, 0.043, 0.043, 0, 0.003),
                 (NECK + 0.035, 0.042, 0.043, 0, 0.005), (NECK + 0.05, 0.04, 0.042, 0, 0.005)])
    P(lathe(neck, seg(10, 6), (0, 0, 0), ring_centre(neck[0]), ring_centre(neck[-1])), "head",
      flat(SKIN, 0.01))
    lat_n = seg(12, 7)
    lats = [-math.pi / 2 + math.pi * (j + 1) / (lat_n + 1) for j in range(lat_n)]
    P(grid(lambda u, la: head_pt(la, 2 * math.pi * u), ring_us(seg(18, 10)), lats, True,
           head_pt(-math.pi / 2, 0), head_pt(math.pi / 2, 0)), "head", flat(SKIN, 0.01))
    hx, hy, hz = HEAD_C
    nz = hz + HEAD_R[2]  # the face, straight ahead of the centre
    P(hull([(0, hy - 0.004, nz - 0.006), (0, hy - 0.026, nz + 0.012), (0.012, hy - 0.032, nz - 0.003),
            (-0.012, hy - 0.032, nz - 0.003), (0, hy - 0.034, nz - 0.008)]), "head",
      flat(scale(SKIN, 0.97), 0), closed=True)
    if hi:
        for s in (1, -1):
            P(ellipsoid((s * (HEAD_R[0] - 0.004), hy - 0.01, hz - 0.012), (0.016, 0.032, 0.024), 6, 3),
              "head", flat(scale(SKIN, 0.95), 0))
    hl = (0.45, 0.1, -0.45) if bi == 0 else (0.42, -0.05, -0.62)
    infl = 0.009 if bi == 0 else 0.012
    hrows = [k / seg(6, 3) * 0.9 for k in range(seg(6, 3) + 1)]

    def hair_fn(u, v):
        lon = 2 * math.pi * u
        l0 = hairline(lon, *hl)
        return head_pt(l0 + (math.pi / 2 - l0) * v, lon, infl, back=0.06)

    P(grid(hair_fn, ring_us(seg(18, 10)), hrows, True, None, head_pt(math.pi / 2, 0, infl)), "head",
      flat(HAIR, 0.02))
    if bi == 1:
        P(ellipsoid((0, hy + 0.04, hz - HEAD_R[2] - 0.035), (0.066, 0.058, 0.05), seg(8, 5), seg(4, 2)),
          "head", flat(scale(HAIR, 0.9), 0))
    return out.bm


# --- Scene objects ---------------------------------------------------------------------------------


def material(name, preview_tint=None):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.use_backface_culling = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    for n in [n for n in nodes if n.type not in ("BSDF_PRINCIPLED", "OUTPUT_MATERIAL")]:
        nodes.remove(n)
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = 0.9
    bsdf.inputs["Metallic"].default_value = 0.0
    attr = nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Col"
    attr.location = (bsdf.location.x - 400, bsdf.location.y)
    if preview_tint:
        mix = nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        mix.location = (bsdf.location.x - 200, bsdf.location.y)
        sock = lambda socks, ident: next(x for x in socks if x.identifier == ident)
        links.new(attr.outputs["Color"], sock(mix.inputs, "A_Color"))
        sock(mix.inputs, "B_Color").default_value = (*preview_tint, 1.0)
        links.new(sock(mix.outputs, "Result_Color"), bsdf.inputs["Base Color"])
    else:
        links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def clear_old():
    for o in list(bpy.data.objects):
        if o.name.startswith(("avatar-", "body0-", "body1-", "rig0", "rig1")):
            bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        if m.users == 0:
            bpy.data.meshes.remove(m)
    for a in list(bpy.data.armatures):
        if a.users == 0:
            bpy.data.armatures.remove(a)


def make_rig(bi):
    body = BODIES[bi]
    W = rest_world(body)
    arm = bpy.data.armatures.new(f"rig{bi}")
    obj = bpy.data.objects.new(f"rig{bi}", arm)
    bpy.context.scene.collection.objects.link(obj)
    obj.show_in_front = True
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    eb = {}
    for name in BONES:
        b = arm.edit_bones.new(f"b{bi}-{name}")
        h = Vector(to_blender(W[name]))
        b.head = h
        b.tail = h + Vector((0, 0, 0.05))
        b.use_deform = True
        p = PARENT.get(name)
        if p:
            b.parent = eb[p]
        eb[name] = b
    bpy.ops.object.mode_set(mode="OBJECT")
    return obj


def make_mesh(bi, detail, rig, mats):
    bm = build(bi, detail)
    me = bpy.data.meshes.new(f"body{bi}-{detail}")
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    obj = bpy.data.objects.new(f"body{bi}-{detail}", me)
    bpy.context.scene.collection.objects.link(obj)
    for name in BONES:
        obj.vertex_groups.new(name=f"b{bi}-{name}")
    obj.parent = rig
    mod = obj.modifiers.new("rig", "ARMATURE")
    mod.object = rig
    try:
        me.set_sharp_from_angle(angle=math.radians(75))
    except AttributeError:
        pass
    return obj


# --- Preview poses (from Avatar.update in avatar.ts) -------------------------------------------------


def euler(rx, ry, rz, order):
    R = {"X": Matrix.Rotation(rx, 4, "X"), "Y": Matrix.Rotation(ry, 4, "Y"), "Z": Matrix.Rotation(rz, 4, "Z")}
    return R[order[0]] @ R[order[1]] @ R[order[2]]


def pose_matrices(body, pose):
    loc = rest_local(body)
    W = rest_world(body)
    world, skin = {}, {}
    for name in BONES:
        spec = pose.get(name, {})
        pos = Vector(spec.get("pos", loc[name]))
        rot = spec.get("rot", (0, 0, 0))
        sc = spec.get("scale", (1, 1, 1))
        local = Matrix.Translation(pos) @ euler(*rot, EULER_ORDER.get(name, "XYZ")) @ Matrix.Diagonal((*sc, 1))
        p = PARENT.get(name)
        world[name] = (world[p] @ local) if p else local
        skin[name] = world[name] @ Matrix.Translation(W[name]).inverted()
    return skin


# Joined palms (avatar.ts NAMASTE_POSE, PRANAM_POSE): upper arm (x, z), forearm (x, z), wrist
# (x, y, z), for the left arm; the right mirrors it.
NAMASTE = ((-0.724, -0.104), (-1.131, -0.907), (-0.87, -0.867, 0.467))
PRANAM = ((-1.749, -0.367), (-0.716, -0.251), (-0.515, -0.491, 0.319))
# Seated, hands resting in the lap (avatar.ts): upper arm (x, z), forearm (x, z) for the left arm.
LAP = ((-0.55, -0.18), (-1.05, -0.35))
SWING = 0.5  # walking leg swing (avatar.ts)


def poses(bi):
    out = {}
    out["idle"] = {"head": {"rot": (0.02, 0, 0)}, "upperL": {"rot": (0, 0, 0.07)},
                   "upperR": {"rot": (0, 0, -0.07)}, "foreL": {"rot": (-0.12, 0, 0)},
                   "foreR": {"rot": (-0.12, 0, 0)}}
    ph = math.pi / 4
    sw, kl, asw = math.sin(ph) * SWING, max(0, math.cos(ph)) * 0.75, math.sin(ph) * 0.32
    out["walk"] = {"spine": {"rot": (0, math.sin(ph) * 0.06, 0)}, "head": {"rot": (0.02, 0, 0)},
                   "thighL": {"rot": (-sw, 0, 0)}, "thighR": {"rot": (sw, 0, 0)},
                   "shinL": {"rot": (kl, 0, 0)},
                   "upperL": {"rot": (asw, 0, 0.07)}, "upperR": {"rot": (-asw, 0, -0.07)},
                   "foreL": {"rot": (-0.27, 0, 0)}, "foreR": {"rot": (-0.27, 0, 0)}}
    (lux, luz), (lfx, lfz) = LAP
    out["sit"] = {"hips": {"pos": (0, SEATED_HIP, 0)}, "head": {"rot": (0.08, 0, 0)},
                  "skirt": {"scale": (1, 0.35, 1)},
                  "thighL": {"rot": (-1.36, 0.95, 0)}, "thighR": {"rot": (-1.36, -0.95, 0)},
                  "shinL": {"rot": (-0.15, 0, -2.3)}, "shinR": {"rot": (0.12, 0, 2.3)},
                  "footL": {"rot": (1.4, 0, 0)}, "footR": {"rot": (1.4, 0, 0)},
                  "upperL": {"rot": (lux, 0, luz)}, "upperR": {"rot": (lux, 0, -luz)},
                  "foreL": {"rot": (lfx, 0, lfz)}, "foreR": {"rot": (lfx, 0, -lfz)}}

    def palms(ul, fl, hand):
        o = BODIES[bi]["palms_out"]
        return {"upperL": {"rot": (ul[0], 0, ul[1])}, "upperR": {"rot": (ul[0], 0, -ul[1])},
                "foreL": {"rot": (fl[0], 0, fl[1] + o)}, "foreR": {"rot": (fl[0], 0, -fl[1] - o)},
                "handL": {"rot": hand}, "handR": {"rot": (hand[0], -hand[1], -hand[2])}}

    out["namaste"] = {"head": {"rot": (0.22, 0, 0)}, **palms(*NAMASTE)}
    out["pranam"] = {"spine": {"rot": (0.42, 0, 0)}, "head": {"rot": (0.22, 0, 0)}, **palms(*PRANAM)}
    out["bell"] = {"head": {"rot": (0.02, 0, 0)}, "upperL": {"rot": (0, 0, 0.07)},
                   "upperR": {"rot": (-2.75, 0, 0.12)}, "foreL": {"rot": (-0.12, 0, 0)},
                   "foreR": {"rot": (-0.35, 0, 0)}}
    return out


def make_preview(src, bi, name, pose, at, mats):
    body = BODIES[bi]
    skin = pose_matrices(body, pose)
    me = src.data.copy()
    me.name = f"avatar-{name}"
    groups = {i: n.split("-", 1)[1] for i, n in enumerate(g.name for g in src.vertex_groups)}
    for v in me.vertices:
        bone = groups[v.groups[0].group]
        p = skin[bone] @ Vector(to_three(v.co))
        v.co = to_blender(p)
    for k, m in enumerate(mats):  # replacing slots keeps each face's material index
        me.materials[k] = m
    obj = bpy.data.objects.new(f"avatar-{name}", me)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = at
    obj.scale = (body["scale"],) * 3
    return obj


# --- Run -------------------------------------------------------------------------------------------

clear_old()
mats = [material("avatar-body"), material("avatar-shawl")]
rigs, meshes = [], []
for bi in (0, 1):
    rig = make_rig(bi)
    rig.location = SHOW_AT + Vector((bi * 1.0, 0, 0))
    rigs.append(rig)
    for detail in ("high", "low"):
        obj = make_mesh(bi, detail, rig, mats)
        meshes.append(obj)
        tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        zs = [v.co.z for v in obj.data.vertices]
        print(f"body{bi}-{detail}: {tris} triangles, {len(obj.data.vertices)} vertices, "
              f"height {min(zs):.3f}..{max(zs):.3f} (x{BODIES[bi]['scale']} in the code)")

if EXPORT and HERE:
    for o in bpy.context.selected_objects:
        o.select_set(False)
    saved = [r.location.copy() for r in rigs]
    for r in rigs:
        r.location = (0, 0, 0)
    for o in rigs + meshes:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = rigs[0]
    out = os.path.join(HERE, "avatar.glb")
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_cameras=False,
        export_lights=False,
        export_normals=True,
        export_vertex_color="MATERIAL",
        export_skins=True,
        export_animations=False,
        export_def_bones=False,
        export_leaf_bone=False,
        export_rest_position_armature=True,
    )
    for r, s in zip(rigs, saved):
        r.location = s
    for o in rigs + meshes:
        o.select_set(False)
    print("exported", out)

for o in meshes:
    o.hide_set(o.name.endswith("low"))

if PREVIEW:
    tints = [hexcol("#36426b"), hexcol("#7a2e2e")]
    for bi in (0, 1):
        pm = [material("avatar-preview-body"), material(f"avatar-preview-shawl{bi}", tints[bi])]
        src = next(o for o in meshes if o.name == f"body{bi}-high")
        for k, (pname, pose) in enumerate(poses(bi).items()):
            at = SHOW_AT + Vector((2.6 + k * 0.85, -2.0 - bi * 1.6, 0))
            make_preview(src, bi, f"{bi}-{pname}", pose, at, pm)
        low = next(o for o in meshes if o.name == f"body{bi}-low")
        make_preview(low, bi, f"{bi}-low", poses(bi)["idle"],
                     SHOW_AT + Vector((2.6 + 6 * 0.85, -2.0 - bi * 1.6, 0)), pm)
