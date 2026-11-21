"""
Sannidhi deepa stand with its 108 diyas, the `deepa-stand` slot in spec 11. Made for Sannidhi by
Claude (AI) in Blender 5.2 by this script, so the model is "ai": true and disclosed in the credits.
The owner approved an AI-made stand-in on 2026-11-08; it is listed in spec 08 for the advisor.

Run inside Blender (Scripting tab, or the MCP connector):
    path = r"<repo>/assets-src/models/deepa-stand/make_deepa_stand.py"
    exec(compile(open(path, encoding="utf-8").read(), path, "exec"), {"__file__": path})
It replaces any earlier "deepa-stand" object and, if EXPORT is set, writes deepa-stand.glb.

Frame: Blender metres, z up, origin at the bottom centre. Exactly 2.35 m tall, so fit "none".
The stone base is 0.78 m in radius, inside the 0.8 m obstacle circle (DEEPA_STAND_RADIUS).

Plain brass and plain clay: no figure, face, bird or symbol anywhere (spec 08). The flames are
drawn in code (spec 10: one instanced emissive mesh plus sprites), so the diyas here are unlit.

The 108 diyas, for placing the flames in code (M3). Tier i has COUNTS[i] diyas whose spouts point
straight out from the column. Diya j sits at angle a = 2*pi*j/COUNTS[i] + OFFSETS[i], measured from
+x towards Blender +y, which is the temple's -z. Its spout tip, where the flame goes, is at radius
TRAY_R[i] and height TRAY_TOP[i] + 0.03 m. In the temple, with the stand at (-8.5, 25):
    x = -8.5 + TRAY_R[i] * cos(a),  y = TRAY_TOP[i] + 0.03,  z = 25 - TRAY_R[i] * sin(a)
"""
import math
import os
import random

import bmesh
import bpy

EXPORT = True
NAME = "deepa-stand"
HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else None

TRAY_TOP = [0.72, 1.17, 1.62, 2.02]  # height of each tray's floor
TRAY_R = [0.72, 0.585, 0.45, 0.31]  # outer radius of each tray's rim
COUNTS = [36, 30, 24, 18]  # 108 in all
OFFSETS = [0.0, math.pi / 30, 0.0, math.pi / 18]  # every other tier turned half a step
HEIGHT = 2.35

random.seed(108)
assert sum(COUNTS) == 108


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexcol(h):
    h = h.lstrip("#")
    return tuple(srgb_to_linear(int(h[i : i + 2], 16) / 255) for i in (0, 2, 4))


PAL = {
    "stoneDark": hexcol("#71675a"),  # greybox palette
    "brass": hexcol("#b08d3c"),
    "brassDark": hexcol("#8f6f2c"),
    "clay": hexcol("#9c5b38"),
    "oil": hexcol("#5a3a1c"),
}

bm = bmesh.new()
COL = bm.loops.layers.float_color.new("Col")


def paint(faces, color, jitter=0.02):
    base = PAL[color] if isinstance(color, str) else color
    k = 1 + random.uniform(-jitter, jitter)
    for f in faces:
        c = tuple(min(1.0, v * k) for v in base)
        for loop in f.loops:
            loop[COL] = (*c, 1.0)


def loft(rings, color, cap_bottom=True, cap_top=True, jitter=0.02):
    """Join rings of points (same count, counter-clockwise from above) with quads; cap the ends."""
    vr = [[bm.verts.new(p) for p in r] for r in rings]
    n = len(rings[0])
    faces = []
    for a, b in zip(vr, vr[1:]):
        for i in range(n):
            j = (i + 1) % n
            faces.append(bm.faces.new([a[i], a[j], b[j], b[i]]))
    caps = []
    if cap_bottom:
        caps.append(bm.faces.new(list(reversed(vr[0]))))
    if cap_top:
        caps.append(bm.faces.new(vr[-1]))
    paint(faces + caps, color, jitter)
    return faces, caps


def lathe(profile, n, color, **kw):
    """A turned part round the z axis: profile is [(radius, z), ...] from the bottom up."""
    rings = []
    for r, z in profile:
        rings.append([(r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n), z) for i in range(n)])
    return loft(rings, color, **kw)


# --- Stone base and brass foot ---------------------------------------------------------------------
lathe([(0.78, 0.0), (0.78, 0.12), (0.70, 0.12), (0.70, 0.22)], 32, "stoneDark", cap_bottom=False)
lathe([
    (0.34, 0.22), (0.34, 0.25), (0.30, 0.27), (0.22, 0.30), (0.14, 0.34), (0.10, 0.38),
    (0.12, 0.39), (0.12, 0.41), (0.075, 0.42),
], 32, "brassDark", cap_bottom=False, cap_top=False)

# --- Column with a knop under each tray, ending in a plain bud -------------------------------------
col = [(0.075, 0.40)]
for t in TRAY_TOP:
    col += [(0.075, t - 0.21), (0.10, t - 0.19), (0.115, t - 0.16), (0.10, t - 0.13), (0.075, t - 0.11)]
col += [
    (0.075, 2.10), (0.060, 2.12), (0.080, 2.15), (0.095, 2.19), (0.085, 2.25), (0.050, 2.30),
    (0.020, 2.335), (0.002, HEIGHT),
]
lathe(col, 16, "brass", cap_bottom=False)

# --- Trays: a shallow dish with a raised rim -------------------------------------------------------
for t, r in zip(TRAY_TOP, TRAY_R):
    lathe([
        (0.075, t - 0.11), (r * 0.55, t - 0.055), (r - 0.02, t - 0.025), (r, t - 0.012),
        (r + 0.012, t + 0.012), (r - 0.006, t + 0.016), (r - 0.018, t), (0.075, t),
    ], 48 if r > 0.5 else 32, "brass", cap_bottom=False, cap_top=False)

# --- 108 clay diyas, spouts outward ----------------------------------------------------------------
DIYA_SEG = 8


def diya(cx, cy, z0, yaw):
    """A small clay lamp: a shallow bowl pinched into a spout (point 0) towards `yaw`."""
    s = random.uniform(0.95, 1.05)
    rings = []
    for r, dz, spout in [(0.018, 0.0, 1.0), (0.030, 0.016, 1.25), (0.034, 0.028, 1.6)]:
        pts = []
        for i in range(DIYA_SEG):
            a = yaw + 2 * math.pi * i / DIYA_SEG
            k = spout if i == 0 else (1 + (spout - 1) * 0.25 if i in (1, DIYA_SEG - 1) else 1.0)
            pts.append((cx + r * s * k * math.cos(a), cy + r * s * k * math.sin(a), z0 + dz * s))
        rings.append(pts)
    tone = tuple(v * random.uniform(0.9, 1.08) for v in PAL["clay"])
    _, caps = loft(rings, tone, jitter=0.0)
    paint([caps[-1]], "oil", jitter=0.05)  # the oil and wick inside


for t, r, n, off in zip(TRAY_TOP, TRAY_R, COUNTS, OFFSETS):
    rc = r - 0.055  # bowl centre; its spout tip reaches the rim radius r
    for j in range(n):
        a = 2 * math.pi * j / n + off
        diya(rc * math.cos(a), rc * math.sin(a), t, a)

# --- Light tarnish: darker undersides --------------------------------------------------------------
bm.normal_update()
for f in bm.faces:
    if f.normal.z < -0.5:
        for loop in f.loops:
            r, g, b, a = loop[COL]
            loop[COL] = (r * 0.8, g * 0.8, b * 0.8, a)

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
mesh.set_sharp_from_angle(angle=math.radians(40))

mat = bpy.data.materials.get("deepa-brass") or bpy.data.materials.new("deepa-brass")
mat.use_nodes = True
mat.use_backface_culling = True
nodes, links = mat.node_tree.nodes, mat.node_tree.links
bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
bsdf.inputs["Base Color"].default_value = (1, 1, 1, 1)
bsdf.inputs["Roughness"].default_value = 0.6
bsdf.inputs["Metallic"].default_value = 0.0
attr = next((n for n in nodes if n.type == "VERTEX_COLOR"), None) or nodes.new("ShaderNodeVertexColor")
attr.layer_name = "Col"
attr.location = (bsdf.location.x - 300, bsdf.location.y)
links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
mesh.materials.append(mat)

obj = bpy.data.objects.new(NAME, mesh)
bpy.context.scene.collection.objects.link(obj)
obj.location = (4.0, -2.0, 0.0)  # beside the gate in Blender only, for viewing; not exported

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
