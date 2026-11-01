# Measuring real things

Two separate problems that get lumped together: getting a drawer's dimensions without
a tape measure, and getting an item's outline so a bin can be shaped around it.

---

## 1. The drawer, via LiDAR

**A web page cannot read the iPhone's LiDAR.** There is no API for it:

- Safari on iOS does not support WebXR `immersive-ar` sessions, so the WebXR
  **Depth Sensing** module — which *is* how you would do this — is out of reach.
  That module works in Chrome on Android via ARCore, so this is an iOS-specific wall,
  not a web-platform one.
- `getUserMedia` hands over camera frames. No depth channel, no ARKit, no mesh.
- ARKit, RoomPlan and Object Capture are native frameworks. Nothing bridges them to
  a browser tab.

Worth re-checking before building anything, since Safari moves — but as it stands,
"use the LiDAR from the web app" is not a thing that can be built.

That leaves four routes, roughly in order of what I would actually do.

### a. A photo of the drawer floor — recommended, and mostly built

Put something of a known size in the bottom of the drawer — the 1:1 paper template
this app already prints is ideal, since it carries a 100 mm bar *and* a printed grid —
shoot straight down, then click the drawer's four inside corners. That gives width and
depth in millimetres from one photograph, on any phone, with no app to install.

The maths is already on this branch (`src/lib/binbench/photo.ts`). It needs a drawer
flavour of the UI: four corner clicks, straight into `drawer.w` / `drawer.d`.

Depth is the catch — a single overhead photo can't see it. Either a second shot
against the drawer's side with the template stood up in it, or just have the user type
one number. Typing one number is not a defeat.

### b. A companion iOS app

The only way to genuinely use LiDAR. Plain ARKit suits a drawer better than RoomPlan,
which is built for rooms and is coarse at this scale: raycast against a detected plane,
tap two corners, read the distance — Apple's own Measure app in miniature. Hand the
result over as a tiny JSON (`{w, d, h}`) through a share sheet, a URL scheme, or a QR
code the web app reads.

The cost is not the AR code, it's everything around it: a second codebase, a developer
account, TestFlight or App Store review, and a release process for what is currently a
static site with no backend. Worth it only if measuring turns out to be the thing
people actually want.

### c. Apple's Measure app, then type three numbers

Zero code. Thirty seconds. Genuinely competitive with (b), and worth saying out loud
before anyone builds an app.

### d. WebXR depth sensing, Android only

Real depth, in the browser, today — but only in Chrome on ARCore devices. Building a
scanning flow that works for some phones and not others is a poor trade unless the
audience skews Android.

### On accuracy

Clicking corners is the error source. At the 290 px preview width a 400 mm drawer puts
roughly **1.4 mm in every pixel**, so a sloppy click costs several millimetres — enough
to matter for a Gridfinity baseplate. Mitigations, in order of value: a zoomed loupe
while placing each corner, filling the frame with the drawer, and using the 1× lens
rather than the 0.5× ultra-wide, whose barrel distortion bends exactly the straight
edges the homography assumes are straight.

---

## 2. The item, via a photo with a ruler

### Why a ruler alone isn't enough

A ruler gives you scale. It does not give you perspective. Tilt the phone and the far
end of the ruler is smaller than the near end, so "pixels per millimetre" stops being
one number. Four points of a rectangle whose size you know pin down the whole plane —
that's a homography, and everything lying on that plane comes back true.

How much it matters, measured on a synthetic tilted shot of an item that is really
62.5 × 38.4 mm:

| method | result |
| --- | --- |
| four corners of a known rectangle | 62.5 × 38.4 ✓ |
| one known length, assuming square-on | 60.4 × 63.8 ✗ |

So: offer both, default to the rectangle, and use the printed template as the
rectangle whenever possible.

### What is on this branch

`src/lib/binbench/photo.ts`
- `solveHomography` — four correspondences, direct linear transform, Gauss-Jordan
- `applyH`, `scaleOnly` (the square-on shortcut), `bbox`, `polyArea`
- `simplify` — Ramer–Douglas–Peucker; a hand-traced outline carries far more points
  than the shape needs, and each one becomes wall segments later
- `grow` — a crude outward offset for drop-in clearance; see the caveat below

`src/components/binbench/PhotoMeasure.tsx` — load a photo, click the reference, trace
the item, read its size in millimetres, make a bin that size, copy the outline.

### What it would take to make it an actual insert

1. **Carry the outline on the bin.** `outline?: [number, number][]` and
   `insertDepth?: number` on `Bin`, round-tripped through `project-io`. Keep the
   version at 5 and treat both as optional, the way `gfWholeCells` was handled.

2. **Offset for clearance.** A traced outline is the item's size; the pocket needs to
   be 0.4–0.75 mm larger all round or nothing drops in. `grow` pushes every point out
   from the centroid, which is fine for a roughly round or convex item and **wrong for
   a concave one** — an L-shaped outline will pinch. A real edge-offset (walk each
   edge outward along its normal, reintersect neighbours, drop inverted loops) is the
   fix, or restrict inserts to the convex hull to begin with.

3. **Cut the pocket.** The codebase already does this exact job for magnet holes:
   `gfFootTris` triangulates a face with circular holes in it using
   `ShapeUtils.triangulateShape`. The same three pieces generalise to any polygon:
   - the bin's floor top face = floor rectangle **minus** the outline, triangulated
     with the outline as a hole
   - the pocket's side walls = a vertical quad per outline edge
   - the pocket's own floor = the outline triangulated, sitting `insertDepth` down

   No clipper work needed: `clipToRect` is rectangle-only, but a bin is never tiled,
   so nothing has to cut this shape.

4. **Make it printable.** Vertical pocket walls are fine unsupported. Worth adding a
   **finger scoop** — a ramp at one edge — or the item will be perfectly located and
   impossible to get out. A degree or two of draft helps release too.

### Questions I would want answered before building step 3

- **Pocket, or separate tray?** Cutting into the bin floor is fewer parts; a drop-in
  tray printed separately lets one bin take different inserts, and prints flat.
- **What happens to dividers?** An insert and dividers in the same bin fight over the
  same volume. Simplest rule: a bin has one or the other.
- **Default depth.** A fraction of the item's height, or an explicit number per insert?
