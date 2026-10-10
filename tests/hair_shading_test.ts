import { assert, assertEquals, assertThrows } from "@std/assert";
import * as THREE from "three";
import {
  groomHairMaterial,
  matchGroomShadowCoverage,
} from "../src/hair/hair-shading.ts";

Deno.test("groom hair has a portable masked anisotropic material fallback", () => {
  const map = new THREE.Texture();
  const normalMap = new THREE.Texture();
  const tangentMap = new THREE.Texture();
  const depthMap = new THREE.Texture();
  const material = groomHairMaterial({
    color: "#6c3c22",
    map,
    normalMap,
    tangentMap,
    depthMap,
    roughness: .36,
  });
  assert(material.isMeshPhysicalMaterial);
  assertEquals(material.map, map);
  assertEquals(material.normalMap, normalMap);
  assertEquals(material.anisotropyMap, tangentMap);
  assertEquals(material.groomDepthMap, depthMap);
  assertEquals(material.anisotropyRotation, 0);
  assertEquals(material.metalness, 0);
  assertEquals(material.roughness, .36);
  assertEquals(material.ior, 1.55);
  assertEquals(material.alphaTest, .3);
  assertEquals(material.transparent, false);
  assertEquals(material.depthWrite, true);
  assertEquals(material.side, THREE.DoubleSide);
  assert(
    material.userData.threejsGroomShading.export.includes(
      "no custom hair BSDF",
    ),
  );
  // Uniform values cannot leak between differing maps or materials through the
  // shader cache; the map variant is a separate program, parameters are uniforms.
  assert(
    groomHairMaterial().customProgramCacheKey() !==
      material.customProgramCacheKey(),
  );
  assertEquals(groomHairMaterial({ tangentAxis: "u" }).anisotropyRotation, 0);
  assertEquals(groomHairMaterial().anisotropyRotation, Math.PI / 2);
});

Deno.test("groom hair rejects nonfinite or invalid optical controls", () => {
  for (
    const options of [
      { roughness: NaN },
      { roughness: -1 },
      { roughness: 2 },
      { ior: 1 },
      { ior: Infinity },
      { absorptionScale: -1 },
      { depthOcclusion: 2 },
      { normalScale: -1 },
      { cuticleTiltDegrees: 11 },
      { alphaTest: -1 },
    ]
  ) assertThrows(() => groomHairMaterial(options));
});

Deno.test("groom shadow coverage preserves callbacks and follows material groups", () => {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), [
    groomHairMaterial({ alphaTest: .12 }),
    groomHairMaterial({ alphaTest: .28 }),
  ]);
  let calls = 0;
  mesh.onBeforeShadow = () => {
    calls++;
  };
  matchGroomShadowCoverage(mesh);
  matchGroomShadowCoverage(mesh);
  const camera = new THREE.PerspectiveCamera();
  const depth = new THREE.MeshDepthMaterial({ alphaTest: .5 });
  mesh.onBeforeShadow(
    {} as THREE.WebGLRenderer,
    new THREE.Scene(),
    camera,
    camera,
    mesh.geometry,
    depth,
    { start: 0, count: 6, materialIndex: 1 } as unknown as THREE.Group,
  );
  assertEquals(calls, 1);
  assertEquals(depth.alphaTest, .28);
  const clone = mesh.clone();
  assertEquals(clone.userData.threejsGroomShadowCoverage, true);
  assert(clone.onBeforeShadow !== mesh.onBeforeShadow);
});
