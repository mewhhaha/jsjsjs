import buildFemale from "./female.ts";

// Body-only entry point for export or replacement hairstyles.
export default function buildModel() {
  return buildFemale({ hair: false });
}
