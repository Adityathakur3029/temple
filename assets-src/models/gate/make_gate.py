"""
Sannidhi gate (torana), the `gate` slot in spec 11. Made for Sannidhi by Claude (AI) in Blender 5.2
by this script, so the model is "ai": true and disclosed in the credits.

Run inside Blender (Scripting tab, or the MCP connector):
    path = r"<repo>/assets-src/models/gate/make_gate.py"
    exec(compile(open(path, encoding="utf-8").read(), path, "exec"), {"__file__": path})
It replaces any earlier "gate" object and, if EXPORT is set, writes gate.glb next to this file.

Frame: Blender metres, z up, origin at the bottom centre. -y is the front (glTF +z), the side that
faces visitors arriving from outside; +y faces the temple.

Lines up with the greybox and world.ts (spec 02, spec 11 § Slots):
- 5.6 m wide in x (the cornice), so fit "none" places it as made.
- Thick, old-looking pillars centred at x = +/-2, y = 0, inside the 0.45 m GATE_PILLAR_RADIUS
  circle that visitors keep clear of.
- Lintel underside at 3.3 m over x = 0: the gate bell's chain (drawn in code) hangs from there.
- A small stone shelf on each pillar under the gate lamp that code draws at (+/-1.58, 2.45, +0.24).
- Plain geometric mouldings only: no carved deity figures, faces or sacred symbols (spec 08).
- A marigold garland draped across the front of the lintel, kept above the gate bell.
One material with vertex colours (the greybox stone palette, lightly weathered): one draw call.
"""
import math
import os
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

EXPORT = True
HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else None

random.seed(108)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexcol(h):
    h = h.lstrip("#")
    return tuple(srgb_to_linear(int(h[i : i + 2], 16) / 255) for i in (0, 2, 4))


# The greybox palette (apps/web/src/scene/greybox.ts), plus a damp base, a muted brass and marigolds.
PAL = {
    "stone": hexcol("#8b8070"),
    "stoneDark": hexcol("#71675a"),
    "shikhara": hexcol("#867b6b"),
    "base": hexcol("#766d5f"),
    "brass": hexcol("#a88a4a"),
    "marigold": hexcol("#e07b1a"),
    "marigoldDeep": hexcol("#c95a1b"),
    "marigoldYellow": hexcol("#e9a82a"),
}

bm = bmesh.new()
COL = bm.loops.layers.float_color.new("Col")


def paint(faces, color, jitter=0.035):
    base = PAL[color] if isinstance(color, str) else color
    k = 1 + random.uniform(-jitter, jitter)  # one tone per part, like separate stones
    for f in faces:
        kf = k * (1 + random.uniform(-jitter / 3, jitter / 3))
        c = tuple(min(1.0, v * kf) for v in base)
        for loop in f.loops:
            loop[COL] = (*c, 1.0)


def loft(rings, color, cap_bottom=True, cap_top=True, jitter=0.035):
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


def ngon(n, apothem, rot=None):
    """Regular polygon by apothem, with flat sides facing the axes by default."""
    rot = math.pi / n if rot is None else rot
    r = apothem / math.cos(math.pi / n)
    return [(r * math.cos(rot + 2 * math.pi * i / n), r * math.sin(rot + 2 * math.pi * i / n)) for i in range(n)]


def chamfered_square(h, c):
    """Square of half-width h with corners cut back by c (c = 0.5858 h gives a regular octagon)."""
    c = max(c, 0.002)
    return [
        (h, -h + c), (h, h - c), (h - c, h), (-h + c, h),
        (-h, h - c), (-h, -h + c), (-h + c, -h), (h - c, -h),
    ]


def ring(plan, cx, cy, z, s=1.0):
    return [(cx + s * px, cy + s * py, z) for px, py in plan]


def stack(cx, cy, n, profile, color, rot=None, ribs=0.0, **kw):
    """A turned or faceted column part: profile is [(apothem, z), ...] from the bottom up."""
    rings = []
    for a, z in profile:
        plan = ngon(n, a, rot)
        if ribs:
            plan = [(x * (1 - ribs * (i % 2)), y * (1 - ribs * (i % 2))) for i, (x, y) in enumerate(plan)]
        rings.append(ring(plan, cx, cy, z))
    return loft(rings, color, **kw)


def chamfered_stack(cx, cy, profile, color, **kw):
    """Like stack, on chamfered squares: profile is [(half-width, corner cut, z), ...]."""
    return loft([ring(chamfered_square(h, c), cx, cy, z) for h, c, z in profile], color, **kw)


def box(x0, x1, y0, y1, z0, z1, color, **kw):
    sq = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    return loft([[(x, y, z0) for x, y in sq], [(x, y, z1) for x, y in sq]], color, **kw)


def extrude_x(profile_yz, x0, x1, color, **kw):
    """A moulding: a (y, z) outline, counter-clockwise seen from +x, run along x from x0 to x1."""
    a = [bm.verts.new((x0, y, z)) for y, z in profile_yz]
    b = [bm.verts.new((x1, y, z)) for y, z in profile_yz]
    n = len(profile_yz)
    faces = [bm.faces.new([a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]]) for i in range(n)]
    faces.append(bm.faces.new(list(reversed(a))))
    faces.append(bm.faces.new(b))
    paint(faces, color, **kw)
    return faces


def extrude_y(profile_xz, y0, y1, color, xform=None, **kw):
    """A bracket: an (x, z) outline, counter-clockwise seen from -y, run along y from y0 to y1."""
    m = xform or Matrix.Identity(4)
    a = [bm.verts.new(m @ Vector((x, y0, z))) for x, z in profile_xz]
    b = [bm.verts.new(m @ Vector((x, y1, z))) for x, z in profile_xz]
    n = len(profile_xz)
    faces = [bm.faces.new([a[i], b[i], b[(i + 1) % n], a[(i + 1) % n]]) for i in range(n)]
    faces.append(bm.faces.new(a))
    faces.append(bm.faces.new(list(reversed(b))))
    paint(faces, color, **kw)
    return faces


# --- Pillars ---------------------------------------------------------------------------------------
# Thick and heavy, as in an old, well-established temple: about 0.6 m across the shaft for 3.3 m of
# height. Everything below head height stays within the 0.45 m keep-clear circle (spec 02).
OCT = 1 - math.tan(math.pi / 8)  # corner cut that turns a square into a regular octagon
LAMP_OUT, LAMP_BACK = 0.42, 0.24  # the gate lamp, from the pillar centre (greybox.ts)


def pillar(cx):
    # Moulded base with cut corners: foot, roll, recess, cushion, recess, top.
    chamfered_stack(cx, 0, [
        (0.400, 0.12, 0.00), (0.400, 0.12, 0.12), (0.370, 0.11, 0.12), (0.370, 0.11, 0.16),
        (0.390, 0.12, 0.20), (0.390, 0.12, 0.32), (0.350, 0.10, 0.37), (0.350, 0.10, 0.43),
        (0.370, 0.11, 0.43), (0.370, 0.11, 0.51), (0.330, 0.06, 0.51), (0.330, 0.06, 0.57),
    ], "base", cap_bottom=False)

    # Shaft: square, stopped chamfers into an octagon, a band, octagon, a band.
    chamfered_stack(cx, 0, [
        (0.310, 0, 0.57), (0.310, 0, 1.12), (0.310, OCT * 0.31, 1.24),
        (0.335, OCT * 0.335, 1.24), (0.335, OCT * 0.335, 1.32), (0.300, OCT * 0.30, 1.32),
        (0.300, OCT * 0.30, 2.02), (0.325, OCT * 0.325, 2.02), (0.325, OCT * 0.325, 2.12),
    ], "stone", cap_bottom=False)

    # Sixteen-sided upper shaft with a thin band.
    stack(cx, 0, 16, [
        (0.290, 2.12), (0.290, 2.44), (0.305, 2.44), (0.305, 2.50), (0.290, 2.50), (0.290, 2.62),
    ], "stone", cap_bottom=False)

    # Pot capital (ghata), neck, square abacus.
    stack(cx, 0, 16, [
        (0.290, 2.62), (0.350, 2.67), (0.385, 2.74), (0.380, 2.81), (0.340, 2.87),
        (0.270, 2.92), (0.250, 2.95), (0.250, 2.99),
    ], "stone", cap_bottom=False, cap_top=False)
    stack(cx, 0, 4, [(0.38, 2.99), (0.38, 3.08)], "stoneDark")

    # Stepped bracket capital carrying the lintel, along x.
    extrude_y([
        (cx - 0.40, 3.08), (cx + 0.40, 3.08), (cx + 0.40, 3.14), (cx + 0.50, 3.18),
        (cx + 0.50, 3.22), (cx + 0.62, 3.25), (cx + 0.62, 3.30), (cx - 0.62, 3.30),
        (cx - 0.62, 3.25), (cx - 0.50, 3.22), (cx - 0.50, 3.18), (cx - 0.40, 3.14),
    ], -0.25, 0.25, "stoneDark")

    # Shelf for the gate lamp, pointing from the pillar towards the lamp code draws.
    lamp = Vector((cx - math.copysign(LAMP_OUT, cx), LAMP_BACK))
    d = (lamp - Vector((cx, 0))).normalized()
    yaw = math.atan2(d.y, d.x)
    m = Matrix.Translation((cx, 0, 0)) @ Matrix.Rotation(yaw, 4, "Z")
    extrude_y([
        (0.15, 2.18), (0.30, 2.18), (0.44, 2.29), (0.56, 2.33), (0.56, 2.375), (0.15, 2.375),
    ], -0.08, 0.08, "stoneDark", xform=m)


for x in (-2.0, 2.0):
    pillar(x)

# --- Lintel and cornice ----------------------------------------------------------------------------
box(-2.62, 2.62, -0.26, 0.26, 3.30, 3.52, "stoneDark")
box(-2.64, 2.64, -0.28, 0.28, 3.42, 3.46, "stoneDark", cap_bottom=False)
box(-2.62, 2.62, -0.24, 0.24, 3.52, 3.64, "stone", cap_bottom=False, cap_top=False)
# A row of plain dentils on the frieze, front and back.
for i in range(26):
    x = -2.5 + i * 0.2
    box(x - 0.05, x + 0.05, -0.29, -0.24, 3.54, 3.63, "stone", jitter=0.06)
    box(x - 0.05, x + 0.05, 0.24, 0.29, 3.54, 3.63, "stone", jitter=0.06)
# Overhanging cornice (chhajja), the full 5.6 m.
TOP = 3.78
extrude_x([(-0.38, 3.64), (0.38, 3.64), (0.38, 3.68), (0.26, TOP), (-0.26, TOP), (-0.38, 3.68)],
          -2.80, 2.80, "stoneDark")

# --- Small tower over the gate -----------------------------------------------------------------------
stack(0, 0, 4, [
    (0.60, TOP), (0.60, 3.86), (0.54, 3.86), (0.54, 3.93), (0.57, 3.93), (0.57, 4.01), (0.50, 4.01),
], "stone", cap_bottom=False, cap_top=False)


def triratha(w):
    """Square plan with a projecting middle band on each face, as on the main shikhara."""
    p, d = 0.36 * w, 0.10 * w
    side = [(w, -w), (w, -p), (w + d, -p), (w + d, p), (w, p)]
    pts = []
    for k in range(4):
        a = k * math.pi / 2
        ca, sa = math.cos(a), math.sin(a)
        pts += [(x * ca - y * sa, x * sa + y * ca) for x, y in side]
    return pts


Z0, Z1, STOREYS = 4.01, 5.05, 5


def tower_w(z):
    t = (z - Z0) / (Z1 - Z0)
    return 0.46 * (1 - 0.42 * t ** 1.5)


rings = []
for k in range(STOREYS):
    za = Z0 + k * (Z1 - Z0) / STOREYS
    zb = Z0 + (k + 1) * (Z1 - Z0) / STOREYS
    wa, wb = tower_w(za), tower_w(zb)
    rings += [  # a thin ledge at the foot of each storey, then the curve in
        ring(triratha(wa * 1.07), 0, 0, za),
        ring(triratha(wa * 1.07), 0, 0, za + 0.035),
        ring(triratha(wa), 0, 0, za + 0.035),
        ring(triratha(wb), 0, 0, zb),
    ]
loft(rings, "shikhara", cap_bottom=True, cap_top=True)

stack(0, 0, 16, [(0.19, 5.05), (0.19, 5.10)], "shikhara", cap_bottom=False, cap_top=False)
# Ribbed amalaka.
stack(0, 0, 32, [
    (0.190, 5.100), (0.290, 5.130), (0.345, 5.165), (0.345, 5.200), (0.290, 5.250), (0.160, 5.280),
], "shikhara", ribs=0.11)
# Kalasha finial, in muted brass.
K0 = 5.28
stack(0, 0, 16, [(r * 1.15, K0 + dz * 1.15) for r, dz in [
    (0.100, 0.000), (0.100, 0.020), (0.130, 0.050), (0.145, 0.090), (0.120, 0.140), (0.060, 0.170),
    (0.045, 0.190), (0.075, 0.210), (0.060, 0.230), (0.035, 0.250), (0.012, 0.340), (0.002, 0.360),
]], "brass", cap_bottom=False, jitter=0.0)

# --- Weathering baked into the colours (the client's matte lighting has no ambient occlusion) -------
bm.normal_update()
moss = hexcol("#6c6f52")
for f in bm.faces:
    n = f.normal
    c = f.calc_center_median()
    k = 1.0
    if n.z < -0.5:
        k *= 0.74  # undersides of beams, brackets and the cornice
    if c.z < 0.7:
        k *= 0.82 + 0.18 * (c.z / 0.7)  # damp, darker near the ground
    green = 0.0
    if n.z > 0.6 and c.z < 3.8:
        green = 0.18  # a little moss where water sits
    if c.z < 0.25:
        green = max(green, 0.22)
    for loop in f.loops:
        r, g, b, a = loop[COL]
        if green:
            r, g, b = (r + (moss[0] - r) * green, g + (moss[1] - g) * green, b + (moss[2] - b) * green)
        loop[COL] = (r * k, g * k, b * k, a)

# --- Marigold garland (after weathering, so the flowers stay bright) --------------------------------
bm.verts.index_update()
GARLAND_V0 = len(bm.verts)
BEAD_R = 0.046
GY = -0.28 - BEAD_R  # just in front of the lintel's moulded band
GZ = 3.44  # hung from the band
SAG = 0.26  # lowest point 3.18 m, well above the gate bell (2.5 to 2.95 m at x = 0)
HOOKS = [-2.45, -1.225, 0.0, 1.225, 2.45]
BANDS = ["marigold", "marigoldYellow", "marigoldDeep", "marigoldYellow"]


def bead(p, color):
    """One marigold head: a small rounded six-sided bead, turned and sized a little at random."""
    s = BEAD_R * random.uniform(0.88, 1.1)
    rot = random.uniform(0, math.pi)
    rings = []
    for rr, zz in [(0.85, -0.55), (1.0, 0.15), (0.55, 0.8)]:  # bottom up, so the faces point out
        rings.append([
            (p.x + s * rr * math.cos(rot + i * math.pi / 3), p.y + s * rr * math.sin(rot + i * math.pi / 3), p.z + s * zz)
            for i in range(6)
        ])
    tone = tuple(v * random.uniform(0.93, 1.05) for v in PAL[color])
    loft(rings, tone, jitter=0.0)


def beads_along(points, spacing, colors, band=5):
    """Beads every `spacing` metres along a polyline, in coloured bands."""
    total, out, carry = 0.0, [], 0.0
    for a, b in zip(points, points[1:]):
        seg = (b - a).length
        t = carry
        while t <= seg:
            out.append(a.lerp(b, t / seg))
            t += spacing
        carry = t - seg
    for i, p in enumerate(out):
        bead(p, colors[(i // band) % len(colors)])
    return len(out)


count = 0
for x0, x1 in zip(HOOKS, HOOKS[1:]):
    pts = []
    for i in range(41):
        t = i / 40
        pts.append(Vector((x0 + (x1 - x0) * t, GY, GZ - SAG * 4 * t * (1 - t))))
    count += beads_along(pts, 0.07, BANDS)
# Short hanging strands at every hook but the middle one, which stays clear of the bell.
for x in HOOKS:
    if x == 0.0:
        continue
    pts = [Vector((x, GY - 0.01, GZ - 0.03)), Vector((x, GY - 0.01, GZ - 0.45))]
    count += beads_along(pts, 0.07, ["marigold", "marigold", "marigoldYellow"], band=3)
print(f"garland: {count} marigolds")

# --- Object, material, export -----------------------------------------------------------------------
old = bpy.data.objects.get("gate")
if old:
    bpy.data.objects.remove(old, do_unlink=True)
mesh = bpy.data.meshes.get("gate")
if mesh:
    bpy.data.meshes.remove(mesh)
mesh = bpy.data.meshes.new("gate")
bm.to_mesh(mesh)
bm.free()
mesh.color_attributes.active_color = mesh.color_attributes["Col"]
mesh.color_attributes.render_color_index = mesh.color_attributes.active_color_index
mesh.shade_smooth()
mesh.set_sharp_from_angle(angle=math.radians(35))
# The flowers are rounded: no hard edges on them.
sharp = mesh.attributes.get("sharp_edge")
if sharp:
    for e in mesh.edges:
        if e.vertices[0] >= GARLAND_V0 and e.vertices[1] >= GARLAND_V0:
            sharp.data[e.index].value = False

mat = bpy.data.materials.get("gate-stone") or bpy.data.materials.new("gate-stone")
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

obj = bpy.data.objects.new("gate", mesh)
bpy.context.scene.collection.objects.link(obj)

tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
xs = [v.co.x for v in mesh.vertices]
zs = [v.co.z for v in mesh.vertices]
print(f"gate: {tris} triangles, width {max(xs) - min(xs):.3f} m, height {max(zs):.3f} m")

if EXPORT and HERE:
    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    out = os.path.join(HERE, "gate.glb")
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
    print("exported", out)
