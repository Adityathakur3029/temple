"""
Sannidhi far deodar, the `tree` slot in spec 11: the deodars beyond the near trees. Made for
Sannidhi by Claude (AI) in Blender 5.2 by this script, so the model is "ai": true and disclosed
in the credits.

Run inside Blender (Scripting tab, or the MCP connector):
    path = r"<repo>/assets-src/models/tree/make_tree.py"
    exec(compile(open(path, encoding="utf-8").read(), path, "exec"), {"__file__": path})
It replaces any earlier "tree" object and, if EXPORT is set, writes tree.glb.

Frame: Blender metres, z up, origin at the bottom centre of the trunk. Which way it faces doesn't
matter: the code turns and leans every tree a different way.

Lines up with greybox.ts and spec 11:
- Exactly 10.4 m tall, like the greybox deodar, and nothing reaches more than 2.6 m from the
  trunk (TREE_SPREAD); the widest, lowest tier spreads at about 3.6 m up.
- At most 120 triangles (the slot's budget): the same deodar as the near-tree model, cut down
  to five tiers of five drooping branch ends each, so the far forest matches the near trees.
Solid and smooth-shaded so the Lite build can simplify it. One material with colours per vertex:
one draw call.
"""
import math
import os
import random

import bmesh
import bpy

EXPORT = True
NAME = "tree"
HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else None
MAX_TRIS = 120  # the slot's budget
SPREAD = 2.6  # TREE_SPREAD in greybox.ts
TOP = 10.4

random.seed(5612)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexcol(h):
    h = h.lstrip("#")
    return tuple(srgb_to_linear(int(h[i : i + 2], 16) / 255) for i in (0, 2, 4))


# The near-tree model's colours.
PAL = {
    "bark": hexcol("#5a4a3c"),
    "bark_dark": hexcol("#3a2e25"),
    "top": hexcol("#36573f"),
    "tip": hexcol("#4d6d52"),
    "under": hexcol("#223729"),
    "heart": hexcol("#1b2c21"),
}


def mix(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def scale(c, k):
    return tuple(min(1.0, v * k) for v in c)


bm = bmesh.new()
COL = bm.verts.layers.float_color.new("Col")


def vert(p, colour):
    v = bm.verts.new(p)
    v[COL] = (*colour, 1.0)
    return v


def band(a, b):
    n = len(a)
    return [bm.faces.new([a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]]) for i in range(n)]


def fan(apex, ring):
    n = len(ring)
    return [bm.faces.new([apex, ring[i], ring[(i + 1) % n]]) for i in range(n)]


# --- Trunk: five sides, open at both ends (the ground and the foliage hide them) -----------------
trunk = []
for z, r, c in ((0.0, 0.3, PAL["bark_dark"]), (8.6, 0.06, PAL["bark"])):
    trunk.append([vert((r * math.cos(math.tau * i / 5), r * math.sin(math.tau * i / 5), z), c)
                  for i in range(5)])
band(trunk[0], trunk[1])

# --- Five tiers: a peak at the trunk, ten points round the edge (five drooping branch ends and the
# gaps between them), and a hollow underneath back up to the trunk -------------------------------
TIERS = 5
SEG = 10
GOLDEN = math.pi * (3 - math.sqrt(5))
for t_i in range(TIERS):
    t = t_i / (TIERS - 1)
    zc = 3.3 + 5.4 * t ** 0.92
    reach = 0.6 + (SPREAD - 0.6) * (1 - t) ** 0.85
    droop = 0.85 - 0.5 * t
    tone = random.uniform(0.92, 1.06) * (0.88 + 0.16 * t)
    phase = t_i * GOLDEN * 2.3
    edge = []
    for i in range(SEG):
        a = phase + math.tau * i / SEG + random.uniform(-0.08, 0.08)
        tip = i % 2 == 0
        r = reach * (random.uniform(0.86, 1.0) if tip else random.uniform(0.62, 0.72))
        z = zc - droop * (r / reach) * (1.0 if tip else 0.55)
        edge.append(vert((r * math.cos(a), r * math.sin(a), z),
                         scale(PAL["tip"] if tip else PAL["top"], tone)))
    last = t_i == TIERS - 1
    # The top tier rises to the leading shoot, which bends over a little.
    peak = vert((0.35 if last else 0.0, 0.0, TOP if last else zc + 0.95), scale(PAL["top"], tone))
    hollow = vert((0.0, 0.0, zc - 0.15), scale(PAL["under"], tone * 0.9))
    fan(peak, edge)
    fan(hollow, list(reversed(edge)))

bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

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

mat = bpy.data.materials.get("tree-deodar") or bpy.data.materials.new("tree-deodar")
mat.use_nodes = True
mat.use_backface_culling = True
nodes, links = mat.node_tree.nodes, mat.node_tree.links
bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
bsdf.inputs["Base Color"].default_value = (1, 1, 1, 1)
bsdf.inputs["Roughness"].default_value = 0.92
bsdf.inputs["Metallic"].default_value = 0.0
attr = next((n for n in nodes if n.type == "VERTEX_COLOR"), None) or nodes.new("ShaderNodeVertexColor")
attr.layer_name = "Col"
attr.location = (bsdf.location.x - 300, bsdf.location.y)
links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
mesh.materials.append(mat)

obj = bpy.data.objects.new(NAME, mesh)
bpy.context.scene.collection.objects.link(obj)
obj.location = (-20.0, 0.0, 0.0)  # set aside for viewing; not exported

tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
plan = max(math.hypot(v.co.x, v.co.y) for v in mesh.vertices)
zs = [v.co.z for v in mesh.vertices]
print(f"{NAME}: {tris} triangles, reach {plan:.3f} m from the trunk, height {min(zs):.3f}..{max(zs):.3f}")
if tris > MAX_TRIS:
    print(f"WARNING: over the slot's {MAX_TRIS} triangles")

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
