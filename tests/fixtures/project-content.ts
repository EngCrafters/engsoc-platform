import type { ProjectContent } from "@/lib/projects/content";

/** Synthetic content used only by hermetic tests, never a catalogue seed. */
export function projectContent(
  title = "Synthetic engineering project"
): ProjectContent {
  const text = (en: string) => ({ en, ar: "" });
  return {
    title: text(title),
    summary: text("A test of a real engineering workflow."),
    discipline: "mechanical",
    alsoDisciplines: [],
    year: 2026,
    type: "research",
    stage: "prototype",
    technologies: ["python"],
    problem: text("Measure the problem."),
    solution: text("Test the solution."),
    technicalApproach: {
      overview: text("A measured engineering approach."),
      decisions: [],
    },
    development: [],
    validation: [],
    nextSteps: text("Evaluate the prototype."),
    collaboration: { seeking: text(""), application: text("") },
    parts: [],
    achievements: [],
    team: [],
    links: [],
    mediaIds: [],
  };
}
