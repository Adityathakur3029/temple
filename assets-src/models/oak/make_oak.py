"""
Sannidhi Himalayan oak (banj), the `oak` slot in spec 11. Made for Sannidhi by Claude (AI) in
Blender 5.2 by this script, so the model is "ai": true and disclosed in the credits.

Run inside Blender (Scripting tab, or the MCP connector):
    path = r"<repo>/assets-src/models/oak/make_oak.py"
    exec(compile(open(path, encoding="utf-8").read(), path, "exec"), {"__file__": path})
It replaces any earlier "oak" object and, if EXPORT is set, writes oak.glb.

Frame: Blender metres, z up, origin at the bottom centre of the trunk. Which way it faces doesn't
matter: the code turns and leans every tree a different way.

Lines up with greybox.ts and spec 11:
- Nothing reaches more than 2.6 m from the trunk (TREE_SPREAD), so no branch reaches over a path;
  the crown is widest about 5.2 m up, where greybox.ts reckons an oak's lean from.
- About 7.6 m tall, like the greybox oak.
A banj oak: a short, thick grey trunk forking into three limbs under a broad, dense, rounded and
lumpy crown, dark green above and silvery grey-green underneath, as banj leaves are. Solid
foliage (no leaf cards, nothing see-through), smooth-shaded so the Lite build can simplify it.
One material with colours per vertex: one draw call.
"""
import math
import os
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

EXPORT = True
NAME = "oak"
HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else None
MAX_TRIS = 800  # the slot's budget
SPREAD = 2.6  # TREE_SPREAD in greybox.ts

random.seed(4108)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexcol(h):
    h = h.lstrip("#")
    return tuple(srgb_to_linear(int(h[i : i + 2], 16) / 255) for i in (0, 2, 4))


PAL = {
    "bark": hexcol("#615549"),
    "bark_dark": hexcol("#3d342c"),
    "top": hexcol("#34492e"),
    "side": hexcol("#405335"),
    "under": hexcol("#636d58"),  # the silvery undersides of banj leaves
    "deep": hexcol("#29372a"),
}


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def scale(c, k):
    return tuple(min(1.0, v * k) for v in c)


bm = bmesh.new()
COL = bm.verts.layers.float_color.new("Col")


def band(a, b):
    n = len(a)
    return [bm.faces.new([a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]]) for i in range(n)]


def ring(centre, axis, r, sides, colour, wobble=0.0, phase=0.0):
    """A ring of vertices round `axis` at `centre`."""
    axis = axis.normalized()
    side = axis.cross(Vector((0, 0, 1)) if abs(axis.z) < 0.9 else Vector((1, 0, 0))).normalized()
    up = axis.cross(side).normalized()
    out = []
    for i in range(sides):
        a = math.tau * i / sides + phase
        rr = r * (1 + wobble * math.sin(3 * a + phase))
        v = bm.verts.new(centre + (side * math.cos(a) + up * math.sin(a)) * rr)
        v[COL] = (*colour, 1.0)
        out.append(v)
    return out


def limb(points, radii, sides, colours):
    """A tapering branch through `points`, open at both ends (the ends are hidden)."""
    rings = []
    for k, (p, r) in enumerate(zip(points, radii)):
        nxt = points[min(k + 1, len(points) - 1)]
        prv = points[max(k - 1, 0)]
        rings.append(ring(Vector(p), Vector(nxt) - Vector(prv), r, sides, colours[k], 0.08, k * 0.7))
    for a, b in zip(rings, rings[1:]):
        band(a, b)


# --- Trunk and limbs ---------------------------------------------------------------------------------
# A short, thick trunk with a root flare, a little crooked, forking at about 2.5 m.
limb([(0, 0, 0), (0.02, 0.0, 0.35), (0.06, -0.03, 1.5), (0.0, 0.05, 2.6)],
     [0.44, 0.36, 0.31, 0.27], 7,
     [scale(PAL["bark_dark"], 0.9), PAL["bark_dark"], PAL["bark"], PAL["bark"]])
for k, a in enumerate((0.5, 2.6, 4.3)):
    far = 1.0 + 0.25 * (k % 2)
    ca, sa = math.cos(a), math.sin(a)
    limb([(0.0, 0.05, 2.3), (0.45 * ca, 0.45 * sa, 3.2), (far * ca, far * sa, 4.3)],
         [0.2, 0.15, 0.08], 5, [PAL["bark"], PAL["bark"], PAL["bark_dark"]])

# --- Crown -------------------------------------------------------------------------------------------
# A broad dome, flattened underneath, with clumps of leaves bulging from it: one large lumpy
# ball and four smaller ones round its sides and top.
CROWN_Z = 5.15


def blob(centre, rx, rz, subdiv, phase, flat_below=None):
    # The icosphere is made in a mesh of its own (made in the shared one, its subdividing
    # removes vertices it shouldn't) and copied in.
    ico = bmesh.new()
    bmesh.ops.create_icosphere(ico, subdivisions=subdiv, radius=1.0)
    ico.verts.index_update()
    verts = [bm.verts.new(v.co) for v in ico.verts]
    for f in ico.faces:
        bm.faces.new([verts[v.index] for v in f.verts])
    ico.free()
    for v in verts:
        d = v.co.normalized()
        a = math.atan2(d.y, d.x)
        lumps = (1 + 0.13 * math.sin(3 * a + phase) * math.cos(2.5 * d.z + phase)
                 + 0.09 * math.sin(5 * a - 1.7 * phase + 2 * d.z)
                 + random.uniform(-0.05, 0.05))
        p = Vector((d.x * rx * lumps, d.y * rx * lumps, d.z * rz * lumps)) + Vector(centre)
        if flat_below is not None and p.z < flat_below:
            # The underside of the crown is shallower, so the limbs show below it.
            p.z = flat_below - (flat_below - p.z) * 0.45
        # However the clumps bulge, nothing reaches past the spread.
        plan = math.hypot(p.x, p.y)
        if plan > SPREAD - 0.01:
            k = (SPREAD - 0.01) / plan
            p.x, p.y = p.x * k, p.y * k
        v.co = p
    return verts


crown = blob((0, 0, CROWN_Z), 1.95, 1.7, 3, 0.8, flat_below=4.2)
clumps = []
for k in range(4):
    a = k * 2.1 + random.uniform(-0.3, 0.3)
    up = k == 3
    d = 0.35 if up else random.uniform(1.5, 1.7)
    z = CROWN_Z + (1.25 if up else random.uniform(-0.35, 0.5))
    r = random.uniform(1.0, 1.15) if up else random.uniform(0.95, 1.1)
    clumps.append(blob((d * math.cos(a), d * math.sin(a), z), r, r * 0.82, 2, k * 1.9,
                       flat_below=z - r * 0.35))

# Colour by which way the leaves face and how deep in the crown they are: dark green on top,
# silvery underneath, darkest in the hollows and low inside.
for group in [crown, *clumps]:
    tone = random.uniform(0.92, 1.08)
    for v in group:
        nz = (v.co - Vector((0, 0, CROWN_Z - 0.4))).normalized().z
        out = math.hypot(v.co.x, v.co.y) / SPREAD
        c = mix(PAL["side"], PAL["top"], nz * 1.4) if nz > 0 else mix(PAL["side"], PAL["under"], -nz * 1.6)
        c = mix(PAL["deep"], c, 0.45 + 0.55 * min(1.0, out + max(0.0, nz)))
        v[COL] = (*scale(c, tone * random.uniform(0.88, 1.1)), 1.0)

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

mat = bpy.data.materials.get("tree-oak") or bpy.data.materials.new("tree-oak")
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
obj.location = (-14.0, 0.0, 0.0)  # set aside for viewing; not exported

tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
plan = max(math.hypot(v.co.x, v.co.y) for v in mesh.vertices)
widest = max(mesh.vertices, key=lambda v: math.hypot(v.co.x, v.co.y)).co.z
zs = [v.co.z for v in mesh.vertices]
print(f"{NAME}: {tris} triangles, reach {plan:.3f} m from the trunk at {widest:.2f} m up, "
      f"height {min(zs):.3f}..{max(zs):.3f}")
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
