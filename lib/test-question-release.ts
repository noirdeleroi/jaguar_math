export type TestQuestionRelease = {
  kind: string;
  teacherControlledQuestionRelease: boolean;
  questionsReleasedAt: string | null;
};

export function testQuestionsAreReleased({ kind, teacherControlledQuestionRelease, questionsReleasedAt }: TestQuestionRelease) {
  return kind !== "test" || !teacherControlledQuestionRelease || Boolean(questionsReleasedAt);
}
