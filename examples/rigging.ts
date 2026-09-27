import {
  applyPose,
  attachToBone,
  bakeAnimation,
  bindSkin,
  boneChain,
  clip,
  hairLock,
  humanoidRig,
  material,
  rig,
  roundedBox,
  solveTwoBoneIK,
  sphere,
  springChain,
  THREE,
  type XYZ,
} from "js3";

// js3 open examples/rigging.ts
// js3 frames examples/rigging.ts output/rigging-frames --clip Wave --fps 24
export default function buildModel() {
  const character = humanoidRig({ height: 1.8, name: "Aster" });
  character.userData.preview = {
    background: "#202b32",
    grid: false,
    direction: [2, 1, 5],
    target: [0, .95, 0],
    radius: 1.18,
    lighting: { shadows: true },
  };
  const suit = material({ color: "#527d82", roughness: .65 });
  const trim = material({ color: "#edaf68", roughness: .6 });
  const skin = material({ color: "#c9947c", roughness: .8 });
  const boots = material({ color: "#273b48", roughness: .5 });
  const hair = material({ color: "#633e34", roughness: .7 });

  bindSkin(
    roundedBox([.40, .44, .22], .085, {
      name: "Jacket",
      position: [0, 1.25, 0],
      material: suit,
    }),
    character,
    { weights: "Chest" },
  );
  bindSkin(
    roundedBox([.40, .18, .20], .07, {
      name: "Hips_mesh",
      position: [0, .93, 0],
      material: boots,
    }),
    character,
    { weights: "Hips" },
  );
  bindSkin(
    roundedBox([.38, .045, .23], .012, {
      name: "Belt",
      position: [0, 1.04, 0],
      material: trim,
    }),
    character,
    { weights: "Hips" },
  );

  for (const [side, sign] of [["L", 1], ["R", -1]] as const) {
    attachToBone(
      character,
      `UpperArm_${side}`,
      sphere(.081, { name: `Shoulder_mesh_${side}`, material: suit }),
    );
    const arm = new THREE.CylinderGeometry(.06, .073, .56, 16, 24);
    arm.rotateZ(-sign * Math.PI / 2).translate(sign * .496, 1.44, 0);
    const sleeve = new THREE.Mesh(arm, suit);
    sleeve.name = `Sleeve_${side}`;
    bindSkin(sleeve, character, {
      weights: ({ position }) => {
        const forearm = THREE.MathUtils.smoothstep(
          Math.abs(position[0]),
          .46,
          .58,
        );
        return {
          [`UpperArm_${side}`]: 1 - forearm,
          [`Forearm_${side}`]: forearm,
        };
      },
    });
    attachToBone(
      character,
      `Hand_${side}`,
      roundedBox([.135, .07, .10], .03, {
        name: `Glove_${side}`,
        position: [sign * .045, 0, 0],
        material: trim,
      }),
    );
    const leg = new THREE.CylinderGeometry(.082, .066, .8, 16, 28);
    leg.translate(sign * .126, .5, 0);
    const trousers = new THREE.Mesh(leg, boots);
    trousers.name = `Leg_${side}`;
    bindSkin(trousers, character, {
      weights: ({ position }) => {
        const thigh = THREE.MathUtils.smoothstep(position[1], .41, .56);
        return { [`Thigh_${side}`]: thigh, [`Shin_${side}`]: 1 - thigh };
      },
    });
    attachToBone(
      character,
      `Foot_${side}`,
      roundedBox([.16, .105, .27], .035, {
        name: `Boot_${side}`,
        position: [0, -.013, .065],
        material: boots,
      }),
    );
  }

  attachToBone(
    character,
    "Neck",
    sphere(.07, { name: "Neck_mesh", scale: [.8, 1.3, .8], material: skin }),
  );
  attachToBone(
    character,
    "Head",
    sphere(.145, {
      name: "Head_mesh",
      position: [0, .028, 0],
      scale: [.83, 1.1, .86],
      material: skin,
    }),
  );
  attachToBone(
    character,
    "Head",
    sphere(.025, {
      name: "Nose",
      position: [0, .005, .122],
      scale: [.75, 1, 1.1],
      material: skin,
    }),
  );
  for (const [side, sign] of [["L", 1], ["R", -1]] as const) {
    const eye = sphere(.018, {
      name: `Eye_${side}`,
      position: [sign * .049, .04, .114],
      scale: [1, 1.25, .6],
      material: material("#202c39"),
    });
    const blink = eye.geometry.attributes.position.clone();
    for (let i = 0; i < blink.count; i++) blink.setY(i, blink.getY(i) * .06);
    blink.name = "Blink";
    eye.geometry.morphAttributes.position = [blink];
    eye.updateMorphTargets();
    attachToBone(character, "Head", eye);
    attachToBone(
      character,
      "Head",
      sphere(.033, {
        name: `Ear_${side}`,
        position: [sign * .116, .02, 0],
        scale: [.6, 1.2, .7],
        material: skin,
      }),
    );
  }
  const cap = sphere(.148, {
    name: "Hair_cap",
    position: [0, .075, -.024],
    scale: [.82, .86, .83],
    material: hair,
  });
  attachToBone(character, "Head", cap);
  for (const [i, x] of [-.06, 0, .06].entries()) {
    attachToBone(
      character,
      "Head",
      hairLock([[x, .172, -.025], [x + .012, .151, .082], [
        x + .025,
        .089,
        .125,
      ]], {
        name: `Fringe_${i}`,
        width: .09,
        thickness: .026,
        normal: [0, 0, 1],
        material: hair,
      }),
    );
  }

  const points: XYZ[] = [[0, .10, -.075], [0, .09, -.20], [0, .025, -.29], [
    0,
    -.09,
    -.34,
  ], [0, -.23, -.32]];
  const ponytail = rig(boneChain("Hair", points), { name: "Ponytail" });
  attachToBone(character, "Head", ponytail);
  bindSkin(
    hairLock(points, {
      name: "Ponytail_lock",
      width: .11,
      thickness: .07,
      widthProfile: [.65, 1, .75, .5, 0],
      normal: [1, 0, 0],
      material: hair,
      segments: 40,
    }),
    ponytail,
    {
      envelopes: points.slice(0, -1).map((_, i) => ({
        bone: `Hair_${i}`,
        end: `Hair_${i + 1}`,
        radius: .13,
        falloff: 3,
      })),
    },
  );
  attachToBone(
    character,
    "Hand_R",
    roundedBox([.12, .17, .04], .015, {
      name: "Handheld_scanner",
      position: [0, 0, .075],
      material: trim,
    }),
  );

  clip(character, "Wave", [
    {
      target: "UpperArm_L",
      property: "rotation",
      keys: [[0, [0, 0, -60]], [.7, [0, 0, 20]], [2.5, [0, 0, 20]], [3.2, [
        0,
        0,
        -60,
      ]]],
    },
    {
      target: "Forearm_L",
      property: "rotation",
      keys: [
        [0, [0, 0, 10]],
        [.7, [0, 0, 70]],
        [1.05, [0, 0, 40]],
        [1.4, [0, 0, 80]],
        [1.75, [0, 0, 40]],
        [2.1, [0, 0, 80]],
        [2.5, [0, 0, 60]],
        [3.2, [0, 0, 10]],
      ],
    },
    {
      target: "UpperArm_R",
      property: "rotation",
      keys: [[0, [0, 0, 65]], [3.2, [0, 0, 65]]],
    },
    {
      target: "Head",
      property: "rotation",
      keys: [[0, [0, 0, 0]], [1.4, [0, -12, -5]], [3.2, [0, 0, 0]]],
    },
    ...["Eye_L", "Eye_R"].map((target) => ({
      target,
      property: "morph" as const,
      morph: "Blink",
      keys: [[0, 0], [1.1, 0], [1.2, 1], [1.3, 0], [3.2, 0]] as const,
    })),
  ]);

  const armBones = ["UpperArm_L", "Forearm_L", "UpperArm_R", "Head"];
  bakeAnimation(character, "Reach_IK", {
    duration: 4,
    fps: 30,
    targets: armBones,
    update(time) {
      applyPose(character, {
        UpperArm_L: { rotation: [0, 0, 0] },
        Forearm_L: { rotation: [0, 0, 0] },
        UpperArm_R: { rotation: [0, 0, 65] },
        Head: { rotation: [0, -12, 0] },
      });
      const phase = time * Math.PI / 2;
      solveTwoBoneIK(character, {
        root: "UpperArm_L",
        mid: "Forearm_L",
        tip: "Hand_L",
        target: [
          .44 + .08 * Math.sin(phase),
          1.32 + .08 * Math.cos(phase),
          .39,
        ],
        pole: [.7, 1.15, -.3],
      });
    },
  });
  const hairBones = points.map((_, i) => `Hair_${i}`);
  const spring = springChain(character, hairBones, {
    stiffness: 32,
    damping: 5,
    gravity: [0, -3, 0],
    radius: .018,
    colliders: [{
      type: "sphere",
      center: [0, .035, 0],
      radius: .125,
      object: character.bones.Head,
    }],
  });
  bakeAnimation(character, "Hair_sway", {
    duration: 4,
    fps: 60,
    targets: [...armBones, ...hairBones],
    update(time, delta) {
      applyPose(character, {
        UpperArm_L: { rotation: [0, 0, -65] },
        UpperArm_R: { rotation: [0, 0, 65] },
        Forearm_L: { rotation: [0, 0, 0] },
        Head: {
          rotation: [
            0,
            36 * Math.sin(time * Math.PI),
            5 * Math.sin(time * Math.PI / 2),
          ],
        },
      });
      if (time === 0) spring.reset();
      spring.update(delta);
    },
  });
  applyPose(character, {
    UpperArm_L: { rotation: [0, 0, -65] },
    UpperArm_R: { rotation: [0, 0, 65] },
  });
  return character;
}
