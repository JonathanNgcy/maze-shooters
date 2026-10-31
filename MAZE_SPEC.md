# Maze Shooters — maze and spawn specification

M1 uses the single authored fixture `maze-01`, mapVersion 2. No procedural generator or random seed is required.

## Coordinates and geometry

The grid has 9 columns and 9 rows, indexed c=0..8 and r=0..8. Each tile is 2.5 m square. Its center is `x = (c - 4) * 2.5`, `z = (r - 4) * 2.5`. Increasing row goes toward +Z/south. Y is up. The entire footprint spans -11.25..11.25 on X and Z. The floor top is Y=0 and is visual only for the fixed-height projectile.

`#` is a solid wall tile. `.` is walkable corridor space. `1` and `2` are walkable spawn tiles plus player metadata. Treat spawn characters as open cells in graph algorithms. Wall tiles occupy the full closed tile rectangle in XZ and Y=0..3 m. Adjacent wall rectangles meet without cracks. Corridors are 2.5 m wide wherever a single open tile lies between walls. No thin wall-edge system is used in this fixture.

Wall collider IDs are `wall:r:c`, for example `wall:2:4`. Emit them in numeric row-major order, r then c; retain that order for collision ties. Wall render instances may be batched or merged for performance, but collider rectangles and identities remain stable. A rendered wall's center is at its tile center and Y=1.5, with dimensions 2.5 by 3.0 by 2.5. Do not scale collider coordinates differently from mesh coordinates.

## Exact fixture

Store exactly these ASCII rows in `src/maze/fixture.ts`. No spaces, tabs, indentation, or extra blank rows belong in the data.

```text
#########
#1......#
###.#.#.#
#...#...#
#.#.#.#.#
#...#...#
#.#.#.###
#......2#
#########
```

This grid has 36 open cells, 45 wall cells, and 40 undirected orthogonal open-cell adjacencies. All open cells form one component. The graph has five independent cycles (`edges - vertices + 1`), giving exploration alternatives rather than a single forced corridor. Occupancy is invariant under a 180-degree rotation; that rotation swaps spawn labels.

## Spawns and guns

| Player | Grid (c,r) | World (x,z) | Heading | Faces | Muzzle (x,z) |
| --- | --- | --- | --- | --- | --- |
| p1 | (1,1) | (-7.5,-7.5) | +pi/2 | +X/east | (-6.85,-7.5) |
| p2 | (7,7) | (7.5,7.5) | -pi/2 | -X/west | (6.85,7.5) |

Player bodies are vertical target cylinders centered at the grid centers, radius 0.35 m and height 1.8 m. A visual body can be a simple approximation, but its marked target area must match that collider. Player meshes and fixed guns never move or rotate during a match. Gun tips and projectiles are at Y=1.0 m. The fixed muzzle offset is 0.65 m along the declared heading; launch speed and projectile radius come from PHYSICS_SPEC.md.

Spawn cells have a full-tile corridor margin. Both launch corridors are clear for at least 8 m beyond the muzzle before the first wall at the end of that straight corridor. The line between the spawn centers crosses walls; it is not a legal straight shot. There is no transparent or hidden gap through which an unsteered launch can hit the other player.

The player collider is present from launch onward. Do not disable it as part of spawn placement. Muzzles must be outside both target circles and every rounded wall expansion. The two player cylinders may never overlap any wall tile or each other.

## Route and playability

Breadth-first search with orthogonal unit-cost moves gives distance 12 edges between the two spawn cells, or 30 m along tile centers. One shortest route has these turning waypoints, expressed as (column,row):

```text
(1,1) -> (5,1) -> (5,7) -> (7,7)
```

The 180-degree-rotated counterpart is available to p2 with the symmetric initial heading. These waypoints are a geometric route, not an autopilot or a forced player path. A 3D maze renderer should not display this solution to normal players. Turns need anticipatory braking; a centerline route is not by itself a guarantee that a projectile traveling at full speed can corner.

Before declaring M1 complete, demonstrate a collision-enabled, WASD-only shot hitting the opponent from both spawns within the canonical lifetime. Record a replay with tick masks and rule/map metadata in the implemented test suite. If playtesting exposes a route problem, change tuning coherently and update its owner document and tests. Do not enlarge invisible corridors or shrink only the collision model to make a path pass.

## Fixture validation

Run validation at startup and in headless tests. Required checks:

1. Exactly 9 rows, each length 9, characters only `#`, `.`, `1`, `2` with no spaces accepted; exactly one 1 and one 2.
2. Every perimeter cell is a wall. There is no out-of-bounds open neighbor. All tile centers and extents are finite and correctly scaled.
3. Orthogonal flood-fill reaches all 36 open cells and both spawns. Graph distance, wall count, edge count, and rotational occupancy symmetry match this fixture.
4. The two targets and muzzle circles have positive clearance from walls and each other. Initial launch directions lead into the declared clear corridors.
5. A straight segment between targets intersects solid wall geometry. A default unsteered shot cannot produce a direct opponent hit.
6. Wall collider IDs are unique, stable, and row-major; each collider matches its tile's XZ bounds. Every visible wall has corresponding physical coverage.

Reject malformed fixtures with a useful error naming the row, column, or failed condition. No fallback random map or silent map editing belongs in M1.

## Rendering and navigation cues

Use one continuous floor, solid opaque walls, and simple ambient plus directional lighting. Keep wall tops high enough that the in-flight view cannot see over them. The normal camera stays close to projectile height. An open roof is acceptable because normal play has no overhead camera.

Add subtle neutral region marks or floor seams if needed to help players recognize corridors. Do not put opponent-direction arrows, target outlines through walls or a complete solution in the normal HUD. The private exploration map reveals only cells crossed by that seat's missile, with adjacent wall tiles as context; unvisited open cells stay fogged. Physical visibility uses the same opaque wall coverage as collision. Per-player wall splashes from actual previous impacts are permitted navigation memory; they remain on physical wall faces, are visible only to their owning seat, and reset on rematch. Decorative props must remain outside navigable space or have explicit physics; omit them for M1 if they could confuse contact rules.

## Future generation

Seeded generation is M3, after online authority and the fixture work. A later generator must specify PRNG, seed encoding, algorithm/version, connectivity, clearances, spawn separation, sightline rejection, symmetry or fairness criteria, and a bounded failure policy. A seed alone does not identify a map without those algorithm versions. M2 should send the canonical fixture rows and metadata rather than assume an unspecified client generator.

## Smaller navigation fixture — 27 October 2026

At the user's request, mapVersion 2 replaces the original 13×13 fixture with this 9×9 layout: 81 total tiles instead of 169, and 36 open corridor tiles instead of 77. The documented route has two turns instead of four, and the shortest spawn path is 12 edges (30 m) instead of 20 (50 m). The smaller layout retains five cycles, 180-degree occupancy symmetry, safe fixed opposite muzzles and blocked direct sightlines. Tile size, physical radii, momentum, thrust and flight duration are unchanged. Exploration draws the current grid dimensions and still resets both private maps on Rematch. All recorded winning replays must identify mapVersion 2; old mapVersion 1 traces are incompatible with this authored geometry. M2 is subsequent work, not part of this map change.
