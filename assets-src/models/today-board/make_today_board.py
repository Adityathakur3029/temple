"""
Sannidhi today board, the `today-board` slot in spec 11. Made for Sannidhi by Claude (AI) in
Blender 5.2 by this script, so the model is "ai": true and disclosed in the credits.

Run inside Blender (Scripting tab, or the MCP connector):
    path = r"<repo>/assets-src/models/today-board/make_today_board.py"
    exec(compile(open(path, encoding="utf-8").read(), path, "exec"), {"__file__": path})
It replaces any earlier "today-board" object and, if EXPORT is set, writes today-board.glb.

Frame: Blender metres, z up, origin at the bottom centre; -y is the front (glTF +z), which the
slot turns to face the path.

Lines up with greybox.ts and spec 02:
- Exactly 2.02 m tall (the ridge), so fit "none" places it as made.
- Below head height everything stays inside the today-board obstacle, x +/-0.8 and y +/-0.2.
  Only the little roof, above 1.82 m, reaches out to x +/-0.9.
- The painted panel, where the code draws the day's counts (spec 02, spec 11): its front face is
  at y = -0.065, x +/-0.72, z 1.06 ... 1.79, as in the greybox. It is left blank: a cream panel
  with a thin saffron painted border, and no text, symbol or figure.
A deodar board nailed to the front of two posts on stone footings, under a small slate roof with
a carved wooden fringe at the eaves, like a hill-village notice board. One material with vertex
colours: one draw call.
"""
import math
import os
import random

import bmesh
import bpy

EXPORT = True
NAME = "today-board"
HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else None

random.seed(56)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexcol(h):
    h = h.lstrip("#")
    return tuple(srgb_to_linear(int(h[i : i + 2], 16) / 255) for i in (0, 2, 4))


PAL = {
    "stone": hexcol("#8b8070"),
    "post": hexcol("#5a4030"),
    "plank": hexcol("#6a4a32"),
    "frame": hexcol("#4f3725"),
    "paint": hexcol("#cbb68e"),
    "saffron": hexcol("#c4702a"),
    "slate": hexcol("#5f605d"),
    "trim": hexcol("#553b29"),
}

bm = bmesh.new()
COL = bm.loops.layers.float_color.new("Col")


def paint(faces, color, jitter=0.05):
    base = PAL[color] if isinstance(color, str) else color
    k = 1 + random.uniform(-jitter, jitter)  # one tone per piece
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


def extrude_x(profile_yz, x0, x1, color, **kw):
    """A (y, z) outline, counter-clockwise seen from +x, run along x from x0 to x1."""
    a = [bm.verts.new((x0, y, z)) for y, z in profile_yz]
    b = [bm.verts.new((x1, y, z)) for y, z in profile_yz]
    n = len(profile_yz)
    faces = [bm.faces.new([a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]]) for i in range(n)]
    faces.append(bm.faces.new(b))
    faces.append(bm.faces.new(list(reversed(a))))
    paint(faces, color, **kw)
    return faces


# --- Sizes ------------------------------------------------------------------------------------------
HALF_W = 0.8  # board, footings and posts: inside the obstacle
POST_X = (0.57, 0.69)  # each post's inner and outer face, mirrored
POST_Y = (0.02, 0.14)  # behind the board
FOOT = 0.10  # top of the stone footings
BOARD_Y = (-0.045, 0.02)  # the plank backing
BOARD_Z = (1.0, 1.85)
PANEL_Y = -0.065  # the painted face, as in the greybox
PANEL_X = 0.72
PANEL_Z = (1.06, 1.79)
FRAME_Y = -0.08  # the frame stands 1.5 cm proud of the panel
ROOF_X = 0.9
EAVE = 0.2  # roof reach front and back (the obstacle's depth)
RIDGE = 1.985  # top of the lowest slate course at the ridge; the ridge cap ends at 2.02 m
PITCH = 0.5  # the roof drops 0.5 m per metre out from the ridge
SHEATH = 0.02  # boards under the slates
SLATE = 0.014
TOP = 2.02


def roof_z(y):
    """Top of the boards under the slates."""
    return RIDGE - PITCH * abs(y)


# --- Stone footings and posts ----------------------------------------------------------------------
for sx in (-1, 1):
    cx = sx * (POST_X[0] + POST_X[1]) / 2
    cy = (POST_Y[0] + POST_Y[1]) / 2
    rings = []
    for z, h in ((0.0, 0.12), (FOOT - 0.015, 0.11), (FOOT, 0.10)):
        rings.append([(cx - h, cy - h, z), (cx + h, cy - h, z), (cx + h, cy + h, z), (cx - h, cy + h, z)])
    loft(rings, "stone", cap_bottom=False, jitter=0.06)

    # A post with chamfered corners, from the footing up to the beam under the roof.
    x0, x1 = sorted((sx * POST_X[0], sx * POST_X[1]))
    y0, y1 = POST_Y
    c = 0.014
    oct_ = [(x0 + c, y0), (x1 - c, y0), (x1, y0 + c), (x1, y1 - c), (x1 - c, y1), (x0 + c, y1),
            (x0, y1 - c), (x0, y0 + c)]
    loft([[(x, y, FOOT) for x, y in oct_], [(x, y, 1.85) for x, y in oct_]], "post", cap_bottom=False)

# --- The board: horizontal planks, the painted panel, its frame and a ledge below ------------------
n_planks = 4
step = (BOARD_Z[1] - BOARD_Z[0]) / n_planks
for i in range(n_planks):
    z0 = BOARD_Z[0] + i * step
    box(-HALF_W, HALF_W, BOARD_Y[0], BOARD_Y[1], z0 + (0.002 if i else 0), z0 + step, "plank", jitter=0.08)

# The panel's face is a grid so the paint can fade towards the bottom, with the saffron border as
# its own cells (vertex colours are per face corner, so the border stays crisp).
PX = PANEL_X + 0.01  # tucked 1 cm under the frame
BAND_IN, BAND_W = 0.03, 0.02  # border 3 cm in from the visible edge, 2 cm wide
xs = [-PX, -(PANEL_X - BAND_IN), -(PANEL_X - BAND_IN - BAND_W), -0.33, 0.0, 0.33,
      PANEL_X - BAND_IN - BAND_W, PANEL_X - BAND_IN, PX]
z_lo, z_hi = PANEL_Z[0] - 0.01, PANEL_Z[1] + 0.01
zs = [z_lo, PANEL_Z[0] + BAND_IN, PANEL_Z[0] + BAND_IN + BAND_W, 1.3, 1.55,
      PANEL_Z[1] - BAND_IN - BAND_W, PANEL_Z[1] - BAND_IN, z_hi]


def panel_tone(x, z):
    """Sun-faded paint, a little darker near the bottom where rain splashes, and under the roof."""
    k = 0.93 + 0.07 * min(1.0, (z - PANEL_Z[0]) / 0.3)
    k *= 1.0 - 0.04 * max(0.0, (z - 1.7) / 0.1)
    k *= 1.0 + 0.02 * math.sin(7.3 * x + 3.1 * z) * math.cos(4.1 * z - 2.0 * x)
    return k


grid = [[bm.verts.new((x, PANEL_Y, z)) for x in xs] for z in zs]
for j in range(len(zs) - 1):
    for i in range(len(xs) - 1):
        f = bm.faces.new([grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]])
        cx = (xs[i] + xs[i + 1]) / 2
        cz = (zs[j] + zs[j + 1]) / 2
        ax, az = abs(cx), cz
        in_band_x = PANEL_X - BAND_IN - BAND_W < ax < PANEL_X - BAND_IN
        in_band_z = (PANEL_Z[0] + BAND_IN < az < PANEL_Z[0] + BAND_IN + BAND_W
                     or PANEL_Z[1] - BAND_IN - BAND_W < az < PANEL_Z[1] - BAND_IN)
        inside_x = ax < PANEL_X - BAND_IN
        inside_z = PANEL_Z[0] + BAND_IN < az < PANEL_Z[1] - BAND_IN
        band = (in_band_x and inside_z) or (in_band_z and inside_x)
        base = PAL["saffron"] if band else PAL["paint"]
        for loop in f.loops:
            k = panel_tone(loop.vert.co.x, loop.vert.co.z)
            loop[COL] = (*(min(1.0, v * k) for v in base), 1.0)
# Its edges, 1 cm wider than the opening, sit inside the frame, so they need no faces of their own.

# Frame: rails top and bottom, stiles at the sides.
box(-HALF_W, HALF_W, FRAME_Y, BOARD_Y[0], BOARD_Z[0], PANEL_Z[0], "frame")
box(-HALF_W, HALF_W, FRAME_Y, BOARD_Y[0], PANEL_Z[1], BOARD_Z[1], "frame")
for sx in (-1, 1):
    x0, x1 = sorted((sx * PANEL_X, sx * HALF_W))
    box(x0, x1, FRAME_Y, BOARD_Y[0], PANEL_Z[0], PANEL_Z[1], "frame")
# A narrow ledge under the board, as boards like this often have.
box(-HALF_W + 0.04, HALF_W - 0.04, -0.12, BOARD_Y[0], BOARD_Z[0] - 0.035, BOARD_Z[0], "frame")

# --- Beam on the posts, then the roof ---------------------------------------------------------------
beam_top = roof_z(0.16) - SHEATH
box(-0.86, 0.86, 0.0, 0.16, 1.85, beam_top, "post")

# Boards under the slates, both slopes.
for s in (-1, 1):
    ya, yb = sorted((0.0, s * EAVE))
    bottom = [(-ROOF_X, ya, roof_z(ya) - SHEATH), (ROOF_X, ya, roof_z(ya) - SHEATH),
              (ROOF_X, yb, roof_z(yb) - SHEATH), (-ROOF_X, yb, roof_z(yb) - SHEATH)]
    top = [(x, y, z + SHEATH) for x, y, z in bottom]
    loft([bottom, top], "trim", jitter=0.03)

# Slates: three courses a side, each tile its own shade; every course rests on the one below it.
COURSES = [(0.13, 0.2), (0.06, 0.145), (0.0, 0.075)]  # |y| from the ridge, eave course first
TILES = 9
for s in (-1, 1):
    for k, (r0, r1) in enumerate(COURSES):
        lift = 0.007 * k
        for t in range(TILES):
            xa = -ROOF_X + 2 * ROOF_X * t / TILES
            xb = -ROOF_X + 2 * ROOF_X * (t + 1) / TILES
            xa, xb = xa + 0.002, xb - 0.002
            ya, yb = sorted((s * r0, s * r1))
            bottom = [(xa, ya, roof_z(ya) + lift), (xb, ya, roof_z(ya) + lift),
                      (xb, yb, roof_z(yb) + lift), (xa, yb, roof_z(yb) + lift)]
            top = [(x, y, z + SLATE) for x, y, z in bottom]
            tone = tuple(v * random.uniform(0.88, 1.1) for v in PAL["slate"])
            loft([bottom, top], tone, jitter=0.0)

# Ridge cap: a wooden board with a ridge along the top, ending exactly at 2.02 m.
extrude_x([(-0.045, RIDGE - 0.002), (0.045, RIDGE - 0.002), (0.045, RIDGE + 0.012),
           (0.0, TOP), (-0.045, RIDGE + 0.012)], -ROOF_X - 0.01, ROOF_X + 0.01, "frame")

# Barge boards on the gable ends, a plank down each slope.
for sx in (-1, 1):
    x0, x1 = sorted((sx * (ROOF_X - 0.025), sx * (ROOF_X - 0.01)))
    under_eave = roof_z(EAVE) - SHEATH
    under_ridge = roof_z(0.0) - SHEATH
    extrude_x([(-EAVE, under_eave - 0.04), (0.0, under_ridge - 0.04), (0.0, under_ridge),
               (-EAVE, under_eave)], x0, x1, "trim")
    extrude_x([(0.0, under_ridge - 0.04), (EAVE, under_eave - 0.04), (EAVE, under_eave),
               (0.0, under_ridge)], x0, x1, "trim")

# A carved fringe of shallow scallops hanging from the eaves, front and back.
under_eave = roof_z(EAVE) - SHEATH
fringe_bottom = under_eave - 0.035
xa, xb = -(ROOF_X - 0.025), ROOF_X - 0.025
n = 8
w = (xb - xa) / n
pts = [(xa, under_eave), (xa, fringe_bottom)]
for j in range(n):
    for q in range(1, 5):
        tt = q / 5
        pts.append((xa + w * (j + tt), fringe_bottom + 0.014 * math.sin(math.pi * tt)))
    pts.append((xa + w * (j + 1), fringe_bottom))
pts.append((xb, under_eave))
extrude_y(pts, -EAVE + 0.004, -EAVE + 0.016, "trim")
extrude_y(pts, EAVE - 0.016, EAVE - 0.004, "trim")

# --- Weathering: darker near the ground and on undersides -------------------------------------------
bm.normal_update()
for f in bm.faces:
    nrm = f.normal
    c = f.calc_center_median()
    k = 1.0
    if nrm.z < -0.5:
        k *= 0.78
    if c.z < 0.4:
        k *= 0.82 + 0.18 * (c.z / 0.4)
    if k != 1.0:
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

mat = bpy.data.materials.get("board-wood") or bpy.data.materials.new("board-wood")
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
obj.location = (3.0, 2.0, 0.0)  # beside the path, inside the gate (inside is +y); not exported

tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
xs_ = [v.co.x for v in mesh.vertices]
ys_ = [v.co.y for v in mesh.vertices]
zs_ = [v.co.z for v in mesh.vertices]
low = [v.co for v in mesh.vertices if v.co.z < 1.82]
print(f"{NAME}: {tris} triangles, {max(xs_) - min(xs_):.3f} wide, y {min(ys_):.3f}..{max(ys_):.3f}, "
      f"height {min(zs_):.3f}..{max(zs_):.3f}; below 1.82 m: x {max(abs(v.x) for v in low):.3f}, "
      f"y {min(v.y for v in low):.3f}..{max(v.y for v in low):.3f}")

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
