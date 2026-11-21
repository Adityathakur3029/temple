"""
Sannidhi Nandi, the `nandi` slot in spec 11: a TEST MODEL for this computer only.

Made by Claude (AI) in Blender 5.2 by this script, under the owner's temporary exception of
2026-11-08 (spec 08 § Depiction, "AI-made test models"): it is tried in the temple on the owner's
own computer to work out the size and decoration to ask a human maker for. It is never deployed:
slots.json says "ai": true and "interim": true, and `npm run deploy:web` refuses a manifest with a
model tagged both `sacred` and `ai`. Screenshots of it aren't published.

Run inside Blender (Scripting tab, or the MCP connector):
    path = r"<repo>/assets-src/models/nandi/make_nandi.py"
    exec(compile(open(path, encoding="utf-8").read(), path, "exec"), {"__file__": path})
It replaces any earlier "nandi" object and, if EXPORT is set, writes nandi.glb next to itself.
It takes about a minute (three voxel remeshes).

The figure: a traditional seated (recumbent) bull, calm, head up and looking straight ahead to
the sanctum, with natural proportions: a zebu hump, a deep dewlap, short horns curving out and
up, long ears. The right foreleg is drawn up with its hoof planted (ready to rise and serve),
the left one folded under; the hind legs fold at the sides with the hocks behind and the tail
curled round the left hind leg. Carved stone ornaments: a band across the forehead with a round
pendant, a collar with seven bells at the throat, and a girth band behind the hump. A marigold
garland round the neck (GARLAND). Old dark stone, oiled darker where hands touch (ears, muzzle,
forehead, hump), shadowed in the hollows, with a little lichen low down; weathered but never
chipped or broken. Seated on a low carved base slab. No rider, no face paint, no copy of any
real temple's Nandi.

Frame: Blender metres, z up, origin at the bottom centre; -y is the front (glTF +z), the way he
faces. The slot turns him half round on his platform at world (0, 0.5, 22.05) to face the
sanctum (-z). He is built in a working frame P(x, f, h) (f forward, h up) and at the end scaled
so his length (the back of the base slab to the muzzle) is exactly 1.6 m, the slot's size.

How: the body is a set of ellipsoids and tapered tubes, merged and rounded by voxel remeshes and
smoothing (big masses first, then limbs and head, then details), reduced to a triangle budget,
given low-poly carved ornaments and coloured per vertex (stone, ambient occlusion, wear).
One material with vertex colours: one draw call, no textures.
"""
import math
import os
import random

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector, noise
from mathutils.bvhtree import BVHTree

EXPORT = True
GARLAND = True  # the marigold garland round the neck
NAME = "nandi"
HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else None
LENGTH = 1.6  # the slot's size along its front axis
MAX_TRIS = 8_000  # spec 11: Nandi <= 8k, and sacred forms keep all of it on Lite
BODY_TRIS = 5_300  # the rest is for the base and the ornaments

random.seed(108)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexcol(h):
    h = h.lstrip("#")
    return Vector(tuple(srgb_to_linear(int(h[i : i + 2], 16) / 255) for i in (0, 2, 4)))


PAL = {
    "stone": hexcol("#57524c"),  # old dark stone
    "stoneLight": hexcol("#6d665c"),
    "stoneDark": hexcol("#3e3a35"),
    "oiled": hexcol("#2e2a27"),  # worn smooth and dark by hands and oil
    "dust": hexcol("#857e73"),  # pale residue in the hollows
    "lichen": hexcol("#6c6e53"),
    "base": hexcol("#645e56"),
    "marigold": hexcol("#e07b1a"),
    "marigoldDeep": hexcol("#c95a1b"),
    "marigoldYellow": hexcol("#e9a82a"),
}


def P(x, f, h):
    """Working point (x across, f forward, h up) to Blender."""
    return Vector((x, -f, h))


def frame(d, side=Vector((1, 0, 0))):
    """A rotation whose local z runs along d, with local x as close to `side` as possible."""
    z = d.normalized()
    if abs(side.dot(z)) > 0.95:
        side = Vector((0, 0, 1)) if abs(z.z) < 0.95 else Vector((1, 0, 0))
    x = (side - z * side.dot(z)).normalized()
    y = z.cross(x)
    m = Matrix.Identity(4)
    for i in range(3):
        m[i][0], m[i][1], m[i][2] = x[i], y[i], z[i]
    return m


def axes(m):
    return [Vector((m[0][i], m[1][i], m[2][i])) for i in range(3)]


def rot(x=0.0, y=0.0, z=0.0):
    """Euler rotation in degrees, as a 4x4 matrix."""
    return Euler((math.radians(x), math.radians(y), math.radians(z))).to_matrix().to_4x4()


# --- Primitive shapes ------------------------------------------------------------------------------
def ellipsoid(bm, c, r, rot=None, seg=24, rings=14):
    """An ellipsoid at Blender point c with radii r (local x, y, z), turned by the matrix rot."""
    m = Matrix.Translation(c) @ (rot or Matrix.Identity(4)) @ Matrix.Diagonal((*r, 1))
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1.0, matrix=m)


def ellipsoid_between(bm, a, b, wx, wy, side=Vector((1, 0, 0)), seg=20, rings=12):
    """An ellipsoid with its long axis from a to b, local x half-width wx, local y half-depth wy."""
    ellipsoid(bm, (a + b) / 2, (wx, wy, (b - a).length / 2), frame(b - a, side), seg, rings)


def tube(bm, pts, radii, seg=16, flat=1.0):
    """A tapered tube through Blender points with a radius at each, with round ends. `flat`
    squashes the local x radius (1 = round)."""
    n = len(pts)
    rings = []
    side = Vector((1, 0, 0))
    for i in range(n):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        sx, sy, _ = axes(frame(t, side))
        side = sx
        rings.append([bm.verts.new(pts[i] + sx * (math.cos(a) * radii[i] * flat) + sy * (math.sin(a) * radii[i]))
                      for a in (2 * math.pi * k / seg for k in range(seg))])
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(seg):
            bm.faces.new([r0[k], r0[(k + 1) % seg], r1[(k + 1) % seg], r1[k]])
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    for i in (0, n - 1):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        ellipsoid(bm, pts[i], (radii[i] * flat, radii[i], radii[i]), frame(t), seg, max(6, seg // 2))


def spline(ctrl, steps=6):
    """Catmull-Rom through control points (Blender Vectors), for smooth tubes."""
    out = []
    pts = [ctrl[0]] + list(ctrl) + [ctrl[-1]]
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        for s in range(steps):
            t = s / steps
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t))
    out.append(ctrl[-1])
    return out


def lerp_radii(rs, n):
    """Radii given at the control points, spread over n spline points."""
    out = []
    for i in range(n):
        u = i / (n - 1) * (len(rs) - 1)
        k = min(int(u), len(rs) - 2)
        out.append(rs[k] + (rs[k + 1] - rs[k]) * (u - k))
    return out


def limb(bm, ctrl, rs, seg=14, flat=1.0):
    pts = spline([P(*c) for c in ctrl])
    tube(bm, pts, lerp_radii(rs, len(pts)), seg=seg, flat=flat)


# --- Sculpting by remeshing ---------------------------------------------------------------------------
def bake(bm, mods, name="nandi-tmp"):
    """Run modifiers on a bmesh and return the result as a new bmesh."""
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for kind, props in mods:
        m = ob.modifiers.new(kind.lower(), kind)
        for k, v in props.items():
            setattr(m, k, v)
    ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get())
    out = bmesh.new()
    out.from_mesh(ev.to_mesh())
    ev.to_mesh_clear()
    bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.meshes.remove(me)
    return out


def remesh(voxel, smooth=0, factor=0.5):
    mods = [("REMESH", {"mode": "VOXEL", "voxel_size": voxel, "adaptivity": 0.0})]
    if smooth:
        mods.append(("SMOOTH", {"factor": factor, "iterations": smooth}))
    return mods


# ===================================================================================================
# 1. Big masses: torso, chest, rump, neck, haunches. Remeshed coarse and smoothed a lot, so they
#    flow into each other like one carved block.
# ===================================================================================================
mass = bmesh.new()
E = lambda c, r, **k: ellipsoid(mass, P(*c), r, **k)  # noqa: E731

E((0, -0.10, 0.33), (0.30, 0.52, 0.29))  # torso, resting on the base
E((0, 0.24, 0.40), (0.255, 0.21, 0.30))  # chest and shoulders
E((0, -0.43, 0.38), (0.27, 0.22, 0.25))  # rump
E((0, 0.22, 0.70), (0.13, 0.13, 0.14), rot=rot(x=-15))  # root of the hump
# Neck: short and massive, rising forward to the head, below the line of the hump.
limb(mass, [(0, 0.24, 0.55), (0, 0.37, 0.66), (0, 0.48, 0.77)], [0.21, 0.175, 0.14], seg=18, flat=0.85)
ellipsoid_between(mass, P(0, 0.50, 0.70), P(0, 0.38, 0.22), 0.08, 0.13)  # root of the dewlap
# Haunches, where the hind legs fold at the sides.
for s in (-1, 1):
    ellipsoid_between(mass, P(s * 0.20, -0.52, 0.44), P(s * 0.25, -0.17, 0.16), 0.13, 0.17,
                      side=Vector((0, 0, 1)))
body = bake(mass, remesh(0.015, smooth=30, factor=0.6))
mass.free()

# ===================================================================================================
# 2. Hump, dewlap, limbs, head and tail, on the masses. Remeshed finer, smoothed moderately.
# ===================================================================================================
B = lambda c, r, **k: ellipsoid(body, P(*c), r, **k)  # noqa: E731
B((0, 0.215, 0.785), (0.125, 0.13, 0.13), rot=rot(x=-20))  # hump (kakud), leaning back a little
# Dewlap: a deep fold from the throat down to the chest between the forelegs.
ellipsoid_between(body, P(0, 0.565, 0.70), P(0, 0.43, 0.15), 0.05, 0.115)
# Forelegs. Right (x -): drawn up, forearm forward, hoof planted. Left (x +): folded under.
limb(body, [(-0.17, 0.24, 0.27), (-0.20, 0.40, 0.22), (-0.21, 0.52, 0.20)], [0.10, 0.075, 0.06])
limb(body, [(-0.21, 0.52, 0.20), (-0.21, 0.545, 0.11), (-0.205, 0.56, 0.05)], [0.058, 0.045, 0.042])
limb(body, [(0.17, 0.24, 0.25), (0.20, 0.40, 0.13), (0.20, 0.47, 0.075)], [0.10, 0.075, 0.062])
limb(body, [(0.20, 0.47, 0.075), (0.19, 0.38, 0.05), (0.18, 0.31, 0.045)], [0.058, 0.045, 0.04])
# Hind legs: the gaskin back to the hock, then the cannon forward along the ground.
for s in (-1, 1):
    limb(body, [(s * 0.27, -0.20, 0.17), (s * 0.30, -0.45, 0.13), (s * 0.31, -0.615, 0.095)],
         [0.085, 0.068, 0.055])
    limb(body, [(s * 0.31, -0.615, 0.095), (s * 0.33, -0.48, 0.055), (s * 0.34, -0.32, 0.045)],
         [0.05, 0.042, 0.04])
# Head: a broad forehead, then the face down to the muzzle; held up, looking ahead.
limb(body, [(0, 0.50, 0.93), (0, 0.57, 0.86), (0, 0.635, 0.76), (0, 0.68, 0.685)],
     [0.13, 0.12, 0.10, 0.093], seg=18, flat=0.95)
B((0, 0.52, 0.935), (0.135, 0.085, 0.072))  # poll and forehead top
for s in (-1, 1):
    B((s * 0.065, 0.53, 0.82), (0.065, 0.095, 0.085))  # cheeks
B((0, 0.695, 0.665), (0.10, 0.075, 0.08))  # muzzle
# Tail: from the tail head down the rump, round behind the left hock and forward on the ground.
limb(body, [(0, -0.585, 0.55), (0, -0.635, 0.44), (0.02, -0.655, 0.26), (0.12, -0.66, 0.085),
            (0.28, -0.655, 0.05), (0.39, -0.53, 0.045), (0.415, -0.39, 0.045)],
     [0.032, 0.029, 0.026, 0.024, 0.022, 0.02, 0.018], seg=10)
body2 = bake(body, remesh(0.009, smooth=8, factor=0.5))
body.free()
body = body2

# ===================================================================================================
# 3. Details: hooves, horns, ears, eyes, nostrils, tail tuft. Remeshed fine, smoothed lightly.
# ===================================================================================================
D = lambda c, r, **k: ellipsoid(body, P(*c), r, **k)  # noqa: E731
for s in (-1, 1):
    D((s * 0.036, 0.745, 0.655), (0.03, 0.022, 0.024))  # nostrils
    # Eyes: calm, half-lidded almonds under a soft brow.
    D((s * 0.108, 0.585, 0.875), (0.022, 0.032, 0.017), rot=rot(x=-35))
    D((s * 0.105, 0.58, 0.892), (0.027, 0.04, 0.013), rot=rot(x=-35))
    # Ears: long and broad, hanging down and out, the open side forward.
    ellipsoid_between(body, P(s * 0.11, 0.515, 0.895), P(s * 0.275, 0.565, 0.745), 0.017, 0.058,
                      side=Vector((0, -1, 0)))
    # Horns: thick at the root, out and up, rounded tips.
    limb(body, [(s * 0.065, 0.505, 0.975), (s * 0.125, 0.495, 1.03), (s * 0.16, 0.485, 1.09),
                (s * 0.165, 0.495, 1.14)], [0.038, 0.031, 0.022, 0.012], seg=12)
# Hooves, cloven: two toes each.
for c in [(-0.205, 0.575, 0.035), (0.175, 0.29, 0.035), (-0.335, -0.30, 0.035), (0.335, -0.30, 0.035)]:
    for t in (-1, 1):
        D((c[0] + t * 0.022, c[1] + 0.02, c[2]), (0.024, 0.04, 0.032))
D((0.418, -0.34, 0.045), (0.034, 0.075, 0.03))  # tail tuft
body2 = bake(body, remesh(0.006, smooth=2, factor=0.5))
body.free()
body = body2

# ===================================================================================================
# 4. Set him on the base slab, drop what the slab hides, and reduce to the triangle budget.
# ===================================================================================================
BASE_H = 0.07  # top of the carved base slab


def Q(x, f, h):
    """A working point on the figure once it stands on the base slab."""
    return P(x, f, h + BASE_H)


bmesh.ops.translate(body, verts=body.verts, vec=(0, 0, BASE_H))
hidden = [f for f in body.faces if all(v.co.z < BASE_H - 0.004 for v in f.verts)]
bmesh.ops.delete(body, geom=hidden, context="FACES")
tris = sum(len(f.verts) - 2 for f in body.faces)
bm = bake(body, [("DECIMATE", {"decimate_type": "COLLAPSE", "ratio": BODY_TRIS / tris,
                                "use_collapse_triangulate": True})])
body.free()
bmesh.ops.triangulate(bm, faces=bm.faces[:])
print(f"body: {tris} -> {len(bm.faces)} triangles")

bm.verts.ensure_lookup_table()
bvh = BVHTree.FromBMesh(bm)
KIND = {}  # vertex index -> kind, for colouring; the body's vertices aren't listed


def mark(start, kind):
    bm.verts.ensure_lookup_table()
    for i in range(start, len(bm.verts)):
        KIND[i] = kind


# --- Base slab: a moulded pitha with rounded corners --------------------------------------------------
xs = [v.co.x for v in bm.verts]
ys = [v.co.y for v in bm.verts if v.co.z < BASE_H + 0.06]
BX = max(-min(xs), max(xs)) + 0.045
BY0, BY1 = min(ys) - 0.04, max(ys) + 0.045  # Blender y: the front is -y


def rounded_rect(x, y0, y1, r, z, n=4):
    cy, hy = (y0 + y1) / 2, (y1 - y0) / 2
    pts = []
    for cx_, cy_, a0 in ((x - r, cy + hy - r, 0), (-(x - r), cy + hy - r, 90), (-(x - r), cy - hy + r, 180),
                         (x - r, cy - hy + r, 270)):
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n)
            pts.append(bm.verts.new((cx_ + r * math.cos(a), cy_ + r * math.sin(a), z)))
    return pts


v0 = len(bm.verts)
TIERS = [  # (inset, z): a foot, a fillet, the body of the slab, a chamfer to the top
    (0.0, 0.0), (0.0, 0.026), (0.012, 0.034), (0.018, 0.036), (0.018, BASE_H - 0.01), (0.026, BASE_H),
]
loops = [rounded_rect(BX - i, BY0 + i, BY1 - i, 0.09 - i, z) for i, z in TIERS]
for l0, l1 in zip(loops, loops[1:]):
    n = len(l0)
    for k in range(n):
        bm.faces.new([l0[k], l0[(k + 1) % n], l1[(k + 1) % n], l1[k]])
bmesh.ops.triangulate(bm, faces=[bm.faces.new(loops[-1])])
mark(v0, "base")


# --- Surface helpers for the ornaments -------------------------------------------------------------
def ring(center, normal, n=160, a0=0.0, a1=360.0, up=Vector((0, 0, 1))):
    """Where a ring in the plane through `center` with normal `normal` meets the outer surface,
    found by casting rays in from outside; 0 degrees is towards `up`. [(point, normal)]."""
    nrm = normal.normalized()
    u = (up - nrm * up.dot(nrm)).normalized()
    w = nrm.cross(u)
    out = []
    full = a1 - a0 >= 360
    for k in range(n if full else n + 1):
        a = math.radians(a0 + (a1 - a0) * k / n)
        d = u * math.cos(a) + w * math.sin(a)
        hit = bvh.ray_cast(center + d * 1.5, -d)
        if hit[0] is not None:
            out.append((hit[0], hit[1]))
    return out


def project(points, direction):
    """Points cast onto the surface along `direction`. [(point, normal)]."""
    out = []
    for p in points:
        hit = bvh.ray_cast(p - direction * 0.5, direction)
        if hit[0] is not None:
            out.append((hit[0], hit[1]))
    return out


def resample(pts, step, closed=False):
    """Evenly spaced (point, normal) pairs along a polyline of (point, normal)."""
    if closed:
        pts = pts + [pts[0]]
    out, carry = [], 0.0
    for (a, na), (b, nb) in zip(pts, pts[1:]):
        seg = (b - a).length
        t = carry
        while t <= seg and seg > 1e-9:
            f = t / seg
            out.append((a.lerp(b, f), na.lerp(nb, f).normalized()))
            t += step
        carry = t - seg
    return out


def band(path, width, height, closed=False, kind="carved"):
    """A raised carved strap along (point, normal) pairs, rounded on top."""
    v0 = len(bm.verts)
    secs = []
    n = len(path)
    for i, (p, nr) in enumerate(path):
        if closed:
            t = path[(i + 1) % n][0] - path[i - 1][0]
        else:
            t = path[min(i + 1, n - 1)][0] - path[max(i - 1, 0)][0]
        t.normalize()
        nr = (nr - t * nr.dot(t)).normalized()
        b = t.cross(nr)
        secs.append([bm.verts.new(p + b * (s_ * width / 2) + nr * h_)
                     for s_, h_ in ((-1, -0.004), (-0.75, height), (0.75, height), (1, -0.004))])
    pairs = list(zip(secs, secs[1:])) + ([(secs[-1], secs[0])] if closed else [])
    for s0, s1 in pairs:
        for k in range(3):
            bm.faces.new([s0[k], s0[k + 1], s1[k + 1], s1[k]])
    if not closed:
        bm.faces.new(list(reversed(secs[0])))
        bm.faces.new(secs[-1])
    mark(v0, kind)


def bead(p, nr, r, kind, sides=6, lift=0.55):
    """A bead, boss or flower: a double cone facing out along nr (2 x sides triangles)."""
    v0 = len(bm.verts)
    x, y, _ = axes(frame(nr))
    c = p + nr * r * lift
    turn = random.uniform(0, math.pi)
    rim = [bm.verts.new(c + (x * math.cos(turn + k * 2 * math.pi / sides)
                             + y * math.sin(turn + k * 2 * math.pi / sides)) * r) for k in range(sides)]
    tip = bm.verts.new(c + nr * r * 0.75)
    back = bm.verts.new(c - nr * r * 0.7)
    for k in range(sides):
        bm.faces.new([rim[k], rim[(k + 1) % sides], tip])
        bm.faces.new([rim[(k + 1) % sides], rim[k], back])
    mark(v0, kind)


def rosette(p, nr, r, h, petals=8):
    """A flat carved flower medallion lying on the surface: scalloped rim, domed centre."""
    v0 = len(bm.verts)
    x, y, _ = axes(frame(nr))
    n = petals * 2
    rim = [bm.verts.new(p + (x * math.cos(2 * math.pi * k / n) + y * math.sin(2 * math.pi * k / n))
                        * (r if k % 2 == 0 else r * 0.78) + nr * 0.002) for k in range(n)]
    mid = [bm.verts.new(p + (x * math.cos(2 * math.pi * k / n) + y * math.sin(2 * math.pi * k / n))
                        * r * 0.5 + nr * h) for k in range(n)]
    top = bm.verts.new(p + nr * h * 1.5)
    for k in range(n):
        bm.faces.new([rim[k], rim[(k + 1) % n], mid[(k + 1) % n], mid[k]])
        bm.faces.new([mid[k], mid[(k + 1) % n], top])
    mark(v0, "carved")


def bell(top, nr, h, sides=8):
    """A carved bell hanging straight down from `top`, against the surface with normal nr."""
    v0 = len(bm.verts)
    flat = Vector((nr.x, nr.y, 0))
    out = flat.normalized() if flat.length > 0.2 else nr
    c = top + out * h * 0.36
    prof = [(0.13, -0.02), (0.2, -0.12), (0.3, -0.35), (0.36, -0.62), (0.47, -0.88), (0.5, -1.0),
            (0.38, -0.98)]
    apex = bm.verts.new(c + Vector((0, 0, 0.03 * h)))
    rings = [[bm.verts.new(c + Vector((r_ * h * math.cos(2 * math.pi * k / sides),
                                       r_ * h * math.sin(2 * math.pi * k / sides), z_ * h)))
              for k in range(sides)] for r_, z_ in prof]
    for k in range(sides):
        bm.faces.new([apex, rings[0][(k + 1) % sides], rings[0][k]])
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(sides):
            bm.faces.new([r0[k], r1[k], r1[(k + 1) % sides], r0[(k + 1) % sides]])
    bm.faces.new(list(reversed(rings[-1])))
    mark(v0, "carved")


# ===================================================================================================
# 5. Ornaments, carved in the same stone, and the garland.
# ===================================================================================================
# --- Forehead band: across the brow below the horns, dipping to a round pendant ------------------------
face_up = (Q(0, 0.51, 0.93) - Q(0, 0.60, 0.75)).normalized()  # up the face, towards the poll
face_out = Vector((0, -1, 0)) - face_up * Vector((0, -1, 0)).dot(face_up)
face_out.normalize()  # out of the forehead, forward and up
REF = Q(0, 0.545, 0.925)  # mid-brow, above the eyes and below the horns
fh = project([REF + Vector((x, 0, 0)) + face_up * (0.035 - 0.065 * (1 - (x / 0.09) ** 2))
              for x in (i / 24 * 0.18 - 0.09 for i in range(25))], -face_out)
band(resample(fh, 0.012), 0.026, 0.01)
for p, nr in project([REF + face_up * -0.066], -face_out):
    rosette(p, nr, 0.036, 0.012)  # the medallion between the eyes
for k in range(3):
    for p, nr in project([REF + face_up * (-0.112 - 0.022 * k)], -face_out):
        bead(p, nr, 0.011 - 0.002 * k, "carved", sides=6, lift=0.3)  # a short drop below it

# --- Collar round the upper neck, with seven bells at the throat ---------------------------------------
collar = resample(ring(Q(0, 0.45, 0.72), Vector((0, -0.26, 0.17)), n=180), 0.018, closed=True)
band(collar, 0.04, 0.013, closed=True)
front = min(collar, key=lambda q: q[0].y)  # the most forward point (-y)
bells = [front]
near = [q for q in collar if q[0].z < front[0].z + 0.16 and q[0].y < front[0].y + 0.2]
for side in (-1, 1):
    pts = [q for q in near if side * q[0].x > 0.01]
    for k in (1, 2, 3):
        bells.append(min(pts, key=lambda q: abs(abs(q[0].x) - 0.058 * k)))
for i, (p, nr) in enumerate(bells):
    bell(p + Vector((0, 0, -0.008)), nr, 0.085 if i == 0 else 0.058)

# --- Girth band round the barrel behind the hump --------------------------------------------------------
girth = [q for q in ring(Q(0, 0.03, 0.36), Vector((0, 1, 0)), n=120, a0=-130, a1=130) if q[0].z > BASE_H + 0.03]
band(resample(girth, 0.022), 0.05, 0.012)
for p, nr in resample(girth, 0.11)[1:-1]:
    bead(p + nr * 0.01, nr, 0.016, "carved", sides=6, lift=0.2)  # bosses along the band

# --- Marigold garland round the lower neck, hanging over the dewlap -----------------------------------
flowers = (0, 0)
if GARLAND:
    MARIGOLD = ["marigold", "marigold", "marigoldYellow", "marigold", "marigoldDeep"]
    gar = resample(ring(Q(0, 0.43, 0.60), Vector((0, -0.40, 0.26)), n=200), 0.034, closed=True)
    f0 = len(bm.verts)
    for i, (p, nr) in enumerate(gar):
        bead(p, nr, 0.024 * random.uniform(0.92, 1.08), MARIGOLD[(i // 3) % len(MARIGOLD)])
    flowers = (f0, len(bm.verts))
    print(f"garland: {len(gar)} marigolds")

# ===================================================================================================
# 6. Scale to the slot and colour: stone, ambient occlusion, oiled touch, dust, lichen.
# ===================================================================================================
bmesh.ops.triangulate(bm, faces=bm.faces[:])
bm.verts.ensure_lookup_table()
lo = Vector((min(v.co.x for v in bm.verts), min(v.co.y for v in bm.verts), min(v.co.z for v in bm.verts)))
hi = Vector((max(v.co.x for v in bm.verts), max(v.co.y for v in bm.verts), max(v.co.z for v in bm.verts)))
S = LENGTH / (hi.y - lo.y)
shift = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
for v in bm.verts:
    v.co = (v.co - shift) * S
bm.normal_update()
print(f"scaled by {S:.3f}")


def W(x, f, h):
    """A working point on the figure, in the final scaled frame."""
    return (Q(x, f, h) - shift) * S


bvh = BVHTree.FromBMesh(bm)
N_AO = 24
GOLD = math.pi * (3 - math.sqrt(5))
HEMI = [Vector((math.sqrt(u) * math.cos(GOLD * k), math.sqrt(u) * math.sin(GOLD * k), math.sqrt(1 - u)))
        for k, u in ((k, (k + 0.5) / N_AO) for k in range(N_AO))]
AO_DIST = 0.28


def occlusion(v):
    n = v.normal
    m = frame(n).to_3x3()
    p = v.co + n * 0.003
    hit_sum = 0.0
    for d in HEMI:
        d = m @ d
        far = AO_DIST
        if d.z < -1e-3:
            far = min(far, p.z / -d.z)  # the platform under him
        h = bvh.ray_cast(p, d, far)
        if h[0] is not None:
            far = min(far, h[3])
        if far < AO_DIST:
            hit_sum += 1 - far / AO_DIST
    return 1 - hit_sum / N_AO


def cavity(v):
    """> 0 in hollows, < 0 on ridges."""
    vals = [v.normal.dot((e.other_vert(v).co - v.co).normalized()) for e in v.link_edges]
    return sum(vals) / len(vals) if vals else 0.0


def near(p, c, r):
    d = (p - c).length / r
    return max(0.0, 1 - d) ** 0.7


TOUCH = [(W(0, 0.72, 0.68), 0.12), (W(0, 0.60, 0.86), 0.10), (W(0, 0.24, 0.86), 0.14),
         (W(0, -0.05, 0.62), 0.26)]
TOUCH += [(W(s * 0.25, 0.54, 0.82), 0.09) for s in (-1, 1)]  # ears: wishes are whispered into them

colour = []
for v in bm.verts:
    kind = KIND.get(v.index, "body")
    p = v.co
    if kind.startswith("marigold"):
        c = PAL[kind] * random.uniform(0.9, 1.06)
        colour.append(c * (0.7 + 0.3 * occlusion(v)))
        continue
    # Mottled stone: broad patches and a finer grain.
    mott = noise.noise(p * 3.0) * 0.8 + noise.noise(p * 11.0 + Vector((5, 1, 3))) * 0.45 \
        + noise.noise(p * 40.0 + Vector((2, 8, 1))) * 0.2
    c = PAL["base"] if kind == "base" else PAL["stone"]
    c = PAL["stoneLight"].lerp(c, min(1.0, max(0.0, 0.5 + mott))) if mott < 0 else \
        c.lerp(PAL["stoneDark"], min(1.0, mott * 1.4))
    # Old water stains: faint streaks down the sides.
    streak = noise.noise(Vector((p.x * 26.0, p.y * 26.0, p.z * 2.2)))
    c = c * (1 - 0.16 * max(0.0, streak) * (1 - abs(v.normal.z)))
    if kind == "carved":
        c = c * 1.08
    touch = max([near(p, tc, tr) for tc, tr in TOUCH] + [0.0]) if kind != "base" else 0.0
    c = c.lerp(PAL["oiled"], 0.8 * touch)
    ao = occlusion(v)
    cav = cavity(v)
    c = c.lerp(PAL["dust"], min(0.5, max(0.0, cav * 2.5 + (0.75 - ao) * 0.6)) * (1 - touch))
    low = max(0.0, 1 - (p.z - BASE_H * S) / 0.25) if kind != "base" else 0.9
    lich = max(0.0, noise.noise(p * 4.0 + Vector((9, 2, 7))) + 0.2) * low * max(0.0, v.normal.z + 0.5)
    c = c.lerp(PAL["lichen"], min(0.6, lich * 1.3))
    colour.append(c * (0.3 + 0.7 * ao ** 1.2))

COL = bm.loops.layers.float_color.new("Col")
for f in bm.faces:
    for loop in f.loops:
        c = colour[loop.vert.index]
        loop[COL] = (c.x, c.y, c.z, 1.0)

# ===================================================================================================
# 7. Object, material, export
# ===================================================================================================
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
mesh.set_sharp_from_angle(angle=math.radians(50))
# The body and the flowers are rounded: no hard edges on them.
sharp = mesh.attributes.get("sharp_edge")
if sharp:
    for e in mesh.edges:
        a, b = e.vertices
        if (a not in KIND and b not in KIND) or (flowers[0] <= a < flowers[1] and flowers[0] <= b < flowers[1]):
            sharp.data[e.index].value = False

mat = bpy.data.materials.get("nandi-stone") or bpy.data.materials.new("nandi-stone")
mat.use_nodes = True
mat.use_backface_culling = True
nodes, links = mat.node_tree.nodes, mat.node_tree.links
bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
bsdf.inputs["Base Color"].default_value = (1, 1, 1, 1)
bsdf.inputs["Roughness"].default_value = 0.62  # old stone, smoothed by hands and oil
bsdf.inputs["Metallic"].default_value = 0.0
attr = next((n for n in nodes if n.type == "VERTEX_COLOR"), None) or nodes.new("ShaderNodeVertexColor")
attr.layer_name = "Col"
attr.location = (bsdf.location.x - 300, bsdf.location.y)
links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
mesh.materials.append(mat)

obj = bpy.data.objects.new(NAME, mesh)
bpy.context.scene.collection.objects.link(obj)
obj.location = (-12.0, -14.0, 0.0)  # away from the other models while working; not exported

tris = len(mesh.polygons)
xs = [v.co.x for v in mesh.vertices]
ys = [v.co.y for v in mesh.vertices]
zs = [v.co.z for v in mesh.vertices]
print(f"{NAME}: {tris} triangles, x {min(xs):.3f}..{max(xs):.3f}, front {min(ys):.3f} back {max(ys):.3f}, "
      f"height {min(zs):.3f}..{max(zs):.3f}")
if tris > MAX_TRIS:
    print(f"WARNING: over the slot's {MAX_TRIS:,} triangles; lower BODY_TRIS")

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
