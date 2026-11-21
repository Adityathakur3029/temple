"""
Sannidhi footwear rack, the `footwear-rack` slot in spec 11. Made for Sannidhi by Claude (AI) in
Blender 5.2 by this script, so the model is "ai": true and disclosed in the credits.

Run inside Blender (Scripting tab, or the MCP connector):
    path = r"<repo>/assets-src/models/footwear-rack/make_footwear_rack.py"
    exec(compile(open(path, encoding="utf-8").read(), path, "exec"), {"__file__": path})
It replaces any earlier "footwear-rack" object and, if EXPORT is set, writes footwear-rack.glb.

Frame: Blender metres, z up, origin at the bottom centre; -y is the front (glTF +z).

Lines up with greybox.ts (the chappals are placed in code, spec 02):
- 3.6 m wide (x), 0.4 m deep, so fit "none" places it as made.
- Four slatted shelves whose boards run from 0.08, 0.36, 0.64 and 0.92 m to 3 cm above: the
  chappals stand on those tops, 13 pairs to a shelf, 0.26 m deep about the centre line.
- Posts only at the ends and at the front and back edges (|y| > 0.14), so no post ever stands
  where a pair of chappals goes. Open front and back: the chappals show from both sides.
Weathered deodar in one material with vertex colours: one draw call.
"""
import math
import os
import random

import bmesh
import bpy
from mathutils import Vector

EXPORT = True
NAME = "footwear-rack"
HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else None

random.seed(61)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexcol(h):
    h = h.lstrip("#")
    return tuple(srgb_to_linear(int(h[i : i + 2], 16) / 255) for i in (0, 2, 4))


# Lighter than the greybox wood so the dark chappals (#3b2a20) stand out against it.
PAL = {
    "frame": hexcol("#5e4330"),
    "plank": hexcol("#80603f"),
    "top": hexcol("#6f5038"),
    "trim": hexcol("#684a33"),
}

bm = bmesh.new()
COL = bm.loops.layers.float_color.new("Col")


def paint(faces, color, jitter=0.05):
    base = PAL[color] if isinstance(color, str) else color
    k = 1 + random.uniform(-jitter, jitter)  # one tone per piece of wood
    for f in faces:
        c = tuple(min(1.0, v * k) for v in base)
        for loop in f.loops:
            loop[COL] = (*c, 1.0)


def loft(rings, color, cap_bottom=True, cap_top=True, jitter=0.05):
    """Join rings of points (same count, counter-clockwise from above) with quads; cap the ends."""
    vr = [[bm.verts.new(p) for p in r] for r in rings]
    n = len(rings[0])
    faces = []
    for a, b in zip(vr, vr[1:]):
        for i in range(n):
            j = (i + 1) % n
            faces.append(bm.faces.new([a[i], a[j], b[j], b[i]]))
    if cap_bottom:
        faces.append(bm.faces.new(list(reversed(vr[0]))))
    if cap_top:
        faces.append(bm.faces.new(vr[-1]))
    paint(faces, color, jitter)
    return faces


def box(x0, x1, y0, y1, z0, z1, color, **kw):
    sq = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    return loft([[(x, y, z0) for x, y in sq], [(x, y, z1) for x, y in sq]], color, **kw)


def extrude_y(profile_xz, y0, y1, color, **kw):
    """A flat cut-out: an (x, z) outline, counter-clockwise seen from -y, run along y from y0 to y1."""
    a = [bm.verts.new((x, y0, z)) for x, z in profile_xz]
    b = [bm.verts.new((x, y1, z)) for x, z in profile_xz]
    n = len(profile_xz)
    faces = [bm.faces.new([a[i], b[i], b[(i + 1) % n], a[(i + 1) % n]]) for i in range(n)]
    faces.append(bm.faces.new(a))
    faces.append(bm.faces.new(list(reversed(b))))
    paint(faces, color, **kw)
    return faces


HALF_W, HALF_D = 1.8, 0.2
SHELVES = [0.08, 0.36, 0.64, 0.92]  # bottom of each shelf board (greybox.ts)
BOARD = 0.03
TOP0, TOP1 = 1.13, 1.16
POST = 0.07  # end posts
MID = 0.055  # middle posts, front and back edges only
MID_X = [-0.6, 0.6]

# --- Frame ------------------------------------------------------------------------------------------
for sx in (-1, 1):
    for sy in (-1, 1):
        x0, x1 = sorted((sx * HALF_W, sx * (HALF_W - POST)))
        y0, y1 = sorted((sy * HALF_D, sy * (HALF_D - POST)))
        box(x0, x1, y0, y1, 0.0, 1.20, "frame", cap_bottom=False)
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        h = POST / 2  # flush with the post, so the rack stays exactly 3.6 m wide
        loft([  # small pointed cap
            [(cx - h, cy - h, 1.20), (cx + h, cy - h, 1.20), (cx + h, cy + h, 1.20), (cx - h, cy + h, 1.20)],
            [(cx - h, cy - h, 1.215), (cx + h, cy - h, 1.215), (cx + h, cy + h, 1.215), (cx - h, cy + h, 1.215)],
            [(cx - 0.004, cy - 0.004, 1.27), (cx + 0.004, cy - 0.004, 1.27),
             (cx + 0.004, cy + 0.004, 1.27), (cx - 0.004, cy + 0.004, 1.27)],
        ], "frame")
for x in MID_X:
    for sy in (-1, 1):
        y0, y1 = sorted((sy * HALF_D, sy * (HALF_D - MID)))
        box(x - MID / 2, x + MID / 2, y0, y1, 0.0, TOP0, "frame", cap_bottom=False)

# --- Shelves: three slats each, on side rails, with a front and back apron ---------------------------
SLATS = [(-0.2, -0.075), (-0.06, 0.06), (0.075, 0.2)]
for s in SHELVES:
    for y0, y1 in SLATS:
        box(-HALF_W + 0.035, HALF_W - 0.035, y0, y1, s, s + BOARD, "plank", jitter=0.08)
    for sx in (-1, 1):  # side rails between the end posts
        x0, x1 = sorted((sx * HALF_W, sx * (HALF_W - 0.065)))
        box(x0, x1, -HALF_D + POST, HALF_D - POST, s - 0.06, s, "frame")
    for y0, y1 in ((-HALF_D, -HALF_D + 0.02), (HALF_D - 0.02, HALF_D)):  # aprons
        box(-HALF_W + POST, HALF_W - POST, y0, y1, max(0.02, s - 0.05), s, "frame", jitter=0.03)

# --- Top board and a scalloped trim under it, front and back, in each bay ----------------------------
box(-HALF_W, HALF_W, -HALF_D - 0.02, HALF_D + 0.02, TOP0, TOP1, "top")
bays = [(-HALF_W + POST, MID_X[0] - MID / 2), (MID_X[0] + MID / 2, MID_X[1] - MID / 2),
        (MID_X[1] + MID / 2, HALF_W - POST)]
for xa, xb in bays:
    n = 6
    w = (xb - xa) / n
    pts = [(xa, TOP0)]
    pts.append((xa, 1.065))
    for j in range(n):
        for k in range(1, 6):  # a shallow arch between two points, rising to 1.095 m
            t = k / 6
            pts.append((xa + w * (j + t), 1.065 + 0.03 * math.sin(math.pi * t)))
        pts.append((xa + w * (j + 1), 1.065))
    pts.append((xb, TOP0))
    profile = pts  # down the left end, along the arches, up the right end: counter-clockwise from -y
    extrude_y(profile, -HALF_D, -HALF_D + 0.02, "trim")
    extrude_y(profile, HALF_D - 0.02, HALF_D, "trim")

# --- Weathering: darker near the ground and on undersides --------------------------------------------
bm.normal_update()
for f in bm.faces:
    n = f.normal
    c = f.calc_center_median()
    k = 1.0
    if n.z < -0.5:
        k *= 0.78
    if c.z < 0.35:
        k *= 0.84 + 0.16 * (c.z / 0.35)
    for loop in f.loops:
        r, g, b, a = loop[COL]
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
mesh.shade_flat()

mat = bpy.data.materials.get("rack-wood") or bpy.data.materials.new("rack-wood")
mat.use_nodes = True
mat.use_backface_culling = True
nodes, links = mat.node_tree.nodes, mat.node_tree.links
bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
bsdf.inputs["Base Color"].default_value = (1, 1, 1, 1)
bsdf.inputs["Roughness"].default_value = 0.85
bsdf.inputs["Metallic"].default_value = 0.0
attr = next((n for n in nodes if n.type == "VERTEX_COLOR"), None) or nodes.new("ShaderNodeVertexColor")
attr.layer_name = "Col"
attr.location = (bsdf.location.x - 300, bsdf.location.y)
links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
mesh.materials.append(mat)

obj = bpy.data.objects.new(NAME, mesh)
bpy.context.scene.collection.objects.link(obj)
obj.location = (-3.0, -3.0, 0.0)  # where it stands relative to the gate (outside is -y); not exported

tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
xs = [v.co.x for v in mesh.vertices]
zs = [v.co.z for v in mesh.vertices]
print(f"{NAME}: {tris} triangles, width {max(xs) - min(xs):.3f} m, height {max(zs):.3f} m")

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
