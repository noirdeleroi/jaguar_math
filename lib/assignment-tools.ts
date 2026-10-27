export type CalculatorAssignmentKind = "homework" | "test" | "paper" | "quiz";

export function assignmentAllowsGraphingCalculator(kind: CalculatorAssignmentKind, requested: boolean) {
  return kind !== "paper" && requested;
}
