"""
Sannidhi kund, the `kund` slot in spec 11: the square stepped water tank north-east of the courtyard.
Made for Sannidhi by Claude (AI) in Blender 5.2 by this script, so the model is "ai": true and
disclosed in the credits.

Run inside Blender (Scripting tab, or the MCP connector):
    path = r"<repo>/assets-src/models/kund/make_kund.py"
    exec(compile(open(path, encoding="utf-8").read(), path, "exec"), {"__file__": path})
It replaces any earlier "kund" object and, if EXPORT is set, writes kund.glb.

Frame: Blender metres, z up. The origin is the slot's: the top centre, world (16, 0.04, 32), and -y
is the world's +z (east). Blender (x, y, z) = (world x - 16, 32 - world z, world y - 0.04). The tank
is square and the same on every side, so only the weathering knows which way is north (+x).

Lines up with packages/protocol/src/world.ts and apps/web/src/scene/ground.ts (spec 11: the
walking rules don't change with the model, so the model follows them):
- The rim, 1 m wide all round (world x 11 ... 21, z 27 ... 37), flat at 0.04 m like the greybox, so
  visitors walk round the tank on it. Nothing stands on it.
- The tank (KUND, world x 12 ... 20, z 28 ... 36) has three steps down on every side, each 0.6 m
  deep, with tops at -0.25, -0.5 and -0.75 m (KUND_STEP). The second step's riser stands at the
  water's edge (KUND_WATER, 1.2 m in), and the third step lies under the water at -0.68 m
  (KUND_WATER_Y), which stays in code.
- Below the third step a sheer wall drops to the floor at -1.6 m (KUND_FLOOR_Y).
Dressed stone in courses, damp and green near the water. No carvings, symbols or figures. One
material with vertex colours: one draw call.
"""
import math
import os
import random

import bmesh
import bpy

EXPORT = True
NAME = "kund"
HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else None
OY = 0.04  # world height of the slot origin (the rim top)

random.seed(32)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexcol(h):
    h = h.lstrip("#")
    return tuple(srgb_to_linear(int(h[i : i + 2], 16) / 255) for i in (0, 2, 4))


# Near the greybox kund (#7a7469), with warmer and cooler stones mixed in.
PAL = {
    "rim": hexcol("#857f74"),
    "rimWarm": hexcol("#8d8476"),
    "rimCool": hexcol("#7e7b74"),
    "coping": hexcol("#766f64"),
    "copingDark": hexcol("#6c665c"),
    "step": hexcol("#7a7469"),
    "stepWarm": hexcol("#82786b"),
    "stepCool": hexcol("#75716a"),
    "corner": hexcol("#6f685d"),
    "floor": hexcol("#615c53"),
    "moss": hexcol("#5b6142"),
    "algae": hexcol("#3d4a34"),
}
RIM = [("rim", 6), ("rimWarm", 2), ("rimCool", 2)]
STEP = [("step", 6), ("stepWarm", 2), ("stepCool", 2)]
COPING = [("coping", 6), ("copingDark", 3), ("rimWarm", 1)]

# Heights in the Blender frame (world y - 0.04).
TOP = 0.0  # rim
TREADS = [-0.25 * k - OY for k in (1, 2, 3)]  # -0.29, -0.54, -0.79
WATER = -0.68 - OY  # -0.72
FLOOR = -1.6 - OY  # -1.64
HALF = 4.0  # KUND, half size
STEP_W = 0.6

bm = bmesh.new()
COL = bm.loops.layers.float_color.new("Col")


def mixc(a, b, t):
    return tuple(x * (1 - t) + y * t for x, y in zip(a, b))


def stone(kinds, jitter=0.07, moss=0.0):
    """A colour for one stone: a weighted pick from `kinds`, a little lighter or darker, maybe mossy."""
    total = sum(w for _, w in kinds)
    r = random.uniform(0, total)
    for name, w in kinds:
        r -= w
        if r <= 0:
            break
    k = 1 + random.uniform(-jitter, jitter)
    c = tuple(min(1.0, v * k) for v in PAL[name])
    return mixc(c, PAL["moss"], moss)


def block(x0, x1, y0, y1, zb, zt, color, ch, sides=(), splits=(), round_top=False):
    """A stone with its top edges chamfered (or rounded in two steps), so joints read as grooves.
    `sides` are the faces built below the chamfer, as ring edges (0: -y, 1: +x, 2: +y, 3: -x); the
    others lie hidden against the next stones. `splits` are extra heights on those faces, so the
    water line can be painted sharp. No bottom: it is buried."""

    def ring(i, z):
        return [(x0 + i, y0 + i, z), (x1 - i, y0 + i, z), (x1 - i, y1 - i, z), (x0 + i, y1 - i, z)]

    prof = [(0.0, zt - ch), (0.293 * ch, zt - 0.293 * ch), (ch, zt)] if round_top else [(0.0, zt - ch), (ch, zt)]
    rings = [[bm.verts.new(p) for p in ring(i, z)] for i, z in prof]
    faces = []
    for a, b in zip(rings, rings[1:]):
        faces += [bm.faces.new([a[i], a[(i + 1) % 4], b[(i + 1) % 4], b[i]]) for i in range(4)]
    faces.append(bm.faces.new(rings[-1]))
    base = ring(0.0, 0.0)
    hs = [zb] + sorted(h for h in splits if zb < h < zt - ch) + [zt - ch]
    for e in sides:
        p, q = base[e], base[(e + 1) % 4]
        col = [(bm.verts.new((p[0], p[1], h)), bm.verts.new((q[0], q[1], h))) for h in hs]
        for lo, hi in zip(col, col[1:]):
            faces.append(bm.faces.new([lo[0], lo[1], hi[1], hi[0]]))
    for f in faces:
        for loop in f.loops:
            loop[COL] = (*color, 1.0)
    return faces


def cuts(length, mean):
    """Joint positions along a run: about `mean` apart, not evenly."""
    n = max(1, round(length / mean))
    pts = [0.0] + [length * (i + random.uniform(-0.28, 0.28)) / n for i in range(1, n)] + [length]
    return pts


def course(h_out, h_in, zb, zt, kinds, ch, face, mean, splits=(), round_top=False, moss_at=None):
    """One square ring of stones between half sizes h_in and h_out: a stone at each corner and runs
    of stones along the sides between them. `face` is "in" (show the faces towards the middle) or
    "out" (the rim's outer edge). `moss_at(x, y)` gives a stone's chance of moss and how much."""

    def put(xa, xb, ya, yb, sides, corner=False):
        moss = 0.0
        if moss_at:
            p, amount = moss_at((xa + xb) / 2, (ya + yb) / 2)
            if random.random() < p:
                moss = amount * random.uniform(0.5, 1.0)
        # Inside the tank the corner stones are a darker stone, so the mitred corners read.
        pick = [("corner", 1)] if corner and face == "in" else kinds
        block(xa, xb, ya, yb, zb, zt, stone(pick, moss=moss), ch, sides, splits, round_top)

    for sx in (-1, 1):
        for sy in (-1, 1):
            xa, xb = sorted((sx * h_in, sx * h_out))
            ya, yb = sorted((sy * h_in, sy * h_out))
            # Inside, a corner stone's sides all meet other stones; outside, two show.
            sides = () if face == "in" else ((3 if sx < 0 else 1), (0 if sy < 0 else 2))
            put(xa, xb, ya, yb, sides, corner=True)
    for side in ("-x", "+x", "-y", "+y"):
        ts = cuts(2 * h_in, mean)
        s = -1 if side[0] == "-" else 1
        for a, b in zip(ts, ts[1:]):
            t0, t1 = -h_in + a, -h_in + b
            if side[1] == "x":
                xa, xb = sorted((s * h_in, s * h_out))
                ya, yb = t0, t1
                inner, outer = (1, 3) if s < 0 else (3, 1)
            else:
                ya, yb = sorted((s * h_in, s * h_out))
                xa, xb = t0, t1
                inner, outer = (2, 0) if s < 0 else (0, 2)
            put(xa, xb, ya, yb, (inner,) if face == "in" else (outer,))


def forest_side(x, y):
    """Moss on the rim: more on the north (+x) and east (-y) edges, by the forest."""
    return (0.45, 0.32) if (x > 4.4 or y < -4.4) else (0.12, 0.2)


def damp(_x, _y):
    return (0.18, 0.18)


# --- The rim: an outer row of paving slabs and an inner row of darker coping with rounded edges -----
course(HALF + 1.0, HALF + 0.5, -0.1, TOP, RIM, 0.012, "out", 0.85, moss_at=forest_side)
# The coping's face is the first riser, down to the first step; it stands 1 cm proud of the tank's
# edge, so the forest floor's hole (exactly the tank) tucks in behind it.
course(HALF + 0.5, HALF - 0.01, TREADS[0] - 0.02, TOP, COPING, 0.03, "in", 1.15, round_top=True,
       moss_at=lambda x, y: (0.1, 0.15))

# --- Three steps; the riser below the second step stands 1 cm into the water's edge --------------
for k in range(3):
    h_out = HALF - STEP_W * k
    h_in = HALF - STEP_W * (k + 1) - (0.01 if k == 1 else 0.0)
    zb = TREADS[k + 1] - 0.02 if k < 2 else FLOOR
    splits = (WATER + 0.02, WATER + 0.08) if k == 1 else ()
    course(h_out, h_in, zb, TREADS[k], STEP, 0.02, "in", 1.05, splits=splits, moss_at=damp)

# --- Floor: dark slabs under the water -----------------------------------------------------------
fh = HALF - 3 * STEP_W  # 2.2
gx = [-fh + i * (2 * fh / 4) for i in range(5)]
grid = [[bm.verts.new((x, y, FLOOR)) for x in gx] for y in gx]
for j in range(4):
    for i in range(4):
        f = bm.faces.new([grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]])
        c = stone([("floor", 1)], jitter=0.1)
        for loop in f.loops:
            loop[COL] = (*c, 1.0)


# --- Weathering, per corner: damp below, a wet line at the water, green under it -----------------
def wet(z):
    """(darkening, algae mix) by height: dry above -0.3, damp towards the water, green below."""
    pts = [(-0.30, 1.0, 0.0), (WATER + 0.08, 0.78, 0.14), (WATER + 0.02, 0.55, 0.45), (-0.92, 0.45, 0.55),
           (FLOOR, 0.38, 0.6)]
    if z >= pts[0][0]:
        return 1.0, 0.0
    for (za, ka, ma), (zb_, kb, mb) in zip(pts, pts[1:]):
        if z >= zb_:
            t = (za - z) / (za - zb_)
            return ka + (kb - ka) * t, ma + (mb - ma) * t
    return pts[-1][1], pts[-1][2]


bm.normal_update()
algae = PAL["algae"]
for f in bm.faces:
    n = f.normal
    upright = abs(n.z) < 0.5
    for loop in f.loops:
        x, y, z = loop.vert.co
        r, g, b, a = loop[COL]
        k, mix = wet(z)
        if upright and z < -0.02:
            k *= 0.86  # risers are in shade
            if n.x > 0.5:
                mix = max(mix, 0.1)  # faces north: hardly any sun
        # Damp gathers in the inside corners, where the risers meet.
        d = abs(abs(x) - abs(y))
        if z < -0.02 and d < 0.5:
            mix = max(mix, 0.2 * (1 - d / 0.5))
            k *= 0.94 + 0.06 * d / 0.5
        c = mixc((r, g, b), algae, mix)
        loop[COL] = (c[0] * k, c[1] * k, c[2] * k, a)

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

mat = bpy.data.materials.get("kund-stone") or bpy.data.materials.new("kund-stone")
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
obj.location = (30.0, 0.0, 0.0)  # away from the other models while working; not exported

tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
xs = [v.co.x for v in mesh.vertices]
ys = [v.co.y for v in mesh.vertices]
zs = [v.co.z for v in mesh.vertices]
print(f"{NAME}: {tris} triangles, x {min(xs):.3f}..{max(xs):.3f}, y {min(ys):.3f}..{max(ys):.3f}, "
      f"height {min(zs):.3f}..{max(zs):.3f} (world {min(zs) + OY:.3f}..{max(zs) + OY:.3f})")

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
