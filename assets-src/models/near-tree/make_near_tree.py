"""
Sannidhi near deodar, the `near-tree` slot in spec 11: the deodars nearest the paths. Made for
Sannidhi by Claude (AI) in Blender 5.2 by this script, so the model is "ai": true and disclosed
in the credits.

Run inside Blender (Scripting tab, or the MCP connector):
    path = r"<repo>/assets-src/models/near-tree/make_near_tree.py"
    exec(compile(open(path, encoding="utf-8").read(), path, "exec"), {"__file__": path})
It replaces any earlier "near-tree" object and, if EXPORT is set, writes near-tree.glb.

Frame: Blender metres, z up, origin at the bottom centre of the trunk. Which way it faces doesn't
matter: the code turns every tree a different way.

Lines up with greybox.ts and spec 11:
- 10.4 m to the tip of the leading shoot, like the greybox deodar.
- Nothing reaches more than 2.6 m from the trunk (TREE_SPREAD), so with the code's scale cap no
  branch reaches over a path. The widest, lowest tier spreads at about 3.6 m up.
A Himalayan cedar: a straight grey-brown trunk with layered tiers of level branches whose tips
droop, each tier's edge cut into branch ends, narrowing to a leading shoot that bends over at the
top. Solid foliage (no leaf cards, nothing see-through), smooth-shaded so the Lite build can
simplify it. One material with colours per vertex: one draw call.
"""
import math
import os
import random

import bmesh
import bpy

EXPORT = True
NAME = "near-tree"
HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else None
MAX_TRIS = 1600  # the slot's budget
SPREAD = 2.6  # TREE_SPREAD in greybox.ts
TOP = 10.4

random.seed(1083)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexcol(h):
    h = h.lstrip("#")
    return tuple(srgb_to_linear(int(h[i : i + 2], 16) / 255) for i in (0, 2, 4))


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
    """Quads between two rings of the same length, closed round."""
    n = len(a)
    return [bm.faces.new([a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]]) for i in range(n)]


def fan(apex, ring):
    n = len(ring)
    return [bm.faces.new([apex, ring[i], ring[(i + 1) % n]]) for i in range(n)]


# --- Trunk ------------------------------------------------------------------------------------------
# A slight root flare, then a steady taper up into the crown; its top is hidden in the foliage.
TRUNK_SIDES = 7
trunk_rings = []
for z, r, k in ((0.0, 0.36, 0.7), (0.3, 0.27, 0.85), (2.6, 0.21, 1.0), (6.0, 0.13, 1.0),
                (9.3, 0.05, 1.0)):
    ring = []
    for i in range(TRUNK_SIDES):
        a = math.tau * i / TRUNK_SIDES
        rr = r * (1 + 0.06 * math.sin(3 * a + z))
        ring.append(vert((rr * math.cos(a), rr * math.sin(a), z),
                         scale(mix(PAL["bark_dark"], PAL["bark"], min(1, z / 2)), k)))
    trunk_rings.append(ring)
for a, b in zip(trunk_rings, trunk_rings[1:]):
    band(a, b)

# --- Tiers of branches ------------------------------------------------------------------------------
# Each tier is a closed skirt: a peak hidden at the trunk, the upper side sloping out to the
# drooping branch ends, and an underside curving back in, darker. Alternate points round the edge
# are branch ends (reaching out and drooping) and the gaps between them (pulled in, higher).
TIERS = 9
SEG = 14  # points round each tier: 7 branch ends
GOLDEN = math.pi * (3 - math.sqrt(5))
LOW, HIGH = 3.1, 9.0  # centre heights of the lowest and highest tier


def plate(ox, oy, zc, reach, seg, droop, thick, phase, tone, full=True, long=(0.7, 1.0)):
    """One tier (or, with full off, a short spray of branches to one side of the trunk)."""
    ends, upper, under = [], [], []
    for i in range(seg):
        a = phase + (math.tau if full else 1.9) * i / seg + random.uniform(-0.08, 0.08)
        tip = i % 2 == 0
        if full:
            r = reach * (random.uniform(*long) if tip else random.uniform(0.58, 0.72))
        else:
            # A spray: longest in the middle, closing to the trunk at both sides.
            s = math.sin(math.pi * (i + 0.5) / seg)
            r = reach * s * (random.uniform(0.85, 1.0) if tip else 0.68)
        dist = math.hypot(ox, oy)
        r = min(r, SPREAD - dist - 0.01)  # inside the spread, however the tier is offset
        ca, sa = math.cos(a), math.sin(a)
        z_end = zc - droop * (r / reach) * (random.uniform(0.85, 1.15) if tip else 0.5)
        ends.append(vert((ox + r * ca, oy + r * sa, z_end),
                         scale(PAL["tip"] if tip else mix(PAL["top"], PAL["tip"], 0.35), tone)))
        ru = r * 0.5
        upper.append(vert((ox + ru * ca, oy + ru * sa, zc + thick * 0.3), scale(PAL["top"], tone)))
        rd = r * 0.6
        under.append(vert((ox + rd * ca, oy + rd * sa, z_end + thick * 0.6),
                          scale(PAL["under"], tone)))
    if not full:
        # Close the spray against the trunk.
        upper.append(vert((ox, oy, zc + thick * 0.2), scale(PAL["top"], tone)))
        ends.append(vert((ox, oy, zc - thick * 0.1), scale(PAL["heart"], tone)))
        under.append(vert((ox, oy, zc - thick * 0.3), scale(PAL["heart"], tone)))
    peak = vert((ox * 0.4, oy * 0.4, zc + thick * 0.75),
                scale(mix(PAL["top"], PAL["heart"], 0.4), tone))
    heart = vert((ox * 0.4, oy * 0.4, zc - thick * 0.2), scale(PAL["heart"], tone))
    fan(peak, upper)
    band(upper, ends)
    band(ends, under)
    fan(heart, list(reversed(under)))


gap = (HIGH - LOW) / (TIERS - 1)
for t_i in range(TIERS):
    t = t_i / (TIERS - 1)
    zc = LOW + (HIGH - LOW) * t ** 0.9 + (random.uniform(-0.18, 0.18) * gap if 0 < t_i < TIERS - 1 else 0)
    reach = 0.55 + (SPREAD - 0.55) * (1 - t) ** 0.8
    droop = 0.75 - 0.45 * t
    thick = 0.68 - 0.34 * t
    # Upper tiers sit a little off the trunk; the lowest stays centred so the spread holds.
    off = 0.0 if t_i == 0 else 0.16 * t
    oa = random.uniform(0, math.tau)
    tone = random.uniform(0.9, 1.08) * (0.88 + 0.16 * t)
    plate(off * math.cos(oa), off * math.sin(oa), zc, reach, SEG, droop, thick,
          t_i * GOLDEN * 2.3 + random.uniform(-0.3, 0.3), tone,
          long=(0.84, 1.0) if t_i == 0 else (0.68, 1.0))
    # Between the lower tiers, a short spray of branches to one side, as real deodars have.
    if t_i < TIERS - 3 and random.random() < 0.85:
        sa = random.uniform(0, math.tau)
        plate(0.18 * math.cos(sa), 0.18 * math.sin(sa), zc + gap * random.uniform(0.42, 0.58),
              reach * random.uniform(0.62, 0.8), 8, droop * 0.8, thick * 0.7, sa - 0.95,
              tone * 0.96, full=False)

# --- Leading shoot, bending over at the top ---------------------------------------------------------
LEAD_SIDES = 6
lean_a = random.uniform(0, math.tau)
lead_rings = []
steps = [(9.0, 0.3), (9.5, 0.22), (9.9, 0.14), (10.2, 0.07)]
for k, (z, r) in enumerate(steps):
    bend = 0.28 * (k / len(steps)) ** 2
    cx, cy = bend * math.cos(lean_a), bend * math.sin(lean_a)
    ring = [vert((cx + r * math.cos(math.tau * i / LEAD_SIDES), cy + r * math.sin(math.tau * i / LEAD_SIDES), z),
                 scale(mix(PAL["top"], PAL["tip"], k / len(steps)), 1.05)) for i in range(LEAD_SIDES)]
    lead_rings.append(ring)
for a, b in zip(lead_rings, lead_rings[1:]):
    band(a, b)
tip = vert((0.4 * math.cos(lean_a), 0.4 * math.sin(lean_a), TOP), scale(PAL["tip"], 1.1))
fan(tip, list(reversed(lead_rings[-1])))
bottom = vert((0, 0, 8.85), PAL["heart"])
fan(bottom, list(reversed(lead_rings[0])))

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
obj.location = (-8.0, 0.0, 0.0)  # set aside for viewing; not exported

tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
plan = max(math.hypot(v.co.x, v.co.y) for v in mesh.vertices)
zs = [v.co.z for v in mesh.vertices]
print(f"{NAME}: {tris} triangles, reach {plan:.3f} m from the trunk, height {min(zs):.3f}..{max(zs):.3f}")
if tris > MAX_TRIS:
    print(f"WARNING: over the slot's {MAX_TRIS} triangles")
if plan > SPREAD + 1e-6:
    print(f"WARNING: reaches past the {SPREAD} m spread")

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
