// The twelve two-ink Riso drawings. The artwork is an SVG sprite in index.html (one <symbol> per
// name, id "il-<name>"); this module only references it. Colours come from --i0 (paper),
// --i1 (first ink) and --i2 (key line) on the topic class.

export const ILLUSTRATIONS = [
  "dna", "heart", "cell", "chromosome", "family_tree", "microscope",
  "sequencer", "petri_dish", "pipette", "gene_lens", "stethoscope", "laptop_code",
];

const SVG = "http://www.w3.org/2000/svg";

export function illustration(name, cls = "il") {
  if (!ILLUSTRATIONS.includes(name)) return null;
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", cls);
  svg.setAttribute("viewBox", "0 0 120 120");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const use = document.createElementNS(SVG, "use");
  use.setAttribute("href", `#il-${name}`);
  svg.append(use);
  return svg;
}
