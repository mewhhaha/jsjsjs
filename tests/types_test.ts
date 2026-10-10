import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "node:path";
import ts from "typescript";
import { emitTypes } from "../src/types.ts";

function check(project: string) {
  const configFile = join(project, "tsconfig.json");
  const config = ts.readConfigFile(configFile, ts.sys.readFile);
  assert(!config.error);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, project);
  assertEquals(parsed.errors, []);
  assertEquals(parsed.options.skipLibCheck, false);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  // Every model/library dependency must come from this movable bundle. The
  // compiler's standard library is the only allowed external declaration.
  for (const source of program.getSourceFiles()) {
    assert(
      program.isSourceFileDefaultLibrary(source) ||
        source.fileName.startsWith(project + "/"),
      `Declaration resolved outside the project: ${source.fileName}`,
    );
  }
  return ts.getPreEmitDiagnostics(program);
}

Deno.test("emitted model types are complete and movable, with strict diagnostics", async () => {
  const source = await Deno.makeTempDir({ prefix: "js3-types-source-" });
  const project = await Deno.makeTempDir({ prefix: "js3-types-project-" });
  try {
    const generated = join(source, "generated");
    const report = await emitTypes(generated);
    assert(report.declarations > 500);
    assertEquals(report.dependencies["@types/three"], "0.185.0");
    assert(report.dependencies["@types/webxr"]);
    assert(report.dependencies["fflate"]);
    const bundle = join(project, ".js3");
    await Deno.rename(generated, bundle);
    await Deno.writeTextFile(
      join(project, "tsconfig.json"),
      JSON.stringify({
        extends: "./.js3/tsconfig.json",
        include: ["model.ts"],
      }),
    );
    await Deno.writeTextFile(
      join(project, "model.ts"),
      `
import { box, group, material, stairs, ramp, arch, wall, column, gableRoof, basin, bottle, dome, pipe, frame, beamBetween, railing, shelving, union, offsetProfile, bevel } from "js3";
import type { BasinOptions, SolidOptions, RailingOptions } from "js3";
import { fur, grass, hair, groom, sampleRoots, strands, hairMaterial, hairCards, hairLock } from "js3";
import type { StrandData, HairOptions, StrandGuide, HairCardGuide, HairLockOptions, XYZ } from "js3";
import { createGroom, serializeGroom, parseGroom, generateGroomStrands, bakeGroomCards, compileGroom, renderGroom, buildGroom, buildGroomLODs, groomHairMaterial } from "js3";
import type { GuideGroom, GroomFiber, BakedGroomCards, GroomBuildOptions, GroomHairMaterialOptions } from "js3";
import { voxelizeGroom, buildDirectionalGroomShadow, buildAmbientGroomVisibility, GroomVolumeShadows, registerGroomVolume } from "js3";
import type { GroomVolume, DirectionalGroomShadow, PreviewOptions } from "js3";
import { rig, boneChain, humanoidRig, bindSkin, applyPose, resetPose, captureRestPose, attachToBone, clip, sampleAnimation, resetAnimation, AnimationPlayer, bakeAnimation, solveTwoBoneIK, springChain } from "js3";
import type { Rig, BoneDefinition, SkinBindingOptions, Pose, ClipTrack, AnimationState, SpringChainOptions } from "js3";
import { roundedBox } from "js3/prelude";
import { Group, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import * as addons from "three/addons";
import { WebGPURenderer } from "three/webgpu";
import { uniform } from "three/tsl";
import type { ModelInspection, ImposterOptions, ImposterManifest, ViewerAPI } from "js3/api";
const imposterOptions: ImposterOptions = { coverage: 360, grid: 5, tileSize: 128 };
async function capture(api: ViewerAPI): Promise<ImposterManifest> {
  return (await api.captureImposter(imposterOptions)).manifest;
}
const authored: Group = group([box([1, 2, 3], { material: material({ color: "red" }) }), roundedBox([1, 1, 1], 0.1)]);
const skeleton: Rig = rig(boneChain("joint", [[0,0,0],[0,1,0],[0,2,0]]));
const weights: SkinBindingOptions = { weights: ({position}) => ({joint_0:1-position[1], joint_1:position[1]}) };
const bound = bindSkin(box(), skeleton, weights);
const pose: Pose = { joint_1: { rotation:[0,0,30] } };
applyPose(skeleton, pose); resetPose(skeleton);
attachToBone(skeleton, "joint_2", box(), {space:"world"});
const animated = clip(skeleton, "turn", [{target:"joint_1",property:"rotation",keys:[[0,[0,0,0]],[1,[0,0,90]]]}]);
const motion: AnimationState = sampleAnimation(skeleton, animated, .5);
resetAnimation(skeleton);
const player = new AnimationPlayer(skeleton);
player.play("turn", {loop:true}); player.update(.1); player.dispose();
const body = humanoidRig({height:1.8, fingers:true});
const goal = solveTwoBoneIK(body, {root:"UpperArm_L",mid:"Forearm_L",tip:"Hand_L",target:[.3,1.3,.2],pole:[0,0,1]});
const dynamics = springChain(skeleton, ["joint_0","joint_1","joint_2"], {colliders:[{type:"capsule",start:[0,0,0],end:[0,1,0],radius:.2}]});
bakeAnimation(skeleton, "spring", {duration:1,targets:["joint_0","joint_1"],update:(_,delta)=>dynamics.update(delta)});
authored.add(stairs({steps:4}), ramp({height:1}), arch({openingWidth:2}), wall({opening:{width:1,height:2}}), column({height:3}), gableRoof({rise:1}));
authored.add(new Mesh(new RoundedBoxGeometry(1, 1, 1), new MeshStandardMaterial()));
const basinOptions: BasinOptions = { shape: "rectangular", drainRadius: .05 };
const solidOptions: SolidOptions = { smooth: false };
const railOptions: RailingOptions = { width: 3 };
authored.add(basin(basinOptions), bottle(), dome(), pipe(), frame(), beamBetween([0,0,0],[1,2,3]), railing(railOptions), shelving());
async function cut() {
  const solid: Mesh = await union([box([1,1,1])], solidOptions);
  const shapes = await offsetProfile([[0,0],[1,0],[1,1],[0,1]], .1);
  return [solid, bevel(shapes[0])];
}
const point: Vector3 = new Vector3();
const emitter = box([1,1,1]);
const guides: StrandGuide[] = [{ points: [[0,0,0],[0,1,0]] }];
const options: HairOptions = { roots: { count: 8, seed: 1 }, groom: { guides, curl: { radius: .01, turns: 1 } }, render: { material: hairMaterial(), mode: "ribbons" } };
const fibers: StrandData = groom(sampleRoots(emitter, { count: 8 }), options.groom);
authored.add(hair(emitter, options), fur(emitter, options), grass(emitter, options), strands(fibers));
const cards: HairCardGuide[] = [{ points: [[0,1,0],[.1,.8,0],[.15,.5,0]], width: [.04,.05,.01] }];
authored.add(hairCards(cards, { seed: 2, color: "#352018", roughness: .5 }));
const lockPath: readonly XYZ[] = [[0,1,0],[.2,.9,.1],[.3,.5,.15]];
const lockOptions: HairLockOptions = { width:.2, thickness:.05, widthProfile:[.6,1,.7,0], normal:[0,0,1], twist:15, ridge:.3, color:"#542c18" };
authored.add(hairLock(lockPath, lockOptions));
const editable: GuideGroom = parseGroom(serializeGroom(createGroom({version:1, seed:4, layers:[{id:"coat", kind:"undercoat", children:12, radius:.001, depth:.4}], guides:[{id:"crown", layer:"coat", points:[[0,0,0],[0,1,0]], width:.05}]})));
const generated = generateGroomStrands(editable);
const fiber: GroomFiber = generated.strands[0];
const baked: BakedGroomCards = bakeGroomCards(generated, {tileWidth:32, tileHeight:64});
const groomOptions: GroomBuildOptions = {lod:"medium", representation:"hybrid", shading:"hair", alphaTest:.03, volume:{resolution:32}};
const volume: GroomVolume = voxelizeGroom(generated, {resolution:32});
const shadow: DirectionalGroomShadow = buildDirectionalGroomShadow([{volume, matrixWorld:new Matrix4().toArray()}], [1,2,3], {resolution:32});
const ambient = buildAmbientGroomVisibility([{volume, matrixWorld:new Matrix4().toArray()}], {resolution:32, distance:.15});
const volumeController = new GroomVolumeShadows();
const registered: Group = registerGroomVolume(new Group(), volume);
const preview: PreviewOptions = {lighting:{shadows:true, hairShadows:true, hairShadowResolution:128, hairAmbientOcclusion:.8, hairAmbientResolution:64, hairAmbientDistance:.15}};
const shaderOptions: GroomHairMaterialOptions = {tangentAxis:"v", absorptionScale:1, cuticleTiltDegrees:2};
const hairShader = groomHairMaterial(shaderOptions);
authored.add(buildGroom(editable, groomOptions), renderGroom(compileGroom(editable), groomOptions), buildGroomLODs(editable, {distances:[0,3,8]}));
const renderer: typeof WebGPURenderer = WebGPURenderer;
const value = uniform(1);
const addon = addons.GLTFExporter;
const inspect = (report: ModelInspection) => report.counts.meshes;
export default () => authored;
`,
    );
    const diagnostics = check(project);
    assertEquals(
      diagnostics.length,
      0,
      ts.formatDiagnostics(diagnostics, {
        getCanonicalFileName: (name) => name,
        getCurrentDirectory: () => project,
        getNewLine: () => "\n",
      }),
    );
    // The generated config also works directly, without a wrapper tsconfig.
    const directConfig = ts.readConfigFile(
      join(bundle, "tsconfig.json"),
      ts.sys.readFile,
    );
    const direct = ts.parseJsonConfigFileContent(
      directConfig.config,
      ts.sys,
      bundle,
    );
    assert(direct.fileNames.includes(join(project, "model.ts")));
    assertEquals(
      ts.getPreEmitDiagnostics(
        ts.createProgram(direct.fileNames, direct.options),
      ).length,
      0,
    );
    await Deno.writeTextFile(
      join(project, "model.ts"),
      `import { box } from "js3";\nbox([1, 2, 3], { nonexistentOption: true });\n`,
    );
    assert(check(project).some((diagnostic) => diagnostic.code === 2353));
  } finally {
    await Deno.remove(source, { recursive: true });
    await Deno.remove(project, { recursive: true });
  }
});

Deno.test("type emission protects user files and replaces owned bundles only with force", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const target = join(directory, "bundle");
    await Deno.mkdir(target);
    await Deno.writeTextFile(join(target, "keep.ts"), "user data");
    await assertRejects(() => emitTypes(target), Error, "not empty");
    await assertRejects(
      () => emitTypes(target, { force: true }),
      Error,
      "without a js3 types manifest",
    );
    assertEquals(await Deno.readTextFile(join(target, "keep.ts")), "user data");
    await Deno.remove(target, { recursive: true });
    const first = await emitTypes(target);
    await assertRejects(() => emitTypes(target), Error, "not empty");
    const manifestPath = join(target, "manifest.json");
    const second = await emitTypes(target, { force: true });
    assertEquals(
      JSON.parse(await Deno.readTextFile(manifestPath)).format,
      "js3-types",
    );
    assertEquals(first.dependencies, second.dependencies);
    assertEquals(first.files, second.files);
    await Deno.writeTextFile(join(target, "keep.ts"), "user data");
    await assertRejects(
      () => emitTypes(target, { force: true }),
      Error,
      "unrecognized files",
    );
    const children = [];
    for await (const child of Deno.readDir(directory)) {
      children.push(child.name);
    }
    assertEquals(children, ["bundle"]);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
