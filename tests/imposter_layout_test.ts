import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import {
  decodeImposterDirection,
  encodeImposterDirection,
  type ImposterCoverage,
  type ImposterVector3,
  makeImposterLayout,
  resolveImposterOptions,
} from "../web/imposter-layout.ts";

function close(actual: readonly number[], expected: readonly number[]) {
  actual.forEach((value, index) =>
    assertAlmostEquals(value, expected[index], 1e-12)
  );
}

function dot(a: ImposterVector3, b: ImposterVector3): number {
  return a.reduce((sum, value, index) => sum + value * b[index], 0);
}

Deno.test("octahedral imposter mapping covers cardinal directions and roundtrips a sphere", () => {
  close(decodeImposterDirection([0.5, 0.5], 180), [0, 1, 0]);
  close(decodeImposterDirection([0, 0], 180), [-1, 0, 0]);
  close(decodeImposterDirection([1, 0], 180), [0, 0, -1]);
  close(decodeImposterDirection([0, 1], 180), [0, 0, 1]);
  close(decodeImposterDirection([1, 1], 180), [1, 0, 0]);
  close(decodeImposterDirection([0.5, 0.5], 360), [0, 1, 0]);
  close(decodeImposterDirection([0, 0.5], 360), [-1, 0, 0]);
  close(decodeImposterDirection([1, 0.5], 360), [1, 0, 0]);
  close(decodeImposterDirection([0.5, 0], 360), [0, 0, -1]);
  close(decodeImposterDirection([0.5, 1], 360), [0, 0, 1]);
  for (const uv of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
    close(decodeImposterDirection(uv, 360), [0, -1, 0]);
  }
  for (const coverage of [180, 360] as const) {
    // Deterministic stratified spherical samples, including both poles and horizon.
    for (let yi = coverage === 180 ? 0 : -10; yi <= 10; yi++) {
      const y = yi / 10;
      for (let angleIndex = 0; angleIndex < 31; angleIndex++) {
        const angle = angleIndex * 2 * Math.PI / 31;
        const radius = Math.sqrt(1 - y * y);
        const direction: ImposterVector3 = [
          radius * Math.cos(angle),
          y,
          radius * Math.sin(angle),
        ];
        const uv = encodeImposterDirection(direction, coverage);
        assert(uv.every((v) => v >= 0 && v <= 1));
        close(decodeImposterDirection(uv, coverage), direction);
      }
    }
  }
});

Deno.test("imposter hemispherical lattice roundtrips and has no below-horizon views", () => {
  const layout = makeImposterLayout({}, [3, 2, -1], 2);
  assertEquals(layout.tiles.length, 81);
  assertEquals(layout.center, [3, 2, -1]);
  assertAlmostEquals(layout.orthographic.width, 4.2);
  assert(layout.tiles.every((tile) => tile.direction[1] >= 0));
  assert(layout.tiles.some((tile) => tile.direction[1] === 1));
  assertEquals(
    layout.tiles.filter((tile) => tile.direction[1] === 0).length,
    32,
  );
  for (const tile of layout.tiles) {
    close(encodeImposterDirection(tile.direction, 180), tile.octUV);
  }
  const full = makeImposterLayout({ coverage: 360 }, [0, 0, 0], 1);
  assert(full.tiles.some((tile) => tile.direction[1] < 0));
  assertEquals(full.tiles.filter((tile) => tile.direction[1] === -1).length, 4);
  for (const tile of full.tiles) {
    // Opposite seam coordinates and all four corners can encode identically;
    // the reconstructed direction, rather than the seam UV, must roundtrip.
    close(
      decodeImposterDirection(
        encodeImposterDirection(tile.direction, 360),
        360,
      ),
      tile.direction,
    );
  }
  for (let grid = 3; grid <= 33; grid += 2) {
    const hemi = makeImposterLayout({ grid, tileSize: 16 }, [0, 0, 0], 1);
    for (const tile of hemi.tiles) {
      assert(tile.direction[1] >= 0);
      close(encodeImposterDirection(tile.direction, 180), tile.octUV);
      if (
        tile.row === 0 || tile.row === grid - 1 || tile.col === 0 ||
        tile.col === grid - 1
      ) {
        assertEquals(tile.direction[1], 0);
      }
    }
  }
});

Deno.test("imposter tiles partition atlas with inset content and normalized top-left UVs", () => {
  const layout = makeImposterLayout({ grid: 5, tileSize: 64, gutter: 3 }, [
    0,
    0,
    0,
  ], 1);
  assertEquals(layout.atlas, { width: 320, height: 320, origin: "top-left" });
  const occupied = new Set<string>();
  for (const tile of layout.tiles) {
    assertEquals(tile.index, tile.row * 5 + tile.col);
    assertEquals(tile.rect, {
      x: tile.col * 64,
      y: tile.row * 64,
      width: 64,
      height: 64,
    });
    assertEquals(tile.contentRect, {
      x: tile.rect.x + 3,
      y: tile.rect.y + 3,
      width: 58,
      height: 58,
    });
    for (const key of ["x", "y", "width", "height"] as const) {
      assertAlmostEquals(tile.uvRect[key] * 320, tile.contentRect[key]);
    }
    for (let y = tile.rect.y; y < tile.rect.y + tile.rect.height; y++) {
      for (let x = tile.rect.x; x < tile.rect.x + tile.rect.width; x++) {
        const key = `${x}:${y}`;
        assert(!occupied.has(key));
        occupied.add(key);
      }
    }
  }
  assertEquals(occupied.size, 320 * 320);
});

Deno.test("imposter camera bases are orthonormal at poles and around the sphere", () => {
  for (const coverage of [180, 360] as const) {
    const layout = makeImposterLayout({ coverage }, [0, 0, 0], 1);
    for (const { direction, right, up } of layout.tiles) {
      assertAlmostEquals(dot(direction, direction), 1);
      assertAlmostEquals(dot(right, right), 1);
      assertAlmostEquals(dot(up, up), 1);
      assertAlmostEquals(dot(right, up), 0, 1e-12);
      assertAlmostEquals(dot(direction, right), 0, 1e-12);
      assertAlmostEquals(dot(direction, up), 0, 1e-12);
      close([
        right[1] * up[2] - right[2] * up[1],
        right[2] * up[0] - right[0] * up[2],
        right[0] * up[1] - right[1] * up[0],
      ], direction);
    }
  }
});

Deno.test("imposter options reject invalid and excessive capture sizes", () => {
  assertEquals(resolveImposterOptions(), {
    coverage: 180,
    grid: 9,
    tileSize: 256,
    gutter: 2,
    padding: 1.05,
  });
  for (const grid of [0, 1, 2, 4, 35, 3.5, NaN, Infinity]) {
    assertThrows(() => resolveImposterOptions({ grid }));
  }
  for (const tileSize of [0, 15, 2049, 16.5, NaN, Infinity]) {
    assertThrows(() => resolveImposterOptions({ tileSize }));
  }
  for (const gutter of [-1, 8, 0.5, NaN, Infinity]) {
    assertThrows(() => resolveImposterOptions({ tileSize: 16, gutter }));
  }
  for (const padding of [0, 0.99, 4.01, NaN, Infinity]) {
    assertThrows(() => resolveImposterOptions({ padding }));
  }
  assertThrows(() => resolveImposterOptions({ grid: 33, tileSize: 256 }));
  assertThrows(() =>
    resolveImposterOptions({ coverage: 90 as ImposterCoverage })
  );
  assertThrows(() => makeImposterLayout({}, [0, NaN, 0], 1));
  for (const radius of [0, -1, NaN, Infinity, Number.MAX_VALUE]) {
    assertThrows(() => makeImposterLayout({}, [0, 0, 0], radius));
  }
  assertThrows(() => encodeImposterDirection([0, -1, 0], 180));
  assertThrows(() => encodeImposterDirection([0, 0, 0]));
  assertThrows(() => encodeImposterDirection([NaN, 0, 1]));
  assertThrows(() => decodeImposterDirection([-0.1, 0]));
  assertThrows(() => decodeImposterDirection([0, NaN]));
});
