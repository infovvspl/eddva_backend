/**
 * Template-backed diagrams — biology cells and school-level circuits.
 *
 * The artwork is fixed and lives here; a specification can only choose a
 * template from the closed registry and rename or hide its labelled slots.
 * Nothing in a specification can supply a path, a URL or a shape, which is why
 * these are safe to accept from a model at all.
 *
 * Circuits are deliberately TEMPLATES, not arbitrary component graphs. School
 * circuit questions are overwhelmingly a series or parallel loop with standard
 * components, and general graph layout is a different and much larger problem
 * whose specification should be driven by a renderer that exists.
 *
 * Each template draws in its own 0..100 square; the layout module scales it.
 * Templates deliberately set NO stroke-width: the renderer compensates for the
 * scale transform once, on the group, and an absolute width inside would
 * bypass that and come out several times too heavy.
 */
import {
  circle, ellipse, group, line, path, polyline, rect, text,
} from './svg-primitives';

export interface TemplateSlot {
  id: string;
  /** Printed unless the specification overrides or hides it. */
  defaultLabel: string;
  /** Where the leader line touches the artwork, in template units. */
  x: number;
  y: number;
  /** Where the text sits. A leader line joins the two. */
  labelX: number;
  labelY: number;
  anchor: 'start' | 'middle' | 'end';
}

export interface DiagramTemplate {
  /** Artwork only. Labels and leader lines are drawn by the renderer. */
  draw(): string[];
  slots: TemplateSlot[];
}

const INK = { stroke: 'currentColor' } as const;

function plantCell(): DiagramTemplate {
  return {
    draw: () => [
      // Cell wall, then membrane just inside it.
      rect(8, 12, 84, 76, { ...INK, rx: 4 }),
      rect(12, 16, 76, 68, { ...INK, rx: 3 }),
      // Vacuole occupies the centre of a mature plant cell.
      ellipse(50, 50, 26, 22, INK),
      circle(28, 34, 7, INK),                       // nucleus
      circle(28, 34, 2.4, { ...INK, fill: 'currentColor' }),
      ellipse(70, 30, 6, 3.5, INK),                 // chloroplasts
      ellipse(74, 66, 6, 3.5, INK),
      ellipse(34, 70, 6, 3.5, INK),
    ],
    slots: [
      { id: 'wall', defaultLabel: 'Cell wall', x: 8, y: 22, labelX: -4, labelY: 18, anchor: 'end' },
      { id: 'membrane', defaultLabel: 'Cell membrane', x: 12, y: 78, labelX: -4, labelY: 84, anchor: 'end' },
      { id: 'nucleus', defaultLabel: 'Nucleus', x: 28, y: 27, labelX: 22, labelY: 6, anchor: 'middle' },
      { id: 'vacuole', defaultLabel: 'Vacuole', x: 50, y: 50, labelX: 104, labelY: 50, anchor: 'start' },
      { id: 'chloroplast', defaultLabel: 'Chloroplast', x: 70, y: 30, labelX: 104, labelY: 24, anchor: 'start' },
      { id: 'cytoplasm', defaultLabel: 'Cytoplasm', x: 62, y: 80, labelX: 104, labelY: 86, anchor: 'start' },
    ],
  };
}

function animalCell(): DiagramTemplate {
  return {
    draw: () => [
      ellipse(50, 50, 42, 32, { ...INK }),
      circle(44, 46, 11, INK),                      // nucleus
      circle(44, 46, 3.4, { ...INK, fill: 'currentColor' }),   // nucleolus
      ellipse(72, 38, 8, 4, INK),                   // mitochondrion
      path('M 64 36 q 4 2 8 0 q 4 -2 8 0', INK),    // its cristae hint
      ellipse(30, 68, 6, 3.4, INK),
      circle(68, 66, 3.2, INK),
    ],
    slots: [
      { id: 'membrane', defaultLabel: 'Cell membrane', x: 50, y: 18, labelX: 50, labelY: 6, anchor: 'middle' },
      { id: 'nucleus', defaultLabel: 'Nucleus', x: 38, y: 40, labelX: -4, labelY: 26, anchor: 'end' },
      { id: 'nucleolus', defaultLabel: 'Nucleolus', x: 44, y: 46, labelX: -4, labelY: 54, anchor: 'end' },
      { id: 'mitochondrion', defaultLabel: 'Mitochondrion', x: 72, y: 38, labelX: 104, labelY: 30, anchor: 'start' },
      { id: 'cytoplasm', defaultLabel: 'Cytoplasm', x: 62, y: 72, labelX: 104, labelY: 78, anchor: 'start' },
    ],
  };
}

function bacterialCell(): DiagramTemplate {
  return {
    draw: () => [
      rect(14, 34, 66, 32, { ...INK, rx: 16 }),
      rect(18, 38, 58, 24, { ...INK, rx: 12 }),
      path('M 34 50 q 8 -8 16 0 q 8 8 16 0', INK),  // nucleoid
      circle(28, 56, 2.6, INK),                     // ribosomes
      circle(60, 44, 2.6, INK),
      polyline([[80, 50], [88, 44], [94, 56], [100, 48]], INK),  // flagellum
    ],
    slots: [
      { id: 'capsule', defaultLabel: 'Capsule', x: 40, y: 34, labelX: 34, labelY: 22, anchor: 'middle' },
      { id: 'wall', defaultLabel: 'Cell wall', x: 18, y: 50, labelX: -4, labelY: 50, anchor: 'end' },
      { id: 'nucleoid', defaultLabel: 'Nucleoid (DNA)', x: 50, y: 50, labelX: 50, labelY: 84, anchor: 'middle' },
      { id: 'flagellum', defaultLabel: 'Flagellum', x: 92, y: 50, labelX: 104, labelY: 66, anchor: 'start' },
    ],
  };
}

function neuron(): DiagramTemplate {
  return {
    draw: () => [
      circle(30, 50, 12, { ...INK }),   // soma
      circle(30, 50, 4, { ...INK, fill: 'currentColor' }),   // nucleus
      // Dendrites.
      polyline([[30, 38], [24, 26], [16, 20]], INK),
      polyline([[30, 38], [36, 24], [44, 18]], INK),
      polyline([[18, 50], [8, 44]], INK),
      polyline([[18, 50], [6, 58]], INK),
      // Axon with myelin sheath and terminals.
      line(42, 50, 82, 50, INK),
      ellipse(52, 50, 6, 4, INK),
      ellipse(66, 50, 6, 4, INK),
      polyline([[82, 50], [92, 42]], INK),
      polyline([[82, 50], [94, 50]], INK),
      polyline([[82, 50], [92, 58]], INK),
    ],
    slots: [
      { id: 'dendrite', defaultLabel: 'Dendrites', x: 20, y: 24, labelX: 14, labelY: 8, anchor: 'middle' },
      { id: 'soma', defaultLabel: 'Cell body', x: 30, y: 62, labelX: 26, labelY: 84, anchor: 'middle' },
      { id: 'axon', defaultLabel: 'Axon', x: 60, y: 50, labelX: 60, labelY: 30, anchor: 'middle' },
      { id: 'myelin', defaultLabel: 'Myelin sheath', x: 52, y: 54, labelX: 56, labelY: 74, anchor: 'middle' },
      { id: 'terminal', defaultLabel: 'Axon terminals', x: 92, y: 50, labelX: 104, labelY: 50, anchor: 'start' },
    ],
  };
}

/** Battery, resistor, bulb and switch symbols, in template units. */
function battery(cx: number, cy: number): string[] {
  return [
    line(cx - 4, cy - 9, cx - 4, cy + 9, INK),   // long plate
    line(cx + 4, cy - 5, cx + 4, cy + 5, { ...INK }),
  ];
}

function resistor(cx: number, cy: number): string[] {
  return [rect(cx - 11, cy - 5, 22, 10, INK)];
}

function bulb(cx: number, cy: number): string[] {
  return [
    circle(cx, cy, 8, INK),
    line(cx - 5.7, cy - 5.7, cx + 5.7, cy + 5.7, INK),
    line(cx - 5.7, cy + 5.7, cx + 5.7, cy - 5.7, INK),
  ];
}

function switchSymbol(cx: number, cy: number): string[] {
  return [
    circle(cx - 9, cy, 2, { ...INK, fill: 'currentColor' }),
    circle(cx + 9, cy, 2, { ...INK, fill: 'currentColor' }),
    line(cx - 9, cy, cx + 6, cy - 8, INK),
  ];
}

function seriesCircuit(): DiagramTemplate {
  return {
    draw: () => [
      // One loop, with gaps where the components sit.
      polyline([[20, 22], [39, 22]], INK),
      polyline([[61, 22], [80, 22]], INK),
      polyline([[80, 22], [80, 41]], INK),
      polyline([[80, 59], [80, 78]], INK),
      polyline([[80, 78], [59, 78]], INK),
      polyline([[41, 78], [20, 78]], INK),
      polyline([[20, 78], [20, 59]], INK),
      polyline([[20, 41], [20, 22]], INK),
      ...battery(20, 50),
      ...resistor(50, 22),
      ...bulb(80, 50),
      ...switchSymbol(50, 78),
    ],
    slots: [
      { id: 'battery', defaultLabel: 'Battery', x: 20, y: 50, labelX: -4, labelY: 50, anchor: 'end' },
      { id: 'resistor', defaultLabel: 'Resistor', x: 50, y: 22, labelX: 50, labelY: 8, anchor: 'middle' },
      { id: 'bulb', defaultLabel: 'Bulb', x: 80, y: 50, labelX: 104, labelY: 50, anchor: 'start' },
      { id: 'switch', defaultLabel: 'Switch', x: 50, y: 78, labelX: 50, labelY: 94, anchor: 'middle' },
    ],
  };
}

function parallelCircuit(): DiagramTemplate {
  return {
    draw: () => [
      polyline([[20, 20], [80, 20]], INK),
      polyline([[20, 80], [80, 80]], INK),
      polyline([[20, 20], [20, 41]], INK),
      polyline([[20, 59], [20, 80]], INK),
      ...battery(20, 50),
      // Two parallel branches between the rails.
      polyline([[50, 20], [50, 34]], INK),
      polyline([[50, 46], [50, 54]], INK),
      polyline([[50, 66], [50, 80]], INK),
      ...bulb(50, 40),
      ...bulb(50, 60),
      polyline([[80, 20], [80, 41]], INK),
      polyline([[80, 59], [80, 80]], INK),
      ...switchSymbol(80, 50),
    ],
    slots: [
      { id: 'battery', defaultLabel: 'Battery', x: 20, y: 50, labelX: -4, labelY: 50, anchor: 'end' },
      { id: 'bulb1', defaultLabel: 'Bulb 1', x: 58, y: 40, labelX: 104, labelY: 34, anchor: 'start' },
      { id: 'bulb2', defaultLabel: 'Bulb 2', x: 58, y: 60, labelX: 104, labelY: 66, anchor: 'start' },
      { id: 'switch', defaultLabel: 'Switch', x: 80, y: 50, labelX: 104, labelY: 50, anchor: 'start' },
    ],
  };
}

/**
 * The closed registry. A specification names a key; it can never supply one.
 */
export const DIAGRAM_TEMPLATES: Readonly<Record<string, () => DiagramTemplate>> = {
  plant_cell: plantCell,
  animal_cell: animalCell,
  bacterial_cell: bacterialCell,
  neuron,
  series_circuit: seriesCircuit,
  parallel_circuit: parallelCircuit,
};

/** Slot ids a template defines — used to reject an unknown slot by name. */
export function templateSlotIds(templateId: string): string[] {
  const factory = DIAGRAM_TEMPLATES[templateId];
  return factory ? factory().slots.map((slot) => slot.id) : [];
}

export { group, text, line };
